'use client';

import { useEffect } from 'react';

/**
 * Safari on iPhone changes the *visual* viewport whenever its URL/toolbar or
 * keyboard appears. CSS `vh` then points at a different viewport from fixed
 * layers, which makes headers, footers and modal frames visibly jump. Keep one
 * CSS variable in sync with the actual visual viewport and use it only for
 * full-height application shells.
 */
export function MobileViewportStabilizer() {
  useEffect(() => {
    const ua = navigator.userAgent;
    const isAppleTouch = /iPad|iPhone|iPod/i.test(ua)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!isAppleTouch) return;

    const root = document.documentElement;
    root.classList.add('ios-visual-viewport');
    const viewport = window.visualViewport;
    let frame = 0;

    const sync = () => {
      frame = 0;
      // visualViewport is available in supported iOS Safari. innerHeight is a
      // safe fallback for embedded browsers/older WebKit.
      const height = Math.max(1, Math.round(viewport?.height ?? window.innerHeight));
      root.style.setProperty('--qlbs-viewport-height', `${height}px`);
    };
    const requestSync = () => {
      if (!frame) frame = window.requestAnimationFrame(sync);
    };

    sync();
    window.addEventListener('resize', requestSync, { passive: true });
    window.addEventListener('orientationchange', requestSync, { passive: true });
    viewport?.addEventListener('resize', requestSync, { passive: true });
    // iOS also reports a visual viewport scroll while the browser chrome is
    // expanding/collapsing. Coalescing in rAF avoids layout thrashing.
    viewport?.addEventListener('scroll', requestSync, { passive: true });

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', requestSync);
      window.removeEventListener('orientationchange', requestSync);
      viewport?.removeEventListener('resize', requestSync);
      viewport?.removeEventListener('scroll', requestSync);
      root.classList.remove('ios-visual-viewport');
      root.style.removeProperty('--qlbs-viewport-height');
    };
  }, []);

  return null;
}
