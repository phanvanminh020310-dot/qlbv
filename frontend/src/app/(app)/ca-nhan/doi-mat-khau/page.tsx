'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, KeyRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/shared/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function ChangePasswordPage() {
  const router = useRouter();
  const logout = useAuth((s) => s.logout);
  const { data: publicSettings } = useQuery({
    queryKey: ['settings-public'],
    queryFn: () => apiFetch<Record<string, unknown>>('/settings/public'),
    staleTime: 60_000,
  });
  const minPwdLength = Number(publicSettings?.['system.passwordMinLength']) || 6;

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const change = useMutation({
    mutationFn: () =>
      apiFetch('/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword, confirmPassword },
      }),
    onSuccess: async () => {
      toast.success('Đã đổi mật khẩu thành công. Vui lòng đăng nhập lại.');
      await logout();
      router.replace('/login');
    },
    onError: (err) => toast.error((err as Error).message),
  });

  return (
    <div className="space-y-4 max-w-2xl mx-auto pb-10">
      <div className="flex items-center gap-2">
        <Link
          href="/ca-nhan"
          className="inline-flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors py-1"
        >
          <ArrowLeft className="size-3.5" /> Quay lại Hồ sơ cá nhân
        </Link>
      </div>

      <PageHeader
        title="Đổi mật khẩu"
        description={`Mật khẩu mới yêu cầu tối thiểu ${minPwdLength} ký tự; tất cả các phiên đăng nhập khác sẽ tự động bị thu hồi`}
      />

      <Card className="overflow-hidden">
        <div className="border-b px-4 py-3 bg-slate-50/50 dark:bg-slate-900/40 text-sm font-semibold flex items-center gap-2">
          <KeyRound className="size-4 text-[var(--primary)]" />
          <span>Thông tin mật khẩu mới</span>
        </div>

        <form
          className="space-y-4 p-4 sm:p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (newPassword !== confirmPassword) {
              toast.error('Mật khẩu nhập lại không khớp');
              return;
            }
            change.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="cur" className="text-xs font-medium">Mật khẩu hiện tại *</Label>
            <Input
              id="cur"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              className="h-10"
              placeholder="Nhập mật khẩu đang dùng"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new" className="text-xs font-medium">Mật khẩu mới *</Label>
            <Input
              id="new"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={minPwdLength}
              className="h-10"
              placeholder={`Tối thiểu ${minPwdLength} ký tự`}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm" className="text-xs font-medium">Nhập lại mật khẩu mới *</Label>
            <Input
              id="confirm"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              className="h-10"
              placeholder="Nhập lại chính xác mật khẩu mới"
            />
          </div>

          <div className="pt-2 flex justify-end">
            <Button type="submit" loading={change.isPending} className="w-full sm:w-auto h-10 px-6 font-medium shadow-sm">
              <KeyRound className="size-4 mr-1.5" /> Xác nhận đổi mật khẩu
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
