import { apiFetch } from '@/lib/api';

export interface Branding {
  name: string;
  subtitle: string;
  logo: string;
  hospitalName: string;
}

export const PUBLIC_BRANDING_QUERY = ['settings', 'public-branding'] as const;

const text = (value: unknown, fallback: string, maxLength: number) => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized ? normalized.slice(0, maxLength) : fallback;
};

/** Chỉ cho phép URL ảnh hoặc Data URL đã được server kiểm tra; không đưa scheme lạ vào thẻ img. */
export function brandImageSource(value: unknown): string {
  if (typeof value !== 'string') return '';
  const source = value.trim();
  if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(source)) return source;
  if (/^https?:\/\//i.test(source) || source.startsWith('/')) return source;
  return '';
}

export function brandingFromSettings(settings?: Record<string, unknown>): Branding {
  return {
    name: text(settings?.['app.brandName'], 'QLBS', 80),
    subtitle: text(settings?.['app.brandSubtitle'], 'Quản lý bệnh viện', 120),
    logo: brandImageSource(settings?.['hospital.logo']),
    hospitalName: text(settings?.['hospital.name'], 'Bệnh viện', 160),
  };
}

export async function getPublicBranding(): Promise<Branding> {
  const settings = await apiFetch<Record<string, unknown>>('/settings/public');
  return brandingFromSettings(settings);
}
