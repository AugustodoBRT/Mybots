import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import runner from '../lib/codex-runner.cjs';

const line = (input, kind = 'token_count') => JSON.stringify({ type: 'event_msg', payload: { type: kind, info: { last_token_usage: { input_tokens: input, cached_input_tokens: input - 10 }, model_context_window: 258400 } } });

test('Codex: the size of the last model call comes from the end of the session rollout, in the folder of the day it began', async t => {
  const home = await mkdtemp(join(tmpdir(), 'mybots-codex-home-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const id = '01a1abfc-d1ad-7b53-947e-26e9abf00fc5', folder = join(home, 'sessions', '2026', '10', '30');
  await mkdir(folder, { recursive: true }); await mkdir(join(home, 'sessions', '2026', '11', '07'), { recursive: true });
  await writeFile(join(folder, `rollout-2026-10-30T10-00-00-${id}.jsonl`), [line(20000), '{"type":"response_item"}', line(61234), line(5, 'agent_message'), '{"broken'].join('\n') + '\n');
  assert.equal(await runner.lastContext(id, home), 61234);
  assert.equal(await runner.lastContext('9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d', home), null, 'another session');
  assert.equal(await runner.lastContext('não', home), null);
});
