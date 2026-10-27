import { browserMode } from './local';
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Dimensions, Image, PanResponder, TextInput } from 'react-native';
import { BotBrowserView, browserAction, browserInfo } from './termux';
import { C, F, Icon } from './theme';

// The bot's request for help with its browser (login, password, CAPTCHA), shown in the conversation.
export function BrowserHelpCard({ bot, help, onOpen, onPc }) {
  return <View style={styles.helpCard}>
    <View style={styles.helpHead}><View style={styles.helpIcon}><Icon name="hand" size={18} color={C.sky} /></View><Text style={styles.helpEyebrow}>NAVEGADOR DO BOT</Text></View>
    <Text style={styles.helpTitle}>{bot.name} precisa de você</Text>
    <Text style={styles.helpBody}>{help.reason}</Text>
    <Text style={styles.helpHint}>{onPc ? 'Toque em Assumir, faça isso na página ao vivo do Chrome do bot e depois toque em “Devolver ao bot”. Senhas e códigos digitados aqui não vão para a IA.' : 'Toque em Assumir, faça isso na página e depois em “Devolver ao bot”. A senha fica no navegador do bot; ela não vai para a IA.'}</Text>
    <Pressable accessibilityRole="button" onPress={onOpen} style={styles.helpButton}><Icon name="globe" size={17} color="#0F1D2E" stroke={2} /><Text style={styles.helpButtonText}>Abrir navegador e assumir</Text></Pressable>
  </View>;
}

// Frames of the bots' Chrome on the computer, from the supervisor's 'browser.frame' events (see App.js).
export const browserFrames = new Set();

// Keep the displayed bitmap until the other Image has finished decoding; retain only the newest waiting frame.
function LiveImages({ frame }) {
  const [layers, setLayers] = useState([null, null]); const [front, setFront] = useState(0);
  const buffer = useRef({ front: 0, loading: null, latest: null });
  const load = () => {
    const state = buffer.current; if (state.loading !== null || !state.latest) return;
    const next = 1 - state.front, image = state.latest; state.latest = null; state.loading = next;
    setLayers(current => current.map((value, index) => index === next ? image : value));
  };
  useEffect(() => { if (frame?.image) { buffer.current.latest = frame.image; load(); } }, [frame?.image]);
  const ready = (index, ok) => {
    const state = buffer.current; if (state.loading !== index) return;
    state.loading = null;
    if (ok) { state.front = index; setFront(index); }
    load();
  };
  return layers.map((image, index) => image ? <Image key={index} source={{ uri: 'data:image/jpeg;base64,' + image }} style={[StyleSheet.absoluteFill, { zIndex: index === front ? 1 : 0 }]} resizeMode="stretch" fadeDuration={0} onLoad={() => ready(index, true)} onError={() => ready(index, false)} /> : null);
}

/**
 * The bot's own Chrome on the computer, live inside MyBots: frames come from the computer; after "Assumir" a tap
 * clicks there, a drag scrolls, and the text box types into the page. Points go as fractions of the frame.
 */
