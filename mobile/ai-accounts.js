/**
 * The accounts of one IA a bot can use, by where the bot lives. `aiAccounts` is what the supervisor reports
 * ({ here: { name, accounts }, computer: { name, accounts } }, each `accounts` keyed by IA). The IA's own login ("default") always exists;
 * a bot that lives on both devices ("any") sees the accounts either one has. Without an extra account there is nothing to choose.
 */
export const DEFAULT_ACCOUNT = 'default';

export function accountChoices(aiAccounts, provider, home = 'phone') {
  const devices = [home !== 'pc' ? aiAccounts?.here : null, home !== 'phone' ? aiAccounts?.computer : null].filter(Boolean);
  const byId = new Map();
  for (const device of devices) for (const item of device.accounts?.[provider] || []) {
    const known = byId.get(item.id);
    byId.set(item.id, known ? { ...known, loggedIn: known.loggedIn || item.loggedIn } : { id: item.id, label: item.label, loggedIn: Boolean(item.loggedIn) });
  }
  const list = [...byId.values()];
  return list.length > 1 ? [{ id: DEFAULT_ACCOUNT, label: 'Conta principal', loggedIn: list.find(item => item.id === DEFAULT_ACCOUNT)?.loggedIn ?? true }, ...list.filter(item => item.id !== DEFAULT_ACCOUNT)] : [];
}

/** The name of the account a bot uses, for a summary ("Trabalho"); empty for the default one. */
export function accountLabel(aiAccounts, provider, home, id) {
  if (!id || id === DEFAULT_ACCOUNT) return '';
  return accountChoices(aiAccounts, provider, home).find(item => item.id === id)?.label || id;
}
