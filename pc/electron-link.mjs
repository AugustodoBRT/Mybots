import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from './node_modules/playwright-core/index.mjs';

// The MyBots window is Electron and hosts the bots' shared browser as real tabs. It leaves its DevTools port and a small
// control server (token) in the node's folder; the browser worker attaches to the same Chromium through them.
export function electronInfo(directory) {
  try { const info = JSON.parse(readFileSync(join(directory, 'electron.json'), 'utf8')); process.kill(info.pid, 0); return info; } catch { return null; }
}
export async function connectElectron(info) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${info.cdp}`, { timeout: 15000, noDefaults: true });
  const context = browser.contexts()[0]; if (!context) throw new Error('O navegador da janela não está pronto.');
  Object.defineProperty(context, 'electron', { value: info });
  return context;
}
export async function electronCall(info, path, body = {}) {
  const response = await fetch(`http://127.0.0.1:${info.control}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${info.token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
  const value = await response.json(); if (!response.ok) throw new Error(value.error || 'A janela recusou o pedido.'); return value;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
/** A new tab of the window's browser, as a Playwright page: the window opens it blank with a marker in the address. */
export async function electronPage(context) {
  const { marker } = await electronCall(context.electron, '/tab/create', {});
  for (let n = 0; n < 60; n++) {
    const page = context.pages().find(item => item.url().endsWith(`#${marker}`));
    if (page) { page.mybotsMarker = marker; return page; }
    await sleep(100);
  }
  throw new Error('A aba nova não apareceu no navegador da janela.');
}
