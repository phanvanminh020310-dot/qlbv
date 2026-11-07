/**
 * Kho font cho bản in PDF.
 *
 *  - Font mặc định của mọi bản in: **Times New Roman**.
 *  - Font gốc của Microsoft không được phép phân phối kèm phần mềm, nên hệ thống nhúng sẵn
 *    font **Tinos** — font tương thích metric với Times New Roman (cùng độ rộng từng ký tự,
 *    bố cục/ngắt dòng giống hệt, đủ dấu tiếng Việt). Tương tự: Arial → Arimo, Courier New → Cousine.
 *  - Quản trị viên có thể tải lên tệp font gốc (times.ttf, timesbd.ttf…) — hệ thống đọc tên họ font
 *    ngay trong tệp, và từ đó mọi bản in dùng đúng font gốc thay cho font tương thích.
 *  - Font tải lên lưu ở `${STORAGE_DIR}/fonts` (nằm trong volume dữ liệu → không mất khi cập nhật).
 */
import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import fontkit from '@pdf-lib/fontkit';
import { config } from '../../config/env';

export type FontVariant = 'regular' | 'bold' | 'italic' | 'boldItalic';
export const FONT_VARIANTS: FontVariant[] = ['regular', 'bold', 'italic', 'boldItalic'];

export const DEFAULT_FONT_FAMILY = 'Times New Roman';

/** Font nhúng sẵn: họ font hiển thị → tệp trong assets/fonts */
const BUILTIN: Record<string, { substitute: string; files: Partial<Record<FontVariant, string>> }> = {
  'Times New Roman': {
    substitute: 'Tinos',
    files: {
      regular: 'Tinos-Regular.ttf',
      bold: 'Tinos-Bold.ttf',
      italic: 'Tinos-Italic.ttf',
      boldItalic: 'Tinos-BoldItalic.ttf',
    },
  },
  Arial: {
    substitute: 'Arimo',
    files: {
      regular: 'Arimo-Regular.ttf',
      bold: 'Arimo-Bold.ttf',
      italic: 'Arimo-Italic.ttf',
      boldItalic: 'Arimo-BoldItalic.ttf',
    },
  },
  'Courier New': {
    substitute: 'Cousine',
    files: {
      regular: 'Cousine-Regular.ttf',
      bold: 'Cousine-Bold.ttf',
      italic: 'Cousine-Italic.ttf',
      boldItalic: 'Cousine-BoldItalic.ttf',
    },
  },
  Roboto: {
    substitute: '',
    files: {
      regular: 'Roboto-Regular.ttf',
      bold: 'Roboto-Medium.ttf',
      italic: 'Roboto-Italic.ttf',
      boldItalic: 'Roboto-MediumItalic.ttf',
    },
  },
};

/** Tên gọi khác → họ font chuẩn (so khớp không phân biệt hoa thường) */
const ALIASES: Record<string, string> = {
  tinos: 'Times New Roman',
  times: 'Times New Roman',
  'times new roman': 'Times New Roman',
  timesnewroman: 'Times New Roman',
  'liberation serif': 'Times New Roman',
  serif: 'Times New Roman',
  'dejavu serif': 'Times New Roman',
  arial: 'Arial',
  arimo: 'Arial',
  helvetica: 'Arial',
  'liberation sans': 'Arial',
  'dejavu sans': 'Arial',
  'sans-serif': 'Arial',
  'courier new': 'Courier New',
  courier: 'Courier New',
  cousine: 'Courier New',
  'liberation mono': 'Courier New',
  monospace: 'Courier New',
  roboto: 'Roboto',
};

/** Ký tự tiếng Việt dùng để kiểm tra font tải lên có hiển thị được tiếng Việt không */
const VI_SAMPLE = 'ĐđĂăÂâÊêÔôƠơƯưÁáÀàẢảÃãẠạẤấẦầẨẩẪẫẬậẮắẰằẲẳẴẵẶặÉéẾếỀềỂểỄễỆệÍíỌọỐốỒồỔổỖỗỘộỚớỜờỞởỠỡỢợÚúỨứỪừỬửỮữỰựÝýỳỷỹỵ';

