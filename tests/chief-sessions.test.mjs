import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionsOf, OPENED_LINE, startsSession } from '../mobile/state/sessions.js';
import { createLayout } from '../mobile/state/graph-layout.js';

test('sessões do Chefe: cada linha de nova sessão separa, o nome vem da primeira fala da pessoa e a mais nova vem primeiro', () => {
  const list = sessionsOf([
    { id: '1', role: 'user', text: 'Qual a vaga de hoje?\nPreciso saber', createdAt: 'a' }, { id: '2', role: 'assistant', text: 'x', createdAt: 'b' },
    { id: '3', role: 'system', text: OPENED_LINE, createdAt: 'c' },
    { id: '4', role: 'user', text: 'y'.repeat(100), createdAt: 'd' },
    { id: '5', role: 'system', text: 'Nova sessão da IA iniciada a pedido da pessoa. A conversa continua.', createdAt: 'e' },
    { id: '6', role: 'user', text: 'terceira', createdAt: 'f' }
  ]);
  assert.deepEqual(list.map(item => item.title.length > 50 ? 'longo' : item.title), ['terceira', 'longo', 'Qual a vaga de hoje? Preciso saber']);
  assert.ok(list[1].title.endsWith('…'));
  assert.equal(startsSession({ role: 'system', text: 'Nova sessão da IA, iniciada sozinha para economizar contexto' }), false);
});

test('grafo com disco livre: nenhuma nota fica dentro dele, nem as arrastadas', () => {
  const nodes = Array.from({ length: 60 }, (_, i) => ({ id: 'n' + i })), edges = Array.from({ length: 59 }, (_, i) => ({ from: 'n' + i, to: 'n' + (i + 1) }));
  const layout = createLayout({ nodes, edges, options: { hole: 100 } });
  layout.run({ maxTicks: 400 });
  layout.pin('n3', 5, 5);
  for (const { x, y } of layout.nodes()) assert.ok(Math.hypot(x, y) >= 99.9 || (x === 5 && y === 5) === false);
  layout.tick();
  const pinned = layout.nodes().find(item => item.id === 'n3');
  assert.ok(Math.hypot(pinned.x, pinned.y) >= 99.9);
  for (const { x, y } of layout.nodes()) assert.ok(Math.hypot(x, y) >= 99.9);
});

test('sessões antigas sem linha de divisão: uma pausa de seis horas separa', () => {
  const at = hours => new Date(Date.UTC(2026, 10, 7, 9) + hours * 3600000).toISOString();
  const list = sessionsOf([
    { id: '1', role: 'user', text: 'primeira', createdAt: at(0) }, { id: '2', role: 'assistant', text: 'r', createdAt: at(0.1) },
    { id: '3', role: 'user', text: 'depois de dormir', createdAt: at(22) }, { id: '4', role: 'assistant', text: 'r', createdAt: at(22.2) }, { id: '5', role: 'user', text: 'mais', createdAt: at(23) }
  ]);
  assert.deepEqual(list.map(item => [item.title, item.count]), [['depois de dormir', 3], ['primeira', 2]]);
});
