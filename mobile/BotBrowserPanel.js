import { desktop as desktopWindow } from './desktop';
import { textEdit, protectEdit } from './browser-input';
import { touchPoint, zoomAt } from './browser-coordinates';
import { browserMode } from './local';
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, PixelRatio, Image, PanResponder, TextInput, Modal, StatusBar, ScrollView, ActivityIndicator, useWindowDimensions } from 'react-native';
import { BotBrowserView, BotFrameView, browserAction, browserInfo, browserPresentation, browserInput, termuxAvailable, walletRules, walletFreeze } from './termux';
import { C, F, Icon, themed } from './theme';

// The bot's request for help with its browser (login, password, CAPTCHA), shown in the conversation.
export function BrowserHelpCard({ bot, help, onOpen, onPc }) {
  return <View style={styles.helpCard}>
    <View style={styles.helpHead}><View style={styles.helpIcon}><Icon name="hand" size={18} color={C.sky} /></View><Text style={styles.helpEyebrow}>Navegador do bot</Text></View>
    <Text style={styles.helpTitle}>{bot.name} precisa de você</Text>
    <Text style={styles.helpBody}>{help.reason}</Text>
    <Text style={styles.helpHint}>{onPc ? 'Toque em Assumir, faça isso na página ao vivo do Chrome do bot e depois toque em “Devolver ao bot”. Senhas e códigos digitados aqui não vão para a IA.' : 'Toque em Assumir, faça isso na página e depois em “Devolver ao bot”. A senha fica no navegador do bot; ela não vai para a IA.'}</Text>
    <Pressable accessibilityRole="button" onPress={onOpen} style={styles.helpButton}><Icon name="globe" size={17} color="#0F1D2E" stroke={2} /><Text style={styles.helpButtonText}>Toque para resolver</Text></Pressable>
  </View>;
}

// The same takeover surface hosts the remote Chrome and the phone's own WebView. Beside the conversation (wide screens)
// it stays in place instead of covering the screen.
function BrowserSurface({ assumed, control, inline, children }) {
  useEffect(() => { browserPresentation(assumed && !inline); return () => browserPresentation(false); }, [assumed, inline]);
  if (!assumed || inline) return <>{children}</>;
  return <Modal visible presentationStyle="fullScreen" supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']} onRequestClose={() => control('bot')}><View style={styles.fullscreen}>{children}</View></Modal>;
}

// Frames of the bots' Chrome on the computer, from the supervisor's 'browser.frame' events (see App.js).
export const browserFrames = new Set();
// The supervisor's 'browser.step' (timeline) and 'browser.download' events, for the open conversation (see App.js).
export const browserEvents = new Set();

const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
// Which browser a bot uses, in words: the shared one is the same for every bot of that device.
export const browserName = bot => browserMode(bot) === 'mine' ? 'Meu Chrome' : browserMode(bot) === 'separate' ? `Navegador de ${bot.name}` : `Navegador compartilhado`;

function TabIcon({ icon }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [icon]);
  return icon && !failed ? <Image source={{ uri: icon }} style={styles.favicon} onError={() => setFailed(true)} fadeDuration={0} /> : <Icon name="globe" size={13} color={C.muted} />;
}

/** The tab strip: icon, title, close and "+". Only the person who took over changes tabs; the bot uses browser_tabs. */
export function TabStrip({ tabs, enabled, onSwitch, onClose, onNew }) {
  if (!tabs?.length) return null;
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ flexGrow: 0 }} contentContainerStyle={styles.tabs}>
    {tabs.map(tab => <Pressable key={tab.tab} disabled={!enabled || tab.active || !onSwitch} onPress={() => onSwitch(tab.tab)} accessibilityRole="tab" accessibilityState={{ selected: tab.active }} accessibilityLabel={`Aba ${tab.tab}: ${tab.title || 'Nova aba'}`} style={[styles.tabChip, tab.active && styles.tabChipOn]}>
      <TabIcon icon={tab.icon} />
      <Text style={[styles.tabTitle, tab.active && { color: C.text }]} numberOfLines={1}>{tab.title || hostOf(tab.url) || 'Nova aba'}</Text>
      {onClose && enabled ? <Pressable hitSlop={8} accessibilityRole="button" accessibilityLabel={`Fechar aba ${tab.tab}`} onPress={() => onClose(tab.tab)}><Icon name="close" size={12} color={C.muted} /></Pressable> : null}
    </Pressable>)}
    {onNew && enabled && tabs.length < 5 ? <Pressable accessibilityRole="button" accessibilityLabel="Nova aba" onPress={onNew} style={styles.tabNew}><Icon name="plus" size={14} color={C.text2} /></Pressable> : null}
  </ScrollView>;
}

/** Congelar carteira next to the live page while the wallet can pay: one tap, and the card leaves the checkout at once. */
function WalletFreeze() {
  const [open, setOpen] = useState(false); const [note, setNote] = useState('');
  useEffect(() => { if (termuxAvailable) walletRules().then(rules => setOpen(rules.frozen === false)).catch(() => {}); }, []);
  if (!open) return note ? <Text style={styles.hint}>{note}</Text> : null;
  return <Pressable accessibilityRole="button" onPress={() => walletFreeze().then(() => { setOpen(false); setNote('Carteira congelada. Nenhum bot paga até você descongelar em Ajustes → Carteira.'); }).catch(error => setNote(String(error?.message || error)))} style={styles.key}>
    <Icon name="stop" size={13} color={C.amber} /><Text style={[styles.keyText, { color: C.amber }]}>Congelar carteira</Text>
  </Pressable>;
}

