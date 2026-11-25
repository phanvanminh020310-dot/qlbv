'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { ACTION_META, filesToPayload, taskKeys, tasksApi, type TaskAction } from '@/lib/tasks';
import { Field, FilePicker } from './task-ui';

/** Hành động không cần nhập gì thêm — thực hiện ngay. */
export const instantAction = (a: TaskAction) => !ACTION_META[a].reason && a !== 'submit';

export function useTransition(onDone?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: number; action: TaskAction; reason?: string; resultContent?: string; files?: File[] }) =>
      tasksApi.transition(input.id, {
        action: input.action,
        reason: input.reason,
        resultContent: input.resultContent,
        files: input.files?.length ? await filesToPayload(input.files) : undefined,
      }),
    onSuccess: (_d, v) => {
      toast.success(`Đã ${ACTION_META[v.action].label.toLowerCase()}`);
      void qc.invalidateQueries({ queryKey: taskKeys.all });
      onDone?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function TransitionDialog({
  taskId,
  action,
  title,
  onClose,
}: {
  taskId: number | null;
  action: TaskAction | null;
  title?: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [result, setResult] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const mutation = useTransition(onClose);
  useEffect(() => {
    setReason('');
    setResult('');
    setFiles([]);
  }, [taskId, action]);
  if (!action || !taskId) return null;
  const meta = ACTION_META[action];
  const isSubmit = action === 'submit';
  const disabled = (meta.reason === 'required' && !reason.trim()) || (isSubmit && !result.trim() && files.length === 0);
  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title={meta.label}
      description={title}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Đóng</Button>
          <Button
            variant={meta.variant === 'outline' || meta.variant === 'subtle' ? 'default' : meta.variant}
            loading={mutation.isPending}
            disabled={disabled}
            onClick={() => mutation.mutate({ id: taskId, action, reason: reason.trim() || undefined, resultContent: result.trim() || undefined, files })}
          >
            {meta.label}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {isSubmit ? (
          <>
            <Field label="Kết quả thực hiện *" hint="Mô tả việc đã làm, số liệu, đường dẫn… hoặc đính kèm tệp kết quả.">
              <Textarea rows={5} value={result} onChange={(e) => setResult(e.target.value)} autoFocus />
            </Field>
            <FilePicker files={files} onChange={setFiles} label="Đính kèm tệp kết quả" />
          </>
        ) : null}
        {meta.reason ? (
          <Field label={meta.reason === 'required' ? 'Lý do *' : 'Nhận xét (không bắt buộc)'}>
            <Textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              autoFocus={!isSubmit}
              placeholder={action === 'return' ? 'Cần bổ sung/chỉnh sửa gì?' : action === 'approve' ? 'Đánh giá kết quả…' : ''}
            />
          </Field>
        ) : null}
      </div>
    </Dialog>
  );
}
