/**
 * Ghi / xoay vòng bộ sao lưu QLBS.
 *
 * Mỗi bộ sao lưu mới gồm dữ liệu PostgreSQL (JSON gzip), toàn bộ STORAGE_DIR
 * (uploads/faces, tệp HSBA, phông tùy chỉnh…) và manifest. Chỉ các tên tệp
 * do QLBS tạo mới nằm trong phạm vi xoay vòng/xoá rác; không bao giờ quét hay
 * xoá tùy tiện thư mục uploads.
 */
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { sql } from 'drizzle-orm';
import { once } from 'events';
import * as fs from 'fs';
import type { Readable } from 'stream';
import * as path from 'path';
import * as zlib from 'zlib';

/** Đối tượng thực thi SQL (db.db hoặc tx của drizzle) */
export interface SqlExecutor {
  execute: (query: ReturnType<typeof sql.raw>) => Promise<unknown>;
}

const PAGE = 2000;

/** Tệp dữ liệu chính — danh sách trên giao diện vẫn chỉ hiển thị tệp này. */
export const BACKUP_FILE_RE = /^qlbs-(?!.*\.manifest\.json$)[A-Za-z0-9._-]+\.json(\.gz)?$/;
const STORAGE_ARCHIVE_RE = /^qlbs-[A-Za-z0-9._-]+\.storage\.tar\.gz$/;
const MANIFEST_RE = /^qlbs-[A-Za-z0-9._-]+\.manifest\.json$/;
const TEMP_ARTIFACT_RE = /^(?:qlbs-[A-Za-z0-9._-]+|\.upload-[A-Za-z0-9._-]+)(?:\.[A-Za-z0-9_-]+)*\.(?:partial|building|tmp)$/;
/** Hard-link/copy giữ archive nguồn trong lúc restore nếu một backup chạy dở đã xoay vòng file gốc. */
const RESTORE_SOURCE_HOLD_RE = /^qlbs-restore-source-[A-Za-z0-9_-]+\.hold$/;
/** Marker riêng cho ghi tệp người dùng theo kiểu atomic write; không khớp tên tệp người dùng bình thường. */
const STORAGE_WRITE_TEMP_RE = /^[A-Za-z0-9._-]+\.qlbs-write-[0-9a-f-]{36}\.partial$/;

export interface BackupManifest {
  format: 'qlbs-backup-bundle';
  version: 1;
  createdAt: string;
  database: { fileName: string; size: number; sha256: string; tables: number; totalRows: number };
  storage: { fileName: string; size: number; sha256: string; files: number };
}

export interface BackupBundleResult {
  fileName: string;
  database: { counts: Record<string, number>; totalRows: number; size: number };
  storage: { fileName: string; size: number; files: number };
  manifestFileName: string;
}

export function backupFileName(label?: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const clean = String(label ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `qlbs-${stamp}${clean ? `-${clean}` : ''}.json.gz`;
}

/** Cùng stem với JSON chính để xoay vòng luôn xoá đủ dữ liệu + tệp đính kèm. */
export function backupStem(fileName: string): string {
  if (!BACKUP_FILE_RE.test(fileName)) throw new Error(`Tên bản sao lưu không hợp lệ: ${fileName}`);
  return fileName.replace(/\.json(?:\.gz)?$/, '');
}

export function storageArchiveFileName(fileName: string): string {
  return `${backupStem(fileName)}.storage.tar.gz`;
}

export function manifestFileName(fileName: string): string {
  return `${backupStem(fileName)}.manifest.json`;
}

/** Một tệp vận chuyển ngoài máy chủ: chứa JSON CSDL + archive storage + manifest hash. */
export function portableBundleFileName(fileName: string): string {
  return `${backupStem(fileName)}.bundle.tar.gz`;
}

export function bundleArtifactNames(fileName: string): string[] {
  return [fileName, storageArchiveFileName(fileName), manifestFileName(fileName)];
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args[0] ?? ''} thất bại${stderr.trim() ? `: ${stderr.trim()}` : ''}`));
    });
  });
}

function runCapture(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} ${args[0] ?? ''} thất bại${stderr.trim() ? `: ${stderr.trim()}` : ''}`));
    });
  });
}

