import React, { useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { parseBlocks, parseInline } from '../markdown';
import { Chart } from '../RichMessage';
import { graphModel } from '../state/graph-layout';
import { linkParts, noteDestination, noteProperties, readableDate } from '../state/note-view';
import { F, themed } from '../theme';
import { GraphCanvas, useLayout } from './MemoryGraph';
import { KIND_NAMES, look } from './memory-look';

// Obsidian's reading view: a readable column, the title, the properties, the Markdown typeset, then the links.
function Inline({ text, links, onOpen, style, L }) {
  const runs = parseInline(text, raw => noteDestination(raw, links) || { exists: false });
  return <Text selectable style={style}>{runs.map((run, index) => {
    const mark = [run.bold && s.bold, run.italic && s.italic, run.code && [s.code, { backgroundColor: L.code, color: L.text }]];
    if (run.note) {
      const { label } = linkParts(run.text.slice(2, -2));
      return run.note.exists ? <Text key={index} accessibilityRole="link" onPress={() => onOpen(run.note.path)} style={[mark, s.link, { color: L.link }]}>{label}</Text>
        : <Text key={index} accessibilityHint="Nota ainda não criada" style={[mark, s.link, { color: L.link, opacity: 0.55 }]}>{label}</Text>;
    }
    if (run.href) return <Text key={index} accessibilityRole="link" onPress={() => Linking.openURL(run.href)} style={[mark, { color: L.link, textDecorationLine: 'underline' }]}>{run.text}</Text>;
    return <Text key={index} style={mark}>{run.text}</Text>;
  })}</Text>;
}

const CALLOUTS = { note: 'Nota', info: 'Informação', tip: 'Dica', warning: 'Atenção', danger: 'Perigo', success: 'Feito', question: 'Pergunta', todo: 'A fazer', example: 'Exemplo', quote: 'Citação', abstract: 'Resumo' };

export function NoteMarkdown({ text, links = [], onOpen = () => {} }) {
  const L = look();
  const blocks = useMemo(() => parseBlocks(text, { keepMath: false }), [text]);
  const body = [s.body, { color: L.text }];
  const inline = (value, style = body) => <Inline text={value} links={links} onOpen={onOpen} style={style} L={L} />;
  return <View style={s.doc}>{blocks.map((block, index) => {
    if (block.type === 'heading') return <View key={index} style={[s.headingWrap, index === 0 && { marginTop: 0 }]}>{inline(block.text, [s.heading, s['h' + Math.min(block.level, 4)], { color: L.text }])}</View>;
    if (block.type === 'paragraph') return <View key={index}>{inline(block.text)}</View>;
    if (block.type === 'list') return <View key={index} style={s.list}>{block.items.map((item, i) => {
      const task = /^\[([ xX])\]\s+(.*)$/.exec(item);
      return <View key={i} style={s.item}>
        {task ? <View style={[s.box, { borderColor: task[1] === ' ' ? L.faint : L.accent, backgroundColor: task[1] === ' ' ? 'transparent' : L.accent }]}>
          {task[1] !== ' ' ? <Text style={s.tick}>✓</Text> : null}</View>
          : <Text style={[s.marker, { color: L.faint }]}>{block.ordered ? `${block.start + i}.` : '•'}</Text>}
        <View style={{ flex: 1 }}>{inline(task ? task[2] : item, task && task[1] !== ' ' ? [body, { color: L.faint, textDecorationLine: 'line-through' }] : body)}</View>
      </View>;
    })}</View>;
    if (block.type === 'quote') {
      const callout = /^\[!(\w+)\][+-]?[ \t]*(.*)(?:\n([\s\S]*))?$/.exec(block.text);
      if (callout) return <View key={index} style={[s.callout, { backgroundColor: L.accent + '1f', borderColor: L.accent + '55' }]}>
        <Text style={[s.calloutTitle, { color: L.accent }]}>{callout[2] || CALLOUTS[callout[1].toLowerCase()] || callout[1]}</Text>
        {callout[3] ? inline(callout[3]) : null}</View>;
      return <View key={index} style={[s.quote, { borderLeftColor: L.quote }]}>{inline(block.text)}</View>;
    }
    if (block.type === 'code') return <ScrollView key={index} horizontal style={[s.codeBlock, { backgroundColor: L.code, borderColor: L.panelBorder }]}>
      <Text selectable style={[s.mono, { color: L.text }]}>{block.text}</Text></ScrollView>;
    if (block.type === 'table') return <ScrollView key={index} horizontal><View style={[s.table, { borderColor: L.panelBorder }]}>
      {[block.header, ...block.rows].map((row, r) => <View key={r} style={[s.tr, { borderColor: L.panelBorder }, r === 0 && { backgroundColor: L.panel }]}>
        {row.map((cell, c) => <View key={c} style={[s.td, { borderColor: L.panelBorder }]}>{inline(cell, [s.cell, { color: L.text }, r === 0 && s.bold])}</View>)}</View>)}
    </View></ScrollView>;
    if (block.type === 'chart') return <Chart key={index} spec={block.spec} />;
    return <View key={index} style={[s.rule, { backgroundColor: L.panelBorder }]} />;
  })}</View>;
}

function Properties({ items, links, onOpen, bots, hues, L }) {
  return <View style={[s.props, { borderColor: L.panelBorder }]}>
    <Text style={[s.propsTitle, { color: L.muted }]}>Propriedades</Text>
    {items.map(([key, value], index) => {
      const bot = /^(bot|autor)$/i.test(key) ? bots.find(item => item.name === value) : null;
      return <View key={index} style={s.prop}>
        <Text style={[s.propKey, { color: L.muted }]} numberOfLines={1}>{key}</Text>
        <View style={s.propValue}>
          {bot ? <View style={[s.botDot, { backgroundColor: hues.get(bot.id) || L.node }]} /> : null}
          <View style={{ flex: 1 }}>{/^data|^atualiza|^criada/i.test(key) ? <Text selectable style={[s.propText, { color: L.text }]}>{readableDate(value)}</Text>
            : <Inline text={value} links={links} onOpen={onOpen} style={[s.propText, { color: L.text }]} L={L} />}</View>
        </View>
      </View>;
    })}
  </View>;
}

// A snippet as text: [[nome|apelido]] reads "apelido", **negrito** loses its marks.
const plain = text => String(text || '').replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_, name, alias) => (alias || name).trim()).replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim();

