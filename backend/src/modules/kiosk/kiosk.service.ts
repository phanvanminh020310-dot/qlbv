import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { and, eq, inArray, sql, desc, gte, lte, or, ilike, asc } from 'drizzle-orm';
import { Response } from 'express';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { DbService } from '../../db/db.service';
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
} from '../../db/schema';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';
import { IntegrationDutyService } from '../integration/integration-duty.service';
import { bangkokToday, shiftInterval } from '../duty/duty-rules';
import { coversInstant, bangkokIso, candidateDutyDates } from '../integration/integration-time';
import type { AccessContext, ClientMeta } from '../../common/types/access-context';

export interface KioskSession {
  sessionId: string;
  roomCode: string;
  roomName: string;
  terminalId: string;       // ID máy trạm duy nhất gắn với phiên này
  handshakePin?: string;    // Mã 4 số xác nhận hiện diện (tuỳ chọn)
  createdAt: number;
  expiresAt: number;
  qrUrl: string;
  challengeSequence: string[];
  flashColorSequence: string[];
  status: 'WAITING' | 'VERIFIED' | 'EXPIRED';
  verifiedDoctor?: any;
}

export interface ActiveRoomUnlock {
  roomCode: string;
  doctor: any;
  shift: any;
  unlockedAt: number;
  shiftEndMs: number;
  terminalId?: string;
  attendanceId?: string;
}

@Injectable()
export class KioskService implements OnModuleInit {
  private readonly logger = new Logger(KioskService.name);
  private readonly sessions = new Map<string, KioskSession>();
  // Lưu kết nối SSE theo từng terminalId (Unicast)
  private readonly terminalClients = new Map<string, Response>();
  // Lưu danh sách terminal theo từng roomCode
  private readonly roomTerminals = new Map<string, Set<string>>();
  // Lưu trạng thái phòng khám đã mở khoá và thời điểm hết hạn ca trực (+ ân hạn)
  private readonly activeRoomUnlocks = new Map<string, ActiveRoomUnlock>();

  // Thư mục lưu ảnh khuôn mặt bác sĩ
  private readonly uploadDir = path.resolve(process.cwd(), 'uploads', 'faces');

  // Khoá mã hoá AES-256 cho dữ liệu sinh trắc học
  private readonly encryptionKey = crypto.scryptSync(
    process.env.BIOMETRIC_SECRET || 'qlbs_biometric_salt_secure_bvqy4_2026',
    'hospital_biometric_vault',
    32,
  );

  constructor(
    private readonly db: DbService,
    private readonly integrationDuty: IntegrationDutyService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {
    if (!fs.existsSync(this.uploadDir)) {
      try {
        fs.mkdirSync(this.uploadDir, { recursive: true });
      } catch {}
    }

    // Tự động dọn dẹp các phiên QR hết hạn quá 30 phút để giải phóng hoàn toàn bộ nhớ RAM
    setInterval(() => {
      const now = Date.now();
      for (const [sId, s] of this.sessions.entries()) {
        if (s.expiresAt < now - 30 * 60 * 1000) {
          this.sessions.delete(sId);
        }
      }
    }, 10 * 60 * 1000);

    // Tự động kiểm tra và khoá phòng khám khi ca trực kết thúc + quá thời gian ân hạn
    setInterval(() => {
      const now = Date.now();
      for (const [rCode, info] of this.activeRoomUnlocks.entries()) {
        if (now > info.shiftEndMs) {
          this.activeRoomUnlocks.delete(rCode);
          this.broadcastToRoom(rCode, 'LOCK_EVENT', {
            type: 'AUTO_LOCK_SHIFT_EXPIRED',
            roomCode: rCode,
            reason: 'Ca trực đã kết thúc và quá thời gian ân hạn. Tự động khoá phòng khám cho ca tiếp theo.',
            timestamp: new Date().toISOString(),
          });
          void this.audit.log({
            action: 'KIOSK_AUTO_LOCK',
            module: 'KIOSK',
            entity: 'duty_attendance',
            description: `Hệ thống tự động khoá máy tính phòng khám ${rCode} do ca trực của ${info.doctor?.title || ''} ${info.doctor?.fullName || ''} đã kết thúc và quá thời gian ân hạn`,
            entityId: rCode,
          });
        }
      }
    }, 10 * 1000);
  }

  async onModuleInit() {
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
        const filePath = path.join(this.uploadDir, `user_${rec.userId}_avatar.jpg`);
        const fileExists = fs.existsSync(filePath);

        if (!rec.avatarData && fileExists) {
          try {
            const buf = fs.readFileSync(filePath);
            const dataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
            await this.db.db
              .update(userBiometrics)
              .set({ avatarData: dataUrl })
              .where(eq(userBiometrics.id, rec.id));
            syncedCount++;
          } catch (e) {
            this.logger.warn(`Không thể nạp ảnh đĩa vào CSDL cho user ${rec.userId}: ${e}`);
          }
        } else if (rec.avatarData && !fileExists) {
          try {
            let b64 = rec.avatarData;
            if (b64.includes(',')) b64 = b64.split(',')[1];
            if (b64) {
              fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));
              restoredCount++;
            }
          } catch (e) {
            this.logger.warn(`Không thể khôi phục ảnh từ CSDL ra đĩa cho user ${rec.userId}: ${e}`);
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
      const dbPin = await this.settings.get<any>('kiosk.itMasterPin');
      if (dbPin !== null && dbPin !== undefined) {
        const pinStr = String(dbPin).trim();
        if (pinStr.length > 0) {
          return pinStr;
        }
      }
    } catch (e: any) {
      console.warn('[KioskService] Lỗi lấy mã PIN IT từ CSDL:', e?.message || e);
    }
    return (process.env.IT_MASTER_PIN || '999888').trim();
  }

