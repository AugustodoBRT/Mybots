import { messageMarkdown } from './message-cache';
import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Linking } from 'react-native';
import Svg, { Rect, Line, Polyline, Circle, Path, Text as SvgText } from 'react-native-svg';
import { parseBlocks, parseInline } from './markdown';
import { C, F, Icon, themed } from './theme';

// Bot replies: Markdown with tables and charts, drawn with the same reader the supervisor uses for files.
const chartColors = () => [C.sky, C.peach, C.accent, '#F58AB0', C.lilac, '#62CFD9'];
const number = value => Number.isInteger(value) ? String(value) : value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

function Inline({ text, style, cache }) {
  return <Text selectable style={style}>{(cache ? cache.runs(text) : parseInline(text)).map((run, index) => <Text key={index}
    style={[run.bold && s.bold, run.italic && s.italic, run.code && s.code, run.href && s.link]}
    onPress={run.href ? () => Linking.openURL(run.href).catch(() => {}) : undefined}>{run.text}</Text>)}</Text>;
}

function Table({ header, rows, cache }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator nestedScrollEnabled style={s.tableScroll}>
    <View style={s.table}>
      {[header, ...rows].map((row, r) => <View key={r} style={[s.row, r === 0 && s.headRow, r > 0 && r % 2 === 0 && s.stripe]}>
        {row.map((cell, c) => <View key={c} style={[s.cell, c === row.length - 1 && { borderRightWidth: 0 }]}><Inline cache={cache} text={cell} style={[s.cellText, r === 0 && s.bold]} /></View>)}
      </View>)}
    </View>
  </ScrollView>;
}

export function Chart({ spec }) {
  const [width, setWidth] = useState(280);
  const height = 190; const top = spec.title ? 26 : 8;
  const body = () => {
    if (spec.type === 'pie') {
      const values = spec.series[0].data.map(value => Math.max(0, value)); const total = values.reduce((a, b) => a + b, 0) || 1;
      const r = Math.min(70, (height - top) / 2 - 6), cx = r + 8, cy = top + (height - top) / 2; let angle = -Math.PI / 2;
      return values.map((value, index) => {
        const sweep = value / total * Math.PI * 2; const end = angle + sweep;
        const shape = sweep >= Math.PI * 2 - 1e-6 ? <Circle key={'s' + index} cx={cx} cy={cy} r={r} fill={chartColors()[index % chartColors().length]} />
          : <Path key={'s' + index} d={`M${cx},${cy} L${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)} A${r},${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${cx + r * Math.cos(end)},${cy + r * Math.sin(end)} Z`} fill={chartColors()[index % chartColors().length]} stroke="#1E2129" />;
        angle = end;
        return [shape, <Rect key={'k' + index} x={2 * r + 22} y={top + 6 + index * 18} width={10} height={10} fill={chartColors()[index % chartColors().length]} />,
          <SvgText key={'t' + index} x={2 * r + 37} y={top + 15 + index * 18} fill={C.text2} fontSize="11">{`${spec.labels[index].slice(0, 16)} · ${Math.round(value / total * 100)}%`}</SvgText>];
      });
    }
    const legend = spec.series.length > 1 || spec.series[0].name;
    const left = 34, right = width - 6, bottom = height - (legend ? 34 : 18), plot = bottom - top;
    const values = spec.series.flatMap(item => item.data); const max = Math.max(0, ...values), min = Math.min(0, ...values); const span = max - min || 1;
    const y = value => bottom - (value - min) / span * plot; const slot = (right - left) / spec.labels.length;
    const parts = [];
    for (let step = 0; step <= 4; step++) {
      const value = min + span * step / 4;
      parts.push(<Line key={'g' + step} x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="#3A3F4B" />,
        <SvgText key={'v' + step} x={left - 4} y={y(value) + 4} fill={C.muted} fontSize="9" textAnchor="end">{number(Math.round(value * 10) / 10)}</SvgText>);
    }
    spec.labels.forEach((label, index) => parts.push(<SvgText key={'l' + index} x={left + slot * (index + 0.5)} y={bottom + 12} fill={C.text2} fontSize="9" textAnchor="middle">{label.length > 9 ? label.slice(0, 8) + '…' : label}</SvgText>));
    spec.series.forEach((series, si) => {
      const color = chartColors()[si % chartColors().length];
      if (spec.type === 'bar') {
        const bar = slot * 0.7 / spec.series.length;
        series.data.forEach((value, index) => parts.push(<Rect key={`b${si}-${index}`} x={left + slot * index + slot * 0.15 + bar * si} y={Math.min(y(value), y(0))} width={bar} height={Math.abs(y(0) - y(value))} fill={color} rx={2} />));
      } else {
        const points = series.data.map((value, index) => [left + slot * (index + 0.5), y(value)]);
        parts.push(<Polyline key={'p' + si} points={points.map(point => point.join(',')).join(' ')} fill="none" stroke={color} strokeWidth={2.5} />,
          ...points.map(([px, py], index) => <Circle key={`c${si}-${index}`} cx={px} cy={py} r={3} fill={color} />));
      }
      if (legend) parts.push(<Rect key={'k' + si} x={left + si * 96} y={height - 12} width={10} height={10} fill={color} />,
        <SvgText key={'n' + si} x={left + 14 + si * 96} y={height - 3} fill={C.text2} fontSize="10">{(series.name || `Série ${si + 1}`).slice(0, 14)}</SvgText>);
    });
    return parts;
  };
  return <View style={s.chart} onLayout={event => setWidth(Math.max(200, Math.round(event.nativeEvent.layout.width)))}>
    <Svg width={width} height={height}>
      {spec.title ? <SvgText x={width / 2} y={15} fill={C.text} fontSize="12.5" fontWeight="bold" textAnchor="middle">{spec.title}</SvgText> : null}
      {body()}
    </Svg>
  </View>;
}

