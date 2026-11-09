/** Safe client-side preview of attendance formulas/rules. Server validation remains authoritative. */
type Value = number | boolean;
type Token = { type: 'number' | 'ref' | 'op' | 'paren' | 'eof'; value: string };
const KEY = /^[A-Z][A-Z0-9_]{0,31}$/;
const OPS = ['==', '!=', '<=', '>=', '&&', '||', '+', '-', '*', '/', '%', '<', '>'];

export const attendanceReferences = (expression: string) => [...new Set([...expression.matchAll(/\[([^\]]+)\]/g)].map((item) => item[1].trim().toUpperCase()))];

function lex(expression: string): Token[] {
  const text = expression.trim().replace(/,/g, '.'); const result: Token[] = []; let at = 0;
  while (at < text.length) {
    if (/\s/.test(text[at])) { at++; continue; }
    if (text[at] === '[') { const end = text.indexOf(']', at + 1); if (end < 0) throw new Error('Thiếu dấu ]'); const value = text.slice(at + 1, end).trim().toUpperCase(); if (!KEY.test(value)) throw new Error('Mã tham chiếu không hợp lệ'); result.push({ type: 'ref', value }); at = end + 1; continue; }
    const number = text.slice(at).match(/^\d+(?:\.\d+)?/); if (number) { result.push({ type: 'number', value: number[0] }); at += number[0].length; continue; }
    const op = OPS.find((item) => text.startsWith(item, at)); if (op) { result.push({ type: 'op', value: op }); at += op.length; continue; }
    if (text[at] === '(' || text[at] === ')') { result.push({ type: 'paren', value: text[at++] }); continue; }
    throw new Error('Ký tự không hỗ trợ');
  }
  return [...result, { type: 'eof', value: '' }];
}

class Parser {
  private at = 0;
  constructor(private readonly tokens: Token[], private readonly values: Record<string, string | number | undefined>) {}
  private peek() { return this.tokens[this.at]; }
  private take(value: string) { if (this.peek().value === value) { this.at++; return true; } return false; }
  private num(value: Value) { return typeof value === 'boolean' ? Number(value) : value; }
  private bool(value: Value) { return typeof value === 'boolean' ? value : value !== 0; }
  parse() { const value = this.or(); if (this.peek().type !== 'eof') throw new Error('Biểu thức không hợp lệ'); return value; }
  private or(): Value { let value = this.and(); while (this.take('||')) value = this.bool(value) || this.bool(this.and()); return value; }
  private and(): Value { let value = this.compare(); while (this.take('&&')) value = this.bool(value) && this.bool(this.compare()); return value; }
  private compare(): Value { let value = this.add(); const op = this.peek().value; if (['==', '!=', '<=', '>=', '<', '>'].includes(op)) { this.at++; const right = this.num(this.add()); const left = this.num(value); if (op === '==') value = Math.abs(left - right) < 0.000001; if (op === '!=') value = Math.abs(left - right) >= 0.000001; if (op === '<=') value = left <= right; if (op === '>=') value = left >= right; if (op === '<') value = left < right; if (op === '>') value = left > right; } return value; }
  private add(): Value { let value = this.multiply(); while (['+', '-'].includes(this.peek().value)) { const op = this.peek().value; this.at++; const right = this.num(this.multiply()); value = op === '+' ? this.num(value) + right : this.num(value) - right; } return value; }
  private multiply(): Value { let value = this.unary(); while (['*', '/', '%'].includes(this.peek().value)) { const op = this.peek().value; this.at++; const right = this.num(this.unary()); if ((op === '/' || op === '%') && right === 0) throw new Error('Chia cho 0'); value = op === '*' ? this.num(value) * right : op === '/' ? this.num(value) / right : this.num(value) % right; } return value; }
  private unary(): Value { if (this.take('-')) return -this.num(this.unary()); if (this.take('+')) return this.num(this.unary()); return this.primary(); }
  private primary(): Value { const token = this.peek(); if (token.type === 'number') { this.at++; return Number(token.value); } if (token.type === 'ref') { this.at++; const raw = this.values[token.value]; const value = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim().replace(',', '.')); return Number.isFinite(value) ? value : 0; } if (this.take('(')) { const value = this.or(); if (!this.take(')')) throw new Error('Thiếu dấu )'); return value; } throw new Error('Thiếu số hoặc mã tham chiếu'); }
}

export function previewAttendanceExpression(expression: string, values: Record<string, string | number | undefined>): Value { return new Parser(lex(expression), values).parse(); }
export function previewAttendanceNumber(expression: string, values: Record<string, string | number | undefined>) { const value = previewAttendanceExpression(expression, values); if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Công thức số không hợp lệ'); return Math.round(value * 1_000_000) / 1_000_000; }
export function previewAttendanceBoolean(expression: string, values: Record<string, string | number | undefined>) { const value = previewAttendanceExpression(expression, values); return typeof value === 'boolean' ? value : value !== 0; }
