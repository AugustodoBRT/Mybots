import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The screens of the v63 redesign follow the plan's rules: Portuguese only, sentence case, no spaced capitals,
// no stripe on one side of a card, no gradients, no bottom tab bar.
const FILES = ['screens/Home.js', 'components/Drawer.js', 'components/CommandBar.js', 'components/Lists.js', 'components/Settings.js', 'components/Passwords.js', 'components/NewBot.js', 'components/FacePicker.js', 'BotProfile.js', 'NegotiationPanel.js', 'components/DesktopShell.js', 'components/Activity.js'];
const source = file => readFileSync(new URL(`../mobile/${file}`, import.meta.url), 'utf8');
const ENGLISH = /\b(Loading|Cancel|Save|Settings|Search|Delete|Close|Back|Next|Send|Edit|Profile|Wallet|Activity|Message|Actions|Overlay|Approval|Transaction|Command Bar|Online|Offline|Submit|Remove|Add)\b/;

test('textos visíveis das telas novas estão em português', () => {
  for (const file of FILES) {
    const code = source(file);
    const shown = [...code.matchAll(/>([^<>{}=]*[A-Za-zÀ-ú][^<>{}=]*)</g)].map(match => match[1].trim()).filter(Boolean)
      .concat([...code.matchAll(/(?:label|title|placeholder|accessibilityLabel|subtitle)="([^"]+)"/g)].map(match => match[1]));
    for (const text of shown) assert.ok(!ENGLISH.test(text), `${file}: "${text}"`);
  }
});

test('nada de maiúsculas espaçadas, faixa lateral, gradiente ou barra de abas nas telas novas', () => {
  for (const file of FILES) {
    const code = source(file);
    assert.ok(!/textTransform:\s*'uppercase'/.test(code), `${file}: texto em maiúsculas por estilo`);
    assert.ok(![...code.matchAll(/letterSpacing:\s*(-?[\d.]+)/g)].some(match => Number(match[1]) >= 0.5), `${file}: espaçamento largo entre letras`);
    assert.ok(!/(?:borderLeftWidth|borderRightWidth):\s*[3-9]/.test(code), `${file}: faixa colorida de um lado só`);
    assert.ok(!/LinearGradient|RadialGradient/.test(code), `${file}: gradiente`);
  }
  assert.ok(!/NavBar|bottomNav/.test(source('screens/Home.js')), 'a Home não tem barra de abas');
  assert.deepEqual([...source('screens/Home.js').matchAll(/>([A-ZÀ-Ú][A-ZÀ-Ú ]{4,})</g)], [], 'rótulos em maiúsculas na Home');
});

test('o rótulo de seção dos ajustes e do perfil não é mais maiúsculo com espaçamento', () => {
  assert.ok(!/sheetSection:[^}]*letterSpacing/.test(source('styles.js')));
  assert.ok(!/label:[^}]*letterSpacing/.test(source('BotProfile.js')));
  for (const file of ['App.js', 'BotProfile.js', 'NegotiationPanel.js']) assert.deepEqual([...source(file).matchAll(/>([A-ZÀ-Ú][A-ZÀ-Ú ]{5,})</g)].map(match => match[1]), [], file);
});
