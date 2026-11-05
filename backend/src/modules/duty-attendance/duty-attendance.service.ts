import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import * as ExcelJS from 'exceljs';
import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import { DbService } from '../../db/db.service';
import { departments, dutyAttendanceCodes, dutyAttendanceEntries, dutyAttendanceHolidays, users } from '../../db/schema';
import type { AccessContext } from '../../common/types/access-context';
import { renderPrintDocument } from '../../infra/rendering/pdf-renderer';
import { bangkokToday } from '../duty/duty-rules';
import type { AttendanceCodeDto, AttendanceHolidayDto, AttendanceMonthQueryDto, SaveAttendanceEntriesDto } from './duty-attendance.dto';

const YMD = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
const monthBounds = (month: string) => ({ from: `${month}-01`, to: `${month === '9999-12' ? '10000-01' : `${Number(month.slice(0, 4)) + (month.endsWith('-12') ? 1 : 0)}-${String((Number(month.slice(5)) % 12) + 1).padStart(2, '0')}`}-01` });
const daysInMonth = (month: string) => new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
const fmtDate = (ymd: string) => { const [y, m, d] = ymd.split('-'); return `${d}/${m}/${y}`; };
const vnWeekday = (ymd: string) => ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][new Date(`${ymd}T00:00:00`).getDay()];

export interface AttendanceExport { buffer: Buffer; fileName: string; mime: string; }

@Injectable()
export class DutyAttendanceService {
  constructor(private readonly db: DbService) {}

  /** SUPER_ADMIN có thể chọn khoa để hỗ trợ; mọi tài khoản khoa bị khóa cứng vào khoa công tác của mình. */
  private async deptId(user: AccessContext, requestedDepartmentId?: number) {
    if (!user.isSuperAdmin) {
      if (!user.departmentId) throw new ForbiddenException('Tài khoản chưa được gán khoa/phòng; không thể nhập bảng chấm công');
      if (requestedDepartmentId !== undefined && requestedDepartmentId !== user.departmentId) {
        throw new ForbiddenException('Bạn chỉ được xem và chấm công cho khoa/phòng được gán');
      }
      return user.departmentId;
    }
    if (!requestedDepartmentId) throw new BadRequestException('Vui lòng chọn khoa/phòng cần xem bảng chấm công');
    const [department] = await this.db.db.select({ id: departments.id }).from(departments)
      .where(and(eq(departments.id, requestedDepartmentId), eq(departments.active, true), isNull(departments.deletedAt)));
    if (!department) throw new NotFoundException('Không tìm thấy khoa/phòng đang hoạt động');
    return department.id;
  }

  async availableDepartments(user: AccessContext) {
    if (user.isSuperAdmin) {
      const items = await this.db.db.select({ id: departments.id, name: departments.name, code: departments.code, shortName: departments.shortName })
        .from(departments).where(and(eq(departments.active, true), isNull(departments.deletedAt))).orderBy(asc(departments.name));
      return { canSelect: true, items };
    }
    const id = await this.deptId(user);
    const [item] = await this.db.db.select({ id: departments.id, name: departments.name, code: departments.code, shortName: departments.shortName })
      .from(departments).where(eq(departments.id, id));
    return { canSelect: false, items: item ? [item] : [] };
  }

  private assertMonth(month: string) { if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BadRequestException('Tháng phải có dạng YYYY-MM'); }

