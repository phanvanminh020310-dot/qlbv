import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  OnModuleDestroy,
  Optional,
  UnauthorizedException,
  HttpException,
} from "@nestjs/common";
import { and, eq, inArray, sql, or, asc } from "drizzle-orm";
import { Response } from "express";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { DbService } from "../../db/db.service";
import {
  departments,
  dutyAbsences,
  dutyAssignments,
  dutyAttendance,
  dutyPeriods,
  dutyRoles,
  dutyRooms,
  dutyShiftTypes,
  dutySlots,
  userBiometrics,
  users,
} from "../../db/schema";
import { SettingsService } from "../settings/settings.service";
import { AuditService } from "../audit/audit.service";
import { IntegrationDutyService } from "../integration/integration-duty.service";
import { RealtimeService } from "../realtime/realtime.service";
import { addDays, bangkokToday, shiftInterval } from "../duty/duty-rules";
import { candidateDutyDates } from "../integration/integration-time";
import { Subscription } from "rxjs";
import {
  kioskTargetKey,
  sameKioskTarget,
  matchesMasterPin,
  KioskAttemptLimiter,
  isBlockedKioskClient,
} from "./kiosk-security";
import type {
  AccessContext,
  ClientMeta,
} from "../../common/types/access-context";

export interface KioskSession {
  sessionId: string;
  roomCode: string;
  roomName: string;
  terminalId: string; // ID máy trạm duy nhất gắn với phiên này
  handshakePin?: string; // Mã 4 số xác nhận hiện diện (tuỳ chọn)
  createdAt: number;
  expiresAt: number;
  qrUrl: string;
  challengeSequence: string[];
  flashColorSequence: string[];
  status: "WAITING" | "VERIFIED" | "EXPIRED";
  consumed?: boolean;
  faceVerifyBufferSeconds?: number;
  scannedAt?: number; // Thời điểm điện thoại Bác sĩ quét và mở trang
  claimedBy?: string; // Device Claim Token duy nhất của thiết bị đầu tiên mở mã
  claimedIp?: string; // IP thiết bị quét
  claimedUserAgent?: string; // User-Agent thiết bị quét
  isVerifying?: boolean; // Đang có frame AI xử lý
  failCount?: number; // Số lần frame lỗi tạm thời
  verifiedDoctor?: any;
}

/** Snapshot of the published people covering the shift when IT opened a terminal.
 * An IT PIN is never a blanket bypass: a roster/doctor change invalidates it. */
export interface ItOverrideRosterGuard {
  signature: string;
}

export interface ActiveRoomUnlock {
  roomCode: string;
  doctor: any;
  shift: any;
  unlockedAt: number;
  shiftEndMs: number;
  terminalId?: string;
  attendanceId?: string;
  /** Defined only for an IT-PIN lease; biometric leases retain their doctor guard. */
  itRosterGuard?: ItOverrideRosterGuard;
  /** Every release is bound to the currently active published shift (or an IT support session). */
  leaseDeadlineKind?: "ACTIVE_SHIFT" | "IT";
}

