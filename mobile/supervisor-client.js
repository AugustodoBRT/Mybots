import { createId } from './local.js';

export class SupervisorClient {
  constructor({ WebSocketClass = globalThis.WebSocket, onEvent = () => {}, onConnection = () => {} } = {}) {
    this.WebSocketClass = WebSocketClass; this.onEvent = onEvent; this.onConnection = onConnection;
    this.pending = new Map(); this.serial = Promise.resolve(); this.closed = true; this.retries = 0;
  }
  async connect(credentials) {
    this.credentials = credentials; this.closed = false;
    if (this.socket?.readyState === 1 && this.authenticated) return;
    if (this.connecting) return this.connecting;
    this.connecting = new Promise((resolve, reject) => {
      const ws = new this.WebSocketClass(`ws://127.0.0.1:${credentials.port}`); this.socket = ws;
      let settled = false;
      const timeout = setTimeout(() => { ws.close(); if (!settled) reject(new Error('O supervisor não respondeu. Tente conectar novamente.')); }, 7000);
      ws.onopen = () => {
        this.request('auth', { token: credentials.token }, true).then(() => {
          settled = true; clearTimeout(timeout); this.authenticated = true; this.retries = 0;
          this.onConnection(true); resolve();
        }).catch(error => { clearTimeout(timeout); this.onRefused?.(error); reject(error); ws.close(); });
      };
      ws.binaryType = 'arraybuffer';
      ws.onmessage = event => {
        if (this.socket !== ws) return;
        // A picture of a bot's Chrome from the computer: binary, see windowFrame in pc/ui.mjs.
        if (typeof event.data !== 'string') { this.onFrame?.(event.data); return; }
        let message; try { message = JSON.parse(event.data); } catch { return; }
        if (message.event) { this.onEvent(message.event, message.data); return; }
        const pending = this.pending.get(message.id);
        if (pending) { this.pending.delete(message.id); clearTimeout(pending.timer); message.error ? pending.reject(new Error(message.error)) : pending.resolve(message.result); }
      };
      ws.onerror = () => { if (!settled) { clearTimeout(timeout); reject(new Error('Não consegui conectar ao supervisor no Termux.')); } };
      ws.onclose = () => {
        if (this.socket !== ws) return;
        clearTimeout(timeout); this.authenticated = false;
        for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('A conexão com o supervisor foi interrompida. O pedido salvo continua no Termux.')); }
        this.pending.clear(); this.onConnection(false);
        if (!settled) reject(new Error('O supervisor está desconectado.'));
        if (!this.closed) this.scheduleReconnect();
      };
    }).finally(() => { this.connecting = null; });
    return this.connecting;
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
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('O supervisor demorou para confirmar o pedido. Confira a atividade antes de reenviar.')); }, 45000);
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
    this.closed = true; clearTimeout(this.reconnectTimer); this.socket?.close(); this.authenticated = false;
  }
}
