import { PROVIDER_NAMES } from '../lib/models.mjs';

/**
 * What the person can do with the extra IA accounts of one device: add one (the answer carries the command that logs it in, to run in a
 * terminal of that device), remove one, or check again who is logged in. `refresh` reads the logins again and returns the device's status
 * ({ accounts }); the same code runs on the phone's supervisor and on the computer's node.
 */
export async function manageAccounts({ op, provider, id, label }, { accounts, refresh = async () => ({}) }) {
  if (!['list', 'add', 'command', 'remove', 'verify'].includes(op)) throw new Error('Operação desconhecida.');
  if (op !== 'list' && !PROVIDER_NAMES[provider]) throw new Error('Escolha uma IA válida.');
  let account = null, command = null;
  if (op === 'add') { account = accounts.add(provider, label); command = accounts.loginCommand(provider, account.id); }
  else if (op === 'command') { command = accounts.loginCommand(provider, String(id || '')); }
  else if (op === 'remove') { accounts.remove(provider, String(id || '')); }
  const status = op === 'command' ? {} : await refresh();
  return { ...(account ? { account } : {}), ...(command ? { command } : {}), accounts: status.accounts || null };
}
