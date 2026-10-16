import "reflect-metadata";
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  KioskService,
  type ActiveRoomUnlock,
} from "../src/modules/kiosk/kiosk.service";
import {
  KioskAttemptLimiter,
  isBlockedKioskClient,
  kioskTargetKey,
  matchesMasterPin,
  sameKioskTarget,
} from "../src/modules/kiosk/kiosk-security";
import { bangkokToday, shiftInterval } from "../src/modules/duty/duty-rules";

const TOKEN = "dev_0123456789abcdef0123456789abcdef";
const NATIVE_CAMERA_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";

class Socket extends EventEmitter {
  messages: string[] = [];
  writableEnded = false;
  destroyed = false;
  write(message: string) {
    this.messages.push(message);
    return true;
  }
  end() {
    this.writableEnded = true;
    this.emit("close");
  }
}

function serviceFor(t: TestContext, values: Record<string, unknown> = {}) {
  const query: any = {};
  for (const method of ["from", "where", "limit", "orderBy"])
    query[method] = () => query;
  query.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve([{ id: 1, code: "PK01", name: "Phòng khám 01" }]).then(
      resolve,
    );
  const audit: any = {
    entries: [] as any[],
    async log(entry: any) {
      this.entries.push(entry);
    },
  };
  const service = new KioskService(
    { db: { select: () => query } } as any,
    { onDuty: async () => ({ onDuty: [] }) } as any,
    { get: async (key: string) => values[key] ?? null } as any,
    audit,
  );
  service.loadActiveRoster = async () => [];
  t.after(() => service.onModuleDestroy());
  return { service, audit };
}

function session(service: KioskService, terminalId = "terminal_a") {
  return service.createQrSession(
    "PK01",
    "Phòng khám 01",
    terminalId,
    "https://hospital.test",
    undefined,
    "https",
    15,
  );
}

function unlock(
  service: KioskService,
  terminalId: string,
  extra: Partial<ActiveRoomUnlock> = {},
) {
  const value: ActiveRoomUnlock = {
    roomCode: "PK01",
    terminalId,
    doctor: { fullName: "IT" },
    shift: {},
    unlockedAt: Date.now(),
    shiftEndMs: Date.now() + 60_000,
    ...extra,
  };
  (service as any).activeRoomUnlocks.set(
    kioskTargetKey("PK01", terminalId),
    value,
  );
  return value;
}

test("target keys: normalize room, but a missing terminal is never a wildcard", () => {
  assert.equal(kioskTargetKey(" pk01 ", " a "), kioskTargetKey("PK01", "a"));
  assert.equal(
    sameKioskTarget(
      { roomCode: "PK01", terminalId: "a" },
      { roomCode: "PK01", terminalId: "b" },
    ),
    false,
  );
  assert.equal(
    sameKioskTarget(
      { roomCode: "PK01" },
      { roomCode: "PK01", terminalId: "a" },
    ),
    false,
  );
});

test("PIN: only configured value; old hidden passwords and empty configuration never work", () => {
  assert.equal(
    matchesMasterPin("private-hospital-pin", "private-hospital-pin"),
    true,
  );
  for (const pin of [
    "888888",
    "bvqy4@it",
    "999888",
    "",
    "private-hospital-pin ",
  ])
    assert.equal(matchesMasterPin(pin, "private-hospital-pin"), false);
  assert.equal(matchesMasterPin("", ""), false);
});

test("PIN limiter reserves attempts synchronously and recovers after a fixed window", () => {
  const limiter = new KioskAttemptLimiter(5, 1000);
  for (let i = 0; i < 5; i++) assert.equal(limiter.take("ip", 100), true);
  assert.equal(limiter.take("ip", 1099), false);
  assert.equal(limiter.take("another-ip", 100), true);
  assert.equal(limiter.take("ip", 1100), true);
});

