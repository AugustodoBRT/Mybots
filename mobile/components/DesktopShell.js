import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, PanResponder, useWindowDimensions, Modal } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useStore } from '../state/useStore';
import { selectHome } from '../state/store';
import { CLAUDE_MARK, OPENAI_MARK, CLAUDE_COLOR } from '../brand';
import { C, Icon, F, themed } from '../theme';
import { desktopBus, native } from '../desktop';
import { Avatar, RoomFaces, IconButton, Notice, ApprovalCard, DesktopPair, greeting, botLine, latestOf, latestInRoom, plain, shortTime, findModel, offline } from './shared';
import { RoutinesSheet, NegotiationsSheet } from './Lists';
import FaceArt from '../FaceArt';
import { DesktopReveal } from './DesktopReveal';
import { SideHeader, SideMenu, SideFrame, BrowserCards, BrowserFull } from './DesktopSide';
import BotBrowserPanel, { ReturnCard } from '../BotBrowserPanel';
import { browserMode } from '../local';

const s = themed(() => ({
  desk: { flex: 1, flexDirection: 'row', backgroundColor: C.bg },
  rail: { width: 76, alignItems: 'center', paddingVertical: 10, gap: 3, borderRightWidth: 1, borderRightColor: C.line, backgroundColor: C.bg },
  railNarrow: { width: 52, gap: 6 },
  railItem: { width: 66, minHeight: 50, paddingVertical: 7, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 4 },
  railItemNarrow: { width: 36, minHeight: 36, height: 36, paddingVertical: 0, borderRadius: 11 },
  railText: { color: C.muted, fontFamily: F.m, fontSize: 10.5, letterSpacing: -0.1 },
  railOn: { backgroundColor: C.accent + '16' }, railHover: { backgroundColor: C.surface },
  dot: { position: 'absolute', top: 5, right: 18, width: 9, height: 9, borderRadius: 5, backgroundColor: C.accent, borderWidth: 2, borderColor: C.bg },
  dotNarrow: { top: 7, right: 7 },
  kbd: { minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 6, borderWidth: 1, borderColor: C.line2, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  kbdText: { color: C.muted, fontFamily: F.s, fontSize: 10.5 },
  paletteGroup: { color: C.faint, fontFamily: F.s, fontSize: 11, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 4 },
  paletteFoot: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 14, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.text + '05' },
  hintItem: { flexDirection: 'row', alignItems: 'center', gap: 5 }, hintText: { color: C.muted, fontFamily: F.m, fontSize: 12 },
  ringText: { color: C.muted, fontFamily: F.m, fontSize: 11, marginTop: 1 },
  list: { backgroundColor: C.bg2, borderRightWidth: 1, borderRightColor: C.line },
  listHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 10 },
  listTitle: { color: C.text, fontFamily: F.x, fontSize: 16, letterSpacing: -0.4 },
  find: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 12, marginBottom: 8, paddingLeft: 11, paddingRight: 7, height: 34, borderRadius: 10, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  findText: { flex: 1, color: C.faint, fontFamily: F.m, fontSize: 12 }, key: { color: C.faint, fontFamily: F.m, fontSize: 10 },
  section: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 },
  sectionText: { flex: 1, color: C.faint, fontFamily: F.s, fontSize: 11.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 10, marginHorizontal: 8, marginVertical: 1, borderRadius: 11, borderWidth: 1, borderColor: 'transparent' },
  rowOn: { backgroundColor: C.surface2, borderColor: C.line }, rowHover: { backgroundColor: C.surface },
  name: { color: C.text, fontFamily: F.s, fontSize: 13.5, flexShrink: 1 }, time: { marginLeft: 'auto', color: C.faint, fontFamily: F.m, fontSize: 10.5 },
  line: { color: C.muted, fontFamily: F.m, fontSize: 12 }, unread: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.accent },
  divider: { width: 6, marginLeft: -3, marginRight: -3, zIndex: 5, cursor: 'col-resize' },
  main: { flex: 1, minWidth: 0 },
  tabs: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 8, height: 38, borderBottomWidth: 1, borderBottomColor: C.line, backgroundColor: C.bg2 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: 190, paddingLeft: 10, paddingRight: 6, height: 28, borderRadius: 8 },
  tabOn: { backgroundColor: C.surface2 }, tabText: { color: C.muted, fontFamily: F.m, fontSize: 12, flexShrink: 1 }, tabTextOn: { color: C.text },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line },
  chipText: { color: C.text2, fontFamily: F.m, fontSize: 12.5 },
  tool: { height: 32, paddingHorizontal: 11, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  toolText: { color: C.text2, fontFamily: F.m, fontSize: 13 },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12 },
  optionTitle: { color: C.text, fontFamily: F.b, fontSize: 14.5 },
  optionNote: { color: C.muted, fontFamily: F.m, fontSize: 12.5, marginTop: 2 },
  badge: { minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
  badgeText: { color: '#000', fontFamily: F.x, fontSize: 10.5 },
  side: { flex: 1, borderLeftWidth: 1, borderLeftColor: C.line, backgroundColor: C.bg2 },
  sideTitle: { color: C.text, fontFamily: F.x, fontSize: 16, letterSpacing: -0.4 },
  group: { color: C.text2, fontFamily: F.b, fontSize: 14, marginTop: 18, marginBottom: 6 },
  welcome: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 6 },
  hi: { color: C.text, fontFamily: F.x, fontSize: 34, letterSpacing: -1.1, marginTop: 10 },
  sum: { color: C.muted, fontFamily: F.m, fontSize: 17, marginBottom: 14 },
  acts: { flexDirection: 'row', gap: 8, marginTop: 18, flexWrap: 'wrap', justifyContent: 'center' },
  act: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: C.line2, backgroundColor: C.surface },
  actMain: { backgroundColor: C.accent, borderColor: C.accent }, actHover: { backgroundColor: C.surface2 },
  actText: { color: C.text, fontFamily: F.s, fontSize: 13.5 },
  scrim: { flex: 1, backgroundColor: '#000000A0', alignItems: 'center', paddingTop: 110 },
  palette: { width: 600, maxWidth: '92%', borderRadius: 16, backgroundColor: C.elevated, borderWidth: 1, borderColor: C.line2, overflow: 'hidden', boxShadow: '0 24px 70px rgba(0,0,0,0.45)' },
  paletteHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: C.line },
  paletteInput: { flex: 1, color: C.text, fontFamily: F.m, fontSize: 15.5, paddingVertical: 15 },
  paletteRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 7, paddingHorizontal: 10, marginHorizontal: 8, borderRadius: 10, borderWidth: 1, borderColor: 'transparent' },
  paletteFace: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  hints: { color: C.faint, fontFamily: F.m, fontSize: 12.5, padding: 12, borderTopWidth: 1, borderTopColor: C.line },
  menu: { position: 'absolute', minWidth: 190, paddingVertical: 6, borderRadius: 12, backgroundColor: C.elevated, borderWidth: 1, borderColor: C.line2 },
  menuItem: { paddingVertical: 9, paddingHorizontal: 16 }, menuText: { color: C.text, fontFamily: F.m, fontSize: 14 }
}));