/** Back, forward, reload and the address, always visible; they act only after "Assumir". */
export function AddressRow({ win, url, enabled, back, forward, onBack, onForward, onReload, onOpen, placeholder }) {
  const [editing, setEditing] = useState(null);
  const shown = url && url !== 'about:blank' ? url.replace(/^https?:\/\//, '') : '';
  const go = () => { if (editing?.trim()) onOpen(editing.trim()); setEditing(null); };
  const button = (icon, label, onPress, on) => <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !on }} disabled={!on} hitSlop={4} onPress={onPress} style={[styles.nav, !on && { opacity: 0.35 }]}><Icon name={icon} size={16} color={C.text2} /></Pressable>;
  return <View style={[styles.addressRow, win && { paddingHorizontal: 10, paddingBottom: 8 }]}>
    {button('back', 'Voltar página', onBack, enabled && back !== false)}
    <View style={{ transform: [{ scaleX: -1 }] }}>{button('back', 'Avançar página', onForward, enabled && !!forward && !!onForward)}</View>
    {button('refresh', 'Recarregar página', onReload, enabled)}
    {editing !== null ? <TextInput autoFocus style={styles.addressInput} value={editing} onChangeText={setEditing} onSubmitEditing={go} onBlur={() => setEditing(null)} selectTextOnFocus placeholder="Endereço do site" placeholderTextColor="#6F7787" autoCapitalize="none" autoCorrect={false} keyboardType="url" returnKeyType="go" />
      : <Pressable style={styles.addressBox} disabled={!enabled || !onOpen} onPress={() => setEditing(url && url !== 'about:blank' ? url : '')} accessibilityRole={enabled && onOpen ? 'button' : undefined} accessibilityLabel={enabled && onOpen ? 'Digitar endereço' : undefined}>
        <Text style={styles.addressText} numberOfLines={1}>{shown || placeholder}</Text>
      </Pressable>}
  </View>;
}

// Where the bot is about to act: shown for a moment, by the time it arrived (the computer's clock may differ).
function useBotAction() {
  const [action, setAction] = useState(null); const last = useRef(0); const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const show = value => { if (!value?.at || value.at === last.current) return; last.current = value.at; setAction(value); clearTimeout(timer.current); timer.current = setTimeout(() => setAction(null), 2500); };
  return [action, show];
}
// Coordinates are the page's CSS pixels; the layer has the size of the shown page, so percentages land right at any zoom.
function BotCursor({ action, color }) {
  if (!action?.width || !action?.height) return null;
  const pct = (value, size) => `${Math.max(0, Math.min(100, value / size * 100))}%`;
  const r = action.rect || null, p = action.point || null;
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    {r && r.width ? <View style={[styles.highlight, { left: pct(r.x, action.width), top: pct(r.y, action.height), width: pct(r.width, action.width), height: pct(r.height, action.height), borderColor: color, backgroundColor: color + '26' }]} /> : null}
    {p ? <View style={[styles.cursor, { left: pct(p.x, action.width), top: pct(p.y, action.height), borderColor: color }]}><View style={[styles.cursorDot, { backgroundColor: color }]} /></View> : null}
  </View>;
}
function StepCaption({ action }) {
  if (!action?.caption) return null;
  return <View pointerEvents="none" style={styles.caption}><Icon name="bots" size={13} color={C.accent} /><Text style={styles.captionText} numberOfLines={1}>{action.caption}</Text></View>;
}

const formatSize = size => size >= 1048576 ? `${(size / 1048576).toFixed(1).replace('.', ',')} MB` : size >= 1024 ? `${Math.round(size / 1024)} KB` : `${size} bytes`;
const formatTime = at => { const date = new Date(at); return isNaN(date) ? '' : date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); };

/** Files the bot's browser downloaded: on the phone they are already the bot's files; on the computer they stay there until opened or sent. */
export function BrowserDownloads({ bot, call, onFile, onClose }) {
  const [list, setList] = useState(null); const [busy, setBusy] = useState(null); const [note, setNote] = useState('');
  const load = () => call('browser.downloads', { botId: bot.id }).then(setList).catch(e => setList({ files: [], pcError: e.message }));
  useEffect(() => { load(); const listener = (event, data) => { if (event === 'browser.download' && data?.botId === bot.id) load(); }; browserEvents.add(listener); return () => browserEvents.delete(listener); }, [bot.id]);
  const act = async (file, send) => {
    setBusy(file.id + (send ? ':send' : '')); setNote('');
    try {
      if (send) { await call('browser.download.send', { botId: bot.id, id: file.id }); setNote(`“${file.name}” foi enviado a ${bot.name}.`); }
      else { const saved = await call('browser.download.open', { botId: bot.id, id: file.id }); onClose(); onFile?.(saved); }
    } catch (e) { setNote(e.message); } finally { setBusy(null); }
  };
  return <Modal visible transparent animationType="slide" onRequestClose={onClose}><View style={styles.sheetBack}><View style={styles.sheet}>
    <View style={styles.sheetHead}><Icon name="download" size={18} color={C.accent} /><Text style={styles.sheetTitle}>Downloads do navegador</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Fechar downloads" hitSlop={8} onPress={onClose} style={styles.tool}><Icon name="close" size={17} color={C.text2} /></Pressable></View>
    <Text style={styles.hint}>Arquivos que o navegador de {bot.name} baixou. Os do celular já são arquivos do bot; os do computador ficam em ~/.mybots-pc/downloads até você abrir ou enviar.</Text>
    {list === null ? <ActivityIndicator color={C.accent} style={{ marginVertical: 18 }} /> : null}
    {list && !list.files.length ? <Text style={[styles.hint, { marginVertical: 14 }]}>Nenhum download ainda.</Text> : null}
    {list?.pcError ? <Text style={styles.error}>{list.pcError}</Text> : null}
    {note ? <Text style={[styles.hint, { color: C.text2 }]}>{note}</Text> : null}
    <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 8 }}>{(list?.files || []).map(file => <View key={file.id} style={styles.download}>
      <Icon name="file" size={18} color={C.text2} />
      <View style={{ flex: 1 }}><Text style={styles.title} numberOfLines={1}>{file.name}</Text><Text style={styles.url}>{formatSize(file.size)} · {file.where === 'pc' ? 'no computador' : 'no celular'} · {formatTime(file.at)}</Text></View>
      <Pressable accessibilityRole="button" disabled={Boolean(busy)} onPress={() => act(file, false)} style={styles.key}>{busy === file.id ? <ActivityIndicator color={C.accent} size="small" /> : <Text style={styles.keyText}>Abrir</Text>}</Pressable>
      <Pressable accessibilityRole="button" disabled={Boolean(busy)} onPress={() => act(file, true)} style={styles.key}>{busy === file.id + ':send' ? <ActivityIndicator color={C.accent} size="small" /> : <Text style={styles.keyText}>Enviar ao bot</Text>}</Pressable>
    </View>)}</ScrollView>
  </View></View></Modal>;
}

