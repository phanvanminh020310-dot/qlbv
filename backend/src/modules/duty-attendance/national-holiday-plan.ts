/*
 * Lịch nghỉ lễ Việt Nam: thuật toán âm–dương lịch chỉ tạo DỰ THẢO từ cấu hình năm
 * đã được rà soát. Hàm thuần, không có tác dụng phụ CSDL và không tự thay thế ngày
 * bệnh viện đã khai báo.
 */
export const NATIONAL_DAY_ADJACENT = ['BEFORE', 'AFTER'] as const;
export type NationalDayAdjacent = (typeof NATIONAL_DAY_ADJACENT)[number];

/** Một ngày được cơ quan Nhà nước/bệnh viện quyết định bổ sung cho phương án một năm. */
export type NationalHolidayPlanAdjustment = { date: string; name: string; note?: string };

export type NationalHolidayPlanConfig = {
  year: number;
  /** Số ngày bắt đầu của đợt Tết so với mùng 1 âm lịch, ví dụ -2 là từ 29/30 Tết tùy năm. */
  tetStartOffset: number;
  /** Số ngày nghỉ Tết pháp định/phương án đơn vị áp dụng. */
  tetDayCount: number;
  /** Ngày Quốc khánh thứ hai theo thông báo từng năm: 01/09 hoặc 03/09. */
  nationalDayAdjacent: NationalDayAdjacent;
  /** Chỉ là dự thảo chuẩn: cơ quan quản lý có thể công bố phương án khác, khi đó khai báo ngày cụ thể bên dưới. */
  compensateWeeklyRest: boolean;
  /** Ngày nghỉ kéo dài/nghỉ bù được thông báo cụ thể, ngoài các mốc sinh tự động. */
  additionalRestDays?: NationalHolidayPlanAdjustment[];
  /** Ngày làm bù do Nhà nước thông báo; thường rơi vào cuối tuần nhưng được tính là ngày làm việc. */
  compensatoryWorkdays?: NationalHolidayPlanAdjustment[];
  note?: string;
};

export type PlannedHoliday = {
  date: string;
  name: string;
  note: string;
  ruleKey: string;
  kind: 'STATUTORY' | 'SUBSTITUTE' | 'APPROVED_ADJUSTMENT';
};
export type PlannedWorkday = {
  date: string;
  name: string;
  note: string;
  ruleKey: string;
  kind: 'COMPENSATORY_WORKDAY';
};

const TZ_VIETNAM = 7;
const floor = Math.floor;
const YMD = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
const pad = (value: number) => String(value).padStart(2, '0');
const ymd = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;
const toUtcDate = (value: string) => new Date(`${value}T00:00:00Z`);
const addDays = (value: string, amount: number) => { const date = toUtcDate(value); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10); };
const weekend = (value: string) => { const weekday = toUtcDate(value).getUTCDay(); return weekday === 0 || weekday === 6; };

/** Julian day number for a Gregorian date. */
function jdFromDate(day: number, month: number, year: number) {
  const a = floor((14 - month) / 12); const y = year + 4800 - a; const m = month + 12 * a - 3;
  return day + floor((153 * m + 2) / 5) + 365 * y + floor(y / 4) - floor(y / 100) + floor(y / 400) - 32045;
}

/** Gregorian date from a Julian day number. */
function dateFromJd(jd: number) {
  const a = jd + 32044; const b = floor((4 * a + 3) / 146097); const c = a - floor(146097 * b / 4);
  const d = floor((4 * c + 3) / 1461); const e = c - floor(1461 * d / 4); const m = floor((5 * e + 2) / 153);
  return { day: e - floor((153 * m + 2) / 5) + 1, month: m + 3 - 12 * floor(m / 10), year: 100 * b + d - 4800 + floor(m / 10) };
}

