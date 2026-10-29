'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { tokenStore } from '@/lib/api';

/** Trang gốc: đã đăng nhập thì vào bảng điều khiển, chưa thì ra trang đăng nhập. */
export default function HomePage() {
  const router = useRouter();
  useEffect(() => {
    router.replace(tokenStore.access ? '/dashboard' : '/login');
  }, [router]);
  return (
    <div className="app-viewport-min flex items-center justify-center text-sm text-[var(--muted-foreground)]">
      Đang mở hệ thống…
    </div>
  );
}