function Mentions({ title, items, onOpen, L, empty }) {
  const [open, setOpen] = useState(true);
  return <View style={s.mentions}>
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={s.mentionsHead}>
      <Text style={[s.chevron, { color: L.muted }]}>{open ? '▾' : '▸'}</Text>
      <Text style={[s.mentionsTitle, { color: L.text }]}>{title}</Text>
      <Text style={[s.count, { color: L.muted, backgroundColor: L.panel }]}>{items.length}</Text>
    </Pressable>
    {open ? items.length ? items.map(item => <Pressable key={item.path} accessibilityRole={item.exists === false ? undefined : 'link'} disabled={item.exists === false}
      onPress={() => onOpen(item.path)} style={({ hovered }) => [s.mention, { backgroundColor: hovered ? L.hover : 'transparent' }]}>
      <Text style={[s.mentionTitle, { color: L.link, opacity: item.exists === false ? 0.55 : 1 }]} numberOfLines={1}>{item.title}</Text>
      <Text style={[s.small, { color: L.faint }]} numberOfLines={item.snippet ? 2 : 1}>{item.exists === false ? 'Nota ainda não criada' : plain(item.snippet) || item.path}</Text>
    </Pressable>) : <Text style={[s.small, { color: L.faint, paddingLeft: 20 }]}>{empty}</Text> : null}
  </View>;
}

