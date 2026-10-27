import { textEdit, protectEdit } from './browser-input';
import { touchPoint, zoomAt } from './browser-coordinates';
import { browserMode } from './local';
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, PixelRatio, Image, PanResponder, TextInput, Modal, StatusBar } from 'react-native';
import { BotBrowserView, BotFrameView, browserAction, browserInfo, browserPresentation, browserInput } from './termux';
import { C, F, Icon } from './theme';

// The bot's request for help with its browser (login, password, CAPTCHA), shown in the conversation.
export function BrowserHelpCard({ bot, help, onOpen, onPc }) {
  return <View style={styles.helpCard}>
    <View style={styles.helpHead}><View style={styles.helpIcon}><Icon name="hand" size={18} color={C.sky} /></View><Text style={styles.helpEyebrow}>NAVEGADOR DO BOT</Text></View>
    <Text style={styles.helpTitle}>{bot.name} precisa de você</Text>
    <Text style={styles.helpBody}>{help.reason}</Text>
    <Text style={styles.helpHint}>{onPc ? 'Toque em Assumir, faça isso na página ao vivo do Chrome do bot e depois toque em “Devolver ao bot”. Senhas e códigos digitados aqui não vão para a IA.' : 'Toque em Assumir, faça isso na página e depois em “Devolver ao bot”. A senha fica no navegador do bot; ela não vai para a IA.'}</Text>
    <Pressable accessibilityRole="button" onPress={onOpen} style={styles.helpButton}><Icon name="globe" size={17} color="#0F1D2E" stroke={2} /><Text style={styles.helpButtonText}>Toque para resolver</Text></Pressable>
  </View>;
}

// The same takeover surface hosts the remote Chrome and the phone's own WebView.
function BrowserSurface({ assumed, control, children }) {
  useEffect(() => { browserPresentation(assumed); return () => browserPresentation(false); }, [assumed]);
  if (!assumed) return <>{children}</>;
  return <Modal visible presentationStyle="fullScreen" supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']} onRequestClose={() => control('bot')}><View style={styles.fullscreen}>{children}</View></Modal>;
}

// Frames of the bots' Chrome on the computer, from the supervisor's 'browser.frame' events (see App.js).
export const browserFrames = new Set();

// Keep the displayed bitmap until the other Image has finished decoding; retain only the newest waiting frame.
function LiveImages({ frame }) {
  const [layers, setLayers] = useState([null, null]); const [front, setFront] = useState(0);
  const buffer = useRef({ front: 0, loading: null, latest: null, decoded: [null, null] });
  const load = () => {
    const state = buffer.current; if (state.loading !== null || !state.latest) return;
    const next = 1 - state.front, image = state.latest; state.latest = null;
    if (state.decoded[next] === image) { state.front = next; setFront(next); return; }
    state.loading = next; state.decoded[next] = null;
    setLayers(current => current.map((value, index) => index === next ? image : value));
  };
  useEffect(() => { if (frame?.image) { buffer.current.latest = frame.image; load(); } }, [frame?.image]);
  const ready = (index, image, ok) => {
    const state = buffer.current; if (state.loading !== index) return;
    state.loading = null;
    if (ok) { state.decoded[index] = image; state.front = index; setFront(index); }
    load();
  };
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>{layers.map((image, index) => image ? <Image key={index} source={{ uri: 'data:image/jpeg;base64,' + image }} style={[StyleSheet.absoluteFill, { zIndex: index === front ? 1 : 0 }]} resizeMode="stretch" fadeDuration={0} onLoad={() => ready(index, image, true)} onError={() => ready(index, image, false)} /> : null)}</View>;
}

/**
 * The bot's own Chrome on the computer, live inside MyBots: frames come from the computer; after "Assumir" a tap
 * clicks there, a drag scrolls, and the text box types into the page. Points go as fractions of the frame.
 */