  async month(user: AccessContext, q: AttendanceMonthQueryDto) {
    this.assertMonth(q.month);
    const departmentId = await this.deptId(user, q.departmentId);
    const { from, to } = monthBounds(q.month);
    const [department] = await this.db.db.select().from(departments).where(eq(departments.id, departmentId));
    if (!department) throw new NotFoundException('Không tìm thấy khoa/phòng được gán');
    const [staff, codes, holidays, records] = await Promise.all([
      this.db.db.select({ id: users.id, fullName: users.fullName, title: users.title, username: users.username }).from(users).where(and(eq(users.departmentId, departmentId), eq(users.active, true), isNull(users.deletedAt))).orderBy(asc(users.fullName)),
      this.db.db.select().from(dutyAttendanceCodes).where(eq(dutyAttendanceCodes.active, true)).orderBy(asc(dutyAttendanceCodes.sortOrder), asc(dutyAttendanceCodes.code)),
      this.db.db.select().from(dutyAttendanceHolidays).where(and(gte(dutyAttendanceHolidays.holidayDate, from), lt(dutyAttendanceHolidays.holidayDate, to))),
      this.db.db.select({ userId: dutyAttendanceEntries.userId, workDate: dutyAttendanceEntries.workDate, code: dutyAttendanceCodes.code, note: dutyAttendanceEntries.note })
        .from(dutyAttendanceEntries).innerJoin(dutyAttendanceCodes, eq(dutyAttendanceEntries.codeId, dutyAttendanceCodes.id))
        .where(and(eq(dutyAttendanceEntries.departmentId, departmentId), gte(dutyAttendanceEntries.workDate, from), lt(dutyAttendanceEntries.workDate, to))),
    ]);
    const today = bangkokToday();
    const holidayDates = new Set(holidays.map((h) => h.holidayDate));
    const dates = Array.from({ length: daysInMonth(q.month) }, (_, i) => {
      const date = `${q.month}-${String(i + 1).padStart(2, '0')}`;
      const dow = new Date(`${date}T00:00:00`).getDay();
      const isWeekend = dow === 0 || dow === 6;
      return { date, day: i + 1, weekday: vnWeekday(date), isWeekend, isPast: date < today, isRest: isWeekend || holidayDates.has(date), holidayName: holidays.find((h) => h.holidayDate === date)?.name ?? '' };
    });
    const entries = Object.fromEntries(records.map((r) => [`${r.userId}:${r.workDate}`, { code: r.code, note: r.note }]));
    const dutyCodes = new Set(codes.filter((c) => c.countsAsDuty).map((c) => c.code));
    const summaryCodes = codes.filter((c) => c.showSummary && !c.countsAsDuty).map((c) => c.code);
    const rows = staff.map((s, index) => {
      const totals: Record<string, number> = { NN: 0, NT: 0, ...Object.fromEntries(summaryCodes.map((c) => [c, 0])) };
      for (const date of dates) {
        const cell = entries[`${s.id}:${date.date}`];
        if (!cell) continue;
        if (dutyCodes.has(cell.code)) totals[date.isRest ? 'NN' : 'NT']++;
        else if (Object.hasOwn(totals, cell.code)) totals[cell.code]++;
      }
      return { stt: index + 1, ...s, totals };
    });
    return { month: q.month, today, department: { id: department.id, name: department.name, hospital: department.hospital }, dates, codes, summaryCodes, summaryColumns: codes.filter((c) => c.showSummary && !c.countsAsDuty).map((c) => ({ code: c.code, name: c.name })), staff: rows, entries, holidays };
  }

  async save(user: AccessContext, dto: SaveAttendanceEntriesDto) {
    const departmentId = await this.deptId(user, dto.departmentId);
    if (!dto.entries.length) return { saved: 0 };
    const dates = [...new Set(dto.entries.map((x) => x.workDate))];
    const today = bangkokToday();
    for (const d of dates) {
      if (!YMD.test(d)) throw new BadRequestException('Ngày chấm công không hợp lệ');
      if (d < today) throw new ForbiddenException(`Không được sửa chấm công ngày ${fmtDate(d)} vì ngày này đã qua`);
    }
    const personIds = [...new Set(dto.entries.map((x) => x.userId))];
    const [staff, activeCodes] = await Promise.all([
      this.db.db.select({ id: users.id }).from(users).where(and(inArray(users.id, personIds), eq(users.departmentId, departmentId), eq(users.active, true), isNull(users.deletedAt))),
      this.db.db.select({ id: dutyAttendanceCodes.id, code: dutyAttendanceCodes.code }).from(dutyAttendanceCodes).where(eq(dutyAttendanceCodes.active, true)),
    ]);
    if (staff.length !== personIds.length) throw new ForbiddenException('Chỉ được chấm công cho nhân viên đang hoạt động thuộc khoa của bạn');
    const byCode = new Map(activeCodes.map((c) => [c.code.toUpperCase(), c.id]));
    await this.db.transaction(async (tx) => {
      for (const entry of dto.entries) {
        const code = entry.code?.trim().toUpperCase();
        if (!code) {
          await tx.delete(dutyAttendanceEntries).where(and(eq(dutyAttendanceEntries.userId, entry.userId), eq(dutyAttendanceEntries.workDate, entry.workDate), eq(dutyAttendanceEntries.departmentId, departmentId)));
          continue;
        }
        const codeId = byCode.get(code);
        if (!codeId) throw new BadRequestException(`Ký hiệu “${code}” không tồn tại hoặc đã ngừng sử dụng`);
        await tx.insert(dutyAttendanceEntries).values({ departmentId, userId: entry.userId, workDate: entry.workDate, codeId, note: entry.note?.trim() ?? '', updatedBy: user.id })
          .onConflictDoUpdate({ target: [dutyAttendanceEntries.userId, dutyAttendanceEntries.workDate], set: { departmentId, codeId, note: entry.note?.trim() ?? '', updatedBy: user.id, updatedAt: new Date() } });
      }
    });
    return { saved: dto.entries.length };
  }

