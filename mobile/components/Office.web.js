// The Escritório page of the computer's window: the 3D offices (office/engine.js) with the bots acting on their real
// state, the list of what each one is doing beside it, and a few numbers below.
import { useEffect, useMemo, useRef, createElement } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { C, F, Icon } from '../theme';
import { Avatar, botLine } from './shared';

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
const tokens = n => n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} mi` : n >= 1e3 ? `${Math.round(n / 1e3)} mil` : String(n);

export default function Office({ data, onOpen, onRoom }) {
  const host = useRef(null), office = useRef(null);
  const snap = useMemo(() => snapshotOf(data), [data]);
  useEffect(() => {
    let alive = true, made = null;
    // three.js is loaded only when the page opens.
    import('../office/engine.js').then(({ createOffice }) => { if (!alive || !host.current) return; made = office.current = createOffice(host.current, { onBotClick: id => onOpen?.(id) }); made.update(snap); });
    return () => { alive = false; made?.dispose(); office.current = null; };
  }, []);
  useEffect(() => { office.current?.update(snap); }, [snap]);
  const bots = (data?.bots || []).filter(bot => !bot.deletedAt), lines = bots.map(bot => ({ bot, line: botLine(bot, data), state: snap.bots.find(item => item.id === bot.id) }));
  const count = state => snap.bots.filter(bot => bot.state === state).length;
  const today = Object.values(data?.usage?.bots || {}).reduce((sum, item) => sum + (item.today?.input || 0) + (item.today?.output || 0), 0);
  const order = { waiting: 0, working: 1, idle: 2, sleeping: 3 };
  lines.sort((a, b) => order[a.state?.state] - order[b.state?.state]);
  const stat = (label, value, detail, tone) => <View key={label} style={{ flex: 1, minWidth: 150, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 13 }}>
    <Text style={{ color: C.muted, fontFamily: F.s, fontSize: 12 }}>{label}</Text><Text style={{ color: tone || C.text, fontFamily: F.b, fontSize: 24, marginTop: 4 }}>{value}</Text><Text style={{ color: C.faint, fontFamily: F.m, fontSize: 11, marginTop: 2 }} numberOfLines={1}>{detail}</Text></View>;
  return <View style={{ flex: 1, flexDirection: 'row', gap: 16, padding: 18, backgroundColor: C.bg, minHeight: 0 }}>
    <View style={{ flex: 1, minWidth: 0, gap: 14 }}>
      <View style={{ flex: 1, borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: C.line, backgroundColor: '#06070a' }}>
        {createElement('div', { ref: host, style: { position: 'absolute', inset: 0 } })}
        <View pointerEvents="box-none" style={{ position: 'absolute', top: 14, left: 14, right: 14, flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, backgroundColor: '#0b0c0ee6', borderWidth: 1, borderColor: C.line }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.good }} /><Text style={{ color: C.text, fontFamily: F.b, fontSize: 12.5 }}>{bots.length} bots · {count('working')} trabalhando</Text></View>
          <Pressable accessibilityRole="button" onPress={() => office.current?.fit()} style={({ hovered }) => ({ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, backgroundColor: hovered ? C.surface2 : '#0b0c0ee6', borderWidth: 1, borderColor: C.line })}><Text style={{ color: C.text2, fontFamily: F.s, fontSize: 12 }}>Ver tudo</Text></Pressable>
          {(data?.rooms || []).map(room => <Pressable key={room.id} accessibilityRole="button" onPress={() => office.current?.focus(room.id)} style={({ hovered }) => ({ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 99, backgroundColor: hovered ? C.surface2 : '#0b0c0ee6', borderWidth: 1, borderColor: C.line })}><Text style={{ color: C.text2, fontFamily: F.s, fontSize: 12 }}>{room.name}</Text></Pressable>)}
        </View>
        <Text pointerEvents="none" style={{ position: 'absolute', bottom: 12, left: 16, color: C.faint, fontFamily: F.m, fontSize: 11 }}>Arraste para andar · role para aproximar · clique duplo numa sala · clique num bot para abrir a conversa</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
        {stat('Trabalhando agora', String(count('working')), count('working') ? lines.filter(l => l.state?.state === 'working').map(l => l.bot.name).slice(0, 3).join(', ') : 'Ninguém no momento', C.accent)}
        {stat('Esperando você', String(count('waiting')), count('waiting') ? 'Abra Atividade para decidir' : 'Tudo em dia', count('waiting') ? '#ff9f7a' : null)}
        {stat('Dormindo', String(count('sleeping')), 'Desconectados', null)}
        {stat('Tokens hoje', tokens(today), `${(data?.rooms || []).length} salas · ${bots.length} bots`, null)}
      </View>
    </View>
    <View style={{ width: 340, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 22, paddingVertical: 18, paddingHorizontal: 12 }}>
      <Text style={{ color: C.text, fontFamily: F.b, fontSize: 18, marginHorizontal: 8 }}>Agora no escritório</Text>
      <Text style={{ color: C.muted, fontFamily: F.m, fontSize: 12, margin: 8, marginTop: 4 }}>o que cada bot está fazendo</Text>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 10, paddingTop: 6 }}>
        {lines.map(({ bot, line, state }) => { const s = state?.state || 'idle'; return <Pressable key={bot.id} accessibilityRole="button" accessibilityLabel={`Abrir ${bot.name}`} onPress={() => onOpen?.(bot.id)} style={({ hovered }) => ({ flexDirection: 'row', gap: 10, alignItems: 'center', padding: 11, borderRadius: 16, borderWidth: 1, borderColor: s === 'working' ? C.accent + '55' : C.line, backgroundColor: hovered ? C.surface2 : s === 'working' ? '#221f18' : C.bg2 })}>
          <Avatar bot={bot} size={42} state={line.state} animated={false} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}><Text style={{ color: C.text, fontFamily: F.b, fontSize: 13.5 }} numberOfLines={1}>{bot.name}</Text><Text style={{ color: COLOR[s], fontFamily: F.s, fontSize: 11 }}>● {LABEL[s]}</Text></View>
            <Text style={{ color: C.text2, fontFamily: F.m, fontSize: 12, marginTop: 3 }} numberOfLines={2}>{state?.text || line.text}</Text>
          </View></Pressable>; })}
        {!bots.length ? <Text style={{ color: C.muted, fontFamily: F.m, fontSize: 12, margin: 8 }}>Nenhum bot ainda. Crie um e ele aparece aqui.</Text> : null}
      </ScrollView>
    </View>
  </View>;
}