// Quiet plan meters: remaining capacity, always labeled for assistive technology.
/** What is left of an IA's subscription: the 5-hour window and the week, each with its own bar (the week is hidden when the IA does not report it). */
function AiMark({ provider, left, week = null, compact = false }) {
  const name = provider === 'claude' ? 'Claude' : 'Codex';
  const bar = (value, label, spoken) => { const shown = Math.max(0, Math.min(100, value)); return <View key={label} accessible accessibilityRole="image" accessibilityLabel={`${name}, ${spoken}: ${Math.round(shown)}% livre`} style={{ gap: 3 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <Text style={{ color: C.faint, fontFamily: F.m, fontSize: compact ? 8 : 9, flex: compact ? undefined : 1 }}>{label}</Text>
      <Text style={{ color: C.text2, fontFamily: F.s, fontSize: compact ? 9 : 10 }}>{Math.round(shown)}%</Text>
    </View>
    <View style={{ height: 3, borderRadius: 2, backgroundColor: C.line2, overflow: 'hidden', minWidth: 22 }}>
      <View style={{ height: 3, borderRadius: 2, width: `${shown}%`, backgroundColor: shown < 15 ? C.red : C.accent }} />
    </View></View>; };
  return <View style={{ flex: compact ? undefined : 1, gap: 6, padding: compact ? 4 : 10, borderRadius: 10, backgroundColor: compact ? 'transparent' : C.surface, minWidth: 0 }}>
    <View style={{ flexDirection: compact ? 'column' : 'row', alignItems: 'center', gap: 7 }}>
      <Svg width={17} height={17} viewBox="0 0 25 25"><Path d={provider === 'claude' ? CLAUDE_MARK : OPENAI_MARK} fill={provider === 'claude' ? CLAUDE_COLOR : C.text2} /></Svg>
      {!compact ? <Text style={{ color: C.muted, fontFamily: F.m, fontSize: 10, flex: 1 }}>{name}</Text> : null}
    </View>
    {bar(left, compact ? '5h' : '5 h', '5 horas')}{week != null ? bar(week, compact ? 'Sem' : 'Semana', 'semana') : null}
  </View>;
}

/** A key on the keyboard, drawn as a small cap. */
function Kbd({ children }) { return <View style={s.kbd}><Text style={s.kbdText}>{children}</Text></View>; }

// The window's own look at "who is doing what": a face, a name, a line, the time and a dot for what is unread.
function Row({ face, title, line, tone, time, selected, onPress, onMenu, label, compact, unread }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} onContextMenu={event => { event?.preventDefault?.(); onMenu?.(event.nativeEvent || event); }}
    style={({ hovered }) => [s.row, compact && { justifyContent: 'center', paddingHorizontal: 0 }, hovered && s.rowHover, selected && s.rowOn]}>
    {face}
    {compact ? null : <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}><Text style={[s.name, unread && { fontFamily: F.b }]} numberOfLines={1}>{title}</Text><Text style={[s.time, unread && { color: C.accent }]}>{time}</Text></View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Text style={[s.line, { flex: 1 }, unread && { color: C.text2 }, tone && { color: tone }]} numberOfLines={1}>{line}</Text>{unread ? <View accessibilityLabel="Mensagem nova" style={s.unread} /> : null}</View></View>}
  </Pressable>;
}

