import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { DbService } from '../src/db/db.service';
import * as schema from '../src/db/schema';
import { SettingsService } from '../src/modules/settings/settings.service';

const cache = {
  get: async () => null,
  set: async () => undefined,
  del: async () => undefined,
  delByPrefix: async () => undefined,
};

const pngDataUrl = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64')}`;

test('nhận diện ứng dụng cho phép đổi tên và chọn logo an toàn mà không ghi đè dữ liệu logo cũ', async (t) => {
  const pg = await PGlite.create();
  t.after(() => pg.close());
  await pg.exec(readFileSync(resolve(__dirname, '..', 'drizzle', '0000_init_khoi_tao.sql'), 'utf8'));
  const db = drizzle(pg, { schema });
  const service = new SettingsService({ db, transaction: db.transaction.bind(db) } as unknown as DbService, cache as any);

  // URL logo đã có từ phiên bản cũ không bị ensureDefaults ghi đè.
  await service.set({ key: 'hospital.logo', value: 'https://legacy.example/logo.png', group: 'hospital', label: 'Logo ứng dụng', isPublic: true });
  await service.ensureDefaults();
  assert.equal(await service.get('hospital.logo'), 'https://legacy.example/logo.png');

  await service.set({ key: 'app.brandName', value: 'Bệnh viện 4', group: 'hospital', isPublic: true });
  await service.set({ key: 'app.brandSubtitle', value: 'Cổng điều hành', group: 'hospital', isPublic: true });
  await service.set({ key: 'hospital.logo', value: pngDataUrl, group: 'hospital', label: 'Logo ứng dụng', isPublic: true });
  const publicSettings = await service.publicSettings();
  assert.equal(publicSettings['app.brandName'], 'Bệnh viện 4');
  assert.equal(publicSettings['app.brandSubtitle'], 'Cổng điều hành');
  assert.equal(publicSettings['hospital.logo'], pngDataUrl);

  await assert.rejects(
    service.set({ key: 'hospital.logo', value: 'javascript:alert(1)', group: 'hospital', isPublic: true }),
    /Logo phải là ảnh/,
  );
  await assert.rejects(
    service.set({ key: 'hospital.logo', value: 'data:image/png;base64,ZmFrZQ==', group: 'hospital', isPublic: true }),
    /Nội dung logo/,
  );
});
