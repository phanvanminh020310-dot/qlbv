import { Module } from '@nestjs/common';
import { DutyAttendanceController } from './duty-attendance.controller';
import { DutyAttendanceService } from './duty-attendance.service';

@Module({ controllers: [DutyAttendanceController], providers: [DutyAttendanceService] })
export class DutyAttendanceModule {}
