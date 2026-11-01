// The Escritório page of the computer's window: the 3D offices (office/engine.js) with the bots acting on their real
// state, the list of what each one is doing beside it, and a few numbers below.
import { useEffect, useMemo, useRef, useState, createElement, cloneElement } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, PanResponder, useWindowDimensions } from 'react-native';
import { C, F } from '../theme';
import { Avatar, botLine, ApprovalCard } from './shared';
import { desktopBus } from '../desktop';
import OfficeTasks from './OfficeTasks';

// The app's state for each bot → what the scene shows.
const STATE = { working: 'working', waiting: 'waiting', sleeping: 'sleeping', idle: 'idle' };
const COLOR = { working: C.accent, waiting: '#ff9f7a', sleeping: '#b9b2ff', idle: C.muted };
const LABEL = { working: 'trabalhando', waiting: 'esperando você', sleeping: 'dormindo', idle: 'livre' };

function snapshotOf(data) {
  const bots = (data?.bots || []).filter(bot => !bot.deletedAt);
  const step = id => (data?.tasks || []).find(task => task.bot_id === id && ['running', 'waiting_approval'].includes(task.state))?.step;
  return {
    bots: bots.map(bot => { const line = botLine(bot, data); return { id: bot.id, name: bot.name, face: bot.face || null, instructions: bot.instructions || '', state: STATE[line.state] || 'idle', text: step(bot.id) || (line.state === 'working' ? 'Trabalhando…' : '') }; }),
    rooms: (data?.rooms || []).map(room => ({ id: room.id, name: room.name, botIds: room.botIds || [], active: room.active || [] }))
  };
}
const buttonStyle = ({ hovered }) => ({ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: hovered ? C.surface2 : C.surface, borderWidth: 1, borderColor: C.line });