  /**
   * Lấy thời gian hiệu lực của mã QR từ CSDL (Quản trị cấu hình)
   */
  async getQrExpiresSeconds(): Promise<number> {
    try {
      const dbSec = await this.settings.get<any>('kiosk.qrExpiresSeconds');
      if (dbSec !== null && dbSec !== undefined) {
        const num = Number(dbSec);
        if (Number.isFinite(num) && num >= 10 && num <= 600) {
          return Math.floor(num);
        }
      }
    } catch (e: any) {
      console.warn('[KioskService] Lỗi lấy thời gian hiệu lực QR từ CSDL:', e?.message || e);
    }
    return 90;
  }

  /**
   * Lấy thời gian cho phép bác sĩ đến sớm trước ca (phút) từ CSDL cấu hình
   */
  async getEarlyCheckinMinutes(): Promise<number> {
    try {
      const dbVal = await this.settings.get<any>('kiosk.earlyCheckinMinutes');
      if (dbVal !== null && dbVal !== undefined) {
        const num = Number(dbVal);
        if (Number.isFinite(num) && num >= 0 && num <= 240) {
          return Math.floor(num);
        }
      }
    } catch (e: any) {
      console.warn('[KioskService] Lỗi lấy cấu hình earlyCheckinMinutes:', e?.message || e);
    }
    return 60;
  }

  /**
   * Lấy thời gian ân hạn sau ca trực để bàn giao (phút) từ CSDL cấu hình
   */
  async getLateCheckoutMinutes(): Promise<number> {
    try {
      const dbVal = await this.settings.get<any>('kiosk.lateCheckoutMinutes');
      if (dbVal !== null && dbVal !== undefined) {
        const num = Number(dbVal);
        if (Number.isFinite(num) && num >= 0 && num <= 240) {
          return Math.floor(num);
        }
      }
    } catch (e: any) {
      console.warn('[KioskService] Lỗi lấy cấu hình lateCheckoutMinutes:', e?.message || e);
    }
    return 30;
  }

  /**
   * Cấu hình cho phép bác sĩ tự chụp đăng ký khuôn mặt lần đầu trên trang Cá nhân
   */
  async getAllowSelfEnroll(): Promise<boolean> {
    try {
      const val = await this.settings.get<any>('kiosk.allowSelfEnroll');
      return val === true;
    } catch {
      return false;
    }
  }

  /**
   * Cấu hình cho phép bác sĩ tự chụp đổi lại khuôn mặt đã có (mặc định: false - chống gian lận)
   */
  async getAllowSelfUpdate(): Promise<boolean> {
    try {
      const val = await this.settings.get<any>('kiosk.allowSelfUpdate');
      return val === true;
    } catch {
      return false;
    }
  }

  /**
   * Ngưỡng phát hiện trùng lặp khuôn mặt toàn viện (1:N)
   */
  async getFaceDuplicateThreshold(): Promise<number> {
    try {
      const val = await this.settings.get<any>('kiosk.faceDuplicateThreshold');
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
      'http://localhost:8001'
    ).replace(/\/+$/, '');
  }

  // --- 1. QUẢN LÝ PHIÊN QR & REALTIME SSE CHO PHÒNG KHÁM ---

  registerSseClient(roomCode: string, terminalId: string | undefined, res: Response) {
    const code = roomCode.toUpperCase().trim();
    const tid = terminalId?.trim() || `term_${code}_${Date.now()}`;

    // 1. Lưu kết nối đích danh máy trạm
    this.terminalClients.set(tid, res);

    // 2. Lưu liên kết phòng khám -> máy trạm
    const set = this.roomTerminals.get(code) || new Set<string>();
    set.add(tid);
    this.roomTerminals.set(code, set);

    res.on('close', () => {
      this.terminalClients.delete(tid);
      const s = this.roomTerminals.get(code);
      if (s) {
        s.delete(tid);
        if (s.size === 0) this.roomTerminals.delete(code);
      }
    });
  }