async function sha256(fullPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const input = fs.createReadStream(fullPath);
    input.on('error', reject);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

function countFiles(dir: string): number {
  let count = 0;
  if (!fs.existsSync(dir)) return count;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) count += countFiles(full);
    else if (entry.isFile()) count++;
  }
  return count;
}

function writeJsonAtomically(fullPath: string, value: unknown): void {
  const temporary = `${fullPath}.partial`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, fullPath);
}

/**
 * Đọc mọi bảng trong schema public qua `exec` và ghi ra `fullPath` (gzip, dạng luồng).
 * Gọi bên trong một giao dịch để có ảnh chụp nhất quán. Danh sách bảng là động nên
 * mọi bảng public được thêm bởi migration tương lai cũng tự xuất hiện trong backup.
 */
export async function writeBackup(
  exec: SqlExecutor,
  fullPath: string,
  options: { version?: number } = {},
): Promise<{ counts: Record<string, number>; totalRows: number; size: number }> {
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  const tmpPath = `${fullPath}.partial`;
  const gzip = zlib.createGzip({ level: 6 });
  const out = fs.createWriteStream(tmpPath, { mode: 0o600 });
  const done = new Promise<void>((resolve, reject) => {
    out.on('finish', resolve);
    out.on('error', reject);
    gzip.on('error', reject);
  });
  gzip.pipe(out);
  const write = async (chunk: string): Promise<void> => {
    if (!gzip.write(chunk)) await once(gzip, 'drain');
  };

  const counts: Record<string, number> = {};
  let totalRows = 0;
  try {
    const res = await exec.execute(
      sql.raw(
        "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name",
      ),
    );
    const tables = ((res as { rows?: { table_name: string }[] }).rows ?? [])
      .map((r) => r.table_name)
      .filter((t) => /^[a-z_][a-z0-9_]*$/.test(t));

    await write(`{"format":"qlbs-backup","version":${options.version ?? 2},"createdAt":${JSON.stringify(new Date().toISOString())},"tables":{`);
    for (let ti = 0; ti < tables.length; ti++) {
      const table = tables[ti]!;
      await write(`${ti ? ',' : ''}${JSON.stringify(table)}:[`);
      let n = 0;
      // Đọc tuần tự theo vị trí vật lý (ctid) — mỗi lô tiếp nối lô trước, không dùng OFFSET
      // (OFFSET quét lại từ đầu mỗi lô → chậm theo bình phương số dòng với bảng lớn).
      let last = '(0,0)';
      for (;;) {
        const page = await exec.execute(
          sql.raw(`select ctid::text as "__qlbs_ctid", * from "${table}" where ctid > '${last}'::tid order by ctid limit ${PAGE}`),
        );
        const rows = ((page as { rows?: Record<string, unknown>[] }).rows ?? []) as Record<string, unknown>[];
        for (const row of rows) {
          last = String(row['__qlbs_ctid']);
          delete row['__qlbs_ctid'];
          await write(`${n ? ',' : ''}${JSON.stringify(row)}`);
          n++;
        }
        if (rows.length < PAGE) break;
      }
      await write(']');
      counts[table] = n;
      totalRows += n;
    }
    await write(`},"counts":${JSON.stringify(counts)}}`);
    gzip.end();
    await done;
    fs.renameSync(tmpPath, fullPath);
  } catch (err) {
    gzip.destroy();
    out.destroy();
    fs.rmSync(tmpPath, { force: true });
    throw err;
  }
  return { counts, totalRows, size: fs.statSync(fullPath).size };
}

