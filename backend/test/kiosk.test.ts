import "reflect-metadata";
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { KioskService, type ActiveRoomUnlock } from "../src/modules/kiosk/kiosk.service";
import { KioskAttemptLimiter, isBlockedKioskClient, kioskTargetKey, matchesMasterPin, sameKioskTarget } from "../src/modules/kiosk/kiosk-security";

const TOKEN = "dev_0123456789abcdef0123456789abcdef";
const NATIVE_CAMERA_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";

type Row = { slotId?: number; userId: number; dutyDate: string; shiftCode: string; shiftName: string; startTime: string; endTime: string; crossesMidnight: boolean };
class Socket extends EventEmitter { messages: string[] = []; writableEnded = false; destroyed = false; write(v: string) { this.messages.push(v); return true; } end() { this.writableEnded = true; this.emit("close"); } }
const active = (r: Row) => ({ dutyDate: r.dutyDate, room: { code: "PK01", name: "Phòng khám 01" }, shift: { code: r.shiftCode, name: r.shiftName, startTime: r.startTime, endTime: r.endTime }, staff: { username: `doctor_${r.userId}`, fullName: `Bác sĩ ${r.userId}`, title: "BS." } });
const current = (userId = 7): Row => ({ slotId: 1, userId, dutyDate: "2026-10-15", shiftCode: "DAY", shiftName: "Cả ngày", startTime: "00:00", endTime: "23:59", crossesMidnight: false });

function serviceFor(t: TestContext, values: Record<string, unknown> = {}) {
  const query: any = {}; for (const method of ["from", "where", "limit", "orderBy"]) query[method] = () => query;
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve([{ id: 1, code: "PK01", name: "Phòng khám 01" }]).then(resolve);
  const audit: any = { entries: [] as any[], async log(entry: any) { this.entries.push(entry); } };
  const integration = { result: { onDuty: [] as any[] }, failure: null as Error | null, async onDuty() { if (this.failure) throw this.failure; return this.result; } };
  const service = new KioskService({ db: { select: () => query } } as any, integration as any, { get: async (key: string) => values[key] ?? null } as any, audit);
  service.loadActiveRoster = async () => [];
  t.after(() => service.onModuleDestroy());
  return { service, audit, integration };
}
function qr(service: KioskService, terminalId = "terminal_a") { return service.createQrSession("PK01", "Phòng khám 01", terminalId, "https://hospital.test", undefined, "https", 15); }
function unlock(service: KioskService, terminalId: string, extra: Partial<ActiveRoomUnlock> = {}) {
  const value: ActiveRoomUnlock = { roomCode: "PK01", terminalId, doctor: { fullName: "IT" }, shift: {}, unlockedAt: Date.now(), shiftEndMs: Date.now() + 60_000, ...extra };
  (service as any).activeRoomUnlocks.set(kioskTargetKey("PK01", terminalId), value); return value;
}

test("terminal targeting, PIN rules, limiter, and phone-WebView rejection remain strict", () => {
  assert.equal(kioskTargetKey(" pk01 ", " a "), kioskTargetKey("PK01", "a"));
  assert.equal(sameKioskTarget({ roomCode: "PK01", terminalId: "a" }, { roomCode: "PK01", terminalId: "b" }), false);
  assert.equal(matchesMasterPin("private", "private"), true);
  for (const pin of ["888888", "bvqy4@it", "", "private "]) assert.equal(matchesMasterPin(pin, "private"), false);
  const limiter = new KioskAttemptLimiter(2, 1000); assert.equal(limiter.take("ip", 0), true); assert.equal(limiter.take("ip", 0), true); assert.equal(limiter.take("ip", 1), false); assert.equal(limiter.take("ip", 1000), true);
  assert.equal(isBlockedKioskClient(NATIVE_CAMERA_UA), false); assert.equal(isBlockedKioskClient("Mozilla/5.0 (Linux; Android 14; wv) Version/4.0 Chrome/128.0"), true);
});

test("QR sessions are terminal-bound, TTL/buffer bounded and scan event is unicast", async (t) => {
  const { service } = serviceFor(t, { "kiosk.faceVerifyBufferSeconds": 45 }); const a = new Socket(), b = new Socket();
  service.registerSseClient("PK01", "terminal_a", a as any); service.registerSseClient("PK01", "terminal_b", b as any);
  const first = qr(service), second = qr(service, "terminal_b"); assert.equal(first.expiresAt - first.createdAt, 15_000);
  const scan = await service.touchSessionScan(first.sessionId, { claimToken: TOKEN, userAgent: NATIVE_CAMERA_UA }); assert.equal(scan.error, undefined); assert.equal(first.expiresAt - first.scannedAt!, 45_000); assert.match(a.messages[0], /SESSION_SCANNED/); assert.equal(b.messages.length, 0);
  qr(service); assert.equal(service.getSession(first.sessionId)?.status, "WAITING"); assert.ok(service.getSession(first.sessionId)?.scannedAt, "in-flight verification is preserved"); assert.equal(service.getSession(second.sessionId)?.status, "WAITING");
});

