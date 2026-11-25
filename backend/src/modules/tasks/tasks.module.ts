import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { TaskProjectsService } from './task-projects.service';
import { TaskRemindersService } from './task-reminders.service';
import { TaskReportsService } from './task-reports.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [NotificationsModule, SettingsModule],
  controllers: [TasksController],
  providers: [TasksService, TaskProjectsService, TaskReportsService, TaskRemindersService],
  exports: [TasksService],
})
export class TasksModule {}
