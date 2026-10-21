import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDictation } from '../pc/dictation.mjs';

test('dictation on the computer: records until stopped, transcribes locally in Portuguese, deletes the audio; cancel discards', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-dictation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  // A recorder that writes the file it is given and waits for Ctrl+C, and a whisper-cli that prints its arguments' language.
  const recorder = join(directory, 'rec'); const whisper = join(directory, 'fake-whisper-cli');
  await writeFile(recorder, `#!/bin/sh\nfor last; do :; done\necho audio > "$last"\ntrap 'exit 0' INT\nwhile :; do sleep 0.05; done\n`, { mode: 0o700 });
  await writeFile(whisper, `#!/bin/sh\nwhile [ $# -gt 0 ]; do [ "$1" = -l ] && lang=$2; [ "$1" = -f ] && file=$2; shift; done\n[ -s "$file" ] || exit 1\necho " [Música] Oi bot, abre o SIGAA em $lang"\n`, { mode: 0o700 });
  const dictation = createDictation(directory, { recorder, whisper, model: join(directory, 'ggml-small.bin') });
  assert.deepEqual(dictation.start('janela'), { recording: true });
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.deepEqual(await dictation.stop('janela'), { text: 'Oi bot, abre o SIGAA em pt' });
  assert.deepEqual(await readdir(join(directory, 'whisper', 'tmp')), []);
  await assert.rejects(dictation.stop('janela'), /terminou/);
  dictation.start('outra');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.deepEqual(dictation.cancel('outra'), { cancelled: true });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.deepEqual(await readdir(join(directory, 'whisper', 'tmp')), []);
  // Without whisper.cpp it says what to install instead of failing silently.
  assert.throws(() => createDictation(directory, { recorder, whisper: null }).start('x'), /whisper\.cpp/);
});

test('dictation with faster-whisper: the model process starts with the recording, stays loaded and answers each dictation', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-faster-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const recorder = join(directory, 'rec'); const python = join(directory, 'fake-python');
  await writeFile(recorder, `#!/bin/sh\nfor last; do :; done\necho audio > "$last"\ntrap 'exit 0' INT\nwhile :; do sleep 0.05; done\n`, { mode: 0o700 });
  // Stands in for "python -I transcribe.py": ready once, then one answer per audio, counting how many times it started.
  await writeFile(python, `#!/bin/sh\necho start >> "${join(directory, 'starts')}"\necho '{"ready": true}'\nwhile read line; do echo '{"text": "  Bom dia,   bot  "}'; done\n`, { mode: 0o700 });
  const dictation = createDictation(directory, { recorder, python });
  t.after(() => dictation.close());
  for (const id of ['um', 'dois']) {
    dictation.start(id); await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(await dictation.stop(id), { text: 'Bom dia, bot' });
  }
  assert.equal((await readFile(join(directory, 'starts'), 'utf8')).trim().split('\n').length, 1);
});
