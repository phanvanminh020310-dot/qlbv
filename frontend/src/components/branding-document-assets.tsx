'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { brandingIconUrl, brandingLogoUrl, brandingManifestUrl, embeddedBrandMime, getPublicBranding, PUBLIC_BRANDING_QUERY } from '@/lib/branding';

type LinkAttributes = Record<string, string>;

function updateLink(rel: string, href: string, attributes: LinkAttributes = {}) {
  const selector = `link[rel="${rel}"][data-qlbs-brand-asset="true"]`;
  const existingBrandLink = Array.from(document.head.querySelectorAll<HTMLLinkElement>(`link[rel="${rel}"]`))
    .find((item) => item.getAttribute('href')?.includes('/branding-'));
  let link = document.head.querySelector<HTMLLinkElement>(selector) ?? existingBrandLink;
  if (!link) {
    link = document.createElement('link');
    link.rel = rel;
    document.head.append(link);
  }
  link.dataset.qlbsBrandAsset = 'true';
  link.href = href;
  for (const [name, value] of Object.entries(attributes)) {
    if (value) link.setAttribute(name, value);
    else link.removeAttribute(name);
  }
}

/** Đồng bộ icon của tab, iOS và manifest ngay khi quản trị viên đổi logo. */
export function BrandingDocumentAssets() {
  const { data: branding } = useQuery({
    queryKey: PUBLIC_BRANDING_QUERY,
    queryFn: getPublicBranding,
    staleTime: 300_000,
  });

  useEffect(() => {
    if (!branding) return;
    const revision = branding.iconRevision;
    // Logo tải lên được rasterize thành PNG chuẩn kích thước; path cũ và WebP cũ vẫn được giữ nguyên để tương thích dữ liệu đã có.
    const directLogo = branding.logo && !branding.logo.startsWith('data:') ? branding.logo : '';
    const webpLogo = embeddedBrandMime(branding.logo) === 'image/webp';
    const iconSource = directLogo || (webpLogo ? brandingLogoUrl(revision) : brandingIconUrl(32, revision));
    const appleSource = directLogo || (webpLogo ? brandingLogoUrl(revision) : brandingIconUrl(180, revision));
    updateLink('icon', iconSource, { sizes: directLogo || webpLogo ? 'any' : '32x32', type: webpLogo ? 'image/webp' : directLogo ? '' : 'image/png' });
    updateLink('apple-touch-icon', appleSource, { sizes: directLogo || webpLogo ? 'any' : '180x180', type: webpLogo ? 'image/webp' : directLogo ? '' : 'image/png' });
    updateLink('manifest', brandingManifestUrl(revision), { type: 'application/manifest+json' });
    const applicationName = document.head.querySelector<HTMLMetaElement>('meta[name="application-name"]');
    if (applicationName) applicationName.content = branding.name;
    const appleTitle = document.head.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
    if (appleTitle) appleTitle.content = branding.name;
  }, [branding]);

  return null;
}