test("detect common Android/iOS WebViews; native Safari/Chrome remain supported", () => {
  assert.equal(isBlockedKioskClient(NATIVE_CAMERA_UA), false);
  assert.equal(
    isBlockedKioskClient(
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36",
    ),
    false,
  );
  assert.equal(
    isBlockedKioskClient(
      "Mozilla/5.0 (Linux; Android 14; wv) Version/4.0 Chrome/128.0",
    ),
    true,
  );
  assert.equal(
    isBlockedKioskClient(
      "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148",
    ),
    true,
  );
  assert.equal(isBlockedKioskClient(NATIVE_CAMERA_UA, "scanner-app"), true);
  assert.equal(isBlockedKioskClient("Zalo Scanner/1.0"), true);
});

test("two PCs in one room have independent QR sessions and refresh cannot invalidate the other PC", async (t) => {
  const { service } = serviceFor(t);
  const a = session(service, "terminal_a");
  const b = session(service, "terminal_b");
  assert.equal(service.getSession(a.sessionId)?.status, "WAITING");
  assert.equal(service.getSession(b.sessionId)?.status, "WAITING");
  session(service, "terminal_a");
  assert.equal(service.getSession(a.sessionId), null);
  assert.equal(service.getSession(b.sessionId)?.status, "WAITING");
});

test("QR lifetime honors settings from 10 seconds; default is exactly 15 seconds", (t) => {
  const { service } = serviceFor(t);
  const qr = session(service);
  assert.equal(qr.expiresAt - qr.createdAt, 15_000);
  const short = service.createQrSession(
    "PK01",
    "PK01",
    "b",
    "https://hospital.test",
    undefined,
    "https",
    10,
  );
  assert.equal(short.expiresAt - short.createdAt, 10_000);
});

test("first scan emits unicast mask event with an absolute fixed buffer deadline", async (t) => {
  const { service } = serviceFor(t, { "kiosk.faceVerifyBufferSeconds": 45 });
  const a = new Socket(),
    b = new Socket();
  service.registerSseClient("PK01", "terminal_a", a as any);
  service.registerSseClient("PK01", "terminal_b", b as any);
  const qr = session(service);
  const first = await service.touchSessionScan(qr.sessionId, {
    claimToken: TOKEN,
    userAgent: NATIVE_CAMERA_UA,
  });
  assert.equal(first.error, undefined);
  const deadline = qr.expiresAt;
  assert.equal(deadline - qr.scannedAt!, 45_000);
  assert.match(a.messages[0], /event: SESSION_SCANNED/);
  assert.match(a.messages[0], /"expiresAt":/);
  assert.equal(b.messages.length, 0);
  await service.touchSessionScan(qr.sessionId, {
    claimToken: TOKEN,
    userAgent: NATIVE_CAMERA_UA,
  });
  assert.equal(
    qr.expiresAt,
    deadline,
    "reloading must not extend the verification window",
  );
  assert.equal(a.messages.length, 1, "one scan event, not one event per poll");
});

test("poll/reconnect/refresh during face verification preserve the scanned session and overlay", async (t) => {
  const { service } = serviceFor(t);
  const qr = session(service);
  await service.touchSessionScan(qr.sessionId, { claimToken: TOKEN });
  const status = await service.getKioskStatus(
    "PK01",
    "terminal_a",
    "https://hospital.test",
  );
  assert.equal(status.qrSession?.sessionId, qr.sessionId);
  assert.equal(status.qrSession?.status, "SCANNED");
  assert.equal(status.qrSession?.scannedAt, qr.scannedAt);
  const refreshed = await service.refreshKioskSession(
    "PK01",
    "terminal_a",
    "https://hospital.test",
  );
  assert.equal(refreshed.sessionId, qr.sessionId);
  assert.equal(refreshed.expiresAt, qr.expiresAt);
});

test("expired QR cannot be scanned, and a second phone burns a claimed QR", async (t) => {
  const { service } = serviceFor(t);
  const expired = session(service);
  expired.expiresAt = Date.now() - 1;
  assert.ok(
    (await service.touchSessionScan(expired.sessionId, { claimToken: TOKEN }))
      .error,
  );
  const qr = session(service);
  await service.touchSessionScan(qr.sessionId, { claimToken: TOKEN });
  const other = await service.touchSessionScan(qr.sessionId, {
    claimToken: TOKEN + "other",
  });
  assert.ok(other.error);
  assert.equal(qr.status, "EXPIRED");
});