test("only an online exact active shift requests kiosk/QR, and scan survives status reconnect", async (t) => {
  const { service, integration } = serviceFor(t); const row = current(); integration.result = { onDuty: [active(row)] };
  const first = await service.getKioskStatus("PK01", "terminal_a", "https://hospital.test"); assert.equal(first.kioskRequired, true); assert.equal(first.isUnlocked, false); assert.ok(first.qrSession);
  await service.touchSessionScan(first.qrSession!.sessionId, { claimToken: TOKEN });
  const again = await service.getKioskStatus("PK01", "terminal_a", "https://hospital.test"); assert.equal(again.qrSession?.sessionId, first.qrSession?.sessionId); assert.equal(again.qrSession?.status, "SCANNED");
});

test("no shift, upcoming/recent roster, or failed online reconciliation immediately releases and clears QR/lease", async (t) => {
  const { service, integration } = serviceFor(t); const old = qr(service); unlock(service, "terminal_a", { doctor: { userId: 7 }, shiftEndMs: Date.now() + 60_000 });
  service.loadActiveRoster = async () => [{ ...current(), startTime: "23:00", endTime: "23:59" }] as any;
  for (const failure of [null, new Error("roster unavailable")]) { integration.failure = failure; const status = await service.getKioskStatus("PK01", "terminal_a", "https://hospital.test"); assert.equal(status.kioskRequired, false); assert.equal(status.isUnlocked, true); assert.equal(status.qrSession, null); }
  assert.equal(service.getSession(old.sessionId)?.status, "EXPIRED"); assert.equal((service as any).activeRoomUnlocks.size, 0);
});

test("verified release is terminal-specific and remains bounded to its current shift", async (t) => {
  let now = Date.parse("2026-10-15T16:59:00+07:00"); t.mock.method(Date, "now", () => now);
  const { service, integration } = serviceFor(t); const row: Row = { ...current(), shiftCode: "C", shiftName: "Ca chiều", startTime: "12:00", endTime: "17:00" };
  integration.result = { onDuty: [active(row)] }; service.loadActiveRoster = async () => [row] as any;
  unlock(service, "terminal_a", { doctor: { userId: 7 }, shift: row, shiftEndMs: Date.parse("2026-10-15T17:00:00+07:00") });
  assert.equal((await service.getKioskStatus("PK01", "terminal_a", "https://hospital.test")).isUnlocked, true);
  assert.equal((await service.getKioskStatus("PK01", "terminal_b", "https://hospital.test")).isUnlocked, false);
  now = Date.parse("2026-10-15T17:00:00+07:00"); integration.result = { onDuty: [] };
  const after = await service.getKioskStatus("PK01", "terminal_a", "https://hospital.test"); assert.equal(after.kioskRequired, false); assert.equal(after.isUnlocked, true); assert.equal(after.shiftEndMs, null);
});

test("a newly confirmed current shift is the only state that locks again after release", async (t) => {
  const { service, integration } = serviceFor(t); assert.equal((await service.getKioskStatus("PK01", "terminal_a", "https://hospital.test")).kioskRequired, false);
  integration.result = { onDuty: [active(current(8))] }; const returned = await service.getKioskStatus("PK01", "terminal_a", "https://hospital.test"); assert.equal(returned.kioskRequired, true); assert.equal(returned.isUnlocked, false); assert.ok(returned.qrSession);
});