function Palette({ visible, onClose, bots, rooms, onOpen, onRoom, onSearch, onCreate }) {
  const [query, setQuery] = useState(''); const [index, setIndex] = useState(0);
  useEffect(() => { if (visible) { setQuery(''); setIndex(0); } }, [visible]);
  const needle = query.trim().toLowerCase();
  const boxed = icon => <View style={s.paletteFace}>{icon}</View>;
  const items = [...bots.filter(bot => !needle || bot.name.toLowerCase().includes(needle)).map(bot => ({ key: 'b' + bot.id, group: 'Bots', label: bot.name, note: bot.isChief ? 'Chefe' : '', face: <Avatar bot={bot} size={30} animated={false} />, go: () => onOpen(bot.id) })),
    ...rooms.filter(room => !needle || room.name.toLowerCase().includes(needle)).map(room => ({ key: 'r' + room.id, group: 'Salas', label: room.name, note: `${room.botIds?.length || 0} bots`, face: boxed(<Icon name="bots" size={19} color={C.muted} />), go: () => onRoom(room.id) })),
    ...(needle ? [{ key: 'search', group: 'Ações', label: `Buscar “${query.trim()}” nas conversas`, face: boxed(<Icon name="search" size={18} color={C.muted} />), go: onSearch }] : [{ key: 'new', group: 'Ações', label: 'Novo bot', keys: ['Ctrl', 'N'], face: boxed(<Icon name="plus" size={18} color={C.accent} />), go: onCreate }])];
  const pick = item => { onClose(); item?.go?.(); };
  const hint = (keys, text) => <View style={s.hintItem}>{keys.map(key => <Kbd key={key}>{key}</Kbd>)}<Text style={s.hintText}>{text}</Text></View>;
  return <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
    <Pressable style={s.scrim} onPress={onClose}><Pressable style={s.palette} onPress={() => {}}>
      <View style={s.paletteHead}><Icon name="search" size={18} color={C.muted} />
      <TextInput autoFocus accessibilityLabel="Buscar e trocar de bot" value={query} onChangeText={value => { setQuery(value); setIndex(0); }} placeholder="Buscar bot ou sala" placeholderTextColor={C.faint} style={s.paletteInput} selectionColor={C.accent}
        onKeyPress={event => { const key = event.nativeEvent.key; if (key === 'ArrowDown') { event.preventDefault?.(); setIndex(value => Math.min(items.length - 1, value + 1)); } else if (key === 'ArrowUp') { event.preventDefault?.(); setIndex(value => Math.max(0, value - 1)); } else if (key === 'Enter') pick(items[index]); else if (key === 'Escape') onClose(); }} />
        <Kbd>Esc</Kbd></View>
      <ScrollView style={{ maxHeight: 430 }} contentContainerStyle={{ paddingBottom: 8 }}>{items.map((item, position) => <View key={item.key}>
        {position === 0 || items[position - 1].group !== item.group ? <Text style={s.paletteGroup}>{item.group}</Text> : null}
        <Pressable accessibilityRole="button" onPress={() => pick(item)} onHoverIn={() => setIndex(position)} style={[s.paletteRow, position === index && s.rowOn]}>{item.face}<Text style={[s.name, { flex: 1 }]} numberOfLines={1}>{item.label}</Text>
          {item.note ? <Text style={s.line}>{item.note}</Text> : null}{item.keys ? <View style={{ flexDirection: 'row', gap: 4 }}>{item.keys.map(key => <Kbd key={key}>{key}</Kbd>)}</View> : null}
          {position === index && !item.keys ? <Kbd>Enter</Kbd> : null}</Pressable></View>)}
        {!items.length ? <Text style={[s.line, { padding: 18 }]}>Nada encontrado.</Text> : null}</ScrollView>
      <View style={s.paletteFoot}>{hint(['↑', '↓'], 'escolher')}{hint(['Enter'], 'abrir')}{hint(['Esc'], 'fechar')}{hint(['Ctrl', 'N'], 'novo bot')}</View>
    </Pressable></Pressable>
  </Modal>;
}

function Help({ visible, onClose }) {
  const keys = [[['Ctrl', 'K'], 'Buscar e trocar de bot ou sala'], [['Ctrl', 'N'], 'Criar um bot'], [['Enter'], 'Enviar a mensagem'], [['Shift', 'Enter'], 'Quebrar a linha na mensagem'], [['Esc'], 'Fechar a janela ou o painel aberto'], [['Botão direito'], 'Menu do bot ou da mensagem']];
  return <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
    <Pressable style={s.scrim} onPress={onClose}><Pressable style={[s.palette, { width: 480 }]} onPress={() => {}}>
      <View style={[s.paletteHead, { paddingVertical: 12, paddingRight: 10 }]}><Text style={[s.sideTitle, { flex: 1 }]}>Atalhos do teclado</Text><IconButton icon="close" label="Fechar os atalhos" onPress={onClose} size={30} /></View>
      <View style={{ paddingHorizontal: 18, paddingVertical: 8 }}>{keys.map(([combo, text], position) => <View key={text} style={[{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10 }, position > 0 && { borderTopWidth: 1, borderTopColor: C.line }]}>
        <Text style={[s.line, { flex: 1, fontSize: 13.5, color: C.text2 }]}>{text}</Text><View style={{ flexDirection: 'row', gap: 4 }}>{combo.map(key => <Kbd key={key}>{key}</Kbd>)}</View></View>)}</View>
    </Pressable></Pressable>
  </Modal>;
}

