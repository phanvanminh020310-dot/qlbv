import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import * as ExcelJS from 'exceljs';
import { DbService } from '../../db/db.service';
import { departments, staffLearningRegistrations, users } from '../../db/schema';
import type { AccessContext } from '../../common/types/access-context';
import type { StaffLearningRegistrationDto, StaffLearningWeekQueryDto } from './staff-learning.dto';

const YMD = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
const WEEKDAY_NAMES = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];

const dateOf = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const addDays = (ymd: string, amount: number) => {
  const date = dateOf(ymd);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
};
const isCalendarDate = (ymd: string) => YMD.test(ymd) && dateOf(ymd).toISOString().slice(0, 10) === ymd;
const dateLabel = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;

@Injectable()
export class StaffLearningService {
  constructor(private readonly db: DbService) {}

  private hasPermission(user: AccessContext, permission: string) {
    return user.isSuperAdmin || user.permissions.includes(permission);
  }

  private assertPermission(user: AccessContext, permission: string) {
    if (!this.hasPermission(user, permission)) {
      throw new ForbiddenException(`Tài khoản không có quyền ${permission}`);
    }
  }

  /** Điều phối toàn viện hoặc vai trò phạm vi ALL xem tất cả khoa; còn lại chỉ xem khoa được gán. */
  private canSeeAll(user: AccessContext) {
    return user.isSuperAdmin || user.dataScope === 'ALL';
  }

  private assertWeekStart(weekStart: string) {
    if (!isCalendarDate(weekStart)) throw new BadRequestException('Ngày đầu tuần không hợp lệ');
    if (dateOf(weekStart).getUTCDay() !== 1) throw new BadRequestException('Vui lòng chọn Thứ 2 làm ngày đầu tuần');
  }

  /** Lịch học đủ bảy ngày trong tuần, từ Thứ 2 đến Chủ nhật. */
  private assertStudyDate(studyDate: string) {
    if (!isCalendarDate(studyDate)) throw new BadRequestException('Ngày học không hợp lệ');
  }

  private async visibleDepartments(user: AccessContext) {
    const conditions = [eq(departments.active, true), isNull(departments.deletedAt)];
    if (!this.canSeeAll(user)) {
      const ids = [...new Set([user.departmentId, ...(user.departmentIds ?? [])].filter((id): id is number => typeof id === 'number'))];
      if (!ids.length) return [];
      conditions.push(inArray(departments.id, ids));
    }
    return this.db.db
      .select({ id: departments.id, code: departments.code, name: departments.name, shortName: departments.shortName, hospital: departments.hospital, sortOrder: departments.sortOrder })
      .from(departments)
      .where(and(...conditions))
      .orderBy(asc(departments.sortOrder), asc(departments.name), asc(departments.id));
  }

  /** Phạm vi NHẬP của người được giao vai trò: luôn là khoa chính/các khoa gán rõ, không bị mở rộng bởi một vai trò ALL khác. */
  private async registrationDepartments(user: AccessContext) {
    const ids = [...new Set([user.departmentId, ...(user.departmentIds ?? [])].filter((id): id is number => typeof id === 'number'))];
    if (!ids.length) return [];
    return this.db.db
      .select({ id: departments.id, code: departments.code, name: departments.name, shortName: departments.shortName, hospital: departments.hospital, sortOrder: departments.sortOrder })
      .from(departments)
      .where(and(eq(departments.active, true), isNull(departments.deletedAt), inArray(departments.id, ids)))
      .orderBy(asc(departments.sortOrder), asc(departments.name), asc(departments.id));
  }