test("IT PIN is online/current-shift-only, audit-safe, and revokes on roster change", async (t) => {
  let now = Date.parse("2026-10-15T08:00:00+07:00"); t.mock.method(Date, "now", () => now);
  const { service, audit, integration } = serviceFor(t, { "kiosk.itMasterPin": "private-hospital-pin" });
  await assert.rejects(service.authorizeItOverride("PK01", "terminal_a", "private-hospital-pin", "10.1.1.1"), /Không có ca trực đang diễn ra/);
  const row: Row = { ...current(), shiftCode: "S", shiftName: "Ca sáng", startTime: "07:00", endTime: "11:00" }; let rows = [row]; integration.result = { onDuty: [active(row)] }; service.loadActiveRoster = async () => rows as any;
  for (const pin of ["888888", "bvqy4@it", "wrong"]) await assert.rejects(service.authorizeItOverride("PK01", "terminal_a", pin, "10.1.1.1"), /không chính xác/);
  const granted = await service.authorizeItOverride("PK01", "terminal_a", "private-hospital-pin", "10.1.1.2"); assert.equal(granted.success, true); assert.match(audit.entries.at(-1).action, /KIOSK_IT_OVERRIDE/); assert.ok(!JSON.stringify(audit.entries).includes("private-hospital-pin"));
  assert.equal((await service.getKioskStatus("PK01", "terminal_a", "https://hospital.test")).isUnlocked, true);
  rows = [{ ...row, userId: 8 }]; integration.result = { onDuty: [active(rows[0])] };
  assert.equal((await service.getKioskStatus("PK01", "terminal_a", "https://hospital.test")).isUnlocked, false);
});

test("IT PIN refuses roster outage instead of creating an offline lease; room lock still revokes all targets", async (t) => {
  const { service } = serviceFor(t, { "kiosk.itMasterPin": "private-hospital-pin" }); service.loadActiveRoster = async () => { throw new Error("database unavailable"); };
  await assert.rejects(service.authorizeItOverride("PK01", "terminal_a", "private-hospital-pin", "10.1.1.2"), /Không thể xác minh ca trực đang diễn ra/); assert.equal((service as any).activeRoomUnlocks.size, 0);
  const a = new Socket(), b = new Socket(); service.registerSseClient("PK01", "terminal_a", a as any); service.registerSseClient("PK01", "terminal_b", b as any); const activeQr = qr(service); unlock(service, "terminal_a"); unlock(service, "terminal_b"); service.lockRoom("PK01"); assert.equal(activeQr.status, "EXPIRED"); assert.equal((service as any).activeRoomUnlocks.size, 0); assert.match(a.messages.at(-1)!, /LOCK_EVENT/); assert.match(b.messages.at(-1)!, /LOCK_EVENT/);
});

test("face self-update setting accepts stored booleans and legacy strings", async (t) => {
  for (const value of [true, "true", "1", 1, "on"]) { const { service } = serviceFor(t, { "kiosk.allowSelfUpdate": value }); assert.equal(await service.getAllowSelfUpdate(), true); }
  for (const value of [false, "false", "0", 0, null]) { const { service } = serviceFor(t, { "kiosk.allowSelfUpdate": value }); assert.equal(await service.getAllowSelfUpdate(), false); }
});

test("expired QR, absent claim token, and a second phone cannot consume a face-verification session", async (t) => {
  const { service } = serviceFor(t); const expired = qr(service); expired.expiresAt = Date.now() - 1;
  assert.ok((await service.touchSessionScan(expired.sessionId, { claimToken: TOKEN })).error);
  const guarded = qr(service); assert.ok((await service.touchSessionScan(guarded.sessionId)).error);
  await service.touchSessionScan(guarded.sessionId, { claimToken: TOKEN });
  await assert.rejects(service.verifyFaceAndUnlock({ sessionId: guarded.sessionId, snapshotBase64: "image" }), /Thiết bị/);
  const other = await service.touchSessionScan(guarded.sessionId, { claimToken: TOKEN + "other" }); assert.ok(other.error); assert.equal(guarded.status, "EXPIRED");
});

test("claim acquisition is atomic and a reconnecting SSE socket keeps the newest connection", async (t) => {
  const { service } = serviceFor(t); const one = qr(service);
  const claims = await Promise.all([service.touchSessionScan(one.sessionId, { claimToken: TOKEN }), service.touchSessionScan(one.sessionId, { claimToken: TOKEN + "other" })]);
  assert.equal(claims.filter((item) => !item.error).length, 1); assert.equal(one.status, "EXPIRED");
  const old = new Socket(), fresh = new Socket(); service.registerSseClient("PK01", "terminal_a", old as any); service.registerSseClient("PK01", "terminal_a", fresh as any); old.end();
  assert.equal(service.sendToTerminal("terminal_a", "TEST", { roomCode: "PK01" }), true); assert.equal(fresh.messages.length, 1);
});

test("targeted unlock event never falls back to another workstation in the same room", (t) => {
  const { service } = serviceFor(t); const other = new Socket(); service.registerSseClient("PK01", "terminal_b", other as any);
  service.emitToTarget("PK01", "terminal_a", "UNLOCK_EVENT", { type: "UNLOCK_SUCCESS" }); assert.equal(other.messages.length, 0);
});
