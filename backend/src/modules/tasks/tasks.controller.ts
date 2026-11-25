import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Audit, ClientInfo, CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AccessContext, ClientMeta } from '../../common/types/access-context';
import { TaskProjectsService } from './task-projects.service';
import { TaskReportsService } from './task-reports.service';
import {
  ChecklistItemDto,
  CreateProjectDto,
  CreateTaskDto,
  ProjectMembersDto,
  TaskAttachmentsDto,
  TaskCommentDto,
  TaskIdsDto,
  TaskReportQueryDto,
  TaskTemplateDto,
  TaskWorklogDto,
  TransitionTaskDto,
  UpdateChecklistItemDto,
  UpdateProjectDto,
  UpdateTaskDto,
} from './tasks.dto';
import { TasksService, type TaskListQuery } from './tasks.service';

/**
 * Quản lý công việc: mọi tài khoản đăng nhập đều nhận/xử lý việc được giao cho mình;
 * giao việc cần `task.assign`, quản lý toàn khoa cần `task.manage`, báo cáo cần `task.report`.
 * Quyền chi tiết theo từng công việc (người giao/người duyệt/người thực hiện) kiểm tra trong service.
 */
@ApiTags('Quản lý công việc')
@ApiBearerAuth()
@Controller('tasks')
export class TasksController {
  constructor(
    private readonly service: TasksService,
    private readonly projects: TaskProjectsService,
    private readonly reports: TaskReportsService,
  ) {}

  /* ------------------------------------------------------------ Danh mục & tổng quan */

