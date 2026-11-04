import { passwordsSyncState, passwordsSyncMerge } from './termux';

/**
 * The phone without Termux: its saved logins (in the app's Keystore) and the computer's vault become one. The app sends its own,
 * the computer merges them into its vault (newest change per site and user wins; deletions travel too) and answers with the whole,
 * which the app merges back. They travel only over the encrypted channel to the paired computer, never to a bot.
 */
export async function syncPasswords(call) {
  const mine = await passwordsSyncState();
  const merged = await call('passwords.sync', mine);
  if (merged && typeof merged === 'object') await passwordsSyncMerge(merged);
}