// Pictures of the timeline, fetched once per step.
const stepImages = new Map();
function StepImage({ step, call, style }) {
  const [image, setImage] = useState(stepImages.get(step.id) || null);
  useEffect(() => {
    if (image || !step.image) return;
    let live = true;
    call('browser.stepImage', { id: step.id }).then(result => { if (stepImages.size > 200) stepImages.delete(stepImages.keys().next().value); stepImages.set(step.id, result.image); if (live) setImage(result.image); }).catch(() => {});
    return () => { live = false; };
  }, [step.id]);
  return image ? <Image source={{ uri: 'data:image/jpeg;base64,' + image }} style={style} resizeMode="cover" fadeDuration={0} /> : <View style={[style, styles.empty]}><Icon name="globe" size={18} color={C.faint || C.muted} /></View>;
}

/**
 * The phone's other apps while a Livre bot controls them: what it is doing, the picture after its last step, Parar
 * (always) and Assumir/Devolver. On the phone itself the same bar floats over the other apps (MyBotsAccess).
 */
export function PhoneLiveCard({ bot, phone, call, onStop, onControl }) {
  const [step, setStep] = useState(null); const [busy, setBusy] = useState('');
  const mine = phone?.controller?.botId === bot.id, help = phone?.help?.[bot.id], person = phone?.control === 'person';
  useEffect(() => {
    let live = true;
    call('browser.steps', { botId: bot.id, limit: 10 }).then(result => { const last = (result.steps || []).filter(item => item.caption.startsWith('No celular')).at(-1); if (live && last) setStep(last); }).catch(() => {});
    const listener = (event, data) => { if (event === 'browser.step' && data?.botId === bot.id && String(data.caption).startsWith('No celular')) setStep(data); };
    browserEvents.add(listener);
    return () => { live = false; browserEvents.delete(listener); };
  }, [bot.id]);
  if (!mine && !help && !person) return null;
  const act = async (name, action) => { setBusy(name); try { await action(); } catch {} finally { setBusy(''); } };
  return <View style={styles.helpCard}>
    <View style={styles.helpHead}><View style={styles.helpIcon}><Icon name="phone" size={18} color={C.sky} /></View><Text style={styles.helpEyebrow}>{mine ? 'Celular ao vivo' : 'Celular'}</Text></View>
    <Text style={styles.helpTitle}>{person ? 'Você está no controle do celular' : help ? `${bot.name} precisa de você no celular` : `${bot.name} está usando o celular`}</Text>
    <Text style={styles.helpBody}>{help && !mine ? help.reason : person ? `${mine ? `${bot.name} espera você devolver.` : 'Toque em “Devolver ao bot” para ele poder usar o celular de novo.'}` : phone.caption || 'Olhando a tela'}</Text>
    {step?.image ? <StepImage key={step.id} step={step} call={call} style={[styles.phoneShot, { aspectRatio: step.width && step.height ? step.width / step.height : 0.5 }]} /> : null}
    <Text style={styles.helpHint}>{mine ? 'No próprio celular, uma barra no topo mostra cada passo, com Parar e Assumir. Parar interrompe na hora, mesmo no meio de um passo.' : 'Faça o que foi pedido no celular e depois toque em “Devolver ao bot”.'}</Text>
    <View style={styles.keys}>
      {mine ? <Pressable accessibilityRole="button" disabled={Boolean(busy)} onPress={() => act('stop', onStop)} style={[styles.key, styles.stopKey]}><Icon name="stop" size={14} color="#FFFFFF" /><Text style={[styles.keyText, { color: '#FFFFFF' }]}>{busy === 'stop' ? 'Parando…' : 'Parar'}</Text></Pressable> : null}
      {onControl ? <Pressable accessibilityRole="button" disabled={Boolean(busy)} onPress={() => act('control', () => onControl(person || help && !mine ? 'bot' : 'person'))} style={styles.key}><Text style={styles.keyText}>{person || help && !mine ? 'Devolver ao bot' : 'Assumir'}</Text></Pressable> : null}
    </View>
  </View>;
}

/**
 * The browser's timeline in the conversation: each step of the bot's latest browser work with a picture of the page
 * right after it. Tapping one opens that moment.
 */
