import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  Audit,
  CurrentUser,
  RequirePermissions,
} from "../../common/decorators";
import type { AccessContext } from "../../common/types/access-context";
import { AbsenceReviewDto } from "./duty.dto";
import { DutyAbsenceService } from "./duty-absence.service";

@ApiTags("Lịch trực khám bệnh")
@ApiBearerAuth()
@Controller("duty/absence-requests")
export class DutyAbsenceController {
  constructor(private readonly service: DutyAbsenceService) {}

  @Get()
  @RequirePermissions("duty.view")
  list(@CurrentUser() user: AccessContext, @Query("box") box?: string) {
    return this.service.listRequests(user, box ?? "mine");
  }

  @Get(":id")
  @RequirePermissions("duty.view")
  detail(
    @CurrentUser() user: AccessContext,
    @Param("id", ParseIntPipe) id: number,
  ) {
    return this.service.detail(user, id);
  }

  @Post(":id/approve")
  @RequirePermissions(["duty.manage", "duty.manage-all"], "any")
  @Audit({
    module: "DUTY",
    action: "APPROVE",
    entity: "duty_absence_request",
    description: "Duyệt nghỉ/bận và thay đủ bác sĩ trong một giao dịch",
  })
  approve(
    @CurrentUser() user: AccessContext,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: AbsenceReviewDto,
  ) {
    return this.service.approve(user, id, dto ?? {});
  }

  @Post(":id/reject")
  @RequirePermissions(["duty.manage", "duty.manage-all"], "any")
  @Audit({
    module: "DUTY",
    action: "REJECT",
    entity: "duty_absence_request",
    description: "Từ chối nghỉ/bận, không thay đổi ca trực",
  })
  reject(
    @CurrentUser() user: AccessContext,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: AbsenceReviewDto,
  ) {
    return this.service.resolve(user, id, "TU_CHOI", dto?.note ?? "");
  }

  @Post(":id/cancel")
  @RequirePermissions(["duty.register", "duty.manage", "duty.manage-all"], "any")
  @Audit({
    module: "DUTY",
    action: "CANCEL",
    entity: "duty_absence_request",
    description: "Bác sĩ rút yêu cầu nghỉ/bận đang chờ",
  })
  cancel(
    @CurrentUser() user: AccessContext,
    @Param("id", ParseIntPipe) id: number,
  ) {
    return this.service.resolve(user, id, "HUY");
  }
}
