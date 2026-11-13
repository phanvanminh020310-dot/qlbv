import { Module } from '@nestjs/common';
import { ManagementPositionsController } from './management-positions.controller';
import { ManagementPositionsService } from './management-positions.service';

@Module({
  controllers: [ManagementPositionsController],
  providers: [ManagementPositionsService],
  exports: [ManagementPositionsService],
})
export class ManagementPositionsModule {}
