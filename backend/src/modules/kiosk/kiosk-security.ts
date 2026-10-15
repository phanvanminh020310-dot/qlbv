import * as crypto from "crypto";

/** Empty terminal is the legacy browser target, never a wildcard for native terminals. */
export function kioskTargetKey(roomCode: string, terminalId?: string): string {
  return `${roomCode.trim().toUpperCase()}\0${terminalId?.trim() || ""}`;
}

export function sameKioskTarget(
  a: { roomCode: string; terminalId?: string },
  b: { roomCode: string; terminalId?: string },
): boolean {
  return (
    kioskTargetKey(a.roomCode, a.terminalId) ===
    kioskTargetKey(b.roomCode, b.terminalId)
  );
}

/** Match only the configured PIN. No hard-coded support passwords or local bypass. */
export function matchesMasterPin(entered: string, configured: string): boolean {
  if (!configured || !entered || entered.length > 256) return false;
  const digest = (s: string) =>
    crypto.createHash("sha256").update(s, "utf8").digest();
  return crypto.timingSafeEqual(digest(entered), digest(configured));
}

/** Bounded, per-process throttling; reserve BEFORE asynchronous PIN lookups. */
export class KioskAttemptLimiter {
  private readonly entries = new Map<
    string,
    { count: number; expiresAt: number }
  >();

  constructor(
    private readonly limit = 5,
    private readonly windowMs = 10 * 60_000,
  ) {}

  take(key: string, now = Date.now()): boolean {
    for (const [k, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(k);
    }
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= 10_000) return false;
      entry = { count: 0, expiresAt: now + this.windowMs };
      this.entries.set(key, entry);
    }
    if (entry.count >= this.limit) return false;
    entry.count++;
    return true;
  }

  reset(key: string) {
    this.entries.delete(key);
  }
}

export function isBlockedKioskClient(userAgent = "", clientEnv = ""): boolean {
  return (
    ["in-app-webview", "forwarded-photo", "scanner-app"].includes(clientEnv) ||
    /zalo|micromessenger|fbav|fban|fb_iab|messenger|telegram|viber|\bline\b|instagram|threads|snapchat|tiktok|bytedance|wechat|gsa|googleapp|scanner|barcode|qrcode/i.test(
      userAgent,
    ) ||
    (/Version\/4\.0.*Chrome/i.test(userAgent) && /Android/i.test(userAgent)) ||
    /\bwv\b/i.test(userAgent) ||
    (/iPhone|iPad|iPod/i.test(userAgent) &&
      !/Version\/[\d.]+.*Safari/i.test(userAgent) &&
      /Mobile\//i.test(userAgent))
  );
}