/** Nén đầy đủ STORAGE_DIR; tar được gọi bằng argv, không dùng shell. */
export async function writeStorageArchive(storageDir: string, archivePath: string): Promise<{ size: number; files: number }> {
  fs.mkdirSync(storageDir, { recursive: true });
  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  const tmpPath = `${archivePath}.partial`;
  fs.rmSync(tmpPath, { force: true });
  try {
    // Không tạo bộ backup không thể phục hồi an toàn khi STORAGE_DIR bị đặt symlink/special file.
    assertRegularStorageTree(storageDir);
    // tar lưu đường dẫn tương đối từ STORAGE_DIR, nhờ đó không thể ghi đè ra ngoài khi phục hồi.
    await run('tar', ['-C', storageDir, '-czf', tmpPath, '.']);
    fs.chmodSync(tmpPath, 0o600);
    fs.renameSync(tmpPath, archivePath);
    return { size: fs.statSync(archivePath).size, files: countFiles(storageDir) };
  } catch (error) {
    fs.rmSync(tmpPath, { force: true });
    throw error;
  }
}

function assertSafeArchiveEntries(entries: string[]): void {
  for (const raw of entries) {
    const item = raw.replace(/^\.\//, '');
    if (!item || item === '.') continue;
    if (path.posix.isAbsolute(item) || item.split('/').includes('..') || item.includes('\0')) {
      throw new Error(`Archive storage có đường dẫn không an toàn: ${raw}`);
    }
  }
}

function assertSafeArchiveTypes(verboseEntries: string[]): void {
  for (const line of verboseEntries) {
    if (!line) continue;
    // tar -tv: '-' = regular file, 'd' = directory. Từ chối hard/symlink, device,
    // fifo và bất kỳ kiểu lạ nào trước khi tar được phép giải nén vào staging.
    if (line[0] !== '-' && line[0] !== 'd') {
      throw new Error(`Archive storage chứa kiểu tệp không được phép: ${line}`);
    }
  }
}

function assertRegularStorageTree(dir: string): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
      throw new Error(`Archive storage chứa kiểu tệp không được phép: ${entry.name}`);
    }
    if (stat.isDirectory()) assertRegularStorageTree(full);
  }
}

/** Kiểm tra archive trước khi phục hồi CSDL để backup hỏng không thể làm nửa chừng. */
export async function validateStorageArchive(archivePath: string): Promise<void> {
  const [listing, verboseListing] = await Promise.all([
    runCapture('tar', ['-tzf', archivePath]),
    runCapture('tar', ['-tvzf', archivePath]),
  ]);
  assertSafeArchiveEntries(listing.split(/\r?\n/));
  assertSafeArchiveTypes(verboseListing.split(/\r?\n/));
}

/**
 * Thay nội dung STORAGE_DIR bằng archive đã kiểm tra. Hàm chỉ dùng trong chế độ
 * phục hồi có bảo trì; không được gọi bởi các tác vụ dọn rác hằng ngày.
 */
