import { createId, validateBackup } from './local.js';

export async function createTermuxBackup(run, snapshot) {
  const serialized = JSON.stringify(validateBackup(snapshot));
  if (serialized.length > 20_000_000) throw new Error('O backup é grande demais.');
  const requestId = createId();
  let index = 0;
  for (let offset = 0; offset < serialized.length;) {
    let end = Math.min(offset + 12000, serialized.length);
    if (end < serialized.length && /[\uD800-\uDBFF]/.test(serialized[end - 1])) end--;
    const result = await run('backupPart', { requestId, index: index++, chunk: serialized.slice(offset, end) });
    offset = end;
    if (result.exitCode !== 0 || result.errorMessage) throw new Error('Não consegui salvar o backup no Termux. A cópia anterior foi preservada.');
  }
  const result = await run('backupFinish', { requestId, count: index });
  if (result.exitCode !== 0 || result.errorMessage) throw new Error('Não consegui concluir o backup no Termux.');
  const backup = JSON.parse(result.stdout);
  if (typeof backup.name !== 'string' || typeof backup.path !== 'string') throw new Error('O Termux não confirmou o arquivo de backup.');
  return backup;
}
