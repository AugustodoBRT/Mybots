import test from 'node:test';
import assert from 'node:assert/strict';
import { windowFrame } from '../pc/ui.mjs';

test('o quadro do navegador chega à janela em binário: id, metadados e o JPEG sem base64', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), id = '2b0f1c1e-1111-4222-8333-444455556666';
  const bytes = windowFrame(id, { image: jpeg, width: 1500, height: 777, seq: 9, url: 'https://exemplo.com/', tabs: [{ tab: 1, title: 'Início', active: true }] });
  assert.equal(bytes[0], 1);
  const idLength = bytes[1], metaLength = bytes.readUInt32BE(2 + idLength), start = 6 + idLength;
  assert.equal(bytes.subarray(2, 2 + idLength).toString(), id);
  assert.deepEqual(JSON.parse(bytes.subarray(start, start + metaLength)), { width: 1500, height: 777, seq: 9, url: 'https://exemplo.com/', tabs: [{ tab: 1, title: 'Início', active: true }] });
  assert.ok(bytes.subarray(start + metaLength).equals(jpeg));
});