// What waits for the person today (approvals first), then the next deadlines and routines and what the bots did.
function TodayPanel({ data, onOpen, onRespond, approvalBusy, onComplete, onActivity }) {
  const name = id => data.bots?.find(bot => bot.id === id)?.name || '';
  const items = (data.pendingItems || []).filter(item => item.state === 'open').sort((a, b) => (a.due || '9').localeCompare(b.due || '9')).slice(0, 8);
  const routines = (data.routines || []).filter(item => item.enabled && item.nextRunAt).sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt)).slice(0, 4);
  const activity = (data.activity || []).filter(item => name(item.bot_id) && !/^task_(queued|running|done|waiting_approval)$/.test(item.kind)).slice(0, 8);
  return <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: 30 }}>
      <Text style={s.group}>Esperando você</Text>
      {(data.approvals || []).length ? data.approvals.map(approval => <ApprovalCard key={approval.id} approval={approval} bot={data.bots.find(bot => bot.id === approval.botId)} onRespond={onRespond} busy={approvalBusy === approval.id} />) : <Text style={s.line}>Nenhuma decisão agora.</Text>}
      <Text style={s.group}>Pendências</Text>
      {items.length ? items.map(item => <View key={item.id} style={{ flexDirection: 'row', gap: 10, paddingVertical: 7 }}>
        <Pressable accessibilityRole="checkbox" accessibilityLabel={`Concluir ${item.title}`} onPress={() => onComplete(item.id)} hitSlop={6} style={{ width: 20, height: 20, borderRadius: 6, borderWidth: 2, borderColor: C.line2 }} />
        <Pressable style={{ flex: 1 }} onPress={() => onOpen(item.botId)}><Text style={[s.name, { fontFamily: F.m, fontSize: 14 }]} numberOfLines={2}>{item.course ? `${item.course} · ` : ''}{item.title}</Text>
          <Text style={s.line} numberOfLines={1}>{[item.dueLabel && `prazo ${item.dueLabel}`, name(item.botId)].filter(Boolean).join(' · ')}</Text></Pressable></View>) : <Text style={s.line}>Nenhuma pendência aberta.</Text>}
      <Text style={s.group}>Próximas rotinas</Text>
      {routines.length ? routines.map(item => <Pressable key={item.id} onPress={() => onOpen(item.botId)} style={{ paddingVertical: 6 }}><Text style={[s.name, { fontFamily: F.m, fontSize: 14 }]} numberOfLines={1}>{item.title}</Text>
        <Text style={s.line}>{new Date(item.nextRunAt).toLocaleString('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })} · {name(item.botId)}</Text></Pressable>) : <Text style={s.line}>Nenhuma rotina marcada.</Text>}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><Text style={s.group}>O que os bots fizeram</Text><Pressable onPress={onActivity} hitSlop={8}><Text style={[s.line, { color: C.accent }]}>Ver tudo</Text></Pressable></View>
      {activity.map(item => <View key={item.id} style={{ paddingVertical: 5 }}><Text style={s.line}>{shortTime(item.created_at)} · {name(item.bot_id)}</Text><Text style={[s.name, { fontFamily: F.m, fontSize: 13.5 }]} numberOfLines={2}>{item.detail}</Text></View>)}
  </ScrollView>;
}

// Nothing open yet: the busiest bot's big face, how the day looks and the decision that waits, as a plain block.
function Welcome({ onCreateChief, data, error, onRespond, approvalBusy, onCreate, onNewRoom, onSearch, onConnection, call }) {
  const bots = (data.bots || []).filter(bot => !bot.deletedAt);
  const working = (data.active || []).filter(id => !offline(data, id));
  const star = bots.find(bot => working.includes(bot.id)) || [...bots].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const waiting = (data.approvals || []).length;
  const sum = bots.length ? [working.length ? `${working.length} trabalhando.` : '', waiting ? `${waiting} ${waiting > 1 ? 'esperam' : 'espera'} você.` : '', !working.length && !waiting ? 'Tudo em dia.' : ''].filter(Boolean).join(' ') : 'Seu pequeno time pessoal começa aqui.';
  return <ScrollView contentContainerStyle={s.welcome}>
    {star ? <FaceArt bot={star} size={330} state={waiting && data.approvals.some(item => item.botId === star.id) ? 'waiting' : working.includes(star.id) ? 'working' : 'idle'} animated /> : <Avatar bot={{ name: 'MyBots' }} size={200} />}
    <Text style={s.hi}>{greeting()}{data.person?.name ? `, ${data.person.name}` : ''}.</Text>
    <Text style={s.sum}>{sum}</Text>
    {error ? <Notice text={error} onRetry={onConnection} /> : null}
    {error && !bots.length ? <DesktopPair call={call} /> : null}
    <View style={{ width: '100%', maxWidth: 560 }}>{(data.approvals || []).map(approval => <ApprovalCard key={approval.id} approval={approval} bot={bots.find(bot => bot.id === approval.botId)} onRespond={onRespond} busy={approvalBusy === approval.id} />)}</View>
    <View style={s.acts}>
      {onCreateChief ? <Pressable accessibilityRole="button" onPress={onCreateChief} disabled={!data.models?.length} style={({ hovered }) => [s.act, s.actMain, hovered && { opacity: 0.9 }, !data.models?.length && { opacity: 0.5 }]}><Icon name="spark" size={16} color={C.accentInk} /><Text style={[s.actText, { color: C.accentInk }]}>Crie o seu Chefe</Text></Pressable> : null}
      <Pressable accessibilityRole="button" onPress={onCreate} disabled={!data.models?.length} style={({ hovered }) => [s.act, !onCreateChief && !bots.length && s.actMain, hovered && (!onCreateChief && !bots.length ? { opacity: 0.9 } : s.actHover), !data.models?.length && { opacity: 0.5 }]}><Icon name="plus" size={16} color={!onCreateChief && !bots.length ? C.accentInk : C.accent} /><Text style={[s.actText, !onCreateChief && !bots.length && { color: C.accentInk }]}>Novo bot</Text></Pressable>
      {bots.length >= 2 ? <Pressable accessibilityRole="button" onPress={onNewRoom} style={({ hovered }) => [s.act, hovered && s.actHover]}><Icon name="bots" size={16} color={C.muted} /><Text style={s.actText}>Nova sala</Text></Pressable> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Buscar (Ctrl+K)" onPress={onSearch} style={({ hovered }) => [s.act, { paddingRight: 10 }, hovered && s.actHover]}><Icon name="search" size={16} color={C.muted} /><Text style={s.actText}>Buscar</Text><View style={{ flexDirection: 'row', gap: 3, marginLeft: 4 }}><Kbd>Ctrl</Kbd><Kbd>K</Kbd></View></Pressable>
    </View>
  </ScrollView>;
}

/**
 * The computer's window: a narrow bar of icons, the list of conversations (one line each), the open conversation in the middle
 * with tabs on top, and a side panel that stays closed until asked. Ctrl+K searches, Ctrl+N creates a bot, Esc closes.
 */
export function DesktopShell({ team, onTeam, onCreateChief, data: fallback, error, selected, roomId, onOpen, onRoom, onHome, onCreate, onNewRoom, onProfile, onActivity, onMaintenance, onSearch, onRespond, approvalBusy, onComplete, onConnection, call, page = null, onPage, pages = {}, filePanel, fileOpen, onFileClose, profilePanel, profileOpen, fileKey, onProfileClose, onBrowserControl, onSend, onFile, children }) {
  const data = useStore(selectHome) || fallback;
  const { width } = useWindowDimensions(); const [collapsed, setCollapsed] = useState(false); const compact = width < 900 || collapsed;
  const [listWidth, setListWidth] = useState(264); const [palette, setPalette] = useState(false); const [help, setHelp] = useState(false);
  const [menu, setMenu] = useState(null);
  // The right bar: tabs of what is open in it (browser, agent settings, today, a file), always inside the bar.
  const [side, setSide] = useState({ open: false, tabs: [], active: null }); const [wide, setWide] = useState(false); const [full, setFull] = useState(false);
  const openKind = kind => setSide(old => ({ open: true, tabs: old.tabs.includes(kind) ? old.tabs : [...old.tabs, kind], active: kind }));
  // A tab the app closed by itself (file, profile) takes the bar with it when it was the last one.
  const dropKind = (kind, quiet) => setSide(old => { const rest = old.tabs.filter(item => item !== kind); return { open: quiet && !rest.length ? false : old.open, tabs: rest, active: old.active === kind ? rest[rest.length - 1] || null : old.active }; });
  const closeKind = kind => { if (kind === 'settings') onProfileClose?.(); else if (kind === 'file') onFileClose?.(); else if (kind === 'browser') setFull(false); dropKind(kind); };
  const [rooms, setRooms] = useState(true); const [tabs, setTabs] = useState([]);
  const bots = useMemo(() => [...(data.bots || [])].filter(bot => !bot.deletedAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [data.bots]);
  const roomList = data.rooms || [];
  const current = selected ? { kind: 'bot', id: selected } : roomId ? { kind: 'room', id: roomId } : null;
  // One tab per conversation opened.
  useEffect(() => {
    if (!current || (current.kind === 'bot' && bots.find(item => item.id === current.id)?.isChief)) return;
    setTabs(old => (old.some(tab => tab.kind === current.kind && tab.id === current.id) ? old : [...old, current].slice(-8)));
  }, [selected, roomId]);
  const go = target => (target ? (target.kind === 'room' ? onRoom(target.id) : onOpen(target.id)) : onHome?.());
  const closeTab = tab => { const rest = tabs.filter(item => !(item.kind === tab.kind && item.id === tab.id)); setTabs(rest); if (current && current.kind === tab.kind && current.id === tab.id) go(rest[rest.length - 1] || null); };
  const keepBar = useRef(false);
  useEffect(() => { if (profileOpen) openKind('settings'); else dropKind('settings', !keepBar.current); }, [profileOpen]);
  // The bar belongs to the conversation it was opened for: going to another bot or room brings back its start screen
  // (the agent's settings and the open file were the other one's), and on pages without a conversation the bar is not shown.
  const currentKey = current ? current.kind + current.id : '';
  const lastKey = useRef(currentKey);
  useEffect(() => {
    if (lastKey.current === currentKey) return;
    lastKey.current = currentKey;
    keepBar.current = true; setTimeout(() => { keepBar.current = false; }, 400);
    if (profileOpen) onProfileClose?.();
    if (fileOpen) onFileClose?.();
    setFull(false);
    setSide(old => ({ ...old, tabs: old.tabs.filter(kind => kind !== 'settings' && kind !== 'file'), active: null }));
  }, [currentKey]);
  useEffect(() => { if (fileOpen) openKind('file'); else dropKind('file', !keepBar.current); }, [fileOpen, fileKey]);
  useEffect(() => desktopBus.on('browser-open', () => openKind('browser')), []);
  const browserTab = side.open && side.tabs.includes('browser') && side.active === 'browser';
  useEffect(() => { if (selected) desktopBus.emit('browser-state', { botId: selected, open: browserTab }); }, [browserTab, selected]);
  useEffect(() => { if (!browserTab) setFull(false); }, [browserTab]);
  // Keyboard: Ctrl+K searches, Ctrl+N creates a bot, Esc closes what is open.
  useEffect(() => {
    const listen = event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPalette(true); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); onCreate(); }
      else if (event.key === 'Escape' && !event.defaultPrevented) {
        if (palette) setPalette(false);
        else if (menu) setMenu(null);
        else if (help) setHelp(false);
        else if (full) setFull(false);
        else if (fileOpen) { onFileClose?.(); setSide(old => ({ ...old, open: false })); }
        else if (side.open) setSide(old => ({ ...old, open: false }));
      }
    };
    globalThis.addEventListener?.('keydown', listen); return () => globalThis.removeEventListener?.('keydown', listen);
  }, [onCreate, onFileClose, full, palette, menu, help, fileOpen, side.open, page]);
  const divider = useMemo(() => { let start = 264; return PanResponder.create({ onStartShouldSetPanResponder: () => true, onPanResponderGrant: () => { start = listWidthRef.current; },
    onPanResponderMove: (_, gesture) => setListWidth(Math.max(220, Math.min(360, start + gesture.dx))) }); }, []);
  const listWidthRef = useRef(264); listWidthRef.current = listWidth;
  const bot = selected ? bots.find(item => item.id === selected) : null; const chiefHome = Boolean(bot?.isChief); const room = roomId ? roomList.find(item => item.id === roomId) : null;
  const model = bot ? findModel(data.models || [], bot.model ? bot : data.defaultSelection)?.displayName : null;
  const phoneOnline = !error && data.supervisorConnected !== false; const waiting = (data.approvals || []).length;
  const windowsOf = provider => data.usage?.limits?.[provider]?.windows || [];
  const left = (provider, key) => { const window = windowsOf(provider).find(item => item.key === key); return window ? 100 - window.used : null; };
  // The 5-hour window first (the first window the IA reports when it has no 5-hour one), and the week next to it.
  const limit = provider => left(provider, 'five_hour') ?? (windowsOf(provider)[0] ? 100 - windowsOf(provider)[0].used : null);
  const weekLimit = provider => left(provider, 'five_hour') == null ? null : left(provider, 'week');
  const openPage = key => onPage(key);
  const hasChief = bots.some(item => item.isChief);
  const rail = [['spark', hasChief ? 'Início' : 'Conversas', hasChief || team ? onHome : () => onPage(null), !page && !team], ['bots', 'Equipe', onTeam, !page && team], ['memory', 'Memória', () => openPage('memory'), page === 'memory'], ['canvas', 'Canvas', () => openPage('canvas'), page === 'canvas'], ['activity', 'Atividade', () => openPage('activity'), page === 'activity', waiting > 0 && page !== 'activity'], ['bolt', 'Rotinas', () => openPage('routines'), page === 'routines'], ['hand', 'Negociações', () => openPage('negotiations'), page === 'negotiations']];
  // The icon bar names each place under its icon; a narrow window keeps only the icons.
  const narrow = width < 900;
  const railButton = (icon, label, shown, onPress, on, dot) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: Boolean(on) }} onPress={onPress} style={({ hovered }) => [s.railItem, narrow && s.railItemNarrow, hovered && s.railHover, on && s.railOn]}>
    <Icon name={icon} size={20} color={on ? C.accent : C.muted} />{narrow ? null : <Text style={[s.railText, on && { color: C.text, fontFamily: F.s }]} numberOfLines={1}>{shown}</Text>}{dot ? <View style={[s.dot, narrow && s.dotNarrow]} /> : null}</Pressable>;
  const nameOf = tab => (tab.kind === 'room' ? roomList.find(item => item.id === tab.id)?.name : bots.find(item => item.id === tab.id)?.name) || '…';
  const faceOf = tab => tab.kind === 'room' ? <Icon name="bots" size={16} color={C.muted} /> : <Avatar bot={bots.find(item => item.id === tab.id) || { name: '?' }} size={20} animated={false} />;
  return <View style={s.desk}>
    <View style={[s.rail, narrow && s.railNarrow]}>
      {rail.map(([icon, label, onPress, on, dot]) => railButton(icon, label, label === 'Negociações' ? 'Negócios' : label, onPress, on, dot))}
      <View style={{ flex: 1 }} />
      {page || compact ? <>{limit('claude') != null ? <AiMark compact provider="claude" left={limit('claude')} week={weekLimit('claude')} /> : null}{limit('codex') != null ? <AiMark compact provider="codex" left={limit('codex')} week={weekLimit('codex')} /> : null}</> : null}
      {railButton('info', 'Ajuda e atalhos', 'Ajuda', () => setHelp(true), false, false)}
      {railButton('settings', 'Ajustes', 'Ajustes', () => openPage('settings'), page === 'settings', false)}
    </View>
    {page ? <View style={{ flex: 1, minWidth: 0 }}>{page === 'routines' ? <RoutinesSheet inline routines={data.routines || []} bots={data.bots || []} onOpen={onProfile} />
      : page === 'negotiations' ? <NegotiationsSheet inline negotiations={data.negotiations || []} bots={data.bots || []} onOpen={onProfile} /> : pages[page] || null}</View> : <>
    <View style={[s.list, { display: chiefHome || (fileOpen && width < 900) ? 'none' : 'flex', width: compact ? 60 : listWidth, transitionProperty: 'width', transitionDuration: '240ms' }]}>
      {compact ? <View style={{ alignItems: 'center', paddingVertical: 12 }}><IconButton icon="plus" label="Novo bot" onPress={onCreate} size={38} tint={C.accent} /></View> : <>
        <View style={s.listHead}><Text style={s.listTitle}>Conversas</Text><View style={{ flexDirection: 'row', gap: 6 }}><IconButton icon="plus" label="Novo bot (Ctrl+N)" onPress={onCreate} size={34} tint={C.accent} /></View></View>
        <Pressable accessibilityRole="search" accessibilityLabel="Buscar bot ou sala (Ctrl+K)" onPress={() => setPalette(true)} style={s.find}><Icon name="search" size={15} color={C.faint} /><Text style={s.findText} numberOfLines={1}>Buscar bot ou sala</Text><View style={{ flexDirection: 'row', gap: 3 }}><Kbd>Ctrl</Kbd><Kbd>K</Kbd></View></Pressable></>}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }}>
        {roomList.length || bots.length >= 2 ? <>
          {compact ? null : <Pressable accessibilityRole="button" accessibilityState={{ expanded: rooms }} onPress={() => setRooms(value => !value)} style={s.section}><Icon name={rooms ? 'down' : 'right'} size={14} color={C.muted} /><Text style={s.sectionText}>Salas</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Nova sala" disabled={bots.length < 2} onPress={onNewRoom} hitSlop={8}><Icon name="plus" size={15} color={C.muted} /></Pressable></Pressable>}
          {rooms || compact ? roomList.map(item => { const members = item.botIds.map(id => bots.find(entry => entry.id === id)).filter(Boolean); const latest = latestInRoom(item); const working = members.filter(entry => item.active?.includes(entry.id));
            const who = latest?.role === 'user' ? 'Você' : members.find(entry => entry.id === latest?.botId)?.name;
            return <Row key={item.id} compact={compact} selected={item.id === roomId} label={`Abrir a sala ${item.name}`} onPress={() => onRoom(item.id)} face={<RoomFaces bots={members} size={30} />} title={item.name} time={latest ? shortTime(latest.createdAt) : ''}
              line={working.length ? `${working.map(entry => entry.name).join(', ')} respondendo` : latest ? `${who || 'Bot'}: ${plain(latest.text)}` : members.map(entry => entry.name).join(', ')} tone={working.length ? C.accent : null} />; }) : null}
        </> : null}
        {compact ? null : <View style={s.section}><Text style={s.sectionText}>Bots</Text></View>}
        {bots.filter(item => !item.isChief).map(item => { const line = botLine(item, data); return <Row key={item.id} compact={compact} selected={item.id === selected} label={`Conversar com ${item.name}`} onPress={() => onOpen(item.id)}
          onMenu={event => setMenu({ x: event.clientX || 0, y: event.clientY || 0, bot: item })} face={<Avatar bot={item} size={32} state={line.state} animated={line.state !== 'idle'} />}
          title={item.isChief ? item.name + ' · Chefe' : item.name} time={latestOf(item) ? shortTime(item.updatedAt) : ''} line={line.text} tone={line.tone} unread={item.unread > 0} />; })}
        {!bots.filter(item => !item.isChief).length && !compact ? <Text style={[s.line, { padding: 16 }]}>Nenhum bot ainda. Crie o primeiro com o + acima.</Text> : null}
      </ScrollView>
      {!compact && (limit('claude') != null || limit('codex') != null) ? <View style={{ padding: 12, gap: 8 }}><Text style={{ color: C.faint, fontSize: 11.5, fontFamily: F.s }}>Capacidade disponível</Text><View style={{ flexDirection: 'row', gap: 6 }}>{['claude', 'codex'].map(provider => limit(provider) != null ? <AiMark key={provider} provider={provider} left={limit(provider)} week={weekLimit(provider)} /> : null)}</View></View> : null}
      {compact ? null : <Pressable accessibilityRole="button" onPress={onConnection} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, borderTopWidth: 1, borderTopColor: C.line }}>
        <View style={[{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.faint }, phoneOnline && { backgroundColor: C.good }]} /><Text style={s.line}>{data.source === 'local' ? (!phoneOnline ? 'Iniciando o MyBots do computador…' : data.sync ? (data.sync.state === 'syncing' ? 'Sincronizando com o celular…' : data.sync.online ? 'Sincronizado com o celular' : 'Celular fora de alcance · só neste computador') : 'Só neste computador') : phoneOnline ? 'Celular conectado' : 'Celular fora de alcance'}</Text></Pressable>}
    </View>
    {compact || chiefHome ? null : <View accessibilityRole="adjustable" accessibilityLabel="Arrastar para mudar a largura da lista" style={s.divider} {...divider.panHandlers} />}
    <View style={[s.main, fileOpen && width < 760 && { display: 'none' }]}>
      {current ? <View style={s.tabs}>
        {chiefHome ? null : <IconButton icon="sidebar" label={collapsed ? "Expandir conversas" : "Recolher conversas"} onPress={() => setCollapsed(value => !value)} size={28} />}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ gap: 2, alignItems: 'center', paddingHorizontal: 6 }}>
          {tabs.map(tab => { const on = current.kind === tab.kind && current.id === tab.id; return <Pressable key={tab.kind + tab.id} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => go(tab)} style={({ hovered }) => [s.tab, hovered && s.rowHover, on && s.tabOn]}>
            {faceOf(tab)}<Text style={[s.tabText, on && s.tabTextOn]} numberOfLines={1}>{nameOf(tab)}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`Fechar a aba de ${nameOf(tab)}`} onPress={() => closeTab(tab)} hitSlop={6}><Icon name="close" size={13} color={C.faint} /></Pressable></Pressable>; })}
        </ScrollView>
        <Pressable accessibilityRole="button" accessibilityLabel="Barra lateral" accessibilityState={{ expanded: side.open }} onPress={() => setSide(old => ({ ...old, open: !old.open }))} style={({ hovered }) => [s.tool, hovered && s.rowHover, side.open && s.tabOn]}>
          <Icon name="sidebar" size={18} color={waiting && !side.open ? C.accent : C.text2} />{waiting ? <View style={s.badge}><Text style={s.badgeText}>{waiting}</Text></View> : null}</Pressable>
      </View> : null}
      <View style={{ flex: 1 }}>{current || team ? children : <Welcome onCreateChief={onCreateChief} data={data} error={error} onRespond={onRespond} approvalBusy={approvalBusy} onCreate={onCreate} onNewRoom={onNewRoom} onSearch={() => setPalette(true)} onConnection={onConnection} call={call} />}</View>
    </View>
    </>}
    <DesktopReveal open={side.open && Boolean(current) && !team && (!page || (page === 'canvas' && side.active === 'file'))} width={width < 760 ? width - 52 : wide ? Math.min(900, Math.max(420, width * 0.56)) : Math.min(480, Math.max(340, width * 0.32))}>
      <SideFrame>
        <SideHeader tabs={side.tabs} active={side.active} onPick={kind => setSide(old => ({ ...old, active: kind }))} onClose={closeKind} onNew={() => setSide(old => ({ ...old, active: null }))} wide={wide} onWide={() => setWide(value => !value)} onHide={() => setSide(old => ({ ...old, open: false }))} badge={waiting} />
        {side.active === 'settings' ? profilePanel
          : side.active === 'file' ? filePanel
          : side.active === 'today' ? <TodayPanel data={data} onOpen={id => onOpen(id)} onRespond={onRespond} approvalBusy={approvalBusy} onComplete={onComplete} onActivity={() => openPage('activity')} />
          : side.active === 'browser' ? (native ? <>{bot && data.browser?.control?.[bot.id] === 'person' ? <View style={{ padding: 12 }}><ReturnCard bot={bot} onReturn={() => onBrowserControl(bot.id, 'bot')} /></View> : null}
            <BrowserCards onOpen={() => setFull(true)} /></> : !bot ? <Text style={[s.line, { padding: 24, textAlign: 'center' }]}>Abra a conversa de um bot para ver o navegador dele.</Text>
            : browserMode(bot) === 'claude' ? <BotBrowserPanel bot={bot} browser={data.browser} pc call={call} onControl={who => onBrowserControl(bot.id, who)} onClose={() => closeKind('browser')} side onFile={onFile} />
            : <>{data.browser?.control?.[bot.id] === 'person' ? <View style={{ padding: 12 }}><ReturnCard bot={bot} onReturn={() => onBrowserControl(bot.id, 'bot')} /></View> : null}
              <BrowserCards key={bot.id} bot={bot} call={call} onOpen={() => setFull(true)} /></>)
          : <SideMenu onTeam={() => { setSide(old => ({ ...old, open: false })); onTeam(); }} bot={bot} waiting={waiting} onPick={kind => { if (kind === 'settings') { onProfile(bot); openKind('settings'); } else openKind(kind); }} />}
      </SideFrame>
    </DesktopReveal>
    {full && (bot || native) ? <BrowserFull bot={bot} data={data} call={call} onControl={who => onBrowserControl(bot.id, who)} onFile={onFile} onClose={() => setFull(false)} onSend={onSend} /> : null}
    <Palette visible={palette} onClose={() => setPalette(false)} bots={bots} rooms={roomList} onOpen={onOpen} onRoom={onRoom} onSearch={onSearch} onCreate={onCreate} />
    <Help visible={help} onClose={() => setHelp(false)} />
    {menu ? <Modal transparent visible animationType="none" onRequestClose={() => setMenu(null)}><Pressable style={{ flex: 1 }} onPress={() => setMenu(null)} onContextMenu={event => { event?.preventDefault?.(); setMenu(null); }}>
      <View style={[s.menu, { left: menu.x, top: menu.y }]}>
        {[['Abrir a conversa', () => onOpen(menu.bot.id)], ['Perfil do bot', () => { onProfile(menu.bot); openKind('settings'); }]].map(([label, act]) => <Pressable key={label} accessibilityRole="menuitem" onPress={() => { setMenu(null); act(); }} style={({ hovered }) => [s.menuItem, hovered && s.rowHover]}><Text style={s.menuText}>{label}</Text></Pressable>)}
      </View></Pressable></Modal> : null}
  </View>;
}
