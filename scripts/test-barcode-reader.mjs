import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import zxing from '@zxing/library';
import { barcodeRaster } from './barcode-raster-fixture.mjs';

const bundled = await build({ entryPoints: ['src/barcode-reader.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { BarcodeLuminanceSource, OrientationAwareBarcodeReader } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const { BarcodeFormat, DecodeHintType } = zxing;
const hints = new Map([
  [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.CODE_128]],
  [DecodeHintType.TRY_HARDER, true],
]);

test('quarter-turn swaps rectangular dimensions, preserves rows and never mutates its source', () => {
  const original = new Uint8ClampedArray([1, 2, 3, 4, 5, 6]);
  const source = new BarcodeLuminanceSource(original, 3, 2);
  const rotated = source.rotateCounterClockwise();
  assert.equal(rotated.getWidth(), 2);
  assert.equal(rotated.getHeight(), 3);
  assert.deepEqual([...rotated.getMatrix()], [3, 6, 2, 5, 1, 4]);
  assert.deepEqual([...rotated.getRow(1)], [2, 5]);
  assert.deepEqual([...source.getMatrix()], [1, 2, 3, 4, 5, 6]);
  let complete = rotated;
  for (let i = 0; i < 3; i++) complete = complete.rotateCounterClockwise();
  assert.equal(complete.getWidth(), 3);
  assert.equal(complete.getHeight(), 2);
  assert.deepEqual(complete.getMatrix(), original);
});

for (const [code, expected] of [['4006381333931', '4006381333931'], ['0036000291452', '036000291452']]) {
  test(`real ZXing decodes ${expected.length === 12 ? 'UPC-A' : 'EAN-13'} upright, sideways and upside down in portrait and landscape frames`, () => {
    const reader = new OrientationAwareBarcodeReader(hints);
    for (const [width, height] of [[480, 640], [640, 480]]) {
      for (const angle of [0, 90, 180, 270]) {
        for (const [x, y] of [[0, 0], [32, -40]]) {
          assert.equal(reader.decodeFromCanvas(barcodeRaster(code, angle, width, height, x, y)).getText(), expected, `${width}×${height} ${angle}° (${x},${y})`);
        }
      }
    }
  });
}

test('real row decoding covers a full turn with the existing diagonal assist angles', () => {
  const reader = new OrientationAwareBarcodeReader(hints);
  // Halfway points exercise maximum residual skew, not just exact 45° examples.
  for (let angle = 0; angle < 360; angle += 11.25) {
    let result;
    for (const correction of [0, 22.5, 45, 67.5]) {
      try { result = reader.decodeFromCanvas(barcodeRaster('4006381333931', angle + correction)).getText(); } catch {}
      if (result) break;
    }
    assert.equal(result, '4006381333931', `${angle}°`);
  }
});

test('blank images and invalid checksums never produce a barcode', () => {
  const reader = new OrientationAwareBarcodeReader(hints);
  const blank = barcodeRaster('4006381333931', 0);
  blank.data.fill(255);
  assert.throws(() => reader.decodeFromCanvas(blank));
  for (const angle of [0, 90, 180, 270]) {
    assert.throws(() => reader.decodeFromCanvas(barcodeRaster('4006381333932', angle)));
  }
});