export function BrowserTimeline({ bot, call, working }) {
  const [steps, setSteps] = useState([]); const [open, setOpen] = useState(null); const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    let live = true, timer; setSteps([]); setOpen(null);
    // Right after the app opens the connection may not be ready yet: try again in a moment.
    const load = (tries = 0) => call('browser.steps', { botId: bot.id, limit: 40 }).then(result => { if (live) setSteps(result.steps || []); }).catch(() => { if (live && tries < 5) timer = setTimeout(() => load(tries + 1), 2000); });
    load();
    const listener = (event, data) => { if (event === 'browser.step' && data?.botId === bot.id) setSteps(old => old.some(step => step.id === data.id) ? old : [...old.slice(-79), data]); };
    browserEvents.add(listener);
    return () => { live = false; clearTimeout(timer); browserEvents.delete(listener); };
  }, [bot.id]);
  // A step missed while the connection was down shows up when the bot finishes.
  const was = useRef(working);
  useEffect(() => { if (was.current && !working) call('browser.steps', { botId: bot.id, limit: 40 }).then(result => setSteps(result.steps || [])).catch(() => {}); was.current = working; }, [working]);
  const last = steps.at(-1);
  const shown = last ? steps.filter(step => step.taskId === last.taskId) : [];
  if (!shown.length) return null;
  // The card follows the work: while the bot works and for a few minutes after; older ones stay in the browser panel, not stuck at the end of the chat.
  const raw = String(last.at || '').replace(' ', 'T'), stamp = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : raw + 'Z');
  if (!working && Number.isFinite(stamp) && Date.now() - stamp > 15 * 60 * 1000) return null;
  const show = working || expanded;
  const index = open ? shown.findIndex(step => step.id === open) : -1, current = shown[index];
  return <View style={styles.timeline}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: show }} onPress={() => setExpanded(value => !value)} style={styles.timelineHead}>
      <Icon name="globe" size={14} color={C.sky} /><Text style={styles.timelineTitle}>{shown.every(step => step.caption.startsWith('No celular')) ? 'Linha do tempo do celular' : shown.some(step => step.caption.startsWith('No celular')) ? 'Linha do tempo' : 'Linha do tempo do navegador'}</Text>
      <Text style={styles.hint}>{shown.length} {shown.length === 1 ? 'passo' : 'passos'}</Text>
      {working ? null : <View style={{ transform: [{ rotate: show ? '180deg' : '0deg' }] }}><Icon name="down" size={13} color={C.muted} /></View>}
    </Pressable>
    {show ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8 }} ref={ref => { if (ref && working) setTimeout(() => ref.scrollToEnd?.({ animated: false }), 0); }}>
      {shown.map((step, n) => <Pressable key={step.id} accessibilityRole="button" accessibilityLabel={`Passo ${n + 1}: ${step.caption}`} onPress={() => setOpen(step.id)} style={styles.step}>
        <StepImage step={step} call={call} style={styles.stepImage} />
        <Text style={styles.stepText} numberOfLines={2}>{step.caption}</Text>
      </Pressable>)}
    </ScrollView> : null}
    {current ? <Modal visible transparent animationType="fade" onRequestClose={() => setOpen(null)}><View style={styles.viewerBack}><View style={styles.viewer}>
      <View style={styles.sheetHead}><Text style={[styles.sheetTitle, { flex: 1 }]} numberOfLines={2}>{current.caption}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Fechar" hitSlop={8} onPress={() => setOpen(null)} style={styles.tool}><Icon name="close" size={17} color={C.text2} /></Pressable></View>
      <StepImage key={current.id} step={current} call={call} style={[styles.viewerImage, { aspectRatio: current.width && current.height ? current.width / current.height : 1.6 }]} />
      <Text style={styles.url} numberOfLines={2}>{current.title ? current.title + ' · ' : ''}{current.url.replace(/^https?:\/\//, '')}</Text>
      <Text style={styles.hint}>Passo {index + 1} de {shown.length} · {formatTime(current.at)}</Text>
      <View style={styles.keys}>
        <Pressable accessibilityRole="button" disabled={index <= 0} onPress={() => setOpen(shown[index - 1].id)} style={[styles.key, index <= 0 && { opacity: 0.4 }]}><Text style={styles.keyText}>‹ Anterior</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={index >= shown.length - 1} onPress={() => setOpen(shown[index + 1].id)} style={[styles.key, index >= shown.length - 1 && { opacity: 0.4 }]}><Text style={styles.keyText}>Próximo ›</Text></Pressable>
      </View>
    </View></View></Modal> : null}
  </View>;
}

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
function PcBrowserLive({ bot, call, assumed: assumedByBot, busy, error, control, onClose, side, onFile, color, keepView }) {
  // The computer's window always drives the page: no "Assumir", the bot and the person share it.
  const assumed = assumedByBot || Boolean(desktopWindow);
  const [tabbar, setTabbar] = useState(null); const [action, showAction] = useBotAction(); const [downloads, setDownloads] = useState(false); const [notice, setNotice] = useState(null); const seen = useRef(null);
  // The native view repeats its last metadata: a download is announced once.
  const extras = data => { if (data.tabbar?.tabs) setTabbar(data.tabbar); if (data.action) showAction(data.action); if (data.download?.name && data.download.at !== seen.current) { seen.current = data.download.at; setNotice(data.download); } };
  const [frame, setFrame] = useState(null); const [state, setState] = useState('connecting'); const [problem, setProblem] = useState('');
  const [captcha, setCaptcha] = useState(null); const challengeZoom = useRef(null); const returning = useRef(false);
  const [loading, setLoading] = useState(false); const [slow, setSlow] = useState(false); const [circle, setCircle] = useState(null); const circleTimer = useRef(null);
  const [viewport, setViewport] = useState(null); const [desktop, setDesktop] = useState(false);
  // The computer's window is a normal desktop browser: the page takes the size of its area, no phone emulation.
  const viewportInput = () => ({ type: 'viewport', width: Math.round(viewport.cssWidth), height: Math.round(viewport.cssHeight), deviceScaleFactor: desktopWindow ? (globalThis.devicePixelRatio || 1) : PixelRatio.get(), ...(desktopWindow ? { fit: true } : {}) });
  useEffect(() => { if (assumed) { returning.current = false; challengeZoom.current = null; } if (assumed && viewport) send(viewportInput()); }, [assumed, viewport]);
  // A Chrome that reopened starts as a desktop again: a frame shaped unlike the phone's page brings the phone's size back.
  const resized = useRef(0);
  useEffect(() => {
    if (!assumed || desktop || !viewport || !frame?.width || (frame.width > frame.height) === (viewport.cssWidth > viewport.cssHeight) || Date.now() - resized.current < 3000) return;
    resized.current = Date.now(); send(viewportInput());
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
    setFrame(null); setState('connecting'); lastMeta.current = ''; shown.current = false;
    const listener = data => {
      if (data?.botId !== bot.id) return;
      // The computer's window paints each picture straight onto the canvas; the view re-renders only when something else changed.
      if (data.bitmap) {
        paint(data.bitmap);
        const { bitmap, blob, ...meta } = data, signature = `${meta.width}x${meta.height}|${meta.url}|${meta.title}|${JSON.stringify(meta.tabs)}`;
        if (signature !== lastMeta.current) { lastMeta.current = signature; setFrame(meta); }
        if (!shown.current) { shown.current = true; setState('live'); setProblem(''); }
        return;
      }
      extras(data);
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
    return () => { browserFrames.delete(listener); if (!keepView) call('browser.view', { botId: bot.id, on: false }).catch(() => {}); };
  }, [bot.id, browserMode(bot)]);
  useEffect(() => { if (viewport) call('browser.view', { botId: bot.id, on: true, native: Boolean(BotFrameView), ...viewport }).catch(e => setProblem(e.message)); }, [viewport, bot.id, browserMode(bot)]);
  const reopen = () => { setState('connecting'); call('browser.view', { botId: bot.id, on: false }).catch(() => {}).then(() => call('browser.view', { botId: bot.id, on: true, native: Boolean(BotFrameView), ...viewport })).catch(e => setProblem(e.message)); };
  const touch = useRef(null);
  // The window's picture of the page: a canvas painted at the pace the pictures arrive.
  const canvas = useRef(null); const lastMeta = useRef(''); const shown = useRef(false);
  const paint = bitmap => {
    const node = canvas.current; if (!node) return;
    if (node.width !== bitmap.width || node.height !== bitmap.height) { node.width = bitmap.width; node.height = bitmap.height; }
    (node.context ||= node.getContext('2d', { alpha: false })).drawImage(bitmap, 0, 0);
  };
  // Mouse wheel scrolls the page under the pointer.
  const liveNode = useRef(null);
  useEffect(() => {
    const node = liveNode.current; if (!desktopWindow || !node?.addEventListener) return undefined;
    const wheel = event => {
      event.preventDefault(); const box = node.getBoundingClientRect(), view = size.current;
      send({ type: 'scroll', x: Math.max(0, Math.min(1, (event.clientX - box.left - (view.x || 0)) / (view.width || 1))), y: Math.max(0, Math.min(1, (event.clientY - box.top - (view.y || 0)) / (view.height || 1))), dx: event.deltaX, dy: event.deltaY });
    };
    node.addEventListener('wheel', wheel, { passive: false }); return () => node.removeEventListener('wheel', wheel);
  }, []);
  const local = at => ({ x: at.locationX - (size.current.x || 0), y: at.locationY - (size.current.y || 0) });
  const point = event => { const at = local(event.nativeEvent); return touchPoint({ locationX: at.x, locationY: at.y }, size.current, zoomRef.current); };
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => live.current.assumed && Boolean(live.current.frame),
    onMoveShouldSetPanResponder: () => live.current.assumed && Boolean(live.current.frame),
    onPanResponderGrant: event => {
      // The touch circle and the double-tap zoom belong to the phone; on the computer the mouse is just a mouse.
      if (!desktopWindow) { setCircle({ x: event.nativeEvent.locationX, y: event.nativeEvent.locationY }); clearTimeout(circleTimer.current); circleTimer.current = setTimeout(() => setCircle(null), 350); }
      const p = point(event); touch.current = { ...p, at: 0, dx: 0, dy: 0 };
      if (!desktopWindow && Date.now() - lastTap.current < 300) { touch.current.zooming = true; setZoom(view => zoomAt(view, local(event.nativeEvent), view.scale > 1 ? 1 : 2.5, size.current.width, size.current.height)); return; }
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
      if (desktopWindow) return;
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
      else if (Math.abs(gesture.dx) + Math.abs(gesture.dy) < 10) { send({ type: 'tap', x: start.x, y: start.y }); if (desktopWindow) setTimeout(() => keyboard.current?.focus(), 60); }
    },
    onPanResponderTerminate: () => { touch.current = null; send({ type: 'touch', phase: 'touchCancel', points: [] }); setDrag({ x: 0, y: 0 }); }
  })).current;
  const tabs = tabbar?.tabs || frame?.tabs || [];
  const tabStrip = <TabStrip tabs={tabs} enabled={assumed} onSwitch={tab => send({ type: 'tab', tab })} onClose={tab => send({ type: 'tab_close', tab })} onNew={() => send({ type: 'tab_new' })} />;
  const downloadsButton = <Pressable accessibilityRole="button" accessibilityLabel="Downloads do navegador" hitSlop={6} onPress={() => { setDownloads(true); setNotice(null); }} style={[styles.tool, notice && styles.toolOn]}><Icon name="download" size={17} color={notice ? C.accent : C.text2} /></Pressable>;
  return <BrowserSurface assumed={assumed} control={control} inline={side}><View style={[styles.panel, (assumed || side) && styles.fullPanel, side && styles.sidePanel, desktopWindow && styles.winPanel]}>
    {desktopWindow ? <View style={styles.winTop}><View style={{ flex: 1, minWidth: 0 }}>{tabStrip}</View>{downloadsButton}
      <Pressable accessibilityRole="button" accessibilityLabel="Fechar navegador" hitSlop={6} onPress={onClose} style={styles.tool}><Icon name="shrink" size={17} color={C.text2} /></Pressable></View> : <View style={styles.bar}>
      <View style={styles.lock}><Icon name="laptop" size={16} color={assumed ? C.accent : C.muted} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1}>{browserName(bot)} · computador</Text>
        <Text style={styles.url} numberOfLines={1}>{state === 'closed' ? 'O navegador deste bot está fechado.' : state === 'offline' ? 'Computador desconectado.' : desktopWindow ? 'Você e o bot usam a mesma página.' : assumed ? 'Você está no controle. O bot espera.' : browserMode(bot) === 'shared' ? 'Logins do navegador do computador, valem para os bots dele.' : 'Ao vivo do computador.'}</Text>
      </View>
      {downloadsButton}
      {!assumed && !side ? <Pressable accessibilityRole="button" accessibilityLabel="Fechar navegador" hitSlop={6} onPress={onClose} style={styles.tool}><Icon name="close" size={17} color={C.text2} /></Pressable> : null}
    </View>}
    {desktopWindow ? null : tabStrip}
    <AddressRow win={desktopWindow} url={frame?.url} enabled={assumed} back={tabbar ? tabbar.back : true} forward={tabbar?.forward} onBack={() => send({ type: 'back' })} onForward={() => send({ type: 'forward' })} onReload={() => send({ type: 'reload' })} onOpen={url => send({ type: 'open', url })}
      placeholder={state === 'closed' ? 'Fechado' : assumed ? 'Toque aqui para digitar um endereço.' : 'Ainda não abriu nenhuma página.'} />
    {notice ? <Pressable accessibilityRole="button" onPress={() => { setDownloads(true); setNotice(null); }} style={styles.notice}><Icon name="download" size={14} color={C.accent} /><Text style={[styles.hint, { flex: 1, color: C.text2 }]} numberOfLines={1}>{notice.name} baixado · ver downloads</Text></Pressable> : null}
    {downloads ? <BrowserDownloads bot={bot} call={call} onFile={onFile} onClose={() => setDownloads(false)} /> : null}
    <View ref={liveNode} style={[styles.live, assumed || side ? styles.fullFrame : { aspectRatio: frame ? frame.width / frame.height : 1.6 }, assumed && styles.frameAssumed, desktopWindow && styles.winFrame]}
      onLayout={event => { const layout = event.nativeEvent.layout; area.current = layout; setAreaSize({ width: layout.width, height: layout.height }); const next = { maxWidth: PixelRatio.getPixelSizeForLayoutSize(layout.width), maxHeight: PixelRatio.getPixelSizeForLayoutSize(layout.height), cssWidth: layout.width, cssHeight: layout.height }; setViewport(current => current?.maxWidth === next.maxWidth && current?.maxHeight === next.maxHeight ? current : next); }} {...responder.panHandlers}>
      {/* The page keeps its proportions: a desktop page on a standing phone gets bands instead of being stretched. */}
      <View pointerEvents="none" style={fitted(frame, areaSize, desktopWindow ? 0 : 4)} onLayout={event => { size.current = event.nativeEvent.layout; }}>
      {desktopWindow ? React.createElement('canvas', { ref: canvas, style: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', display: 'block', pointerEvents: 'none' } }) : null}
      {desktopWindow ? null : BotFrameView ? <BotFrameView pointerEvents="none" key={bot.id} botId={bot.id} style={[StyleSheet.absoluteFill, { transform: [{ translateX: zoom.translateX + drag.x }, { translateY: zoom.translateY + drag.y }, { rotate: `${zoom.rotation}deg` }, { scale: zoom.scale }] }]} onMetadata={event => { const data = event.nativeEvent; extras(data); if (data.captcha) challenge(data.captcha); if (typeof data.loading === 'boolean') setLoading(data.loading); if (typeof data.slow === 'boolean') setSlow(data.slow); if (typeof data.desktop === 'boolean') setDesktop(data.desktop); if (data.error) setProblem(data.error); else if (data.closed) setState('closed'); else if (data.width) { setFrame(data); setState('live'); setProblem(''); } }} /> : frame ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { transform: [{ translateX:zoom.translateX+drag.x }, { translateY:zoom.translateY+drag.y }, { rotate:`${zoom.rotation}deg` }, { scale:zoom.scale }] }]}><LiveImages key={bot.id} frame={frame} /></View>
        : <View style={[styles.empty, desktopWindow && state === 'live' && { display: 'none' }]}><Text style={styles.hint}>{state === 'closed' ? 'O navegador deste bot está fechado.' : state === 'offline' ? 'O computador está desconectado. A página aparece quando ele voltar.' : 'Abrindo o navegador do bot no computador…'}</Text></View>}
        {frame ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { transform: [{ translateX: zoom.translateX + drag.x }, { translateY: zoom.translateY + drag.y }, { rotate: `${zoom.rotation}deg` }, { scale: zoom.scale }] }]}><BotCursor action={action} color={color || C.accent} /></View> : null}
      </View>
      <StepCaption action={action} />
      {circle ? <View pointerEvents="none" style={{ position:'absolute',left:circle.x-18,top:circle.y-18,width:36,height:36,borderRadius:18,borderWidth:2,borderColor:C.accent,backgroundColor:'#54E8B344' }} /> : null}
      {loading ? <View pointerEvents="none" accessibilityLabel="Carregando página" style={{ position:'absolute',left:0,top:0,height:3,width:'65%',backgroundColor:C.accent }} /> : null}
      {slow ? <View pointerEvents="none" style={styles.closed}><Text style={styles.watchingText}>Conexão lenta</Text></View> : null}
      {frame && state === 'closed' ? <View style={styles.closed}><Text style={styles.watchingText}>Navegador fechado</Text></View> : null}
      {!assumed && frame ? <View pointerEvents="none" style={styles.watching}><Icon name="info" size={12} color={C.text2} /><Text style={styles.watchingText}>Só olhando</Text></View> : null}
    </View>
    {state === 'closed' ? <Pressable accessibilityRole="button" onPress={reopen} style={styles.reopen}><Icon name="refresh" size={14} color={C.accent} /><Text style={[styles.hint, { color: C.accent }]}>Abrir o navegador de novo</Text></Pressable> : null}
    {assumed && desktopWindow ? <TextInput ref={keyboard} accessibilityLabel="Digitar na página" style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} onChangeText={webType} autoCapitalize="none" blurOnSubmit={false}
      onKeyPress={event => { const key = event.nativeEvent.key; if (['Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Delete'].includes(key) || (key === 'Backspace' && !webInput.current.text)) { event.preventDefault?.(); send({ type: 'key', key }); } }} /> : null}
    {assumed && !desktopWindow ? <View style={styles.floatingControls} onLayout={event => { bar.current = event.nativeEvent.layout; }}>
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
    <WalletFreeze />
    {desktopWindow ? null : <Pressable accessibilityRole="button" disabled={busy} onPress={() => control(assumed ? 'bot' : 'person')} style={[styles.control, assumed && styles.controlBack, busy && { opacity: 0.5 }]}>
      <Icon name={assumed ? 'bots' : 'hand'} size={18} color={assumed ? C.accent : C.accentInk} stroke={2} /><Text style={[styles.controlText, assumed && styles.controlBackText]}>{assumed ? 'Devolver ao bot' : 'Assumir'}</Text>
    </Pressable>}
  </View></BrowserSurface>;
}

