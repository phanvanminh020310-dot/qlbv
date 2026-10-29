'use client';

import { Hospital, LogIn } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { useAuth } from '@/lib/auth';
import { tokenStore } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const login = useAuth((s) => s.login);
  const loading = useAuth((s) => s.loading);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (tokenStore.access) router.replace('/dashboard');
  }, [router]);

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    try {
      const user = await login(username.trim(), password);
      toast.success(`Xin chào ${user.fullName}`);
      router.replace('/dashboard');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="app-viewport-min app-safe-page grid lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between bg-[var(--primary)] p-10 text-white lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-2xl bg-white/15">
            <Hospital className="size-6" />
          </div>
          <div>
            <div className="text-lg font-semibold">QLBS</div>
            <div className="text-xs text-white/75">Phần mềm Quản lý Bệnh viện</div>
          </div>
        </div>
        <div />
        <div className="text-xs text-white/60">Hệ thống dùng nội bộ — Bệnh viện Quân y 4</div>
      </div>

      <div className="flex items-center justify-center p-6">
        <form onSubmit={onSubmit} className="w-full max-w-sm space-y-5">
          <div className="space-y-1 text-center lg:text-left">
            <div className="flex items-center justify-center gap-2 lg:justify-start">
              <Hospital className="size-6 text-[var(--primary)] lg:hidden" />
              <span className="text-xl font-semibold">Đăng nhập hệ thống</span>
            </div>
            <p className="text-sm text-[var(--muted-foreground)]">
              Dùng tài khoản được cấp bởi quản trị viên bệnh viện
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="username">Tên đăng nhập</Label>
            <Input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              autoComplete="username"
              required
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Mật khẩu</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </div>

          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              {error}
            </div>
          ) : null}

          <Button type="submit" className="w-full" size="lg" loading={loading}>
            <LogIn /> Đăng nhập
          </Button>

          <p className="text-center text-xs text-[var(--muted-foreground)]">
            Quên mật khẩu? Liên hệ phòng Công nghệ thông tin để được cấp lại.
          </p>
        </form>
      </div>
    </div>
  );
}
