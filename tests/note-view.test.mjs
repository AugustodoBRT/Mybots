import test from 'node:test';
import assert from 'node:assert/strict';
import { linkParts, noteDestination, noteProperties, readableDate } from '../mobile/state/note-view.js';

test('properties come from front matter or from the header lines the bots write, and nothing else', () => {
  assert.deepEqual(noteProperties('Bot: Atlas\nData: 2026-11-07T15:53:01.180Z\nAssunto: Vagas\n\nTexto'),
    { properties: [['Bot', 'Atlas'], ['Data', '2026-11-07T15:53:01.180Z'], ['Assunto', 'Vagas']], body: 'Texto' });
  assert.deepEqual(noteProperties('---\nstatus: ativo\nprojeto: "Site"\n---\n# Título'), { properties: [['status', 'ativo'], ['projeto', 'Site']], body: '# Título' });
  for (const text of ['Gupy: login exigido\nLinkedIn: falhou\n\nmais', 'Bot: só uma linha\n\nTexto', 'Texto comum', '']) assert.deepEqual(noteProperties(text).properties, [], text);
  assert.match(readableDate('2026-11-07T15:53:01.180Z'), /^07\/11\/2026 às \d\d:53$/);
  assert.equal(readableDate('amanhã'), 'amanhã');
});

test('link spellings resolve to the destinations the supervisor sent', () => {
  assert.deepEqual(linkParts('Central de Vagas|o painel'), { name: 'Central de Vagas', label: 'o painel' });
  assert.deepEqual(linkParts('Projeto#Prazos'), { name: 'Projeto', label: 'Projeto#Prazos' });
  const links = [{ path: 'chefe/central-de-vagas.md', names: ['Central de Vagas'] }, { path: 'chefe/pessoa.md' }];
  assert.equal(noteDestination('Central de Vagas|painel', links).path, 'chefe/central-de-vagas.md');
  assert.equal(noteDestination('pessoa', links).path, 'chefe/pessoa.md');
  assert.equal(noteDestination('Outra', links), undefined);
});