/**
 * "Navegador do bot": the bot's own WebView, live. Watching only until the person taps "Assumir"; then the
 * bot's browser commands are refused until "Devolver ao bot".
 */
function fitted(frame, room, inset = 4) {
  if (!frame?.width || !room) return StyleSheet.absoluteFill;
  // The visor's 2-point border is inside its layout size.
  const width = room.width - inset, height = room.height - inset, k = Math.min(width / frame.width, height / frame.height);
  return { position: 'absolute', left: (width - frame.width * k) / 2, top: (height - frame.height * k) / 2, width: frame.width * k, height: frame.height * k, backgroundColor: '#FFFFFF' };
}

export default function BotBrowserPanel({ bot, browser, onControl, onClose, call, pc, side, onFile, color, keepView }) {
  const { height: windowHeight } = useWindowDimensions();
  const [page, setPage] = useState(browser?.pages?.[bot.id] || null);
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [action, showAction] = useBotAction(); const [downloads, setDownloads] = useState(false);
  const assumed = browser?.control?.[bot.id] === 'person';
  const chrome = browserMode(bot) === 'claude' && (pc || browser?.pages?.[bot.id]?.engine === 'claude-chrome');
  const onPc = pc || browser?.pages?.[bot.id]?.where === 'pc';
  useEffect(() => { if (!onPc) browserInfo().then(setInfo).catch(() => {}); }, [onPc]);
  const control = async who => {
    setBusy(true); setError('');
    try { await onControl(who); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const act = action => browserAction(bot.id, action).catch(() => {});
  if (onPc && !chrome && call) return <PcBrowserLive bot={bot} call={call} assumed={assumed} busy={busy} error={error} control={control} onClose={onClose} side={side} onFile={onFile} color={color} keepView={keepView} />;
  if (onPc) return <View style={[styles.panel, side && styles.sidePanel]}>
    <Text style={styles.title}>{chrome ? 'Chrome principal · Claude' : `${browserName(bot)} no computador`}</Text>
    <Text style={styles.url}>{browser.pages[bot.id].url}</Text>
    <Text style={styles.hint}>{chrome ? 'Este bot usa seu Chrome principal (Claude in Chrome), com os seus logins. Essa janela fica no computador: para login, CAPTCHA ou código, toque em Assumir, use o Chrome no PC e depois devolva ao bot.' : 'A página está aberta no navegador do bot no PC.'}</Text>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => control(assumed ? 'bot' : 'person')} style={styles.control}><Text style={styles.controlText}>{assumed ? 'Devolver ao bot' : 'Assumir'}</Text></Pressable>
    {!assumed && !side ? <Pressable accessibilityRole="button" onPress={onClose}><Text style={styles.hint}>Fechar painel</Text></Pressable> : null}
  </View>;
  if (!BotBrowserView) return null;
  const shared = browserMode(bot) !== 'separate';
  return <BrowserSurface assumed={assumed} control={control} inline={side}><View style={[styles.panel, (assumed || side) && styles.fullPanel, side && styles.sidePanel]}>
    <View style={styles.bar}>
      <View style={styles.lock}><Icon name="phone" size={16} color={assumed ? C.accent : C.muted} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1}>{shared ? 'Navegador compartilhado' : `Navegador de ${bot.name}`} · celular</Text>
        <Text style={styles.url} numberOfLines={1}>{assumed ? 'Você está no controle. O bot espera.' : page?.loading ? 'Carregando…' : shared ? 'Logins do navegador do celular, valem para os bots dele.' : 'Só deste bot.'}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Downloads do navegador" hitSlop={6} onPress={() => setDownloads(true)} style={styles.tool}><Icon name="download" size={17} color={C.text2} /></Pressable>
      {!assumed && !side ? <Pressable accessibilityRole="button" accessibilityLabel="Fechar navegador" hitSlop={6} onPress={onClose} style={styles.tool}><Icon name="close" size={17} color={C.text2} /></Pressable> : null}
    </View>
    {page?.url && page.url !== 'about:blank' ? <TabStrip tabs={[{ tab: 1, title: page.title, url: page.url, icon: page.icon, active: true }]} enabled={false} /> : null}
    <AddressRow url={page?.url} enabled={assumed} back={page?.back} forward={page?.forward} onBack={() => act('back')} onForward={() => act('forward')} onReload={() => act('reload')} placeholder="Ainda não abriu nenhuma página." />
    {downloads ? <BrowserDownloads bot={bot} call={call} onFile={onFile} onClose={() => setDownloads(false)} /> : null}
    {/* the page leaves room for the button below it: on a tall phone the frame alone filled the screen and Assumir fell off the end */}
    <View style={[styles.frame, (assumed || side) && styles.fullFrame, assumed && styles.frameAssumed, !assumed && !side && { aspectRatio: undefined, height: Math.round(windowHeight * 0.5) }]}>
      <BotBrowserView botId={bot.id} separate={!shared} interactive={assumed} style={StyleSheet.absoluteFill} onPage={event => { setPage(event.nativeEvent); if (event.nativeEvent.action) showAction(event.nativeEvent.action); }} />
      <BotCursor action={action} color={color || C.accent} />
      <StepCaption action={action} />
      {!assumed ? <View pointerEvents="none" style={styles.watching}><Icon name="info" size={12} color={C.text2} /><Text style={styles.watchingText}>Só olhando</Text></View> : null}
    </View>
    {assumed ? <View style={styles.keys}><Pressable onPress={() => act('keyboard')} accessibilityRole="button" style={styles.key}><Text style={styles.keyText}>Teclado</Text></Pressable><Pressable onPress={() => act('zoom')} accessibilityRole="button" style={styles.key}><Text style={styles.keyText}>Zoom +</Text></Pressable><Pressable onPress={() => act('zoomOut')} accessibilityRole="button" style={styles.key}><Text style={styles.keyText}>Zoom −</Text></Pressable></View> : null}
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {assumed ? <Text style={styles.hint}>Você está usando o navegador do celular; o bot espera. {shared ? 'Um login feito aqui vale para os bots que navegam no celular, não para o computador. ' : ''}Login do Google não funciona aqui: para Gmail, Agenda e Drive use os apps da conta.</Text> : null}
    {info && !info.isolated ? <Text style={styles.hint}>Este celular não tem perfis de navegador (Android System WebView antigo): quando um bot com Navegador separado navega, os logins do navegador compartilhado são apagados. Atualize o “Android System WebView”.</Text> : null}
    <WalletFreeze />
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => control(assumed ? 'bot' : 'person')} style={[styles.control, assumed && styles.controlBack, busy && { opacity: 0.5 }]}>
      <Icon name={assumed ? 'bots' : 'hand'} size={18} color={assumed ? C.accent : C.accentInk} stroke={2} /><Text style={[styles.controlText, assumed && styles.controlBackText]}>{assumed ? 'Devolver ao bot' : 'Assumir'}</Text>
    </Pressable>
  </View></BrowserSurface>;
}