  /**
   * Bắn sự kiện đích danh (Unicast) tới đúng một máy trạm vật lý duy nhất
   */
  sendToTerminal(terminalId: string, eventType: string, payload: any): boolean {
    const client = this.terminalClients.get(terminalId);
    if (client) {
      try {
        client.write(`event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`);
        return true;
      } catch (err) {
        this.terminalClients.delete(terminalId);
      }
    }
    return false;
  }

  /**
   * Phát sự kiện tới toàn bộ máy trạm của một phòng khám (dùng dự phòng hoặc khi khoá khẩn cấp)
   */
  broadcastToRoom(roomCode: string, eventType: string, payload: any) {
    const code = roomCode.toUpperCase().trim();
    const termSet = this.roomTerminals.get(code);
    if (!termSet || termSet.size === 0) return;

    const message = `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const tid of Array.from(termSet)) {
      const client = this.terminalClients.get(tid);
      if (client) {
        try {
          client.write(message);
        } catch {
          this.terminalClients.delete(tid);
          termSet.delete(tid);
        }
      }
    }
  }

  /**
   * Khoá phòng khám và thông báo cho máy trạm (xoá trạng thái mở khoá)
   */
  lockRoom(roomCode: string, reason?: string) {
    const code = roomCode.toUpperCase().trim();
    this.activeRoomUnlocks.delete(code);
    this.broadcastToRoom(code, 'LOCK_EVENT', {
      type: 'LOCK_TRIGGERED',
      roomCode: code,
      reason: reason || 'Khoá phòng khám theo yêu cầu',
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Mở khoá khẩn cấp bằng mã PIN IT (ghi nhận trạng thái mở khoá cho phòng khám)
   */
  recordItOverrideUnlock(roomCode: string, terminalId?: string) {
    const code = roomCode.toUpperCase().trim();
    const now = Date.now();
    // Mở khoá khẩn cấp IT kéo dài 12 tiếng hoặc đến khi có lệnh khoá lại
    const shiftEndMs = now + 12 * 3600 * 1000;
    const itDoctor = {
      fullName: 'Kỹ thuật viên IT',
      title: 'IT Support',
      shiftName: 'Mở khoá Khẩn cấp',
    };

    this.activeRoomUnlocks.set(code, {
      roomCode: code,
      doctor: itDoctor,
      shift: { shiftName: 'Mở khoá Khẩn cấp' },
      unlockedAt: now,
      shiftEndMs,
      terminalId,
    });

    return { itDoctor, shiftEndMs };
  }

  async getKioskStatus(
    roomCode: string,
    terminalId?: string,
    clientOrigin?: string,
    hostHeader?: string,
    protocol: string = 'http',
  ) {
    const code = roomCode.toUpperCase().trim();
    const tid = terminalId?.trim() || '';

    // 1. Kiểm tra phòng khám trong database bằng select tiêu chuẩn (không dùng relational query)
    const matchedRooms = await this.db.db
      .select({
        id: dutyRooms.id,
        code: dutyRooms.code,
        name: dutyRooms.name,
      })
      .from(dutyRooms)
      .where(
        or(
          eq(dutyRooms.code, code),
          eq(dutyRooms.code, roomCode.trim()),
          sql`lower(${dutyRooms.code}) = lower(${code})`,
          sql`lower(${dutyRooms.name}) = lower(${code})`,
          ilike(dutyRooms.name, `%${code}%`),
        ),
      )
      .limit(1);

    const room = matchedRooms[0] || {
      id: 0,
      code: code,
      name: `Phòng khám số ${code.replace(/^[^\d]*/, '') || code}`,
    };

    // 2. Tra cứu ca trực hiện tại của phòng từ IntegrationDutyService (chuẩn theo lịch trực bệnh viện)
    let currentScheduled = null;
    const now = Date.now();
    try {
      const onDutyRes = await this.integrationDuty.onDuty({ room: room.code }, now);
      if (onDutyRes?.onDuty && onDutyRes.onDuty.length > 0) {
        const item = onDutyRes.onDuty[0];
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
      } else {
        // Nếu hiện tại không có ca nào đang trực chính thức, kiểm tra xem có ca nào sắp bắt đầu (trong 60p)
        // hoặc vừa kết thúc (trong 30p giao ca) hay ca kế tiếp trong ngày
        const candidateDates = candidateDutyDates(now);
        const allRosterRows = await this.loadActiveRoster(room.code, candidateDates);

        const earlyMinutes = await this.getEarlyCheckinMinutes();
        const lateMinutes = await this.getLateCheckoutMinutes();
        const EARLY_BUFFER_MS = earlyMinutes * 60 * 1000;
        const GRACE_BUFFER_MS = lateMinutes * 60 * 1000;

        let upcomingRow: any = null;
        let recentRow: any = null;

        for (const row of allRosterRows) {
          const iv = shiftInterval(row.dutyDate, row.startTime, row.endTime, row.crossesMidnight);

          // Trường hợp 1: Chuẩn bị nhận ca (đến sớm trong vòng 60 phút)
          if (now >= iv.start - EARLY_BUFFER_MS && now < iv.start) {
            upcomingRow = { row, iv };
            break;
          }

          // Trường hợp 2: Ca trực vừa hết giờ nhưng còn trong 30 phút giao ca
          if (now >= iv.end && now <= iv.end + GRACE_BUFFER_MS) {
            recentRow = { row, iv };
          }

          // Trường hợp 3: Ca trực tiếp theo trong ngày (chưa tới giờ)
          if (now < iv.start) {
            if (!upcomingRow || iv.start < upcomingRow.iv.start) {
              upcomingRow = { row, iv };
            }
          }
        }

        const selected = upcomingRow || recentRow;
        if (selected) {
          currentScheduled = {
            dutyDate: selected.row.dutyDate,
            roomCode: selected.row.roomCode,
            roomName: selected.row.roomName,
            shiftCode: selected.row.shiftCode,
            shiftName: selected.row.shiftName,
            startTime: selected.row.startTime,
            endTime: selected.row.endTime,
            fullName: selected.row.fullName,
            title: selected.row.title,
            username: selected.row.username,
          };
        } else {
          // TẤT CẢ các ca trực trong ngày đã kết thúc hoàn toàn (ngoài giờ làm việc)
          currentScheduled = null;
        }
      }
    } catch (e: any) {
      console.warn('[KioskService] Lỗi tra cứu lịch trực:', e?.message || e);
    }

    const qrExpiresSec = await this.getQrExpiresSeconds();

    // 3. Kiểm tra trạng thái mở khoá ca trực của phòng khám
    const activeUnlock = this.activeRoomUnlocks.get(code);
    let isUnlocked = false;
    let unlockedDoctor = null;
    let shiftEndMs: number | null = null;

    if (activeUnlock) {
      if (now > activeUnlock.shiftEndMs) {
        // Đã quá hạn ca trực + ân hạn -> Tự động xoá và khoá lại
        this.activeRoomUnlocks.delete(code);
        this.broadcastToRoom(code, 'LOCK_EVENT', {
          type: 'AUTO_LOCK_SHIFT_EXPIRED',
          roomCode: code,
          reason: 'Ca trực đã kết thúc và quá thời gian ân hạn.',
          timestamp: new Date().toISOString(),
        });
      } else {
        isUnlocked = true;
        unlockedDoctor = activeUnlock.doctor;
        shiftEndMs = activeUnlock.shiftEndMs;
      }
    }

    // 4. Tạo hoặc lấy phiên QR còn hạn của đúng máy trạm (terminalId) này
    let activeSession = Array.from(this.sessions.values()).find(
      (s) =>
        s.roomCode === code &&
        (!tid || s.terminalId === tid) &&
        s.status === 'WAITING' &&
        s.expiresAt > Date.now(),
    );

    if (!activeSession) {
      activeSession = this.createQrSession(code, room.name, tid, clientOrigin, hostHeader, protocol, qrExpiresSec);
    }

    const remainingSec = Math.max(0, Math.round((activeSession.expiresAt - Date.now()) / 1000));

    return {
      room: { code: room.code, name: room.name },
      isUnlocked,
      activeDoctor: unlockedDoctor,
      shiftEndMs,
      currentScheduled,
      serverTime: Date.now(),
      qrSession: {
        sessionId: activeSession.sessionId,
        qrUrl: activeSession.qrUrl,
        expiresInSeconds: remainingSec,
        totalExpiresSeconds: qrExpiresSec,
        challengeSequence: activeSession.challengeSequence,
      },
    };
  }

  createQrSession(
    roomCode: string,
    roomName: string,
    terminalId?: string,
    clientOrigin?: string,
    hostHeader?: string,
    protocol: string = 'http',
    expiresInSeconds: number = 90,
  ): KioskSession {
    const code = roomCode.toUpperCase().trim();
    const tid = terminalId?.trim() || '';
    const sessionId = crypto.randomUUID();

    // Xác định URL cơ sở công khai (Tránh địa chỉ nội bộ container Docker như api:4000)
    let baseUrl = '';
    if (clientOrigin && clientOrigin.startsWith('http')) {
      baseUrl = clientOrigin.replace(/\/+$/, '');
    } else {
      let host = hostHeader || process.env.PUBLIC_URL || 'localhost:3000';
      if (host.includes('api:') || host === 'api' || host.endsWith(':4000')) {
        const publicUrl = process.env.PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL;
        if (publicUrl) {
          baseUrl = publicUrl.replace(/\/+$/, '');
        } else {
          host = host.replace(/api:4000/g, 'localhost:3000').replace(/:4000$/, ':3000');
          baseUrl = `${protocol}://${host}`;
        }
      } else {
        baseUrl = `${protocol}://${host}`;
      }
    }

    const qrUrl = `${baseUrl}/scan/${sessionId}`;

    const challengeSequence = ['PASSIVE_LIVENESS'];
    const flashColorSequence = ['#0284c7', '#16a34a', '#dc2626'];
    const ttlSeconds = Math.max(10, Math.min(600, expiresInSeconds || 90));

    const session: KioskSession = {
      sessionId,
      roomCode: code,
      roomName,
      terminalId: tid,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttlSeconds * 1000,
      qrUrl,
      challengeSequence,
      flashColorSequence,
      status: 'WAITING',
    };

    // Dọn các phiên WAITING cũ của đúng terminal này
    if (tid) {
      for (const [sId, s] of this.sessions.entries()) {
        if (s.terminalId === tid && s.status === 'WAITING') {
          this.sessions.delete(sId);
        }
      }
    }

    this.sessions.set(sessionId, session);
    return session;
  }

  getSession(sessionId: string): KioskSession | null {
    const s = this.sessions.get(sessionId);
    if (!s) return null;
    if (Date.now() > s.expiresAt) {
      s.status = 'EXPIRED';
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
          inArray(dutyPeriods.status, ['CONG_BO', 'DA_CHOT']),
          or(
            eq(dutyRooms.code, code),
            eq(dutyRooms.code, roomCode.trim()),
            sql`lower(${dutyRooms.code}) = lower(${code})`,
            sql`lower(${dutyRooms.name}) = lower(${code})`,
            ilike(dutyRooms.name, `%${code}%`),
          ),
          eq(dutyRooms.active, true),
          eq(users.active, true),
        ),
      )
      .orderBy(asc(dutyShiftTypes.startTime));
  }

  async loadTodayRoster(roomCode: string, dutyDate: string) {
    return this.loadActiveRoster(roomCode, [dutyDate]);
  }

  // --- 2. GỌI MÁY CHỦ AI (VPS 2) & SO KHỚP SINH TRẮC HỌC ---

  async extractEmbeddingFromAi(imageBase64: string): Promise<number[]> {
    let errorDetail = '';
    try {
      const resp = await fetch(`${this.aiServiceUrl}/api/ai/extract-embedding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: imageBase64 }),
      });
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
      console.warn(`[KioskService] Không gọi được AI Engine (${this.aiServiceUrl}):`, err?.message);
    }
    if (errorDetail) {
      throw new BadRequestException(errorDetail);
    }
    throw new BadRequestException('Máy chủ AI không thể trích xuất vector khuôn mặt. Vui lòng thử lại.');
  }

  async verifyLivenessWithAi(imageBase64: string, challenges: string[]): Promise<{ isLive: boolean; reason?: string }> {
    try {
      const resp = await fetch(`${this.aiServiceUrl}/api/ai/liveness-pad`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      return { isLive: false, reason: errJson?.detail || 'Không thể thẩm định người thật' };
    } catch (err: any) {
      console.warn(`[KioskService] Lỗi gọi Liveness AI (${this.aiServiceUrl}):`, err?.message);
      throw new BadRequestException(`Không thể kết nối đến máy chủ AI thẩm định người thật (${this.aiServiceUrl}). Vui lòng kiểm tra lại dịch vụ.`);
    }
  }

  // --- 3. XÁC THỰC MỞ KHOÁ TOÀN DIỆN: AI + CSDL LỊCH TRỰC QLBV ---

  async verifyFaceAndUnlock(params: {
    sessionId: string;
    snapshotBase64: string;
    completedChallenges?: string[];
    deviceInfo?: string;
  }) {
    const { sessionId, snapshotBase64, completedChallenges, deviceInfo } = params;

    const session = this.getSession(sessionId);
    if (!session || session.status !== 'WAITING') {
      throw new BadRequestException('Phiên quét QR không hợp lệ hoặc đã hết hạn. Vui lòng quét lại trên màn hình phòng khám.');
    }

    // 1. Gọi AI Engine kiểm tra người thật ISO 30107 PAD (Passive Liveness)
    const challenges = completedChallenges || ['PASSIVE_LIVENESS'];
    const liveness = await this.verifyLivenessWithAi(snapshotBase64, challenges);
    if (!liveness.isLive) {
      throw new BadRequestException(`AI từ chối: Phát hiện hình ảnh giả mạo (${liveness.reason}).`);
    }

    // 2. Gọi AI Engine trích xuất vector embedding
    const probeVector = await this.extractEmbeddingFromAi(snapshotBase64);

    // 3. Tải toàn bộ vector bác sĩ trong CSDL Postgres (bảng user_biometrics)
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
      throw new BadRequestException('Hệ thống chưa có hồ sơ khuôn mặt nào được đăng ký. Vui lòng liên hệ KHTH/IT.');
    }

    // So khớp Cosine Similarity
    let bestMatch: any = null;
    let maxCosine = -1;

    for (const bio of allBiometrics) {
      const enrolledVector = this.decryptDescriptor(bio.faceDescriptor);
      if (!enrolledVector) continue;

      const cosine = this.calculateCosineSimilarity(probeVector, enrolledVector);
      if (cosine > maxCosine) {
        maxCosine = cosine;
        bestMatch = bio;
      }
    }

    if (!bestMatch || maxCosine < 0.50) {
      throw new ForbiddenException(
        `Khuôn mặt không khớp với hồ sơ Bác sĩ nào trong CSDL bệnh viện (Độ tương đồng: ${(Math.max(0, maxCosine) * 100).toFixed(1)}%).`,
      );
    }

    // 4. KIỂM TRA LỊCH TRỰC CỦA BÁC SĨ TẠI PHÒNG KHÁM
    const now = Date.now();
    const candidateDates = candidateDutyDates(now);
    const allRosterRows = await this.loadActiveRoster(session.roomCode, candidateDates);
    const doctorSlots = allRosterRows.filter((s) => s.userId === bestMatch.userId);

    if (doctorSlots.length === 0) {
      throw new ForbiddenException(
        `Bác sĩ ${bestMatch.title} ${bestMatch.fullName} nhận diện thành công (${(maxCosine * 100).toFixed(1)}%), nhưng KHÔNG CÓ LỊCH TRỰC hôm nay tại ${session.roomName}!`,
      );
    }

    const earlyMinutes = await this.getEarlyCheckinMinutes();
    const lateMinutes = await this.getLateCheckoutMinutes();
    const EARLY_CHECKIN_MS = earlyMinutes * 60 * 1000;
    const LATE_CHECKOUT_MS = lateMinutes * 60 * 1000;

    let matchedSlot: any = null;
    let closestSlot: any = null;
    let minDiff = Infinity;

    for (const slot of doctorSlots) {
      const iv = shiftInterval(slot.dutyDate, slot.startTime, slot.endTime, slot.crossesMidnight);

      // Nếu thời điểm hiện tại nằm trong khung giờ: từ (giờ bắt đầu - earlyMinutes) đến (giờ kết thúc + lateMinutes)
      if (now >= iv.start - EARLY_CHECKIN_MS && now <= iv.end + LATE_CHECKOUT_MS) {
        matchedSlot = { slot, iv };
        break;
      }

      const diff = now < iv.start ? iv.start - now : now - iv.end;
      if (diff < minDiff) {
        minDiff = diff;
        closestSlot = { slot, iv };
      }
    }

    if (!matchedSlot) {
      const closest = closestSlot?.slot;
      const iv = closestSlot?.iv;
      if (closest && iv && now > iv.end + LATE_CHECKOUT_MS) {
        throw new ForbiddenException(
          `Ca trực của Bác sĩ ${bestMatch.title} ${bestMatch.fullName} tại ${session.roomName} (${closest.shiftName}: ${closest.startTime} – ${closest.endTime}) đã kết thúc lúc ${closest.endTime}. Đã quá thời gian ân hạn (${lateMinutes} phút).`,
        );
      } else if (closest && iv) {
        throw new ForbiddenException(
          `Ca trực của Bác sĩ ${bestMatch.title} ${bestMatch.fullName} tại ${session.roomName} (${closest.shiftName}: ${closest.startTime} – ${closest.endTime}) chưa đến giờ bắt đầu. Vui lòng quay lại trước giờ ca trực tối đa ${earlyMinutes} phút.`,
        );
      } else {
        throw new ForbiddenException(
          `Hiện tại không trong giờ ca trực của Bác sĩ ${bestMatch.title} ${bestMatch.fullName} tại ${session.roomName}.`,
        );
      }
    }

    const currentShift = matchedSlot.slot;

    // 5. Ghi nhận điểm danh vào bảng duty_attendance trong CSDL Postgres
    const attendanceId = crypto.randomUUID();
    await this.db.db.insert(dutyAttendance).values({
      id: attendanceId,
      roomCode: session.roomCode,
      roomName: session.roomName,
      userId: bestMatch.userId,
      username: bestMatch.username,
      fullName: bestMatch.fullName,
      title: bestMatch.title,
      shiftCode: currentShift.shiftCode || 'CA_TRUC',
      shiftName: currentShift.shiftName || 'Ca làm việc',
      status: 'ON_TIME',
      confidenceScore: maxCosine,
      method: 'AI_FACIAL_BIOMETRICS',
      deviceInfo: deviceInfo || 'Mobile Web Camera',
    });

    // 6. Cập nhật phiên & BẮN SỰ KIỆN SSE MỞ KHOÁ ĐÍCH DANH DUY NHẤT MÁY TRẠM PHÒNG KHÁM (UNICAST)
    session.status = 'VERIFIED';
    session.verifiedDoctor = {
      userId: bestMatch.userId,
      username: bestMatch.username,
      fullName: bestMatch.fullName,
      title: bestMatch.title,
      shiftName: currentShift.shiftName || 'Ca làm việc',
    };

    // Tính toán mốc thời gian hết ca + thời gian ân hạn sau ca trực
    const iv = matchedSlot.iv;
    const shiftEndMs = iv.end + lateMinutes * 60 * 1000;

    // Lưu vào danh sách phòng khám đang mở khoá để tự động khoá khi hết ca
    this.activeRoomUnlocks.set(session.roomCode, {
      roomCode: session.roomCode,
      doctor: session.verifiedDoctor,
      shift: currentShift,
      unlockedAt: now,
      shiftEndMs,
      terminalId: session.terminalId,
      attendanceId,
    });

    const unlockPayload = {
      type: 'UNLOCK_SUCCESS',
      doctor: session.verifiedDoctor,
      roomCode: session.roomCode,
      terminalId: session.terminalId,
      attendanceId,
      shiftEndMs,
      lateCheckoutMinutes: lateMinutes,
    };

    // Bắn đích danh máy tính phòng khám đã sinh mã QR này (Unicast)
    let unlocked = false;
    if (session.terminalId) {
      unlocked = this.sendToTerminal(session.terminalId, 'UNLOCK_EVENT', unlockPayload);
    }
    // Dự phòng broadcast nếu máy trạm chưa kịp gán terminalId
    if (!unlocked) {
      this.broadcastToRoom(session.roomCode, 'UNLOCK_EVENT', unlockPayload);
    }

    return {
      success: true,
      message: `Điểm danh thành công! Máy tính phòng khám ${session.roomName} đã được mở khoá.`,
      similarity: maxCosine,
      doctor: session.verifiedDoctor,
    };
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
    if (!user) throw new NotFoundException(`Không tìm thấy người dùng với ID ${userId}`);

    // LỚP 1: KIỂM TRA PHÂN QUYỀN ĐĂNG KÝ / CẬP NHẬT
    const isAdmin =
      currentUser?.isSuperAdmin ||
      currentUser?.roles?.includes('SUPER_ADMIN') ||
      currentUser?.roles?.includes('ADMIN') ||
      currentUser?.permissions?.includes('user.manage') ||
      currentUser?.permissions?.includes('kiosk.admin');

    const isSelf = currentUser ? currentUser.id === userId : false;

    if (!isAdmin && !isSelf) {
      throw new ForbiddenException('Bạn không có quyền đăng ký hoặc thay đổi sinh trắc học cho nhân sự khác!');
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
            'Hồ sơ khuôn mặt của bạn đã được khoá an ninh điểm danh. Để phòng ngừa gian lận ca trực, việc cấp đổi khuôn mặt chỉ được thực hiện tại Phòng Tổ chức Cán bộ hoặc Phòng CNTT!',
          );
        }
      } else {
        const allowSelfEnroll = await this.getAllowSelfEnroll();
        if (!allowSelfEnroll) {
          throw new ForbiddenException(
            'Quy định bệnh viện yêu cầu đăng ký sinh trắc học trực tiếp tại Phòng Tổ chức Cán bộ hoặc Phòng CNTT. Vui lòng liên hệ quản trị viên!',
          );
        }
      }

      // LỚP 3: SHIFT LOCK — Khóa cứng nếu nhân viên đang có lịch trực hôm nay
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
            inArray(dutyPeriods.status, ['CONG_BO', 'DA_CHOT']),
          ),
        )
        .limit(1);

      if (activeDuty.length > 0) {
        throw new ForbiddenException(
          `Bác sĩ ${user.title || ''} ${user.fullName} đang có lịch trực trong ngày. Để bảo đảm tính minh bạch, hệ thống không cho phép thay đổi dữ liệu sinh trắc học khi đang trong ca trực!`,
        );
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
          `CẢNH BÁO AN NINH: Khuôn mặt đăng ký trùng khớp (${(sim * 100).toFixed(1)}%) với nhân sự khác trong bệnh viện: ${bio.title ? `${bio.title} ` : ''}${bio.fullName} (@${bio.username}${bio.departmentName ? ` - ${bio.departmentName}` : ''})! Quy định bệnh viện nghiêm cấm đăng ký khuôn mặt của người khác để phòng ngừa gian lận điểm danh.`,
        );
      }
    }

    // 2. Lưu ảnh đại diện vào thư mục uploads/faces/
    let b64 = imageBase64;
    if (b64.includes(',')) b64 = b64.split(',')[1];
    const filename = `user_${userId}_avatar.jpg`;
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
    const filePath = path.join(this.uploadDir, filename);
    fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));

    const avatarDataUrl = imageBase64.startsWith('data:image')
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
      action: isNew ? 'BIOMETRIC_ENROLL' : 'BIOMETRIC_UPDATE',
      module: 'KIOSK',
      entity: 'user_biometrics',
      entityId: String(userId),
      description: `${currentUser?.fullName || 'Người dùng'} đã ${isNew ? 'đăng ký mới' : 'cập nhật'} sinh trắc học khuôn mặt cho ${user.title || ''} ${user.fullName} (@${user.username})`,
      beforeData: isEnrolled ? { avatarPath: existingBio?.avatarPath, enrolledAt: existingBio?.enrolledAt } : null,
      afterData: { avatarPath: `/uploads/faces/${filename}`, updatedAt: new Date().toISOString() },
      ip: clientMeta?.ip,
      userAgent: clientMeta?.userAgent,
      departmentId: currentUser?.departmentId ?? user.departmentId,
    });

    return {
      success: true,
      message: `Đã lưu hồ sơ sinh trắc học thành công cho ${user.title ? `${user.title} ` : ''}${user.fullName}`,
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

    const isAdmin =
      requestingUser?.isSuperAdmin ||
      requestingUser?.roles?.includes('SUPER_ADMIN') ||
      requestingUser?.roles?.includes('ADMIN') ||
      requestingUser?.permissions?.includes('user.manage');

    const bio = list[0];
    if (!bio) {
      return {
        enrolled: false,
        avatarUrl: null,
        canSelfEnroll: isAdmin ? true : allowSelfEnroll,
        canSelfUpdate: false,
      };
    }

    return {
      enrolled: true,
      avatarUrl: `/api/kiosk/doctors/${userId}/avatar?t=${new Date(bio.updatedAt).getTime()}`,
      enrolledAt: bio.enrolledAt,
      updatedAt: bio.updatedAt,
      canSelfEnroll: false,
      canSelfUpdate: isAdmin ? true : allowSelfUpdate,
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
      if (b64.includes(',')) b64 = b64.split(',')[1];
      if (!b64) return false;

      if (!fs.existsSync(this.uploadDir)) {
        fs.mkdirSync(this.uploadDir, { recursive: true });
      }

      const filePath = path.join(this.uploadDir, `user_${userId}_avatar.jpg`);
      fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));
      this.logger.log(`Đã tự động khôi phục ảnh chân dung ra đĩa cho bác sĩ userId=${userId}`);
      return true;
    } catch (err) {
      this.logger.warn(`Lỗi phục hồi ảnh sinh trắc học từ CSDL cho userId=${userId}: ${err}`);
      return false;
    }
  }

  // --- TIỆN ÍCH MÃ HOÁ VÀ TÍNH ĐỘ TƯƠNG ĐỒNG VECTOR ---

  private encryptDescriptor(descriptor: number[]): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const text = JSON.stringify(descriptor);
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${enc}`;
  }

  private decryptDescriptor(encryptedStr: string): number[] | null {
    try {
      const parts = encryptedStr.split(':');
      if (parts.length !== 3) return null;
      const [ivHex, tagHex, dataHex] = parts;
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, Buffer.from(ivHex, 'hex'));
      decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
      let dec = decipher.update(dataHex, 'hex', 'utf8');
      dec += decipher.final('utf8');
      return JSON.parse(dec);
    } catch {
      return null;
    }
  }

  private calculateCosineSimilarity(v1: number[], v2: number[]): number {
    if (v1.length !== v2.length) return 0;
    let dot = 0, n1 = 0, n2 = 0;
    for (let i = 0; i < v1.length; i++) {
      dot += v1[i] * v2[i];
      n1 += v1[i] * v1[i];
      n2 += v2[i] * v2[i];
    }
    if (n1 === 0 || n2 === 0) return 0;
    return dot / (Math.sqrt(n1) * Math.sqrt(n2));
  }
}