// The note and its direct neighbours, like Obsidian's local graph.
const LOCAL_FORCES = { center: 0.08, repel: 420, link: 1, distance: 120 };
function LocalGraph({ note, hues, onOpen, L }) {
  const data = useMemo(() => {
    const nodes = new Map([[note.path, { path: note.path, title: note.title, kind: note.kind, botId: note.botId, outgoingCount: 1, incomingCount: 1 }]]), edges = [];
    for (const link of note.links) {
      if (link.path === note.path) continue;
      if (link.exists && !nodes.has(link.path)) nodes.set(link.path, { path: link.path, title: link.title, kind: link.kind, botId: link.botId, outgoingCount: 1, incomingCount: 1 });
      edges.push({ from: note.path, to: link.path, exists: link.exists, title: link.title });
    }
    for (const back of note.backlinks) {
      if (back.path === note.path) continue;
      if (!nodes.has(back.path)) nodes.set(back.path, { path: back.path, title: back.title, kind: back.kind, botId: back.botId, outgoingCount: 1, incomingCount: 1 });
      edges.push({ from: back.path, to: note.path, exists: true });
    }
    return { nodes: [...nodes.values()], edges };
  }, [note]);
  const model = useMemo(() => graphModel(data), [data]);
  const store = useMemo(() => ({ positions: {}, view: null }), [note.path]);
  const { positions, fitKey } = useLayout(model, store, LOCAL_FORCES);
  // Same colours as the big map: each bot its own, the person's notes grey.
  const colorOf = useMemo(() => node => node.botId ? hues.get(node.botId) || L.node : L.node, [hues, L]);
  return <View style={[s.local, { borderColor: L.panelBorder, backgroundColor: L.bg }]}>
    <GraphCanvas key={note.path} model={model} positions={positions} colorOf={colorOf} onOpen={onOpen} fitKey={fitKey} store={store} compact current={note.path} />
  </View>;
}

export function NoteReader({ note, bots, hues, onOpen, width = 0, top = null }) {
  const L = look();
  const { properties, body } = useMemo(() => {
    const parts = noteProperties(note.body);
    const heading = /^#\s+(.+?)\s*\n+/.exec(parts.body);
    return heading && heading[1].trim().toLowerCase() === note.title.trim().toLowerCase() ? { ...parts, body: parts.body.slice(heading[0].length) } : parts;
  }, [note.body, note.title]);
  const author = note.botName || (note.botId ? 'Bot' : 'Você');
  const items = properties.length ? properties : [['Autor', author], ['Atualizada', note.updatedAt]];
  const wide = width >= 1060;
  const outgoing = note.links.filter(link => link.path !== note.path);
  const side = <>
    <Text style={[s.sideTitle, { color: L.muted }]}>Grafo local</Text>
    <LocalGraph note={note} hues={hues} onOpen={onOpen} L={L} />
    <Mentions title="Links de entrada" items={note.backlinks} onOpen={onOpen} L={L} empty="Nenhuma nota aponta para esta." />
    <Mentions title="Links de saída" items={outgoing} onOpen={onOpen} L={L} empty="Esta nota não aponta para outras." />
  </>;
  return <View style={[s.reader, { backgroundColor: L.bg }]}>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={s.scroll}>
      <View style={s.column}>
        {top}
        <Text selectable style={[s.title, { color: L.text }]}>{note.title}</Text>
        <Text style={[s.path, { color: L.faint }]} numberOfLines={1}>{KIND_NAMES[note.kind] || note.kind} · {note.path}</Text>
        <Properties items={items} links={note.links} onOpen={onOpen} bots={bots} hues={hues} L={L} />
        <NoteMarkdown text={body} links={note.links} onOpen={onOpen} />
        {!wide ? <View style={[s.footer, { borderTopColor: L.panelBorder }]}>{side}</View> : null}
      </View>
    </ScrollView>
    {wide ? <ScrollView style={[s.side, { borderLeftColor: L.panelBorder }]} contentContainerStyle={{ padding: 16, gap: 14 }}>{side}</ScrollView> : null}
  </View>;
}