  private async activeStaffProfile(userId: number) {
    const [person] = await this.db.db
      .select({ id: users.id, departmentId: users.departmentId, active: users.active, deletedAt: users.deletedAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!person || person.deletedAt || !person.active) {
      throw new BadRequestException('Nhân viên không còn hoạt động hoặc không tồn tại');
    }
    if (!person.departmentId) throw new BadRequestException('Nhân viên chưa được gán khoa/phòng công tác');
    return { ...person, departmentId: person.departmentId };
  }

  /** Chỉ người có quyền nhập lịch mới được tác động và chỉ đối với nhân viên thuộc khoa được xem. */
  private async assertTargetInRegistrationScope(actor: AccessContext, targetUserId: number) {
    this.assertPermission(actor, 'staff-learning.register');
    const [target, editable] = await Promise.all([this.activeStaffProfile(targetUserId), this.registrationDepartments(actor)]);
    if (!editable.some((department) => department.id === target.departmentId)) {
      throw new ForbiddenException('Nhân viên không thuộc khoa/phòng trong phạm vi đăng ký lịch học của tài khoản');
    }
    return target;
  }

  private async staffInDepartments(departmentIds: number[]) {
    if (!departmentIds.length) return [];
    return this.db.db
      .select({
        userId: users.id,
        fullName: users.fullName,
        title: users.title,
        manv: users.manv,
        departmentId: departments.id,
        departmentName: departments.name,
        departmentShortName: departments.shortName,
      })
      .from(users)
      .innerJoin(departments, eq(departments.id, users.departmentId))
      .where(and(inArray(users.departmentId, departmentIds), eq(users.active, true), isNull(users.deletedAt)))
      .orderBy(asc(departments.sortOrder), asc(departments.name), asc(users.fullName), asc(users.id));
  }

  /** Bảng tuần có đủ 7 ngày; điều phối phạm vi ALL thấy toàn viện, khoa chỉ thấy khoa được gán. */
  async week(user: AccessContext, q: StaffLearningWeekQueryDto) {
    this.assertPermission(user, 'staff-learning.view');
    this.assertWeekStart(q.weekStart);
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = addDays(q.weekStart, index);
      return { date, weekday: WEEKDAY_NAMES[dateOf(date).getUTCDay()]!, label: `${WEEKDAY_NAMES[dateOf(date).getUTCDay()]}\n${dateLabel(date)}` };
    });
    const endDate = days[days.length - 1]!.date;
    const visible = await this.visibleDepartments(user);
    const departmentIds = visible.map((department) => department.id);
    const editable = this.hasPermission(user, 'staff-learning.register') ? await this.registrationDepartments(user) : [];
    const [registrations, staff] = await Promise.all([
      departmentIds.length
        ? this.db.db
          .select({
            departmentId: staffLearningRegistrations.departmentId,
            studyDate: staffLearningRegistrations.studyDate,
            userId: users.id,
            fullName: users.fullName,
            title: users.title,
            manv: users.manv,
          })
          .from(staffLearningRegistrations)
          .innerJoin(users, eq(users.id, staffLearningRegistrations.userId))
          .where(and(inArray(staffLearningRegistrations.departmentId, departmentIds), gte(staffLearningRegistrations.studyDate, q.weekStart), lte(staffLearningRegistrations.studyDate, endDate)))
        : Promise.resolve([]),
      this.staffInDepartments(editable.map((department) => department.id)),
    ]);
    const entries: Record<string, Array<{ userId: number; fullName: string; title: string; manv: string }>> = {};
    for (const registration of registrations) {
      const key = `${registration.departmentId}:${registration.studyDate}`;
      entries[key] = [...(entries[key] ?? []), { userId: registration.userId, fullName: registration.fullName, title: registration.title, manv: registration.manv }];
    }
    for (const people of Object.values(entries)) people.sort((left, right) => left.fullName.localeCompare(right.fullName, 'vi') || left.userId - right.userId);
    return {
      weekStart: q.weekStart,
      days,
      departments: visible.map(({ sortOrder: _sortOrder, hospital: _hospital, ...department }) => department),
      staff,
      entries,
      viewer: {
        userId: user.id,
        canRegister: this.hasPermission(user, 'staff-learning.register') && editable.length > 0,
        seesAllDepartments: this.canSeeAll(user),
      },
      summary: {
        registrations: registrations.length,
        people: new Set(registrations.map((registration) => registration.userId)).size,
        departments: visible.length,
        daysWithRegistration: new Set(registrations.map((registration) => registration.studyDate)).size,
      },
    };
  }

  /** Người được gán vai trò nhập lịch đăng ký cho nhân viên thuộc đúng khoa/phòng trong phạm vi của mình. */
  async register(user: AccessContext, dto: StaffLearningRegistrationDto) {
    this.assertStudyDate(dto.studyDate);
    const target = await this.assertTargetInRegistrationScope(user, dto.userId);
    const [created] = await this.db.db
      .insert(staffLearningRegistrations)
      .values({ departmentId: target.departmentId, userId: target.id, studyDate: dto.studyDate })
      .onConflictDoNothing()
      .returning({ id: staffLearningRegistrations.id });
    return { registered: true, alreadyRegistered: !created };
  }

  /** Gỡ đúng nhân viên/ngày, kiểm tra khoa từ ảnh chụp tại lúc đăng ký để giữ an toàn khi nhân sự chuyển khoa. */
  async remove(user: AccessContext, userId: number, studyDate: string) {
    this.assertPermission(user, 'staff-learning.register');
    this.assertStudyDate(studyDate);
    const [registration] = await this.db.db
      .select({ departmentId: staffLearningRegistrations.departmentId })
      .from(staffLearningRegistrations)
      .where(and(eq(staffLearningRegistrations.userId, userId), eq(staffLearningRegistrations.studyDate, studyDate)))
      .limit(1);
    if (!registration) return { removed: false };
    const editable = await this.registrationDepartments(user);
    if (!editable.some((department) => department.id === registration.departmentId)) {
      throw new ForbiddenException('Đăng ký lịch học không thuộc khoa/phòng trong phạm vi của tài khoản');
    }
    const [removed] = await this.db.db
      .delete(staffLearningRegistrations)
      .where(and(eq(staffLearningRegistrations.userId, userId), eq(staffLearningRegistrations.studyDate, studyDate)))
      .returning({ id: staffLearningRegistrations.id });
    return { removed: !!removed };
  }

  async exportExcel(user: AccessContext, q: StaffLearningWeekQueryDto) {
    this.assertPermission(user, 'staff-learning.export');
    const data = await this.week(user, q);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'QLBS — Lịch học cán bộ nhân viên';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Lịch học', { views: [{ showGridLines: true, state: 'frozen', ySplit: 4, xSplit: 2 }] });
    const lastColumn = 2 + data.days.length;
    const letter = String.fromCharCode(64 + lastColumn);
    sheet.mergeCells(`C1:${letter}1`);
    sheet.getCell('C1').value = 'LỊCH HỌC CỦA BÁC SĨ, ĐIỀU DƯỠNG, KỸ THUẬT Y...';
    sheet.getCell('C1').font = { bold: true, size: 14, name: 'Times New Roman' };
    sheet.getCell('C1').alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.mergeCells(`C2:${letter}2`);
    sheet.getCell('C2').value = `Tuần từ ${dateLabel(data.weekStart)} đến ${dateLabel(data.days[data.days.length - 1]!.date)}`;
    sheet.getCell('C2').font = { italic: true, size: 11, name: 'Times New Roman' };
    sheet.getCell('C2').alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.mergeCells('A3:A4'); sheet.mergeCells('B3:B4');
    sheet.getCell('A3').value = 'STT'; sheet.getCell('B3').value = 'Khoa / Đơn vị';
    data.days.forEach((day, index) => { sheet.mergeCells(3, index + 3, 4, index + 3); sheet.getCell(3, index + 3).value = `${day.weekday}\n${dateLabel(day.date)}`; });
    for (let row = 3; row <= 4; row += 1) {
      for (let column = 1; column <= lastColumn; column += 1) {
        const cell = sheet.getCell(row, column);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: row === 3 && column >= 3 ? 'C6E0B4' : 'E2F0D9' } };
        cell.font = { bold: true, name: 'Times New Roman', size: 11 };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      }
    }
    data.departments.forEach((department, index) => {
      const row = index + 5;
      sheet.getCell(row, 1).value = index + 1;
      sheet.getCell(row, 2).value = department.shortName || department.name;
      data.days.forEach((day, dayIndex) => {
        const people = data.entries[`${department.id}:${day.date}`] ?? [];
        sheet.getCell(row, dayIndex + 3).value = people.map((person) => person.fullName).join('\n');
      });
      for (let column = 1; column <= lastColumn; column += 1) {
        const cell = sheet.getCell(row, column);
        cell.font = { name: 'Times New Roman', size: 11 };
        cell.alignment = { vertical: 'top', horizontal: column <= 2 ? (column === 1 ? 'center' : 'left') : 'left', wrapText: true };
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      }
      sheet.getRow(row).height = Math.max(34, 17 * Math.max(1, ...data.days.map((day) => (data.entries[`${department.id}:${day.date}`] ?? []).length)));
    });
    sheet.getRow(1).height = 26; sheet.getRow(2).height = 21; sheet.getRow(3).height = 22; sheet.getRow(4).height = 36;
    sheet.getColumn(1).width = 8; sheet.getColumn(2).width = 30;
    for (let column = 3; column <= lastColumn; column += 1) sheet.getColumn(column).width = 31;
    sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.2, right: 0.2, top: 0.35, bottom: 0.35, header: 0.1, footer: 0.1 } };
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return { buffer, fileName: `LICH_HOC_CAN_BO_NHAN_VIEN_${data.weekStart}.xlsx` };
  }
}
