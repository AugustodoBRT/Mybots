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
