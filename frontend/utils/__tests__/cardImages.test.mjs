// 실행: node --test utils/__tests__/cardImages.test.mjs
// 카드 그림은 모두 가로(너비 ≥ 높이)여야 한다. 카드를 보여 주는 틀이 모두 가로라 세로 그림은 작고 옆으로 누워 보인다
// (2026-11-24 팀 피드백 '가로로 길게'). 세로 그림을 새로 넣을 때는 왼쪽(반시계)으로 돌려서 넣는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.resolve(here, '../..');
const folders = [
  path.join(frontend, 'assets/card-catalog-40'),
  path.join(frontend, 'assets/card-images'),
  path.resolve(frontend, '../backend/src/main/resources/static/card-images'),   // 서버가 주는 그림 (앞단만 받은 폴더면 없다)
];

// PNG: IHDR 의 너비·높이. WebP: VP8(손실)·VP8L(무손실)·VP8X(확장) 머리말
export function imageSize(buffer) {
  if (buffer.toString('ascii', 1, 4) === 'PNG') return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = buffer.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L') {
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') return { width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 };
  return null;
}

test('카드 그림은 모두 가로다', () => {
  const portrait = [];
  let checked = 0;
  for (const folder of folders.filter(existsSync)) {
    for (const name of readdirSync(folder).filter(file => /\.(png|webp)$/i.test(file))) {
      const size = imageSize(readFileSync(path.join(folder, name)));
      assert.ok(size, `${name}: 크기를 읽지 못함`);
      checked += 1;
      if (size.height > size.width) portrait.push(`${path.basename(folder)}/${name} ${size.width}x${size.height}`);
    }
  }
  assert.ok(checked >= 47, `확인한 그림 ${checked}장`);
  assert.deepEqual(portrait, []);
});
