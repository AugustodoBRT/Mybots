import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Platform, Pressable, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, G, Path, Text as SvgText } from 'react-native-svg';
import { createLayout, fitBox, graphModel, hitTest, labelIds } from '../state/graph-layout';
import { C, F, hueOf, themed } from '../theme';

// Kept while the app is open, so coming back to the map (or out of a note) finds the drawing, zoom and options as they were.
const cache = { positions: {}, view: null, ghosts: true, colorBy: 'kind' };
// Timings of the last drawing, read by the performance check in Chrome.
const stats = { start: 0 };
globalThis.mybotsGraphStats = stats;
const clock = () => globalThis.performance?.now?.() ?? Date.now();
const raf = globalThis.requestAnimationFrame || (fn => setTimeout(fn, 16));
const cancelRaf = globalThis.cancelAnimationFrame || clearTimeout;
const ZOOM = { min: 0.08, max: 6 };
const kinds = () => ({ chefe: ['Chefe', C.accent], entrega: ['Entrega', C.sky], arquivo: ['Arquivo', C.faint] });

function Chip({ label, name, onPress, selected, role = 'button' }) {
  const state = role === 'switch' ? { checked: selected } : { selected };
  return <Pressable accessibilityRole={role} accessibilityLabel={name || label} accessibilityState={state} onPress={onPress}
    style={[s.chip, selected && { borderColor: C.accent }]}><Text style={[s.chipText, selected && { color: C.accent }]}>{label}</Text></Pressable>;
}

const EdgeLayer = memo(function EdgeLayer({ d, color, width, opacity, dash }) {
  return d ? <Path d={d} stroke={color} strokeWidth={width} strokeOpacity={opacity} strokeDasharray={dash} fill="none" vectorEffect="non-scaling-stroke" /> : null;
});

const GraphNode = memo(function GraphNode({ x, y, r, fill, stroke, opacity, dashed, ring, ringColor }) {
  return <>
    {ring ? <Circle cx={x} cy={y} r={r + 4} fill="none" stroke={ringColor} strokeWidth={1.6} strokeDasharray="3 3" opacity={opacity} vectorEffect="non-scaling-stroke" /> : null}
    <Circle cx={x} cy={y} r={r} fill={fill} stroke={stroke} strokeWidth={dashed ? 1.4 : 1} strokeDasharray={dashed ? '3 2' : undefined} opacity={opacity} vectorEffect="non-scaling-stroke" />
  </>;
});

const NodeLayer = memo(function NodeLayer({ items }) {
  return items.map(item => <GraphNode key={item.id} {...item} />);
});

const LabelLayer = memo(function LabelLayer({ items, k }) {
  const size = 11 / k;
  return items.map(item => <React.Fragment key={item.id}>
    <SvgText x={item.x} y={item.y + item.r + size * 1.15} fontSize={size} fontFamily={F.m} textAnchor="middle" stroke={C.bg} strokeWidth={3 / k} fill={C.bg} opacity={item.opacity}>{item.text}</SvgText>
    <SvgText x={item.x} y={item.y + item.r + size * 1.15} fontSize={size} fontFamily={F.m} textAnchor="middle" fill={item.strong ? C.text : C.text2} fontWeight={item.strong ? 'bold' : 'normal'} opacity={item.opacity}>{item.text}</SvgText>
  </React.Fragment>);
});

const clamp = k => Math.min(ZOOM.max, Math.max(ZOOM.min, k));
const short = text => text.length > 28 ? text.slice(0, 27) + '…' : text;

/**
 * The drawing and its gestures. Pan and zoom only change the transform of one <G>; the node, edge and label layers are
 * memoized on positions and highlight, so moving the view does not re-render them.
 */
