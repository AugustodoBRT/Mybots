import test from 'node:test';
import assert from 'node:assert/strict';
import { createDirector } from '../lib/mimo-mood.mjs';

const clock = () => { let t = 1e6; return { now: () => t, advance: ms => { t += ms; } }; };
const snap = (over = {}) => ({ working: false, waiting: false, asleep: false, draft: 0, last: null, ...over });
const msg = (id, role, extra = {}) => ({ id, role, status: 'complete', ...extra });

test('o estado de fundo: parado, trabalhando, esperando e dormindo', () => {
  const c = clock(), d = createDirector({ now: c.now, surtos: false });
  assert.equal(d.observe('a', snap()), 'normal'); assert.equal(d.observe('a', snap({ working: true })), 'trabalhando');
  d.observe('a', snap({ working: true, waiting: true })); c.advance(1300); d.tick(); assert.equal(d.moodOf('a'), 'esperando', 'esperar a decisão vale mais que trabalhar');
  assert.equal(d.observe('a', snap({ asleep: true, working: true, waiting: true })), 'dormindo', 'dormindo vale mais que tudo');
  d.observe('a', snap()); c.advance(1300); d.tick(); assert.equal(d.moodOf('a'), 'normal');
});

test('trabalhando → falando enquanto a resposta é escrita → falando ao chegar → concluído → parado', () => {
  const c = clock(), d = createDirector({ now: c.now, surtos: false });
  const at = s => d.observe('a', s);
  at(snap()); at(snap({ last: msg('1', 'assistant') }));
  c.advance(10000); at(snap({ last: msg('1', 'assistant') })); // nothing new: stays calm
  at(snap({ last: msg('2', 'user') })); assert.equal(d.moodOf('a'), 'curioso', 'a mensagem da pessoa chama a atenção');
  c.advance(1600); d.tick(); at(snap({ working: true, last: msg('2', 'user') })); assert.equal(d.moodOf('a'), 'trabalhando');
  c.advance(3000); at(snap({ working: true, draft: 20, last: msg('2', 'user') })); assert.equal(d.moodOf('a'), 'falando', 'a resposta aparecendo');
  c.advance(800); at(snap({ working: true, draft: 60, last: msg('2', 'user') })); assert.equal(d.moodOf('a'), 'falando');
  c.advance(1600); d.tick(); assert.equal(d.moodOf('a'), 'trabalhando', 'sem texto novo ele volta ao trabalho');
  at(snap({ working: false, draft: 0, last: msg('3', 'assistant') })); assert.equal(d.moodOf('a'), 'falando', 'a resposta chegou');
  c.advance(2400); d.tick(); assert.equal(d.moodOf('a'), 'concluido', 'depois fica contente'); c.advance(2500); d.tick(); assert.equal(d.moodOf('a'), 'normal');
});

test('se ainda trabalha depois de falar, volta a trabalhar em vez de ficar contente', () => {
  const c = clock(), d = createDirector({ now: c.now, surtos: false }); d.observe('a', snap({ working: true, last: msg('1', 'user') }));
  d.observe('a', snap({ working: true, last: msg('2', 'assistant') })); assert.equal(d.moodOf('a'), 'falando'); c.advance(2400); d.tick(); assert.equal(d.moodOf('a'), 'trabalhando');
});

test('erro aparece na hora, por cinco segundos, mesmo falando; esperar uma decisão assusta um instante', () => {
  const c = clock(), d = createDirector({ now: c.now, surtos: false }); d.observe('a', snap({ working: true, draft: 5 }));
  d.observe('a', snap({ working: true, draft: 9 })); assert.equal(d.moodOf('a'), 'falando');
  d.observe('a', snap({ working: false, draft: 0, last: msg('e', 'assistant', { status: 'error' }) })); assert.equal(d.moodOf('a'), 'erro');
  c.advance(4900); d.tick(); assert.equal(d.moodOf('a'), 'erro'); c.advance(200); d.tick(); assert.equal(d.moodOf('a'), 'normal');
  d.observe('a', snap({ waiting: true })); assert.equal(d.moodOf('a'), 'surpreso'); c.advance(1300); d.tick(); assert.equal(d.moodOf('a'), 'esperando');
  // the same message turning into an error later also counts
  d.observe('a', snap({ last: msg('x', 'assistant', { status: 'streaming' }) })); d.observe('a', snap({ last: msg('x', 'assistant', { status: 'error' }) })); assert.equal(d.moodOf('a'), 'erro');
});

test('dormindo não fala nem reage; ao acordar, um susto; a primeira leitura não dispara reação', () => {
  const c = clock(), d = createDirector({ now: c.now, surtos: false });
  assert.equal(d.observe('a', snap({ asleep: true, last: msg('1', 'assistant') })), 'dormindo'); // first sight: no reaction to old messages
  assert.equal(d.observe('a', snap({ asleep: true, last: msg('2', 'assistant') })), 'dormindo');
  assert.equal(d.observe('a', snap({ asleep: false, last: msg('2', 'assistant') })), 'surpreso'); c.advance(1300); d.tick(); assert.equal(d.moodOf('a'), 'normal');
});

test('em uma sala o bot que fala reage; os surtos do mal vêm sozinhos, só parado ou trabalhando', () => {
  const c = clock(); let r = 0.5, d = createDirector({ now: c.now, random: () => r });
  d.observe('a', snap()); d.spoke('a', msg('s', 'assistant')); assert.equal(d.moodOf('a'), 'falando'); c.advance(2400); d.tick(); assert.equal(d.moodOf('a'), 'concluido'); c.advance(2500); d.tick();
  const seen = new Set(); for (let i = 0; i < 400; i++) { c.advance(250); d.tick(); seen.add(d.moodOf('a')); } assert.ok(seen.has('domal') && seen.has('normal'), [...seen].join());
  d = createDirector({ now: c.now, random: () => 0 }); d.observe('z', snap({ waiting: true })); c.advance(60000); d.tick(); assert.equal(d.moodOf('z'), 'esperando', 'esperando não vira surto');
  d.observe('d', snap({ asleep: true })); c.advance(60000); d.tick(); assert.equal(d.moodOf('d'), 'dormindo');
  // one fit lasts about a second and a half
  d = createDirector({ now: c.now, random: () => 0 }); d.observe('f', snap()); c.advance(8000); assert.deepEqual(d.tick(), ['f']); assert.equal(d.moodOf('f'), 'domal'); c.advance(1600); d.tick(); assert.equal(d.moodOf('f'), 'normal');
});

test('tick só devolve quem mudou e forget esquece o bot', () => {
  const c = clock(), d = createDirector({ now: c.now, surtos: false }); d.observe('a', snap()); d.observe('b', snap({ working: true })); assert.deepEqual(d.tick(), []);
  d.observe('a', snap({ last: msg('1', 'user') })); d.observe('a', snap({ last: msg('2', 'user') })); c.advance(1600); assert.deepEqual(d.tick(), ['a']); d.forget('a'); assert.equal(d.moodOf('a'), 'normal');
});