test("missing claim token is rejected on BOTH scan and verification paths", async (t) => {
  const { service } = serviceFor(t);
  const qr = session(service);
  assert.ok((await service.touchSessionScan(qr.sessionId)).error);
  await service.touchSessionScan(qr.sessionId, { claimToken: TOKEN });
  await assert.rejects(
    service.verifyFaceAndUnlock({
      sessionId: qr.sessionId,
      snapshotBase64: "image",
    }),
    /Thiết bị/,
  );
});

test("device claim is atomic even when both phones await settings concurrently", async (t) => {
  const { service } = serviceFor(t);
  const qr = session(service);
  const results = await Promise.all([
    service.touchSessionScan(qr.sessionId, { claimToken: TOKEN }),
    service.touchSessionScan(qr.sessionId, { claimToken: TOKEN + "other" }),
  ]);
  assert.equal(results.filter((r) => !r.error).length, 1);
  assert.equal(qr.status, "EXPIRED");
});

test("reconnecting SSE socket remains registered after its old socket closes", (t) => {
  const { service } = serviceFor(t);
  const old = new Socket(),
    current = new Socket();
  service.registerSseClient("PK01", "terminal_a", old as any);
  service.registerSseClient("PK01", "terminal_a", current as any);
  old.end();
  assert.equal(
    service.sendToTerminal("terminal_a", "TEST", { roomCode: "PK01" }),
    true,
  );
  assert.equal(current.messages.length, 1);
});

test("offline target unlock NEVER falls back to broadcasting to another PC in the room", (t) => {
  const { service } = serviceFor(t);
  const other = new Socket();
  service.registerSseClient("PK01", "terminal_b", other as any);
  service.emitToTarget("PK01", "terminal_a", "UNLOCK_EVENT", {
    type: "UNLOCK_SUCCESS",
  });
  assert.equal(other.messages.length, 0);
});

test("status snapshots cannot unlock another PC through shared room state", async (t) => {
  const { service } = serviceFor(t);
  const date = bangkokToday();
  const row = {
    slotId: 1,
    userId: 7,
    dutyDate: date,
    shiftCode: "DAY",
    shiftName: "Cả ngày",
    startTime: "00:00",
    endTime: "23:59",
    crossesMidnight: false,
  };
  service.loadActiveRoster = async () => [row] as any;
  unlock(service, "terminal_a", { doctor: { userId: 7 }, shift: row });
  const a = await service.getKioskStatus(
    "PK01",
    "terminal_a",
    "https://hospital.test",
  );
  const b = await service.getKioskStatus(
    "PK01",
    "terminal_b",
    "https://hospital.test",
  );
  const legacy = await service.getKioskStatus(
    "PK01",
    undefined,
    "https://hospital.test",
  );
  assert.equal(a.isUnlocked, true);
  assert.equal(a.qrSession, null);
  assert.equal(b.isUnlocked, false);
  assert.equal(legacy.isUnlocked, false);
  assert.equal(a.protocolVersion, 2);
  assert.equal(a.terminalId, "terminal_a");
});

test("expired lease locks only its target; room lock intentionally revokes every target and in-flight scan", async (t) => {
  const { service } = serviceFor(t);
  const a = new Socket(),
    b = new Socket();
  service.registerSseClient("PK01", "terminal_a", a as any);
  service.registerSseClient("PK01", "terminal_b", b as any);
  unlock(service, "terminal_a", { shiftEndMs: Date.now() - 1 });
  unlock(service, "terminal_b");
  assert.equal(
    (
      await service.getKioskStatus(
        "PK01",
        "terminal_a",
        "https://hospital.test",
      )
    ).isUnlocked,
    false,
  );
  assert.equal(b.messages.length, 0);
  const qr = session(service);
  await service.touchSessionScan(qr.sessionId, { claimToken: TOKEN });
  service.lockRoom("PK01");
  assert.equal(qr.status, "EXPIRED");
  assert.equal(
    (
      await service.getKioskStatus(
        "PK01",
        "terminal_b",
        "https://hospital.test",
      )
    ).isUnlocked,
    false,
  );
  assert.match(b.messages.at(-1)!, /LOCK_EVENT/);
});

