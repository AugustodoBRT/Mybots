// The Escritório page of the computer's window: a full-bleed 3D spatial canvas (office/engine.js)
// with lightweight translucent floating HUD pods directly over the scene (no heavy top bars or sidebars).
import { useEffect, useMemo, useRef, useState, createElement, cloneElement } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, PanResponder, useWindowDimensions } from 'react-native';
import { C, F } from '../theme';
import { Avatar, botLine, ApprovalCard } from './shared';
import { desktopBus } from '../desktop';
import OfficeTasks from './OfficeTasks';

// The app's state for each bot → what the scene shows.
const STATE = { working: 'working', waiting: 'waiting', sleeping: 'sleeping', idle: 'idle' };
const COLOR = { working: '#22c55e', waiting: '#eab308', sleeping: '#a78bfa', idle: C.muted };
const LABEL = { working: 'trabalhando', waiting: 'esperando você', sleeping: 'dormindo', idle: 'livre' };

const POD_BG = 'rgba(20, 22, 28, 0.86)';
const POD_SOLID = 'rgba(22, 25, 32, 0.94)';
const POD_BORDER = 'rgba(255, 255, 255, 0.10)';

function snapshotOf(data) {
  const bots = (data?.bots || []).filter(bot => !bot.deletedAt);
  const step = id => (data?.tasks || []).find(task => task.bot_id === id && ['running', 'waiting_approval'].includes(task.state))?.step;
  return {
    bots: bots.map(bot => {
      const line = botLine(bot, data);
      return {
        id: bot.id,
        name: bot.name,
        face: bot.face || null,
        instructions: bot.instructions || '',
        state: STATE[line.state] || 'idle',
        text: step(bot.id) || (line.state === 'working' ? 'Trabalhando…' : '')
      };
    }),
    rooms: (data?.rooms || []).map(room => ({
      id: room.id,
      name: room.name,
      botIds: room.botIds || [],
      active: room.active || []
    }))
  };
}

const pillStyle = ({ hovered }) => ({
  paddingHorizontal: 10,
  paddingVertical: 5,
  borderRadius: 999,
  backgroundColor: hovered ? 'rgba(255, 255, 255, 0.14)' : 'rgba(255, 255, 255, 0.07)',
  borderWidth: 1,
  borderColor: 'rgba(255, 255, 255, 0.12)'
});

