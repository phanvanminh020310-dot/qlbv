#!/usr/bin/env node
/** Cross-check native QR matrices against the independent node-qrcode implementation. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const QRCode = require("qrcode");

const path = process.argv[2];
assert.ok(
  path,
  "Usage: node scripts/verify-kiosk-qr.cjs <qr-matrices.json from QLBS_Kiosk.exe /self-test>",
);
const fixtures = JSON.parse(
  fs.readFileSync(path, "utf8").replace(/^\uFEFF/, ""),
);
assert.equal(fixtures.length, 40);
for (const fixture of fixtures) {
  const expected = QRCode.create(
    [{ data: Buffer.from(fixture.text, "utf8"), mode: "byte" }],
    {
      errorCorrectionLevel: "M",
      version: fixture.version,
      maskPattern: fixture.mask,
    },
  );
  assert.equal(
    expected.modules.size,
    fixture.rows.length,
    `version ${fixture.version}: size`,
  );
  for (let y = 0; y < expected.modules.size; y++) {
    for (let x = 0; x < expected.modules.size; x++) {
      assert.equal(
        fixture.rows[y][x] === "1",
        Boolean(expected.modules.get(y, x)),
        `v${fixture.version} @ (${x}, ${y})`,
      );
    }
  }
}
console.log(
  "PASS: all 40 native QR versions match node-qrcode byte-for-byte (ECC M, UTF-8 byte mode, native-selected masks).",
);