test("removing the unlocked doctor from the published roster immediately revokes the terminal lease", async (t) => {
  const { service } = serviceFor(t);
  unlock(service, "terminal_a", {
    doctor: { userId: 7 },
    shift: { dutyDate: bangkokToday(), shiftCode: "S" },
  });
  const status = await service.getKioskStatus(
    "PK01",
    "terminal_a",
    "https://hospital.test",
  );
  assert.equal(status.isUnlocked, false);
});

test("edited shift end/grace is reflected in an existing biometric lease", async (t) => {
  const { service } = serviceFor(t, { "kiosk.lateCheckoutMinutes": 60 });
  const now = Date.now(),
    date = bangkokToday(now);
  const row = {
    userId: 7,
    dutyDate: date,
    shiftCode: "DAY",
    shiftName: "Cả ngày",
    startTime: "00:00",
    endTime: "23:59",
    crossesMidnight: false,
  };
  service.loadActiveRoster = async () => [row] as any;
  unlock(service, "terminal_a", { doctor: { userId: 7 }, shift: row });
  const status = await service.getKioskStatus(
    "PK01",
    "terminal_a",
    "https://hospital.test",
  );
  assert.equal(status.isUnlocked, true);
  assert.equal(
    status.shiftEndMs,
    shiftInterval(date, "00:00", "23:59", false).end + 60 * 60_000,
  );
});

test("IT authorization rejects old backdoors, throttles attempts, and writes audit without the PIN", async (t) => {
  const { service, audit } = serviceFor(t, {
    "kiosk.itMasterPin": "private-hospital-pin",
  });
  for (const pin of ["888888", "bvqy4@it", "wrong", "wrong", "wrong"]) {
    await assert.rejects(
      service.authorizeItOverride("PK01", "terminal_a", pin, "10.1.1.1"),
      /không chính xác/,
    );
  }
  await assert.rejects(
    service.authorizeItOverride(
      "PK01",
      "terminal_a",
      "private-hospital-pin",
      "10.1.1.1",
    ),
    /vượt/,
  );
  const valid = await service.authorizeItOverride(
    "PK01",
    "terminal_b",
    "private-hospital-pin",
    "10.1.1.2",
  );
  assert.equal(valid.success, true);
  assert.ok(valid.shiftEndMs > Date.now());
  assert.match(audit.entries.at(-1).action, /KIOSK_IT_OVERRIDE/);
  assert.ok(!JSON.stringify(audit.entries).includes("private-hospital-pin"));
});

test("legitimate IT support can unlock more than five PCs behind one hospital IP", async (t) => {
  const { service } = serviceFor(t, {
    "kiosk.itMasterPin": "private-hospital-pin",
  });
  for (let i = 0; i < 10; i++) {
    const result = await service.authorizeItOverride(
      "PK01",
      `terminal_${i}`,
      "private-hospital-pin",
      "10.1.1.2",
    );
    assert.equal(result.success, true);
  }
});

test("system face self-update toggle handles stored boolean and legacy string values consistently", async (t) => {
  for (const value of [true, "true", "1", 1, "on"]) {
    const { service } = serviceFor(t, { "kiosk.allowSelfUpdate": value });
    assert.equal(await service.getAllowSelfUpdate(), true);
  }
  for (const value of [false, "false", "0", 0, null]) {
    const { service } = serviceFor(t, { "kiosk.allowSelfUpdate": value });
    assert.equal(await service.getAllowSelfUpdate(), false);
  }
});

test("unbound IT leases from before roster-guard policy fail closed after server update", async (t) => {
  const { service } = serviceFor(t);
  unlock(service, "terminal_a"); // no userId and no itRosterGuard = old IT record
  assert.equal(
    (
      await service.getKioskStatus(
        "PK01",
        "terminal_a",
        "https://hospital.test",
      )
    ).isUnlocked,
    false,
  );
});

