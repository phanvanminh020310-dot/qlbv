import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Header,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Response } from "express";
import * as fs from "fs";
import * as path from "path";
import { ClientInfo, CurrentUser, Public } from "../../common/decorators";
import type {
  AccessContext,
  ClientMeta,
} from "../../common/types/access-context";
import { KioskService } from "./kiosk.service";

@ApiTags("Kiosk · Điểm danh Sinh trắc học & Mở khoá Phòng khám")
@Controller("kiosk")
export class KioskController {
  constructor(private readonly service: KioskService) {}

  private validateTarget(roomCode: unknown, terminalId?: unknown) {
    if (
      typeof roomCode !== "string" ||
      !roomCode.trim() ||
      roomCode.length > 64 ||
      /[\r\n\0]/.test(roomCode) ||
      (terminalId !== undefined &&
        (typeof terminalId !== "string" ||
          terminalId.length > 128 ||
          !/^[A-Za-z0-9._:-]*$/.test(terminalId)))
    ) {
      throw new BadRequestException(
        "Thông tin phòng khám hoặc máy trạm không hợp lệ.",
      );
    }
  }

  @Public()
  @Get("time")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Lấy thời gian chuẩn của máy chủ bệnh viện" })
  async getServerTime() {
    return {
      serverTime: Date.now(),
      timeZone: "Asia/Bangkok",
    };
  }

  @Public()
  @Get("status")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Trạng thái Kiosk phòng khám & phiên mã QR động" })
  async getStatus(
    @Query("room") room: string,
    @Query("terminalId") terminalId: string,
    @Query("clientOrigin") clientOrigin: string,
    @Headers("x-forwarded-host") fwdHost: string,
    @Headers("host") host: string,
    @Headers("x-forwarded-proto") proto?: string,
  ) {
    this.validateTarget(room || "PK01", terminalId);
    const isHttps =
      proto === "https" ||
      (host && !host.includes(":") && !/^(\d+\.){3}\d+/.test(host));
    const protocol = isHttps ? "https" : "http";
    const effectiveHost = fwdHost && !fwdHost.includes("api:") ? fwdHost : host;
    return this.service.getKioskStatus(
      room || "PK01",
      terminalId,
      clientOrigin,
      effectiveHost,
      protocol,
    );
  }

  @Public()
  @Post("session/refresh")
  @ApiOperation({ summary: "Làm mới mã QR cho phòng khám" })
  async refreshSession(
    @Body()
    body: {
      roomCode: string;
      roomName?: string;
      terminalId?: string;
      clientOrigin?: string;
    },
    @Headers("x-forwarded-host") fwdHost: string,
    @Headers("host") host: string,
    @Headers("x-forwarded-proto") proto?: string,
  ) {
    this.validateTarget(body.roomCode || "PK01", body.terminalId);
    const isHttps =
      proto === "https" ||
      (host && !host.includes(":") && !/^(\d+\.){3}\d+/.test(host));
    const protocol = isHttps ? "https" : "http";
    const effectiveHost = fwdHost && !fwdHost.includes("api:") ? fwdHost : host;
    return this.service.refreshKioskSession(
      body.roomCode || "PK01",
      body.terminalId,
      body.clientOrigin,
      effectiveHost,
      protocol,
    );
  }