export async function restoreStorageArchive(archivePath: string, storageDir: string): Promise<void> {
  await validateStorageArchive(archivePath);
  // Stage trên cùng bind-mount backups thay vì overlay Docker, tránh làm đầy filesystem layer
  // khi phục hồi kho tệp HSBA lớn. Tên allow-list này cũng được daily cleanup dọn nếu tiến trình bị ngắt.
  const stage = path.join(path.dirname(archivePath), `qlbs-restore-stage-${Date.now()}-${process.pid}.tmp`);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true, mode: 0o700 });
  try {
    await run('tar', ['-xzf', archivePath, '-C', stage]);
    assertRegularStorageTree(stage);
    fs.mkdirSync(storageDir, { recursive: true });
    // Không xóa chính mount root; chỉ xóa nội dung để bind mount Docker vẫn nguyên.
    for (const name of fs.readdirSync(storageDir)) fs.rmSync(path.join(storageDir, name), { recursive: true, force: true });
    for (const name of fs.readdirSync(stage)) {
      fs.cpSync(path.join(stage, name), path.join(storageDir, name), { recursive: true, force: true, dereference: false });
    }
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

/**
 * Tạo bộ backup đầy đủ. Tệp JSON và storage archive được tạo ở trạng thái staging;
 * chỉ khi cả hai thành công mới xuất hiện với tên chính thức và mới đủ điều kiện xoay vòng.
 */
export async function writeBackupBundle(
  exec: SqlExecutor,
  options: { backupsDir: string; storageDir: string; fileName: string },
): Promise<BackupBundleResult> {
  const { backupsDir, storageDir, fileName } = options;
  if (!BACKUP_FILE_RE.test(fileName)) throw new Error(`Tên bản sao lưu không hợp lệ: ${fileName}`);
  fs.mkdirSync(backupsDir, { recursive: true });
  const databasePath = path.join(backupsDir, fileName);
  const storageName = storageArchiveFileName(fileName);
  const storagePath = path.join(backupsDir, storageName);
  const manifestName = manifestFileName(fileName);
  const manifestPath = path.join(backupsDir, manifestName);
  const databaseStaging = `${databasePath}.building`;
  const storageStaging = `${storagePath}.building`;
  const ownArtifacts = [
    databasePath, `${databaseStaging}.partial`, databaseStaging,
    storagePath, `${storageStaging}.partial`, storageStaging,
    manifestPath, `${manifestPath}.partial`,
  ];

  try {
    const database = await writeBackup(exec, databaseStaging, { version: 3 });
    const storage = await writeStorageArchive(storageDir, storageStaging);
    // Storage xuất hiện trước JSON chính: giao diện không bao giờ thấy một JSON mới mà thiếu tệp đi kèm.
    fs.renameSync(storageStaging, storagePath);
    fs.renameSync(databaseStaging, databasePath);
    const manifest: BackupManifest = {
      format: 'qlbs-backup-bundle',
      version: 1,
      createdAt: new Date().toISOString(),
      database: {
        fileName,
        size: database.size,
        sha256: await sha256(databasePath),
        tables: Object.keys(database.counts).length,
        totalRows: database.totalRows,
      },
      storage: {
        fileName: storageName,
        size: storage.size,
        sha256: await sha256(storagePath),
        files: storage.files,
      },
    };
    writeJsonAtomically(manifestPath, manifest);
    return { fileName, database, storage: { fileName: storageName, ...storage }, manifestFileName: manifestName };
  } catch (error) {
    // Tên backup chứa timestamp nên không đụng vào bundle đã có từ lần khác.
    for (const artifact of ownArtifacts) fs.rmSync(artifact, { force: true });
    throw error;
  }
}

function parseManifest(fullPath: string): BackupManifest {
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  } catch {
    throw new Error('Manifest của bộ backup không hợp lệ');
  }
  const manifest = data as Partial<BackupManifest>;
  const validHash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
  if (
    manifest.format !== 'qlbs-backup-bundle' || manifest.version !== 1
    || !manifest.database || !manifest.storage
    || typeof manifest.database.fileName !== 'string' || typeof manifest.storage.fileName !== 'string'
    || !validHash(manifest.database.sha256) || !validHash(manifest.storage.sha256)
  ) {
    throw new Error('Manifest của bộ backup thiếu thông tin kiểm tra toàn vẹn');
  }
  return manifest as BackupManifest;
}

/** Kiểm tra manifest SHA-256 của bộ full backup trước khi tải/nhập/phục hồi. */
export async function verifyBackupBundle(backupsDir: string, fileName: string): Promise<BackupManifest> {
  const manifestName = manifestFileName(fileName);
  const manifest = parseManifest(path.join(backupsDir, manifestName));
  const storageName = storageArchiveFileName(fileName);
  if (manifest.database.fileName !== fileName || manifest.storage.fileName !== storageName) {
    throw new Error('Manifest không khớp tên các thành phần của bộ backup');
  }
  const databasePath = path.join(backupsDir, fileName);
  const storagePath = path.join(backupsDir, storageName);
  if (!fs.existsSync(databasePath) || !fs.existsSync(storagePath)) {
    throw new Error('Bộ backup thiếu CSDL hoặc archive storage đi kèm');
  }
  const [databaseHash, storageHash] = await Promise.all([sha256(databasePath), sha256(storagePath)]);
  if (databaseHash !== manifest.database.sha256 || storageHash !== manifest.storage.sha256) {
    throw new Error('Kiểm tra SHA-256 thất bại: bộ backup có thể bị hỏng hoặc bị thay đổi');
  }
  return manifest;
}

