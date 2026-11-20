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

  /** Điều phối toàn viện hoặc vai trò phạm vi ALL xem tất cả khoa; còn lại chỉ xem khoa được gán. */
  private canSeeAll(user: AccessContext) {
    return user.isSuperAdmin || user.dataScope === 'ALL' || user.permissions.includes('duty.manage-all');
  }

  private assertWeekStart(weekStart: string) {
    if (!isCalendarDate(weekStart)) throw new BadRequestException('Ngày đầu tuần không hợp lệ');
    if (dateOf(weekStart).getUTCDay() !== 1) throw new BadRequestException('Vui lòng chọn Thứ 2 làm ngày đầu tuần');
  }

  private assertStudyDate(studyDate: string) {
    if (!isCalendarDate(studyDate)) throw new BadRequestException('Ngày học không hợp lệ');
    const weekday = dateOf(studyDate).getUTCDay();
    if (weekday < 1 || weekday > 5) throw new BadRequestException('Lịch học tuần chỉ nhận ngày Thứ 2 đến Thứ 6');
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

  private async ownActiveProfile(userId: number) {
    const [person] = await this.db.db
      .select({ id: users.id, departmentId: users.departmentId, active: users.active, deletedAt: users.deletedAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!person || person.deletedAt || !person.active) throw new ForbiddenException('Tài khoản cán bộ không còn hoạt động để đăng ký lịch học');
    return person;
  }

  /** Bảng tuần có 5 cột ngày làm việc, nhóm người đăng ký theo khoa tại thời điểm đăng ký. */
  async week(user: AccessContext, q: StaffLearningWeekQueryDto) {
    this.assertWeekStart(q.weekStart);
    const days = Array.from({ length: 5 }, (_, index) => {
      const date = addDays(q.weekStart, index);
      return { date, weekday: WEEKDAY_NAMES[dateOf(date).getUTCDay()]!, label: `${WEEKDAY_NAMES[dateOf(date).getUTCDay()]}\n${dateLabel(date)}` };
    });
    const endDate = days[days.length - 1]!.date;
    const [visible, profile] = await Promise.all([this.visibleDepartments(user), this.ownActiveProfile(user.id)]);
    const departmentIds = visible.map((department) => department.id);
    const [registrations, ownRegistrations] = await Promise.all([
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
      // Cán bộ vẫn phải thấy/gỡ được đăng ký của chính mình nếu vừa chuyển khoa,
      // dù dòng lịch sử hiện thuộc đơn vị cũ ngoài phạm vi xem hiện tại.
      this.db.db
        .select({ studyDate: staffLearningRegistrations.studyDate })
        .from(staffLearningRegistrations)
        .where(and(eq(staffLearningRegistrations.userId, user.id), gte(staffLearningRegistrations.studyDate, q.weekStart), lte(staffLearningRegistrations.studyDate, endDate))),
    ]);
    const entries: Record<string, Array<{ userId: number; fullName: string; title: string; manv: string }>> = {};
    for (const registration of registrations) {
      const key = `${registration.departmentId}:${registration.studyDate}`;
      entries[key] = [...(entries[key] ?? []), { userId: registration.userId, fullName: registration.fullName, title: registration.title, manv: registration.manv }];
    }
    for (const people of Object.values(entries)) people.sort((left, right) => left.fullName.localeCompare(right.fullName, 'vi') || left.userId - right.userId);
    const myDates = ownRegistrations.map((registration) => registration.studyDate).sort();
    return {
      weekStart: q.weekStart,
      days,
      departments: visible.map(({ sortOrder: _sortOrder, hospital: _hospital, ...department }) => department),
      entries,
      myDates,
      viewer: { userId: user.id, departmentId: profile.departmentId, canRegister: profile.departmentId !== null && departmentIds.includes(profile.departmentId) },
      summary: {
        registrations: registrations.length,
        people: new Set(registrations.map((registration) => registration.userId)).size,
        departments: visible.length,
        daysWithRegistration: new Set(registrations.map((registration) => registration.studyDate)).size,
      },
    };
  }

  /** Cán bộ chỉ đăng ký chính mình, tránh người khác tạo dữ liệu học thay mà không có căn cứ. */
  async register(user: AccessContext, dto: StaffLearningRegistrationDto) {
    this.assertStudyDate(dto.studyDate);
    const profile = await this.ownActiveProfile(user.id);
    if (!profile.departmentId) throw new ForbiddenException('Tài khoản chưa được gán khoa/phòng công tác');
    const [created] = await this.db.db
      .insert(staffLearningRegistrations)
      .values({ departmentId: profile.departmentId, userId: user.id, studyDate: dto.studyDate })
      .onConflictDoNothing()
      .returning({ id: staffLearningRegistrations.id });
    return { registered: true, alreadyRegistered: !created };
  }

  async remove(user: AccessContext, studyDate: string) {
    this.assertStudyDate(studyDate);
    const [removed] = await this.db.db
      .delete(staffLearningRegistrations)
      .where(and(eq(staffLearningRegistrations.userId, user.id), eq(staffLearningRegistrations.studyDate, studyDate)))
      .returning({ id: staffLearningRegistrations.id });
    return { removed: !!removed };
  }

  async exportExcel(user: AccessContext, q: StaffLearningWeekQueryDto) {
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
