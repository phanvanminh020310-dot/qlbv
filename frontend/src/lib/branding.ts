import { apiFetch } from '@/lib/api';
import { brandingFromSettings, type Branding } from '@/lib/branding-assets';

export type { Branding } from '@/lib/branding-assets';
export { brandImageSource, brandingIconRevision, brandingIconUrl, brandingManifestUrl, brandingLogoUrl, embeddedBrandImage, embeddedBrandMime } from '@/lib/branding-assets';

export const PUBLIC_BRANDING_QUERY = ['settings', 'public-branding'] as const;

export { brandingFromSettings };

export async function getPublicBranding(): Promise<Branding> {
  const settings = await apiFetch<Record<string, unknown>>('/settings/public');
  return brandingFromSettings(settings);
}
