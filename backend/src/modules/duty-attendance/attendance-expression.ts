import { BadRequestException } from '@nestjs/common';

/**
 * Evaluates the tiny expression language used by attendance formulas/rules.
 * There is deliberately no eval/new Function: only arithmetic, references and
 * comparisons are accepted. References are written as [MA_COT], e.g. [T] * 0.5.
 */
type Token = { type: 'number' | 'reference' | 'operator' | 'paren' | 'eof'; value: string };
type Value = number | boolean;

const REF = /^[A-Z][A-Z0-9_]{0,31}$/;
const OPERATORS = ['==', '!=', '<=', '>=', '&&', '||', '+', '-', '*', '/', '%', '<', '>'];

export function expressionReferences(expression: string): string[] {
  const found = [...expression.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1].trim().toUpperCase());
  for (const ref of found) if (!REF.test(ref)) throw new BadRequestException(`Mã tham chiếu “${ref}” không hợp lệ. Dùng chữ in hoa, số và dấu gạch dưới.`);
  return [...new Set(found)];
}

function tokens(input: string): Token[] {
  const source = input.trim().replace(/,/g, '.');
  if (!source) throw new BadRequestException('Biểu thức không được để trống');
  const out: Token[] = [];
  let at = 0;
  while (at < source.length) {
    if (/\s/.test(source[at])) { at++; continue; }
    if (source[at] === '[') {
      const end = source.indexOf(']', at + 1);
      if (end < 0) throw new BadRequestException('Thiếu dấu ] trong biểu thức');
      const key = source.slice(at + 1, end).trim().toUpperCase();
      if (!REF.test(key)) throw new BadRequestException(`Mã tham chiếu “${key}” không hợp lệ`);
      out.push({ type: 'reference', value: key }); at = end + 1; continue;
    }
    const number = source.slice(at).match(/^\d+(?:\.\d+)?/);
    if (number) { out.push({ type: 'number', value: number[0] }); at += number[0].length; continue; }
    const op = OPERATORS.find((item) => source.startsWith(item, at));
    if (op) { out.push({ type: 'operator', value: op }); at += op.length; continue; }
    if (source[at] === '(' || source[at] === ')') { out.push({ type: 'paren', value: source[at++] }); continue; }
    throw new BadRequestException(`Ký tự “${source[at]}” không được hỗ trợ trong biểu thức`);
  }
  out.push({ type: 'eof', value: '' });
  return out;
}

class Parser {
  private at = 0;
  constructor(private readonly input: Token[], private readonly variables: Record<string, string | number | undefined>) {}
  private peek() { return this.input[this.at]; }
  private accept(value: string) { if (this.peek().value === value) { this.at++; return true; } return false; }
  private required(value: string) { if (!this.accept(value)) throw new BadRequestException(`Thiếu “${value}” trong biểu thức`); }
  private number(value: Value) { return typeof value === 'boolean' ? Number(value) : value; }
  private bool(value: Value) { return typeof value === 'boolean' ? value : value !== 0; }

  parse(): Value {
    const result = this.or();
    if (this.peek().type !== 'eof') throw new BadRequestException(`Biểu thức không hợp lệ gần “${this.peek().value}”`);
    return result;
  }
  private or(): Value { let value = this.and(); while (this.accept('||')) value = this.bool(value) || this.bool(this.and()); return value; }
  private and(): Value { let value = this.compare(); while (this.accept('&&')) value = this.bool(value) && this.bool(this.compare()); return value; }
  private compare(): Value {
    let value = this.add();
    const operator = this.peek().value;
    if (['==', '!=', '<=', '>=', '<', '>'].includes(operator)) {
      this.at++; const right = this.add(); const leftNumber = this.number(value); const rightNumber = this.number(right);
      if (operator === '==') value = Math.abs(leftNumber - rightNumber) < 0.000001;
      if (operator === '!=') value = Math.abs(leftNumber - rightNumber) >= 0.000001;
      if (operator === '<=') value = leftNumber <= rightNumber;
      if (operator === '>=') value = leftNumber >= rightNumber;
      if (operator === '<') value = leftNumber < rightNumber;
      if (operator === '>') value = leftNumber > rightNumber;
    }
    return value;
  }
  private add(): Value { let value = this.multiply(); while (['+', '-'].includes(this.peek().value)) { const op = this.peek().value; this.at++; const right = this.number(this.multiply()); value = op === '+' ? this.number(value) + right : this.number(value) - right; } return value; }
  private multiply(): Value {
    let value = this.unary();
    while (['*', '/', '%'].includes(this.peek().value)) {
      const op = this.peek().value; this.at++; const right = this.number(this.unary());
      if ((op === '/' || op === '%') && right === 0) throw new BadRequestException('Không thể chia hoặc lấy phần dư cho 0');
      value = op === '*' ? this.number(value) * right : op === '/' ? this.number(value) / right : this.number(value) % right;
    }
    return value;
  }
  private unary(): Value { if (this.accept('-')) return -this.number(this.unary()); if (this.accept('+')) return this.number(this.unary()); return this.primary(); }
  private primary(): Value {
    const token = this.peek();
    if (token.type === 'number') { this.at++; return Number(token.value); }
    if (token.type === 'reference') { this.at++; const raw = this.variables[token.value]; const number = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim().replace(',', '.')); return Number.isFinite(number) ? number : 0; }
    if (this.accept('(')) { const value = this.or(); this.required(')'); return value; }
    throw new BadRequestException(`Cần một số hoặc mã tham chiếu gần “${token.value}”`);
  }
}

export function evaluateExpression(expression: string, variables: Record<string, string | number | undefined>): Value {
  const result = new Parser(tokens(expression), variables).parse();
  if (typeof result === 'number' && !Number.isFinite(result)) throw new BadRequestException('Kết quả công thức không hợp lệ');
  return result;
}

export function numericExpression(expression: string, variables: Record<string, string | number | undefined>) {
  const result = evaluateExpression(expression, variables);
  if (typeof result === 'boolean') throw new BadRequestException('Cột công thức chỉ nhận biểu thức số, không nhận phép so sánh');
  return Math.round(result * 1_000_000) / 1_000_000;
}

export function booleanExpression(expression: string, variables: Record<string, string | number | undefined>) {
  const result = evaluateExpression(expression, variables);
  return typeof result === 'boolean' ? result : Boolean(result);
}