/** Astronomical new moon calculation used by the published Vietnamese lunar-calendar algorithm. */
function newMoon(k: number) {
  const time = k / 1236.85; const time2 = time * time; const time3 = time2 * time;
  const dr = Math.PI / 180;
  let jd = 2415020.75933 + 29.53058868 * k + 0.0001178 * time2 - 0.000000155 * time3;
  jd += 0.00033 * Math.sin((166.56 + 132.87 * time - 0.009173 * time2) * dr);
  const m = 359.2242 + 29.10535608 * k - 0.0000333 * time2 - 0.00000347 * time3;
  const mpr = 306.0253 + 385.81691806 * k + 0.0107306 * time2 + 0.00001236 * time3;
  const f = 21.2964 + 390.67050646 * k - 0.0016528 * time2 - 0.00000239 * time3;
  let correction = (0.1734 - 0.000393 * time) * Math.sin(m * dr) + 0.0021 * Math.sin(2 * m * dr);
  correction -= 0.4068 * Math.sin(mpr * dr) + 0.0161 * Math.sin(2 * mpr * dr) - 0.0004 * Math.sin(3 * mpr * dr);
  correction += 0.0104 * Math.sin(2 * f * dr) - 0.0051 * Math.sin((m + mpr) * dr) - 0.0074 * Math.sin((m - mpr) * dr);
  correction += 0.0004 * Math.sin((2 * f + m) * dr) - 0.0004 * Math.sin((2 * f - m) * dr) - 0.0006 * Math.sin((2 * f + mpr) * dr);
  correction += 0.001 * Math.sin((2 * f - mpr) * dr) + 0.0005 * Math.sin((2 * mpr + m) * dr);
  if (time < -11) correction += 0.001 + 0.000839 * time + 0.0002261 * time2 - 0.00000845 * time * time3;
  else correction -= 0.000278 + 0.000265 * time + 0.000262 * time2;
  return jd + correction;
}

function newMoonDay(k: number) { return floor(newMoon(k) + 0.5 + TZ_VIETNAM / 24); }
function sunLongitude(jdn: number) {
  const time = (jdn - 2451545.5 - TZ_VIETNAM / 24) / 36525;
  const time2 = time * time; const dr = Math.PI / 180;
  const m = 357.52910 + 35999.05030 * time - 0.0001559 * time2 - 0.00000048 * time * time2;
  const l0 = 280.46645 + 36000.76983 * time + 0.0003032 * time2;
  let dl = (1.914600 - 0.004817 * time - 0.000014 * time2) * Math.sin(dr * m);
  dl += (0.019993 - 0.000101 * time) * Math.sin(2 * dr * m) + 0.000290 * Math.sin(3 * dr * m);
  let longitude = (l0 + dl) * dr; longitude -= Math.PI * 2 * floor(longitude / (Math.PI * 2));
  return floor(longitude / Math.PI * 6);
}
function lunarMonth11(year: number) {
  const offset = jdFromDate(31, 12, year) - 2415021;
  const k = floor(offset / 29.530588853); let month = newMoonDay(k);
  if (sunLongitude(month) >= 9) month = newMoonDay(k - 1);
  return month;
}
function leapMonthOffset(a11: number) {
  const k = floor(0.5 + (a11 - 2415021.076998695) / 29.530588853); let last = 0; let index = 1;
  let arc = sunLongitude(newMoonDay(k + index));
  do { last = arc; index += 1; arc = sunLongitude(newMoonDay(k + index)); } while (arc !== last && index < 14);
  return index - 1;
}

/** Converts a Vietnamese lunar date (UTC+07) to Gregorian Y-M-D. Supports 1900–2100. */
export function vietnameseLunarToSolar(lunarDay: number, lunarMonth: number, lunarYear: number, lunarLeap = false) {
  let a11: number; let b11: number;
  if (lunarMonth < 11) { a11 = lunarMonth11(lunarYear - 1); b11 = lunarMonth11(lunarYear); } else { a11 = lunarMonth11(lunarYear); b11 = lunarMonth11(lunarYear + 1); }
  const k = floor(0.5 + (a11 - 2415021.076998695) / 29.530588853);
  let offset = lunarMonth - 11; if (offset < 0) offset += 12;
  if (b11 - a11 > 365) {
    const leapOffset = leapMonthOffset(a11); let leapMonth = leapOffset - 2; if (leapMonth < 0) leapMonth += 12;
    if (lunarLeap && lunarMonth !== leapMonth) throw new Error('Tháng âm lịch được chọn không phải tháng nhuận');
    if (lunarLeap || offset >= leapOffset) offset += 1;
  } else if (lunarLeap) throw new Error('Năm âm lịch này không có tháng nhuận tương ứng');
  const result = dateFromJd(newMoonDay(k + offset) + lunarDay - 1);
  return ymd(result.year, result.month, result.day);
}

