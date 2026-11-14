// The team's canvas (it replaces the 3D office): an infinite board where the bots leave what they are working on (notes, tables,
// charts, small HTML pages, pictures, videos and their browser), linked to each other and grouped in areas. Each bot is a little figure
// plate tied by a cord to the Chefe and to every card it made; it walks to the card it touched last. The person leaves notes of their
// own (yellow) that the bots read. Drag the background to move, pinch or use the wheel to zoom, drag a card by its title bar,
// resize it by the corner, tap it to open it. At the bottom, a box to write to the Chefe or to any other bot.
import { createElement, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, BackHandler, Image, Modal, PanResponder, PixelRatio, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Defs, Path, Pattern, Rect, Text as SvgText } from 'react-native-svg';
import { C, F, Icon, themed } from '../theme';
import { TOP } from '../styles';
import { Avatar, IconButton, botLine, latestOf } from './shared';
import { Chart, RichText } from '../RichMessage';
import { readImage } from '../attachment-images';
import { HtmlCardView } from '../termux';
import { useKeyboardPad } from '../keyboard';
import { useStore } from '../state/useStore';
import { selectHome } from '../state/store';
import { NODE_W, NODE_H, areaBoxes, bounds, cord, fitView, hit, sandboxed, stacked, teamCords, teamSpots, zoomAround } from '../state/canvas-layout';
import { botHues } from '../screens/memory-look';
import { budgetScale, contains, grow, intersect, visibleRect } from '../state/svg-budget';


// The app tells the canvas when it changed (canvas.changed) and when a bot's browser took a new step (browser.step).
const listeners = new Set();
export const canvasEvent = (event, data) => { for (const fn of listeners) fn(event, data); };
const web = Platform.OS === 'web';
const density = web ? 1 : PixelRatio?.get?.() || 1;
const KIND = { note: 'Nota', table: 'Tabela', chart: 'Gráfico', html: 'Página', image: 'Imagem', video: 'Vídeo', browser: 'Navegador' };
const ICON = { note: 'edit', table: 'list', chart: 'activity', html: 'apps', image: 'file', video: 'file', browser: 'search' };