function PcBrowserLive({ bot, call, assumed, busy, error, control, onClose }) {
  const [frame, setFrame] = useState(null); const [state, setState] = useState('connecting'); const [problem, setProblem] = useState('');
  const [captcha, setCaptcha] = useState(null); const challengeZoom = useRef(null); const returning = useRef(false);
  const [loading, setLoading] = useState(false); const [slow, setSlow] = useState(false); const [circle, setCircle] = useState(null); const circleTimer = useRef(null);
  const [viewport, setViewport] = useState(null); const [desktop, setDesktop] = useState(false);
  useEffect(() => { if (assumed) { returning.current = false; challengeZoom.current = null; } if (assumed && viewport) send({ type: 'viewport', width: viewport.cssWidth, height: viewport.cssHeight, deviceScaleFactor: PixelRatio.get() }); }, [assumed, viewport]);
  // A Chrome that reopened starts as a desktop again: a frame shaped unlike the phone's page brings the phone's size back.
  const resized = useRef(0);
  useEffect(() => {
    if (!assumed || desktop || !viewport || !frame?.width || (frame.width > frame.height) === (viewport.cssWidth > viewport.cssHeight) || Date.now() - resized.current < 3000) return;
    resized.current = Date.now(); send({ type: 'viewport', width: viewport.cssWidth, height: viewport.cssHeight, deviceScaleFactor: PixelRatio.get() });
  }, [assumed, desktop, viewport, frame?.width, frame?.height]);
  const [address, setAddress] = useState(null); const keyboard = useRef(null); const webInput = useRef({ before: '', text: '', key: null, secret: false }); const typeTimer = useRef(null);
  const webType = text => { webInput.current.text = text; clearTimeout(typeTimer.current); typeTimer.current = setTimeout(async () => { const input = webInput.current, next = input.text; if (!input.key || next === input.before) return; const edit = { ...textEdit(input.before, next), secret: input.secret }; input.before = next; try { send(await protectEdit(input.key, edit)); } catch { setProblem('Não consegui proteger a digitação.'); } }, 30); };
  useEffect(() => () => clearTimeout(typeTimer.current), []);
  const nonce = useRef(0);
  const [zoom, setZoom] = useState({ scale: 1, translateX: 0, translateY: 0, rotation: 0 });
  const zoomRef = useRef(zoom); zoomRef.current = zoom; const lastTap = useRef(0);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const size = useRef({ width: 1, height: 1 }); const area = useRef(null); const bar = useRef(null); const [areaSize, setAreaSize] = useState(null); const live = useRef({ assumed, frame: null });
  live.current = { assumed, frame, desktop, botId: bot.id, call, control };
  const send = input => { if (!BotFrameView && input.type === 'keyboard') { keyboard.current?.focus(); return; } if (BotFrameView) browserInput(live.current.botId, JSON.stringify({ ...input, nonce: ++nonce.current })); else live.current.call('browser.input', { botId: live.current.botId, input }).catch(e => setProblem(e.message)); };
  useEffect(() => { setDrag({ x: 0, y: 0 }); }, [frame?.seq]);
  const challenge = data => {
    if (!data) return; setCaptcha(data);
    if (data.rect && live.current.assumed) {
      const r = data.rect, signature = JSON.stringify(r);
      if (challengeZoom.current !== signature) { challengeZoom.current = signature; const { width, height } = size.current, k = width / data.width, room = area.current || size.current;
        // The floating controls cover the bottom of the visor: the challenge is fitted and centered in the part above them.
        const free = Math.max(120, Math.min(room.height, (bar.current?.y ?? Infinity) - (room.y || 0))), lift = (free - room.height) / 2;
        const scale = Math.max(.6, Math.min(4, .85 * Math.min(room.width / (r.width * k), free / (r.height * k)))); setZoom({ scale,rotation:0,translateX:-( (r.x+r.width/2)/data.width*width-width/2 )*scale,translateY:-( (r.y+r.height/2)/data.height*height-height/2 )*scale + lift }); }
    }
    if (data.solved && data.autoReturn && live.current.assumed && !returning.current) { returning.current = true; live.current.control('bot'); }
  };
  useEffect(() => {
    setFrame(null); setState('connecting');
    const listener = data => {
      if (data?.botId !== bot.id) return;
      if (data.captcha) challenge(data.captcha);
      if (typeof data.loading === 'boolean') setLoading(data.loading);
      if (typeof data.slow === 'boolean') setSlow(data.slow);
      if (data.inputKey) webInput.current.key = data.inputKey;
      if (data.focus && !BotFrameView) { webInput.current.secret = data.focus.secret; if (data.focus.active) { webInput.current.before = ''; webInput.current.text = ''; keyboard.current?.clear(); keyboard.current?.focus(); } else keyboard.current?.blur(); }
      if (typeof data.desktop === 'boolean') setDesktop(data.desktop);
      if (data.closed) { setState('closed'); if (!BotFrameView) keyboard.current?.blur(); }
      else if (data.error) setProblem(data.error);
      else if (data.image || data.width) { setFrame(data); setState('live'); setProblem(''); }
    };
    browserFrames.add(listener);
    const watch = () => call('browser.view', { botId: bot.id, on: true, native: Boolean(BotFrameView), ...viewport }).then(result => { if (!result?.online) setState('offline'); }).catch(e => { setState('offline'); setProblem(e.message); });
    watch();
    return () => { browserFrames.delete(listener); call('browser.view', { botId: bot.id, on: false }).catch(() => {}); };
  }, [bot.id, browserMode(bot)]);
  useEffect(() => { if (viewport) call('browser.view', { botId: bot.id, on: true, native: Boolean(BotFrameView), ...viewport }).catch(e => setProblem(e.message)); }, [viewport, bot.id, browserMode(bot)]);
  const reopen = () => { setState('connecting'); call('browser.view', { botId: bot.id, on: false }).catch(() => {}).then(() => call('browser.view', { botId: bot.id, on: true, native: Boolean(BotFrameView), ...viewport })).catch(e => setProblem(e.message)); };
  const touch = useRef(null);
  const local = at => ({ x: at.locationX - (size.current.x || 0), y: at.locationY - (size.current.y || 0) });
  const point = event => { const at = local(event.nativeEvent); return touchPoint({ locationX: at.x, locationY: at.y }, size.current, zoomRef.current); };
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => live.current.assumed && Boolean(live.current.frame),
    onMoveShouldSetPanResponder: () => live.current.assumed && Boolean(live.current.frame),
    onPanResponderGrant: event => {
      setCircle({ x: event.nativeEvent.locationX, y: event.nativeEvent.locationY }); clearTimeout(circleTimer.current); circleTimer.current = setTimeout(() => setCircle(null), 350);
      const p = point(event); touch.current = { ...p, at: 0, dx: 0, dy: 0 };
      if (Date.now() - lastTap.current < 300) { touch.current.zooming = true; setZoom(view => zoomAt(view, local(event.nativeEvent), view.scale > 1 ? 1 : 2.5, size.current.width, size.current.height)); return; }
      if (!live.current.desktop) send({ type: 'touch', phase: 'touchStart', points: [p] });
    },
    onPanResponderMove: (event, gesture) => {
      const start = touch.current; if (!start) return;
      const fingers = event.nativeEvent.touches;
      if (fingers.length >= 2) {
        if (!start.zooming) { start.zooming = true; send({ type: 'touch', phase: 'touchCancel', points: [] }); }
        const distance = Math.hypot(fingers[0].pageX - fingers[1].pageX, fingers[0].pageY - fingers[1].pageY);
        const a = local(fingers[0]), b = local(fingers[1]), center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (!start.pinch) start.pinch = { distance, zoom: zoomRef.current, center };
        setZoom({ ...zoomAt(start.pinch.zoom, start.pinch.center, start.pinch.zoom.scale * distance / start.pinch.distance, size.current.width, size.current.height), translateX: zoomAt(start.pinch.zoom, start.pinch.center, start.pinch.zoom.scale * distance / start.pinch.distance, size.current.width, size.current.height).translateX + center.x - start.pinch.center.x, translateY: zoomAt(start.pinch.zoom, start.pinch.center, start.pinch.zoom.scale * distance / start.pinch.distance, size.current.width, size.current.height).translateY + center.y - start.pinch.center.y });
        return;
      }
      if (start.zooming) return;
      setDrag({ x: gesture.dx - start.dx, y: gesture.dy - start.dy });
      if (Date.now() - start.at < 50) return;
      start.at = Date.now();
      if (live.current.desktop) { const scale = (live.current.frame?.height || 800) / size.current.height; send({ type: 'scroll', x: start.x, y: start.y, dx: -(gesture.dx - start.dx) * scale, dy: -(gesture.dy - start.dy) * scale }); }
      else send({ type: 'touch', phase: 'touchMove', points: [point(event)] });
      start.dx = gesture.dx; start.dy = gesture.dy;
    },
    onPanResponderRelease: (event, gesture) => {
      const start = touch.current; touch.current = null; if (!start || start.zooming) return;
      if (Math.abs(gesture.dx) + Math.abs(gesture.dy) < 10) lastTap.current = Date.now();
      if (!live.current.desktop) send({ type: 'touch', phase: 'touchEnd', points: [] });
      else if (Math.abs(gesture.dx) + Math.abs(gesture.dy) < 10) send({ type: 'tap', x: start.x, y: start.y });
    },
    onPanResponderTerminate: () => { touch.current = null; send({ type: 'touch', phase: 'touchCancel', points: [] }); setDrag({ x: 0, y: 0 }); }
  })).current;
  const go = () => { if (address?.trim()) send({ type: 'open', url: address.trim() }); setAddress(null); };
  const shown = frame?.url && frame.url !== 'about:blank' ? frame.url.replace(/^https?:\/\//, '') : '';
  return <BrowserSurface assumed={assumed} control={control}><View style={[styles.panel, assumed && styles.fullPanel]}>
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
    <View style={[styles.live, assumed ? styles.fullFrame : { aspectRatio: frame ? frame.width / frame.height : 1.6 }, assumed && styles.frameAssumed]}
      onLayout={event => { const layout = event.nativeEvent.layout; area.current = layout; setAreaSize({ width: layout.width, height: layout.height }); const next = { maxWidth: PixelRatio.getPixelSizeForLayoutSize(layout.width), maxHeight: PixelRatio.getPixelSizeForLayoutSize(layout.height), cssWidth: layout.width, cssHeight: layout.height }; setViewport(current => current?.maxWidth === next.maxWidth && current?.maxHeight === next.maxHeight ? current : next); }} {...responder.panHandlers}>
      {/* The page keeps its proportions: a desktop page on a standing phone gets bands instead of being stretched. */}
      <View pointerEvents="none" style={fitted(frame, areaSize)} onLayout={event => { size.current = event.nativeEvent.layout; }}>
      {BotFrameView ? <BotFrameView pointerEvents="none" key={bot.id} botId={bot.id} style={[StyleSheet.absoluteFill, { transform: [{ translateX: zoom.translateX + drag.x }, { translateY: zoom.translateY + drag.y }, { rotate: `${zoom.rotation}deg` }, { scale: zoom.scale }] }]} onMetadata={event => { const data = event.nativeEvent; if (data.captcha) challenge(data.captcha); if (typeof data.loading === 'boolean') setLoading(data.loading); if (typeof data.slow === 'boolean') setSlow(data.slow); if (typeof data.desktop === 'boolean') setDesktop(data.desktop); if (data.error) setProblem(data.error); else if (data.closed) setState('closed'); else if (data.width) { setFrame(data); setState('live'); setProblem(''); } }} /> : frame ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { transform: [{ translateX:zoom.translateX+drag.x }, { translateY:zoom.translateY+drag.y }, { rotate:`${zoom.rotation}deg` }, { scale:zoom.scale }] }]}><LiveImages key={bot.id} frame={frame} /></View>
        : <View style={styles.empty}><Text style={styles.hint}>{state === 'closed' ? 'O Chrome deste bot está fechado.' : state === 'offline' ? 'O computador está desconectado. A página aparece quando ele voltar.' : 'Abrindo o Chrome do bot no computador…'}</Text></View>}
      </View>
      {circle ? <View pointerEvents="none" style={{ position:'absolute',left:circle.x-18,top:circle.y-18,width:36,height:36,borderRadius:18,borderWidth:2,borderColor:C.mint,backgroundColor:'#54E8B344' }} /> : null}
      {loading ? <View pointerEvents="none" accessibilityLabel="Carregando página" style={{ position:'absolute',left:0,top:0,height:3,width:'65%',backgroundColor:C.mint }} /> : null}
      {slow ? <View pointerEvents="none" style={styles.closed}><Text style={styles.watchingText}>Conexão lenta</Text></View> : null}
      {frame && state === 'closed' ? <View style={styles.closed}><Text style={styles.watchingText}>Chrome fechado</Text></View> : null}
      {!assumed && frame ? <View pointerEvents="none" style={styles.watching}><Icon name="info" size={12} color={C.text2} /><Text style={styles.watchingText}>Só olhando</Text></View> : null}
    </View>
    {state === 'closed' ? <Pressable accessibilityRole="button" onPress={reopen} style={styles.reopen}><Icon name="refresh" size={14} color={C.mint} /><Text style={[styles.hint, { color: C.mint }]}>Abrir o Chrome de novo</Text></Pressable> : null}
    {assumed ? <View style={styles.floatingControls} onLayout={event => { bar.current = event.nativeEvent.layout; }}>
      <Pressable accessibilityRole="button" onPress={() => setZoom({ scale: 1, translateX: 0, translateY: 0, rotation: 0 })}><Text style={styles.hint}>Zoom {Math.round(zoom.scale * 100)}% · Redefinir</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => { const next = !desktop; setDesktop(next); send({ type: 'viewport', width: viewport?.cssWidth || 360, height: viewport?.cssHeight || 640, deviceScaleFactor: PixelRatio.get(), desktop: next }); }}><Text style={styles.hint}>{desktop ? 'Ver como celular' : 'Ver como computador'}</Text></Pressable>
      {!BotFrameView ? <TextInput ref={keyboard} style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} onChangeText={webType} autoCapitalize="none" onSubmitEditing={() => send({ type:'key',key:'Enter' })} blurOnSubmit={false} /> : null}
      {captcha?.present || captcha?.solved ? <View style={styles.keys}><Text style={styles.hint}>{captcha.solved ? 'Desafio resolvido · Devolver ao bot' : 'Resolva o desafio na página'}</Text><Pressable accessibilityRole="switch" accessibilityState={{ checked: !!captcha.autoReturn }} onPress={() => send({ type:'captcha',autoReturn:!captcha.autoReturn })}><Text style={styles.hint}>{captcha.autoReturn ? '☑' : '☐'} Devolver sozinho depois de resolver</Text></Pressable></View> : null}
      <View style={styles.keys}>
        <Pressable accessibilityRole="button" onPress={() => send({ type: 'keyboard' })} style={styles.key}><Text style={styles.keyText}>Teclado</Text></Pressable>
        {[['Enter','Enter'],['Tab','Tab'],['Esc','Escape']].map(([label,key]) => <Pressable key={key} accessibilityRole="button" onPress={() => send({ type: 'key', key })} style={styles.key}><Text style={styles.keyText}>{label}</Text></Pressable>)}
      </View>
    </View> : null}
    {problem || error ? <Text style={styles.error}>{problem || error}</Text> : null}
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => control(assumed ? 'bot' : 'person')} style={[styles.control, assumed && styles.controlBack, busy && { opacity: 0.5 }]}>
      <Icon name={assumed ? 'bots' : 'hand'} size={18} color={assumed ? C.mint : C.mintInk} stroke={2} /><Text style={[styles.controlText, assumed && styles.controlBackText]}>{assumed ? 'Devolver ao bot' : 'Assumir'}</Text>
    </Pressable>
  </View></BrowserSurface>;
}

