// The Android sign-in terminal uses the same verified, complete install as the supervisor.
import { spawn } from 'node:child_process';
import { aiBinary, aiUpdate, managedBinary, missingRuntimeParts } from '../lib/ai-runtimes.mjs';

try {
  if (!managedBinary('codex') || missingRuntimeParts()) {
    console.log('Preparando o Codex e suas ferramentas…');
    const { results } = await aiUpdate({ keys: ['codex'] });
    if (!results[0]?.ok) throw new Error(results[0]?.message || 'Não consegui instalar o Codex.');
  }
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn(aiBinary('codex'), ['login'], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', code => resolve(code ?? 1));
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