  async codes() { return this.db.db.select().from(dutyAttendanceCodes).orderBy(asc(dutyAttendanceCodes.sortOrder), asc(dutyAttendanceCodes.code)); }
  async createCode(dto: AttendanceCodeDto) { const [v] = await this.db.db.insert(dutyAttendanceCodes).values({ ...dto, code: dto.code.trim().toUpperCase(), name: dto.name.trim(), group: dto.group.trim().toUpperCase(), color: dto.color ?? '#0f766e', countsAsDuty: dto.countsAsDuty ?? false, showSummary: dto.showSummary ?? true, sortOrder: dto.sortOrder ?? 0, active: dto.active ?? true, note: dto.note?.trim() ?? '' }).returning(); return v; }
  async updateCode(id: number, dto: Partial<AttendanceCodeDto>) { const [v] = await this.db.db.update(dutyAttendanceCodes).set({ ...dto, code: dto.code?.trim().toUpperCase(), name: dto.name?.trim(), group: dto.group?.trim().toUpperCase(), note: dto.note?.trim(), updatedAt: new Date() }).where(eq(dutyAttendanceCodes.id, id)).returning(); if (!v) throw new NotFoundException('Không tìm thấy ký hiệu'); return v; }
  async deleteCode(id: number) {
    const [code] = await this.db.db.select({ id: dutyAttendanceCodes.id, code: dutyAttendanceCodes.code }).from(dutyAttendanceCodes).where(eq(dutyAttendanceCodes.id, id));
    if (!code) throw new NotFoundException('Không tìm thấy ký hiệu');
    const [{ total }] = await this.db.db.select({ total: sql<number>`count(*)::int` }).from(dutyAttendanceEntries).where(eq(dutyAttendanceEntries.codeId, id));
    if (Number(total) > 0) throw new ConflictException(`Không thể xóa ký hiệu “${code.code}” vì đã được dùng trong bảng chấm công. Hãy ngừng sử dụng ký hiệu này thay vì xóa.`);
    await this.db.db.delete(dutyAttendanceCodes).where(eq(dutyAttendanceCodes.id, id));
    return { deleted: true };
  }
  async holidays(q: AttendanceMonthQueryDto) { this.assertMonth(q.month); const { from, to } = monthBounds(q.month); return this.db.db.select().from(dutyAttendanceHolidays).where(and(gte(dutyAttendanceHolidays.holidayDate, from), lt(dutyAttendanceHolidays.holidayDate, to))).orderBy(asc(dutyAttendanceHolidays.holidayDate)); }
  async saveHoliday(user: AccessContext, dto: AttendanceHolidayDto) { const [v] = await this.db.db.insert(dutyAttendanceHolidays).values({ ...dto, name: dto.name.trim(), note: dto.note?.trim() ?? '', createdBy: user.id }).onConflictDoUpdate({ target: dutyAttendanceHolidays.holidayDate, set: { name: dto.name.trim(), note: dto.note?.trim() ?? '' } }).returning(); return v; }
  async deleteHoliday(id: number) { const [v] = await this.db.db.delete(dutyAttendanceHolidays).where(eq(dutyAttendanceHolidays.id, id)).returning(); if (!v) throw new NotFoundException('Không tìm thấy ngày nghỉ'); return { deleted: true }; }

