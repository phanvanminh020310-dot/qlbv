/**
 * Lớp gọi API dùng chung.
 *
 * - Token được lưu trong cookie `qlbs_access` để mở bản in ở tab mới vẫn xác thực được.
 * - Tự động làm mới phiên (refresh token) một lần khi gặp 401 rồi thử lại.
 * - Mọi phản hồi đều được bóc lớp { success, data } của backend.
 */
export const API_BASE = '/api';

/** Sự kiện phát ra khi máy chủ đang bảo trì (phục hồi CSDL) — MaintenanceOverlay lắng nghe */
export const MAINTENANCE_EVENT = 'qlbs:maintenance';
export function notifyMaintenance(detail: unknown): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(MAINTENANCE_EVENT, { detail }));
}

/** Sự kiện phát ra khi phiên đăng nhập hết hạn và làm mới cũng thất bại — ProtectedLayout đưa về /login */
export const SESSION_EXPIRED_EVENT = 'qlbs:session-expired';
export function notifySessionExpired(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}

const ACCESS_KEY = 'qlbs_access_token';
const REFRESH_KEY = 'qlbs_refresh_token';

export interface ApiError {
  statusCode: number;
  message: string;
  errors?: string[];
}

export class ApiRequestError extends Error {
  statusCode: number;
  errors?: string[];

  constructor(error: ApiError) {
    super(error.message);
    this.statusCode = error.statusCode;
    this.errors = error.errors;
  }
}

function setCookie(name: string, value: string, days = 1): void {
  if (typeof document === 'undefined') return;
  const expires = new Date(Date.now() + days * 86_400_000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

function deleteCookie(name: string): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
}

export const tokenStore = {
  get access(): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(ACCESS_KEY);
  },
  get refresh(): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(REFRESH_KEY);
  },
  set(access: string, refresh: string): void {
    window.localStorage.setItem(ACCESS_KEY, access);
    window.localStorage.setItem(REFRESH_KEY, refresh);
    // Cookie cùng tên với backend để các yêu cầu tải tệp (PDF/Excel) hoạt động ở tab mới
    setCookie('qlbs_access', access, 1);
  },
  clear(): void {
    window.localStorage.removeItem(ACCESS_KEY);
    window.localStorage.removeItem(REFRESH_KEY);
    deleteCookie('qlbs_access');
  },
};

type Options = Omit<RequestInit, 'body'> & {
  body?: unknown;
  /** Không bóc lớp dữ liệu (dùng khi cần nguyên phản hồi) */
  raw?: boolean;
  /** Bỏ qua tự động làm mới token */
  noRetry?: boolean;
};

let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  const refresh = tokenStore.refresh;
  if (!refresh) return false;
  if (!refreshing) {
    refreshing = fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refresh }),
    })
      .then(async (res) => {
        if (!res.ok) return false;
        const payload = await res.json();
        const data = payload?.data ?? payload;
        if (data?.accessToken && data?.refreshToken) {
          tokenStore.set(data.accessToken, data.refreshToken);
          return true;
        }
        return false;
      })
      .catch(() => false)
      .finally(() => {
        setTimeout(() => {
          refreshing = null;
        }, 50);
      });
  }
  return refreshing;
}

export async function apiFetch<T = unknown>(path: string, options: Options = {}): Promise<T> {
  const { body, raw, noRetry, headers, ...rest } = options;
  const access = tokenStore.access;

  // FormData / tệp nhị phân (Blob, File) được gửi nguyên vẹn; còn lại gửi JSON
  const passThrough = body instanceof FormData || (typeof Blob !== 'undefined' && body instanceof Blob);
  const response = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: {
      ...(body !== undefined && !passThrough ? { 'Content-Type': 'application/json' } : {}),
      ...(body instanceof Blob && !(body instanceof FormData) ? { 'Content-Type': 'application/octet-stream' } : {}),
      ...(access ? { Authorization: `Bearer ${access}` } : {}),
      ...(headers as Record<string, string> | undefined),
    },
    body: body === undefined ? undefined : passThrough ? (body as BodyInit) : JSON.stringify(body),
  });

  if (response.status === 401 && !noRetry) {
    const ok = await tryRefresh();
    if (ok) return apiFetch<T>(path, { ...options, noRetry: true });
    tokenStore.clear();
    notifySessionExpired();
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!response.ok) {
    let message = `Lỗi ${response.status}`;
    let errors: string[] | undefined;
    if (contentType.includes('application/json')) {
      const payload = await response.json().catch(() => null);
      message = payload?.message ?? message;
      if (response.status === 503 && payload?.code === 'MAINTENANCE') notifyMaintenance(payload.maintenance ?? { message });
      errors = Array.isArray(payload?.errors) ? payload.errors : undefined;
      if (Array.isArray(message)) {
        errors = message as unknown as string[];
        message = errors[0] ?? message;
      }
    }
    throw new ApiRequestError({ statusCode: response.status, message, errors });
  }

  if (raw || !contentType.includes('application/json')) {
    return response as unknown as T;
  }
  const payload = await response.json();
  if (payload && typeof payload === 'object' && 'success' in payload && 'data' in payload) {
    return payload.data as T;
  }
  return (payload?.data ?? payload) as T;
}

/** Tải tệp kết xuất (PDF/Excel/Word) về máy */
export async function downloadFile(path: string, fileName: string, options: Options = {}): Promise<void> {
  const response = await apiFetch<Response>(path, { ...options, raw: true });
  const blob = await (response as unknown as Response).blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Bảo đảm cookie `qlbs_access` còn hiệu lực trước khi trình duyệt tự tải tệp
 * (PDF/Excel mở ở tab mới hoặc trong iframe không gửi kèm header Authorization).
 * Gọi nhẹ `/auth/me`: nếu token hết hạn, apiFetch tự làm mới và ghi lại cookie.
 */
export async function ensureFileSession(): Promise<void> {
  const access = tokenStore.access;
  if (access && typeof document !== 'undefined' && !document.cookie.includes('qlbs_access=')) {
    setCookie('qlbs_access', access, 1);
  }
  try {
    await apiFetch('/auth/me');
  } catch {
    /* để trang tải tệp tự báo lỗi nếu phiên thực sự đã hết */
  }
}

/** Mở một đường dẫn tải tệp (PDF…) ở tab mới sau khi đã làm mới phiên đăng nhập. */
export async function openFileUrl(url: string): Promise<void> {
  // Mở tab ngay trong sự kiện bấm để không bị trình duyệt chặn cửa sổ bật lên
  const win = typeof window !== 'undefined' ? window.open('about:blank', '_blank') : null;
  await ensureFileSession();
  if (win) win.location.href = url;
  else window.location.href = url;
}