/** Tạo stream .bundle.tar.gz để sao chép ra ổ ngoài mà không tạo thêm file lớn trên máy chủ. */
export function createPortableBundleStream(backupsDir: string, fileName: string): { stream: Readable; fileName: string } {
  const artifacts = bundleArtifactNames(fileName);
  if (artifacts.some((name) => !fs.existsSync(path.join(backupsDir, name)))) {
    throw new Error('Bộ backup chưa đủ CSDL, archive storage và manifest để tải dạng di động');
  }
  const child = spawn('tar', ['-C', backupsDir, '-czf', '-', ...artifacts], { stdio: ['ignore', 'pipe', 'pipe'] });
  const stream = child.stdout;
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  child.once('error', (error) => stream.destroy(error));
  child.once('close', (code) => {
    if (code !== 0) stream.destroy(new Error(`Không thể đóng gói bộ backup${stderr.trim() ? `: ${stderr.trim()}` : ''}`));
  });
  return { stream, fileName: portableBundleFileName(fileName) };
}

/**
 * Nhập một .bundle.tar.gz đã tải từ QLBS. Archive ngoài được kiểm tra kiểu/path,
 * manifest SHA-256 phải khớp cả JSON CSDL lẫn storage trước khi công bố tên mới.
 */
export async function importPortableBundle(
  portablePath: string,
  backupsDir: string,
  targetFileName: string,
): Promise<void> {
  if (!BACKUP_FILE_RE.test(targetFileName)) throw new Error(`Tên bản sao lưu không hợp lệ: ${targetFileName}`);
  await validateStorageArchive(portablePath);
  const stage = path.join(backupsDir, `qlbs-bundle-import-stage-${Date.now()}-${process.pid}.tmp`);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true, mode: 0o700 });
  const targets = bundleArtifactNames(targetFileName);
  try {
    await run('tar', ['-xzf', portablePath, '-C', stage]);
    assertRegularStorageTree(stage);
    const sourceFiles = fs.readdirSync(stage);
    const sourceDatabase = sourceFiles.filter((name) => BACKUP_FILE_RE.test(name));
    if (sourceDatabase.length !== 1) throw new Error('Gói di động phải có đúng một tệp CSDL QLBS');
    const sourceName = sourceDatabase[0]!;
    const sourceStorage = storageArchiveFileName(sourceName);
    const sourceManifest = manifestFileName(sourceName);
    if (
      sourceFiles.length !== 3
      || !sourceFiles.includes(sourceStorage)
      || !sourceFiles.includes(sourceManifest)
    ) throw new Error('Gói di động thiếu tệp storage/manifest đi kèm hoặc chứa tệp không được phép');

    const manifest = parseManifest(path.join(stage, sourceManifest));
    if (manifest.database.fileName !== sourceName || manifest.storage.fileName !== sourceStorage) {
      throw new Error('Manifest không khớp tên tệp trong gói di động');
    }
    const [databaseHash, storageHash] = await Promise.all([
      sha256(path.join(stage, sourceName)),
      sha256(path.join(stage, sourceStorage)),
    ]);
    if (databaseHash !== manifest.database.sha256 || storageHash !== manifest.storage.sha256) {
      throw new Error('Kiểm tra SHA-256 thất bại: gói backup có thể bị hỏng hoặc không đồng bộ');
    }
    await validateStorageArchive(path.join(stage, sourceStorage));

    const targetStorage = storageArchiveFileName(targetFileName);
    const targetManifest = manifestFileName(targetFileName);
    fs.copyFileSync(path.join(stage, sourceName), path.join(backupsDir, targetFileName));
    fs.copyFileSync(path.join(stage, sourceStorage), path.join(backupsDir, targetStorage));
    fs.chmodSync(path.join(backupsDir, targetFileName), 0o600);
    fs.chmodSync(path.join(backupsDir, targetStorage), 0o600);
    writeJsonAtomically(path.join(backupsDir, targetManifest), {
      ...manifest,
      database: { ...manifest.database, fileName: targetFileName },
      storage: { ...manifest.storage, fileName: targetStorage },
    } satisfies BackupManifest);
  } catch (error) {
    for (const artifact of targets) fs.rmSync(path.join(backupsDir, artifact), { force: true });
    throw error;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

/** Giữ lại `keep` bundle mới nhất, xóa đồng thời JSON + storage + manifest cùng stem. */
export function rotateBackups(dir: string, keep: number, protect: string[] = []): string[] {
  if (!fs.existsSync(dir)) return [];
  const safeKeep = Math.max(1, Math.floor(Number.isFinite(keep) ? keep : 1));
  const olds = fs
    .readdirSync(dir)
    .filter((f) => BACKUP_FILE_RE.test(f))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
    .slice(safeKeep)
    .filter((o) => !protect.includes(o.f));
  for (const old of olds) {
    for (const artifact of bundleArtifactNames(old.f)) fs.rmSync(path.join(dir, artifact), { force: true });
  }
  return olds.map((o) => o.f);
}

/** Dọn duy nhất file staging/orphan do backup bị ngắt; không chạm dữ liệu người dùng trong uploads. */
export function cleanupBackupTemporaryArtifacts(dir: string, olderThanMs: number): { removed: number; freedBytes: number } {
  if (!fs.existsSync(dir)) return { removed: 0, freedBytes: 0 };
  let removed = 0;
  let freedBytes = 0;
  const now = Date.now();
  const hasPrimary = new Set(fs.readdirSync(dir).filter((f) => BACKUP_FILE_RE.test(f)).map((f) => backupStem(f)));
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    const isAllowedTemporary = TEMP_ARTIFACT_RE.test(name);
    const isAllowedStageDirectory = stat.isDirectory() && /^qlbs-(?:restore|bundle-import)-stage-[A-Za-z0-9_-]+\.tmp$/.test(name);
    const isRestoreSourceHold = stat.isFile() && RESTORE_SOURCE_HOLD_RE.test(name);
    // Hard-link kế thừa mtime của archive gốc, nên dùng ctime (thời điểm link được tạo) để
    // không dọn nhầm trong lần phục hồi đang chạy.
    const artifactAge = now - (isRestoreSourceHold ? stat.ctimeMs : stat.mtimeMs);
    if ((!stat.isFile() && !isAllowedStageDirectory) || artifactAge < olderThanMs) continue;
    const orphanSidecar = (STORAGE_ARCHIVE_RE.test(name) || MANIFEST_RE.test(name))
      && !hasPrimary.has(name.replace(/\.(?:storage\.tar\.gz|manifest\.json)$/, ''));
    if (!isAllowedTemporary && !isAllowedStageDirectory && !isRestoreSourceHold && !orphanSidecar) continue;
    try {
      if (stat.isDirectory()) fs.rmSync(full, { recursive: true, force: true });
      else fs.unlinkSync(full);
      removed++;
      freedBytes += stat.isFile() ? stat.size : 0;
    } catch {
      // Storage cleanup ghi log ở lớp gọi; bỏ qua file vừa đổi quyền/thay đổi song song.
    }
  }
  return { removed, freedBytes };
}

/**
 * Dọn duy nhất temporary file có marker QLBS trong STORAGE_DIR. Không dùng glob,
 * không xoá tệp đã hoàn tất, không follow symlink; vì thế không thể đụng HSBA,
 * ảnh mặt, phông hoặc bất kỳ tài liệu người dùng nào đang sống.
 */
export function cleanupStorageWriteTemporaryArtifacts(dir: string, olderThanMs: number): { removed: number; freedBytes: number } {
  if (!fs.existsSync(dir)) return { removed: 0, freedBytes: 0 };
  let removed = 0;
  let freedBytes = 0;
  const cutoff = Date.now() - olderThanMs;
  const walk = (current: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      if (!stat.isFile() || !STORAGE_WRITE_TEMP_RE.test(entry.name) || stat.mtimeMs >= cutoff) continue;
      try {
        fs.unlinkSync(full);
        removed++;
        freedBytes += stat.size;
      } catch {
        // Không ảnh hưởng backup/restore nếu file vừa được tiến trình ghi đổi trạng thái.
      }
    }
  };
  walk(dir);
  return { removed, freedBytes };
}

export function formatBytes(size: number): string {
  if (size >= 1024 ** 3) return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
  return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
}
