import test from 'node:test';
import assert from 'node:assert/strict';
import { matchCategories, plain } from '../mobile/settings-search.js';
import { groupPasswords, passwordSummary } from '../mobile/password-groups.js';

const categories = [
  { key: 'account', title: 'Conta e IA', summary: 'Seu nome, aparência, e-mail e apps', keywords: ['tema', 'escuro', 'claro', 'gmail'] },
  { key: 'secrets', title: 'Senhas e carteira', summary: '3 senhas', keywords: ['cartão', 'pagamento'] },
  { key: 'backup', title: 'Backup', summary: 'Cópias e diagnóstico', keywords: ['restaurar'] }
];

test('a busca dos ajustes ignora acento e maiúsculas e exige todas as palavras', () => {
  assert.equal(plain('Aparência'), 'aparencia');
  assert.deepEqual(matchCategories('aparencia', categories).map(item => item.key), ['account']);
  assert.deepEqual(matchCategories('CARTAO', categories).map(item => item.key), ['secrets']);
  assert.deepEqual(matchCategories('senhas carteira', categories).map(item => item.key), ['secrets']);
  assert.deepEqual(matchCategories('tema backup', categories), []);
  assert.equal(matchCategories('  ', categories).length, 3);
});

const bots = [{ id: 'a' }, { id: 'b' }, { id: 'c', deletedAt: 'x' }];
test('senhas agrupadas por site, filtradas e ordenadas, sem mostrar segredo', () => {
  const list = [{ id: 1, host: 'www.sig.edu.br', username: 'zeca', bots: null }, { id: 2, host: 'github.com', username: 'ana', bots: ['a'] },
    { id: 3, host: 'sig.edu.br', username: 'ana', bots: ['a', 'c'] }, { id: 4, host: 'github.com', username: '', bots: ['b'] }];
  const groups = groupPasswords(list);
  assert.deepEqual(groups.map(group => [group.host, group.data.map(item => item.id)]), [['github.com', [4, 2]], ['sig.edu.br', [3, 1]]]);
  assert.deepEqual(groupPasswords(list, 'ANA').map(group => group.host), ['github.com', 'sig.edu.br']);
  assert.deepEqual(groupPasswords(list, 'sig zeca').flatMap(group => group.data.map(item => item.id)), [1]);
  assert.deepEqual(groupPasswords(list, 'inexistente'), []);
  assert.ok(groups.every(group => group.data.every(item => !('password' in item))));
});

test('o resumo conta senhas e bots com acesso (todos os bots quando não há restrição)', () => {
  assert.equal(passwordSummary([], bots), 'Nenhuma senha guardada');
  assert.equal(passwordSummary([{ id: 1, host: 'a', bots: ['a'] }], bots), '1 senha · 1 bot com acesso');
  assert.equal(passwordSummary([{ id: 1, host: 'a', bots: null }, { id: 2, host: 'b', bots: ['c'] }], bots), '2 senhas · 2 bots com acesso');
});

test('mil senhas agrupam e filtram depressa', () => {
  const list = Array.from({ length: 1000 }, (_, i) => ({ id: i, host: `site${i % 120}.com.br`, username: `user${i}`, bots: i % 3 ? null : ['a'] }));
  const started = performance.now(); const groups = groupPasswords(list); const found = groupPasswords(list, 'site7 user7');
  assert.equal(groups.length, 120); assert.ok(found.length > 0 && found.length < 120);
  assert.ok(performance.now() - started < 200, `${(performance.now() - started).toFixed(0)} ms`);
});