test("IT PIN lease stops at the next shift boundary, never using late-checkout grace to span handover", async (t) => {
  let now = Date.parse("2026-10-15T10:45:00+07:00");
  t.mock.method(Date, "now", () => now);
  const { service } = serviceFor(t, {
    "kiosk.itMasterPin": "private-hospital-pin",
    "kiosk.lateCheckoutMinutes": 30,
  });
  const date = "2026-10-15";
  const rows = [
    {
      slotId: 11,
      userId: 7,
      dutyDate: date,
      shiftCode: "S",
      shiftName: "Ca sáng",
      startTime: "07:00",
      endTime: "11:00",
      crossesMidnight: false,
    },
    {
      slotId: 12,
      userId: 8,
      dutyDate: date,
      shiftCode: "C",
      shiftName: "Ca chiều",
      startTime: "11:00",
      endTime: "15:00",
      crossesMidnight: false,
    },
  ];
  service.loadActiveRoster = async () => rows as any;
  const granted = await service.authorizeItOverride(
    "PK01",
    "terminal_a",
    "private-hospital-pin",
    "10.1.1.2",
  );
  assert.equal(granted.shiftEndMs, Date.parse("2026-10-15T11:00:00+07:00"));
  assert.equal(
    (
      await service.getKioskStatus(
        "PK01",
        "terminal_a",
        "https://hospital.test",
      )
    ).isUnlocked,
    true,
  );
  now = Date.parse("2026-10-15T11:00:00+07:00");
  assert.equal(
    (
      await service.getKioskStatus(
        "PK01",
        "terminal_a",
        "https://hospital.test",
      )
    ).isUnlocked,
    false,
  );
});

test("IT PIN lease is revoked immediately when the doctor/assignment of its active shift changes", async (t) => {
  const now = Date.parse("2026-10-15T08:00:00+07:00");
  t.mock.method(Date, "now", () => now);
  const { service } = serviceFor(t, {
    "kiosk.itMasterPin": "private-hospital-pin",
    "kiosk.lateCheckoutMinutes": 30,
  });
  const socket = new Socket();
  service.registerSseClient("PK01", "terminal_a", socket as any);
  const common = {
    slotId: 11,
    dutyDate: "2026-10-15",
    shiftCode: "S",
    shiftName: "Ca sáng",
    startTime: "07:00",
    endTime: "11:00",
    crossesMidnight: false,
  };
  let rows = [{ ...common, userId: 7 }];
  service.loadActiveRoster = async () => rows as any;
  await service.authorizeItOverride(
    "PK01",
    "terminal_a",
    "private-hospital-pin",
    "10.1.1.2",
  );
  assert.equal(
    (
      await service.getKioskStatus(
        "PK01",
        "terminal_a",
        "https://hospital.test",
      )
    ).isUnlocked,
    true,
  );
  rows = [{ ...common, userId: 8 }]; // same slot/time, replacement doctor
  const afterReplacement = await service.getKioskStatus(
    "PK01",
    "terminal_a",
    "https://hospital.test",
  );
  assert.equal(afterReplacement.isUnlocked, false);
  assert.match(socket.messages.at(-1)!, /IT_ROSTER_CHANGED/);
  assert.match(socket.messages.at(-1)!, /bác sĩ.*thay đổi/i);
});

test("IT PIN fails closed rather than creating an unbound lease when roster cannot be read", async (t) => {
  const { service } = serviceFor(t, {
    "kiosk.itMasterPin": "private-hospital-pin",
  });
  service.loadActiveRoster = async () => {
    throw new Error("database unavailable");
  };
  await assert.rejects(
    service.authorizeItOverride(
      "PK01",
      "terminal_a",
      "private-hospital-pin",
      "10.1.1.2",
    ),
    /Không thể xác minh lịch trực/,
  );
  assert.equal(
    (
      await service.getKioskStatus(
        "PK01",
        "terminal_a",
        "https://hospital.test",
      )
    ).isUnlocked,
    false,
  );
});