function BrowserShot({ botId, call, version }) {
  const [shot, setShot] = useState(null);
  useEffect(() => { let live = true; call('canvas.browserImage', { botId }).then(value => { if (live && value?.image) setShot(value); }).catch(() => {}); return () => { live = false; }; }, [botId, version]);
  return shot ? <Image source={{ uri: 'data:image/jpeg;base64,' + shot.image }} resizeMode="cover" style={{ flex: 1, width: '100%' }} />
    : <View style={s.center}><Icon name="search" size={26} color={C.faint} /><Text style={s.muted}>O navegador aparece aqui quando o bot abrir uma página.</Text></View>;
}
function Picture({ file }) {
  const [uri, setUri] = useState(null);
  useEffect(() => { let live = true; if (file) readImage(file).then(value => live && setUri(value)).catch(() => {}); return () => { live = false; }; }, [file?.id]);
  return uri ? <Image source={{ uri }} resizeMode="contain" style={{ flex: 1, width: '100%' }} /> : <View style={s.center}><Icon name="file" size={26} color={C.faint} /></View>;
}
function HtmlPage({ html, interactive }) {
  const page = useMemo(() => sandboxed(html), [html]);
  // The computer's window: an iframe with scripts and nothing else (no same origin, so no way into the app).
  if (web) return createElement('iframe', { srcDoc: page, sandbox: 'allow-scripts', title: 'Página feita por um bot', style: { border: 0, width: '100%', height: '100%', background: '#fff', pointerEvents: interactive ? 'auto' : 'none' } });
  if (HtmlCardView) return <HtmlCardView html={page} interactive={Boolean(interactive)} style={{ flex: 1 }} />;
  return <View style={s.center}><Text style={s.muted}>Atualize o app para ver páginas feitas pelos bots.</Text></View>;
}
function TableBody({ card, full }) {
  const rows = full ? card.rows || [] : (card.rows || []).slice(0, Math.max(1, Math.floor((card.h - 70) / 26)));
  const width = Math.max(90, Math.floor((card.w - 16) / Math.max(1, card.columns?.length || 1)));
  const grid = <View>
    <View style={s.tr}>{(card.columns || []).map(column => <Text key={column} numberOfLines={1} style={[s.th, { width }]}>{column}</Text>)}</View>
    {rows.map((row, i) => <View key={i} style={[s.tr, i % 2 && s.trOdd]}>{row.map((cell, j) => <Text key={j} numberOfLines={full ? 3 : 1} style={[s.td, { width }]}>{String(cell)}</Text>)}</View>)}
    {!full && (card.rows?.length || 0) > rows.length ? <Text style={s.more}>+ {card.rows.length - rows.length} linhas</Text> : null}
  </View>;
  if (card.error) return <Text style={s.muted}>{card.error}</Text>;
  return full ? <ScrollView horizontal><ScrollView>{grid}</ScrollView></ScrollView> : grid;
}
/** A card's content, for the canvas (a still picture, touches pass through) or opened in full (`full`). */
function Body({ card, full, call, browserVersion }) {
  if (card.kind === 'note') return full ? <ScrollView contentContainerStyle={{ padding: 16 }}><RichText id={card.id} text={card.text || ''} textStyle={s.note} /></ScrollView> : <View style={{ padding: 12 }}><RichText id={card.id} text={card.text || ''} textStyle={s.note} /></View>;
  if (card.kind === 'table') return <View style={{ padding: full ? 12 : 8 }}><TableBody card={card} full={full} /></View>;
  if (card.kind === 'chart') return card.chart ? <View style={{ padding: 10 }}><Chart spec={card.chart} /></View> : <Text style={s.muted}>{card.error || 'Sem dados ainda.'}</Text>;
  if (card.kind === 'html') return <HtmlPage html={card.html} interactive={full} />;
  if (card.kind === 'image') return <Picture file={card.file} />;
  if (card.kind === 'video') return <View style={s.center}><Icon name="play" size={34} color={C.text2} /><Text style={s.muted} numberOfLines={2}>{card.file?.name || 'Vídeo'}</Text><Text style={s.hint}>Toque para abrir</Text></View>;
  if (card.kind === 'browser') return <View style={{ flex: 1 }}><BrowserShot botId={card.botId} call={call} version={browserVersion} />
    {card.url ? <Text numberOfLines={1} style={s.url}>{card.viewport === 'celular' ? '📱 ' : card.viewport === 'tablet' ? '▭ ' : ''}{card.url}</Text> : null}</View>;
  return null;
}
const Card = memo(function Card({ card, bot, hue, call, browserVersion, lifted }) {
  // The person's own note: a yellow sticky, with no title bar.
  if (card.sticky) return <View pointerEvents="none" style={[s.sticky, { left: card.x, top: card.y, width: card.w, height: card.h }, lifted && { opacity: 0.9 }]}>
    <Text style={s.stickyBy}>Sua nota</Text><Text style={s.stickyText}>{card.text}</Text><View style={[s.corner, { borderColor: '#00000040' }]} /></View>;
  return <View pointerEvents="none" style={[s.card, { left: card.x, top: card.y, width: card.w, height: card.h }, hue && { borderColor: hue + '55' }, lifted && s.cardLifted]}>
    <View style={s.cardHead}>
      <Icon name={ICON[card.kind]} size={15} color={C.muted} />
      <Text numberOfLines={1} style={s.cardTitle}>{card.title || KIND[card.kind]}</Text>
      {bot ? <><View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: hue || C.faint }} /><Text numberOfLines={1} style={s.cardBy}>{bot.name}</Text></> : null}
    </View>
    <View style={s.cardBody}><Body card={card} call={call} browserVersion={browserVersion} /></View>
    <View style={s.corner} />
  </View>;
});
/** A bot's plate (face, name, what it is doing); it walks (glides) to its spot when that changes. The Chefe's is the hub of the team. */
function Walker({ bot, spot, data, selected, hue }) {
  const pos = useRef(new Animated.ValueXY(spot)).current; const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; pos.setValue(spot); return; }
    Animated.timing(pos, { toValue: { x: spot.x, y: spot.y }, duration: 1100, useNativeDriver: !web }).start();
  }, [spot.x, spot.y]);
  const line = botLine(bot, data); const busy = line.state === 'working', waiting = line.state === 'waiting';
  return <Animated.View pointerEvents="none" style={[s.plate, { transform: pos.getTranslateTransform() }, busy && { borderColor: hue }, waiting && { borderColor: C.amber }, selected && s.plateOn, bot.isChief && s.plateChief]}>
    <Avatar bot={bot} size={NODE_H - 14} state={busy ? 'working' : waiting ? 'waiting' : 'idle'} animated={busy || waiting} />
    <View style={{ flex: 1, minWidth: 0 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><Text numberOfLines={1} style={s.plateName}>{bot.name}</Text>{bot.isChief ? <Icon name="spark" size={11} color={C.accent} /> : null}</View>
      <Text numberOfLines={1} style={[s.plateLine, busy && { color: hue }, waiting && { color: C.amber }]}>{busy ? 'trabalhando' : waiting ? 'espera você' : bot.isChief ? 'Chefe' : spot.card ? 'aqui por último' : 'livre'}</Text>
    </View>
  </Animated.View>;
}

/** The dotted paper under everything: the dots follow the view, so moving and zooming feel like moving the paper. */
function Dots({ view, width, height }) {
  let step = 26 * view.k; while (step < 14) step *= 2;
  const x = ((view.x % step) + step) % step, y = ((view.y % step) + step) % step;
  return <Svg pointerEvents="none" width={width} height={height} style={{ position: 'absolute', left: 0, top: 0 }}>
    <Defs><Pattern id="canvas-dots" x={x} y={y} width={step} height={step} patternUnits="userSpaceOnUse"><Circle cx={1.2} cy={1.2} r={1.2} fill={C.text} fillOpacity={0.13} /></Pattern></Defs>
    <Rect x={0} y={0} width={width} height={height} fill="url(#canvas-dots)" />
  </Svg>;
}

export default function Canvas({ data: shell, call, onSend, onOpenBot, onOpenBrowser, onFile, onClose, sending }) {
  // With each bot's last message (the shell leaves it out), for the reply above the box.
  const data = useStore(selectHome) || shell;
  const { width, height } = useWindowDimensions();
  const [state, setState] = useState({ cards: [], links: [], at: {} });
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState(null);
  const [size, setSize] = useState({ width, height: height - 160 });
  const [moving, setMoving] = useState(null);           // a card being dragged or resized: its new rectangle, drawn until saved
  const [opened, setOpened] = useState(null);
  const [error, setError] = useState('');
  const [browserVersion, setBrowserVersion] = useState({});
  const bots = useMemo(() => (data?.bots || []).filter(bot => !bot.deletedAt), [data?.bots]);
  const chief = bots.find(bot => bot.isChief) || bots[0];
  const [botId, setBotId] = useState(chief?.id || null);
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState('');
  const [noting, setNoting] = useState(null);           // the person's note being written: { id?, text }
  const [pad, padRef] = useKeyboardPad();
  const target = bots.find(bot => bot.id === botId) || chief;

  const load = useCallback(() => call('canvas.state', {}).then(value => { setState(value || { cards: [], links: [], at: {} }); setLoaded(true); setError(''); }).catch(err => { setLoaded(true); setError(err.message); }), [call]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    let timer = null; const steps = {};
    const fn = (event, value) => {
      if (event === 'canvas.changed') { clearTimeout(timer); timer = setTimeout(load, 120); }
      // A new browser step refreshes that bot's browser card, at most every 2 seconds.
      if (event === 'browser.step' && value?.botId && Date.now() - (steps[value.botId] || 0) > 2000) { steps[value.botId] = Date.now(); setBrowserVersion(old => ({ ...old, [value.botId]: (old[value.botId] || 0) + 1 })); }
    };
    listeners.add(fn); return () => { listeners.delete(fn); clearTimeout(timer); };
  }, [load]);
  useEffect(() => { if (!onClose) return; const sub = BackHandler.addEventListener('hardwareBackPress', () => { if (opened) { setOpened(null); return true; } onClose(); return true; }); return () => sub.remove(); }, [onClose, opened]);

  const cards = useMemo(() => state.cards.map(card => moving?.id === card.id ? { ...card, ...moving } : card), [state.cards, moving]);
  const realChief = bots.find(bot => bot.isChief)?.id || null;
  const spots = useMemo(() => teamSpots(bots, cards, state.at, realChief), [bots, cards, state.at, realChief]);
  const hues = useMemo(() => botHues(bots), [bots]);
  const fitAll = () => setView(fitView(bounds(cards, spots), size.width, size.height, Math.min(96, size.height / 7)));
  // The first time there is something to show, everything is fitted on the screen.
  useEffect(() => { if (!view && loaded) fitAll(); }, [loaded, size.width, size.height]);
  const v = view || { k: 1, x: size.width / 2, y: size.height / 2 };
  const viewRef = useRef(v); viewRef.current = v;
  const cardsRef = useRef(cards); cardsRef.current = cards; const spotsRef = useRef(spots); spotsRef.current = spots;
  const handlers = useRef({}); handlers.current = {
    open: card => { if (card.sticky) setNoting({ id: card.id, text: card.text || '' }); else if (card.kind === 'browser') (onOpenBrowser || onOpenBot)?.(card.botId); else if (card.kind === 'video') onFile?.(card.file, card.botId); else setOpened(card.id); },
    bot: id => { setBotId(id); setPicking(false); },
    save: rect => call('canvas.move', rect).then(load).catch(err => { setError(err.message); setMoving(null); })
  };

  const responder = useMemo(() => {
    const g = {};
    const points = e => { const touches = e.nativeEvent.touches?.length >= 2 ? [...e.nativeEvent.touches] : [e.nativeEvent]; return touches.map(t => ({ x: t.pageX - g.offset.x, y: t.pageY - g.offset.y })); };
    const rebase = list => { g.points = list; g.start = viewRef.current; };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true, onMoveShouldSetPanResponder: () => true, onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: e => {
        const n = e.nativeEvent; g.offset = { x: (n.pageX ?? 0) - (n.locationX ?? 0), y: (n.pageY ?? 0) - (n.locationY ?? 0) };
        rebase(points(e)); g.at = g.points[0]; g.moved = false; g.target = hit(viewRef.current, g.at.x, g.at.y, cardsRef.current, spotsRef.current);
      },
      onPanResponderMove: e => {
        const list = points(e);
        if (list.length >= 2) {
          g.target = null; if (g.points.length < 2) rebase(list);
          const [a, b] = list, [a0, b0] = g.points, start = g.start;
          const factor = Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, Math.hypot(a0.x - b0.x, a0.y - b0.y));
          const moved = zoomAround(start, (a0.x + b0.x) / 2, (a0.y + b0.y) / 2, factor);
          g.moved = true; setView({ ...moved, x: moved.x + (a.x + b.x) / 2 - (a0.x + b0.x) / 2, y: moved.y + (a.y + b.y) / 2 - (a0.y + b0.y) / 2 }); return;
        }
        if (g.points.length >= 2) rebase(list);
        const dx = list[0].x - g.points[0].x, dy = list[0].y - g.points[0].y;
        if (!g.moved && Math.hypot(dx, dy) < 6) return;
        g.moved = true; const t = g.target, k = g.start.k;
        if (t?.kind === 'header') { setMoving({ id: t.id, x: Math.round(t.card.x + dx / k), y: Math.round(t.card.y + dy / k) }); return; }
        if (t?.kind === 'resize') { setMoving({ id: t.id, w: Math.round(Math.max(160, t.card.w + dx / k)), h: Math.round(Math.max(100, t.card.h + dy / k)) }); return; }
        setView({ ...g.start, x: g.start.x + dx, y: g.start.y + dy });
      },
      onPanResponderRelease: () => {
        const t = g.target;
        if (!g.moved) { if (t?.kind === 'bot') handlers.current.bot(t.id); else if (t?.card) handlers.current.open(t.card); return; }
        if (t?.kind === 'header' || t?.kind === 'resize') { const card = cardsRef.current.find(item => item.id === t.id); if (card) handlers.current.save({ id: card.id, x: card.x, y: card.y, w: card.w, h: card.h }); }
      },
      onPanResponderTerminate: () => setMoving(null)
    });
  }, []);
  // Saved: the card's new place comes back with the canvas, so the local copy can go.
  useEffect(() => { setMoving(null); }, [state]);

  // The computer: the wheel zooms around the pointer.
  const surface = useRef(null);
  useEffect(() => {
    const element = surface.current; if (!web || !element?.addEventListener) return;
    const wheel = e => { e.preventDefault(); const rect = element.getBoundingClientRect(); setView(old => zoomAround(old || viewRef.current, e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)))); };
    const press = e => { if (e.button === 0) e.preventDefault(); };
    element.style.userSelect = 'none'; element.addEventListener('wheel', wheel, { passive: false }); element.addEventListener('mousedown', press);
    return () => { element.removeEventListener('wheel', wheel); element.removeEventListener('mousedown', press); };
  }, [loaded]);

  const names = useMemo(() => new Map(bots.map(bot => [bot.id, bot])), [bots]);
  const order = useMemo(() => stacked(cards, moving?.id), [cards, moving?.id]);
  const box = useMemo(() => bounds(cards, spots) || { x: 0, y: 0, w: 1, h: 1 }, [cards, spots]);
  const byId = useMemo(() => new Map(cards.map(card => [card.id, card])), [cards]);
  // The cords' <Svg>: on Android it is painted into one bitmap of its size (see svg-budget.js), so there it covers only the
  // board around what is on screen (half a screen more on each side), redrawn when the view leaves it, at a resolution
  // that fits the budget. On the computer it covers the whole board.
  const cordRegion = useRef(null);
  const seen = visibleRect(v, size.width, size.height), tierK = 2 ** (Math.round(Math.log2(v.k) * 2) / 2);
  if (!web && size.width && (!cordRegion.current || cordRegion.current.k !== tierK || !contains(cordRegion.current.cover, seen))) cordRegion.current = { k: tierK, cover: grow(seen, 0.5) };
  const cordArea = useMemo(() => {
    const all = { x: box.x - 200, y: box.y - 200, w: box.w + 400, h: box.h + 400 };
    if (web) return { ...all, scale: 1 };
    const rect = cordRegion.current && intersect(all, cordRegion.current.cover);
    return rect && { ...rect, scale: budgetScale(rect.w, rect.h, Math.min(2, cordRegion.current.k), density) };
  }, [box, cordRegion.current]);
  // Seen from far, the cords are drawn thicker so they do not vanish (in steps, so a zoom does not redraw the board all the time).
  const thick = Math.min(3, Math.max(1, Math.round(0.9 / v.k * 2) / 2));
  // The board itself: areas, links, cards and bots. Moving the view only changes the transform around it.
  const board = useMemo(() => <>
    {areaBoxes(cards).map(area => <View key={'a' + area.name} pointerEvents="none" style={[s.area, { left: area.x, top: area.y, width: area.w, height: area.h }]}><Text numberOfLines={1} style={s.areaName}>{area.name}</Text></View>)}
    {cordArea ? <Svg pointerEvents="none" style={{ position: 'absolute', left: cordArea.x, top: cordArea.y, width: cordArea.w * cordArea.scale, height: cordArea.h * cordArea.scale, transformOrigin: '0px 0px', transform: [{ scale: 1 / cordArea.scale }] }}
      width={cordArea.w * cordArea.scale} height={cordArea.h * cordArea.scale} viewBox={`${cordArea.x} ${cordArea.y} ${cordArea.w} ${cordArea.h}`}>
      {/* The team's cords: the Chefe to each bot (quiet), each bot to what it made (in its colour; the one it is on now is solid). */}
      {teamCords(bots, cards, spots, state.at, realChief).map(line => <Path key={line.key} d={line.d} fill="none" stroke={line.kind === 'team' ? C.muted : hues.get(line.botId) || C.muted}
        strokeOpacity={line.kind === 'team' ? 0.45 : line.live ? 0.95 : 0.7} strokeWidth={(line.live ? 2.4 : 1.8) * thick} strokeDasharray={line.live ? undefined : line.kind === 'team' ? `${3 * thick} ${7 * thick}` : `${7 * thick} ${6 * thick}`} strokeLinecap="round" />)}
      {state.links.map(link => { const a = byId.get(link.from), b = byId.get(link.to); if (!a || !b) return null; const l = cord(a, b);
        return [<Path key={link.id} d={l.d} fill="none" stroke={C.accent} strokeOpacity={0.75} strokeWidth={2 * thick} strokeDasharray={`${6 * thick} ${5 * thick}`} strokeLinecap="round" />,
          <Circle key={link.id + 'a'} cx={l.x1} cy={l.y1} r={3.5} fill={C.accent} />, <Circle key={link.id + 'b'} cx={l.x2} cy={l.y2} r={3.5} fill={C.accent} />,
          link.label ? <SvgText key={link.id + 't'} x={l.mx} y={l.my - 7} fill={C.text2} fontSize={12.5} fontWeight="600" textAnchor="middle" stroke={C.bg} strokeWidth={4} paintOrder="stroke">{link.label}</SvgText> : null]; })}
    </Svg> : null}
    {order.map(card => <Card key={card.id} card={card} bot={names.get(card.botId)} hue={hues.get(card.botId)} call={call} browserVersion={browserVersion[card.botId] || 0} lifted={moving?.id === card.id} />)}
    {bots.map(bot => spots[bot.id] ? <Walker key={bot.id} bot={bot} spot={spots[bot.id]} data={data} selected={bot.id === target?.id} hue={hues.get(bot.id)} /> : null)}
  </>, [cards, state.links, spots, browserVersion, moving?.id, data, target?.id, hues, thick, cordArea]);

  const send = async () => {
    const text = draft.trim(); if (!text || !target || sending) return;
    if (await onSend(target.id, text) !== false) setDraft('');
  };
  // The person's note goes where they are looking (the middle of the view).
  const saveNote = async () => {
    const text = (noting?.text || '').trim(); if (!text) { setNoting(null); return; }
    try { await call('canvas.note', noting.id ? { id: noting.id, text } : { text, x: Math.round((size.width / 2 - v.x) / v.k - 120), y: Math.round((size.height / 2 - v.y) / v.k - 90) }); setNoting(null); await load(); } catch (err) { setError(err.message); }
  };
  const ask = card => { const owner = names.get(card.botId) || chief; setOpened(null); if (owner) setBotId(owner.id); setDraft(`Sobre o cartão "${card.title || KIND[card.kind]}" do canvas: `); };
  const reply = target ? latestOf(target) : null;
  const open = opened && cards.find(card => card.id === opened);
  const remove = async card => { setOpened(null); try { await call('canvas.remove', { id: card.id }); await load(); } catch (err) { setError(err.message); } };

  const working = bots.filter(bot => data?.active?.includes(bot.id)).length;
  // A narrow screen (the phone): the tools keep only their icons and the zoom is the pinch (plus "Mostrar tudo").
  const narrow = size.width < 640;
  return <View ref={padRef} style={[s.page, { paddingBottom: pad }]}>
    <View ref={surface} style={s.surface} onLayout={e => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })} {...responder.panHandlers}>
      <Dots view={v} width={size.width} height={size.height} />
      <View pointerEvents="none" style={[s.board, { transform: [{ translateX: v.x }, { translateY: v.y }, { scale: v.k }] }]}>{board}</View>
      {loaded && !state.cards.length ? <View pointerEvents="none" style={s.empty}><Text style={s.emptyTitle}>O canvas da equipe</Text>
        <Text style={s.emptyText}>Peça algo ao {chief?.name || 'Chefe'} aqui embaixo. O que os bots fizerem (notas, tabelas, gráficos, páginas, o navegador) aparece aqui, ligado a quem fez.</Text></View> : null}
    </View>
    {/* Over the paper: where you are and the tools, floating like in a drawing app. */}
    <View pointerEvents="box-none" style={s.bar}>
      <View style={s.pill}>
        {onClose ? <IconButton icon="back" label="Voltar" onPress={onClose} size={34} /> : <Icon name="canvas" size={17} color={C.accent} />}
        <Text style={s.title}>Canvas</Text>
        {narrow ? null : <Text style={s.count}>{state.cards.length ? `${state.cards.length} ${state.cards.length === 1 ? 'cartão' : 'cartões'}` : 'vazio'}{working ? ` · ${working} trabalhando` : ''}</Text>}
      </View>
      <View style={{ flex: 1 }} />
      <View style={s.pill}>
        <Pressable accessibilityRole="button" accessibilityLabel="Deixar uma nota sua no canvas" onPress={() => setNoting({ text: '' })} style={({ hovered, pressed }) => [s.tool, hovered && s.toolHover, pressed && { opacity: 0.6 }]}><Icon name="edit" size={15} color={C.text2} />{narrow ? null : <Text style={s.toolText}>Nota</Text>}</Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Arrumar os cartões" onPress={() => call('canvas.tidy', {}).then(load).then(() => setTimeout(fitAll, 200)).catch(err => setError(err.message))} style={({ hovered, pressed }) => [s.tool, hovered && s.toolHover, pressed && { opacity: 0.6 }]}><Icon name="apps" size={15} color={C.text2} />{narrow ? null : <Text style={s.toolText}>Arrumar</Text>}</Pressable>
      </View>
      <View style={[s.pill, { paddingHorizontal: 4, gap: 0 }]}>
        {narrow ? null : <><IconButton icon="minus" label="Afastar" onPress={() => setView(zoomAround(v, size.width / 2, size.height / 2, 0.8))} size={32} />
        <Text style={s.zoomText}>{Math.round(v.k * 100)}%</Text>
        <IconButton icon="plus" label="Aproximar" onPress={() => setView(zoomAround(v, size.width / 2, size.height / 2, 1.25))} size={32} /></>}
        <IconButton icon="expand" label="Mostrar tudo" onPress={fitAll} size={32} />
      </View>
    </View>
    {error ? <Text style={s.error} onPress={() => setError('')}>{error}</Text> : null}
    <View pointerEvents="box-none" style={s.dock}>
      <View style={s.talk}>
        {reply?.text && reply.role !== 'user' ? <Pressable accessibilityRole="button" accessibilityLabel={`Abrir a conversa com ${target.name}`} onPress={() => onOpenBot?.(target.id)} style={s.reply}>
          <Text numberOfLines={2} style={s.replyText}><Text style={s.replyName}>{target.name}: </Text>{reply.text}</Text><Icon name="right" size={14} color={C.faint} /></Pressable> : null}
        {picking ? <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} style={s.picker} contentContainerStyle={{ gap: 8, paddingHorizontal: 10 }}>
          {bots.map(bot => <Pressable key={bot.id} accessibilityRole="button" accessibilityLabel={`Falar com ${bot.name}`} accessibilityState={{ selected: bot.id === target?.id }} onPress={() => handlers.current.bot(bot.id)} style={[s.pick, bot.id === target?.id && s.pickOn]}>
            <Avatar bot={bot} size={26} animated={false} /><Text numberOfLines={1} style={s.pickName}>{bot.name}</Text></Pressable>)}
        </ScrollView> : null}
        <View style={s.composer}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Trocar o bot (agora ${target?.name || 'nenhum'})`} onPress={() => setPicking(old => !old)} style={s.who}>
            {target ? <Avatar bot={target} size={30} animated={false} /> : null}<Icon name={picking ? 'close' : 'down'} size={14} color={C.muted} />
          </Pressable>
          <TextInput value={draft} onChangeText={setDraft} placeholder={target ? `Escreva para ${target.name}…` : 'Crie um bot primeiro'} placeholderTextColor={C.faint} multiline rows={web ? 1 : undefined}
            style={s.input} editable={Boolean(target)} onSubmitEditing={send} blurOnSubmit={false}
            onKeyPress={web ? event => { if (event.nativeEvent.key === 'Enter' && !event.nativeEvent.shiftKey) { event.preventDefault(); send(); } } : undefined} />
          <Pressable accessibilityRole="button" accessibilityLabel="Enviar" disabled={!draft.trim() || sending} onPress={send} style={[s.send, (!draft.trim() || sending) && { opacity: 0.4 }]}><Icon name="send" size={18} color={C.accentInk} /></Pressable>
        </View>
      </View>
    </View>
    {noting ? <Modal visible transparent animationType="fade" onRequestClose={() => setNoting(null)}>
      <Pressable style={s.scrim} onPress={() => setNoting(null)}><Pressable style={s.noteBox} onPress={() => {}}>
        <Text style={s.stickyBy}>{noting.id ? 'Sua nota' : 'Nova nota sua'}</Text>
        <TextInput autoFocus accessibilityLabel="Texto da nota" value={noting.text} onChangeText={text => setNoting(old => ({ ...old, text }))} multiline maxLength={4000} placeholder="Escreva um recado, uma ideia ou uma regra. Os bots leem as suas notas." placeholderTextColor="#00000066" style={s.noteInput} selectionColor="#00000055" />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {noting.id ? <Pressable accessibilityRole="button" accessibilityLabel="Tirar a nota do canvas" onPress={() => { const id = noting.id; setNoting(null); remove({ id }); }} style={s.noteGhost}><Text style={s.noteGhostText}>Tirar</Text></Pressable> : null}
          <View style={{ flex: 1 }} />
          <Pressable accessibilityRole="button" onPress={() => setNoting(null)} style={s.noteGhost}><Text style={s.noteGhostText}>Cancelar</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Salvar a nota" onPress={saveNote} style={s.noteSave}><Text style={s.noteSaveText}>Salvar</Text></Pressable>
        </View>
      </Pressable></Pressable>
    </Modal> : null}
    {open ? <Modal visible animationType="fade" onRequestClose={() => setOpened(null)}>
      <View style={s.full}>
        <View style={s.top}>
          <IconButton icon="close" label="Fechar" onPress={() => setOpened(null)} size={40} />
          <Text numberOfLines={1} style={[s.title, { flex: 1 }]}>{open.title || KIND[open.kind]}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Falar sobre este cartão com ${(names.get(open.botId) || chief)?.name || 'o bot'}`} onPress={() => ask(open)} style={s.chip}><Text style={s.chipText}>Falar sobre isto</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Tirar do canvas" onPress={() => remove(open)} style={s.chip}><Text style={[s.chipText, { color: C.red }]}>Tirar</Text></Pressable>
        </View>
        {open.botId && names.get(open.botId) ? <Text style={s.fullBy}>Feito por {names.get(open.botId).name}{open.area ? ` · ${open.area}` : ''}</Text> : null}
        <View style={{ flex: 1 }}><Body card={open} full call={call} browserVersion={browserVersion[open.botId] || 0} /></View>
      </View>
    </Modal> : null}
  </View>;
}

