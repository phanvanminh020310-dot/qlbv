import { Body, Controller, Get, Headers, Param, Post, Query, Res, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { ClientInfo, CurrentUser, Public } from '../../common/decorators';
import type { AccessContext, ClientMeta } from '../../common/types/access-context';
import { KioskService } from './kiosk.service';

@ApiTags('Kiosk · Điểm danh Sinh trắc học & Mở khoá Phòng khám')
@Controller('kiosk')
export class KioskController {
  constructor(private readonly service: KioskService) {}

  @Public()
  @Get('time')
  @ApiOperation({ summary: 'Lấy thời gian chuẩn của máy chủ bệnh viện' })
  async getServerTime() {
    return {
      serverTime: Date.now(),
      timeZone: 'Asia/Bangkok',
    };
  }

  @Public()
  @Get('status')
  @ApiOperation({ summary: 'Trạng thái Kiosk phòng khám & phiên mã QR động' })
  async getStatus(
    @Query('room') room: string,
    @Query('terminalId') terminalId: string,
    @Query('clientOrigin') clientOrigin: string,
    @Headers('x-forwarded-host') fwdHost: string,
    @Headers('host') host: string,
    @Headers('x-forwarded-proto') proto?: string,
  ) {
    const isHttps = proto === 'https' || (host && !host.includes(':') && !/^(\d+\.){3}\d+/.test(host));
    const protocol = isHttps ? 'https' : 'http';
    const effectiveHost = (fwdHost && !fwdHost.includes('api:')) ? fwdHost : host;
    return this.service.getKioskStatus(room || 'PK01', terminalId, clientOrigin, effectiveHost, protocol);
  }

  @Public()
  @Post('session/refresh')
  @ApiOperation({ summary: 'Làm mới mã QR cho phòng khám' })
  async refreshSession(
    @Body() body: { roomCode: string; roomName?: string; terminalId?: string; clientOrigin?: string },
    @Headers('x-forwarded-host') fwdHost: string,
    @Headers('host') host: string,
    @Headers('x-forwarded-proto') proto?: string,
  ) {
    const isHttps = proto === 'https' || (host && !host.includes(':') && !/^(\d+\.){3}\d+/.test(host));
    const protocol = isHttps ? 'https' : 'http';
    const effectiveHost = (fwdHost && !fwdHost.includes('api:')) ? fwdHost : host;
    const qrExpiresSec = await this.service.getQrExpiresSeconds();
    const session = this.service.createQrSession(
      body.roomCode || 'PK01',
      body.roomName || `Phòng khám ${body.roomCode}`,
      body.terminalId,
      body.clientOrigin,
      effectiveHost,
      protocol,
      qrExpiresSec,
    );
    return {
      success: true,
      sessionId: session.sessionId,
      qrUrl: session.qrUrl,
      expiresInSeconds: qrExpiresSec,
      totalExpiresSeconds: qrExpiresSec,
      challengeSequence: session.challengeSequence,
      serverTime: Date.now(),
    };
  }

  @Public()
  @Get('session/:sessionId')
  @ApiOperation({ summary: 'Lấy thông tin phiên quét cho điện thoại Bác sĩ' })
  async getSessionInfo(@Param('sessionId') sessionId: string) {
    const session = this.service.getSession(sessionId);
    if (!session) {
      return {
        sessionId,
        room: { code: 'PK', name: 'Phòng khám' },
        status: 'WAITING',
      };
    }
    // Chú ý: Tuyệt đối không trả về handshakePin tại endpoint này
    // Bác sĩ bắt buộc phải nhìn lên màn hình máy tính phòng khám để nhập mã 4 số
    return {
      sessionId: session.sessionId,
      room: { code: session.roomCode, name: session.roomName },
      challengeSequence: session.challengeSequence,
      status: session.status,
    };
  }

  @Public()
  @Get('events/:roomCode')
  @ApiOperation({ summary: 'Kênh thời gian thực Server-Sent Events (SSE) mở khoá máy tính phòng khám' })
  streamEvents(
    @Param('roomCode') roomCode: string,
    @Query('terminalId') terminalId: string,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    // Gửi sự kiện khởi tạo kết nối đích danh
    res.write(
      `event: CONNECTED\ndata: ${JSON.stringify({ roomCode, terminalId: terminalId || 'default', connectedAt: new Date().toISOString() })}\n\n`,
    );

    // Giữ kết nối SSE bằng heartbeat 25 giây
    const heartbeat = setInterval(() => {
      try {
        res.write(`:heartbeat\n\n`);
      } catch {
        clearInterval(heartbeat);
      }
    }, 25000);

    res.on('close', () => clearInterval(heartbeat));
    this.service.registerSseClient(roomCode, terminalId, res);
  }

  @Public()
  @Post('verify-face')
  @ApiOperation({ summary: 'Xác thực khuôn mặt Bác sĩ qua điện thoại & Mở khoá PC theo lịch trực' })
  async verifyFace(
    @Body()
    body: {
      sessionId: string;
      snapshotBase64?: string;
      imageBase64?: string;
      completedChallenges?: string[];
      livenessChallenges?: string[];
      deviceInfo?: string;
    },
  ) {
    const image = body.snapshotBase64 || body.imageBase64 || '';
    const challenges = body.completedChallenges || body.livenessChallenges || ['PASSIVE_LIVENESS'];

    return this.service.verifyFaceAndUnlock({
      sessionId: body.sessionId,
      snapshotBase64: image,
      completedChallenges: challenges,
      deviceInfo: body.deviceInfo,
    });
  }

  @Public()
  @Get('biometrics/status/:userId')
  @ApiOperation({ summary: 'Kiểm tra trạng thái đăng ký sinh trắc học của nhân viên' })
  async getBiometricStatus(@Param('userId') userId: string, @CurrentUser() user?: AccessContext) {
    return this.service.getBiometricStatus(parseInt(userId, 10), user);
  }

  @Public()
  @Post('override-pin')
  @ApiOperation({ summary: 'Mở khoá khẩn cấp tại chỗ bằng mã PIN IT' })
  async overridePin(@Body() body: { roomCode: string; pin: string; terminalId?: string; reason?: string }) {
    const masterPin = await this.service.getItMasterPin();
    if (String(body.pin || '').trim() !== String(masterPin || '').trim()) {
      throw new UnauthorizedException('Mã PIN khẩn cấp IT không chính xác.');
    }

    const { itDoctor, shiftEndMs } = this.service.recordItOverrideUnlock(body.roomCode, body.terminalId);

    const payload = {
      type: 'UNLOCK_SUCCESS',
      doctor: itDoctor,
      roomCode: body.roomCode,
      terminalId: body.terminalId,
      shiftEndMs,
      method: 'IT_EMERGENCY_PIN',
    };

    let sent = false;
    if (body.terminalId) {
      sent = this.service.sendToTerminal(body.terminalId, 'UNLOCK_EVENT', payload);
    }
    if (!sent) {
      this.service.broadcastToRoom(body.roomCode, 'UNLOCK_EVENT', payload);
    }

    return { success: true, message: 'Đã mở khoá khẩn cấp phòng khám thành công.' };
  }

  @Public()
  @Post('lock')
  @ApiOperation({ summary: 'Khoá lại màn hình phòng khám khi Bác sĩ rời phòng' })
  async lockRoom(@Body() body: { roomCode: string }) {
    this.service.lockRoom(body.roomCode);
    return { success: true, message: 'Đã khoá phòng khám.' };
  }

  @Post('enroll')
  @ApiOperation({ summary: 'Đăng ký khuôn mặt Bác sĩ (Kiểm soát quyền & rà soát trùng lặp)' })
  async enrollBiometrics(
    @Body() body: { userId: number; imageBase64: string },
    @CurrentUser() user: AccessContext,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.service.enrollUserBiometrics(body.userId, body.imageBase64, user, client);
  }

  @Public()
  @Get('doctors/:userId/avatar')
  @ApiOperation({ summary: 'Xem ảnh đại diện sinh trắc học đã lưu của Bác sĩ' })
  getDoctorAvatar(@Param('userId') userId: string, @Res() res: Response) {
    const filePath = path.resolve(process.cwd(), 'uploads', 'faces', `user_${userId}_avatar.jpg`);
    if (fs.existsSync(filePath)) {
      res.setHeader('Content-Type', 'image/jpeg');
      return res.sendFile(filePath);
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 24 24" fill="none" stroke="#0f766e" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M6 20v-2a6 6 0 0 1 12 0v2"/></svg>`;
    res.setHeader('Content-Type', 'image/svg+xml');
    return res.send(svg);
  }
}
