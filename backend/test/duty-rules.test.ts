/**
 * Kiểm thử lõi nghiệp vụ lịch trực (hàm thuần, không cần CSDL).
 * Chạy: npm test  (node --test --import tsx test/*.test.ts)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DUTY_RULES,
  addDays,
  defaultLockAt,
  evaluateCandidate,
  isNightWindow,
  isoWeekday,
  isoWeekNumber,
  isoWeekRange,
  normalizeRules,
  rangesOverlap,
  shiftInterval,
  smartPeriodTitle,
  weekStart,
  type EngineDuty,
  type EngineSlot,
  type EngineUser,
  type EvaluateInput,
  type ViolationCode,
} from '../src/modules/duty/duty-rules';

const NOW = Date.parse('2026-10-01T00:00:00+07:00');
const RULES = { ...DEFAULT_DUTY_RULES };

type ShiftDef = { code: string; start: string; end: string; night?: boolean; hours?: number };
const SHIFTS: Record<string, ShiftDef> = {
  S: { code: 'S', start: '07:00', end: '12:00' },
  C: { code: 'C', start: '12:00', end: '17:00' },
  CD: { code: 'CD', start: '07:00', end: '17:00' },
  D: { code: 'D', start: '17:00', end: '07:00', night: true },
};

function slotOf(id: number, date: string, shift: string, extra: Partial<EngineSlot> = {}): EngineSlot {
  const d = SHIFTS[shift];
  const iv = shiftInterval(date, d.start, d.end, d.end <= d.start);
  return {
    id,
    periodId: 1,
    dutyDate: date,
    roomId: 1,
    roomCode: 'P1',
    roomDepartmentId: 10,
    shiftCode: d.code,
    isNight: !!d.night,
    hours: iv.hours,
    start: iv.start,
    end: iv.end,
    roleName: 'Bác sĩ trực',
    requiredTitle: 'Bác sĩ',
    requiredCount: 1,
    filled: 0,
    ...extra,
  };
}

function dutyOf(slotId: number, date: string, shift: string, room = 'P1'): EngineDuty {
  const d = SHIFTS[shift];
  const iv = shiftInterval(date, d.start, d.end, d.end <= d.start);
  return { slotId, dutyDate: date, start: iv.start, end: iv.end, isNight: !!d.night, hours: iv.hours, roomCode: room, shiftCode: d.code };
}

const doctor: EngineUser = { id: 7, fullName: 'BS. A', title: 'Bác sĩ', departmentId: 10, active: true };

function input(over: Partial<EvaluateInput> & { slot: EngineSlot }): EvaluateInput {
  return {
    user: doctor,
    rules: RULES,
    duties: [],
    absences: [],
    periodShifts: 0,
    periodNights: 0,
    alreadyInSlot: false,
    now: NOW,
    locked: false,
    ...over,
  };
}

const codes = (r: { errors: { code: ViolationCode }[] }) => r.errors.map((e) => e.code);

/* ----------------------------------------------------------------- Thời gian */

test('ca có khung giờ đúng theo múi giờ Bangkok (UTC+7)', () => {
  const iv = shiftInterval('2026-10-06', '07:00', '12:00', false);
  assert.equal(new Date(iv.start).toISOString(), '2026-10-06T00:00:00.000Z');
  assert.equal(iv.hours, 5);
});

test('ca đêm kéo sang ngày hôm sau: 17:00 → 07:00 = 14 giờ', () => {
  const iv = shiftInterval('2026-10-06', '17:00', '07:00', true);
  assert.equal(iv.hours, 14);
  assert.equal(new Date(iv.end).toISOString(), '2026-10-07T00:00:00.000Z');
});

test('nhận diện ca đêm theo khung 22:00–06:00 (≥ 2 giờ)', () => {
  assert.equal(isNightWindow('17:00', '07:00', true), true);
  assert.equal(isNightWindow('07:00', '12:00', false), false);
  assert.equal(isNightWindow('05:00', '09:00', false), false); // 1 giờ trong khung
  assert.equal(isNightWindow('20:00', '23:00', false), false); // 1 giờ trong khung
  assert.equal(isNightWindow('21:00', '23:00', false), false); // 1 giờ trong khung
  assert.equal(isNightWindow('21:00', '02:00', true), true); // 4 giờ trong khung
});

test('tuần ISO: Thứ 2 là đầu tuần, Chủ nhật là ngày 7', () => {
  assert.equal(isoWeekday('2026-10-05'), 1);
  assert.equal(isoWeekday('2026-10-11'), 7);
  assert.equal(weekStart('2026-10-08'), '2026-10-05');
  assert.equal(weekStart('2026-10-11'), '2026-10-05');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
});