const s = themed(() => ({
  reader: { flex: 1, flexDirection: 'row' },
  scroll: { paddingHorizontal: 22, paddingTop: 28, paddingBottom: 96 },
  column: { width: '100%', maxWidth: 740, alignSelf: 'center' },
  title: { fontFamily: F.b, fontSize: 31, lineHeight: 39, letterSpacing: -0.4 },
  path: { fontFamily: F.m, fontSize: 12.5, marginTop: 6, marginBottom: 18 },
  props: { borderBottomWidth: 1, paddingBottom: 14, marginBottom: 22, gap: 2 },
  propsTitle: { fontFamily: F.s, fontSize: 13, marginBottom: 6 },
  prop: { flexDirection: 'row', alignItems: 'flex-start', minHeight: 30, paddingVertical: 4, gap: 12 },
  propKey: { width: 112, fontFamily: F.m, fontSize: 14, lineHeight: 22 },
  propValue: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  propText: { fontFamily: F.r, fontSize: 14.5, lineHeight: 22 },
  botDot: { width: 10, height: 10, borderRadius: 5 },
  doc: { gap: 14 },
  body: { fontFamily: F.r, fontSize: 16.5, lineHeight: 27 },
  bold: { fontFamily: F.b }, italic: { fontStyle: 'italic' },
  code: { fontFamily: 'monospace', fontSize: 14.5, borderRadius: 4, paddingHorizontal: 4 },
  link: { fontFamily: F.m },
  headingWrap: { marginTop: 14 },
  heading: { fontFamily: F.b, letterSpacing: -0.2 },
  h1: { fontSize: 27, lineHeight: 35 }, h2: { fontSize: 23, lineHeight: 31 }, h3: { fontSize: 19.5, lineHeight: 27 }, h4: { fontSize: 17, lineHeight: 25 },
  list: { gap: 6 },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingLeft: 4 },
  marker: { minWidth: 18, fontFamily: F.b, fontSize: 16.5, lineHeight: 27, textAlign: 'center' },
  box: { width: 17, height: 17, borderRadius: 4, borderWidth: 1.5, marginTop: 5, alignItems: 'center', justifyContent: 'center' },
  tick: { color: '#ffffff', fontSize: 11, lineHeight: 13, fontFamily: F.b },
  quote: { borderLeftWidth: 3, paddingLeft: 16, paddingVertical: 2 },
  callout: { borderWidth: 1, borderRadius: 8, padding: 14, gap: 6 },
  calloutTitle: { fontFamily: F.b, fontSize: 15.5 },
  codeBlock: { borderRadius: 8, borderWidth: 1, padding: 14 },
  mono: { fontFamily: 'monospace', fontSize: 14, lineHeight: 21 },
  table: { borderWidth: 1, borderRadius: 6, overflow: 'hidden' },
  tr: { flexDirection: 'row', borderBottomWidth: 1 },
  td: { minWidth: 120, maxWidth: 280, padding: 9, borderRightWidth: 1 },
  cell: { fontFamily: F.r, fontSize: 14.5, lineHeight: 21 },
  rule: { height: 1, marginVertical: 10 },
  footer: { borderTopWidth: 1, marginTop: 40, paddingTop: 20, gap: 14 },
  side: { width: 330, flexGrow: 0, borderLeftWidth: 1 },
  sideTitle: { fontFamily: F.s, fontSize: 13 },
  local: { height: 280, borderWidth: 1, borderRadius: 8, overflow: 'hidden', position: 'relative' },
  mentions: { gap: 4 },
  mentionsHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  chevron: { width: 14, fontSize: 12 },
  mentionsTitle: { fontFamily: F.s, fontSize: 14, flex: 1 },
  count: { fontFamily: F.m, fontSize: 12, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 1, overflow: 'hidden' },
  mention: { paddingVertical: 7, paddingHorizontal: 20, borderRadius: 6, gap: 2 },
  mentionTitle: { fontFamily: F.s, fontSize: 14 },
  small: { fontFamily: F.m, fontSize: 12.5, lineHeight: 18 }
}));
