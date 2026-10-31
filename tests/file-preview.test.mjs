import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileReference, previewKind, referenceRuns } from '../mobile/file-references.js';
import { parseInline } from '../mobile/markdown.js';
import { createSupervisor } from '../supervisor/index.mjs';

test('file references preserve labels, filenames and safe external links', () => {
  assert.deepEqual(parseInline('[Revisão](sandbox:/mnt/data/revisao.md)'), [{ text: 'Revisão', file: 'sandbox:/mnt/data/revisao.md' }]);
  assert.equal(fileReference('/pasta/Meu%20arquivo.md#L12').name, 'Meu arquivo.md');
  for (const ref of ['javascript:evil.txt', 'data:text/plain,x.txt', 'https://example.com/a.mp4', 'custom:evil.md']) assert.equal(fileReference(ref), null);
  const runs = referenceRuns(parseInline('Confira final.mp4 e `roteiro.md`, depois [Site](https://example.com).'));
  assert.equal(runs.find(run => run.file)?.file, 'final.mp4');
  assert.equal(runs.find(run => run.href)?.href, 'https://example.com');
  assert.equal(previewKind({ name: 'projeto.zip' }), 'archive');
  assert.equal(previewKind({ name: 'final.mp4' }), 'video');
  assert.equal(previewKind({ name: 'pagina.html' }), 'text'); // never execute HTML
});

test('reference resolution is scoped to the bot and refuses missing or ambiguous files', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-preview-'));
  const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ model: 'm', efforts: ['low'], defaultEffort: 'low' }] };
  const app = await createSupervisor({ directory, port: 0, codex });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const bot = await app.rpc('bot.create', { name: 'Preview', model: 'm', reasoningEffort: 'low' });
  const other = await app.rpc('bot.create', { name: 'Other', model: 'm', reasoningEffort: 'low' });
  const file = app.tools.attachments.store(bot.id, { name: 'revisao.md', mime: 'text/markdown', bytes: Buffer.from('# Revisão') });
  assert.equal((await app.rpc('file.resolve', { botId: bot.id, reference: '/output/revisao.md' })).id, file.id);
  await assert.rejects(app.rpc('file.resolve', { botId: other.id, reference: file.id }), /disponibilizado/);
  await assert.rejects(app.rpc('file.resolve', { botId: bot.id, reference: '/etc/passwd' }), /disponibilizado/);
  app.tools.attachments.store(bot.id, { name: 'revisao.md', mime: 'text/markdown', bytes: Buffer.from('Outra versão') });
  await assert.rejects(app.rpc('file.resolve', { botId: bot.id, reference: 'revisao.md' }), /mais de um/);
});