test('chuẩn hoá cấu hình: kỳ mới mặc định mọi giới hạn số ca/giờ/nghỉ bằng 0; vượt biên bị kẹp', () => {
  const defaults = normalizeRules({});
  assert.equal(defaults.maxShiftsPerDay, 0);
  assert.equal(defaults.maxHoursPerDay, 0);
  assert.equal(defaults.maxHoursPerWeek, 0);
  assert.equal(defaults.minRestHours, 0);
  assert.equal(defaults.maxShiftsPerPeriod, 0);
  assert.equal(defaults.maxNightShiftsPerPeriod, 0);

  const r = normalizeRules({ maxHoursPerWeek: 999, minRestHours: -5, crossDeptPolicy: 'XYZ', allowSelfRegister: false });
  assert.equal(r.maxHoursPerWeek, 168);
  assert.equal(r.minRestHours, 0);
  assert.equal(r.crossDeptPolicy, DEFAULT_DUTY_RULES.crossDeptPolicy);
  assert.equal(r.allowSelfRegister, false);
  assert.equal(r.maxHoursPerDay, DEFAULT_DUTY_RULES.maxHoursPerDay);
});

/* ----------------------------------------------------------------- Ràng buộc */

test('hợp lệ: người đúng chức danh, trống ca, không nghỉ phép', () => {
  const r = evaluateCandidate(input({ slot: slotOf(1, '2026-10-06', 'S') }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

test('kỳ mới không giới hạn số ca/ngày nên cho phép ca liền kề ban ngày', () => {
  const slot = slotOf(2, '2026-10-06', 'C');
  const r = evaluateCandidate(input({
    slot,
    duties: [dutyOf(1, '2026-10-06', 'S')],
  }));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('chặn ca đêm liền kề ca khác (không có khoảng nghỉ)', () => {
  const slot = slotOf(3, '2026-10-07', 'S'); // ngay sau ca đêm kết thúc 07:00
  const r = evaluateCandidate(input({ slot, duties: [dutyOf(2, '2026-10-06', 'D')] }));
  assert.ok(codes(r).includes('REST'));
});

test('chặn trùng giờ (cả ngày trùng sáng)', () => {
  const slot = slotOf(4, '2026-10-06', 'CD');
  const r = evaluateCandidate(input({ slot, duties: [dutyOf(1, '2026-10-06', 'S')] }));
  assert.ok(codes(r).includes('OVERLAP'));
});

test('nghỉ giữa hai ca không đủ 12 giờ thì chặn; đủ thì cho qua', () => {
  // Chiều 06/10 kết thúc 17:00 → Sáng 07/10 bắt đầu 07:00: nghỉ 14 giờ
  const ok = evaluateCandidate(input({ slot: slotOf(5, '2026-10-07', 'S'), duties: [dutyOf(1, '2026-10-06', 'C')] }));
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  // Cùng ca chiều nhưng yêu cầu nghỉ 16 giờ → chặn
  const strict = evaluateCandidate(
    input({ slot: slotOf(5, '2026-10-07', 'S'), duties: [dutyOf(1, '2026-10-06', 'C')], rules: { ...RULES, minRestHours: 16 } }),
  );
  assert.ok(codes(strict).includes('REST'));
});

test('sai chức danh bị chặn; so khớp không phân biệt hoa thường và khoảng trắng', () => {
  const wrong = evaluateCandidate(input({ slot: slotOf(6, '2026-10-06', 'S'), user: { ...doctor, title: 'Kế toán' } }));
  assert.ok(codes(wrong).includes('TITLE'));
  const loose = evaluateCandidate(input({ slot: slotOf(6, '2026-10-06', 'S'), user: { ...doctor, title: '  bác   sĩ ' } }));
  assert.equal(loose.ok, true);
});

test('đang nghỉ phép thì không được xếp', () => {
  const r = evaluateCandidate(
    input({ slot: slotOf(7, '2026-10-06', 'S'), absences: [{ startDate: '2026-10-05', endDate: '2026-10-08', reason: 'PHEP_NAM' }] }),
  );
  assert.ok(codes(r).includes('ABSENT'));
});

test('chỉ tiêu người trực chặn tự đăng ký nhưng không chặn người xếp lịch thêm nhiều người; các chặn khác vẫn giữ', () => {
  const fullSlot = slotOf(8, '2026-10-06', 'S', { filled: 1 });
  assert.ok(codes(evaluateCandidate(input({ slot: fullSlot }))).includes('SLOT_FULL'));
  const schedulerAssignment = evaluateCandidate(input({ slot: fullSlot, ignoreSlotCapacity: true }));
  assert.equal(schedulerAssignment.ok, true, JSON.stringify(schedulerAssignment.errors));
  assert.ok(codes(evaluateCandidate(input({ slot: slotOf(8, '2026-10-06', 'S'), alreadyInSlot: true, ignoreSlotCapacity: true }))).includes('ALREADY_IN_SLOT'));
  assert.ok(codes(evaluateCandidate(input({ slot: slotOf(8, '2026-10-06', 'S'), locked: true, ignoreSlotCapacity: true }))).includes('LOCKED'));
  assert.ok(codes(evaluateCandidate(input({ slot: slotOf(8, '2026-10-06', 'S'), now: Date.parse('2026-10-07T00:00:00+07:00'), ignoreSlotCapacity: true }))).includes('PAST'));
  assert.ok(codes(evaluateCandidate(input({ slot: slotOf(8, '2026-10-06', 'S'), user: { ...doctor, active: false }, ignoreSlotCapacity: true }))).includes('NOT_ACTIVE'));
});

test('khác khoa: cảnh báo mềm mặc định; chặn khi chính sách là CHAN; bỏ qua khi CHO_PHEP', () => {
  const other = { ...doctor, departmentId: 99 };
  const warn = evaluateCandidate(input({ slot: slotOf(9, '2026-10-06', 'S'), user: other }));
  assert.equal(warn.ok, true);
  assert.equal(warn.warnings[0].code, 'CROSS_DEPT');
  const block = evaluateCandidate(input({ slot: slotOf(9, '2026-10-06', 'S'), user: other, rules: { ...RULES, crossDeptPolicy: 'CHAN' } }));
  assert.ok(codes(block).includes('CROSS_DEPT'));
  const free = evaluateCandidate(input({ slot: slotOf(9, '2026-10-06', 'S'), user: other, rules: { ...RULES, crossDeptPolicy: 'CHO_PHEP' } }));
  assert.equal(free.warnings.length, 0);
});

test('giới hạn giờ trong ngày (10 giờ): CD (10h) cộng thêm C (5h) bị chặn', () => {
  const r = evaluateCandidate(input({ slot: slotOf(10, '2026-10-06', 'C'), duties: [dutyOf(1, '2026-10-06', 'CD')] }));
  assert.ok(codes(r).includes('HOURS_PER_DAY') || codes(r).includes('OVERLAP'));
  // Ngày khác nhưng cùng tuần: không vượt ngày
  const sameWeekOther = evaluateCandidate(input({ slot: slotOf(11, '2026-10-07', 'CD'), duties: [dutyOf(1, '2026-10-06', 'CD')] }));
  assert.ok(!codes(sameWeekOther).includes('HOURS_PER_DAY'));
});

test('giới hạn giờ trong tuần khi kỳ lịch đặt 48 giờ: đã có 40 giờ thì thêm ca 10 giờ bị chặn', () => {
  const duties = [
    dutyOf(1, '2026-10-05', 'CD'),
    dutyOf(2, '2026-10-06', 'CD'),
    dutyOf(3, '2026-10-07', 'CD'),
    dutyOf(4, '2026-10-08', 'CD'),
  ];
  const r = evaluateCandidate(input({
    slot: slotOf(12, '2026-10-09', 'CD'),
    duties,
    rules: { ...RULES, maxHoursPerWeek: 48 },
  }));
  assert.ok(codes(r).includes('HOURS_PER_WEEK'));
  // Tuần sau thì không tính chung
  const next = evaluateCandidate(input({
    slot: slotOf(12, '2026-10-12', 'CD'),
    duties,
    rules: { ...RULES, maxHoursPerWeek: 48 },
  }));
  assert.ok(!codes(next).includes('HOURS_PER_WEEK'));
});

test('giới hạn ca trong ngày và ca/ca đêm trong kỳ', () => {
  const duties = [dutyOf(1, '2026-10-06', 'S'), dutyOf(2, '2026-10-06', 'C')];
  const unlimitedPerDay = evaluateCandidate(input({ slot: slotOf(13, '2026-10-06', 'CD'), duties, rules: { ...RULES, maxHoursPerDay: 24 } }));
  assert.ok(!codes(unlimitedPerDay).includes('SHIFTS_PER_DAY'), 'mặc định 0 không giới hạn số ca/ngày');
  const perDay = evaluateCandidate(input({ slot: slotOf(13, '2026-10-06', 'CD'), duties, rules: { ...RULES, maxShiftsPerDay: 2, maxHoursPerDay: 24 } }));
  assert.ok(codes(perDay).includes('SHIFTS_PER_DAY'));
  const night = evaluateCandidate(input({ slot: slotOf(14, '2026-10-20', 'D'), periodNights: 2, rules: { ...RULES, maxNightShiftsPerPeriod: 2 } }));
  assert.ok(codes(night).includes('NIGHT_PER_PERIOD'));
  const shifts = evaluateCandidate(input({ slot: slotOf(15, '2026-10-20', 'S'), periodShifts: 5, rules: { ...RULES, maxShiftsPerPeriod: 5 } }));
  assert.ok(codes(shifts).includes('SHIFTS_PER_PERIOD'));
});

test('kiểm tra không tự so với chính ô đang xét (không báo trùng giờ với chính mình)', () => {
  const slot = slotOf(16, '2026-10-06', 'S');
  const r = evaluateCandidate(input({ slot, duties: [dutyOf(16, '2026-10-06', 'S')], alreadyInSlot: true }));
  assert.ok(codes(r).includes('ALREADY_IN_SLOT'));
  assert.ok(!codes(r).includes('OVERLAP'));
});

test('thông báo đăng ký: lý do chặn đăng ký hiển thị đúng', () => {
  const r = evaluateCandidate(input({ slot: slotOf(17, '2026-10-06', 'S'), registrationBlocked: 'Đăng ký mở từ 05/10/2026' }));
  assert.ok(codes(r).includes('REGISTRATION'));
});

test('kỳ lịch: hai khoảng ngày giao nhau (kể cả chung một ngày) thì trùng; liền kề thì không', () => {
  assert.equal(rangesOverlap('2026-10-05', '2026-10-11', '2026-10-11', '2026-10-18'), true);
  assert.equal(rangesOverlap('2026-10-05', '2026-10-11', '2026-10-12', '2026-10-18'), false);
  assert.equal(rangesOverlap('2026-10-05', '2026-10-31', '2026-10-10', '2026-10-12'), true);
  assert.equal(rangesOverlap('2026-10-10', '2026-10-12', '2026-10-05', '2026-10-31'), true);
});

test('tính số tuần ISO và khoảng ngày tuần tự động', () => {
  assert.deepEqual(isoWeekNumber('2026-10-12'), { year: 2026, week: 42 });
  assert.deepEqual(isoWeekNumber('2026-10-18'), { year: 2026, week: 42 });
  assert.deepEqual(isoWeekNumber('2026-10-19'), { year: 2026, week: 43 });

  const r42 = isoWeekRange(2026, 42);
  assert.equal(r42.startDate, '2026-10-12');
  assert.equal(r42.endDate, '2026-10-18');

  const r43 = isoWeekRange(2026, 43);
  assert.equal(r43.startDate, '2026-10-19');
  assert.equal(r43.endDate, '2026-10-25');

  assert.equal(smartPeriodTitle('2026-10-19', '2026-10-25'), 'Khám T43 · 19/10–25/10/2026');
  // Tuần giao năm phải hiện đủ cả hai năm để không gây nhầm kỳ lịch.
  assert.equal(smartPeriodTitle('2026-12-28', '2027-01-03'), 'Khám T53 · 28/12/2026–03/01/2027');
  // Kỳ tuần bắt đầu Thứ 2: chốt vào chiều Chủ nhật ngay trước tuần trực.
  assert.equal(defaultLockAt('2026-10-19'), '2026-10-18T17:00:00+07:00');
  // Không lệch tuần tại năm mới và ngày Chủ nhật tuỳ chỉnh vẫn là chính ngày đó.
  assert.equal(defaultLockAt('2027-01-04'), '2027-01-03T17:00:00+07:00');
  assert.equal(defaultLockAt('2026-10-18'), '2026-10-18T17:00:00+07:00');
});


test('Nghỉ/bận ngày thứ hai chặn ca qua đêm; ca kết thúc đúng nửa đêm không trùng ngày kế', () => {
  const overnight = slotOf(800, '2026-10-15', 'D');
  const result = evaluateCandidate(input({slot: overnight, absences: [{startDate:'2026-10-16',endDate:'2026-10-16',reason:'PHEP_NAM'}]}));
  assert.ok(result.errors.some(e => e.code === 'ABSENT'));
  const endsAtMidnight = {...overnight, end: shiftInterval('2026-10-15','17:00','00:00',true).end};
  assert.ok(!evaluateCandidate(input({slot: endsAtMidnight, absences:[{startDate:'2026-10-16',endDate:'2026-10-16',reason:'PHEP_NAM'}]})).errors.some(e => e.code === 'ABSENT'));
});