const MAX_FONT_BYTES = 30 * 1024 * 1024;
const logger = new Logger('FontRegistry');

interface FontEntry {
  family: string;
  variant: FontVariant;
  file: string; // đường dẫn tuyệt đối
  source: 'builtin' | 'custom';
  /** Tên tệp (với font tải lên) */
  fileName?: string;
  postscriptName?: string;
  missingVietnamese?: string;
}

export interface FontFamilyInfo {
  family: string;
  source: 'builtin' | 'custom' | 'mixed';
  /** Font tương thích đang dùng thay (khi chưa tải font gốc lên) */
  substitute: string | null;
  isDefault: boolean;
  variants: Record<
    FontVariant,
    { available: boolean; source: 'builtin' | 'custom' | 'fallback'; fileName?: string; missingVietnamese?: string }
  >;
}

function builtinDir(): string {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'assets', 'fonts'),
    path.resolve(__dirname, '..', '..', '..', 'assets', 'fonts'),
    path.resolve(__dirname, '..', '..', '..', '..', 'assets', 'fonts'),
    path.resolve(process.cwd(), 'assets', 'fonts'),
    path.resolve(process.cwd(), 'backend', 'assets', 'fonts'),
  ];
  return candidates.find((p) => fs.existsSync(path.join(p, 'Tinos-Regular.ttf'))) ??
    candidates.find((p) => fs.existsSync(p)) ??
    candidates[0];
}

export function customFontDir(): string {
  return path.join(config.storage.dir, 'fonts');
}

function variantFromSubfamily(subfamily: string, fullName: string): FontVariant {
  const s = `${subfamily} ${fullName}`.toLowerCase();
  const bold = /bold|black|heavy|semibold|demi/.test(s);
  const italic = /italic|oblique/.test(s);
  if (bold && italic) return 'boldItalic';
  if (bold) return 'bold';
  if (italic) return 'italic';
  return 'regular';
}