  @Public()
  @Get("session/:sessionId")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "Lấy thông tin phiên quét cho điện thoại Bác sĩ" })
  async getSessionInfo(
    @Param("sessionId") sessionId: string,
    @Headers("x-device-claim-token") claimToken?: string,
    @Headers("x-client-env") clientEnv?: string,
    @Req() req?: any,
  ) {
    const clientIp =
      (req?.headers?.["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req?.ip;
    const userAgent = req?.headers?.["user-agent"] as string;

    const result = await this.service.touchSessionScan(sessionId, {
      claimToken,
      clientIp,
      userAgent,
      clientEnv,
    });
    if (result.error) {
      throw new BadRequestException(result.error);
    }
    const session = result.session || this.service.getSession(sessionId);
    if (!session) {
      throw new BadRequestException(
        "Mã QR đã hết hạn hoặc phiên không tồn tại. Vui lòng quét lại trên màn hình phòng khám.",
      );
    }
    return {
      sessionId: session.sessionId,
      room: { code: session.roomCode, name: session.roomName },
      challengeSequence: session.challengeSequence,
      status: session.status,
      verifiedDoctor: session.verifiedDoctor,
      faceVerifyBufferSeconds: result.faceVerifyBufferSeconds || 60,
    };
  }

  @Public()
  @Get("events/:roomCode")
  @ApiOperation({
    summary:
      "Kênh thời gian thực Server-Sent Events (SSE) mở khoá máy tính phòng khám",
  })
  streamEvents(
    @Param("roomCode") roomCode: string,
    @Query("terminalId") terminalId: string,
    @Res() res: Response,
  ) {
    this.validateTarget(roomCode, terminalId);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    // Gửi sự kiện khởi tạo kết nối đích danh
    res.write(
      `event: CONNECTED\ndata: ${JSON.stringify({ roomCode, terminalId: terminalId || "default", connectedAt: new Date().toISOString() })}\n\n`,
    );

    // Giữ kết nối SSE bằng heartbeat 25 giây
    const heartbeat = setInterval(() => {
      try {
        res.write(`:heartbeat\n\n`);
      } catch {
        clearInterval(heartbeat);
      }
    }, 25000);

    res.on("close", () => clearInterval(heartbeat));
    this.service.registerSseClient(roomCode, terminalId, res);
  }

  @Public()
  @Post("verify-face")
  @ApiOperation({
    summary:
      "Xác thực khuôn mặt Bác sĩ qua điện thoại & Mở khoá PC theo lịch trực",
  })
  async verifyFace(
    @Body()
    body: {
      sessionId: string;
      snapshotBase64?: string;
      imageBase64?: string;
      completedChallenges?: string[];
      livenessChallenges?: string[];
      deviceInfo?: string;
      claimToken?: string;
      clientEnv?: string;
    },
    @Headers("x-device-claim-token") headerClaimToken?: string,
    @Headers("x-client-env") headerClientEnv?: string,
    @Req() req?: any,
  ) {
    const image = body.snapshotBase64 || body.imageBase64 || "";
    const challenges = body.completedChallenges ||
      body.livenessChallenges || ["PASSIVE_LIVENESS"];
    const claimToken = body.claimToken || headerClaimToken;
    const clientEnv = body.clientEnv || headerClientEnv;
    const userAgent = req?.headers?.["user-agent"] as string;

    return this.service.verifyFaceAndUnlock({
      sessionId: body.sessionId,
      snapshotBase64: image,
      completedChallenges: challenges,
      deviceInfo: body.deviceInfo,
      claimToken,
      clientEnv,
      userAgent,
    });
  }

  @Public()
  @Get("biometrics/status/:userId")
  @ApiOperation({
    summary: "Kiểm tra trạng thái đăng ký sinh trắc học của nhân viên",
  })
  async getBiometricStatus(
    @Param("userId") userId: string,
    @CurrentUser() user?: AccessContext,
  ) {
    return this.service.getBiometricStatus(parseInt(userId, 10), user);
  }

  @Public()
  @Post("override-pin")
  @ApiOperation({ summary: "Mở khoá khẩn cấp tại chỗ bằng mã PIN IT" })
  async overridePin(
    @Body()
    body: {
      roomCode: string;
      pin: string;
      terminalId?: string;
      reason?: string;
    },
    @Req() req: any,
  ) {
    this.validateTarget(body.roomCode, body.terminalId);
    if (
      typeof body.pin !== "string" ||
      body.pin.length > 128 ||
      (body.reason !== undefined &&
        (typeof body.reason !== "string" || body.reason.length > 300))
    ) {
      throw new BadRequestException("PIN hoặc lý do mở khoá không hợp lệ.");
    }
    return this.service.authorizeItOverride(
      body.roomCode,
      body.terminalId,
      body.pin,
      req.ip || "unknown",
      body.reason,
    );
  }

  @Get("global-release")
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Xem các phiên mở khẩn cấp toàn bộ Kiosk đang hiệu lực (ADMIN/SUPER_ADMIN)",
  })
  async getGlobalEmergencyReleaseStatus(
    @CurrentUser() user: AccessContext,
  ) {
    return this.service.getGlobalEmergencyReleaseStatus(user);
  }

  @Post("global-release")
  @ApiOperation({
    summary: "ADMIN mở khẩn cấp mọi Kiosk có ca trực hiện hành",
  })
  async activateGlobalEmergencyRelease(
    @Body() body: { reason?: unknown },
    @CurrentUser() user: AccessContext,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.service.activateGlobalEmergencyRelease(user, client, body?.reason);
  }

  @Public()
  @Post("lock")
  @ApiOperation({
    summary: "Khoá lại màn hình phòng khám khi Bác sĩ rời phòng",
  })
  async lockRoom(@Body() body: { roomCode: string }) {
    this.validateTarget(body.roomCode);
    this.service.lockRoom(body.roomCode);
    return { success: true, message: "Đã khoá phòng khám." };
  }

  @Post("enroll")
  @ApiOperation({
    summary: "Đăng ký khuôn mặt Bác sĩ (Kiểm soát quyền & rà soát trùng lặp)",
  })
  async enrollBiometrics(
    @Body() body: { userId: number; imageBase64: string },
    @CurrentUser() user: AccessContext,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.service.enrollUserBiometrics(
      body.userId,
      body.imageBase64,
      user,
      client,
    );
  }

  @Public()
  @Get("doctors/:userId/avatar")
  @ApiOperation({ summary: "Xem ảnh đại diện sinh trắc học đã lưu của Bác sĩ" })
  async getDoctorAvatar(
    @Param("userId") userIdParam: string,
    @Res() res: Response,
  ) {
    const userId = parseInt(userIdParam, 10);
    const filePath = path.resolve(
      process.cwd(),
      "uploads",
      "faces",
      `user_${userIdParam}_avatar.jpg`,
    );

    // 1. Nếu tệp ảnh đã có sẵn trên đĩa -> trả về ngay
    if (fs.existsSync(filePath)) {
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.sendFile(filePath);
    }

    // 2. Tự phục hồi từ CSDL nếu tệp trên đĩa bị mất (sau khi phục hồi từ sao lưu hoặc chuyển VPS)
    if (!Number.isNaN(userId)) {
      const restored = await this.service.restoreAvatarFromDb(userId);
      if (restored && fs.existsSync(filePath)) {
        res.setHeader("Content-Type", "image/jpeg");
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.sendFile(filePath);
      }
    }

    // 3. Fallback hình đại diện SVG generic
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 24 24" fill="none" stroke="#0f766e" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M6 20v-2a6 6 0 0 1 12 0v2"/></svg>`;
    res.setHeader("Content-Type", "image/svg+xml");
    return res.send(svg);
  }
}