function PcBrowserLive({ bot, call, assumed, busy, error, control, onClose }) {
  const [frame, setFrame] = useState(null); const [state, setState] = useState('connecting'); const [problem, setProblem] = useState('');
  const [text, setText] = useState(''); const [secret, setSecret] = useState(false); const [address, setAddress] = useState(null);
  const size = useRef({ width: 1, height: 1 }); const live = useRef({ assumed, frame: null });
  live.current = { assumed, frame };
  const send = input => call('browser.input', { botId: bot.id, input }).catch(e => setProblem(e.message));
  useEffect(() => {
    setFrame(null); setState('connecting');
    const listener = data => {
      if (data?.botId !== bot.id) return;
      if (data.closed) setState('closed');
      else if (data.error) setProblem(data.error);
      else if (data.image) { setFrame(data); setState('live'); setProblem(''); }
    };
    browserFrames.add(listener);
    const watch = () => call('browser.view', { botId: bot.id, on: true }).then(result => { if (!result?.online) setState('offline'); }).catch(e => { setState('offline'); setProblem(e.message); });
    watch();
    return () => { browserFrames.delete(listener); call('browser.view', { botId: bot.id, on: false }).catch(() => {}); };
  }, [bot.id, browserMode(bot)]);
  const reopen = () => { setState('connecting'); call('browser.view', { botId: bot.id, on: false }).catch(() => {}).then(() => call('browser.view', { botId: bot.id, on: true })).catch(e => setProblem(e.message)); };
  // A short touch is a click; a drag scrolls the page under the finger (sent while dragging, a few times a second).
  const touch = useRef(null);
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => live.current.assumed && Boolean(live.current.frame),
    onMoveShouldSetPanResponder: () => live.current.assumed && Boolean(live.current.frame),
    onPanResponderGrant: event => { const { locationX, locationY } = event.nativeEvent; touch.current = { x: locationX / size.current.width, y: locationY / size.current.height, sentY: 0, sentX: 0, at: 0 }; },
    onPanResponderMove: (event, gesture) => {
      const start = touch.current; if (!start || Date.now() - start.at < 120 || Math.abs(gesture.dy) + Math.abs(gesture.dx) < 10) return;
      const scale = (live.current.frame?.height || 800) / size.current.height;
      const dy = -(gesture.dy - start.sentY) * scale, dx = -(gesture.dx - start.sentX) * scale;
      start.sentY = gesture.dy; start.sentX = gesture.dx; start.at = Date.now(); start.moved = true;
      send({ type: 'scroll', x: start.x, y: start.y, dx, dy });
    },
    onPanResponderRelease: (event, gesture) => {
      const start = touch.current; touch.current = null; if (!start) return;
      if (!start.moved && Math.abs(gesture.dx) + Math.abs(gesture.dy) < 10) send({ type: 'tap', x: Math.max(0, Math.min(1, start.x)), y: Math.max(0, Math.min(1, start.y)) });
      else if (start.moved) { const scale = (live.current.frame?.height || 800) / size.current.height; send({ type: 'scroll', x: start.x, y: start.y, dx: -(gesture.dx - start.sentX) * scale, dy: -(gesture.dy - start.sentY) * scale }); }
    }
  })).current;
  const typeText = () => { if (!text) return; send({ type: 'text', text }); setText(''); };
  const go = () => { if (address?.trim()) send({ type: 'open', url: address.trim() }); setAddress(null); };
  const shown = frame?.url && frame.url !== 'about:blank' ? frame.url.replace(/^https?:\/\//, '') : '';
  return <View style={styles.panel}>
    <View style={styles.bar}>
      <View style={styles.lock}><Icon name="laptop" size={16} color={assumed ? C.mint : C.muted} /></View>
      {assumed && address !== null ? <TextInput autoFocus style={[styles.address, { flex: 1 }]} value={address} onChangeText={setAddress} onSubmitEditing={go} onBlur={() => setAddress(null)} selectTextOnFocus placeholder="Endereço do site" placeholderTextColor="#6F7787" autoCapitalize="none" autoCorrect={false} keyboardType="url" returnKeyType="go" />
        : <Pressable style={{ flex: 1 }} disabled={!assumed} onPress={() => setAddress(frame?.url && frame.url !== 'about:blank' ? frame.url : '')} accessibilityRole={assumed ? 'button' : undefined} accessibilityLabel={assumed ? 'Digitar endereço' : undefined}>
          <Text style={styles.title} numberOfLines={1}>{browserMode(bot) === 'mine' ? 'Meu Chrome' : `Chrome de ${bot.name}`} · computador</Text>
          <Text style={styles.url} numberOfLines={1}>{shown || (state === 'closed' ? 'O Chrome deste bot está fechado.' : state === 'offline' ? 'Computador desconectado.' : assumed ? 'Toque aqui para digitar um endereço.' : 'Ainda não abriu nenhuma página.')}</Text>
        </Pressable>}
      {assumed ? <>
        <Pressable accessibilityRole="button" accessibilityLabel="Voltar página" hitSlop={6} onPress={() => send({ type: 'back' })} style={styles.tool}><Icon name="back" size={18} color={C.text2} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Recarregar página" hitSlop={6} onPress={() => send({ type: 'reload' })} style={styles.tool}><Icon name="refresh" size={17} color={C.text2} /></Pressable>
      </> : <Pressable accessibilityRole="button" accessibilityLabel="Fechar navegador" hitSlop={6} onPress={onClose} style={styles.tool}><Icon name="close" size={17} color={C.text2} /></Pressable>}
    </View>
    {frame?.tabs?.length > 1 ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, padding: 6 }}>{frame.tabs.map(tab => <Pressable key={tab.tab} disabled={!assumed} accessibilityRole="button" accessibilityState={{ selected: tab.active, disabled: !assumed }} onPress={() => send({ type: 'tab', tab: tab.tab })} style={[styles.tool, { flex: 1, opacity: tab.active ? 1 : 0.6 }]}><Text style={styles.hint} numberOfLines={1}>{tab.tab} · {tab.title || 'Nova aba'}</Text></Pressable>)}</View> : null}
    <View style={[styles.live, { aspectRatio: frame ? frame.width / frame.height : 1.6 }, assumed && styles.frameAssumed]}
      onLayout={event => { size.current = event.nativeEvent.layout; }} {...responder.panHandlers}>
      {frame ? <LiveImages key={bot.id} frame={frame} />
        : <View style={styles.empty}><Text style={styles.hint}>{state === 'closed' ? 'O Chrome deste bot está fechado.' : state === 'offline' ? 'O computador está desconectado. A página aparece quando ele voltar.' : 'Abrindo o Chrome do bot no computador…'}</Text></View>}
      {frame && state === 'closed' ? <View style={styles.closed}><Text style={styles.watchingText}>Chrome fechado</Text></View> : null}
      {!assumed && frame ? <View pointerEvents="none" style={styles.watching}><Icon name="info" size={12} color={C.text2} /><Text style={styles.watchingText}>Só olhando</Text></View> : null}
    </View>
    {state === 'closed' ? <Pressable accessibilityRole="button" onPress={reopen} style={styles.reopen}><Icon name="refresh" size={14} color={C.mint} /><Text style={[styles.hint, { color: C.mint }]}>Abrir o Chrome de novo</Text></Pressable> : null}
    {assumed ? <>
      <View style={styles.typeRow}>
        <TextInput style={[styles.address, { flex: 1 }]} value={text} onChangeText={setText} onSubmitEditing={typeText} secureTextEntry={secret} blurOnSubmit={false}
          placeholder={secret ? 'Senha ou código (não vai para a IA)' : 'Digitar no campo tocado'} placeholderTextColor="#6F7787" autoCapitalize="none" autoCorrect={false} returnKeyType="send" />
        <Pressable accessibilityRole="switch" accessibilityState={{ checked: secret }} accessibilityLabel="Esconder o que digito" onPress={() => setSecret(value => !value)} style={[styles.tool, secret && styles.toolOn]}><Icon name="key" size={16} color={secret ? C.mint : C.text2} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Digitar na página" disabled={!text} onPress={typeText} style={styles.tool}><Icon name="send" size={16} color={text ? C.mint : C.faint} /></Pressable>
      </View>
      <View style={styles.keys}>{[['Enter', 'Enter'], ['Tab', 'Tab'], ['⌫', 'Backspace'], ['Esc', 'Escape'], ['↑', 'ArrowUp'], ['↓', 'ArrowDown']].map(([label, key]) =>
        <Pressable key={key} accessibilityRole="button" accessibilityLabel={`Tecla ${key}`} onPress={() => send({ type: 'key', key })} style={styles.key}><Text style={styles.keyText}>{label}</Text></Pressable>)}</View>
      <Text style={styles.hint}>{browserMode(bot) === 'mine' ? 'Meu Chrome usa seus logins. Toque para clicar e arraste para rolar. Todos os bots que usam Meu Chrome esperam até você devolver.' : 'Toque na página para clicar e arraste para rolar. O bot espera até você devolver. O Google não aceita login neste Chrome; para Gmail, Agenda e Drive use os apps da conta.'}</Text>
    </> : null}
    {problem || error ? <Text style={styles.error}>{problem || error}</Text> : null}
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => control(assumed ? 'bot' : 'person')} style={[styles.control, assumed && styles.controlBack, busy && { opacity: 0.5 }]}>
      <Icon name={assumed ? 'bots' : 'hand'} size={18} color={assumed ? C.mint : C.mintInk} stroke={2} /><Text style={[styles.controlText, assumed && styles.controlBackText]}>{assumed ? 'Devolver ao bot' : 'Assumir'}</Text>
    </Pressable>
  </View>;
}