  @Get('meta')
  @ApiOperation({ summary: 'Danh mục trạng thái, ưu tiên, nhãn, quyền của người dùng hiện tại' })
  meta(@CurrentUser() user: AccessContext) {
    return this.service.meta(user);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Số liệu nhanh: việc của tôi, chờ nhận, chờ duyệt, quá hạn…' })
  summary(@CurrentUser() user: AccessContext) {
    return this.service.mySummary(user);
  }

  @Get('assignable-users')
  @ApiOperation({ summary: 'Danh sách nhân viên có thể giao việc (trong phạm vi khoa/phòng)' })
  assignableUsers(@CurrentUser() user: AccessContext, @Query() q: { q?: string; departmentId?: string; projectId?: string }) {
    return this.service.assignableUsers(user, q);
  }

  @Get('board')
  @ApiOperation({ summary: 'Dữ liệu bảng Kanban theo trạng thái' })
  board(@CurrentUser() user: AccessContext, @Query() q: TaskListQuery) {
    return this.service.board(user, q);
  }

  /* ------------------------------------------------------------------- Mẫu công việc */

  @Get('templates')
  @ApiOperation({ summary: 'Danh sách mẫu công việc' })
  templates(@CurrentUser() user: AccessContext) {
    return this.service.listTemplates(user);
  }

  @Post('templates')
  @RequirePermissions('task.assign')
  @Audit({ module: 'TASK', action: 'CREATE', entity: 'task_templates', description: 'Tạo mẫu công việc' })
  createTemplate(@CurrentUser() user: AccessContext, @Body() dto: TaskTemplateDto) {
    return this.service.saveTemplate(user, null, dto);
  }

  @Put('templates/:id')
  @RequirePermissions('task.assign')
  @Audit({ module: 'TASK', action: 'UPDATE', entity: 'task_templates', description: 'Cập nhật mẫu công việc' })
  updateTemplate(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number, @Body() dto: TaskTemplateDto) {
    return this.service.saveTemplate(user, id, dto);
  }

  @Delete('templates/:id')
  @RequirePermissions('task.assign')
  @Audit({ module: 'TASK', action: 'DELETE', entity: 'task_templates', description: 'Xoá mẫu công việc' })
  deleteTemplate(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number) {
    return this.service.deleteTemplate(user, id);
  }

  /* -------------------------------------------------------------------------- Dự án */

  @Get('projects')
  @ApiOperation({ summary: 'Danh sách dự án được xem' })
  listProjects(@CurrentUser() user: AccessContext, @Query() q: { q?: string; status?: string; archived?: string }) {
    return this.projects.list(user, q);
  }

  @Post('projects')
  @RequirePermissions('task.assign')
  @Audit({ module: 'TASK', action: 'CREATE', entity: 'task_projects', description: 'Tạo dự án' })
  createProject(@CurrentUser() user: AccessContext, @Body() dto: CreateProjectDto) {
    return this.projects.create(user, dto);
  }

  @Get('projects/:id')
  @ApiOperation({ summary: 'Chi tiết dự án: thành viên, ai làm việc gì, tiến độ, dòng thời gian' })
  projectDetail(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number) {
    return this.projects.detail(user, id);
  }

  @Put('projects/:id')
  @Audit({ module: 'TASK', action: 'UPDATE', entity: 'task_projects', description: 'Cập nhật dự án' })
  updateProject(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProjectDto) {
    return this.projects.update(user, id, dto);
  }

  @Put('projects/:id/members')
  @Audit({ module: 'TASK', action: 'UPDATE', entity: 'task_project_members', description: 'Cập nhật thành viên dự án' })
  projectMembers(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number, @Body() dto: ProjectMembersDto) {
    return this.projects.setMembers(user, id, dto.members);
  }

  @Delete('projects/:id')
  @Audit({ module: 'TASK', action: 'DELETE', entity: 'task_projects', description: 'Xoá dự án' })
  deleteProject(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number) {
    return this.projects.remove(user, id);
  }

  /* ------------------------------------------------------------------------- Báo cáo */

  @Get('reports/overview')
  @RequirePermissions('task.report')
  @ApiOperation({ summary: 'Báo cáo tổng quan: chỉ tiêu, trạng thái, ưu tiên, khoa/phòng, xu hướng' })
  reportOverview(@CurrentUser() user: AccessContext, @Query() q: TaskReportQueryDto) {
    return this.reports.overview(user, q);
  }

  @Get('reports/performance')
  @RequirePermissions('task.report')
  @ApiOperation({ summary: 'Hiệu suất theo nhân viên, khoa/phòng, dự án' })
  reportPerformance(@CurrentUser() user: AccessContext, @Query() q: TaskReportQueryDto) {
    return this.reports.performance(user, q);
  }

  @Get('reports/export')
  @RequirePermissions(['task.report', 'task.export'])
  @Audit({ module: 'TASK', action: 'EXPORT', entity: 'tasks', description: 'Xuất báo cáo công việc' })
  async reportExport(@CurrentUser() user: AccessContext, @Query() q: TaskReportQueryDto) {
    const { buffer, fileName, mime } = await this.reports.export(user, q);
    return new StreamableFile(buffer, {
      type: mime,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      length: buffer.length,
    });
  }

  /* ---------------------------------------------------------------------- Công việc */

  @Get()
  @ApiOperation({ summary: 'Danh sách công việc (lọc theo góc nhìn, trạng thái, hạn, dự án…)' })
  list(@CurrentUser() user: AccessContext, @Query() q: TaskListQuery) {
    return this.service.list(user, q);
  }

  @Post()
  @Audit({ module: 'TASK', action: 'CREATE', entity: 'tasks', description: 'Tạo/giao công việc' })
  create(@CurrentUser() user: AccessContext, @Body() dto: CreateTaskDto, @ClientInfo() client: ClientMeta) {
    return this.service.create(user, dto, client);
  }

  @Get(':id')
  detail(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number) {
    return this.service.detail(user, id);
  }

  @Put(':id')
  @Audit({ module: 'TASK', action: 'UPDATE', entity: 'tasks', description: 'Cập nhật công việc' })
  update(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTaskDto, @ClientInfo() client: ClientMeta) {
    return this.service.update(user, id, dto, client);
  }

  @Delete(':id')
  @Audit({ module: 'TASK', action: 'DELETE', entity: 'tasks', description: 'Xoá công việc' })
  remove(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number, @ClientInfo() client: ClientMeta) {
    return this.service.remove(user, id, client);
  }

  @Post(':id/transition')
  @Audit({ module: 'TASK', action: 'TRANSITION', entity: 'tasks', description: 'Chuyển trạng thái công việc' })
  @ApiOperation({ summary: 'Nhận / từ chối / bắt đầu / tạm hoãn / gửi duyệt / duyệt / trả lại / hủy / mở lại' })
  transition(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number, @Body() dto: TransitionTaskDto, @ClientInfo() client: ClientMeta) {
    return this.service.transition(user, id, dto, client);
  }

  @Get(':id/history')
  history(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number) {
    return this.service.history(user, id);
  }

  @Get(':id/comments')
  comments(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number) {
    return this.service.listComments(user, id);
  }

  @Post(':id/comments')
  addComment(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number, @Body() dto: TaskCommentDto, @ClientInfo() client: ClientMeta) {
    return this.service.addComment(user, id, dto, client);
  }

  @Delete(':id/comments/:commentId')
  deleteComment(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number, @Param('commentId', ParseIntPipe) commentId: number, @ClientInfo() client: ClientMeta) {
    return this.service.deleteComment(user, id, commentId, client);
  }

  @Post(':id/attachments')
  @Audit({ module: 'TASK', action: 'ATTACHMENT', entity: 'tasks', description: 'Đính kèm tệp công việc' })
  upload(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number, @Body() dto: TaskAttachmentsDto, @ClientInfo() client: ClientMeta) {
    return this.service.uploadAttachments(user, id, dto.files, client);
  }

  @Get(':id/attachments/:attachmentId')
  @ApiOperation({ summary: 'Xem/tải tệp đính kèm (kiểm tra quyền xem công việc)' })
  async download(
    @CurrentUser() user: AccessContext,
    @Param('id', ParseIntPipe) id: number,
    @Param('attachmentId', ParseIntPipe) attachmentId: number,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { row, absPath } = await this.service.readAttachment(user, id, attachmentId);
    res.set({
      'Content-Type': row.mimeType,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(row.fileName)}`,
      'Cache-Control': 'private, max-age=60',
      'X-Content-Type-Options': 'nosniff',
    });
    const { createReadStream } = await import('node:fs');
    return new StreamableFile(createReadStream(absPath));
  }

  @Delete(':id/attachments/:attachmentId')
  @Audit({ module: 'TASK', action: 'ATTACHMENT_DELETE', entity: 'tasks', description: 'Xoá tệp đính kèm công việc' })
  deleteAttachment(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number, @Param('attachmentId', ParseIntPipe) attachmentId: number, @ClientInfo() client: ClientMeta) {
    return this.service.deleteAttachment(user, id, attachmentId, client);
  }

  @Get(':id/worklogs')
  worklogs(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number) {
    return this.service.listWorklogs(user, id);
  }

  @Post(':id/worklogs')
  addWorklog(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number, @Body() dto: TaskWorklogDto, @ClientInfo() client: ClientMeta) {
    return this.service.addWorklog(user, id, dto, client);
  }

  @Delete(':id/worklogs/:worklogId')
  deleteWorklog(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number, @Param('worklogId', ParseIntPipe) worklogId: number, @ClientInfo() client: ClientMeta) {
    return this.service.deleteWorklog(user, id, worklogId, client);
  }

  @Post(':id/checklist')
  addChecklist(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number, @Body() dto: ChecklistItemDto, @ClientInfo() client: ClientMeta) {
    return this.service.addChecklist(user, id, dto, client);
  }

  @Patch(':id/checklist/:itemId')
  updateChecklist(
    @CurrentUser() user: AccessContext,
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() dto: UpdateChecklistItemDto,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.service.updateChecklist(user, id, itemId, dto, client);
  }

  @Delete(':id/checklist/:itemId')
  deleteChecklist(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number, @Param('itemId', ParseIntPipe) itemId: number, @ClientInfo() client: ClientMeta) {
    return this.service.deleteChecklist(user, id, itemId, client);
  }

  @Put(':id/watchers')
  setWatchers(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number, @Body() dto: TaskIdsDto, @ClientInfo() client: ClientMeta) {
    return this.service.setWatchers(user, id, dto.ids, client);
  }

  @Post(':id/follow')
  follow(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number) {
    return this.service.follow(user, id, true);
  }

  @Delete(':id/follow')
  unfollow(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number) {
    return this.service.follow(user, id, false);
  }

  @Put(':id/dependencies')
  setDependencies(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number, @Body() dto: TaskIdsDto, @ClientInfo() client: ClientMeta) {
    return this.service.setDependencies(user, id, dto.ids, client);
  }
}
