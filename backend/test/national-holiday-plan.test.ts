import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nationalHolidayProposal, vietnameseLunarToSolar } from '../src/modules/duty-attendance/national-holiday-plan';

test('đổi âm lịch Việt Nam sang dương lịch đúng các mốc Tết và Giỗ Tổ đã biết', () => {
  assert.equal(vietnameseLunarToSolar(1, 1, 2024), '2024-02-10');
  assert.equal(vietnameseLunarToSolar(1, 1, 2025), '2025-01-29');
  assert.equal(vietnameseLunarToSolar(1, 1, 2026), '2026-02-17');
  assert.equal(vietnameseLunarToSolar(1, 1, 2027), '2027-02-06');
  assert.equal(vietnameseLunarToSolar(10, 3, 2024), '2024-04-18');
  assert.equal(vietnameseLunarToSolar(10, 3, 2025), '2025-04-07');
  assert.equal(vietnameseLunarToSolar(10, 3, 2027), '2027-04-16');
});

test('dự thảo lịch lễ có đủ mốc pháp định, ngày Quốc khánh tùy chỉnh và không tự ghi CSDL', () => {
  const proposal = nationalHolidayProposal({ year: 2026, tetStartOffset: -2, tetDayCount: 5, nationalDayAdjacent: 'BEFORE', compensateWeeklyRest: false, note: 'Theo phương án bệnh viện' });
  assert.equal(proposal.lunarNewYear, '2026-02-17');
  assert.ok(proposal.candidates.some((holiday) => holiday.date === '2026-01-01' && holiday.ruleKey === 'NEW_YEAR'));
  assert.ok(proposal.candidates.some((holiday) => holiday.date === '2026-04-26' && holiday.ruleKey === 'HUNG_KINGS'));
  assert.ok(proposal.candidates.some((holiday) => holiday.date === '2026-09-01' && holiday.ruleKey === 'NATIONAL_DAY_ADJACENT'));
  assert.equal(proposal.candidates.some((holiday) => holiday.kind === 'SUBSTITUTE'), false, 'tắt nghỉ bù không sinh ngày ngoài phương án');
  assert.match(proposal.warnings.join(' '), /đối chiếu thông báo nghỉ hằng năm/);
});

test('ngày lễ trùng cuối tuần sinh nghỉ bù sau toàn bộ ngày lễ liền kề, không trùng ngày khác', () => {
  const proposal = nationalHolidayProposal({ year: 2023, tetStartOffset: 0, tetDayCount: 1, nationalDayAdjacent: 'AFTER', compensateWeeklyRest: true });
  const keys = new Set(proposal.candidates.map((holiday) => holiday.date));
  assert.equal(keys.size, proposal.candidates.length, 'mỗi ngày chỉ xuất hiện một lần');
  assert.ok(proposal.candidates.some((holiday) => holiday.date === '2023-01-02' && holiday.ruleKey === 'SUBSTITUTE_NEW_YEAR'));
  assert.ok(proposal.candidates.some((holiday) => holiday.date === '2023-05-03' && holiday.ruleKey === 'SUBSTITUTE_REUNIFICATION'), 'khi Giỗ Tổ, 30/4 và 01/5 liền nhau, nghỉ bù phải lần lượt xếp sau toàn bộ ngày đã giữ chỗ');
});

test('phương án nhận ngày nghỉ được duyệt và ngày làm bù theo thông báo, nhưng chặn ngày có hiệu lực mâu thuẫn', () => {
  const proposal = nationalHolidayProposal({
    year: 2026, tetStartOffset: -2, tetDayCount: 5, nationalDayAdjacent: 'AFTER', compensateWeeklyRest: false,
    additionalRestDays: [{ date: '2026-02-23', name: 'Nghỉ kéo dài', note: 'Thông báo' }],
    compensatoryWorkdays: [{ date: '2026-02-21', name: 'Làm bù', note: 'Thông báo' }],
  });
  assert.equal(proposal.candidates.find((item) => item.date === '2026-02-23')?.kind, 'APPROVED_ADJUSTMENT');
  assert.deepEqual(proposal.workdayCandidates, [{ date: '2026-02-21', name: 'Làm bù', note: 'Thông báo', ruleKey: 'COMPENSATORY_WORKDAY_20260221', kind: 'COMPENSATORY_WORKDAY' }]);
  assert.throws(() => nationalHolidayProposal({ ...proposal.plan, compensatoryWorkdays: [{ date: '2026-02-23', name: 'Sai', note: '' }] }), /không thể đồng thời là ngày nghỉ/);
});
