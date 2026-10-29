import { useEffect, useRef, useState } from 'react';
import { View, Text, Image, Pressable } from 'react-native';
import { C, Icon, F, themed } from '../theme';
import { TabStrip, AddressRow } from '../BotBrowserPanel';

const s = themed(() => ({
  panel: { flex: 1, gap: 9, padding: 12, backgroundColor: C.bg2, borderLeftWidth: 1, borderLeftColor: C.line },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1, color: C.text, fontFamily: F.b, fontSize: 14.5 },
  close: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  stage: { flex: 1, minHeight: 200, borderRadius: 14, overflow: 'hidden', backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: C.line2 },
  stageOn: { borderColor: C.accent },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, gap: 8, backgroundColor: C.surface2 },
  emptyText: { color: C.muted, fontFamily: F.m, fontSize: 13.5, textAlign: 'center' },
  watching: { position: 'absolute', right: 10, bottom: 10, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 28, borderRadius: 14, backgroundColor: '#000000AA' },
  watchingText: { color: '#FFFFFF', fontFamily: F.m, fontSize: 12 },
  hint: { color: C.muted, fontFamily: F.m, fontSize: 12.5 },
  error: { color: C.red, fontFamily: F.m, fontSize: 12.5 },
  control: { minHeight: 44, flexDirection: 'row', gap: 8, borderRadius: 14, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  controlBack: { backgroundColor: C.surface2, borderWidth: 1, borderColor: C.accent },
  controlText: { color: C.accentInk, fontFamily: F.x, fontSize: 14 }
}));

const SPECIAL = ['Enter', 'Backspace', 'Delete', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'];

/**
 * The bot's browser on the phone, in the window of the computer: the page as pictures (asked one after the other, a few a second), its
 * tab, and, after "Assumir", the mouse and the keyboard of the computer acting on it (taps, scroll, typing, paste).
 */
export default function PhoneBrowserLive({ bot, assumed, call, onControl, onClose }) {
  const [frame, setFrame] = useState(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const stage = useRef(null), frameRef = useRef(null), chain = useRef(Promise.resolve()); frameRef.current = frame;
  useEffect(() => {
    let live = true, timer;
    const loop = async () => {
      if (!live) return; const started = Date.now();
      if (!globalThis.document?.hidden) { try { const next = await call('browser.phoneFrame', { botId: bot.id }); if (live) { setFrame(next); setError(''); } } catch (failure) { if (live) setError(failure.message || 'Não consegui ver o navegador.'); } }
      if (live) timer = setTimeout(loop, Math.max(250, 700 - (Date.now() - started)));
    };
    loop(); return () => { live = false; clearTimeout(timer); };
  }, [bot.id]);
  // Everything the person does goes one after the other (typing keeps its order).
  const send = params => { chain.current = chain.current.then(() => call('browser.phoneInput', { botId: bot.id, ...params })).catch(failure => setError(failure.message || 'Não deu para enviar.')); };
  useEffect(() => {
    const node = stage.current; if (!node || !assumed || !node.addEventListener) return undefined;
    node.tabIndex = 0;
    const point = event => {
      const f = frameRef.current; if (!f) return null; const rect = node.getBoundingClientRect(), scale = Math.min(rect.width / f.width, rect.height / f.height);
      const x = (event.clientX - rect.left - (rect.width - f.width * scale) / 2) / scale, y = (event.clientY - rect.top - (rect.height - f.height * scale) / 2) / scale;
      return x < 0 || y < 0 || x > f.width || y > f.height ? null : { x, y };
    };
    let wheelX = 0, wheelY = 0, wheelTimer = null;
    const click = event => { node.focus(); const p = point(event); if (p) send({ action: 'click', ...p }); };
    const wheel = event => { event.preventDefault(); wheelX += event.deltaX; wheelY += event.deltaY; if (!wheelTimer) wheelTimer = setTimeout(() => { send({ action: 'scroll', dx: wheelX, dy: wheelY }); wheelX = 0; wheelY = 0; wheelTimer = null; }, 90); };
    const key = event => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.length === 1) { event.preventDefault(); send({ action: 'text', text: event.key }); }
      else if (SPECIAL.includes(event.key)) { event.preventDefault(); send({ action: 'key', key: event.key }); }
    };
    const paste = event => { const text = event.clipboardData?.getData('text/plain'); if (text) { event.preventDefault(); send({ action: 'text', text }); } };
    node.addEventListener('click', click); node.addEventListener('wheel', wheel, { passive: false }); node.addEventListener('keydown', key); node.addEventListener('paste', paste);
    return () => { clearTimeout(wheelTimer); node.removeEventListener('click', click); node.removeEventListener('wheel', wheel); node.removeEventListener('keydown', key); node.removeEventListener('paste', paste); };
  }, [assumed, bot.id]);
  const take = async who => { setBusy(true); setError(''); try { await onControl(who); } catch (failure) { setError(failure.message); } finally { setBusy(false); } };
  return <View style={s.panel}>
    <View style={s.bar}>
      <Icon name="phone" size={18} color={assumed ? C.accent : C.muted} /><Text style={s.title} numberOfLines={1}>Navegador de {bot.name} · celular</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Fechar navegador" onPress={onClose} style={s.close}><Icon name="close" size={17} color={C.text2} /></Pressable>
    </View>
    {frame?.url && frame.url !== 'about:blank' ? <TabStrip tabs={[{ tab: 1, title: frame.title || frame.url, url: frame.url, active: true }]} enabled={false} /> : null}
    <AddressRow url={frame?.url} enabled={assumed} back forward onBack={() => send({ action: 'back' })} onForward={() => send({ action: 'forward' })} onReload={() => send({ action: 'reload' })} placeholder="Ainda não abriu nenhuma página." />
    <View ref={stage} style={[s.stage, assumed && s.stageOn]} accessibilityLabel={assumed ? 'Navegador do celular: clique, role e digite aqui' : 'Navegador do celular, só olhando'}>
      {frame?.image ? <Image source={{ uri: `data:image/jpeg;base64,${frame.image}` }} resizeMode="contain" style={{ width: '100%', height: '100%' }} />
        : <View style={s.empty}><Text style={s.emptyText}>{error || 'Abrindo a tela do navegador do celular…'}</Text></View>}
      {!assumed && frame ? <View pointerEvents="none" style={s.watching}><Icon name="info" size={12} color="#FFFFFF" /><Text style={s.watchingText}>Só olhando</Text></View> : null}
    </View>
    {frame && error ? <Text style={s.error}>{error}</Text> : null}
    <Text style={s.hint}>{assumed ? 'Você está no controle: clique, role e digite na página. O bot espera.' : 'A página aparece alguns quadros por segundo. Toque em Assumir para mexer com o mouse e o teclado.'}</Text>
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => take(assumed ? 'bot' : 'person')} style={[s.control, assumed && s.controlBack, busy && { opacity: 0.5 }]}>
      <Icon name={assumed ? 'bots' : 'hand'} size={18} color={assumed ? C.accent : C.accentInk} stroke={2} /><Text style={[s.controlText, assumed && { color: C.accent }]}>{assumed ? 'Devolver ao bot' : 'Assumir'}</Text>
    </Pressable>
  </View>;
}
