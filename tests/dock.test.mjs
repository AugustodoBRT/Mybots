import test from 'node:test';
import assert from 'node:assert/strict';
import { createDock } from '../pc/dock.mjs';

const client = (props) => ({ mapped: true, floating: false, focusHistoryID: 0, workspace: { id: 2, name: '2' }, ...props });

test('o Chrome dos bots encaixa na área da janela do MyBots, menos a faixa do app, e volta a ficar guardado', async () => {
  const calls = []; let list = [client({ class: 'mybots-desktop', address: '0xapp', at: [1927, 51], size: [1906, 962] }), client({ class: 'mybots-browser', address: '0xweb', at: [0, 0], size: [800, 600], workspace: { id: -98, name: 'special:mybots' } })];
  const dock = createDock({ run: async (...args) => { calls.push(args); if (args[0] === '--batch') list[1] = { ...list[1], workspace: { id: 2, name: '2' }, floating: true };
    return args[0] === 'clients' ? JSON.stringify(list) : 'ok'; } });
  const box = await dock.dock({ bottom: 64 });
  assert.deepEqual(box, { x: 1927, y: 51, width: 1906, height: 898 });
  const batch = calls.find(call => call[0] === '--batch')[1];
  for (const part of ['movetoworkspacesilent 2,address:0xweb', 'setfloating address:0xweb', 'resizewindowpixel exact 1906 898,address:0xweb', 'movewindowpixel exact 1927 51,address:0xweb', 'alterzorder top']) assert.ok(batch.includes(part), part);
  assert.equal(dock.docked, true);
  await dock.undock();
  assert.ok(calls.some(call => call.join(' ').includes('movetoworkspacesilent special:mybots,address:0xweb')));
  assert.equal(dock.docked, false); dock.close();
});

test('sem a janela do MyBots ou sem o Chrome, não encaixa e diz por quê', async () => {
  const dock = createDock({ run: async () => '[]' });
  await assert.rejects(() => dock.dock(), /janela do MyBots/);
  const only = createDock({ run: async () => JSON.stringify([client({ class: 'mybots-desktop', address: '0xapp', at: [0, 0], size: [100, 100] })]) });
  await assert.rejects(() => only.dock(), /ainda não abriu/);
});
