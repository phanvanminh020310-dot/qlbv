/**
 * Phân hệ Thiết kế bản in.
 * Chỉ phụ thuộc CSDL nên có thể dùng lại ở mọi phân hệ khác (HSBA, báo cáo, tiện ích).
 */
import { Module } from '@nestjs/common';
import { PrintingController } from './printing.controller';
import { PrintingService } from './printing.service';
import { PrintSqlService } from './print-sql-source';

@Module({
  controllers: [PrintingController],
  providers: [PrintingService, PrintSqlService],
  exports: [PrintingService, PrintSqlService],
})
export class PrintingModule {}