export function RichText({ id, text, textStyle }) {
  const cache = messageMarkdown(id, text);
  return <View style={s.rich}>{cache.blocks.map((block, index) => {
    if (block.type === 'heading') return <Inline cache={cache} key={index} text={block.text} style={[textStyle, s.heading, block.level === 1 && s.h1]} />;
    if (block.type === 'paragraph') return <Inline cache={cache} key={index} text={block.text} style={textStyle} />;
    // One Text per item: a flex row inside an auto-width bubble shrinks the words to a narrow column.
    if (block.type === 'list') return <View key={index} style={{ gap: 3 }}>{block.items.map((item, i) => <Text key={i} selectable style={textStyle}>
      <Text style={s.marker}>{block.ordered ? `${block.start + i}.` : '•'}  </Text><Inline cache={cache} text={item} /></Text>)}</View>;
    if (block.type === 'table') return <Table cache={cache} key={index} header={block.header} rows={block.rows} />;
    if (block.type === 'chart') return <Chart key={index} spec={block.spec} />;
    if (block.type === 'code') return <Text key={index} selectable style={s.codeBlock}>{block.text}</Text>;
    if (block.type === 'quote') return <Inline cache={cache} key={index} text={block.text} style={[textStyle, s.quote]} />;
    return <View key={index} style={s.rule} />;
  })}</View>;
}

