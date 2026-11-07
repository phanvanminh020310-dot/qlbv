/** Full QLBS backup bundles: dynamic tables + uploads/faces + safe retention/temporary cleanup. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWriteStream, mkdtempSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as zlib from "node:zlib";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import {
  backupFileName,
  cleanupBackupTemporaryArtifacts,
  cleanupStorageWriteTemporaryArtifacts,
  createPortableBundleStream,
  importPortableBundle,
  manifestFileName,
  verifyBackupBundle,
  restoreStorageArchive,
  rotateBackups,
  storageArchiveFileName,
  validateStorageArchive,
  writeBackupBundle,
} from "../src/modules/backups/backup-writer";

function file(path: string, content: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

test("backup bundle captures every current public table and all persistent files, then restores storage safely", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "qlbs-backup-bundle-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const backups = join(root, "backups");
  const uploads = join(root, "uploads");
  file(join(uploads, "faces", "user_41_avatar.jpg"), "face-image-bytes");
  file(join(uploads, "hsba", "99", "attachment.pdf"), "clinical-attachment");
  file(join(uploads, "fonts", "Hospital.ttf"), "font-bytes");

  const pg = await PGlite.create();
  t.after(() => pg.close());
  await pg.exec(`
    CREATE TABLE user_biometrics (id serial primary key, user_id integer, avatar_data text);
    CREATE TABLE hsba_requests (id serial primary key, title text);
    -- Simulates a table introduced by a future QLBS migration.
    CREATE TABLE future_module_data (id serial primary key, note text);
    INSERT INTO user_biometrics (user_id, avatar_data) VALUES (41, 'data:image/jpeg;base64,ZmFjZQ==');
    INSERT INTO hsba_requests (title) VALUES ('Hồ sơ có tệp đính kèm');
    INSERT INTO future_module_data (note) VALUES ('must be included automatically');
  `);
  const db = drizzle(pg);
  const fileName = backupFileName("test-full");
  const bundle = await writeBackupBundle({ execute: db.execute.bind(db) } as any, {
    backupsDir: backups,
    storageDir: uploads,
    fileName,
  });

  assert.equal(bundle.database.counts.user_biometrics, 1);
  assert.equal(bundle.database.counts.future_module_data, 1, "new public tables are discovered dynamically");
  assert.equal(bundle.storage.files, 3);
  assert.ok(existsSync(join(backups, fileName)));
  assert.ok(existsSync(join(backups, storageArchiveFileName(fileName))));
  assert.equal(statSync(join(backups, storageArchiveFileName(fileName))).mode & 0o777, 0o600, "sensitive storage archive is owner-only");
  assert.ok(existsSync(join(backups, manifestFileName(fileName))));

  const database = JSON.parse(zlib.gunzipSync(readFileSync(join(backups, fileName))).toString("utf8"));
  assert.equal(database.version, 3);
  assert.equal(database.tables.user_biometrics[0].avatar_data, "data:image/jpeg;base64,ZmFjZQ==");
  assert.equal(database.tables.future_module_data[0].note, "must be included automatically");

  const restoreDir = join(root, "restored-uploads");
  file(join(restoreDir, "obsolete.txt"), "must disappear when restoring a storage snapshot");
  await restoreStorageArchive(join(backups, storageArchiveFileName(fileName)), restoreDir);
  assert.equal(existsSync(join(restoreDir, "obsolete.txt")), false);
  assert.equal(readFileSync(join(restoreDir, "faces", "user_41_avatar.jpg"), "utf8"), "face-image-bytes");
  assert.equal(readFileSync(join(restoreDir, "hsba", "99", "attachment.pdf"), "utf8"), "clinical-attachment");
});

test("portable bundle round-trips CSDL, storage and SHA-256 manifest as one external file", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "qlbs-backup-portable-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const backups = join(root, "backups");
  const uploads = join(root, "uploads");
  file(join(uploads, "hsba", "42", "signed.pdf"), "signed clinical bytes");

  const pg = await PGlite.create();
  t.after(() => pg.close());
  await pg.exec("CREATE TABLE users (id serial primary key, username text); INSERT INTO users (username) VALUES ('doctor');");
  await pg.exec("CREATE TABLE roles (id serial primary key, code text); INSERT INTO roles (code) VALUES ('ADMIN');");
  await pg.exec("CREATE TABLE permissions (id serial primary key, code text); INSERT INTO permissions (code) VALUES ('backup.restore');");
  const sourceName = backupFileName("portable-source");
  const db = drizzle(pg);
  await writeBackupBundle({ execute: db.execute.bind(db) } as any, {
    backupsDir: backups,
    storageDir: uploads,
    fileName: sourceName,
  });

  const exported = join(root, "offsite.bundle.tar.gz");
  const stream = createPortableBundleStream(backups, sourceName);
  await pipeline(stream.stream, createWriteStream(exported));
  const imported = join(root, "imported-backups");
  const targetName = backupFileName("portable-import");
  await importPortableBundle(exported, imported, targetName);
  assert.ok(existsSync(join(imported, targetName)));
  assert.ok(existsSync(join(imported, storageArchiveFileName(targetName))));
  assert.ok(existsSync(join(imported, manifestFileName(targetName))));
  const restored = join(root, "imported-uploads");
  await restoreStorageArchive(join(imported, storageArchiveFileName(targetName)), restored);
  assert.equal(readFileSync(join(restored, "hsba", "42", "signed.pdf"), "utf8"), "signed clinical bytes");
  await verifyBackupBundle(imported, targetName);
  writeFileSync(join(imported, targetName), "tamper", { flag: "a" });
  await assert.rejects(verifyBackupBundle(imported, targetName), /SHA-256/);
});

test("storage archive validation refuses links before anything is extracted", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "qlbs-backup-unsafe-archive-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const storage = join(root, "storage");
  file(join(storage, "plain.txt"), "normal file");
  symlinkSync("plain.txt", join(storage, "unexpected-link"));
  const archive = join(root, "unsafe.storage.tar.gz");
  execFileSync("tar", ["-C", storage, "-czf", archive, "."]);
  await assert.rejects(validateStorageArchive(archive), /kiểu tệp không được phép/);
});

test("retention removes only complete QLBS bundle artifacts and stale interrupted work", () => {
  const root = mkdtempSync(join(tmpdir(), "qlbs-backup-retention-"));
  try {
    const primaryNames = [1, 2, 3, 4].map((n) => `qlbs-2026-11-0${n}T00-00-00-000Z.json.gz`);
    primaryNames.forEach((name, index) => {
      file(join(root, name), `database-${index}`);
      file(join(root, storageArchiveFileName(name)), `storage-${index}`);
      file(join(root, manifestFileName(name)), `{}`);
      const time = new Date(Date.UTC(2026, 10, index + 1)).getTime() / 1000;
      for (const item of [name, storageArchiveFileName(name), manifestFileName(name)]) {
        utimesSync(join(root, item), time, time);
      }
    });
    const oldest = primaryNames[0]!;
    const removed = rotateBackups(root, 3);
    assert.deepEqual(removed, [oldest]);
    assert.equal(existsSync(join(root, oldest)), false);
    assert.equal(existsSync(join(root, storageArchiveFileName(oldest))), false, "sidecar storage archive is removed with its JSON");
    assert.equal(existsSync(join(root, manifestFileName(oldest))), false, "manifest is removed with its JSON");
    assert.equal(existsSync(join(root, primaryNames[3]!)), true);

    const interrupted = join(root, "qlbs-2026-12-01T00-00-00-000Z.json.gz.building");
    const interruptedUpload = join(root, ".upload-2026-12-01.partial");
    const interruptedRestoreStage = join(root, "qlbs-restore-stage-20261201-123.tmp");
    const unrelated = join(root, "do-not-touch.txt");
    file(interrupted, "partial database");
    file(interruptedUpload, "partial upload");
    file(join(interruptedRestoreStage, "staged-file"), "abandoned extraction");
    file(unrelated, "not a QLBS backup temporary artifact");
    const old = (Date.now() - 25 * 3_600_000) / 1000;
    utimesSync(interrupted, old, old);
    utimesSync(interruptedUpload, old, old);
    utimesSync(interruptedRestoreStage, old, old);
    utimesSync(unrelated, old, old);

    const cleanup = cleanupBackupTemporaryArtifacts(root, 24 * 3_600_000);
    assert.equal(cleanup.removed, 3);
    assert.equal(existsSync(interrupted), false);
    assert.equal(existsSync(interruptedUpload), false);
    assert.equal(existsSync(interruptedRestoreStage), false, "stale restore staging directory is explicitly allow-listed");
    assert.equal(existsSync(unrelated), true, "cleanup is allow-listed and cannot remove unrelated files");
    assert.ok(cleanup.freedBytes > 0);

    const storage = join(root, "uploads");
    const storageTemporary = join(storage, "hsba", "99", "attachment.pdf.qlbs-write-2f1d0d51-20e4-4ea0-93f6-8e397cdb07c8.partial");
    const userDocument = join(storage, "hsba", "99", "user-keeps-this.partial");
    file(storageTemporary, "abandoned atomic write");
    file(userDocument, "must never be selected by cleanup");
    utimesSync(storageTemporary, old, old);
    utimesSync(userDocument, old, old);
    const storageCleanup = cleanupStorageWriteTemporaryArtifacts(storage, 24 * 3_600_000);
    assert.equal(storageCleanup.removed, 1);
    assert.equal(existsSync(storageTemporary), false);
    assert.equal(existsSync(userDocument), true, "live/user-named upload is outside the exact QLBS temporary allow-list");

    assert.ok(statSync(join(root, primaryNames[3]!)).size > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