/**
 * "Navegador do bot": the bot's own WebView, live. Watching only until the person taps "Assumir"; then the
 * bot's browser commands are refused until "Devolver ao bot".
 */
export default function BotBrowserPanel({ bot, browser, onControl, onClose, call, pc }) {
  const [page, setPage] = useState(browser?.pages?.[bot.id] || null);
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const assumed = browser?.control?.[bot.id] === 'person';
  const chrome = browserMode(bot) === 'claude' && (pc || browser?.pages?.[bot.id]?.engine === 'claude-chrome');
  const onPc = pc || browser?.pages?.[bot.id]?.where === 'pc';
  useEffect(() => { if (!onPc) browserInfo().then(setInfo).catch(() => {}); }, [onPc]);
  const control = async who => {
    setBusy(true); setError('');
    try { await onControl(who); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const act = action => browserAction(bot.id, action).catch(() => {});
  if (onPc && !chrome && call) return <PcBrowserLive bot={bot} call={call} assumed={assumed} busy={busy} error={error} control={control} onClose={onClose} />;
  if (onPc) return <View style={styles.panel}>
    <Text style={styles.title}>{chrome ? 'Chrome principal · Claude' : `Chrome de ${bot.name} no computador`}</Text>
    <Text style={styles.url}>{browser.pages[bot.id].url}</Text>
    <Text style={styles.hint}>{chrome ? 'Este bot usa seu Chrome principal (Claude in Chrome), com os seus logins. Essa janela fica no computador: para login, CAPTCHA ou código, toque em Assumir, use o Chrome no PC e depois devolva ao bot.' : 'A página está aberta no PC, no perfil deste bot.'}</Text>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => control(assumed ? 'bot' : 'person')} style={styles.control}><Text style={styles.controlText}>{assumed ? 'Devolver ao bot' : 'Assumir'}</Text></Pressable>
    {!assumed ? <Pressable accessibilityRole="button" onPress={onClose}><Text style={styles.hint}>Fechar painel</Text></Pressable> : null}
  </View>;
  if (!BotBrowserView) return null;
  return <View style={styles.panel}>
    <View style={styles.bar}>
      <View style={styles.lock}><Icon name="globe" size={16} color={assumed ? C.mint : C.muted} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1}>{page?.loading ? 'Carregando… ' : ''}{page?.title || (page?.url ? '' : `Navegador de ${bot.name}`)}</Text>
        <Text style={styles.url} numberOfLines={1}>{page?.url && page.url !== 'about:blank' ? page.url.replace(/^https?:\/\//, '') : 'Ainda não abriu nenhuma página.'}</Text>
      </View>
      {assumed ? <>
        <Pressable accessibilityRole="button" accessibilityLabel="Voltar página" hitSlop={6} onPress={() => act('back')} style={styles.tool}><Icon name="back" size={18} color={C.text2} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Recarregar página" hitSlop={6} onPress={() => act('reload')} style={styles.tool}><Icon name="refresh" size={17} color={C.text2} /></Pressable>
      </> : <Pressable accessibilityRole="button" accessibilityLabel="Fechar navegador" hitSlop={6} onPress={onClose} style={styles.tool}><Icon name="close" size={17} color={C.text2} /></Pressable>}
    </View>
    <View style={[styles.frame, assumed && styles.frameAssumed]}>
      <BotBrowserView botId={bot.id} interactive={assumed} style={StyleSheet.absoluteFill} onPage={event => setPage(event.nativeEvent)} />
      {!assumed ? <View pointerEvents="none" style={styles.watching}><Icon name="info" size={12} color={C.text2} /><Text style={styles.watchingText}>Só olhando</Text></View> : null}
    </View>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {assumed ? <Text style={styles.hint}>Você está usando o navegador; o bot espera. Login do Google não funciona aqui: para Gmail, Agenda e Drive use os apps da conta.</Text> : null}
    {info && !info.isolated ? <Text style={styles.hint}>Este celular não separa os navegadores dos bots: quando outro bot usar o navegador, os logins deste são apagados. Atualize o “Android System WebView”.</Text> : null}
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => control(assumed ? 'bot' : 'person')} style={[styles.control, assumed && styles.controlBack, busy && { opacity: 0.5 }]}>
      <Icon name={assumed ? 'bots' : 'hand'} size={18} color={assumed ? C.mint : C.mintInk} stroke={2} /><Text style={[styles.controlText, assumed && styles.controlBackText]}>{assumed ? 'Devolver ao bot' : 'Assumir'}</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  panel: { marginHorizontal: 12, marginTop: 10, marginBottom: 6, padding: 10, borderRadius: 24, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line2, gap: 9 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lock: { width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface2 },
  title: { color: C.text, fontFamily: F.b, fontSize: 13.5 }, url: { color: C.muted, fontFamily: F.m, fontSize: 11.5, marginTop: 1 },
  tool: { width: 36, height: 36, borderRadius: 12, backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line },
  frame: { height: Math.round(Dimensions.get('window').height * 0.42), borderRadius: 16, overflow: 'hidden', backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: C.line2 },
  frameAssumed: { borderColor: C.mint },
  live: { width: '100%', borderRadius: 14, overflow: 'hidden', backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: C.line2 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16, backgroundColor: C.surface2 },
  closed: { position: 'absolute', left: 8, top: 8, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10, backgroundColor: '#090B10D9' },
  reopen: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  address: { minHeight: 40, borderRadius: 12, paddingHorizontal: 12, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line, color: C.text, fontFamily: F.m, fontSize: 13.5 },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, toolOn: { borderColor: C.mint },
  keys: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, key: { minWidth: 44, height: 34, paddingHorizontal: 10, borderRadius: 10, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  keyText: { color: C.text2, fontFamily: F.b, fontSize: 12.5 },
  watching: { position: 'absolute', right: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10, backgroundColor: '#090B10D9' },
  watchingText: { color: C.text2, fontFamily: F.b, fontSize: 10.5 },
  hint: { color: C.muted, fontFamily: F.m, fontSize: 11.5, lineHeight: 17 }, error: { color: C.red, fontFamily: F.m, fontSize: 12 },
  control: { minHeight: 48, flexDirection: 'row', gap: 8, borderRadius: 16, backgroundColor: C.mint, alignItems: 'center', justifyContent: 'center' }, controlText: { color: C.mintInk, fontFamily: F.x, fontSize: 14.5 },
  controlBack: { backgroundColor: C.surface2, borderWidth: 1, borderColor: C.mint }, controlBackText: { color: C.mint },
  helpCard: { padding: 16, borderRadius: 22, borderWidth: 1, borderColor: C.sky + '55', backgroundColor: '#111925', gap: 7 },
  helpHead: { flexDirection: 'row', alignItems: 'center', gap: 9 }, helpIcon: { width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: C.sky + '1C' },
  helpEyebrow: { color: C.sky, fontFamily: F.x, fontSize: 10, letterSpacing: 1.4 }, helpTitle: { color: C.text, fontFamily: F.x, fontSize: 16.5, marginTop: 2 },
  helpBody: { color: C.text2, fontFamily: F.m, fontSize: 14, lineHeight: 21 }, helpHint: { color: C.muted, fontFamily: F.m, fontSize: 12, lineHeight: 17 },
  helpButton: { minHeight: 48, flexDirection: 'row', gap: 8, borderRadius: 16, backgroundColor: C.sky, alignItems: 'center', justifyContent: 'center', marginTop: 6 }, helpButtonText: { color: '#0F1D2E', fontFamily: F.x, fontSize: 14 }
});
