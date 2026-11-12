import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Svg, { Circle, G, Path, Text as SvgText } from 'react-native-svg';
import { LAYOUT, PERSON_PATH, createLayout, fitBox, graphModel, hitTest, labelIds } from '../state/graph-layout';
import { F, themed } from '../theme';
import { KIND_NAMES, botHues, kindHues, look } from './memory-look';

// Kept while the app is open, so coming back to the map (or out of a note) finds the drawing, zoom and settings as they were.
// Roomier than the layout's defaults, so titles have space between the dots, like Obsidian's map.
const DEFAULTS = { ghosts: true, orphans: true, colorBy: 'bot', nodeSize: 1, lineWidth: 1, text: 0, center: 0.06, repel: 360, link: LAYOUT.linkStrength, distance: 110 };
const cache = { positions: {}, view: null, settings: { ...DEFAULTS }, open: { filters: true, groups: true, display: false, forces: false }, panel: false };
// Timings of the last drawing, read by the performance check in Chrome.
const stats = { start: 0 };
globalThis.mybotsGraphStats = stats;
const clock = () => globalThis.performance?.now?.() ?? Date.now();
const raf = globalThis.requestAnimationFrame || (fn => setTimeout(fn, 16));
const cancelRaf = globalThis.cancelAnimationFrame || clearTimeout;
const ZOOM = { min: 0.08, max: 6 };
const clamp = k => Math.min(ZOOM.max, Math.max(ZOOM.min, k));
const short = text => text.length > 40 ? text.slice(0, 39) + '…' : text;
const periods = [[0, 'Sempre'], [1, '24 h'], [7, '7 dias'], [30, '30 dias']];

/**
 * Runs the force layout in slices of the frame and publishes positions at most ~30 times a second; it stops by itself.
 * `store` keeps positions between drawings, so a reload (new note, filter, force change) starts from where things were.
 */
export function useLayout(model, store, forces, onFirst) {
  const [positions, setPositions] = useState(null);
  const [fitKey, setFitKey] = useState(0);
  const heat = useRef(null), live = useRef(null);
  useEffect(() => {
    if (!model) return;
    const known = model.nodes.some(node => store.positions[node.id]);
    const options = forces ? { gravity: forces.center, charge: -forces.repel, linkStrength: forces.link, linkDistance: forces.distance, ...(forces.hole ? { hole: forces.hole } : {}) } : {};
    if (heat.current) { options.alpha = heat.current; heat.current = null; }
    const layout = createLayout({ nodes: model.nodes, edges: model.edges, previous: known ? store.positions : null, options });
    const began = clock();
    let handle = 0, last = 0, first = true, settled = false;
    const step = () => {
      handle = 0;
      // While dragging and while it settles afterwards: one step per frame, drawn every frame, so the motion glides like
      // Obsidian's instead of jumping several steps at once.
      const touched = layout.target || layout.local;
      layout.run(touched ? { maxTicks: 1 } : { budget: first ? 24 : 10, now: clock });
      const now = clock();
      if (first || layout.done || touched || now - last >= 33) {
        last = now; setPositions(layout.nodes());
        if (first) { onFirst?.(); if (!known) setFitKey(n => n + 1); }
        first = false;
      }
      if (!layout.done) handle = raf(step);
      else {
        Object.assign(store.positions, layout.positions());
        if (!settled) {
          settled = true;
          Object.assign(stats, { nodes: layout.n, edges: layout.links.length, ticks: layout.ticks, layoutMs: Math.round(clock() - began) });
          if (!known) setFitKey(n => n + 1);
        }
      }
    };
    live.current = { layout, wake: () => { if (!handle) handle = raf(step); } };
    step();
    return () => { cancelRaf(handle); live.current = null; Object.assign(store.positions, layout.positions()); };
  }, [model, forces]);
  // A change of forces shakes the drawing a little, like Obsidian, instead of starting over.
  const reheat = () => { heat.current = 0.5; };
  // Dragging a node, like Obsidian: it follows the pointer and its neighbours come along; let go and it settles.
  const drag = useMemo(() => ({
    move(id, x, y) { const run = live.current; if (run?.layout.pin(id, x, y)) { run.layout.warm(0.3, { local: true }); run.wake(); } },
    end(id) { const run = live.current; if (!run) return; run.layout.unpin(id); run.layout.warm(0, { local: true }); run.wake(); }
  }), []);
  return { positions, fitKey, reheat, drag };
}

