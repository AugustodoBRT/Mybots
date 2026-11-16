import { createId, validGoogleAccount } from './local.js';

export class SupervisorClient {
  async setGoogleAccount(botId, account) {
    const googleAccount = account.trim().toLowerCase();
    if (googleAccount && !validGoogleAccount(googleAccount)) throw new Error('Informe o e-mail completo da conta Google.');
    const updated = await this.call('bot.update', { botId, googleAccount });
    // Older phone supervisors accept bot.update but silently ignore unknown fields.
    if (updated?.googleAccount !== googleAccount) throw new Error('A conta não foi salva. Atualize o MyBots no celular e abra o app nele para concluir a atualização. Depois, tente adicionar novamente.');
    return updated;
  }
  constructor({ WebSocketClass = globalThis.WebSocket, onEvent = () => {}, onConnection = () => {}, connectTimeout = 7000, requestTimeout = 45000 } = {}) {
    this.WebSocketClass = WebSocketClass; this.onEvent = onEvent; this.onConnection = onConnection;
    this.connectTimeout = connectTimeout; this.requestTimeout = requestTimeout;
    this.pending = new Map(); this.serial = Promise.resolve(); this.closed = true; this.retries = 0;
  }
  async connect(credentials) {
    this.credentials = credentials; this.closed = false;
    if (this.socket?.readyState === 1 && this.authenticated) return;
    if (this.connecting) return this.connecting;
    clearTimeout(this.reconnectTimer);
    let abort;
    const work = new Promise((resolve, reject) => {
      const ws = new this.WebSocketClass(`ws://127.0.0.1:${credentials.port}`); this.socket = ws;
      let settled = false;
      const current = () => this.socket === ws && !this.closed;
      const fail = error => { if (settled) return; settled = true; clearTimeout(timeout); reject(error); };
      const timeout = setTimeout(() => { fail(new Error('O supervisor não respondeu. Tente conectar novamente.')); ws.close(); }, this.connectTimeout);
      abort = () => fail(new Error('Conexão encerrada.'));
      ws.onopen = () => {
        if (!current()) return;
        this.request('auth', { token: credentials.token }, true).then(() => {
          if (!current() || settled) return;
          settled = true; clearTimeout(timeout); this.authenticated = true; this.retries = 0;
          this.onConnection(true); resolve();
        }).catch(error => { if (!current()) return; this.onRefused?.(error); fail(error); ws.close(); });
      };
      ws.binaryType = 'arraybuffer';
      ws.onmessage = event => {
        if (!current()) return;
        if (typeof event.data !== 'string') { this.onFrame?.(event.data); return; }
        let message; try { message = JSON.parse(event.data); } catch { return; }
        if (message.event) { this.onEvent(message.event, message.data); return; }
        const pending = this.pending.get(message.id);
        if (pending) { this.pending.delete(message.id); clearTimeout(pending.timer); message.error ? pending.reject(new Error(message.error)) : pending.resolve(message.result); }
      };
      ws.onerror = () => { if (!current()) return; fail(new Error('Não consegui conectar ao MyBots.')); ws.close(); };
      ws.onclose = () => {
        if (!current()) return;
        clearTimeout(timeout); this.authenticated = false;
        this.rejectPending(); this.onConnection(false);
        fail(new Error('O supervisor está desconectado.'));
        if (!this.closed) this.scheduleReconnect();
      };
    }).finally(() => { if (this.connecting === work) { this.connecting = null; this.abortConnect = null; } });
    this.abortConnect = abort; this.connecting = work;
    return work;
  }
  rejectPending() {
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('A conexão com o supervisor foi interrompida. O pedido salvo continua lá.')); }
    this.pending.clear();
  }
  scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    const delay = Math.min(30000, 1000 * 2 ** Math.min(this.retries++, 5));
    this.reconnectTimer = setTimeout(() => {
      if (!this.closed) this.connect(this.credentials).catch(() => this.scheduleReconnect());
    }, delay);
  }
  request(method, params = {}, auth = false) {
    if (this.socket?.readyState !== 1 || (!auth && !this.authenticated)) return Promise.reject(new Error('O supervisor está desconectado. Tente conectar novamente.'));
    const id = createId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('O supervisor demorou para confirmar o pedido. Confira a atividade antes de reenviar.')); }, this.requestTimeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch { this.pending.delete(id); clearTimeout(timer); reject(new Error('A conexão com o supervisor foi interrompida.')); }
    });
  }
  call(method, params = {}) {
    // The server handles one request at a time per connection; events never count as replies.
    const work = this.serial.then(() => this.request(method, params));
    this.serial = work.catch(() => {}); return work;
  }
  close() {
    this.closed = true; clearTimeout(this.reconnectTimer);
    const socket = this.socket; this.socket = null; this.authenticated = false;
    this.abortConnect?.(); this.abortConnect = null; this.connecting = null;
    this.rejectPending(); socket?.close();
  }
}