  private async exportData(user: AccessContext, month: string, departmentId?: number) { return this.month(user, { month, departmentId }); }
  private matrix(data: Awaited<ReturnType<DutyAttendanceService['month']>>) { return data.staff.map((s) => [s.stt, s.fullName, s.title, ...data.dates.map((d) => data.entries[`${s.id}:${d.date}`]?.code ?? ''), s.totals.NN, s.totals.NT, ...data.summaryCodes.map((c) => s.totals[c] ?? 0)]); }
  async exportExcel(user: AccessContext, month: string, departmentId?: number): Promise<AttendanceExport> {
    const d = await this.exportData(user, month, departmentId), wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Cham cong');
    const total = 3 + d.dates.length + 2 + d.summaryCodes.length; const last = String.fromCharCode(64 + Math.min(total, 26));
    ws.mergeCells(1, 1, 1, total); ws.getCell('A1').value = d.department.hospital.toUpperCase(); ws.getCell('A1').font = { name: 'Times New Roman', bold: true, size: 12 }; ws.getCell('A1').alignment = { horizontal: 'center' };
    ws.mergeCells(2, 1, 2, total); ws.getCell('A2').value = 'BẢNG CHẤM CÔNG TRỰC VÀ CHẤM CÔNG KHÁC'; ws.getCell('A2').font = { name: 'Times New Roman', bold: true, size: 15 }; ws.getCell('A2').alignment = { horizontal: 'center' };
    ws.mergeCells(3, 1, 3, total); ws.getCell('A3').value = `Khoa/Phòng: ${d.department.name} — Tháng ${month.slice(5)}/${month.slice(0,4)}`; ws.getCell('A3').alignment = { horizontal: 'center' };
    const headers = ['STT', 'Họ và tên', 'Chức danh', ...d.dates.map((x) => String(x.day)), 'Trực NN', 'Trực NT', ...d.summaryColumns.map((x) => x.name)]; ws.addRow(headers); ws.addRow(['', '', '', ...d.dates.map((x) => x.weekday), '', '', ...d.summaryColumns.map(() => '')]);
    for (const row of this.matrix(d)) ws.addRow(row);
    ws.views = [{ state: 'frozen', xSplit: 3, ySplit: 5 }]; ws.columns.forEach((c, i) => c.width = i === 1 ? 28 : i === 2 ? 20 : i < 3 ? 8 : 5);
    [4, 5].forEach((r) => ws.getRow(r).eachCell((cell) => { cell.font = { bold: true, name: 'Times New Roman', size: 9 }; cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: r === 4 ? 'DCE6F1' : 'EAF2F8' } }; cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }; }));
    for (let r = 6; r <= ws.rowCount; r++) ws.getRow(r).eachCell((cell) => { cell.alignment = { horizontal: Number(cell.col) > 3 ? 'center' : 'left', vertical: 'middle' }; cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }; });
    return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), fileName: `BANG_CHAM_CONG_${month}_${d.department.id}.xlsx`, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  }
  async exportWord(user: AccessContext, month: string, departmentId?: number): Promise<AttendanceExport> {
    const d = await this.exportData(user, month, departmentId); const headers = ['STT', 'Họ và tên', 'Chức danh', ...d.dates.map((x) => String(x.day)), 'NN', 'NT', ...d.summaryColumns.map((x) => x.name)];
    const mkCell = (v: unknown, bold = false) => new TableCell({ width: { size: Math.max(200, Math.floor(9500 / headers.length)), type: WidthType.DXA }, children: [new Paragraph({ alignment: 'center', children: [new TextRun({ text: String(v ?? ''), bold, size: 14 })] })] });
    const rows = [new TableRow({ children: headers.map((x) => mkCell(x, true)) }), new TableRow({ children: ['', '', '', ...d.dates.map((x) => x.weekday), '', '', ...d.summaryCodes.map(() => '')].map((x) => mkCell(x, true)) }), ...this.matrix(d).map((r) => new TableRow({ children: r.map((x) => mkCell(x)) }))];
    const doc = new Document({ sections: [{ properties: { page: { size: { width: 16840, height: 11900 }, margin: { top: 600, right: 500, bottom: 600, left: 500 } } }, children: [new Paragraph({ alignment: 'center', children: [new TextRun({ text: d.department.hospital.toUpperCase(), bold: true, size: 20 })] }), new Paragraph({ alignment: 'center', children: [new TextRun({ text: 'BẢNG CHẤM CÔNG TRỰC VÀ CHẤM CÔNG KHÁC', bold: true, size: 26 })] }), new Paragraph({ alignment: 'center', children: [new TextRun({ text: `Khoa/Phòng: ${d.department.name} — Tháng ${month.slice(5)}/${month.slice(0,4)}`, italics: true, size: 18 })] }), new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })] }] });
    return { buffer: await Packer.toBuffer(doc), fileName: `BANG_CHAM_CONG_${month}_${d.department.id}.docx`, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  }
  async exportPdf(user: AccessContext, month: string, departmentId?: number): Promise<AttendanceExport> {
    const d = await this.exportData(user, month, departmentId); const columns = [{ id: 'stt', title: 'STT', width: 8 }, { id: 'name', title: 'Họ và tên', width: 33 }, { id: 'title', title: 'Chức danh', width: 24 }, ...d.dates.map((x) => ({ id: `d${x.day}`, title: String(x.day), width: 8 })), { id: 'nn', title: 'NN', width: 9 }, { id: 'nt', title: 'NT', width: 9 }, ...d.summaryColumns.map((c) => ({ id: `s${c.code}`, title: c.name, width: 9 }))];
    const rows = d.staff.map((s) => Object.assign({ stt: s.stt, name: s.fullName, title: s.title, nn: s.totals.NN, nt: s.totals.NT }, Object.fromEntries([...d.dates.map((x) => [`d${x.day}`, d.entries[`${s.id}:${x.date}`]?.code ?? '']), ...d.summaryCodes.map((c) => [`s${c}`, s.totals[c] ?? 0])] )));
    const W = 273, L = 12; const doc = { paperSize: 'A4', orientation: 'landscape', margins: { top: 8, right: 8, bottom: 10, left: 8 }, defaultStyle: { fontFamily: 'Times New Roman', fontSize: 6.5 }, pageNumbering: { show: true, position: 'bottom-right', format: 'Trang {page}/{pages}' }, pages: [{ id: 'p', name: 'Bảng chấm công', elements: [
      { id: 'org', type: 'text', x: L, y: 7, w: W, h: 5, text: d.department.hospital.toUpperCase(), style: { bold: true, align: 'center', fontSize: 9 } },
      { id: 'title', type: 'text', x: L, y: 13, w: W, h: 7, text: 'BẢNG CHẤM CÔNG TRỰC VÀ CHẤM CÔNG KHÁC', style: { bold: true, align: 'center', fontSize: 12 } },
      { id: 'sub', type: 'text', x: L, y: 21, w: W, h: 5, text: `Khoa/Phòng: ${d.department.name} — Tháng ${month.slice(5)}/${month.slice(0,4)}`, style: { italic: true, align: 'center', fontSize: 8 } },
      { id: 'table', type: 'table', x: L, y: 29, w: W, h: 10, style: { fontSize: 5.8 }, table: { dataSource: 'rows', repeatHeader: true, minRowHeight: 5, columns: columns.map((c) => ({ ...c, align: ['name', 'title'].includes(c.id) ? 'left' : 'center', binding: { source: 'row', path: c.id } })) } },
      { id: 'legend', type: 'text', x: L, y: 185, w: W, h: 5, text: `Ký hiệu: ${d.codes.map((c) => `${c.code} – ${c.name}`).join('; ')}`, style: { fontSize: 7, wrap: true } },
    ] }] } as any;
    const out = await renderPrintDocument(doc, { data: { rows }, fileName: `BANG_CHAM_CONG_${month}` }); return { buffer: out.buffer, fileName: `BANG_CHAM_CONG_${month}_${d.department.id}.pdf`, mime: 'application/pdf' };
  }
}