const EdgeLayer = memo(function EdgeLayer({ d, color, width, opacity }) {
  return d ? <Path d={d} stroke={color} strokeWidth={width} strokeOpacity={opacity} fill="none" /> : null;
});

const GraphNode = memo(function GraphNode({ x, y, r, fill, opacity, ring, ringColor, active, accent, px }) {
  return <>
    {ring ? <Circle cx={x} cy={y} r={r + 2.2 * px} fill="none" stroke={ringColor} strokeWidth={px} opacity={opacity} /> : null}
    {active ? <Circle cx={x} cy={y} r={r + 3 * px} fill="none" stroke={accent} strokeWidth={2 * px} /> : null}
    <Circle cx={x} cy={y} r={r} fill={fill} opacity={opacity} />
  </>;
});

const NodeLayer = memo(function NodeLayer({ items }) {
  return items.map(item => <GraphNode key={item.id} {...item} />);
});

// Titles live in the drawing, like Obsidian: they grow with the zoom and fade out when you zoom away. The highlighted
// note and its neighbours keep a readable size at any zoom.
const LabelLayer = memo(function LabelLayer({ items, color, strong }) {
  return items.map(item => <SvgText key={item.id} x={item.x} y={item.y + item.r + item.size * 1.25} fontSize={item.size} fontFamily={F.m} textAnchor="middle"
    fill={item.strong ? strong : color} fontWeight={item.strong ? 'bold' : 'normal'} opacity={item.opacity}>{item.text}</SvgText>);
});
// Below this zoom (×2^text setting) only the highlighted titles show.
const FADE = { full: 0.75, compact: 0.45 };

function RoundButton({ label, name, onPress, L }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={name} onPress={onPress}
    style={({ hovered }) => [s.round, { backgroundColor: hovered ? L.hover : L.panel, borderColor: L.panelBorder }]}>
    <Text style={[s.roundText, { color: L.muted }]}>{label}</Text></Pressable>;
}

/**
 * The drawing and its gestures, filling its parent. Pan and zoom only change the transform of one <G>; the node, edge and
 * label layers are memoized on positions and highlight, so moving the view does not re-render them.
 */
