import { Module } from '@nestjs/common';
import { BackupsController } from './backups.controller';
import { BackupsService } from './backups.service';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SchedulerModule, SettingsModule],
  controllers: [BackupsController],
  providers: [BackupsService],
})
export class BackupsModule {}
