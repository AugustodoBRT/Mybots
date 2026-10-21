import { now } from './database.mjs';

/**
 * The computer that runs tasks for this supervisor. The phone stays the source of truth; a connected computer
 * only executes the turns of the bots that live there (and of the "any" bots while it is on). Each connection
 * brings an `execute` with the same signature as the local one; v37 adds the network link that provides it.
 * Known computers and when they were last seen are kept in metadata, so "visto por último" survives restarts.
 */
export class Nodes {
  constructor(db, { changed = () => {} } = {}) { Object.assign(this, { db, changed }); this.online = new Map(); }
  known() { try { const list = JSON.parse(this.db.get("SELECT value FROM metadata WHERE key='nodes'")?.value || '[]'); return Array.isArray(list) ? list : []; } catch { return []; } }
  save(node) {
    const list = [...this.known().filter(item => item.id !== node.id), node].slice(-5);
    this.db.run("INSERT INTO metadata VALUES('nodes',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", JSON.stringify(list));
  }
  /** A computer came online. Returns the function that marks it offline again. */
  connect({ id, name = 'Computador', execute }) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id) || typeof execute !== 'function') throw new Error('Computador inválido.');
    const node = { id, name: String(name).slice(0, 60) || 'Computador', kind: 'pc', execute, connectedAt: now() };
    this.online.set(id, node); this.save({ id, name: node.name, lastSeen: node.connectedAt });
    const bots = this.db.bots().filter(bot => !bot.deletedAt && bot.home === 'pc').length;
    this.db.record('node_connected', `${node.name} conectado${bots ? `: ${bots} ${bots > 1 ? 'bots ficaram' : 'bot ficou'} online` : ''}.`);
    this.changed('connection.changed');
    return () => this.disconnect(id, node);
  }
  disconnect(id, node = this.online.get(id)) {
    if (!node || this.online.get(id) !== node) return;
    this.online.delete(id); this.save({ id, name: node.name, lastSeen: now() });
    this.db.record('node_disconnected', `${node.name} desconectado.`);
    this.changed('connection.changed', { node: id });
  }
  /** Keeps "visto por último" close to the truth if the supervisor stops while a computer is connected. */
  touch() { for (const node of this.online.values()) this.save({ id: node.id, name: node.name, lastSeen: now() }); }
  computer() { return [...this.online.values()][0] || null; }
  /** Where a bot's next turn runs: 'phone', 'pc', or null while it waits for the computer. */
  lane(bot) {
    const home = bot?.home || 'phone';
    if (home === 'phone') return 'phone';
    if (this.computer()) return 'pc';
    return home === 'any' ? 'phone' : null;
  }
  executor(lane) { return lane === 'pc' ? this.computer()?.execute || null : null; }
  /** How the app shows a bot: online and where, or offline with the last time its computer was seen. */
  presence(bot) {
    const lane = this.lane(bot);
    if (lane) return { online: true, where: lane };
    const lastSeen = this.known().map(item => item.lastSeen).filter(Boolean).sort().at(-1) || null;
    return { online: false, where: null, lastSeen };
  }
  status() {
    return this.known().map(item => ({ id: item.id, name: item.name, online: this.online.has(item.id), lastSeen: this.online.has(item.id) ? now() : item.lastSeen }));
  }
}