export function GraphCanvas({ model, positions, matches, colorOf, onOpen, fitKey = 0, initialView = null, initialFocus = null, store = cache,
  display = DEFAULTS, compact = false, current = null, drag = null, transparent = false, lockView = false, onFit = null, soloLabel = false, children }) {
  const L = look();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState(() => initialView || store.view);
  const [hover, setHover] = useState(null), [focus, setFocus] = useState(initialFocus), [dragged, setDragged] = useState(null);
  const viewRef = useRef(view), frame = useRef(0), box = useRef(null), gesture = useRef({}).current, userMoved = useRef(Boolean(store.view));
  const active = dragged && model.byId.has(dragged) ? dragged : hover && model.byId.has(hover) ? hover : focus && model.byId.has(focus) ? focus : null;
  const placed = useMemo(() => {
    const at = new Map((positions || []).map(p => [p.id, p]));
    return model.nodes.filter(node => at.has(node.id)).map(node => ({ node, id: node.id, x: at.get(node.id).x, y: at.get(node.id).y, r: node.r * 0.72 * display.nodeSize }));
  }, [model, positions, display.nodeSize]);
  const placedRef = useRef(placed); placedRef.current = placed;
  const commit = (next, force) => {
    if (lockView && !force) return;
    viewRef.current = next;
    if (!frame.current) frame.current = raf(() => { frame.current = 0; setView(viewRef.current); store.view = viewRef.current; });
  };
  const fit = () => {
    const { width, height } = box.current || size;
    if (!width || !placedRef.current.length) return;
    // Room for the titles under the dots at the edges, too.
    const { k, x, y } = fitBox(placedRef.current, width, height, { padding: Math.min(compact ? 70 : 90, width * 0.12, height * 0.12), maxScale: compact ? 1.2 : 1.25 });
    commit({ k: clamp(k), x, y }, true); onFit?.({ k: clamp(k), x, y });
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
      if (node && !node.ghost && node.id !== current) onOpen(node.path);
      else setFocus(node ? node.id : null);
    },
    hold(id) { setFocus(id); },
    drag
  };
  useEffect(() => { if (lockView || !userMoved.current || !viewRef.current) fit(); }, [fitKey, size.width, size.height]);
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
        rebase(local(e)); gesture.at = gesture.points[0]; gesture.moved = false; gesture.held = false; gesture.dragging = false;
        // Pressing on a node and moving drags that node; pressing on the background pans.
        gesture.node = handlers.current.drag ? hitAt(gesture.at.x, gesture.at.y, 8) : null;
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
          if (gesture.dragging) { gesture.dragging = false; handlers.current.drag.end(gesture.node); setDragged(null); }
          gesture.node = null;
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
        if (!gesture.moved && Math.hypot(dx, dy) < (gesture.node ? 3 : 6)) return;
        gesture.moved = true; clearTimeout(gesture.timer);
        if (gesture.node) {
          const v = viewRef.current || { k: 1, x: 0, y: 0 };
          if (!gesture.dragging) { gesture.dragging = true; setDragged(gesture.node); }
          handlers.current.drag.move(gesture.node, (points[0].x - v.x) / v.k, (points[0].y - v.y) / v.k);
          return;
        }
        userMoved.current = true;
        commit({ ...gesture.start, x: gesture.start.x + dx, y: gesture.start.y + dy });
      },
      onPanResponderRelease: () => {
        clearTimeout(gesture.timer);
        if (gesture.dragging) { gesture.dragging = false; handlers.current.drag.end(gesture.node); setDragged(null); return; }
        if (!gesture.moved && !gesture.held) handlers.current.tap(hitAt(gesture.at.x, gesture.at.y, 8));
      },
      onPanResponderTerminate: () => {
        clearTimeout(gesture.timer);
        if (gesture.dragging) { gesture.dragging = false; handlers.current.drag.end(gesture.node); setDragged(null); }
      }
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
      if (e.buttons) { if (gesture.dragging) element.style.cursor = 'grabbing'; return; }
      const id = hitAt(...point(e), 2);
      element.style.cursor = id ? 'grab' : 'default';
      if (id !== shown) { shown = id; setHover(id); }
    };
    const leave = () => { shown = null; setHover(null); };
    // Dragging over the titles must not select them as text.
    const press = e => { if (e.button === 0) e.preventDefault(); };
    element.style.userSelect = 'none'; element.style.webkitUserSelect = 'none';
    element.addEventListener('mousedown', press);
    element.addEventListener('wheel', wheel, { passive: false });
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerleave', leave);
    return () => { element.removeEventListener('mousedown', press); element.removeEventListener('wheel', wheel); element.removeEventListener('pointermove', move); element.removeEventListener('pointerleave', leave); };
  }, []);

  // The zoom in half-steps: what the layers depend on, so they re-render a few times per zoom, not every frame.
  const tier = 2 ** (Math.round(Math.log2(view?.k || 1) * 2) / 2);
  const near = active ? model.adjacency.get(active) : null;
  const lit = id => near ? id === active || near.has(id) : matches ? matches.has(id) : true;
  const items = useMemo(() => placed.map(({ node, id, x, y, r }) => ({ id, x, y, r: Math.max(r, 3.2 / tier), opacity: lit(id) ? 1 : 0.14,
    fill: node.ghost ? L.unresolved : node.person ? L.accent : colorOf(node), ring: node.orphan && !node.person, ringColor: L.faint,
    active: id === active || id === current, accent: L.accent, px: 1 / tier })), [placed, active, matches, colorOf, L, tier]);
  const edges = useMemo(() => {
    const at = new Map(placed.map(p => [p.id, p])), paths = { plain: '', lit: '' };
    for (const edge of model.edges) {
      const a = at.get(edge.from), b = at.get(edge.to);
      if (!a || !b || a === b) continue;
      const segment = `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
      if (active && (edge.from === active || edge.to === active)) paths.lit += segment;
      else paths.plain += segment;
    }
    return paths;
  }, [placed, model, active]);
  const labels = useMemo(() => {
    const boost = 2 ** display.text, shown = tier * boost >= (compact ? FADE.compact : FADE.full);
    const ids = shown && !soloLabel ? labelIds(model, tier * boost, active) : new Set();
    // soloLabel: only the title of the note under the pointer, not its neighbours'.
    const keep = new Set((soloLabel ? [active] : [active, current, ...(near || [])]).filter(Boolean));
    // The person's note keeps its name at any zoom.
    if (!soloLabel && model.byId.has(PERSON_PATH)) keep.add(PERSON_PATH);
    for (const id of keep) ids.add(id);
    const base = compact ? 11 : 12;
    return placed.filter(p => ids.has(p.id)).map(({ node, id, x, y, r }) => ({ id, x, y, r, text: short(node.title || id), strong: id === active || id === current || node.person,
      // The small local map keeps its titles at a fixed size on screen; the big one scales them with the zoom.
      opacity: lit(id) ? 1 : 0.2, size: compact ? 10.5 / tier : keep.has(id) ? Math.max(base, 11.5 / tier) : base }));
  }, [placed, model, tier, active, matches, display.text, current, compact, soloLabel]);
  const v = view || { k: 1, x: 0, y: 0 };
  const dim = near || matches ? 0.15 : 0.9;
  const width = box.current?.width || size.width, height = box.current?.height || size.height;
  const held = focus && model.byId.get(focus);
  // The drawing is rasterized once per zoom half-step, at that resolution, and panning or zooming only moves and scales
  // that layer (composited by the GPU, like Obsidian's canvas). Bounds leave room for the titles around the dots.
  const frameBox = useMemo(() => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of placed) { x0 = Math.min(x0, p.x - p.r); y0 = Math.min(y0, p.y - p.r); x1 = Math.max(x1, p.x + p.r); y1 = Math.max(y1, p.y + p.r); }
    if (!placed.length) { x0 = y0 = -1; x1 = y1 = 1; }
    const pad = 40 + 160 / tier, w = x1 - x0 + 2 * pad, h = y1 - y0 + 2 * pad;
    return { x: x0 - pad, y: y0 - pad, w, h, scale: Math.max(0.05, Math.min(tier, 4096 / Math.max(w, h))) };
  }, [placed, tier]);
  const drawing = useMemo(() => <Svg width={frameBox.w * frameBox.scale} height={frameBox.h * frameBox.scale} viewBox={`${frameBox.x} ${frameBox.y} ${frameBox.w} ${frameBox.h}`}>
    <G>
      <EdgeLayer d={edges.plain} color={L.line} width={display.lineWidth / tier} opacity={dim} />
      <EdgeLayer d={edges.lit} color={L.accent} width={display.lineWidth * 1.6 / tier} opacity={1} />
      <NodeLayer items={items} />
      <LabelLayer items={labels} color={L.muted} strong={L.text} />
    </G>
  </Svg>, [frameBox, edges, items, labels, L, display.lineWidth, dim, tier]);
  // Scale about the layer's centre (React Native's transform origin), placing the box's corner where the view puts it.
  const layerW = frameBox.w * frameBox.scale, layerH = frameBox.h * frameBox.scale, shrink = v.k / frameBox.scale;
  const layer = { width: layerW, height: layerH, transform: [
    { translateX: v.x + frameBox.x * v.k - layerW / 2 * (1 - shrink) }, { translateY: v.y + frameBox.y * v.k - layerH / 2 * (1 - shrink) }, { scale: shrink }] };
  const plate = useRef(null);
  useEffect(() => { const element = plate.current; if (Platform.OS === 'web' && element?.style) element.style.willChange = 'transform'; }, []);
  return <View style={[s.fill, !transparent && { backgroundColor: L.bg }]}>
    <View ref={surface} {...responder.panHandlers} style={[s.fill, { overflow: 'hidden' }]} accessible accessibilityRole="image"
      accessibilityLabel={`Grafo da memória com ${model.nodes.length} notas e ${model.edges.length} ligações. A lista mostra as mesmas notas para leitores de tela.`}
      onLayout={e => { const { width: w, height: h } = e.nativeEvent.layout; box.current = { width: w, height: h }; setSize({ width: w, height: h }); }}>
      <View ref={plate} pointerEvents="none" renderToHardwareTextureAndroid shouldRasterizeIOS style={[s.plate, layer]}>{drawing}</View>
    </View>
    {children}
    {!compact && !lockView ? <View style={s.zoom}>
      <RoundButton L={L} label="+" name="Aproximar" onPress={() => zoomAt(width / 2, height / 2, 1.35)} />
      <RoundButton L={L} label="−" name="Afastar" onPress={() => zoomAt(width / 2, height / 2, 1 / 1.35)} />
      <RoundButton L={L} label="⤢" name="Enquadrar tudo" onPress={() => { userMoved.current = false; fit(); }} />
    </View> : null}
    {held && !hover && !compact && !lockView ? <View style={[s.held, { backgroundColor: L.panel, borderColor: L.panelBorder }]}>
      <Text style={[s.heldTitle, { color: L.text }]} numberOfLines={1}>{held.title}</Text>
      <Text style={[s.small, { color: L.muted }]}>{held.ghost ? 'Nota ainda não criada' : `${held.degree} ${held.degree === 1 ? 'ligação' : 'ligações'}${held.orphan ? ' · órfã' : ''}`}</Text>
      {!held.ghost ? <Pressable accessibilityRole="button" accessibilityLabel={'Abrir ' + held.title} onPress={() => onOpen(held.path)}>
        <Text style={[s.small, { color: L.link }]}>Abrir nota</Text></Pressable> : null}
    </View> : null}
  </View>;
}

// A slider like Obsidian's: drag or tap anywhere on the track.
function Slider({ label, value, min, max, onChange, L }) {
  const width = useRef(0), origin = useRef(0);
  const set = pageX => {
    const ratio = Math.min(1, Math.max(0, (pageX - origin.current) / Math.max(1, width.current)));
    onChange(min + ratio * (max - min));
  };
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true, onMoveShouldSetPanResponder: () => true, onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: e => { origin.current = e.nativeEvent.pageX - e.nativeEvent.locationX; set(e.nativeEvent.pageX); },
    onPanResponderMove: e => set(e.nativeEvent.pageX)
  }), [min, max, onChange]);
  const ratio = (value - min) / (max - min);
  return <View style={s.sliderRow}>
    <Text style={[s.small, { color: L.text }]}>{label}</Text>
    <View {...responder.panHandlers} accessible accessibilityRole="adjustable" accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(ratio * 100) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={e => onChange(Math.min(max, Math.max(min, value + (e.nativeEvent.actionName === 'increment' ? 1 : -1) * (max - min) / 10)))}
      onLayout={e => { width.current = e.nativeEvent.layout.width; }} style={s.track}>
      <View pointerEvents="none" style={[s.rail, { backgroundColor: L.panelBorder }]} />
      <View pointerEvents="none" style={[s.rail, { width: `${ratio * 100}%`, backgroundColor: L.accent }]} />
      <View pointerEvents="none" style={[s.knob, { left: `${ratio * 100}%`, backgroundColor: L.text }]} />
    </View>
  </View>;
}

function Toggle({ label, value, onChange, L }) {
  return <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value }} onPress={() => onChange(!value)} style={s.toggleRow}>
    <Text style={[s.small, { color: L.text, flex: 1 }]}>{label}</Text>
    <View style={[s.switch, { backgroundColor: value ? L.accent : L.panelBorder }]}><View style={[s.switchKnob, { alignSelf: value ? 'flex-end' : 'flex-start' }]} /></View>
  </Pressable>;
}

function Segment({ options, value, onChange, L }) {
  return <View style={[s.segment, { backgroundColor: L.input, borderColor: L.panelBorder }]}>{options.map(([id, label, name]) =>
    <Pressable key={String(id)} accessibilityRole="button" accessibilityLabel={name || label} accessibilityState={{ selected: value === id }} onPress={() => onChange(id)}
      style={[s.segmentItem, value === id && { backgroundColor: L.hover }]}>
      <Text style={[s.small, { color: value === id ? L.text : L.muted }]} numberOfLines={1}>{label}</Text></Pressable>)}</View>;
}

function Chips({ options, value, onChange, L }) {
  return <View style={s.chips}>{options.map(([id, label]) =>
    <Pressable key={String(id)} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: value === id }} onPress={() => onChange(id)}
      style={[s.chip, { borderColor: value === id ? L.accent : L.panelBorder, backgroundColor: value === id ? L.hover : L.input }]}>
      <Text style={[s.small, { color: value === id ? L.text : L.muted }]} numberOfLines={1}>{label}</Text></Pressable>)}</View>;
}

function Section({ id, title, open, onToggle, L, children }) {
  return <View style={[s.section, { borderBottomColor: L.panelBorder }]}>
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded: open }} onPress={() => onToggle(id)} style={s.sectionHead}>
      <Text style={[s.chevron, { color: L.muted }]}>{open ? '▾' : '▸'}</Text><Text style={[s.sectionTitle, { color: L.text }]}>{title}</Text></Pressable>
    {open ? <View style={s.sectionBody}>{children}</View> : null}
  </View>;
}

function Settings({ L, settings, set, filters, onFilters, bots, groups, open, onToggle, onReset }) {
  const label = (text) => <Text style={[s.small, { color: L.muted }]}>{text}</Text>;
  return <ScrollView style={[s.panel, { backgroundColor: L.panel, borderColor: L.panelBorder, shadowColor: L.shadow }]} contentContainerStyle={{ paddingBottom: 6 }}>
    <Section id="filters" title="Filtros" open={open.filters} onToggle={onToggle} L={L}>
      <TextInput accessibilityLabel="Buscar nas notas" placeholder="Buscar arquivos…" placeholderTextColor={L.faint} value={filters.query} maxLength={200}
        onChangeText={query => onFilters({ query })} style={[s.input, { backgroundColor: L.input, borderColor: L.panelBorder, color: L.text }]} />
      {label('Pasta')}
      <Chips L={L} value={filters.kind} onChange={kind => onFilters({ kind })} options={[['', 'Todas'], ['chefe', 'Chefe'], ['entrega', 'Entregas'], ['arquivo', 'Arquivo']]} />
      {label('Período')}
      <Segment L={L} value={filters.days} onChange={days => onFilters({ days })} options={periods} />
      {bots.length ? <>{label('Autor')}
        <Chips L={L} value={filters.botId} onChange={botId => onFilters({ botId })} options={[['', 'Todos'], ...bots.map(bot => [bot.id, bot.name])]} /></> : null}
      <Toggle L={L} label="Notas órfãs" value={settings.orphans} onChange={orphans => set({ orphans })} />
      <Toggle L={L} label="Mostrar links quebrados" value={settings.ghosts} onChange={ghosts => set({ ghosts })} />
    </Section>
    <Section id="groups" title="Grupos" open={open.groups} onToggle={onToggle} L={L}>
      <Segment L={L} value={settings.colorBy} onChange={colorBy => set({ colorBy })}
        options={[['bot', 'Por bot', 'Colorir por bot'], ['kind', 'Por tipo', 'Colorir por tipo'], ['none', 'Sem cor', 'Sem cores']]} />
      {groups.map(([key, name, color, count]) => <View key={key} style={s.group}>
        <View style={[s.dot, { backgroundColor: color }]} /><Text style={[s.small, { color: L.text, flex: 1 }]} numberOfLines={1}>{name}</Text>
        <Text style={[s.small, { color: L.faint }]}>{count}</Text></View>)}
    </Section>
    <Section id="display" title="Exibição" open={open.display} onToggle={onToggle} L={L}>
      <Slider L={L} label="Limite para mostrar nomes" value={-settings.text} min={-2} max={2} onChange={value => set({ text: -value })} />
      <Slider L={L} label="Tamanho dos nós" value={settings.nodeSize} min={0.4} max={2.5} onChange={nodeSize => set({ nodeSize })} />
      <Slider L={L} label="Espessura das linhas" value={settings.lineWidth} min={0.3} max={3} onChange={lineWidth => set({ lineWidth })} />
    </Section>
    <Section id="forces" title="Forças" open={open.forces} onToggle={onToggle} L={L}>
      <Slider L={L} label="Força do centro" value={settings.center} min={0} max={0.2} onChange={center => set({ center }, true)} />
      <Slider L={L} label="Força de repulsão" value={settings.repel} min={10} max={500} onChange={repel => set({ repel }, true)} />
      <Slider L={L} label="Força dos links" value={settings.link} min={0.05} max={2} onChange={link => set({ link }, true)} />
      <Slider L={L} label="Distância dos links" value={settings.distance} min={15} max={250} onChange={distance => set({ distance }, true)} />
      <Pressable accessibilityRole="button" accessibilityLabel="Restaurar padrões do grafo" onPress={onReset}><Text style={[s.small, { color: L.link }]}>Restaurar padrões</Text></Pressable>
    </Section>
  </ScrollView>;
}

export function MemoryGraph({ bots, call, version, filters, onFilters, onOpen }) {
  const L = look();
  const { query, kind, botId, days } = filters;
  const [data, setData] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  const [settings, setSettings] = useState(cache.settings), [panel, setPanel] = useState(cache.panel), [open, setOpen] = useState(cache.open);
  const [matches, setMatches] = useState(null);
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
  const model = useMemo(() => data && graphModel(data, { ghosts: settings.ghosts, orphans: settings.orphans }), [data, settings.ghosts, settings.orphans]);
  const forces = useMemo(() => ({ center: settings.center, repel: settings.repel, link: settings.link, distance: settings.distance }),
    [settings.center, settings.repel, settings.link, settings.distance]);
  const { positions, fitKey, reheat, drag } = useLayout(model, cache, forces);
  useEffect(() => { if (positions && stats.start) { stats.firstDrawMs = Math.round(clock() - stats.start); stats.start = 0; } }, [positions]);
  const set = (patch, shake) => { if (shake) reheat(); setSettings(old => (cache.settings = { ...old, ...patch })); };
  const hues = useMemo(() => botHues(bots), [bots, L]);
  const kinds = useMemo(() => kindHues(), [L]);
  const colorOf = useMemo(() => settings.colorBy === 'bot' ? node => node.botId ? hues.get(node.botId) || L.node : L.node :
    settings.colorBy === 'kind' ? node => kinds[node.kind] || L.node : () => L.node, [settings.colorBy, hues, kinds, L]);
  const groups = useMemo(() => {
    const real = model?.nodes.filter(n => !n.ghost) || [], count = new Map();
    const key = settings.colorBy === 'bot' ? n => n.botId || '' : settings.colorBy === 'kind' ? n => n.kind : () => 'all';
    for (const n of real) count.set(key(n), (count.get(key(n)) || 0) + 1);
    const byId = new Map(bots.map(bot => [bot.id, bot]));
    const entries = [...count].map(([id, n]) => settings.colorBy === 'bot' ? [id || 'voce', id ? byId.get(id)?.name || 'Bot removido' : 'Você', id ? hues.get(id) || L.node : L.node, n]
      : settings.colorBy === 'kind' ? [id, KIND_NAMES[id] || id, kinds[id] || L.node, n] : ['all', 'Todas as notas', L.node, n]);
    if (settings.ghosts) { const ghosts = model?.nodes.filter(n => n.ghost).length || 0; if (ghosts) entries.push(['ghost', 'Ainda não criadas', L.unresolved, ghosts]); }
    return entries.sort((a, b) => b[3] - a[3]);
  }, [model, settings.colorBy, settings.ghosts, bots, hues, kinds, L]);
  const toggle = id => setOpen(old => (cache.open = { ...old, [id]: !old[id] }));
  const showPanel = value => { cache.panel = value; setPanel(value); };
  const filtered = Boolean(kind || botId || days);
  const status = error && !data ? null : !model ? 'Desenhando o mapa da memória…' : data.truncated ? 'Mostrando as 500 notas mais recentes ou mais ligadas; use os filtros.' :
    matches ? (matches.size ? `${matches.size} ${matches.size === 1 ? 'nota encontrada' : 'notas encontradas'}` : 'Nenhuma nota encontrada') : loading ? 'Atualizando…' : null;
  const overlay = <>
    {status ? <Text style={[s.status, { color: L.muted }]}>{status}</Text> : null}
    <View style={s.corner}>
      {panel ? <View style={s.panelWrap}>
        <View style={s.panelBar}><Pressable accessibilityRole="button" accessibilityLabel="Fechar configurações do grafo" onPress={() => showPanel(false)} style={s.iconButton}>
          <Text style={[s.roundText, { color: L.muted }]}>✕</Text></Pressable></View>
        <Settings L={L} settings={settings} set={set} filters={filters} onFilters={onFilters} bots={bots} groups={groups} open={open} onToggle={toggle}
          onReset={() => { reheat(); setSettings(old => (cache.settings = { ...old, ...DEFAULTS, colorBy: old.colorBy, ghosts: old.ghosts, orphans: old.orphans })); }} />
      </View> : <Pressable accessibilityRole="button" accessibilityLabel="Configurações do grafo" onPress={() => showPanel(true)}
        style={({ hovered }) => [s.round, { backgroundColor: hovered ? L.hover : L.panel, borderColor: L.panelBorder }]}>
        <Text style={[s.roundText, { color: L.muted }]}>⚙</Text></Pressable>}
    </View>
  </>;
  if (error && !data) return <View style={[s.fill, s.center, { backgroundColor: L.bg }]}>
    <Text style={[s.message, { color: L.danger }]}>{error}</Text>
    <Pressable accessibilityRole="button" onPress={() => setRetry(n => n + 1)}><Text style={[s.message, { color: L.link }]}>Tentar de novo</Text></Pressable></View>;
  if (model && !model.nodes.length) return <View style={[s.fill, s.center, { backgroundColor: L.bg }]}>
    <Text style={[s.message, { color: L.muted }]}>{filtered || !settings.orphans ? 'Nenhuma nota com esses filtros.' : 'Ainda não há notas para desenhar.'}</Text>{overlay}</View>;
  if (!model) return <View style={[s.fill, { backgroundColor: L.bg }]}>{overlay}</View>;
  return <GraphCanvas model={model} positions={positions} matches={matches} colorOf={colorOf} onOpen={onOpen} fitKey={fitKey} display={settings} drag={drag}>{overlay}</GraphCanvas>;
}

const s = themed(() => ({
  fill: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 },
  plate: { position: 'absolute', left: 0, top: 0 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  message: { fontFamily: F.m, fontSize: 15, textAlign: 'center' },
  status: { position: 'absolute', left: 16, top: 12, fontFamily: F.m, fontSize: 12.5 },
  zoom: { position: 'absolute', right: 14, bottom: 14, gap: 8 },
  round: { width: 36, height: 36, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  roundText: { fontSize: 17, lineHeight: 20, fontFamily: F.s },
  corner: { position: 'absolute', right: 12, top: 12, bottom: 150, alignItems: 'flex-end' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 9, minHeight: 28, justifyContent: 'center', maxWidth: 170 },
  panelWrap: { width: 290, maxWidth: '100%', flexShrink: 1 },
  panelBar: { position: 'absolute', right: 6, top: 6, zIndex: 2 },
  iconButton: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 6 },
  panel: { borderWidth: 1, borderRadius: 10, shadowOpacity: 1, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8, flexGrow: 0 },
  section: { borderBottomWidth: 1, paddingHorizontal: 12 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 11, paddingRight: 28 },
  sectionTitle: { fontFamily: F.s, fontSize: 14 }, chevron: { width: 12, fontSize: 12 },
  sectionBody: { gap: 10, paddingBottom: 14 },
  small: { fontFamily: F.m, fontSize: 13 },
  input: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 7, fontFamily: F.r, fontSize: 13.5 },
  segment: { flexDirection: 'row', borderWidth: 1, borderRadius: 6, padding: 2, gap: 2 },
  segmentItem: { flex: 1, minHeight: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 4, paddingHorizontal: 4 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 30 },
  switch: { width: 34, height: 20, borderRadius: 10, padding: 2, justifyContent: 'center' },
  switchKnob: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#ffffff' },
  sliderRow: { gap: 6 },
  track: { height: 22, justifyContent: 'center' },
  rail: { position: 'absolute', left: 0, height: 4, borderRadius: 2, width: '100%' },
  knob: { position: 'absolute', width: 14, height: 14, borderRadius: 7, marginLeft: -7 },
  group: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  held: { position: 'absolute', left: 14, bottom: 14, maxWidth: 320, borderWidth: 1, borderRadius: 8, padding: 10, gap: 4 },
  heldTitle: { fontFamily: F.s, fontSize: 14 }
}));