/**
 * "Navegador do bot": the bot's own WebView, live. Watching only until the person taps "Assumir"; then the
 * bot's browser commands are refused until "Devolver ao bot".
 */
function fitted(frame, room) {
  if (!frame?.width || !room) return StyleSheet.absoluteFill;
  // The visor's 2-point border is inside its layout size.
  const width = room.width - 4, height = room.height - 4, k = Math.min(width / frame.width, height / frame.height);
  return { position: 'absolute', left: (width - frame.width * k) / 2, top: (height - frame.height * k) / 2, width: frame.width * k, height: frame.height * k, backgroundColor: '#FFFFFF' };
}

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
  return <BrowserSurface assumed={assumed} control={control}><View style={[styles.panel, assumed && styles.fullPanel]}>
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
    <View style={[styles.frame, assumed && styles.fullFrame, assumed && styles.frameAssumed]}>
      <BotBrowserView botId={bot.id} interactive={assumed} style={StyleSheet.absoluteFill} onPage={event => setPage(event.nativeEvent)} />
      {!assumed ? <View pointerEvents="none" style={styles.watching}><Icon name="info" size={12} color={C.text2} /><Text style={styles.watchingText}>Só olhando</Text></View> : null}
    </View>
    {assumed ? <View style={styles.keys}><Pressable onPress={() => act('keyboard')} accessibilityRole="button" style={styles.key}><Text style={styles.keyText}>Teclado</Text></Pressable><Pressable onPress={() => act('zoom')} accessibilityRole="button" style={styles.key}><Text style={styles.keyText}>Zoom +</Text></Pressable><Pressable onPress={() => act('zoomOut')} accessibilityRole="button" style={styles.key}><Text style={styles.keyText}>Zoom −</Text></Pressable></View> : null}
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {assumed ? <Text style={styles.hint}>Você está usando o navegador; o bot espera. Login do Google não funciona aqui: para Gmail, Agenda e Drive use os apps da conta.</Text> : null}
    {info && !info.isolated ? <Text style={styles.hint}>Este celular não separa os navegadores dos bots: quando outro bot usar o navegador, os logins deste são apagados. Atualize o “Android System WebView”.</Text> : null}
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => control(assumed ? 'bot' : 'person')} style={[styles.control, assumed && styles.controlBack, busy && { opacity: 0.5 }]}>
      <Icon name={assumed ? 'bots' : 'hand'} size={18} color={assumed ? C.mint : C.mintInk} stroke={2} /><Text style={[styles.controlText, assumed && styles.controlBackText]}>{assumed ? 'Devolver ao bot' : 'Assumir'}</Text>
    </Pressable>
  </View></BrowserSurface>;
}

const styles = StyleSheet.create({
  fullscreen: { flex: 1, backgroundColor: C.surface, paddingTop: StatusBar.currentHeight || 24, paddingBottom: 12 },
  floatingControls: { position:'absolute',bottom:74,left:14,right:14,padding:10,borderRadius:18,gap:6,backgroundColor:C.surface+'F0',borderWidth:1,borderColor:C.line2 },
  fullPanel: { flex: 1, margin: 0, marginHorizontal: 0, marginTop: 0, marginBottom: 0, borderRadius: 0 },
  fullFrame: { flex: 1, aspectRatio: undefined, backgroundColor: C.surface2 },
  panel: { marginHorizontal: 12, marginTop: 10, marginBottom: 6, padding: 10, borderRadius: 24, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line2, gap: 9 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lock: { width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface2 },
  title: { color: C.text, fontFamily: F.b, fontSize: 13.5 }, url: { color: C.muted, fontFamily: F.m, fontSize: 11.5, marginTop: 1 },
  tool: { width: 36, height: 36, borderRadius: 12, backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line },
  frame: { aspectRatio: 0.625, borderRadius: 16, overflow: 'hidden', backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: C.line2 },
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