@Injectable()
export class KioskService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KioskService.name);
  private readonly sessions = new Map<string, KioskSession>();
  // Lưu kết nối SSE theo từng terminalId (Unicast)
  private readonly terminalClients = new Map<
    string,
    { roomCode: string; clients: Set<Response> }
  >();
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  private realtimeSubscription?: Subscription;
  private readonly pinAttempts = new KioskAttemptLimiter();
  // Lưu danh sách terminal theo từng roomCode
  private readonly roomTerminals = new Map<string, Set<string>>();
  // Lưu trạng thái mở khoá theo terminal; IT PIN còn bị ràng buộc bởi roster/ranh giới ca.
  private readonly activeRoomUnlocks = new Map<string, ActiveRoomUnlock>();

  // Thư mục lưu ảnh khuôn mặt bác sĩ
  private readonly uploadDir = path.resolve(process.cwd(), "uploads", "faces");

  // Khoá mã hoá AES-256 cho dữ liệu sinh trắc học
  private readonly encryptionKey = crypto.scryptSync(
    process.env.BIOMETRIC_SECRET || "qlbs_biometric_salt_secure_bvqy4_2026",
    "hospital_biometric_vault",
    32,
  );

  constructor(
    private readonly db: DbService,
    private readonly integrationDuty: IntegrationDutyService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    @Optional() private readonly realtime?: RealtimeService,
  ) {
    if (!fs.existsSync(this.uploadDir)) {
      try {
        fs.mkdirSync(this.uploadDir, { recursive: true });
      } catch {}
    }

    // Tự động dọn dẹp các phiên QR hết hạn quá 2 phút để giải phóng hoàn toàn bộ nhớ RAM
    this.timers.push(
      setInterval(() => {
        const now = Date.now();
        for (const [sId, s] of this.sessions.entries()) {
          if (now > s.expiresAt + 2 * 60 * 1000) {
            this.sessions.delete(sId);
          }
        }
      }, 30 * 1000),
    );

    // Every locally remembered release is bounded to its active shift. Status polling is
    // authoritative for rendering: a terminal is never locked merely by this event.
    this.timers.push(
      setInterval(() => {
        const now = Date.now();
        for (const [key, info] of this.activeRoomUnlocks.entries()) {
          if (now < info.shiftEndMs) continue;
          const rCode = info.roomCode;
          this.activeRoomUnlocks.delete(key);
          this.emitToTarget(rCode, info.terminalId, "LOCK_EVENT", {
            type: "ACTIVE_SHIFT_ENDED",
            roomCode: rCode,
            reason: "Ca trực đã kết thúc; đang đối soát lại lịch hiện tại.",
            timestamp: new Date().toISOString(),
          });
          void this.audit.log({
            action: "KIOSK_ACTIVE_SHIFT_ENDED",
            module: "KIOSK",
            entity: "duty_attendance",
            description: `Kết thúc phiên mở khoá máy tính phòng khám ${rCode} theo mốc kết thúc ca đang diễn ra`,
            entityId: rCode,
          });
        }
      }, 1000),
    );
  }

  onModuleDestroy() {
    for (const timer of this.timers) clearInterval(timer);
    this.realtimeSubscription?.unsubscribe();
    for (const entry of this.terminalClients.values()) {
      for (const client of entry.clients) client.end();
    }
    this.terminalClients.clear();
    this.roomTerminals.clear();
  }

  async onModuleInit() {
    // 0. Lắng nghe thay đổi lịch trực realtime để cập nhật tức thì xuống toàn bộ Kiosk PC
    if (this.realtime) {
      this.realtimeSubscription = this.realtime.streamAll().subscribe((evt) => {
        if (evt.topic === "duty") {
          this.broadcastScheduleUpdated();
        }
      });
    }

    // Tự động đồng bộ hai chiều giữa đĩa và CSDL:
    // 1. Nếu đĩa có tệp ảnh cũ mà CSDL chưa lưu Base64 -> nạp vào CSDL để tự động sao lưu.
    // 2. Nếu CSDL có ảnh Base64 (sau khi phục hồi từ sao lưu) mà đĩa chưa có tệp -> tự tạo lại tệp trên đĩa.
    try {
      if (!fs.existsSync(this.uploadDir)) {
        fs.mkdirSync(this.uploadDir, { recursive: true });
      }

      const records = await this.db.db
        .select({
          id: userBiometrics.id,
          userId: userBiometrics.userId,
          avatarData: userBiometrics.avatarData,
        })
        .from(userBiometrics);

      let syncedCount = 0;
      let restoredCount = 0;

      for (const rec of records) {
        const filePath = path.join(
          this.uploadDir,
          `user_${rec.userId}_avatar.jpg`,
        );
        const fileExists = fs.existsSync(filePath);

        if (!rec.avatarData && fileExists) {
          try {
            const buf = fs.readFileSync(filePath);
            const dataUrl = `data:image/jpeg;base64,${buf.toString("base64")}`;
            await this.db.db
              .update(userBiometrics)
              .set({ avatarData: dataUrl })
              .where(eq(userBiometrics.id, rec.id));
            syncedCount++;
          } catch (e) {
            this.logger.warn(
              `Không thể nạp ảnh đĩa vào CSDL cho user ${rec.userId}: ${e}`,
            );
          }
        } else if (rec.avatarData && !fileExists) {
          try {
            let b64 = rec.avatarData;
            if (b64.includes(",")) b64 = b64.split(",")[1];
            if (b64) {
              fs.writeFileSync(filePath, Buffer.from(b64, "base64"));
              restoredCount++;
            }
          } catch (e) {
            this.logger.warn(
              `Không thể khôi phục ảnh từ CSDL ra đĩa cho user ${rec.userId}: ${e}`,
            );
          }
        }
      }

      if (syncedCount > 0 || restoredCount > 0) {
        this.logger.log(
          `Đồng bộ ảnh sinh trắc học hoàn tất: ${syncedCount} ảnh nạp vào CSDL sao lưu, ${restoredCount} ảnh khôi phục ra đĩa.`,
        );
      }
    } catch (err) {
      this.logger.warn(`Đồng bộ ảnh sinh trắc học lúc khởi động: ${err}`);
    }
  }

  /**
   * Lấy mã PIN IT khẩn cấp từ CSDL (Quản trị cài đặt trên giao diện) hoặc fallback biến môi trường .env
   */
  async getItMasterPin(): Promise<string> {
    try {
      const dbPin = await this.settings.get<any>("kiosk.itMasterPin");
      if (dbPin !== null && dbPin !== undefined) {
        const pinStr = String(dbPin).trim();
        if (pinStr.length > 0) {
          return pinStr;
        }
      }
    } catch (e: any) {
      console.warn(
        "[KioskService] Lỗi lấy mã PIN IT từ CSDL:",
        e?.message || e,
      );
    }
    return (process.env.IT_MASTER_PIN || "").trim();
  }

  /**
   * Lấy thời gian hiệu lực của mã QR từ CSDL (Quản trị cấu hình)
   */
  async getQrExpiresSeconds(): Promise<number> {
    try {
      const dbSec = await this.settings.get<any>("kiosk.qrExpiresSeconds");
      if (dbSec !== null && dbSec !== undefined) {
        const num = Number(dbSec);
        if (Number.isFinite(num) && num >= 10 && num <= 600) {
          return Math.floor(num);
        }
      }
    } catch (e: any) {
      console.warn(
        "[KioskService] Lỗi lấy thời gian hiệu lực QR từ CSDL:",
        e?.message || e,
      );
    }
    return 15;
  }

  /**
   * Lấy thời gian đệm xác thực khuôn mặt sau khi quét từ CSDL (Quản trị cấu hình)
   */
  async getFaceVerifyBufferSeconds(): Promise<number> {
    try {
      const dbSec = await this.settings.get<any>(
        "kiosk.faceVerifyBufferSeconds",
      );
      if (dbSec !== null && dbSec !== undefined) {
        const num = Number(dbSec);
        if (Number.isFinite(num) && num >= 10 && num <= 300) {
          return Math.floor(num);
        }
      }
    } catch (e: any) {
      console.warn(
        "[KioskService] Lỗi lấy cấu hình faceVerifyBufferSeconds:",
        e?.message || e,
      );
    }
    return 60;
  }

  /**
   * Lấy thời gian cho phép bác sĩ đến sớm trước ca (phút) từ CSDL cấu hình
   */
  async getEarlyCheckinMinutes(): Promise<number> {
    try {
      const dbVal = await this.settings.get<any>("kiosk.earlyCheckinMinutes");
      if (dbVal !== null && dbVal !== undefined) {
        const num = Number(dbVal);
        if (Number.isFinite(num) && num >= 0 && num <= 240) {
          return Math.floor(num);
        }
      }
    } catch (e: any) {
      console.warn(
        "[KioskService] Lỗi lấy cấu hình earlyCheckinMinutes:",
        e?.message || e,
      );
    }
    return 60;
  }

  /**
   * Lấy thời gian ân hạn sau ca trực để bàn giao (phút) từ CSDL cấu hình
   */
  async getLateCheckoutMinutes(): Promise<number> {
    try {
      const dbVal = await this.settings.get<any>("kiosk.lateCheckoutMinutes");
      if (dbVal !== null && dbVal !== undefined) {
        const num = Number(dbVal);
        if (Number.isFinite(num) && num >= 0 && num <= 240) {
          return Math.floor(num);
        }
      }
    } catch (e: any) {
      console.warn(
        "[KioskService] Lỗi lấy cấu hình lateCheckoutMinutes:",
        e?.message || e,
      );
    }
    return 30;
  }

  /**
   * Helper chuyển đổi giá trị cấu hình sang Boolean chuẩn xác
   */
  private toBoolean(val: unknown): boolean {
    if (typeof val === "boolean") return val;
    if (typeof val === "string") {
      const s = val.trim().toLowerCase();
      return s === "true" || s === "1" || s === "yes" || s === "on";
    }
    if (typeof val === "number") return val === 1;
    return false;
  }

  /**
   * Cấu hình cho phép bác sĩ tự chụp đăng ký khuôn mặt lần đầu trên trang Cá nhân
   */
  async getAllowSelfEnroll(): Promise<boolean> {
    try {
      const val = await this.settings.get<any>("kiosk.allowSelfEnroll");
      return this.toBoolean(val);
    } catch {
      return false;
    }
  }

  /**
   * Cấu hình cho phép bác sĩ tự chụp đổi lại khuôn mặt đã có (mặc định: false - chống gian lận)
   */
  async getAllowSelfUpdate(): Promise<boolean> {
    try {
      const val = await this.settings.get<any>("kiosk.allowSelfUpdate");
      return this.toBoolean(val);
    } catch {
      return false;
    }
  }

  /**
   * Ngưỡng phát hiện trùng lặp khuôn mặt toàn viện (1:N)
   */
  async getFaceDuplicateThreshold(): Promise<number> {
    try {
      const val = await this.settings.get<any>("kiosk.faceDuplicateThreshold");
      const num = Number(val);
      if (Number.isFinite(num) && num >= 0.4 && num <= 0.95) {
        return num;
      }
    } catch {}
    return 0.65;
  }

  private get aiServiceUrl(): string {
    return (
      process.env.AI_SERVICE_URL ||
      process.env.BIOMETRIC_AI_SERVICE_URL ||
      "http://localhost:8001"
    ).replace(/\/+$/, "");
  }

  // --- 1. QUẢN LÝ PHIÊN QR & REALTIME SSE CHO PHÒNG KHÁM ---

  registerSseClient(
    roomCode: string,
    terminalId: string | undefined,
    res: Response,
  ) {
    const code = roomCode.toUpperCase().trim();
    const tid = terminalId?.trim() || `legacy_${code}_${crypto.randomUUID()}`;
    const existing = this.terminalClients.get(tid);
    if (existing && existing.roomCode !== code) {
      res.end(); // A terminal connection cannot move to another room mid-stream.
      return;
    }
    const entry = existing || { roomCode: code, clients: new Set<Response>() };
    entry.clients.add(res);
    this.terminalClients.set(tid, entry);
    const terminals = this.roomTerminals.get(code) || new Set<string>();
    terminals.add(tid);
    this.roomTerminals.set(code, terminals);
    res.on("close", () => {
      entry.clients.delete(res);
      // An old socket closing must never remove a newly reconnected socket.
      if (entry.clients.size === 0 && this.terminalClients.get(tid) === entry) {
        this.terminalClients.delete(tid);
        const roomSet = this.roomTerminals.get(code);
        roomSet?.delete(tid);
        if (!roomSet?.size) this.roomTerminals.delete(code);
      }
    });
  }

  sendToTerminal(terminalId: string, eventType: string, payload: any): boolean {
    const entry = this.terminalClients.get(terminalId);
    if (
      !entry ||
      (payload.roomCode &&
        entry.roomCode !== payload.roomCode.toUpperCase().trim())
    )
      return false;
    let sent = false;
    for (const client of entry.clients) {
      try {
        if (client.writableEnded || client.destroyed) {
          entry.clients.delete(client);
          continue;
        }
        client.write(
          `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`,
        );
        sent = true;
      } catch {
        entry.clients.delete(client);
      }
    }
    return sent;
  }

  /** Never broadcast a terminal-bound unlock if its SSE socket happens to be offline. */
  emitToTarget(
    roomCode: string,
    terminalId: string | undefined,
    eventType: string,
    payload: any,
  ) {
    const data = {
      ...payload,
      roomCode,
      terminalId: terminalId || undefined,
      serverTime: Date.now(),
    };
    if (terminalId) this.sendToTerminal(terminalId, eventType, data);
    else this.broadcastToRoom(roomCode, eventType, data); // legacy clients only; native checks target
  }

  broadcastToRoom(roomCode: string, eventType: string, payload: any) {
    const code = roomCode.toUpperCase().trim();
    for (const tid of this.roomTerminals.get(code) || [])
      this.sendToTerminal(tid, eventType, payload);
  }

  /**
   * Phát thông báo cập nhật lịch trực realtime xuống Kiosk PC khi lịch bệnh viện có thay đổi
   */
  broadcastScheduleUpdated(roomCode?: string) {
    if (roomCode) {
      this.broadcastToRoom(roomCode, "SCHEDULE_UPDATED", {
        type: "SCHEDULE_UPDATED",
        roomCode,
        timestamp: new Date().toISOString(),
      });
    } else {
      for (const rCode of this.roomTerminals.keys()) {
        this.broadcastToRoom(rCode, "SCHEDULE_UPDATED", {
          type: "SCHEDULE_UPDATED",
          roomCode: rCode,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  /**
   * Khoá phòng khám và thông báo cho máy trạm (xoá trạng thái mở khoá)
   */
  lockRoom(roomCode: string, reason?: string) {
    const code = roomCode.toUpperCase().trim();
    for (const [key, unlock] of this.activeRoomUnlocks) {
      if (unlock.roomCode === code) this.activeRoomUnlocks.delete(key);
    }
    for (const session of this.sessions.values()) {
      if (session.roomCode === code && session.status === "WAITING") {
        session.status = "EXPIRED";
        session.consumed = true;
      }
    }
    this.broadcastToRoom(code, "LOCK_EVENT", {
      type: "LOCK_TRIGGERED",
      roomCode: code,
      reason: reason || "Khoá phòng khám theo yêu cầu",
      timestamp: new Date().toISOString(),
    });
  }

  async authorizeItOverride(
    roomCode: string,
    terminalId: string | undefined,
    pin: string,
    ip: string,
    reason?: string,
  ) {
    const target = kioskTargetKey(roomCode, terminalId);
    if (
      !this.pinAttempts.take(`ip:${ip}`) ||
      !this.pinAttempts.take(`target:${target}`)
    ) {
      throw new HttpException(
        "Đã vượt số lần nhập PIN. Vui lòng chờ 10 phút hoặc liên hệ quản trị.",
        429,
      );
    }
    if (
      !matchesMasterPin(String(pin || "").trim(), await this.getItMasterPin())
    ) {
      await this.audit.log({
        action: "KIOSK_IT_PIN_REJECTED",
        module: "KIOSK",
        entityId: roomCode,
        ip,
      });
      throw new UnauthorizedException(
        "Mã PIN khẩn cấp IT không chính xác hoặc chưa được cấu hình.",
      );
    }
    const result = await this.recordItOverrideUnlock(roomCode, terminalId);
    this.pinAttempts.reset(`target:${target}`);
    this.pinAttempts.reset(`ip:${ip}`);
    await this.audit.log({
      action: "KIOSK_IT_OVERRIDE",
      module: "KIOSK",
      entityId: roomCode,
      ip,
      description: `Mở khoá CNTT máy trạm ${terminalId || "legacy"}: ${(reason || "Hỗ trợ kỹ thuật").slice(0, 300)}`,
    });
    this.emitToTarget(
      roomCode.toUpperCase().trim(),
      terminalId,
      "UNLOCK_EVENT",
      {
        type: "UNLOCK_SUCCESS",
        doctor: result.itDoctor,
        shiftEndMs: result.shiftEndMs,
        method: "IT_EMERGENCY_PIN",
      },
    );
    // Chỉ báo làm mới realtime; UI luôn đọc lại từ CSDL và phải trình bày đây
    // là mở khẩn cấp IT, không phải một lần xác thực sinh trắc học.
    try {
      this.realtime?.publish({
        topic: "duty-attendance",
        type: "it-override",
        permissions: ["duty.manage", "duty.manage-all"],
        departmentId: result.departmentId,
        data: {
          attendanceIds: result.attendanceIds,
          roomCode: roomCode.toUpperCase().trim(),
          terminalId: terminalId || null,
        },
      });
    } catch {
      // Realtime chỉ hỗ trợ cập nhật nhanh, không được làm thất bại việc mở IT đã ghi nhật ký.
    }
    return {
      success: true,
      message: "Đã mở khoá khẩn cấp phòng khám thành công.",
      ...result,
      serverTime: Date.now(),
    };
  }

  /** A stable identity for everyone covering the current published shift(s). */
  private itRosterSignature(
    rows: Array<{
      slotId: number;
      userId: number;
      dutyDate: string;
      shiftCode: string;
      startTime: string;
      endTime: string;
      crossesMidnight: boolean;
    }>,
  ) {
    return rows
      .map(
        (r) =>
          `${r.slotId}:${r.userId}:${r.dutyDate}:${r.shiftCode}:${r.startTime}:${r.endTime}:${r.crossesMidnight ? 1 : 0}`,
      )
      .sort()
      .join("|");
  }

  /**
   * Calculate the bounded IT lease from the published roster.
   * The next shift's START is a hard boundary: normal late-checkout grace never crosses it.
   * A current-roster signature lets status polling revoke an IT lease when a doctor is replaced.
   */
  private async itOverrideLeasePlan(
    roomCode: string,
    now: number,
  ): Promise<{
    shiftEndMs: number;
    shiftName: string;
    guard: ItOverrideRosterGuard;
    /** Những phân công đang chịu tác động của lần mở kỹ thuật này. */
    activeRows: Awaited<ReturnType<KioskService["loadActiveRoster"]>>;
  }> {
    const dates = [...candidateDutyDates(now), addDays(bangkokToday(now), 1)];
    const rows = await this.loadActiveRoster(roomCode, dates);
    const active = rows
      .map((row) => ({
        row,
        interval: shiftInterval(
          row.dutyDate,
          row.startTime,
          row.endTime,
          row.crossesMidnight,
        ),
      }))
      .filter(
        (entry) => entry.interval.start <= now && now < entry.interval.end,
      );

    if (!active.length) {
      throw new ForbiddenException(
        "Không có ca trực đang diễn ra để xác minh mở khoá PIN IT.",
      );
    }

    // Parallel roles may have different end times. Do not let IT support outlive
    // the earliest active handover.
    return {
      shiftEndMs: Math.min(...active.map((entry) => entry.interval.end)),
      shiftName: `${active[0].row.shiftName} (Mở IT)`,
      guard: {
        signature: this.itRosterSignature(active.map((entry) => entry.row)),
      },
      activeRows: active.map((entry) => entry.row),
    };
  }

  private revokeItOverride(
    roomCode: string,
    terminalId: string | undefined,
    targetKey: string,
    type: string,
    reason: string,
  ) {
    this.activeRoomUnlocks.delete(targetKey);
    this.emitToTarget(roomCode, terminalId, "LOCK_EVENT", {
      type,
      roomCode,
      reason,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Mở khoá khẩn cấp bằng PIN IT, bound to the active published roster.
   * It never crosses a new shift; a change of doctor/assignment fails closed immediately.
   */
  async recordItOverrideUnlock(roomCode: string, terminalId?: string) {
    const code = roomCode.toUpperCase().trim();
    const now = Date.now();
    let plan: Awaited<ReturnType<KioskService["itOverrideLeasePlan"]>>;
    try {
      plan = await this.itOverrideLeasePlan(code, now);
    } catch (e: any) {
      this.logger.warn(
        `Không thể kiểm tra lịch trước khi mở IT ${code}: ${e?.message || e}`,
      );
      // Do not create an unbound emergency lease when the mandatory roster guard is unavailable.
      if (e instanceof ForbiddenException) throw e;
      throw new HttpException(
        "Không thể xác minh ca trực đang diễn ra để mở PIN IT. Thử lại khi máy chủ lịch trực hoạt động.",
        503,
      );
    }

    // Ghi sự kiện kỹ thuật theo từng phân công đang diễn ra để màn hình điều
    // phối đọc lại được từ CSDL, kể cả khi Kiosk/API khởi động lại. Đây chỉ là
    // nhật ký tác động đến máy trạm: tuyệt đối không biến PIN IT thành điểm danh
    // hay xác thực khuôn mặt của bác sĩ.
    const seenAssignments = new Set<string>();
    const affectedRows = plan.activeRows.filter((row) => {
      const key = `${row.slotId}:${row.userId}`;
      if (seenAssignments.has(key)) return false;
      seenAssignments.add(key);
      return true;
    });
    const attendanceIds = affectedRows.map(() => crypto.randomUUID());
    try {
      await this.db.db.insert(dutyAttendance).values(
        affectedRows.map((row, index) => ({
          id: attendanceIds[index],
          slotId: row.slotId,
          roomId: row.roomId,
          roomCode: row.roomCode,
          roomName: row.roomName,
          // userId ở đây chỉ gắn sự kiện cấp máy trạm với phân công bị ảnh
          // hưởng để điều phối viên thấy đúng ô trực; không phải người nhập PIN.
          userId: row.userId,
          username: row.username,
          fullName: row.fullName,
          title: row.title ?? '',
          shiftCode: row.shiftCode || "CA_TRUC",
          shiftName: row.shiftName || "Ca làm việc",
          checkinTime: new Date(now),
          status: "EMERGENCY_OVERRIDE",
          confidenceScore: 0,
          method: "IT_EMERGENCY_PIN",
          deviceInfo: `Mở khoá khẩn cấp IT · máy trạm ${terminalId || "legacy"}`,
        })),
      );
    } catch (error: any) {
      this.logger.error(
        `Không thể ghi nhận mở khoá IT ${code}: ${error?.message || error}`,
      );
      // Không mở máy trạm nếu không có nhật ký truy vết bắt buộc.
      throw new HttpException(
        "Không thể ghi nhận sự kiện mở khoá IT. Máy trạm vẫn được giữ khoá; vui lòng thử lại.",
        503,
      );
    }

    const itDoctor = {
      fullName: "Kỹ thuật viên IT",
      title: "IT Support",
      shiftName: plan.shiftName,
    };
    this.activeRoomUnlocks.set(kioskTargetKey(code, terminalId), {
      roomCode: code,
      doctor: itDoctor,
      shift: { shiftName: plan.shiftName },
      unlockedAt: now,
      shiftEndMs: plan.shiftEndMs,
      terminalId,
      itRosterGuard: plan.guard,
      leaseDeadlineKind: "IT",
    });
    return {
      itDoctor,
      shiftEndMs: plan.shiftEndMs,
      attendanceIds,
      departmentId: plan.activeRows[0]?.roomDepartmentId ?? null,
    };
  }

  /** A face-verified doctor is released only until this active shift ends. */
  private biometricLeasePlan(currentRow: any): {
    shiftEndMs: number;
    leaseDeadlineKind: "ACTIVE_SHIFT";
  } {
    const current = shiftInterval(
      currentRow.dutyDate,
      currentRow.startTime,
      currentRow.endTime,
      currentRow.crossesMidnight,
    );
    return { shiftEndMs: current.end, leaseDeadlineKind: "ACTIVE_SHIFT" };
  }

  private releaseTargetForNoActiveShift(roomCode: string, terminalId: string) {
    const targetKey = kioskTargetKey(roomCode, terminalId);
    this.activeRoomUnlocks.delete(targetKey);
    for (const session of this.sessions.values()) {
      if (
        sameKioskTarget(session, { roomCode, terminalId }) &&
        session.status === "WAITING"
      ) {
        session.status = "EXPIRED";
        session.consumed = true;
      }
    }
  }

  async getKioskStatus(
    roomCode: string,
    terminalId?: string,
    clientOrigin?: string,
    hostHeader?: string,
    protocol: string = "http",
  ) {
    const code = roomCode.toUpperCase().trim();
    const tid = terminalId?.trim() || "";
    const now = Date.now();

    const matchedRooms = await this.db.db
      .select({ id: dutyRooms.id, code: dutyRooms.code, name: dutyRooms.name })
      .from(dutyRooms)
      .where(
        and(
          eq(dutyRooms.active, true),
          or(
            sql`lower(${dutyRooms.code}) = lower(${code})`,
            sql`lower(${dutyRooms.name}) = lower(${code})`,
          ),
        ),
      )
      .limit(1);
    const room = matchedRooms[0] || {
      id: 0,
      code,
      name: `Phòng khám số ${code.replace(/^[^\d]*/, "") || code}`,
    };

    // A kiosk may be shown only after this online, exact-time reconciliation.
    // IntegrationDutyService.onDuty uses the published roster and coversInstant;
    // it deliberately excludes early arrival, post-shift grace, upcoming and draft slots.
    let currentScheduled: any = null;
    let rosterVerified = false;
    if (matchedRooms.length) {
      try {
        const result = await this.integrationDuty.onDuty(
          { room: room.code },
          now,
        );
        rosterVerified = true;
        const item = result.onDuty[0];
        if (item) {
          currentScheduled = {
            dutyDate: item.dutyDate,
            roomCode: item.room.code,
            roomName: item.room.name,
            shiftCode: item.shift.code,
            shiftName: item.shift.name,
            startTime: item.shift.startTime,
            endTime: item.shift.endTime,
            fullName: item.staff.fullName,
            title: item.staff.title,
            username: item.staff.username,
          };
        }
      } catch (e: any) {
        // If reconciliation is unavailable, do not create a QR or keep Windows locked.
        this.logger.warn(
          `Không thể đối soát ca trực hiện tại ${code}; giải phóng máy trạm: ${e?.message || e}`,
        );
      }
    }

    const kioskRequired =
      !!matchedRooms.length && rosterVerified && !!currentScheduled;
    if (!kioskRequired) {
      this.releaseTargetForNoActiveShift(code, tid);
      return {
        protocolVersion: 2,
        terminalId: tid,
        roomExists: matchedRooms.length > 0,
        room: { code: room.code, name: room.name },
        kioskRequired: false,
        isUnlocked: true,
        unlocked: true,
        activeDoctor: null,
        shiftEndMs: null,
        currentScheduled: null,
        serverTime: Date.now(),
        qrSession: null,
      };
    }

    const targetKey = kioskTargetKey(code, tid);
    const activeUnlock = this.activeRoomUnlocks.get(targetKey);
    let isUnlocked = false;
    let unlockedDoctor = null;
    let shiftEndMs: number | null = null;

    if (activeUnlock) {
      if (now >= activeUnlock.shiftEndMs) {
        this.activeRoomUnlocks.delete(targetKey);
      } else if (activeUnlock.itRosterGuard) {
        try {
          const plan = await this.itOverrideLeasePlan(code, now);
          if (plan.guard.signature !== activeUnlock.itRosterGuard.signature) {
            this.revokeItOverride(
              code,
              tid,
              targetKey,
              "IT_ROSTER_CHANGED",
              "Ca trực hoặc bác sĩ được phân công đã thay đổi; yêu cầu xác thực lại.",
            );
          } else {
            activeUnlock.shiftEndMs = Math.min(
              activeUnlock.shiftEndMs,
              plan.shiftEndMs,
            );
          }
        } catch (e: any) {
          this.logger.warn(
            `Không thể đối soát phiên IT ${code}: ${e?.message || e}`,
          );
          this.revokeItOverride(
            code,
            tid,
            targetKey,
            "IT_ROSTER_UNVERIFIED",
            "Không xác minh được ca trực đang diễn ra; yêu cầu xác thực lại.",
          );
        }
      } else if (!activeUnlock.doctor?.userId) {
        this.revokeItOverride(
          code,
          tid,
          targetKey,
          "IT_ROSTER_GUARD_MISSING",
          "Phiên PIN IT cũ không có ràng buộc ca trực; yêu cầu xác thực lại.",
        );
      } else {
        try {
          const rows = await this.loadActiveRoster(
            room.code,
            [
              ...new Set([
                ...candidateDutyDates(now),
                activeUnlock.shift.dutyDate,
              ]),
            ].filter(Boolean),
          );
          const row = rows.find(
            (r) =>
              r.userId === activeUnlock.doctor.userId &&
              r.dutyDate === activeUnlock.shift.dutyDate &&
              r.shiftCode === activeUnlock.shift.shiftCode,
          );
          const interval =
            row &&
            shiftInterval(
              row.dutyDate,
              row.startTime,
              row.endTime,
              row.crossesMidnight,
            );
          if (!interval || now < interval.start || now >= interval.end) {
            this.revokeItOverride(
              code,
              tid,
              targetKey,
              "ROSTER_REVOKED",
              "Ca trực đã thay đổi hoặc đã kết thúc; yêu cầu xác thực lại.",
            );
          } else {
            const plan = this.biometricLeasePlan(row);
            activeUnlock.shiftEndMs = plan.shiftEndMs;
            activeUnlock.leaseDeadlineKind = plan.leaseDeadlineKind;
          }
        } catch (e: any) {
          this.logger.warn(
            `Không thể đối soát phiên khuôn mặt ${code}: ${e?.message || e}`,
          );
          this.activeRoomUnlocks.delete(targetKey);
        }
      }

      if (this.activeRoomUnlocks.get(targetKey) === activeUnlock) {
        isUnlocked = true;
        unlockedDoctor = activeUnlock.doctor;
        shiftEndMs = activeUnlock.shiftEndMs;
      }
    }

    const qrExpiresSec = await this.getQrExpiresSeconds();
    const faceVerifyBufferSec = await this.getFaceVerifyBufferSeconds();
    const candidates = Array.from(this.sessions.values()).filter(
      (session) =>
        sameKioskTarget(session, { roomCode: code, terminalId: tid }) &&
        session.status === "WAITING" &&
        !session.consumed &&
        session.expiresAt > Date.now(),
    );
    const activeSession =
      candidates.find((session) => !!session.scannedAt) ||
      candidates[0] ||
      (!isUnlocked
        ? this.createQrSession(
            code,
            room.name,
            tid,
            clientOrigin,
            hostHeader,
            protocol,
            qrExpiresSec,
          )
        : null);

    return {
      protocolVersion: 2,
      terminalId: tid,
      roomExists: true,
      room: { code: room.code, name: room.name },
      kioskRequired: true,
      isUnlocked,
      unlocked: isUnlocked,
      activeDoctor: unlockedDoctor,
      shiftEndMs,
      currentScheduled,
      serverTime: Date.now(),
      qrSession:
        !isUnlocked && activeSession
          ? {
              sessionId: activeSession.sessionId,
              qrUrl: activeSession.qrUrl,
              scannedAt: activeSession.scannedAt || null,
              expiresAt: activeSession.expiresAt,
              status: activeSession.scannedAt ? "SCANNED" : "WAITING",
              expiresInSeconds: Math.max(
                0,
                Math.ceil((activeSession.expiresAt - Date.now()) / 1000),
              ),
              totalExpiresSeconds: qrExpiresSec,
              faceVerifyBufferSeconds:
                activeSession.faceVerifyBufferSeconds || faceVerifyBufferSec,
              challengeSequence: activeSession.challengeSequence,
            }
          : null,
    };
  }

  async refreshKioskSession(
    roomCode: string,
    terminalId?: string,
    clientOrigin?: string,
    hostHeader?: string,
    protocol = "http",
  ) {
    const target = { roomCode, terminalId };
    const sessions = Array.from(this.sessions.values()).filter(
      (s) => sameKioskTarget(s, target) && s.status === "WAITING",
    );
    const scanned = sessions.find(
      (s) => s.scannedAt && !s.consumed && s.expiresAt > Date.now(),
    );
    if (!scanned) {
      for (const s of sessions) {
        s.status = "EXPIRED";
        s.consumed = true;
      }
    }
    const status = await this.getKioskStatus(
      roomCode,
      terminalId,
      clientOrigin,
      hostHeader,
      protocol,
    );
    // Preserve existing web refresh response fields as well as the v2 status snapshot.
    return { ...status, ...status.qrSession, success: true };
  }

  createQrSession(
    roomCode: string,
    roomName: string,
    terminalId?: string,
    clientOrigin?: string,
    hostHeader?: string,
    protocol: string = "http",
    expiresInSeconds: number = 15,
  ): KioskSession {
    const code = roomCode.toUpperCase().trim();
    const tid = terminalId?.trim() || "";
    const sessionId = crypto.randomUUID();

    // Xác định URL cơ sở công khai (Ưu tiên SCAN_BASE_URL cấu hình HTTPS nếu có)
    let baseUrl = "";
    const configuredScanBase =
      process.env.SCAN_BASE_URL || process.env.NEXT_PUBLIC_SCAN_BASE_URL;
    if (configuredScanBase && configuredScanBase.startsWith("http")) {
      baseUrl = configuredScanBase.replace(/\/+$/, "");
    } else if (clientOrigin && clientOrigin.startsWith("http")) {
      baseUrl = clientOrigin.replace(/\/+$/, "");
    } else {
      let host = hostHeader || process.env.PUBLIC_URL || "localhost:3000";
      if (host.includes("api:") || host === "api" || host.endsWith(":4000")) {
        const publicUrl =
          process.env.PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL;
        if (publicUrl) {
          baseUrl = publicUrl.replace(/\/+$/, "");
        } else {
          host = host
            .replace(/api:4000/g, "localhost:3000")
            .replace(/:4000$/, ":3000");
          baseUrl = `${protocol}://${host}`;
        }
      } else {
        baseUrl = `${protocol}://${host}`;
      }
    }

    const qrUrl = `${baseUrl}/scan/${sessionId}`;

    const challengeSequence = ["PASSIVE_LIVENESS"];
    const flashColorSequence = ["#0284c7", "#16a34a", "#dc2626"];
    const ttlSeconds = Math.max(
      10,
      Math.min(600, Math.floor(expiresInSeconds || 15)),
    );

    const createdAt = Date.now();
    const session: KioskSession = {
      sessionId,
      roomCode: code,
      roomName,
      terminalId: tid,
      createdAt,
      expiresAt: createdAt + ttlSeconds * 1000,
      qrUrl,
      challengeSequence,
      flashColorSequence,
      status: "WAITING",
      consumed: false,
    };

    // Dọn các phiên cũ của đúng phòng khám (roomCode) hoặc máy trạm (terminalId) này:
    // Khi màn hình Kiosk sinh mã QR mới, TẤT CẢ các mã QR cũ chưa được quét phải bị HỦY NGAY LẬP TỨC!
    const now = Date.now();
    for (const [sId, s] of this.sessions.entries()) {
      const isTarget = sameKioskTarget(s, { roomCode: code, terminalId: tid });
      if (isTarget && s.status === "WAITING" && sId !== sessionId) {
        // Nếu phiên cũ đã được quét thật sự tại màn hình và đang trong thời gian đệm xác thực:
        // Bảo lưu tuyệt đối phiên cho người đang đứng trước màn hình xác thực
        if (s.scannedAt && now <= s.expiresAt) {
          continue;
        }
        // Tất cả phiên cũ chưa được quét hoặc đã quá hạn -> HỦY BỎ VÀ ĐÁNH DẤU HẾT HẠN NGAY!
        s.status = "EXPIRED";
        s.consumed = true;
        this.sessions.delete(sId);
      }
    }

    this.sessions.set(sessionId, session);
    return session;
  }

  async touchSessionScan(
    sessionId: string,
    meta?: {
      claimToken?: string;
      clientIp?: string;
      userAgent?: string;
      clientEnv?: string;
    },
  ): Promise<{
    session: KioskSession | null;
    error?: string;
    faceVerifyBufferSeconds?: number;
  }> {
    // Resolve config before entering the synchronous claim critical section. Recheck expiry afterwards.
    const bufferSec = await this.getFaceVerifyBufferSeconds();
    const s = this.sessions.get(sessionId);
    const token = meta?.claimToken?.trim();
    const reject = (error: string, expire = false) => {
      if (s && expire && s.status !== "VERIFIED") {
        s.status = "EXPIRED";
        s.consumed = true;
      }
      return { session: null, error };
    };
    if (
      !s ||
      s.status === "EXPIRED" ||
      (s.consumed && s.status !== "VERIFIED") ||
      Date.now() >= s.expiresAt
    ) {
      return reject(
        "Phiên QR đã hết hạn. Vui lòng quét mã mới trên màn hình phòng khám.",
        true,
      );
    }
    if (isBlockedKioskClient(meta?.userAgent, meta?.clientEnv)) {
      return reject(
        "Vui lòng dùng ứng dụng Camera mặc định để quét trực tiếp QR tại phòng khám.",
        true,
      );
    }
    if (!token || token.length < 16 || token.length > 256) {
      return reject(
        "Không xác định được thiết bị quét. Vui lòng mở lại bằng trình duyệt hệ thống.",
      );
    }
    if (s.claimedBy && s.claimedBy !== token) {
      return reject(
        "Mã QR đã được tiếp nhận trên thiết bị khác. Vui lòng quét mã mới tại phòng khám.",
        true,
      );
    }
    if (s.status === "VERIFIED")
      return { session: s, faceVerifyBufferSeconds: s.faceVerifyBufferSeconds };
    if (!s.scannedAt) {
      s.claimedBy = token;
      s.claimedIp = meta?.clientIp;
      s.claimedUserAgent = meta?.userAgent;
      s.scannedAt = Date.now();
      s.faceVerifyBufferSeconds = bufferSec;
      s.expiresAt = s.scannedAt + bufferSec * 1000; // Fixed deadline. Reloading never extends the buffer.
      this.emitToTarget(s.roomCode, s.terminalId, "SESSION_SCANNED", {
        sessionId: s.sessionId,
        scannedAt: s.scannedAt,
        expiresAt: s.expiresAt,
        faceVerifyBufferSeconds: bufferSec,
      });
    }
    return {
      session: s,
      faceVerifyBufferSeconds: s.faceVerifyBufferSeconds || bufferSec,
    };
  }

  getSession(sessionId: string): KioskSession | null {
    const s = this.sessions.get(sessionId);
    if (!s) return null;
    if (s.status === "VERIFIED") return s;
    if (Date.now() >= s.expiresAt) {
      s.status = "EXPIRED";
    }
    return s;
  }

  /**
   * Tra cứu danh sách phân công trong các ngày chỉ định của phòng khám
   */
  async loadActiveRoster(roomCode: string, dates: string[]) {
    const code = roomCode.toUpperCase().trim();
    return this.db.db
      .select({
        slotId: dutySlots.id,
        roomId: dutyRooms.id,
        roomDepartmentId: dutyRooms.departmentId,
        dutyDate: dutySlots.dutyDate,
        roomCode: dutyRooms.code,
        roomName: dutyRooms.name,
        shiftCode: dutyShiftTypes.code,
        shiftName: dutyShiftTypes.name,
        startTime: dutyShiftTypes.startTime,
        endTime: dutyShiftTypes.endTime,
        crossesMidnight: dutyShiftTypes.crossesMidnight,
        userId: users.id,
        username: users.username,
        fullName: users.fullName,
        title: users.title,
      })
      .from(dutyAssignments)
      .innerJoin(dutySlots, eq(dutySlots.id, dutyAssignments.slotId))
      .innerJoin(dutyPeriods, eq(dutyPeriods.id, dutySlots.periodId))
      .innerJoin(dutyRooms, eq(dutyRooms.id, dutySlots.roomId))
      .innerJoin(dutyShiftTypes, eq(dutyShiftTypes.id, dutySlots.shiftId))
      .innerJoin(dutyRoles, eq(dutyRoles.id, dutySlots.roleId))
      .innerJoin(users, eq(users.id, dutyAssignments.userId))
      .where(
        and(
          inArray(dutySlots.dutyDate, dates),
          inArray(dutyPeriods.status, ["CONG_BO", "DA_CHOT"]),
          or(
            eq(dutyRooms.code, code),
            eq(dutyRooms.code, roomCode.trim()),
            sql`lower(${dutyRooms.code}) = lower(${code})`,
            sql`lower(${dutyRooms.name}) = lower(${code})`,
          ),
          eq(dutyRooms.active, true),
          eq(users.active, true),
          sql`not exists (
            select 1 from ${dutyAbsences}
            where ${dutyAbsences.userId} = ${users.id}
              and ${dutyAbsences.endDate} >= ${dutySlots.dutyDate}
              and ${dutyAbsences.startDate} <= ${dutySlots.dutyDate} +
                case when (${dutyShiftTypes.crossesMidnight} or ${dutyShiftTypes.endTime} <= ${dutyShiftTypes.startTime})
                  and ${dutyShiftTypes.endTime}::time > time '00:00' then 1 else 0 end
          )`,
        ),
      )
      .orderBy(asc(dutyShiftTypes.startTime));
  }

  async loadTodayRoster(roomCode: string, dutyDate: string) {
    return this.loadActiveRoster(roomCode, [dutyDate]);
  }

  // --- 2. GỌI MÁY CHỦ AI (VPS 2) & SO KHỚP SINH TRẮC HỌC ---

  async extractEmbeddingFromAi(imageBase64: string): Promise<number[]> {
    let errorDetail = "";
    try {
      const resp = await fetch(
        `${this.aiServiceUrl}/api/ai/extract-embedding`,
        {
          method: "POST",
          signal: AbortSignal.timeout(20_000),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image_base64: imageBase64 }),
        },
      );
      if (resp.ok) {
        const data: any = await resp.json();
        if (data.success && Array.isArray(data.embedding)) {
          return data.embedding;
        }
      } else {
        const errJson: any = await resp.json().catch(() => null);
        if (errJson?.detail) {
          errorDetail = errJson.detail;
        }
      }
    } catch (err: any) {
      console.warn(
        `[KioskService] Không gọi được AI Engine (${this.aiServiceUrl}):`,
        err?.message,
      );
    }
    if (errorDetail) {
      throw new BadRequestException(errorDetail);
    }
    throw new BadRequestException(
      "Máy chủ AI không thể trích xuất vector khuôn mặt. Vui lòng thử lại.",
    );
  }

  async verifyLivenessWithAi(
    imageBase64: string,
    challenges: string[],
  ): Promise<{ isLive: boolean; reason?: string }> {
    try {
      const resp = await fetch(`${this.aiServiceUrl}/api/ai/liveness-pad`, {
        method: "POST",
        signal: AbortSignal.timeout(20_000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_base64: imageBase64,
          challenges_passed: challenges,
        }),
      });
      if (resp.ok) {
        const data: any = await resp.json();
        return { isLive: !!data.is_live, reason: data.reason };
      }
      const errJson: any = await resp.json().catch(() => null);
      return {
        isLive: false,
        reason: errJson?.detail || "Không thể thẩm định người thật",
      };
    } catch (err: any) {
      console.warn(
        `[KioskService] Lỗi gọi Liveness AI (${this.aiServiceUrl}):`,
        err?.message,
      );
      throw new BadRequestException(
        `Không thể kết nối đến máy chủ AI thẩm định người thật (${this.aiServiceUrl}). Vui lòng kiểm tra lại dịch vụ.`,
      );
    }
  }

  async verifyAndExtractAi(
    imageBase64: string,
    challenges: string[],
  ): Promise<{ isLive: boolean; reason?: string; embedding: number[] }> {
    // 1. Thử gọi endpoint tối ưu gộp 1 lượt: /api/ai/verify-and-extract
    try {
      const resp = await fetch(
        `${this.aiServiceUrl}/api/ai/verify-and-extract`,
        {
          method: "POST",
          signal: AbortSignal.timeout(20_000),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image_base64: imageBase64,
            challenges_passed: challenges,
          }),
        },
      );

      if (resp.ok) {
        const data: any = await resp.json();
        if (data.success && Array.isArray(data.embedding)) {
          return {
            isLive: true,
            embedding: data.embedding,
          };
        }
        if (data.is_live === false) {
          return {
            isLive: false,
            reason: data.reason || "Không vượt qua bài kiểm tra người thật",
            embedding: [],
          };
        }
        if (data.reason) {
          throw new BadRequestException(data.reason);
        }
      }
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      console.warn(
        `[KioskService] Endpoint verify-and-extract không khả dụng (${err?.message}), fallback về 2 luồng song song.`,
      );
    }

    // 2. Fallback: chạy song song (Promise.all) thay vì tuần tự
    const [liveness, probeVector] = await Promise.all([
      this.verifyLivenessWithAi(imageBase64, challenges),
      this.extractEmbeddingFromAi(imageBase64),
    ]);

    if (!liveness.isLive) {
      return { isLive: false, reason: liveness.reason, embedding: [] };
    }

    return { isLive: true, embedding: probeVector };
  }

  // --- 3. XÁC THỰC MỞ KHOÁ TOÀN DIỆN: AI + CSDL LỊCH TRỰC QLBV ---

  async verifyFaceAndUnlock(params: {
    sessionId: string;
    snapshotBase64: string;
    completedChallenges?: string[];
    deviceInfo?: string;
    claimToken?: string;
    clientEnv?: string;
    userAgent?: string;
  }) {
    const {
      sessionId,
      snapshotBase64,
      completedChallenges,
      deviceInfo,
      claimToken,
    } = params;

    const session = this.getSession(sessionId);
    if (!session) {
      throw new BadRequestException(
        "Phiên quét QR không hợp lệ hoặc đã hết hạn. Vui lòng quét lại trên màn hình phòng khám.",
      );
    }

    if (
      !session.scannedAt ||
      !session.claimedBy ||
      !claimToken ||
      session.claimedBy !== claimToken.trim()
    ) {
      throw new ForbiddenException(
        "Thiết bị xác thực không trùng khớp với thiết bị đã quét QR.",
      );
    }

    // NẾU PHIÊN NÀY ĐÃ ĐƯỢC XÁC THỰC THÀNH CÔNG RỒI:
    // Trả về thành công ngay lập tức! (Tránh lỗi khi điện thoại gửi thêm frame hoặc người dùng nhấn quét lại/reconnect)
    if (session.status === "VERIFIED") {
      return {
        success: true,
        message: `Điểm danh thành công! Máy tính phòng khám ${session.roomName} đã được mở khoá.`,
        similarity: 1.0,
        doctor: session.verifiedDoctor,
      };
    }

    if (session.status !== "WAITING") {
      throw new BadRequestException(
        "Phiên quét QR không hợp lệ hoặc đã hết hạn. Vui lòng quét lại trên màn hình phòng khám.",
      );
    }

    if (session.consumed) {
      throw new BadRequestException(
        "Mã QR này đã được tiếp nhận xác thực trước đó (Burn-on-scan). Vui lòng nhìn lên màn hình phòng khám để quét mã mới!",
      );
    }

    if (Date.now() >= session.expiresAt) {
      session.status = "EXPIRED";
      session.consumed = true;
      this.sessions.delete(sessionId);
      throw new BadRequestException(
        "Phiên quét QR đã quá thời gian cho phép. Vui lòng quét lại trên màn hình phòng khám.",
      );
    }

    // 1. Chống mở từ trình duyệt nhúng / WebView ứng dụng tin nhắn chuyển tiếp / App quét mã trên iOS và Android
    const isBlockedApp = isBlockedKioskClient(
      params.userAgent,
      params.clientEnv,
    );

    if (isBlockedApp) {
      session.status = "EXPIRED";
      session.consumed = true;
      throw new ForbiddenException(
        "CẢNH BÁO AN NINH: Phát hiện xác thực qua ảnh chụp hoặc ứng dụng quét mã/tin nhắn. Hệ thống từ chối mở máy trạm!",
      );
    }

    // 2. Kiểm tra tính nhất quán của thiết bị gửi ảnh xác thực (Chống gửi link sang máy khác)
    const reqClaimToken = claimToken?.trim();
    if (
      session.claimedBy &&
      reqClaimToken &&
      session.claimedBy !== reqClaimToken
    ) {
      session.status = "EXPIRED";
      session.consumed = true;
      this.logger.warn(
        `[KioskSecurity] PHÁT HIỆN GIAN LẬN: Thiết bị gửi ảnh (${reqClaimToken}) không khớp với thiết bị quét mã QR gốc (${session.claimedBy}). Đã hủy phiên ${sessionId}!`,
      );
      throw new ForbiddenException(
        "CẢNH BÁO AN NINH: Thiết bị xác thực khuôn mặt không trùng khớp với thiết bị quét mã QR gốc. Nghi vấn chuyển tiếp mã từ xa!",
      );
    }

    // Mutex chống xử lý trùng lặp nhiều frame cùng lúc
    if (session.isVerifying) {
      return {
        success: false,
        isProcessing: true,
        message: "Đang xử lý nhận diện khuôn mặt, vui lòng giữ nguyên máy...",
      };
    }
    session.isVerifying = true;

    try {
      // 1. Gọi AI Engine kiểm tra người thật ISO 30107 PAD & trích xuất vector embedding (Gộp 1 lượt siêu tốc)
      const challenges = completedChallenges || ["PASSIVE_LIVENESS"];
      const aiResult = await this.verifyAndExtractAi(
        snapshotBase64,
        challenges,
      );

      if (!aiResult.isLive) {
        session.failCount = (session.failCount || 0) + 1;
        if (session.failCount >= 5) {
          session.consumed = true;
        }
        throw new BadRequestException(
          `AI từ chối: Phát hiện hình ảnh giả mạo (${aiResult.reason}).`,
        );
      }

      const probeVector = aiResult.embedding;

      // 2. Tải toàn bộ vector bác sĩ trong CSDL Postgres (bảng user_biometrics)
      const allBiometrics = await this.db.db
        .select({
          id: userBiometrics.id,
          userId: userBiometrics.userId,
          faceDescriptor: userBiometrics.faceDescriptor,
          username: users.username,
          fullName: users.fullName,
          title: users.title,
        })
        .from(userBiometrics)
        .innerJoin(users, eq(users.id, userBiometrics.userId))
        .where(eq(users.active, true));

      if (allBiometrics.length === 0) {
        throw new BadRequestException(
          "Hệ thống chưa có hồ sơ khuôn mặt nào được đăng ký. Vui lòng liên hệ KHTH/IT.",
        );
      }

      // So khớp Cosine Similarity
      let bestMatch: any = null;
      let maxCosine = -1;

      for (const bio of allBiometrics) {
        const enrolledVector = this.decryptDescriptor(bio.faceDescriptor);
        if (!enrolledVector) continue;

        const cosine = this.calculateCosineSimilarity(
          probeVector,
          enrolledVector,
        );
        if (cosine > maxCosine) {
          maxCosine = cosine;
          bestMatch = bio;
        }
      }

      if (!bestMatch || maxCosine < 0.5) {
        session.failCount = (session.failCount || 0) + 1;
        if (session.failCount >= 8) {
          session.consumed = true;
        }
        throw new ForbiddenException(
          `Khuôn mặt không khớp với hồ sơ Bác sĩ nào trong CSDL bệnh viện (Độ tương đồng: ${(Math.max(0, maxCosine) * 100).toFixed(1)}%).`,
        );
      }

      // 3. KIỂM TRA LỊCH TRỰC CỦA BÁC SĨ TẠI PHÒNG KHÁM
      const now = Date.now();
      const candidateDates = [
        ...candidateDutyDates(now),
        addDays(bangkokToday(now), 1),
      ];
      const allRosterRows = await this.loadActiveRoster(
        session.roomCode,
        candidateDates,
      );
      const doctorSlots = allRosterRows.filter(
        (s) => s.userId === bestMatch.userId,
      );

      if (doctorSlots.length === 0) {
        throw new ForbiddenException(
          `Bác sĩ ${bestMatch.title} ${bestMatch.fullName} nhận diện thành công (${(maxCosine * 100).toFixed(1)}%), nhưng KHÔNG CÓ LỊCH TRỰC hôm nay tại ${session.roomName}!`,
        );
      }

      const matchedSlot = doctorSlots
        .map((slot) => ({
          slot,
          interval: shiftInterval(
            slot.dutyDate,
            slot.startTime,
            slot.endTime,
            slot.crossesMidnight,
          ),
        }))
        .find(({ interval }) => now >= interval.start && now < interval.end);

      if (!matchedSlot) {
        throw new ForbiddenException(
          `Hiện tại không trong khung giờ ca trực của Bác sĩ ${bestMatch.title} ${bestMatch.fullName} tại ${session.roomName}.`,
        );
      }

      const currentShift = matchedSlot.slot;

      if (
        session.status !== "WAITING" ||
        session.consumed ||
        Date.now() >= session.expiresAt
      ) {
        throw new ForbiddenException(
          "Phiên xác thực đã hết hạn hoặc bị huỷ trong lúc AI xử lý. Vui lòng quét QR mới.",
        );
      }

      if (
        Date.now() < matchedSlot.interval.start ||
        Date.now() >= matchedSlot.interval.end
      ) {
        throw new ForbiddenException(
          "Ca trực đã kết thúc trong lúc xác thực. Máy trạm được giải phóng; vui lòng xác thực ở ca đang diễn ra.",
        );
      }

      // 4. Ghi nhận điểm danh vào bảng duty_attendance trong CSDL Postgres
      const attendanceId = crypto.randomUUID();
      await this.db.db.insert(dutyAttendance).values({
        id: attendanceId,
        slotId: currentShift.slotId,
        roomId: currentShift.roomId,
        roomCode: session.roomCode,
        roomName: session.roomName,
        userId: bestMatch.userId,
        username: bestMatch.username,
        fullName: bestMatch.fullName,
        title: bestMatch.title,
        shiftCode: currentShift.shiftCode || "CA_TRUC",
        shiftName: currentShift.shiftName || "Ca làm việc",
        status: "ON_TIME",
        confidenceScore: maxCosine,
        method: "AI_FACIAL_BIOMETRICS",
        deviceInfo: deviceInfo || "Mobile Web Camera",
      });

      if (
        session.status !== "WAITING" ||
        session.consumed ||
        Date.now() >= session.expiresAt
      ) {
        throw new ForbiddenException(
          "Phiên đã hết hạn trong lúc ghi nhận. Máy trạm vẫn khoá, vui lòng quét lại QR.",
        );
      }

      // 5. Cập nhật phiên & BẮN SỰ KIỆN SSE MỞ KHOÁ ĐÍCH DANH DUY NHẤT MÁY TRẠM PHÒNG KHÁM (UNICAST)
      session.status = "VERIFIED";
      session.consumed = true;
      session.verifiedDoctor = {
        userId: bestMatch.userId,
        username: bestMatch.username,
        fullName: bestMatch.fullName,
        title: bestMatch.title,
        shiftName: currentShift.shiftName || "Ca làm việc",
      };

      // A biometric release is valid only for the shift currently in progress.
      const biometricPlan = this.biometricLeasePlan(currentShift);
      const shiftEndMs = biometricPlan.shiftEndMs;

      this.activeRoomUnlocks.set(
        kioskTargetKey(session.roomCode, session.terminalId),
        {
          roomCode: session.roomCode,
          doctor: session.verifiedDoctor,
          shift: currentShift,
          unlockedAt: now,
          shiftEndMs,
          terminalId: session.terminalId,
          attendanceId,
          leaseDeadlineKind: biometricPlan.leaseDeadlineKind,
        },
      );

      const unlockPayload = {
        type: "UNLOCK_SUCCESS",
        doctor: session.verifiedDoctor,
        roomCode: session.roomCode,
        terminalId: session.terminalId,
        attendanceId,
        shiftEndMs,
        leaseDeadlineKind: biometricPlan.leaseDeadlineKind,
      };

      this.emitToTarget(
        session.roomCode,
        session.terminalId,
        "UNLOCK_EVENT",
        unlockPayload,
      );
      void this.audit.log({
        action: "KIOSK_BIOMETRIC_UNLOCK",
        module: "KIOSK",
        entity: "duty_attendance",
        entityId: attendanceId,
        userId: bestMatch.userId,
        description: `Xác thực ca ${currentShift.shiftCode} tại ${session.roomCode}; máy trạm ${session.terminalId}`,
      });
      // Bảng điều phối nhận ngay tín hiệu, nhưng dữ liệu hiển thị vẫn được API
      // đọc lại từ duty_attendance để không phụ thuộc vào trạng thái RAM Kiosk.
      try {
        this.realtime?.publish({
          topic: "duty-attendance",
          type: "verified",
          permissions: ["duty.manage", "duty.manage-all"],
          departmentId: currentShift.roomDepartmentId ?? null,
          data: {
            attendanceId,
            slotId: currentShift.slotId,
            roomCode: session.roomCode,
            userId: bestMatch.userId,
          },
        });
      } catch {
        // Realtime chỉ giúp làm mới giao diện; không được ảnh hưởng đến xác thực.
      }

      return {
        success: true,
        message: `Điểm danh thành công! Máy tính phòng khám ${session.roomName} đã được mở khoá.`,
        similarity: maxCosine,
        doctor: session.verifiedDoctor,
      };
    } finally {
      session.isVerifying = false;
    }
  }

  // --- 4. ĐĂNG KÝ KHUÔN MẶT BÁC SĨ TẬP TRUNG (LƯU VÀO CSDL QLBV) ---

  // --- 4. ĐĂNG KÝ KHUÔN MẶT BÁC SĨ TẬP TRUNG (LƯU VÀO CSDL QLBV & KIỂM SOÁT GIAN LẬN) ---

  async enrollUserBiometrics(
    userId: number,
    imageBase64: string,
    currentUser?: AccessContext,
    clientMeta?: ClientMeta,
  ) {
    const usersList = await this.db.db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const user = usersList[0];
    if (!user)
      throw new NotFoundException(`Không tìm thấy người dùng với ID ${userId}`);

    // LỚP 1: KIỂM TRA PHÂN QUYỀN ĐĂNG KÝ / CẬP NHẬT
    const isAdmin =
      currentUser?.isSuperAdmin ||
      currentUser?.roles?.includes("SUPER_ADMIN") ||
      currentUser?.roles?.includes("ADMIN") ||
      currentUser?.permissions?.includes("user.manage") ||
      currentUser?.permissions?.includes("kiosk.admin");

    const isSelf = currentUser ? currentUser.id === userId : false;

    if (!isAdmin && !isSelf) {
      throw new ForbiddenException(
        "Bạn không có quyền đăng ký hoặc thay đổi sinh trắc học cho nhân sự khác!",
      );
    }

    const [existingBio] = await this.db.db
      .select({
        id: userBiometrics.id,
        avatarPath: userBiometrics.avatarPath,
        enrolledAt: userBiometrics.enrolledAt,
      })
      .from(userBiometrics)
      .where(eq(userBiometrics.userId, userId))
      .limit(1);

    const isEnrolled = !!existingBio;

    // Nếu không phải Admin (mà là bác sĩ tự thao tác trên tài khoản cá nhân)
    if (!isAdmin && isSelf) {
      if (isEnrolled) {
        const allowSelfUpdate = await this.getAllowSelfUpdate();
        if (!allowSelfUpdate) {
          throw new ForbiddenException(
            "Hồ sơ khuôn mặt của bạn đã được khoá an ninh điểm danh. Để phòng ngừa gian lận ca trực, việc cấp đổi khuôn mặt chỉ được thực hiện tại Phòng Tổ chức Cán bộ hoặc Phòng CNTT!",
          );
        }
      } else {
        const allowSelfEnroll = await this.getAllowSelfEnroll();
        if (!allowSelfEnroll) {
          throw new ForbiddenException(
            "Quy định bệnh viện yêu cầu đăng ký sinh trắc học trực tiếp tại Phòng Tổ chức Cán bộ hoặc Phòng CNTT. Vui lòng liên hệ quản trị viên!",
          );
        }
      }

      // LỚP 3: SHIFT LOCK — Khóa nếu nhân viên đang có lịch trực hôm nay
      // Lưu ý: Nếu Quản trị viên đã chủ động BẬT "kiosk.allowSelfUpdate" trong Cấu hình hệ thống,
      // thì quyền của Quản trị viên được ưu tiên tối cao (cho phép cập nhật để sửa lỗi nhận diện khi đang trực).
      // Chỉ áp dụng SHIFT LOCK khi allowSelfUpdate KHÔNG được bật.
      const allowSelfUpdate = await this.getAllowSelfUpdate();
      if (!allowSelfUpdate) {
        const now = Date.now();
        const candidateDates = candidateDutyDates(now);
        const activeDuty = await this.db.db
          .select({ id: dutyAssignments.id })
          .from(dutyAssignments)
          .innerJoin(dutySlots, eq(dutySlots.id, dutyAssignments.slotId))
          .innerJoin(dutyPeriods, eq(dutyPeriods.id, dutySlots.periodId))
          .where(
            and(
              eq(dutyAssignments.userId, userId),
              inArray(dutySlots.dutyDate, candidateDates),
              inArray(dutyPeriods.status, ["CONG_BO", "DA_CHOT"]),
            ),
          )
          .limit(1);

        if (activeDuty.length > 0) {
          throw new ForbiddenException(
            `Bác sĩ ${user.title || ""} ${user.fullName} đang có lịch trực trong ngày. Để bảo đảm tính minh bạch, hệ thống tạm khoá tự đổi dữ liệu sinh trắc học khi đang trong ca trực!`,
          );
        }
      }
    }

    // 1. Gửi ảnh sang AI Engine trích xuất vector ArcFace (512 chiều)
    const descriptor = await this.extractEmbeddingFromAi(imageBase64);

    // LỚP 2: KIỂM TRA TRÙNG LẶP TOÀN VIỆN (1:N ANTI-DUPLICATION CHECK)
    const duplicateThreshold = await this.getFaceDuplicateThreshold();
    const otherBiometrics = await this.db.db
      .select({
        userId: userBiometrics.userId,
        faceDescriptor: userBiometrics.faceDescriptor,
        fullName: users.fullName,
        title: users.title,
        username: users.username,
        departmentName: departments.name,
      })
      .from(userBiometrics)
      .innerJoin(users, eq(users.id, userBiometrics.userId))
      .leftJoin(departments, eq(departments.id, users.departmentId))
      .where(sql`${userBiometrics.userId} != ${userId}`);

    for (const bio of otherBiometrics) {
      const otherVector = this.decryptDescriptor(bio.faceDescriptor);
      if (!otherVector) continue;
      const sim = this.calculateCosineSimilarity(descriptor, otherVector);
      if (sim >= duplicateThreshold) {
        throw new BadRequestException(
          `CẢNH BÁO AN NINH: Khuôn mặt đăng ký trùng khớp (${(sim * 100).toFixed(1)}%) với nhân sự khác trong bệnh viện: ${bio.title ? `${bio.title} ` : ""}${bio.fullName} (@${bio.username}${bio.departmentName ? ` - ${bio.departmentName}` : ""})! Quy định bệnh viện nghiêm cấm đăng ký khuôn mặt của người khác để phòng ngừa gian lận điểm danh.`,
        );
      }
    }

    // 2. Lưu ảnh đại diện vào thư mục uploads/faces/
    let b64 = imageBase64;
    if (b64.includes(",")) b64 = b64.split(",")[1];
    const filename = `user_${userId}_avatar.jpg`;
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
    const filePath = path.join(this.uploadDir, filename);
    fs.writeFileSync(filePath, Buffer.from(b64, "base64"));

    const avatarDataUrl = imageBase64.startsWith("data:image")
      ? imageBase64
      : `data:image/jpeg;base64,${b64}`;

    // 3. Mã hoá AES-256 trước khi lưu CSDL
    const encryptedDescriptor = this.encryptDescriptor(descriptor);

    // 4. Upsert vào bảng user_biometrics (lưu cả avatarData trực tiếp để tự động sao lưu & phục hồi)
    await this.db.db
      .insert(userBiometrics)
      .values({
        userId,
        faceDescriptor: encryptedDescriptor,
        avatarPath: `/uploads/faces/${filename}`,
        avatarData: avatarDataUrl,
        sampleCount: 3,
      })
      .onConflictDoUpdate({
        target: userBiometrics.userId,
        set: {
          faceDescriptor: encryptedDescriptor,
          avatarPath: `/uploads/faces/${filename}`,
          avatarData: avatarDataUrl,
          updatedAt: new Date(),
        },
      });

    // LỚP 4: GHI NHẬT KÝ KIỂM TOÁN HỆ THỐNG (AUDIT TRAIL)
    const isNew = !isEnrolled;
    await this.audit.log({
      userId: currentUser?.id ?? userId,
      username: currentUser?.username ?? user.username,
      fullName: currentUser?.fullName ?? user.fullName,
      action: isNew ? "BIOMETRIC_ENROLL" : "BIOMETRIC_UPDATE",
      module: "KIOSK",
      entity: "user_biometrics",
      entityId: String(userId),
      description: `${currentUser?.fullName || "Người dùng"} đã ${isNew ? "đăng ký mới" : "cập nhật"} sinh trắc học khuôn mặt cho ${user.title || ""} ${user.fullName} (@${user.username})`,
      beforeData: isEnrolled
        ? {
            avatarPath: existingBio?.avatarPath,
            enrolledAt: existingBio?.enrolledAt,
          }
        : null,
      afterData: {
        avatarPath: `/uploads/faces/${filename}`,
        updatedAt: new Date().toISOString(),
      },
      ip: clientMeta?.ip,
      userAgent: clientMeta?.userAgent,
      departmentId: currentUser?.departmentId ?? user.departmentId,
    });

    return {
      success: true,
      message: `Đã lưu hồ sơ sinh trắc học thành công cho ${user.title ? `${user.title} ` : ""}${user.fullName}`,
      avatarPath: `/uploads/faces/${filename}`,
    };
  }

  async getBiometricStatus(userId: number, requestingUser?: AccessContext) {
    const list = await this.db.db
      .select({
        id: userBiometrics.id,
        userId: userBiometrics.userId,
        avatarPath: userBiometrics.avatarPath,
        enrolledAt: userBiometrics.enrolledAt,
        updatedAt: userBiometrics.updatedAt,
      })
      .from(userBiometrics)
      .where(eq(userBiometrics.userId, userId))
      .limit(1);

    const allowSelfEnroll = await this.getAllowSelfEnroll();
    const allowSelfUpdate = await this.getAllowSelfUpdate();

    const isAdmin = Boolean(
      requestingUser?.isSuperAdmin ||
      requestingUser?.roles?.includes("SUPER_ADMIN") ||
      requestingUser?.roles?.includes("ADMIN") ||
      requestingUser?.permissions?.includes("user.manage") ||
      requestingUser?.permissions?.includes("kiosk.admin"),
    );

    const bio = list[0];
    if (!bio) {
      return {
        enrolled: false,
        avatarUrl: null,
        canSelfEnroll: Boolean(isAdmin || allowSelfEnroll),
        canSelfUpdate: false,
      };
    }

    return {
      enrolled: true,
      avatarUrl: `/api/kiosk/doctors/${userId}/avatar?t=${new Date(bio.updatedAt).getTime()}`,
      enrolledAt: bio.enrolledAt,
      updatedAt: bio.updatedAt,
      canSelfEnroll: false,
      canSelfUpdate: Boolean(isAdmin || allowSelfUpdate),
    };
  }

  /**
   * Tự phục hồi tệp ảnh đại diện ra đĩa từ dữ liệu Base64 lưu trong CSDL
   * (áp dụng khi tệp ảnh trên đĩa bị mất sau khi restore CSDL hoặc triển khai máy chủ mới)
   */
  async restoreAvatarFromDb(userId: number): Promise<boolean> {
    try {
      const [bio] = await this.db.db
        .select({ avatarData: userBiometrics.avatarData })
        .from(userBiometrics)
        .where(eq(userBiometrics.userId, userId))
        .limit(1);

      if (!bio?.avatarData) return false;

      let b64 = bio.avatarData;
      if (b64.includes(",")) b64 = b64.split(",")[1];
      if (!b64) return false;

      if (!fs.existsSync(this.uploadDir)) {
        fs.mkdirSync(this.uploadDir, { recursive: true });
      }

      const filePath = path.join(this.uploadDir, `user_${userId}_avatar.jpg`);
      fs.writeFileSync(filePath, Buffer.from(b64, "base64"));
      this.logger.log(
        `Đã tự động khôi phục ảnh chân dung ra đĩa cho bác sĩ userId=${userId}`,
      );
      return true;
    } catch (err) {
      this.logger.warn(
        `Lỗi phục hồi ảnh sinh trắc học từ CSDL cho userId=${userId}: ${err}`,
      );
      return false;
    }
  }

  // --- TIỆN ÍCH MÃ HOÁ VÀ TÍNH ĐỘ TƯƠNG ĐỒNG VECTOR ---

  private encryptDescriptor(descriptor: number[]): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    const text = JSON.stringify(descriptor);
    let enc = cipher.update(text, "utf8", "hex");
    enc += cipher.final("hex");
    const tag = cipher.getAuthTag();
    return `${iv.toString("hex")}:${tag.toString("hex")}:${enc}`;
  }

  private decryptDescriptor(encryptedStr: string): number[] | null {
    try {
      const parts = encryptedStr.split(":");
      if (parts.length !== 3) return null;
      const [ivHex, tagHex, dataHex] = parts;
      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        this.encryptionKey,
        Buffer.from(ivHex, "hex"),
      );
      decipher.setAuthTag(Buffer.from(tagHex, "hex"));
      let dec = decipher.update(dataHex, "hex", "utf8");
      dec += decipher.final("utf8");
      return JSON.parse(dec);
    } catch {
      return null;
    }
  }

  private calculateCosineSimilarity(v1: number[], v2: number[]): number {
    if (v1.length !== v2.length) return 0;
    let dot = 0,
      n1 = 0,
      n2 = 0;
    for (let i = 0; i < v1.length; i++) {
      dot += v1[i] * v2[i];
      n1 += v1[i] * v1[i];
      n2 += v2[i] * v2[i];
    }
    if (n1 === 0 || n2 === 0) return 0;
    return dot / (Math.sqrt(n1) * Math.sqrt(n2));
  }
}