export default function Office({
  data,
  onOpen,
  onRoom,
  conversation,
  selectionKey,
  selectionName,
  onRespond,
  approvalBusy,
  onCancelTask,
  taskMessages,
  onCreate,
  onNewRoom
}) {
  const host = useRef(null), office = useRef(null), initialFocus = useRef(false);
  const [panel, setPanel] = useState(null);
  const [query, setQuery] = useState('');
  const [panelWidth, setPanelWidth] = useState(410);
  const [sceneError, setSceneError] = useState('');
  const [showPip, setShowPip] = useState(false);
  const [teamOpen, setTeamOpen] = useState(true);
  const { width } = useWindowDimensions();
  const stacked = width < 1050;
  const snap = useMemo(() => snapshotOf(data), [data]);
  const latest = useRef({});
  latest.current = { snap, onOpen, panelWidth };

  const selectBot = id => {
    latest.current.onOpen?.(id);
    setPanel('conversation');
  };
  const selectRoom = id => {
    onRoom?.(id);
    office.current?.focus(id);
    setPanel('conversation');
  };

  useEffect(() => {
    let alive = true, made = null;
    import('../office/engine.js')
      .then(({ createOffice }) => {
        if (!alive || !host.current) return;
        made = office.current = createOffice(host.current, {
          onBotClick: id => {
            latest.current.onOpen?.(id);
            setPanel('conversation');
          }
        });
        made.update(latest.current.snap);
        const rooms = latest.current.snap.rooms;
        if (!initialFocus.current && rooms.length) {
          made.focus([...rooms].sort((a, b) => b.botIds.length - a.botIds.length)[0].id);
          initialFocus.current = true;
        }
      })
      .catch(() => {
        if (alive) setSceneError('Não foi possível carregar a cena. Você pode continuar pela lista de bots.');
      });
    return () => {
      alive = false;
      made?.dispose();
      office.current = null;
    };
  }, []);

  useEffect(() => {
    office.current?.update(snap);
    if (!initialFocus.current && office.current && snap.rooms.length) {
      const room = [...snap.rooms].sort((a, b) => b.botIds.length - a.botIds.length)[0];
      office.current.focus(room.id);
      initialFocus.current = true;
    }
  }, [snap]);
  useEffect(() => { if (selectionKey) setPanel('conversation'); }, [selectionKey]);
  useEffect(() => desktopBus.on('office-escape', () => { setPanel(null); setShowPip(false); }), []);

  const resizeStart = useRef(panelWidth);
  const divider = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { resizeStart.current = latest.current.panelWidth; },
    onPanResponderMove: (_, gesture) => setPanelWidth(Math.max(340, Math.min(620, resizeStart.current - gesture.dx)))
  }), []);

  const bots = (data?.bots || []).filter(bot => !bot.deletedAt);
  const approvals = data?.approvals || [];
  const routines = data?.routines || [];
  const finished = (data?.tasks || []).filter(task => task.state === 'done' && bots.some(bot => bot.id === task.bot_id)).slice(0, 3);
  const count = state => snap.bots.filter(bot => bot.state === state).length;
  const needle = query.trim().toLocaleLowerCase('pt-BR');
  const order = { waiting: 0, working: 1, idle: 2, sleeping: 3 };
  const lines = bots
    .map(bot => ({ bot, line: botLine(bot, data), state: snap.bots.find(item => item.id === bot.id) }))
    .filter(({ bot }) => !needle || bot.name.toLocaleLowerCase('pt-BR').includes(needle))
    .sort((a, b) => order[a.state?.state] - order[b.state?.state]);

  const [selKind, selId] = (selectionKey || '').split(':');
  const selectedBot = selKind === 'bot' ? bots.find(b => b.id === selId) : null;
  const selectedBotState = selectedBot ? snap.bots.find(b => b.id === selectedBot.id) : null;
  const selectedBotLine = selectedBot ? botLine(selectedBot, data) : null;
  const selectedRoomName = selectedBot
    ? (data?.rooms || []).find(r => (r.botIds || []).includes(selectedBot.id))?.name || 'Escritório'
    : null;
  const botTasks = selectedBot ? (data?.tasks || []).filter(t => t.bot_id === selectedBot.id) : [];
  const botAttachments = (taskMessages || []).flatMap(m => m.attachments || []);

  const action = (label, onPress, extra = {}) => (
    <Pressable accessibilityRole="button" onPress={onPress} style={pillStyle} {...extra}>
      <Text style={{ color: '#f3f4f6', fontFamily: F.s, fontSize: 11.5, maxWidth: 160 }} numberOfLines={1}>{label}</Text>
    </Pressable>
  );

  const heroBg = selectedBotState?.state === 'working'
    ? 'rgba(34, 84, 38, 0.92)'
    : selectedBotState?.state === 'waiting'
    ? 'rgba(68, 50, 20, 0.92)'
    : 'rgba(28, 32, 42, 0.92)';
  const heroBorder = selectedBotState?.state === 'working'
    ? 'rgba(74, 222, 128, 0.32)'
    : selectedBotState?.state === 'waiting'
    ? 'rgba(250, 204, 21, 0.35)'
    : POD_BORDER;

  return (
    <View style={{ flex: 1, position: 'relative', backgroundColor: '#0b0f17', minHeight: 0, overflow: 'hidden' }}>
      {/* 100% Fullscreen 3D Scene */}
      {createElement('div', { ref: host, style: { position: 'absolute', inset: 0 }, 'aria-label': 'Cena do escritório' })}

      {sceneError ? (
        <View style={{ position: 'absolute', top: 68, left: 260, padding: 16, borderRadius: 14, backgroundColor: POD_SOLID, borderWidth: 1, borderColor: POD_BORDER }}>
          <Text style={{ color: C.text, fontFamily: F.m, fontSize: 12 }}>{sceneError}</Text>
        </View>
      ) : null}

      {/* 1. TOP-LEFT FLOATING BRAND & QUICK ACTIONS PILL */}
      <View pointerEvents="box-none" style={{ position: 'absolute', top: 14, left: 14, right: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 13, paddingVertical: 7, borderRadius: 999, backgroundColor: POD_BG, borderWidth: 1, borderColor: POD_BORDER }}>
          <View style={{ width: 7, height: 7, borderRadius: 99, backgroundColor: '#22c55e' }} />
          <Text style={{ color: '#f3f4f6', fontFamily: F.b, fontSize: 13 }}>Escritório</Text>
          <Text style={{ color: '#9ca3af', fontFamily: F.m, fontSize: 12 }}>Ao vivo · {bots.length} bots</Text>
          {action('Ver tudo', () => office.current?.fit())}
        </View>

        {/* 2. TOP-CENTER FLOATING STATUS TELEMETRY PILL */}
        {!stacked ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: POD_BG, borderWidth: 1, borderColor: POD_BORDER }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3 }}>
              <View style={{ width: 6, height: 6, borderRadius: 99, backgroundColor: '#22c55e' }} />
              <Text style={{ color: '#e5e7eb', fontFamily: F.s, fontSize: 11.5 }}>{count('working')} trabalhando</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setPanel('team')}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                paddingHorizontal: 9,
                paddingVertical: 3,
                borderRadius: 999,
                backgroundColor: approvals.length || count('waiting') ? 'rgba(234, 179, 8, 0.20)' : 'transparent',
                borderWidth: approvals.length || count('waiting') ? 1 : 0,
                borderColor: 'rgba(234, 179, 8, 0.38)'
              }}
            >
              <View style={{ width: 6, height: 6, borderRadius: 99, backgroundColor: '#eab308' }} />
              <Text style={{ color: approvals.length || count('waiting') ? '#fef08a' : '#9ca3af', fontFamily: F.s, fontSize: 11.5 }}>
                {approvals.length ? `${approvals.length} pendências` : `${count('waiting')} esperando`}
              </Text>
            </Pressable>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3 }}>
              <View style={{ width: 6, height: 6, borderRadius: 99, backgroundColor: '#6b7280' }} />
              <Text style={{ color: '#9ca3af', fontFamily: F.m, fontSize: 11.5 }}>{count('idle')} livres</Text>
            </View>
          </View>
        ) : null}

        {/* 3. TOP-RIGHT FLOATING CONTROLS PILL */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999, backgroundColor: POD_BG, borderWidth: 1, borderColor: POD_BORDER }}>
          {action('Equipe', () => setPanel('team'))}
          {selectionKey ? action('Conversa', () => setPanel('conversation')) : null}
          {action('Novo bot', onCreate)}
          {action('Nova sala', onNewRoom, { disabled: bots.length < 2, accessibilityState: { disabled: bots.length < 2 } })}
        </View>
      </View>

      {/* 4. LEFT FLOATING PODS STACK (Salas, Esperando você, Equipe/Finalizados, Rotinas) */}
      <ScrollView style={{ position: 'absolute', top: 72, left: 16, width: stacked ? 220 : 280, maxHeight: '73%' }} contentContainerStyle={{ gap: 10 }}>
        {/* POD: SALAS (with colored status dots like the reference) */}
        <View style={{ padding: 15, borderRadius: 20, backgroundColor: POD_BG, borderWidth: 1, borderColor: POD_BORDER }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
            <Text style={{ color: '#f3f4f6', fontFamily: F.b, fontSize: 14 }}>Salas</Text>
            <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)' }}>
              <Text style={{ color: '#9ca3af', fontFamily: F.s, fontSize: 10.5 }}>{(data?.rooms || []).length + 1}</Text>
            </View>
          </View>
          <View style={{ gap: 4 }}>
            {(data?.rooms || []).map((room, idx) => {
              const roomBots = (room.botIds || []).map(id => snap.bots.find(b => b.id === id)).filter(Boolean);
              const isSelected = selectionKey === `room:${room.id}`;
              return (
                <Pressable
                  key={room.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Abrir sala ${room.name}`}
                  onPress={() => selectRoom(room.id)}
                  style={({ hovered }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingHorizontal: 8,
                    paddingVertical: 10,
                    borderRadius: 12,
                    backgroundColor: isSelected ? 'rgba(255,255,255,0.13)' : hovered ? 'rgba(255,255,255,0.06)' : 'transparent',
                    borderWidth: isSelected ? 1 : 0,
                    borderColor: 'rgba(255,255,255,0.14)'
                  })}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                    <View style={{ width: 20, height: 20, borderRadius: 6, backgroundColor: isSelected ? '#f3f4f6' : 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: isSelected ? '#111827' : '#9ca3af', fontFamily: F.b, fontSize: 10.5 }}>{idx + 2}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ color: '#f3f4f6', fontFamily: F.s, fontSize: 12 }} numberOfLines={1}>{room.name}</Text>
                      <View style={{ flexDirection: 'row', gap: 3, marginTop: 3 }}>
                        {roomBots.slice(0, 8).map(rb => (
                          <View key={rb.id} style={{ width: 4.5, height: 4.5, borderRadius: 99, backgroundColor: COLOR[rb.state] || '#6b7280' }} />
                        ))}
                      </View>
                    </View>
                  </View>
                  <Text style={{ color: '#9ca3af', fontFamily: F.s, fontSize: 11 }}>{roomBots.length}</Text>
                </Pressable>
              );
            })}
            <Pressable
              accessibilityRole="button"
              onPress={() => office.current?.fit()}
              style={({ hovered }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: 8,
                paddingVertical: 6,
                borderRadius: 11,
                backgroundColor: hovered ? 'rgba(255,255,255,0.06)' : 'transparent'
              })}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ width: 20, height: 20, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: '#9ca3af', fontFamily: F.b, fontSize: 10.5 }}>1</Text>
                </View>
                <Text style={{ color: '#d1d5db', fontFamily: F.s, fontSize: 12 }}>Escritório (Geral)</Text>
              </View>
              <Text style={{ color: '#9ca3af', fontFamily: F.s, fontSize: 11 }}>{bots.length}</Text>
            </Pressable>
          </View>
        </View>

        {/* POD: ESPERANDO VOCÊ (Warm Amber Floating Card when approvals exist) */}
        {approvals.length ? (
          <View style={{ padding: 11, borderRadius: 18, backgroundColor: 'rgba(44, 34, 18, 0.92)', borderWidth: 1, borderColor: 'rgba(234, 179, 8, 0.35)', gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: '#fef08a', fontFamily: F.b, fontSize: 14 }}>Esperando você</Text>
              <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, backgroundColor: 'rgba(234, 179, 8, 0.25)' }}>
                <Text style={{ color: '#fde047', fontFamily: F.b, fontSize: 10.5 }}>{approvals.length}</Text>
              </View>
            </View>
            {approvals.slice(0, 2).map(approval => {
              const bot = bots.find(item => item.id === approval.botId);
              return (
                <Pressable
                  key={approval.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Revisar pendência de ${bot?.name || 'bot'}`}
                  onPress={() => {
                    if (approval.botId) latest.current.onOpen?.(approval.botId);
                    setPanel('tasks');
                  }}
                  style={{ padding: 8, borderRadius: 11, backgroundColor: 'rgba(0, 0, 0, 0.26)', borderWidth: 1, borderColor: 'rgba(250, 204, 21, 0.22)', gap: 2 }}
                >
                  <Text style={{ color: '#fef08a', fontFamily: F.b, fontSize: 11.5 }} numberOfLines={1}>
                    {bot?.name || 'Bot'} · Aguardando decisão
                  </Text>
                  <Text style={{ color: '#fde68a', fontFamily: F.m, fontSize: 11 }} numberOfLines={1}>
                    {approval.title || approval.action || 'Toque para revisar'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {/* POD: EQUIPE & ATIVIDADE DOS BOTS (Compact Floating Pod that hugs content) */}
        <View style={{ maxHeight: 310, padding: 15, borderRadius: 20, backgroundColor: POD_BG, borderWidth: 1, borderColor: POD_BORDER }}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setTeamOpen(v => !v)}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: teamOpen ? 8 : 0 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ color: '#f3f4f6', fontFamily: F.b, fontSize: 12 }}>Bots no Escritório</Text>
              <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)' }}>
                <Text style={{ color: '#9ca3af', fontFamily: F.s, fontSize: 10.5 }}>{lines.length}</Text>
              </View>
            </View>
            <Text style={{ color: '#9ca3af', fontFamily: F.m, fontSize: 11 }}>{teamOpen ? '⌃' : '⌄'}</Text>
          </Pressable>

          {teamOpen ? (
            <View style={{ minHeight: 0 }}>
              <TextInput
                accessibilityLabel="Buscar bots no escritório"
                placeholder="Buscar bot pelo nome"
                placeholderTextColor="#6b7280"
                value={query}
                onChangeText={setQuery}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 7,
                  borderRadius: 10,
                  backgroundColor: 'rgba(0, 0, 0, 0.28)',
                  color: '#f3f4f6',
                  borderWidth: 1,
                  borderColor: 'rgba(255, 255, 255, 0.08)',
                  fontFamily: F.m,
                  fontSize: 11.5,
                  marginBottom: 8
                }}
              />
              <ScrollView style={{ maxHeight: 210 }} contentContainerStyle={{ gap: 6 }}>
                {lines.map(({ bot, line, state }) => {
                  const s = state?.state || 'idle';
                  const activeSel = selectionKey === `bot:${bot.id}`;
                  return (
                    <Pressable
                      key={bot.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Conversar com ${bot.name} no escritório`}
                      onPress={() => selectBot(bot.id)}
                      style={({ hovered }) => ({
                        flexDirection: 'row',
                        gap: 8,
                        alignItems: 'center',
                        paddingHorizontal: 8,
                        paddingVertical: 7,
                        borderRadius: 11,
                        borderWidth: 1,
                        borderColor: activeSel ? '#22c55e' : 'rgba(255,255,255,0.06)',
                        backgroundColor: activeSel ? 'rgba(34, 197, 94, 0.12)' : hovered ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)'
                      })}
                    >
                      <Avatar bot={bot} size={26} state={line.state} animated={false} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                          <Text style={{ color: '#f3f4f6', fontFamily: F.b, fontSize: 12 }} numberOfLines={1}>{bot.name}</Text>
                          <View style={{ width: 6, height: 6, borderRadius: 99, backgroundColor: COLOR[s] }} />
                        </View>
                        <Text style={{ color: '#9ca3af', fontFamily: F.m, fontSize: 11, marginTop: 1 }} numberOfLines={1}>
                          {state?.text || line.text || LABEL[s]}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
                {!lines.length ? (
                  <Text style={{ color: '#9ca3af', fontFamily: F.m, fontSize: 11.5 }}>
                    {bots.length ? 'Nenhum bot com esse nome.' : 'Crie seu primeiro bot para começar.'}
                  </Text>
                ) : null}
              </ScrollView>
            </View>
          ) : null}
        </View>

        {finished.length ? (
          <View style={{ padding: 15, borderRadius: 20, backgroundColor: POD_BG, borderWidth: 1, borderColor: POD_BORDER, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: '#f3f4f6', fontFamily: F.b, fontSize: 14 }}>Finalizados</Text>
              <Text style={{ color: '#9ca3af', fontFamily: F.s, fontSize: 11 }}>{finished.length}</Text>
            </View>
            {finished.map(task => {
              const bot = bots.find(item => item.id === task.bot_id);
              return <Pressable key={task.id} accessibilityRole="button" onPress={() => selectBot(bot.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Avatar bot={bot} size={34} animated={false} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: '#f3f4f6', fontFamily: F.b, fontSize: 13 }} numberOfLines={1}>{bot.name}</Text>
                  <Text style={{ color: '#9ca3af', fontFamily: F.m, fontSize: 12 }} numberOfLines={1}>{task.step || 'Tarefa concluída'}</Text>
                </View>
              </Pressable>;
            })}
          </View>
        ) : null}

        {/* POD: ROTINAS (if any exist) */}
        {routines.length ? (
          <View style={{ padding: 15, borderRadius: 20, backgroundColor: POD_BG, borderWidth: 1, borderColor: POD_BORDER, gap: 5 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: '#f3f4f6', fontFamily: F.b, fontSize: 11.5 }}>Rotinas</Text>
              <Text style={{ color: '#9ca3af', fontFamily: F.m, fontSize: 10.5 }}>{routines.length}</Text>
            </View>
            {routines.slice(0, 2).map(routine => (
              <View key={routine.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <Text style={{ color: '#d1d5db', fontFamily: F.m, fontSize: 11, flex: 1 }} numberOfLines={1}>{routine.title || routine.prompt}</Text>
                <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(59, 130, 246, 0.2)' }}>
                  <Text style={{ color: '#93c5fd', fontFamily: F.s, fontSize: 10 }}>Ativa</Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      {/* 5. BOTTOM-LEFT FLOATING ACTIVITY POD */}
      <View pointerEvents="none" style={{ position: 'absolute', bottom: 14, left: 14, width: stacked ? 220 : 300, paddingHorizontal: 15, paddingVertical: 12, borderRadius: 16, backgroundColor: POD_BG, borderWidth: 1, borderColor: POD_BORDER }}>
        <Text style={{ color: '#9ca3af', fontFamily: F.b, fontSize: 12, marginBottom: 6 }}>Atividade</Text>
        {lines.slice(0, 4).map(({ bot, state, line }) => (
          <View key={bot.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <View style={{ width: 5, height: 5, borderRadius: 99, backgroundColor: COLOR[state?.state || 'idle'] }} />
            <Text style={{ color: '#d1d5db', fontFamily: F.m, fontSize: 11, flex: 1 }} numberOfLines={1}>
              <Text style={{ fontFamily: F.b, color: '#f3f4f6' }}>{bot.name}</Text> · {state?.text || line.text}
            </Text>
          </View>
        ))}
        {!lines.length ? (
          <Text style={{ color: '#9ca3af', fontFamily: F.m, fontSize: 11 }}>Arraste para explorar · role para aproximar</Text>
        ) : null}
      </View>

      {/* 6. BOTTOM-RIGHT FLOATING ZOOM PILL */}
      <View style={{ position: 'absolute', bottom: 14, right: 14, flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 6, paddingVertical: 4, borderRadius: 999, backgroundColor: POD_BG, borderWidth: 1, borderColor: POD_BORDER }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Afastar câmera" onPress={() => office.current?.zoomBy?.(0.84)} style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#d1d5db', fontFamily: F.b, fontSize: 14 }}>−</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Aproximar câmera" onPress={() => office.current?.zoomBy?.(1.18)} style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#d1d5db', fontFamily: F.b, fontSize: 14 }}>+</Text>
        </Pressable>
      </View>

      {/* 7. FLOATING PICTURE-IN-PICTURE (PiP) ACTIVITY / BROWSER WINDOW OVER THE 3D SCENE */}
      {showPip && selectionKey && panel ? (
        <View style={{
          position: 'absolute',
          top: 60,
          right: stacked ? 14 : panelWidth + 28,
          width: 330,
          borderRadius: 20,
          backgroundColor: POD_SOLID,
          borderWidth: 1,
          borderColor: 'rgba(255, 255, 255, 0.16)',
          overflow: 'hidden',
          padding: 14,
          gap: 10
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <View style={{ width: 7, height: 7, borderRadius: 99, backgroundColor: '#22c55e' }} />
              <Text style={{ color: '#f3f4f6', fontFamily: F.b, fontSize: 12.5 }}>Tela de {selectionName}</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={() => setShowPip(false)} style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)' }}>
              <Text style={{ color: '#d1d5db', fontFamily: F.s, fontSize: 11 }}>Fechar ×</Text>
            </Pressable>
          </View>
          <View style={{ padding: 11, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.35)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', gap: 6 }}>
            <Text style={{ color: '#93c5fd', fontFamily: F.m, fontSize: 11 }}>
              {selectedBotState?.text || selectedBotLine?.text || 'Pronto para iniciar navegação ou tarefa'}
            </Text>
            <View style={{ flexDirection: 'row', gap: 14, marginTop: 4 }}>
              <View>
                <Text style={{ color: '#ffffff', fontFamily: F.b, fontSize: 16 }}>{botTasks.length}</Text>
                <Text style={{ color: '#9ca3af', fontFamily: F.m, fontSize: 10 }}>tarefas</Text>
              </View>
              <View>
                <Text style={{ color: '#ffffff', fontFamily: F.b, fontSize: 16 }}>{botAttachments.length}</Text>
                <Text style={{ color: '#9ca3af', fontFamily: F.m, fontSize: 10 }}>arquivos</Text>
              </View>
              <View>
                <Text style={{ color: '#ffffff', fontFamily: F.b, fontSize: 16 }}>{(taskMessages || []).length}</Text>
                <Text style={{ color: '#9ca3af', fontFamily: F.m, fontSize: 10 }}>mensagens</Text>
              </View>
            </View>
          </View>
          {botAttachments.length ? (
            <View style={{ gap: 4 }}>
              <Text style={{ color: '#9ca3af', fontFamily: F.s, fontSize: 11 }}>Entregas recentes</Text>
              {botAttachments.slice(-3).map((att, idx) => (
                <View key={att.id || idx} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8, backgroundColor: 'rgba(34, 197, 94, 0.10)' }}>
                  <Text style={{ color: '#bbf7d0', fontFamily: F.m, fontSize: 11 }} numberOfLines={1}>{att.name}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {/* 8. RIGHT FLOATING POD (2-Part Bot Status Card + Conversation / Tasks / Team) */}
      <View
        style={{
          display: panel ? 'flex' : 'none',
          position: 'absolute',
          top: 60,
          right: 14,
          bottom: 52,
          width: stacked ? Math.min(width - 28, 420) : panelWidth,
          gap: 8
        }}
      >
        {/* Resize Handle on Left Edge of Floating Pod */}
        {!stacked && panel ? (
          <View
            {...divider.panHandlers}
            accessibilityRole="adjustable"
            accessibilityLabel="Largura do painel do escritório"
            style={{ position: 'absolute', left: -12, top: '42%', width: 10, height: 48, cursor: 'col-resize', justifyContent: 'center', alignItems: 'center', zIndex: 20 }}
          >
            <View style={{ width: 3, height: 32, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 3 }} />
          </View>
        ) : null}

        {/* TOP FLOATING BOT HERO CARD (like QT Scout in the reference when a bot is selected) */}
        {selectedBot ? (
          <View style={{ padding: 18, borderRadius: 22, backgroundColor: heroBg, borderWidth: 1, borderColor: heroBorder, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                <Avatar bot={selectedBot} size={46} state={selectedBotLine?.state} animated={false} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: '#ffffff', fontFamily: F.b, fontSize: 18 }} numberOfLines={1}>{selectedBot.name}</Text>
                  <Text style={{ color: 'rgba(255,255,255,0.75)', fontFamily: F.m, fontSize: 11 }} numberOfLines={1}>
                    {selectedRoomName}
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setShowPip(v => !v)}
                  style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.28)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' }}
                >
                  <Text style={{ color: '#ffffff', fontFamily: F.s, fontSize: 11 }}>{showPip ? 'Ocultar tela' : 'Ver tela'}</Text>
                </Pressable>
              </View>
            </View>
            <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.24)' }}>
              <View style={{ width: 7, height: 7, borderRadius: 99, backgroundColor: COLOR[selectedBotState?.state || 'idle'] }} />
              <Text style={{ color: '#f3f4f6', fontFamily: F.s, fontSize: 12 }}>{LABEL[selectedBotState?.state || 'idle']}</Text>
            </View>
            <Text style={{ color: '#ffffff', fontFamily: F.s, fontSize: 14 }} numberOfLines={2}>
              {selectedBotState?.text || selectedBotLine?.text || 'Pronto para trabalhar com você'}
            </Text>
          </View>
        ) : null}

        {/* BOTTOM FLOATING POD (Navigation pills + Conversation / Tasks / Team body) */}
        <View style={{ flex: 1, minHeight: 0, borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: POD_BORDER, backgroundColor: POD_SOLID }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 9, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)', flexWrap: 'wrap' }}>
            {action('Equipe', () => setPanel('team'), { accessibilityState: { selected: panel === 'team' } })}
            {selectionKey ? action(selectionName || 'Conversa', () => setPanel('conversation'), { accessibilityState: { selected: panel === 'conversation' } }) : null}
            {selectionKey ? action('Tarefas', () => setPanel('tasks'), { accessibilityState: { selected: panel === 'tasks' } }) : null}
            {!stacked ? action('−', () => setPanelWidth(value => Math.max(340, value - 40)), { accessibilityLabel: 'Diminuir painel do escritório' }) : null}
            {!stacked ? action('+', () => setPanelWidth(value => Math.min(620, value + 40)), { accessibilityLabel: 'Aumentar painel do escritório' }) : null}
            <View style={{ flex: 1 }} />
            {action('Recolher', () => { setPanel(null); setShowPip(false); }, { accessibilityLabel: 'Recolher painel do escritório' })}
          </View>

          <View style={{ flex: 1, minHeight: 0, display: panel === 'conversation' && conversation ? 'flex' : 'none' }}>
            {conversation ? cloneElement(conversation, { interactive: panel === 'conversation' }) : null}
          </View>

          {panel === 'tasks' && selectionKey ? (
            <OfficeTasks
              data={data}
              selectionKey={selectionKey}
              selectionName={selectionName}
              messages={taskMessages}
              onRespond={onRespond}
              approvalBusy={approvalBusy}
              onCancelTask={onCancelTask}
            />
          ) : null}

          <View style={{ flex: 1, minHeight: 0, display: panel === 'team' || !conversation ? 'flex' : 'none' }}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 9 }}>
              {approvals.length ? <Text style={{ color: '#fef08a', fontFamily: F.b, fontSize: 13 }}>Precisa de você</Text> : null}
              {approvals.map(approval => (
                <ApprovalCard
                  key={approval.id}
                  approval={approval}
                  bot={bots.find(bot => bot.id === approval.botId)}
                  onRespond={onRespond}
                  busy={approvalBusy === approval.id}
                />
              ))}
              <Text style={{ color: '#9ca3af', fontFamily: F.m, fontSize: 11.5 }}>
                Clique num bot na cena 3D ou abaixo para abrir a conversa flutuante.
              </Text>
              {lines.map(({ bot, line, state }) => {
                const s = state?.state || 'idle';
                return (
                  <Pressable
                    key={bot.id}
                    accessibilityRole="button"
                    onPress={() => selectBot(bot.id)}
                    style={({ hovered }) => ({
                      flexDirection: 'row',
                      gap: 10,
                      alignItems: 'center',
                      padding: 10,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: selectionKey === `bot:${bot.id}` ? '#22c55e' : 'rgba(255,255,255,0.08)',
                      backgroundColor: hovered ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)'
                    })}
                  >
                    <Avatar bot={bot} size={34} state={line.state} animated={false} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ color: '#f3f4f6', fontFamily: F.b, fontSize: 13 }}>{bot.name}</Text>
                      <Text style={{ color: COLOR[s], fontFamily: F.s, fontSize: 11, marginTop: 1 }}>{LABEL[s]}</Text>
                      <Text style={{ color: '#9ca3af', fontFamily: F.m, fontSize: 11.5, marginTop: 2 }} numberOfLines={2}>
                        {state?.text || line.text}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </View>
    </View>
  );
}