function normalizedAdjustments(year: number, kind: 'nghỉ bổ sung' | 'làm bù', values: NationalHolidayPlanAdjustment[] | undefined) {
  if (!Array.isArray(values) || values.length > 31) throw new Error(`Danh sách ngày ${kind} tối đa 31 dòng`);
  const seen = new Set<string>();
  return values.map((value, index) => {
    const date = String(value?.date ?? ''); const name = String(value?.name ?? '').trim(); const note = String(value?.note ?? '').trim();
    if (!YMD.test(date) || toUtcDate(date).toISOString().slice(0, 10) !== date || Number(date.slice(0, 4)) !== year) throw new Error(`Dòng ${index + 1} ngày ${kind} phải là một ngày hợp lệ thuộc năm ${year}`);
    if (!name || name.length > 160) throw new Error(`Dòng ${index + 1} ngày ${kind} phải có tên tối đa 160 ký tự`);
    if (note.length > 500) throw new Error(`Ghi chú ngày ${kind} tối đa 500 ký tự`);
    if (seen.has(date)) throw new Error(`Ngày ${date} bị lặp trong danh sách ${kind}`);
    seen.add(date); return { date, name, note };
  }).sort((left, right) => left.date.localeCompare(right.date));
}

export function defaultNationalHolidayPlan(year: number): NationalHolidayPlanConfig {
  return { year, tetStartOffset: -2, tetDayCount: 5, nationalDayAdjacent: 'AFTER', compensateWeeklyRest: true, additionalRestDays: [], compensatoryWorkdays: [], note: '' };
}