const ICONS = { 'application/pdf': '📕', 'text/csv': '📊', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '📊', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '📘', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': '📙' };
export const fileIcon = mime => mime?.startsWith('image/') ? '🖼' : mime?.startsWith('audio/') ? '🎧' : ICONS[mime] || '📄';
export const formatSize = size => size >= 1048576 ? `${(size / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;

// A document glyph tinted by type, with the extension on it (PDF, DOCX, XLSX…).
const TYPES = [[/pdf/, 'PDF', '#FF7B7B'], [/wordprocessing|msword/, 'DOC', '#7FA8FF'], [/spreadsheet|csv|excel/, 'XLS', '#6FD9A2'], [/presentation|powerpoint/, 'PPT', '#FFAE6B'], [/^image\//, 'IMG', '#C2A5FF'], [/^text\/|markdown|json/, 'TXT', '#B9C2D0']];
export function FileBadge({ file, size = 44 }) {
  const ext = (/\.([a-z0-9]{1,4})$/i.exec(file.name || '')?.[1] || '').toUpperCase();
  const [, label, tint] = TYPES.find(([pattern]) => pattern.test(file.mime || '')) || [null, ext || 'ARQ', '#B9C2D0'];
  return <View style={[s.fileBadge, { width: size, height: size, backgroundColor: tint + '1A', borderColor: tint + '40' }]}>
    <Icon name="file" size={size * 0.46} color={tint} />
    <Text style={[s.fileExt, { color: tint }]}>{ext && ext.length <= 4 ? ext : label}</Text>
  </View>;
}

/** A file the person sent, or one waiting in the composer: just its type badge and name. */
export function FileChip({ file, busy, onPress, onRemove }) {
  const body = <><FileBadge file={file} size={34} /><Text style={s.chipName} numberOfLines={1}>{file.name}</Text>
    {busy ? <Text style={s.fileMeta}>…</Text> : null}
    {onRemove ? <Pressable accessibilityRole="button" accessibilityLabel={`Remover ${file.name}`} hitSlop={10} onPress={onRemove}><Icon name="close" size={15} color={C.muted} /></Pressable> : null}</>;
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={`Arquivo ${file.name}: abrir, compartilhar ou salvar`} disabled={busy} onPress={() => onPress(file)} style={({ pressed }) => [s.chip, pressed && { opacity: 0.7 }]}>{body}</Pressable>
    : <View style={s.chip}>{body}</View>;
}

/** A file in a message: tap to open, share or save it. */
export function FileCard({ file, busy, onPress }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Arquivo ${file.name}: abrir, compartilhar ou salvar`} disabled={busy} onPress={() => onPress(file)} style={({ pressed }) => [s.file, pressed && { opacity: 0.7 }]}>
    <FileBadge file={file} />
    <View style={{ flex: 1 }}>
      <Text style={s.fileName} numberOfLines={2}>{file.name}</Text>
      <Text style={s.fileMeta}>{formatSize(file.size)} · {busy ? 'preparando…' : 'abrir, compartilhar ou salvar'}</Text>
    </View>
    <Icon name="right" size={16} color={C.faint} />
  </Pressable>;
}

const s = themed(() => ({
  rich: { gap: 9 },
  bold: { fontFamily: F.b }, italic: { fontStyle: 'italic' }, link: { color: C.sky, textDecorationLine: 'underline' },
  code: { fontFamily: 'monospace', backgroundColor: C.text + '14', fontSize: 13.5 },
  heading: { fontFamily: F.x, fontSize: 16.5, letterSpacing: -0.3, marginTop: 2 }, h1: { fontSize: 19 }, marker: { color: C.accent, fontFamily: F.b },
  quote: { borderLeftWidth: 3, borderLeftColor: C.line2, paddingLeft: 10, color: C.text2, fontStyle: 'italic' },
  codeBlock: { fontFamily: 'monospace', fontSize: 12.5, lineHeight: 19, color: C.text, backgroundColor: C.bg2, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: C.line },
  rule: { height: 1, backgroundColor: C.line2, marginVertical: 4 },
  tableScroll: { flexGrow: 0 }, table: { borderWidth: 1, borderColor: C.line2, borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.line }, headRow: { backgroundColor: C.elevated, borderTopWidth: 0 }, stripe: { backgroundColor: C.text + '08' },
  cell: { minWidth: 76, maxWidth: 230, paddingHorizontal: 11, paddingVertical: 9, borderRightWidth: 1, borderRightColor: C.line },
  cellText: { color: C.text, fontFamily: F.r, fontSize: 13.5, lineHeight: 19 },
  chart: { alignSelf: 'stretch', minWidth: 220, backgroundColor: C.surface, borderRadius: 16, paddingVertical: 10, borderWidth: 1, borderColor: C.line },
  file: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 11, borderRadius: 18, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line2, minWidth: 230 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 9, alignSelf: 'flex-start', maxWidth: 260 },
  chipName: { color: C.text, fontFamily: F.s, fontSize: 13.5, flexShrink: 1 },
  fileBadge: { borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, gap: 0 },
  fileExt: { fontFamily: F.x, fontSize: 8.5, letterSpacing: 0.4, marginTop: -2 },
  fileIcon: { fontSize: 22 }, fileName: { color: C.text, fontFamily: F.b, fontSize: 13.5 }, fileMeta: { color: C.muted, fontFamily: F.m, fontSize: 11.5, marginTop: 2 }
}));
