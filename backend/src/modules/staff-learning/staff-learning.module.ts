import { Module } from '@nestjs/common';
import { StaffLearningController } from './staff-learning.controller';
import { StaffLearningService } from './staff-learning.service';

@Module({
  controllers: [StaffLearningController],
  providers: [StaffLearningService],
})
export class StaffLearningModule {}