export function GraphCanvas({ model, positions, matches, colorOf, height = 420, onOpen, fitKey = 0, initialView = null, initialFocus = null }) {
  const [size, setSize] = useState({ width: 0, height });
  const [view, setView] = useState(() => initialView || cache.view);
  const [hover, setHover] = useState(null), [focus, setFocus] = useState(initialFocus);
  const viewRef = useRef(view), frame = useRef(0), box = useRef(null), gesture = useRef({}).current, userMoved = useRef(Boolean(cache.view));
  const active = hover && model.byId.has(hover) ? hover : focus && model.byId.has(focus) ? focus : null;
  const placed = useMemo(() => {
    const at = new Map((positions || []).map(p => [p.id, p]));
    return model.nodes.filter(node => at.has(node.id)).map(node => ({ node, id: node.id, x: at.get(node.id).x, y: at.get(node.id).y, r: node.r }));
  }, [model, positions]);
  const placedRef = useRef(placed); placedRef.current = placed;
  const commit = next => {
    viewRef.current = next;
    if (!frame.current) frame.current = raf(() => { frame.current = 0; setView(viewRef.current); cache.view = viewRef.current; });
  };
  const fit = () => {
    const { width, height: h } = box.current || size;
    if (!width || !placedRef.current.length) return;
    const { k, x, y } = fitBox(placedRef.current, width, h, { padding: 28 });
    commit({ k: clamp(k), x, y });
  };
  const zoomAt = (px, py, factor) => {
    const v = viewRef.current || { k: 1, x: 0, y: 0 }, k = clamp(v.k * factor), wx = (px - v.x) / v.k, wy = (py - v.y) / v.k;
    userMoved.current = true;
    commit({ k, x: px - wx * k, y: py - wy * k });
  };
  const hitAt = (px, py, slop) => {
    const v = viewRef.current || { k: 1, x: 0, y: 0 };
    return hitTest(placedRef.current, (px - v.x) / v.k, (py - v.y) / v.k, slop / v.k);
  };
  const handlers = useRef({}); handlers.current = {
    tap(id) {
      const node = id && model.byId.get(id);
      if (node && !node.ghost) onOpen(node.path);
      else setFocus(node ? node.id : null);
    },
    hold(id) { setFocus(id); }
  };
  useEffect(() => { if (!userMoved.current || !viewRef.current) fit(); }, [fitKey, size.width, size.height]);
  useEffect(() => () => cancelRaf(frame.current), []);

  const responder = useMemo(() => {
    const local = e => {
      const touches = e.nativeEvent.touches?.length >= 2 ? [...e.nativeEvent.touches] : [e.nativeEvent];
      return touches.map(t => ({ x: t.pageX - gesture.offset.x, y: t.pageY - gesture.offset.y }));
    };
    const rebase = points => { gesture.points = points; gesture.start = viewRef.current || { k: 1, x: 0, y: 0 }; };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: e => {
        const n = e.nativeEvent;
        gesture.offset = { x: (n.pageX ?? 0) - (n.locationX ?? 0), y: (n.pageY ?? 0) - (n.locationY ?? 0) };
        rebase(local(e)); gesture.at = gesture.points[0]; gesture.moved = false; gesture.held = false;
        clearTimeout(gesture.timer);
        // Holding a node (the phone's hover) highlights it and its neighbours without opening it.
        gesture.timer = setTimeout(() => {
          if (gesture.moved) return;
          gesture.held = true;
          handlers.current.hold(hitAt(gesture.at.x, gesture.at.y, 10));
        }, 450);
      },
      onPanResponderMove: e => {
        const points = local(e);
        if (points.length >= 2) {
          if (gesture.points.length < 2) rebase(points);
          const [a, b] = points, [a0, b0] = gesture.points, v = gesture.start;
          const k = clamp(v.k * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, Math.hypot(a0.x - b0.x, a0.y - b0.y)));
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, wx = ((a0.x + b0.x) / 2 - v.x) / v.k, wy = ((a0.y + b0.y) / 2 - v.y) / v.k;
          gesture.moved = true; userMoved.current = true; clearTimeout(gesture.timer);
          commit({ k, x: mx - wx * k, y: my - wy * k });
          return;
        }
        if (gesture.points.length >= 2) rebase(points);
        const dx = points[0].x - gesture.points[0].x, dy = points[0].y - gesture.points[0].y;
        if (!gesture.moved && Math.hypot(dx, dy) < 6) return;
        gesture.moved = true; userMoved.current = true; clearTimeout(gesture.timer);
        commit({ ...gesture.start, x: gesture.start.x + dx, y: gesture.start.y + dy });
      },
      onPanResponderRelease: () => {
        clearTimeout(gesture.timer);
        if (!gesture.moved && !gesture.held) handlers.current.tap(hitAt(gesture.at.x, gesture.at.y, 8));
      },
      onPanResponderTerminate: () => clearTimeout(gesture.timer)
    });
  }, []);

  // The computer: wheel zoom around the pointer and hover highlight. The SVG ignores the pointer, so events land here.
  const surface = useRef(null);
  useEffect(() => {
    const element = surface.current;
    if (Platform.OS !== 'web' || !element?.addEventListener) return;
    let shown = null;
    const point = e => { const rect = element.getBoundingClientRect(); return [e.clientX - rect.left, e.clientY - rect.top]; };
    const wheel = e => { e.preventDefault(); const [x, y] = point(e); zoomAt(x, y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))); };
    const move = e => {
      if (e.buttons) return;
      const id = hitAt(...point(e), 2);
      element.style.cursor = id ? 'pointer' : 'grab';
      if (id !== shown) { shown = id; setHover(id); }
    };
    const leave = () => { shown = null; setHover(null); };
    element.addEventListener('wheel', wheel, { passive: false });
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerleave', leave);
    return () => { element.removeEventListener('wheel', wheel); element.removeEventListener('pointermove', move); element.removeEventListener('pointerleave', leave); };
  }, []);

  const near = active ? model.adjacency.get(active) : null;
  const lit = id => near ? id === active || near.has(id) : matches ? matches.has(id) : true;
  const items = useMemo(() => placed.map(({ node, id, x, y, r }) => {
    const color = colorOf(node);
    return { id, x, y, r, opacity: lit(id) ? 1 : 0.16, dashed: node.ghost,
      fill: node.ghost ? C.bg : color, stroke: node.ghost ? C.muted : id === active ? C.text : C.bg,
      ring: node.orphan, ringColor: C.text };
  }), [placed, active, matches, colorOf]);
  const edges = useMemo(() => {
    const at = new Map(placed.map(p => [p.id, p])), paths = { plain: '', lit: '', broken: '' };
    for (const edge of model.edges) {
      const a = at.get(edge.from), b = at.get(edge.to);
      if (!a || !b) continue;
      const segment = `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
      if (active && (edge.from === active || edge.to === active)) paths.lit += segment;
      else if (edge.broken) paths.broken += segment;
      else paths.plain += segment;
    }
    return paths;
  }, [placed, model, active]);
  const tier = 2 ** (Math.round(Math.log2(view?.k || 1) * 2) / 2);
  const labels = useMemo(() => {
    const ids = labelIds(model, tier, active);
    return placed.filter(p => ids.has(p.id)).map(({ node, id, x, y, r }) => ({ id, x, y, r, text: short(node.title || id), strong: id === active, opacity: lit(id) ? 1 : 0.25 }));
  }, [placed, model, tier, active, matches]);
  const v = view || { k: 1, x: 0, y: 0 };
  const shown = active && model.byId.get(active);
  const dim = near || matches ? 0.12 : 0.5;
  return <View style={s.wrap}>
    <View ref={surface} {...responder.panHandlers} style={[s.surface, { height }]} accessible accessibilityRole="image"
      accessibilityLabel={`Grafo da memória com ${model.nodes.length} notas e ${model.edges.length} ligações. A lista mostra as mesmas notas para leitores de tela.`}
      onLayout={e => { const { width, height: h } = e.nativeEvent.layout; box.current = { width, height: h }; setSize({ width, height: h }); }}>
      <View pointerEvents="none" style={s.fill}>
        <Svg width="100%" height="100%">
          <G transform={`translate(${v.x} ${v.y}) scale(${v.k})`}>
            <EdgeLayer d={edges.plain} color={C.muted} width={0.8} opacity={dim} />
            <EdgeLayer d={edges.broken} color={C.muted} width={0.8} opacity={dim} dash="4 3" />
            <EdgeLayer d={edges.lit} color={C.accent} width={1.6} opacity={0.95} />
            <NodeLayer items={items} />
            <LabelLayer items={labels} k={tier} />
          </G>
        </Svg>
      </View>
    </View>
    <View style={s.zoom}>
      <Chip label="+" name="Aproximar" onPress={() => zoomAt((box.current?.width || size.width) / 2, height / 2, 1.35)} />
      <Chip label="−" name="Afastar" onPress={() => zoomAt((box.current?.width || size.width) / 2, height / 2, 1 / 1.35)} />
      <Chip label="Enquadrar tudo" onPress={() => { userMoved.current = false; fit(); }} />
    </View>
    <View accessibilityLiveRegion="polite" style={s.info}>{shown ? <>
      <Text style={s.infoTitle}>{shown.title}</Text>
      <Text style={s.meta}>{shown.ghost ? 'Nota ainda não criada · alguém aponta para ela' :
        `${shown.path} · ${shown.degree} ${shown.degree === 1 ? 'ligação' : 'ligações'}${shown.orphan ? ' · órfã' : ''}`}</Text>
      {!shown.ghost ? <Chip label="Abrir nota" name={'Abrir ' + shown.title} onPress={() => onOpen(shown.path)} /> : null}
    </> : <Text style={s.meta}>{Platform.OS === 'web' ? 'Arraste o fundo para mover, use a roda para o zoom, passe o mouse para ver as ligações e clique para abrir.' :
      'Arraste para mover, use dois dedos para o zoom, segure uma bolinha para ver as ligações e toque para abrir.'}</Text>}</View>
  </View>;
}

function Legend({ entries }) {
  return <View style={s.row}>{entries.map(([key, label, color, kind]) => <View key={key} style={s.legendItem}>
    <View style={[s.dot, kind === 'ghost' ? { borderStyle: 'dashed', borderColor: C.muted, backgroundColor: 'transparent' } :
      kind === 'orphan' ? { borderStyle: 'dashed', borderColor: C.text, borderWidth: 1.5, backgroundColor: 'transparent' } : { backgroundColor: color }]} />
    <Text style={s.meta}>{label}</Text></View>)}</View>;
}

export function MemoryGraph({ bots, call, version, filters, onOpen }) {
  const { query, kind, botId, days } = filters;
  const { height: screen } = useWindowDimensions();
  const [data, setData] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  const [ghosts, setGhosts] = useState(cache.ghosts), [colorBy, setColorBy] = useState(cache.colorBy);
  const [positions, setPositions] = useState(null), [fitKey, setFitKey] = useState(0), [matches, setMatches] = useState(null);
  // The period is measured when the request goes out, like the list does.
  const params = () => ({ ...(kind && { kind }), ...(botId && { botId }), ...(days && { since: new Date(Date.now() - days * 86400000).toISOString() }) });
  useEffect(() => {
    let live = true;
    setLoading(true); setError('');
    stats.start = clock();
    call('notes.graph', params()).then(value => { if (live) setData(value); })
      .catch(e => { if (live) setError(e.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [call, kind, botId, days, version, retry]);
  useEffect(() => {
    let live = true;
    if (!query.trim()) { setMatches(null); return; }
    const timer = setTimeout(() => call('notes.search', { ...params(), query: query.trim(), limit: 100 })
      .then(value => { if (live) setMatches(new Set(value.notes.map(note => note.path))); }).catch(() => { if (live) setMatches(new Set()); }), 180);
    return () => { live = false; clearTimeout(timer); };
  }, [call, query, kind, botId, days, version]);
  const model = useMemo(() => data && graphModel(data, { ghosts }), [data, ghosts]);
  // The simulation runs in slices of the frame and publishes positions at most ~30 times a second; it stops by itself.
  useEffect(() => {
    if (!model) return;
    const known = model.nodes.some(node => cache.positions[node.id]);
    const layout = createLayout({ nodes: model.nodes, edges: model.edges, previous: known ? cache.positions : null });
    const began = clock();
    let handle = 0, last = 0, first = true;
    const step = () => {
      layout.run({ budget: first ? 24 : 10, now: clock });
      const now = clock();
      if (first || layout.done || now - last >= 33) {
        last = now; setPositions(layout.nodes());
        if (first && !known) setFitKey(n => n + 1);
        first = false;
      }
      if (!layout.done) handle = raf(step);
      else {
        Object.assign(cache.positions, layout.positions());
        Object.assign(stats, { nodes: layout.n, edges: layout.links.length, ticks: layout.ticks, layoutMs: Math.round(clock() - began) });
        if (!known) setFitKey(n => n + 1);
      }
    };
    step();
    return () => { cancelRaf(handle); Object.assign(cache.positions, layout.positions()); };
  }, [model]);
  useEffect(() => { if (positions && stats.start) { stats.firstDrawMs = Math.round(clock() - stats.start); stats.start = 0; } }, [positions]);
  const byBot = useMemo(() => new Map(bots.map(bot => [bot.id, bot])), [bots]);
  const colorOf = useMemo(() => {
    const table = kinds();
    return colorBy === 'bot' ? node => node.botId ? byBot.has(node.botId) ? hueOf(byBot.get(node.botId)) : C.muted : C.text2 :
      node => table[node.kind]?.[1] || C.muted;
  }, [colorBy, byBot]);
  const legend = useMemo(() => {
    const entries = [];
    if (colorBy === 'bot') {
      const seen = new Set(model?.nodes.filter(n => !n.ghost).map(n => n.botId || ''));
      for (const id of seen) entries.push([id || 'pessoa', id ? byBot.get(id)?.name || 'Bot removido' : 'Você', colorOf({ botId: id || null })]);
    } else for (const [id, [label, color]] of Object.entries(kinds())) entries.push([id, label, color]);
    entries.push(['orphan', 'Órfã (sem ligações)', null, 'orphan']);
    if (ghosts) entries.push(['ghost', 'Nota ainda não criada', null, 'ghost']);
    return entries;
  }, [colorBy, model, byBot, colorOf, ghosts]);
  const filtered = Boolean(kind || botId || days);
  const height = Math.round(Math.max(340, Math.min(860, screen - 340)));
  return <View style={s.group}>
    <View style={s.row}>
      <Text style={s.meta}>Colorir por:</Text>
      <Chip label="Tipo" name="Colorir por tipo" selected={colorBy === 'kind'} onPress={() => { cache.colorBy = 'kind'; setColorBy('kind'); }} />
      <Chip label="Bot" name="Colorir por bot" selected={colorBy === 'bot'} onPress={() => { cache.colorBy = 'bot'; setColorBy('bot'); }} />
      <Chip label="Mostrar links quebrados" role="switch" selected={ghosts} onPress={() => { cache.ghosts = !ghosts; setGhosts(!ghosts); }} />
    </View>
    {model ? <Legend entries={legend} /> : null}
    {data?.truncated ? <Text style={s.meta}>Mostrando as 500 notas mais recentes ou mais ligadas; use os filtros.</Text> : null}
    {matches ? <Text style={s.meta}>{matches.size ? `${matches.size} ${matches.size === 1 ? 'nota casa' : 'notas casam'} com a busca; as outras ficam apagadas.` : 'Nenhuma nota casa com a busca.'}</Text> : null}
    {error && !data ? <><Text style={s.error}>{error}</Text><Chip label="Tentar de novo" onPress={() => setRetry(n => n + 1)} /></> :
      !model ? <Text style={s.meta}>Desenhando o mapa da memória…</Text> :
      !model.nodes.length ? <Text style={s.body}>{filtered ? 'Nenhuma nota com esses filtros.' : 'Ainda não há notas para desenhar.'}</Text> :
      <>
        {error ? <View style={s.row}><Text style={s.error}>{error}</Text><Chip label="Tentar de novo" onPress={() => setRetry(n => n + 1)} /></View> : null}
        {loading ? <Text style={s.meta}>Atualizando…</Text> : null}
        <GraphCanvas model={model} positions={positions} matches={matches} colorOf={colorOf} height={height} onOpen={onOpen} fitKey={fitKey} />
      </>}
  </View>;
}

const s = themed(() => ({
  wrap: { gap: 10 }, group: { gap: 12 },
  surface: { width: '100%', borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.bg2 || C.surface, overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 },
  zoom: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  info: { gap: 6, minHeight: 44 }, infoTitle: { color: C.text, fontFamily: F.b, fontSize: 16 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderColor: 'transparent' },
  chip: { paddingHorizontal: 12, minHeight: 36, minWidth: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: C.line2, backgroundColor: C.surface },
  chipText: { color: C.text2, fontFamily: F.s, fontSize: 14 },
  meta: { color: C.muted, fontFamily: F.m, fontSize: 13 }, body: { color: C.text2, fontFamily: F.r, fontSize: 15, lineHeight: 22 },
  error: { color: C.red, fontFamily: F.m }
}));
