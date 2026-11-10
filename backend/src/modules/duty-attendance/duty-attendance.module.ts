import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { DutyAttendanceController } from './duty-attendance.controller';
import { DutyAttendanceService } from './duty-attendance.service';

@Module({ imports: [SettingsModule], controllers: [DutyAttendanceController], providers: [DutyAttendanceService] })
export class DutyAttendanceModule {}
