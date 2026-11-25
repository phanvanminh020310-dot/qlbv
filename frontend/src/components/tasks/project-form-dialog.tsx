'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Select, Textarea } from '@/components/ui/input';
import { PROJECT_STATUS_LABEL, PRIORITY_LABEL, taskKeys, tasksApi, type ProjectDetail, type ProjectInput, type ProjectStatus, type TaskPriority } from '@/lib/tasks';
import { Field, UserPicker } from './task-ui';

const COLORS = ['#0f766e', '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#ca8a04', '#16a34a', '#475569'];
type Role = 'MANAGER' | 'MEMBER' | 'VIEWER';
const ROLE_LABEL: Record<Role, string> = { MANAGER: 'Quản lý', MEMBER: 'Thành viên', VIEWER: 'Chỉ xem' };

export function ProjectFormDialog({ open, onClose, project }: { open: boolean; onClose: () => void; project?: ProjectDetail | null }) {
  const qc = useQueryClient();
  const router = useRouter();
  const editing = !!project;
  const meta = useQuery({ queryKey: taskKeys.meta, queryFn: tasksApi.meta, staleTime: 60_000, enabled: open });
  const [f, setF] = useState<ProjectInput>({ name: '' });
  const [members, setMembers] = useState<Array<{ userId: number; role: Role }>>([]);
  const [names, setNames] = useState<Record<number, string>>({});

  useEffect(() => {
    if (!open) return;
    setF(
      project
        ? { name: project.name, description: project.description, departmentId: project.departmentId, ownerId: project.ownerId, status: project.status, priority: project.priority, startDate: project.startDate, dueDate: project.dueDate, color: project.color }
        : { name: '', status: 'ACTIVE', priority: 'NORMAL', color: COLORS[0] },
    );
    setMembers(project ? project.members.map((m) => ({ userId: m.userId, role: m.role })) : []);
    setNames(project ? Object.fromEntries(project.members.map((m) => [m.userId, m.fullName])) : {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project?.id]);

  const users = useQuery({ queryKey: ['tasks', 'assignable', 0], queryFn: () => tasksApi.assignable({}), staleTime: 60_000, enabled: open });
  const nameOf = (id: number) => names[id] ?? users.data?.find((u) => u.id === id)?.fullName ?? `#${id}`;

  const save = useMutation({
    mutationFn: async () => {
      const body: ProjectInput = { ...f, name: f.name.trim(), startDate: f.startDate || null, dueDate: f.dueDate || null };
      if (editing && project) {
        const { departmentId: _d, ...rest } = body;
        void _d;
        await tasksApi.updateProject(project.id, rest);
        await tasksApi.setProjectMembers(project.id, members);
        return { id: project.id };
      }
      return tasksApi.createProject({ ...body, members });
    },
    onSuccess: (r) => {
      toast.success(editing ? 'Đã lưu dự án' : 'Đã tạo dự án');
      void qc.invalidateQueries({ queryKey: taskKeys.all });
      onClose();
      if (!editing) router.push(`/cong-viec/du-an/${r.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? `Sửa dự án ${project?.code}` : 'Tạo dự án mới'}
      description="Dự án gom nhiều công việc liên quan, có thành viên, tiến độ và dòng thời gian."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Huỷ</Button>
          <Button loading={save.isPending} disabled={f.name.trim().length < 2} onClick={() => save.mutate()}>{editing ? 'Lưu' : 'Tạo dự án'}</Button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Tên dự án *" className="md:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label="Mô tả / mục tiêu" className="md:col-span-2"><Textarea rows={3} value={f.description ?? ''} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        {!editing ? (
          <Field label="Khoa/phòng chủ trì">
            <Select value={f.departmentId ?? ''} onChange={(e) => setF({ ...f, departmentId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">— Theo khoa của tôi —</option>
              {meta.data?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>
        ) : null}
        <Field label="Chủ nhiệm dự án">
          <UserPicker value={f.ownerId ? [f.ownerId] : []} onChange={(ids) => setF({ ...f, ownerId: ids[0] ?? null })} placeholder="Mặc định: người tạo" />
        </Field>
        <Field label="Trạng thái">
          <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as ProjectStatus })}>
            {Object.entries(PROJECT_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Ưu tiên">
          <Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as TaskPriority })}>
            {Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Ngày bắt đầu"><Input type="date" value={f.startDate ?? ''} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
        <Field label="Ngày kết thúc dự kiến"><Input type="date" value={f.dueDate ?? ''} min={f.startDate ?? undefined} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
        <Field label="Màu nhận diện">
          <div className="flex gap-1.5">
            {COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setF({ ...f, color: c })} className="size-7 rounded-full ring-offset-2" style={{ background: c, boxShadow: f.color === c ? `0 0 0 2px white, 0 0 0 4px ${c}` : undefined }} aria-label={c} />
            ))}
          </div>
        </Field>
        <Field label="Thành viên" className="md:col-span-2" hint="Quản lý dự án được giao việc, sửa dự án; Thành viên nhận việc; Chỉ xem theo dõi tiến độ.">
          <UserPicker
            value={members.map((m) => m.userId)}
            onChange={(ids) => {
              setMembers(ids.map((id) => members.find((m) => m.userId === id) ?? { userId: id, role: 'MEMBER' }));
              for (const id of ids) if (!names[id]) { const u = users.data?.find((x) => x.id === id); if (u) setNames((n) => ({ ...n, [id]: u.fullName })); }
            }}
            multiple
          />
          {members.length ? (
            <ul className="mt-2 divide-y rounded-lg border">
              {members.map((m) => (
                <li key={m.userId} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <span className="flex-1">{nameOf(m.userId)}</span>
                  <Select className="h-8 w-36" value={m.role} onChange={(e) => setMembers(members.map((x) => (x.userId === m.userId ? { ...x, role: e.target.value as Role } : x)))}>
                    {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </Select>
                </li>
              ))}
            </ul>
          ) : null}
        </Field>
      </div>
    </Dialog>
  );
}

export { ROLE_LABEL as PROJECT_ROLE_LABEL };