const styles = themed(() => ({
  fullscreen: { flex: 1, backgroundColor: C.surface, paddingTop: StatusBar.currentHeight || 24, paddingBottom: 12 },
  floatingControls: { position:'absolute',bottom:74,left:14,right:14,padding:10,borderRadius:18,gap:6,backgroundColor:C.surface+'F0',borderWidth:1,borderColor:C.line2 },
  fullPanel: { flex: 1, margin: 0, marginHorizontal: 0, marginTop: 0, marginBottom: 0, borderRadius: 0 },
  fullFrame: { flex: 1, aspectRatio: undefined, backgroundColor: C.surface2 },
  sidePanel: { flex: 1, margin: 0, marginHorizontal: 0, marginTop: 0, marginBottom: 0, borderRadius: 0, borderWidth: 0, borderLeftWidth: 1 },
  winPanel: { padding: 0, gap: 0, backgroundColor: C.bg2 },
  winTop: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 6 },
  winFrame: { borderWidth: 0, borderRadius: 0, backgroundColor: C.bg },
  tabs: { gap: 6, paddingRight: 4 },
  tabChip: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 190, minHeight: 32, paddingHorizontal: 10, borderRadius: 11, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line, opacity: 0.75 },
  tabChipOn: { borderColor: C.line2, opacity: 1 }, tabTitle: { flexShrink: 1, color: C.text2, fontFamily: F.m, fontSize: 12 },
  tabNew: { width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line },
  favicon: { width: 14, height: 14, borderRadius: 3 },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nav: { width: 32, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line },
  addressBox: { flex: 1, minHeight: 34, justifyContent: 'center', borderRadius: 11, paddingHorizontal: 11, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line },
  addressText: { color: C.text2, fontFamily: F.m, fontSize: 12.5 },
  addressInput: { flex: 1, minHeight: 34, borderRadius: 11, paddingHorizontal: 11, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.accent, color: C.text, fontFamily: F.m, fontSize: 13 },
  highlight: { position: 'absolute', borderWidth: 2, borderRadius: 4 },
  cursor: { position: 'absolute', width: 22, height: 22, marginLeft: -11, marginTop: -11, borderRadius: 11, borderWidth: 2, backgroundColor: '#FFFFFFCC', alignItems: 'center', justifyContent: 'center' },
  cursorDot: { width: 8, height: 8, borderRadius: 4 },
  caption: { position: 'absolute', left: 8, top: 8, right: 8, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: '#090B10E6' },
  captionText: { flexShrink: 1, color: C.text, fontFamily: F.b, fontSize: 12 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 12, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.accent + '66' },
  sheetBack: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#000000AA' },
  sheet: { padding: 16, paddingBottom: 26, gap: 10, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line2, width: '100%', maxWidth: 720, alignSelf: 'center' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 9 }, sheetTitle: { flex: 1, color: C.text, fontFamily: F.x, fontSize: 16 },
  download: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 14, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line },
  timeline: { padding: 12, gap: 9, borderRadius: 20, borderWidth: 1, borderColor: C.sky + '44', backgroundColor: C.surface },
  timelineHead: { flexDirection: 'row', alignItems: 'center', gap: 7 }, timelineTitle: { flex: 1, color: C.sky, fontFamily: F.b, fontSize: 13 },
  step: { width: 128, gap: 5 }, stepImage: { width: 128, height: 80, borderRadius: 10, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line },
  stepText: { color: C.text2, fontFamily: F.m, fontSize: 11, lineHeight: 15 },
  viewerBack: { flex: 1, justifyContent: 'center', padding: 14, backgroundColor: '#000000CC' },
  viewer: { padding: 14, gap: 10, borderRadius: 22, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line2, width: '100%', maxWidth: 900, alignSelf: 'center' },
  viewerImage: { width: '100%', borderRadius: 12, backgroundColor: C.surface2 },
  panel: { marginHorizontal: 12, marginTop: 10, marginBottom: 6, padding: 10, borderRadius: 24, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line2, gap: 9 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lock: { width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface2 },
  title: { color: C.text, fontFamily: F.b, fontSize: 13.5 }, url: { color: C.muted, fontFamily: F.m, fontSize: 11.5, marginTop: 1 },
  tool: { width: 36, height: 36, borderRadius: 12, backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line },
  frame: { aspectRatio: 0.625, borderRadius: 16, overflow: 'hidden', backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: C.line2 },
  frameAssumed: { borderColor: C.accent },
  live: { width: '100%', borderRadius: 14, overflow: 'hidden', backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: C.line2 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16, backgroundColor: C.surface2 },
  closed: { position: 'absolute', left: 8, top: 8, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10, backgroundColor: '#090B10D9' },
  reopen: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  address: { minHeight: 40, borderRadius: 12, paddingHorizontal: 12, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line, color: C.text, fontFamily: F.m, fontSize: 13.5 },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, toolOn: { borderColor: C.accent },
  keys: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, key: { minWidth: 44, height: 34, paddingHorizontal: 10, borderRadius: 10, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  keyText: { color: C.text2, fontFamily: F.b, fontSize: 12.5 },
  stopKey: { flexDirection: 'row', gap: 6, backgroundColor: C.red, borderColor: C.red, paddingHorizontal: 16 }, phoneShot: { width: '62%', alignSelf: 'center', borderRadius: 14, backgroundColor: '#0B0F15' },
  watching: { position: 'absolute', right: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10, backgroundColor: '#090B10D9' },
  watchingText: { color: C.text2, fontFamily: F.b, fontSize: 10.5 },
  hint: { color: C.muted, fontFamily: F.m, fontSize: 11.5, lineHeight: 17 }, error: { color: C.red, fontFamily: F.m, fontSize: 12 },
  control: { minHeight: 48, flexDirection: 'row', gap: 8, borderRadius: 16, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' }, controlText: { color: C.accentInk, fontFamily: F.x, fontSize: 14.5 },
  controlBack: { backgroundColor: C.surface2, borderWidth: 1, borderColor: C.accent }, controlBackText: { color: C.accent },
  helpCard: { padding: 16, borderRadius: 22, borderWidth: 1, borderColor: C.sky + '55', backgroundColor: '#111925', gap: 7 },
  helpHead: { flexDirection: 'row', alignItems: 'center', gap: 9 }, helpIcon: { width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: C.sky + '1C' },
  helpEyebrow: { color: C.sky, fontFamily: F.b, fontSize: 13 }, helpTitle: { color: C.text, fontFamily: F.x, fontSize: 16.5, marginTop: 2 },
  helpBody: { color: C.text2, fontFamily: F.m, fontSize: 14, lineHeight: 21 }, helpHint: { color: C.muted, fontFamily: F.m, fontSize: 12, lineHeight: 17 },
  helpButton: { minHeight: 48, flexDirection: 'row', gap: 8, borderRadius: 16, backgroundColor: C.sky, alignItems: 'center', justifyContent: 'center', marginTop: 6 }, helpButtonText: { color: '#0F1D2E', fontFamily: F.x, fontSize: 14 }
}));