export default function Office({ data, onOpen, onRoom, conversation, selectionKey, selectionName, onRespond, approvalBusy, onCancelTask, taskMessages, onCreate, onNewRoom }) {
  const host = useRef(null), office = useRef(null);
  const [panel, setPanel] = useState('team'), [query, setQuery] = useState(''), [panelWidth, setPanelWidth] = useState(440), [sceneError, setSceneError] = useState('');
  const { width } = useWindowDimensions(), stacked = width < 1050;
  const snap = useMemo(() => snapshotOf(data), [data]);
  const latest = useRef({}); latest.current = { snap, onOpen };
  const selectBot = id => { latest.current.onOpen?.(id); setPanel('conversation'); };
  const selectRoom = id => { onRoom?.(id); office.current?.focus(id); setPanel('conversation'); };
  useEffect(() => {
    let alive = true, made = null;
    import('../office/engine.js').then(({ createOffice }) => {
      if (!alive || !host.current) return;
      made = office.current = createOffice(host.current, { onBotClick: id => { latest.current.onOpen?.(id); setPanel('conversation'); } });
      made.update(latest.current.snap);
    }).catch(() => { if (alive) setSceneError('Não foi possível carregar a cena. Você pode continuar pela lista de bots.'); });
    return () => { alive = false; made?.dispose(); office.current = null; };
  }, []);
  useEffect(() => { office.current?.update(snap); }, [snap]);
  useEffect(() => { if (selectionKey) setPanel('conversation'); }, [selectionKey]);
  useEffect(() => desktopBus.on('office-escape', () => setPanel(null)), []);
  const resizeStart = useRef(panelWidth);
  const divider = useMemo(() => PanResponder.create({ onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { resizeStart.current = latest.current.panelWidth; },
    onPanResponderMove: (_, gesture) => setPanelWidth(Math.max(360, Math.min(640, resizeStart.current - gesture.dx))) }), []);
  latest.current.panelWidth = panelWidth;
  const bots = (data?.bots || []).filter(bot => !bot.deletedAt), approvals = data?.approvals || [];
  const count = state => snap.bots.filter(bot => bot.state === state).length;
  const needle = query.trim().toLocaleLowerCase('pt-BR');
  const order = { waiting: 0, working: 1, idle: 2, sleeping: 3 };
  const lines = bots.map(bot => ({ bot, line: botLine(bot, data), state: snap.bots.find(item => item.id === bot.id) }))
    .filter(({ bot }) => !needle || bot.name.toLocaleLowerCase('pt-BR').includes(needle))
    .sort((a, b) => order[a.state?.state] - order[b.state?.state]);
  const action = (label, onPress, extra = {}) => <Pressable accessibilityRole="button" onPress={onPress} style={buttonStyle} {...extra}><Text style={{ color: C.text, fontFamily: F.s, fontSize: 12, maxWidth: 190 }} numberOfLines={1}>{label}</Text></Pressable>;
  return <View style={{ flex: 1, padding: 12, gap: 10, backgroundColor: C.bg, minHeight: 0 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <Text style={{ color: C.text, fontFamily: F.b, fontSize: 17, marginRight: 8 }}>Escritório</Text>
      <Text style={{ color: C.muted, fontFamily: F.m, fontSize: 12 }}>{bots.length} bots · {count('working')} trabalhando</Text>
      <View style={{ flex: 1 }} />
      {action(approvals.length ? `${approvals.length} pendências` : 'Equipe', () => setPanel('team'))}
      {selectionKey ? action('Conversa', () => setPanel('conversation')) : null}
      {action('Novo bot', onCreate)}
      {action('Nova sala', onNewRoom, { disabled: bots.length < 2, accessibilityState: { disabled: bots.length < 2 } })}
    </View>
    <View style={{ flex: 1, minHeight: 0, flexDirection: stacked ? 'column' : 'row', gap: stacked ? 10 : 0 }}>
      <View style={{ flex: 1, minWidth: 0, minHeight: stacked ? 220 : 0, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: C.line, backgroundColor: '#121c29' }}>
        {createElement('div', { ref: host, style: { position: 'absolute', inset: 0 }, 'aria-label': 'Cena do escritório' })}
        <View pointerEvents="box-none" style={{ position: 'absolute', top: 12, left: 12, right: 12, flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {action('Ver tudo', () => office.current?.fit())}
          {(data?.rooms || []).map(room => <View key={room.id}>{action(room.name, () => selectRoom(room.id), { accessibilityLabel: `Abrir sala ${room.name}` })}</View>)}
        </View>
        {sceneError ? <View style={{ padding: 24, marginTop: 60, backgroundColor: C.surface }}><Text style={{ color: C.text }}>{sceneError}</Text></View> : null}
        <Text pointerEvents="none" style={{ position: 'absolute', bottom: 12, left: 14, right: 14, color: '#c0c9d6', fontFamily: F.m, fontSize: 11 }}>Arraste para explorar · role para aproximar · selecione um bot para trabalhar aqui</Text>
      </View>
      {!stacked && panel ? <View {...divider.panHandlers} accessibilityRole="adjustable" accessibilityLabel="Largura do painel do escritório" style={{ width: 10, cursor: 'col-resize', justifyContent: 'center', alignItems: 'center' }}><View style={{ width: 3, height: 36, backgroundColor: C.line, borderRadius: 3 }} /></View> : null}
      <View style={{ display: panel ? 'flex' : 'none', width: stacked ? '100%' : panelWidth, flex: stacked ? 1.2 : undefined, minHeight: 0, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderBottomWidth: 1, borderBottomColor: C.line }}>
          {action('Equipe', () => setPanel('team'), { accessibilityState: { selected: panel === 'team' } })}
          {selectionKey ? action(selectionName || 'Conversa', () => setPanel('conversation'), { accessibilityState: { selected: panel === 'conversation' } }) : null}
          {selectionKey ? action('Tarefas', () => setPanel('tasks'), { accessibilityState: { selected: panel === 'tasks' } }) : null}
          {!stacked ? action('−', () => setPanelWidth(value => Math.max(360, value - 40)), { accessibilityLabel: 'Diminuir painel do escritório' }) : null}
          {!stacked ? action('+', () => setPanelWidth(value => Math.min(640, value + 40)), { accessibilityLabel: 'Aumentar painel do escritório' }) : null}
          <View style={{ flex: 1 }} />
          {action('Recolher', () => setPanel(null), { accessibilityLabel: 'Recolher painel do escritório' })}
        </View>
        <View style={{ flex: 1, minHeight: 0, display: panel === 'conversation' && conversation ? 'flex' : 'none' }}>{conversation ? cloneElement(conversation, { interactive: panel === 'conversation' }) : null}</View>
        {panel === 'tasks' && selectionKey ? <OfficeTasks data={data} selectionKey={selectionKey} selectionName={selectionName} messages={taskMessages} onRespond={onRespond} approvalBusy={approvalBusy} onCancelTask={onCancelTask} /> : null}
        <View style={{ flex: 1, minHeight: 0, display: panel === 'team' || !conversation ? 'flex' : 'none' }}>
          <TextInput accessibilityLabel="Buscar bots no escritório" placeholder="Buscar bot pelo nome" placeholderTextColor={C.faint} value={query} onChangeText={setQuery}
            style={{ margin: 12, padding: 12, borderRadius: 12, backgroundColor: C.bg, color: C.text, borderWidth: 1, borderColor: C.line, fontFamily: F.m }} />
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingTop: 0, gap: 10 }}>
            {approvals.length ? <Text style={{ color: C.text, fontFamily: F.b, fontSize: 14 }}>Precisa de você</Text> : null}
            {approvals.map(approval => <ApprovalCard key={approval.id} approval={approval} bot={bots.find(bot => bot.id === approval.botId)} onRespond={onRespond} busy={approvalBusy === approval.id} />)}
            <Text style={{ color: C.muted, fontFamily: F.m, fontSize: 12 }}>Selecione um bot para conversar sem sair do escritório.</Text>
            {lines.map(({ bot, line, state }) => { const s = state?.state || 'idle'; return <Pressable key={bot.id} accessibilityRole="button" accessibilityLabel={`Conversar com ${bot.name} no escritório`} onPress={() => selectBot(bot.id)}
              style={({ hovered }) => ({ flexDirection: 'row', gap: 10, alignItems: 'center', padding: 11, borderRadius: 14, borderWidth: 1, borderColor: selectionKey === `bot:${bot.id}` ? C.accent : C.line, backgroundColor: hovered ? C.surface2 : C.bg2 })}>
              <Avatar bot={bot} size={38} state={line.state} animated={false} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: C.text, fontFamily: F.b, fontSize: 13 }}>{bot.name}</Text>
                <Text style={{ color: COLOR[s], fontFamily: F.s, fontSize: 11, marginTop: 2 }}>{LABEL[s]}</Text>
                <Text style={{ color: C.text2, fontFamily: F.m, fontSize: 12, marginTop: 3 }} numberOfLines={2}>{state?.text || line.text}</Text>
              </View>
            </Pressable>; })}
            {!lines.length ? <Text style={{ color: C.muted, fontFamily: F.m, fontSize: 12 }}>{bots.length ? 'Nenhum bot com esse nome.' : 'Crie seu primeiro bot para começar.'}</Text> : null}
          </ScrollView>
        </View>
      </View>
    </View>
  </View>;
}