/** Chuẩn hoá tên họ font: alias → tên chuẩn; tên lạ giữ nguyên (font tải lên) */
export function canonicalFamily(name: string | undefined | null): string {
  const raw = String(name ?? '').trim().replace(/^['"]|['"]$/g, '');
  if (!raw) return DEFAULT_FONT_FAMILY;
  const alias = ALIASES[raw.toLowerCase()];
  return alias ?? raw;
}

class Registry {
  private entries: FontEntry[] | null = null;
  private bytesCache = new Map<string, Buffer>();
  /** Dấu thời gian thư mục font tải lên — đổi (vd chạy install-times-font.sh) thì tự nạp lại */
  private stamp = '';
  private checkedAt = 0;

  invalidate(): void {
    this.entries = null;
    this.bytesCache.clear();
  }

  private dirStamp(): string {
    try {
      const dir = customFontDir();
      const st = fs.statSync(dir);
      return `${st.mtimeMs}:${fs.readdirSync(dir).length}`;
    } catch {
      return 'none';
    }
  }

  private load(): FontEntry[] {
    if (this.entries && Date.now() - this.checkedAt > 5000) {
      this.checkedAt = Date.now();
      if (this.dirStamp() !== this.stamp) this.invalidate();
    }
    if (this.entries) return this.entries;
    this.stamp = this.dirStamp();
    this.checkedAt = Date.now();
    const list: FontEntry[] = [];
    const dir = builtinDir();
    for (const [family, spec] of Object.entries(BUILTIN)) {
      for (const variant of FONT_VARIANTS) {
        const file = spec.files[variant];
        if (!file) continue;
        const full = path.join(dir, file);
        if (fs.existsSync(full)) list.push({ family, variant, file: full, source: 'builtin', fileName: file });
      }
    }
    if (!list.some((e) => e.family === DEFAULT_FONT_FAMILY)) {
      logger.warn(`Không tìm thấy font Tinos (Times New Roman) tại ${dir}`);
    }
    // Font tải lên: ghi đè font nhúng sẵn cùng họ + kiểu
    const cdir = customFontDir();
    if (fs.existsSync(cdir)) {
      for (const name of fs.readdirSync(cdir)) {
        if (!/\.(ttf|otf)$/i.test(name)) continue;
        const full = path.join(cdir, name);
        try {
          const info = inspectFont(fs.readFileSync(full));
          const existing = list.findIndex((e) => e.family === info.family && e.variant === info.variant);
          const entry: FontEntry = {
            family: info.family,
            variant: info.variant,
            file: full,
            source: 'custom',
            fileName: name,
            postscriptName: info.postscriptName,
            missingVietnamese: info.missingVietnamese,
          };
          if (existing >= 0) list[existing] = entry;
          else list.push(entry);
        } catch (err) {
          logger.warn(`Bỏ qua tệp font lỗi ${name}: ${(err as Error).message}`);
        }
      }
    }
    this.entries = list;
    return list;
  }

  /** Tìm tệp font phù hợp nhất cho (họ, kiểu) — có dự phòng */
  resolve(familyName: string | undefined, variant: FontVariant): FontEntry {
    const entries = this.load();
    const family = canonicalFamily(familyName);
    const find = (fam: string, v: FontVariant) => entries.find((e) => e.family === fam && e.variant === v);
    const fallbackVariants: FontVariant[] =
      variant === 'boldItalic' ? ['boldItalic', 'bold', 'italic', 'regular'] : [variant, 'regular'];
    for (const v of fallbackVariants) {
      const hit = find(family, v);
      if (hit) return hit;
    }
    // Không phân biệt hoa thường với font tải lên
    const ci = entries.filter((e) => e.family.toLowerCase() === family.toLowerCase());
    for (const v of fallbackVariants) {
      const hit = ci.find((e) => e.variant === v);
      if (hit) return hit;
    }
    for (const v of fallbackVariants) {
      const hit = find(DEFAULT_FONT_FAMILY, v);
      if (hit) return hit;
    }
    const any = entries[0];
    if (!any) throw new Error('Không có tệp font nào để nhúng vào bản in');
    return any;
  }

  bytes(entry: FontEntry): Buffer {
    const cached = this.bytesCache.get(entry.file);
    if (cached) return cached;
    const buf = fs.readFileSync(entry.file);
    this.bytesCache.set(entry.file, buf);
    return buf;
  }

  families(): FontFamilyInfo[] {
    const entries = this.load();
    const names = Array.from(new Set([...Object.keys(BUILTIN), ...entries.map((e) => e.family)]));
    return names.map((family) => {
      const own = entries.filter((e) => e.family === family);
      const sources = new Set(own.map((e) => e.source));
      const variants = {} as FontFamilyInfo['variants'];
      for (const v of FONT_VARIANTS) {
        const e = own.find((x) => x.variant === v);
        variants[v] = e
          ? { available: true, source: e.source, fileName: e.fileName, missingVietnamese: e.missingVietnamese }
          : { available: false, source: 'fallback' };
      }
      const allCustom = own.length > 0 && own.every((e) => e.source === 'custom');
      return {
        family,
        source: sources.size > 1 ? 'mixed' : allCustom ? 'custom' : 'builtin',
        substitute: own.some((e) => e.source === 'builtin') ? BUILTIN[family]?.substitute || null : null,
        isDefault: family === DEFAULT_FONT_FAMILY,
        variants,
      };
    });
  }

  customFiles(): FontEntry[] {
    return this.load().filter((e) => e.source === 'custom');
  }
}

export const fontRegistry = new Registry();

/** Đọc thông tin họ font / kiểu chữ từ tệp TTF/OTF */
export function inspectFont(buf: Buffer): {
  family: string;
  variant: FontVariant;
  postscriptName: string;
  missingVietnamese: string;
} {
  let font: ReturnType<typeof fontkit.create>;
  try {
    font = fontkit.create(buf);
  } catch {
    throw new BadRequestException('Tệp không phải font TrueType/OpenType hợp lệ');
  }
  const f = font as unknown as {
    familyName?: string;
    subfamilyName?: string;
    fullName?: string;
    postscriptName?: string;
    fonts?: unknown[];
    name?: { records?: Record<string, Record<string, string>> };
    hasGlyphForCodePoint: (cp: number) => boolean;
  };
  if (Array.isArray(f.fonts)) {
    throw new BadRequestException('Tệp .ttc (bộ nhiều font) chưa được hỗ trợ — hãy dùng tệp .ttf riêng lẻ');
  }
  // Ưu tiên "Typographic Family" (nameID 16) nếu có, vd "Times New Roman" thay vì "Times New Roman Bold"
  const records = f.name?.records ?? {};
  const pick = (rec: Record<string, string> | undefined): string | undefined =>
    rec ? rec.en ?? Object.values(rec)[0] : undefined;
  const preferredFamily = pick(records['preferredFamily']);
  const preferredSub = pick(records['preferredSubfamily']);
  const family = canonicalFamily((preferredFamily ?? f.familyName ?? '').trim());
  if (!family) throw new BadRequestException('Không đọc được tên họ font trong tệp');
  const variant = variantFromSubfamily(preferredSub ?? f.subfamilyName ?? '', f.fullName ?? '');
  const missing = [...VI_SAMPLE].filter((c) => !f.hasGlyphForCodePoint(c.codePointAt(0) ?? 0)).join('');
  return { family, variant, postscriptName: f.postscriptName ?? '', missingVietnamese: missing };
}

/** Lưu font tải lên, trả thông tin đã nhận diện */
export function saveCustomFont(buf: Buffer, originalName: string) {
  if (!buf.length) throw new BadRequestException('Tệp font rỗng');
  if (buf.length > MAX_FONT_BYTES) throw new BadRequestException('Tệp font quá lớn (tối đa 30 MB)');
  const ext = /\.otf$/i.test(originalName) ? '.otf' : '.ttf';
  const info = inspectFont(buf);
  if (info.missingVietnamese.length > VI_SAMPLE.length / 2) {
    throw new BadRequestException(
      `Font "${info.family}" không hỗ trợ tiếng Việt Unicode (thiếu ${info.missingVietnamese.length} ký tự có dấu) — không thể dùng cho bản in`,
    );
  }
  const dir = customFontDir();
  fs.mkdirSync(dir, { recursive: true });
  const safeFamily = info.family.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'font';
  const fileName = `${safeFamily}-${info.variant}${ext}`;
  const finalPath = path.join(dir, fileName);
  const temporaryPath = `${finalPath}.qlbs-write-${randomUUID()}.partial`;
  try {
    fs.writeFileSync(temporaryPath, buf, { mode: 0o600 });
    fs.renameSync(temporaryPath, finalPath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
  // Xoá tệp cũ cùng họ + kiểu (khác phần mở rộng) chỉ SAU khi phiên bản mới đã công bố.
  for (const e of fontRegistry.customFiles()) {
    if (e.family === info.family && e.variant === info.variant && path.resolve(e.file) !== path.resolve(finalPath) && fs.existsSync(e.file)) {
      fs.unlinkSync(e.file);
    }
  }
  fontRegistry.invalidate();
  return { ...info, fileName, size: buf.length };
}

export function deleteCustomFont(family: string, variant?: FontVariant): { deleted: number } {
  const fam = canonicalFamily(family);
  let deleted = 0;
  for (const e of fontRegistry.customFiles()) {
    if (e.family !== fam) continue;
    if (variant && e.variant !== variant) continue;
    if (fs.existsSync(e.file)) {
      fs.unlinkSync(e.file);
      deleted++;
    }
  }
  if (!deleted) throw new NotFoundException('Không có tệp font tải lên nào khớp');
  fontRegistry.invalidate();
  return { deleted };
}