const s = themed(() => ({
  page: { flex: 1, backgroundColor: C.bg },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: TOP + 8, paddingBottom: 8, paddingHorizontal: 12, backgroundColor: C.bg2, borderBottomWidth: 1, borderBottomColor: C.line },
  title: { color: C.text, fontFamily: F.b, fontSize: 15 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: C.line2, backgroundColor: C.surface },
  chipText: { color: C.text2, fontFamily: F.s, fontSize: 13 },
  surface: { flex: 1, overflow: 'hidden', backgroundColor: C.chrome || C.bg },
  bar: { position: 'absolute', left: 12, right: 12, top: TOP + 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, paddingHorizontal: 12, borderRadius: 14, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line2, boxShadow: '0 6px 22px rgba(0,0,0,0.28)' },
  count: { color: C.muted, fontFamily: F.m, fontSize: 12 },
  tool: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 9, borderRadius: 9 }, toolHover: { backgroundColor: C.surface2 },
  toolText: { color: C.text2, fontFamily: F.s, fontSize: 12.5 },
  zoomText: { minWidth: 44, textAlign: 'center', color: C.muted, fontFamily: F.m, fontSize: 12 },
  dock: { position: 'absolute', left: 12, right: 12, bottom: web ? 12 : 16, gap: 10 },
  talk: { width: '100%', maxWidth: 780, alignSelf: 'center', gap: 8 },
  board: { position: 'absolute', left: 0, top: 0, width: 1, height: 1, transformOrigin: '0px 0px' },
  area: { position: 'absolute', borderRadius: 28, borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.line2, backgroundColor: C.surface + '55' },
  areaName: { position: 'absolute', left: 4, top: -40, color: C.accent, fontFamily: F.b, fontSize: 26, letterSpacing: -0.4 },
  card: { position: 'absolute', borderRadius: 14, overflow: 'hidden', backgroundColor: C.surface, borderWidth: 1, borderColor: C.line2, boxShadow: '0 10px 30px rgba(0,0,0,0.30)' },
  sticky: { position: 'absolute', borderRadius: 4, padding: 14, paddingTop: 10, backgroundColor: '#F3E08A', overflow: 'hidden', boxShadow: '0 10px 24px rgba(0,0,0,0.35)' },
  stickyBy: { color: '#00000080', fontFamily: F.s, fontSize: 11, marginBottom: 6 },
  stickyText: { color: '#1F1A05', fontFamily: F.m, fontSize: 14, lineHeight: 20 },
  cardLifted: { borderColor: C.accent, opacity: 0.92 },
  cardHead: { height: 34, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, backgroundColor: C.surface2, borderBottomWidth: 1, borderBottomColor: C.line },
  cardTitle: { flex: 1, color: C.text, fontFamily: F.s, fontSize: 13 },
  cardBy: { maxWidth: 110, color: C.faint, fontFamily: F.m, fontSize: 11 },
  cardBody: { flex: 1, overflow: 'hidden' },
  corner: { position: 'absolute', right: 4, bottom: 4, width: 12, height: 12, borderRightWidth: 2, borderBottomWidth: 2, borderColor: C.line2, borderBottomRightRadius: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14 },
  note: { color: C.text, fontFamily: F.r, fontSize: 14, lineHeight: 20 },
  muted: { color: C.muted, fontFamily: F.m, fontSize: 13, textAlign: 'center' },
  hint: { color: C.faint, fontFamily: F.m, fontSize: 11 },
  url: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 10, paddingVertical: 5, color: C.text2, fontFamily: F.m, fontSize: 11, backgroundColor: C.bg2 + 'E6' },
  tr: { flexDirection: 'row' }, trOdd: { backgroundColor: C.surface2 },
  th: { color: C.text, fontFamily: F.b, fontSize: 12, paddingHorizontal: 6, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: C.line2 },
  td: { color: C.text2, fontFamily: F.r, fontSize: 12, paddingHorizontal: 6, paddingVertical: 5 },
  more: { color: C.faint, fontFamily: F.m, fontSize: 11, padding: 6 },
  plate: { position: 'absolute', left: 0, top: 0, width: NODE_W, height: NODE_H, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, borderRadius: NODE_H / 2, backgroundColor: C.elevated, borderWidth: 1.5, borderColor: C.line2, boxShadow: '0 6px 18px rgba(0,0,0,0.32)' },
  plateOn: { borderColor: C.accent }, plateChief: { backgroundColor: C.surface2 },
  plateName: { flexShrink: 1, color: C.text, fontFamily: F.s, fontSize: 13 },
  plateLine: { color: C.muted, fontFamily: F.m, fontSize: 10.5 },
  empty: { position: 'absolute', left: 24, right: 24, top: TOP + 76, alignItems: 'center', gap: 6 },
  emptyTitle: { color: C.text, fontFamily: F.b, fontSize: 17 },
  emptyText: { color: C.muted, fontFamily: F.m, fontSize: 13.5, textAlign: 'center', lineHeight: 20, maxWidth: 460 },
  error: { position: 'absolute', left: 12, right: 12, top: TOP + 62, padding: 10, borderRadius: 12, color: C.red, backgroundColor: C.surface, fontFamily: F.m, fontSize: 13 },
  reply: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 13, borderRadius: 14, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line2, boxShadow: '0 6px 22px rgba(0,0,0,0.28)' },
  replyText: { flex: 1, color: C.text2, fontFamily: F.r, fontSize: 13, lineHeight: 18 },
  replyName: { color: C.text, fontFamily: F.b },
  picker: { flexGrow: 0 },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingLeft: 5, paddingRight: 12, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: C.line2, backgroundColor: C.surface },
  pickOn: { borderColor: C.accent },
  pickName: { color: C.text, fontFamily: F.s, fontSize: 13, maxWidth: 120 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, padding: 6, borderRadius: 26, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line2, boxShadow: '0 10px 30px rgba(0,0,0,0.35)' },
  who: { height: 38, flexDirection: 'row', alignItems: 'center', gap: 3, paddingLeft: 4, paddingRight: 8, borderRadius: 19, backgroundColor: C.surface2 },
  input: { flex: 1, minHeight: 38, maxHeight: 120, paddingHorizontal: 8, paddingTop: 9, paddingBottom: 8, color: C.text, fontFamily: F.r, fontSize: web ? 14 : 15, outlineStyle: 'none' },
  send: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: C.accent },
  scrim: { flex: 1, backgroundColor: '#000000A0', alignItems: 'center', justifyContent: 'center', padding: 20 },
  noteBox: { width: 420, maxWidth: '100%', borderRadius: 6, padding: 18, backgroundColor: '#F3E08A', gap: 10 },
  noteInput: { minHeight: 150, color: '#1F1A05', fontFamily: F.m, fontSize: 15, lineHeight: 21, textAlignVertical: 'top', outlineStyle: 'none' },
  noteGhost: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10 }, noteGhostText: { color: '#00000099', fontFamily: F.s, fontSize: 13.5 },
  noteSave: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 10, backgroundColor: '#1F1A05' }, noteSaveText: { color: '#F3E08A', fontFamily: F.b, fontSize: 13.5 },
  full: { flex: 1, backgroundColor: C.bg },
  fullBy: { color: C.faint, fontFamily: F.m, fontSize: 12, paddingHorizontal: 16, paddingVertical: 8 }
}));
