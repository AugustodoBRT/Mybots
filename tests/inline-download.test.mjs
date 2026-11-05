import test from 'node:test';
import assert from 'node:assert/strict';
import { isInlineDocument } from '../pc/browser-worker.mjs';

const main = {};
const response = (headers, { status = 200, navigation = true, frame = main } = {}) => ({ status: () => status, headers: () => headers, request: () => ({ isNavigationRequest: () => navigation, frame: () => frame }) });
const page = { mainFrame: () => main };

test('a document the page opens inline (PDF, Office) counts as a file to keep; pages, attachments, errors and subframes do not', () => {
  assert.equal(isInlineDocument(response({ 'content-type': 'application/pdf' }), page), true);
  assert.equal(isInlineDocument(response({ 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document; charset=x' }), page), true);
  assert.equal(isInlineDocument(response({ 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="a.pdf"' }), page), false, 'Chrome already saves attachments');
  assert.equal(isInlineDocument(response({ 'content-type': 'text/html' }), page), false);
  assert.equal(isInlineDocument(response({ 'content-type': 'application/pdf' }, { status: 404 }), page), false);
  assert.equal(isInlineDocument(response({ 'content-type': 'application/pdf' }, { navigation: false }), page), false);
  assert.equal(isInlineDocument(response({ 'content-type': 'application/pdf' }, { frame: {} }), page), false);
});

import { tabKey } from '../pc/browser-worker.mjs';
test('two tabs of the same page are told apart from different pages: the session id and the #fragment do not count', () => {
  assert.equal(tabKey('https://sig.cefetmg.br/sigaa/ava/index.jsf;jsessionid=AAA.inst06?x=1#topo'), tabKey('https://sig.cefetmg.br/sigaa/ava/index.jsf;jsessionid=BBB.inst06?x=1'));
  assert.notEqual(tabKey('https://sig.cefetmg.br/sigaa/ava/index.jsf?x=1'), tabKey('https://sig.cefetmg.br/sigaa/ava/index.jsf?x=2'));
  assert.notEqual(tabKey('https://a.com/x'), tabKey('https://b.com/x'));
  assert.equal(tabKey('about:blank'), 'about:blank');
});
