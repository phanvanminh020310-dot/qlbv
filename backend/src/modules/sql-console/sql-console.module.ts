import { Module } from '@nestjs/common';
import { SqlConsoleController } from './sql-console.controller';
import { SqlConsoleService } from './sql-console.service';

@Module({
  controllers: [SqlConsoleController],
  providers: [SqlConsoleService],
})
export class SqlConsoleModule {}
