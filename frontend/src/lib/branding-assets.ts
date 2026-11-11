export interface Branding {
  name: string;
  subtitle: string;
  logo: string;
  hospitalName: string;
  /** Thay đổi theo logo để trình duyệt/PWA không dùng lại biểu tượng đã cache. */
  iconRevision: string;
}

const DATA_IMAGE = /^data:(image\/(png|jpeg|webp));base64,[A-Za-z0-9+/]+={0,2}$/i;

const text = (value: unknown, fallback: string, maxLength: number) => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized ? normalized.slice(0, maxLength) : fallback;
};

/** Chỉ cho phép URL ảnh hoặc Data URL đã được server kiểm tra; không đưa scheme lạ vào thẻ img. */
export function brandImageSource(value: unknown): string {
  if (typeof value !== 'string') return '';
  const source = value.trim();
  if (DATA_IMAGE.test(source)) return source;
  if (/^https?:\/\//i.test(source) || source.startsWith('/')) return source;
  return '';
}

/** Icon máy cài/PWA luôn được dựng từ Data URL đã kiểm tra, không để route server tải URL tùy ý. */
export function embeddedBrandImage(value: unknown): string {
  const source = brandImageSource(value);
  return DATA_IMAGE.test(source) ? source : '';
}

export function embeddedBrandMime(value: unknown): 'image/png' | 'image/jpeg' | 'image/webp' | '' {
  const match = DATA_IMAGE.exec(embeddedBrandImage(value));
  return (match?.[1].toLowerCase() as 'image/png' | 'image/jpeg' | 'image/webp' | undefined) ?? '';
}

/** Hash FNV-1a ngắn, ổn định trên client/server, chỉ dùng để thay URL icon khi logo đổi. */
export function brandingIconRevision(value: unknown): string {
  const source = brandImageSource(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function brandingFromSettings(settings?: Record<string, unknown>): Branding {
  const logo = brandImageSource(settings?.['hospital.logo']);
  return {
    name: text(settings?.['app.brandName'], 'QLBS', 80),
    subtitle: text(settings?.['app.brandSubtitle'], 'Quản lý bệnh viện', 120),
    logo,
    hospitalName: text(settings?.['hospital.name'], 'Bệnh viện', 160),
    iconRevision: brandingIconRevision(logo),
  };
}

export function brandingIconUrl(size: 32 | 180 | 192 | 512, revision?: string): string {
  const query = revision ? `?v=${encodeURIComponent(revision)}` : '';
  return `/branding-icon/${size}${query}`;
}

export function brandingManifestUrl(revision?: string): string {
  const query = revision ? `?v=${encodeURIComponent(revision)}` : '';
  return `/branding-manifest.webmanifest${query}`;
}

/** Trả logo gốc cho dữ liệu WebP cũ; logo chọn mới được chuẩn hoá về PNG trước khi lưu. */
export function brandingLogoUrl(revision?: string): string {
  const query = revision ? `?v=${encodeURIComponent(revision)}` : '';
  return `/branding-logo${query}`;
}