/** Create a year-specific, reviewable calendar proposal; it has no database side effects. */
export function nationalHolidayProposal(input: NationalHolidayPlanConfig) {
  if (!Number.isInteger(input.year) || input.year < 1900 || input.year > 2100) throw new Error('Năm tạo lịch lễ phải trong khoảng 1900–2100');
  if (!Number.isInteger(input.tetStartOffset) || input.tetStartOffset < -10 || input.tetStartOffset > 10) throw new Error('Mốc bắt đầu Tết phải từ -10 đến 10 ngày so với mùng 1');
  if (!Number.isInteger(input.tetDayCount) || input.tetDayCount < 1 || input.tetDayCount > 10) throw new Error('Số ngày Tết phải từ 1 đến 10');
  const additionalRestDays = normalizedAdjustments(input.year, 'nghỉ bổ sung', input.additionalRestDays ?? []);
  const compensatoryWorkdays = normalizedAdjustments(input.year, 'làm bù', input.compensatoryWorkdays ?? []);
  const plan = { ...input, additionalRestDays, compensatoryWorkdays, note: input.note?.trim() ?? '' };
  const lunarNewYear = vietnameseLunarToSolar(1, 1, plan.year);
  const hungKings = vietnameseLunarToSolar(10, 3, plan.year);
  const statutory: PlannedHoliday[] = [
    { date: ymd(plan.year, 1, 1), name: 'Tết Dương lịch', note: 'Ngày lễ theo Bộ luật Lao động.', ruleKey: 'NEW_YEAR', kind: 'STATUTORY' },
    ...Array.from({ length: plan.tetDayCount }, (_, index) => ({ date: addDays(lunarNewYear, plan.tetStartOffset + index), name: `Tết Nguyên đán – ngày ${index + 1}/${plan.tetDayCount}`, note: `Dự thảo theo phương án năm ${plan.year}; mùng 1 âm lịch là ${lunarNewYear}. Kiểm tra quyết định nghỉ Tết chính thức trước khi áp dụng.`, ruleKey: `TET_${index + 1}`, kind: 'STATUTORY' as const })),
    { date: hungKings, name: 'Giỗ Tổ Hùng Vương', note: 'Mùng 10 tháng 3 âm lịch.', ruleKey: 'HUNG_KINGS', kind: 'STATUTORY' },
    { date: ymd(plan.year, 4, 30), name: 'Ngày Giải phóng miền Nam', note: 'Ngày lễ theo Bộ luật Lao động.', ruleKey: 'REUNIFICATION', kind: 'STATUTORY' },
    { date: ymd(plan.year, 5, 1), name: 'Ngày Quốc tế Lao động', note: 'Ngày lễ theo Bộ luật Lao động.', ruleKey: 'LABOUR_DAY', kind: 'STATUTORY' },
    { date: ymd(plan.year, 9, 2), name: 'Quốc khánh', note: 'Ngày 02/09 theo Bộ luật Lao động.', ruleKey: 'NATIONAL_DAY', kind: 'STATUTORY' },
    { date: ymd(plan.year, 9, plan.nationalDayAdjacent === 'BEFORE' ? 1 : 3), name: 'Nghỉ Quốc khánh', note: `Ngày liền kề 02/09 được bệnh viện chọn: ${plan.nationalDayAdjacent === 'BEFORE' ? '01/09' : '03/09'}.`, ruleKey: 'NATIONAL_DAY_ADJACENT', kind: 'STATUTORY' },
  ];
  const uniqueStatutory = [...new Map(statutory.map((holiday) => [holiday.date, holiday])).values()].sort((left, right) => left.date.localeCompare(right.date));
  const statutoryDates = new Set(uniqueStatutory.map((holiday) => holiday.date));
  for (const extra of additionalRestDays) if (statutoryDates.has(extra.date)) throw new Error(`Ngày nghỉ bổ sung ${extra.date} trùng một ngày lễ đã có trong phương án`);
  const approvedRest: PlannedHoliday[] = additionalRestDays.map((day) => ({ ...day, ruleKey: `APPROVED_REST_${day.date.replaceAll('-', '')}`, kind: 'APPROVED_ADJUSTMENT' }));
  const substitutes: PlannedHoliday[] = [];
  if (plan.compensateWeeklyRest) {
    const reserved = new Set([...uniqueStatutory, ...approvedRest].map((holiday) => holiday.date));
    for (const holiday of uniqueStatutory) {
      if (!weekend(holiday.date)) continue;
      let substitute = addDays(holiday.date, 1);
      while (weekend(substitute) || reserved.has(substitute)) substitute = addDays(substitute, 1);
      reserved.add(substitute);
      substitutes.push({ date: substitute, name: `Nghỉ bù ${holiday.name}`, note: `Ngày lễ ${holiday.date} trùng ngày nghỉ hằng tuần; sinh theo phương án lịch chuẩn Thứ Bảy/Chủ nhật. Cần đối chiếu lịch chính thức trước khi áp dụng.`, ruleKey: `SUBSTITUTE_${holiday.ruleKey}`, kind: 'SUBSTITUTE' });
    }
  }
  const candidates = [...uniqueStatutory, ...approvedRest, ...substitutes].sort((left, right) => left.date.localeCompare(right.date));
  const restDates = new Set(candidates.map((holiday) => holiday.date));
  for (const workday of compensatoryWorkdays) if (restDates.has(workday.date)) throw new Error(`Ngày làm bù ${workday.date} không thể đồng thời là ngày nghỉ trong cùng phương án`);
  const workdayCandidates: PlannedWorkday[] = compensatoryWorkdays.map((day) => ({ ...day, ruleKey: `COMPENSATORY_WORKDAY_${day.date.replaceAll('-', '')}`, kind: 'COMPENSATORY_WORKDAY' }));
  return {
    plan,
    lunarNewYear,
    candidates,
    workdayCandidates,
    warnings: [
      `Tết năm ${plan.year}: mùng 1 âm lịch là ${lunarNewYear}; dự thảo dùng ${plan.tetDayCount} ngày từ mốc ${plan.tetStartOffset >= 0 ? '+' : ''}${plan.tetStartOffset}.`,
      `Quốc khánh dùng 02/09 và ${plan.nationalDayAdjacent === 'BEFORE' ? '01/09' : '03/09'}; hãy đối chiếu thông báo nghỉ hằng năm trước khi áp dụng.`,
      plan.compensateWeeklyRest ? 'Đã sinh dự thảo nghỉ bù khi ngày lễ trùng Thứ Bảy/Chủ nhật; sửa/tắt phương án khi thông báo chính thức khác.' : 'Không tự sinh ngày nghỉ bù; có thể khai báo ngày nghỉ bổ sung theo thông báo chính thức.',
      additionalRestDays.length ? `Đã thêm ${additionalRestDays.length} ngày nghỉ/hoán đổi được duyệt theo thông báo.` : 'Chưa có ngày nghỉ kéo dài/nghỉ bù được khai báo riêng.',
      compensatoryWorkdays.length ? `Đã thêm ${compensatoryWorkdays.length} ngày làm bù; các ngày này được tính là ngày làm việc.` : 'Chưa có ngày làm bù theo thông báo.',
    ],
  };
}
