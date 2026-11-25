/**
 * Lưu tệp đính kèm công việc: kiểm tra đuôi/chữ ký/kích thước, ghi nguyên tử ngoài web root.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { config } from '../../config/env';
import {
  TASK_FILE_MAX_BYTES,
  TASK_FILE_TYPES,
  TASK_FILES_PER_REQUEST,
  fileSignatureMatches,
} from './task-workflow';

export interface IncomingTaskFile {
  fileName: string;
  mimeType?: string;
  contentBase64: string;
}

export interface PreparedTaskFile {
  fileName: string;
  mimeType: string;
  ext: string;
  buffer: Buffer;
}

export function storageRoot(): string {
  return config.storage.dir;
}

/** Làm sạch tên tệp hiển thị (không chứa đường dẫn, ký tự điều khiển). */
export function safeFileName(raw: string): string {
  const base = path.basename(String(raw ?? '').replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return base.slice(0, 200) || 'tep';
}

/** Giải mã + kiểm tra toàn bộ tệp trước khi ghi bất kỳ tệp nào. */
export function prepareTaskFiles(files: IncomingTaskFile[] | undefined): PreparedTaskFile[] {
  const list = files ?? [];
  if (list.length > TASK_FILES_PER_REQUEST) {
    throw new BadRequestException(`Mỗi lần tải tối đa ${TASK_FILES_PER_REQUEST} tệp`);
  }
  return list.map((file) => {
    const fileName = safeFileName(file.fileName);
    const ext = path.extname(fileName).toLowerCase();
    const spec = TASK_FILE_TYPES[ext];
    if (!spec) {
      throw new BadRequestException(
        `Tệp "${fileName}" không được phép. Chỉ nhận ảnh, PDF, văn bản, Word, Excel, PowerPoint, OpenDocument, ZIP/RAR/7z`,
      );
    }
    const raw = String(file.contentBase64 ?? '').replace(/^data:[^;]+;base64,/, '');
    if (!/^[A-Za-z0-9+/=\s]*$/.test(raw)) throw new BadRequestException(`Nội dung tệp "${fileName}" không hợp lệ`);
    const buffer = Buffer.from(raw, 'base64');
    if (buffer.length === 0) throw new BadRequestException(`Tệp "${fileName}" rỗng`);
    if (buffer.length > TASK_FILE_MAX_BYTES) {
      throw new BadRequestException(`Tệp "${fileName}" vượt ${TASK_FILE_MAX_BYTES / (1024 * 1024)}MB`);
    }
    if (!fileSignatureMatches(ext, buffer)) {
      throw new BadRequestException(`Nội dung tệp "${fileName}" không khớp với định dạng ${ext}`);
    }
    return { fileName, mimeType: spec.mime, ext, buffer };
  });
}

/** Ghi tệp vào `tasks/<taskId>/<uuid><ext>` — trả về đường dẫn tương đối. */
export async function writeTaskFile(taskId: number, file: PreparedTaskFile): Promise<string> {
  const relPath = path.join('tasks', String(taskId), `${randomUUID()}${file.ext}`);
  const absPath = path.join(storageRoot(), relPath);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  const temporaryPath = `${absPath}.qlbs-write-${randomUUID()}.partial`;
  try {
    await fs.writeFile(temporaryPath, file.buffer, { mode: 0o600 });
    await fs.rename(temporaryPath, absPath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
  return relPath;
}

export function resolveTaskFile(relPath: string): string {
  const root = path.resolve(storageRoot());
  const abs = path.resolve(root, relPath);
  if (!abs.startsWith(root + path.sep)) throw new ForbiddenException('Đường dẫn tệp không hợp lệ');
  return abs;
}

export async function removeStoredFile(relPath: string): Promise<void> {
  await fs.unlink(resolveTaskFile(relPath)).catch(() => undefined);
}
