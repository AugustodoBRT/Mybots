import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { Avatar, greeting, botLine } from './shared';
import { desktop, desktopBus } from '../desktop';
import { useStore } from '../state/useStore';
import { C, F, Icon } from '../theme';
import { graphModel } from '../state/graph-layout';
import { GraphCanvas, useLayout } from '../screens/MemoryGraph';
import { botHues, look } from '../screens/memory-look';

// The same forces as the memory map's defaults, plus a keep-out disc where the Chefe stands.
const FORCES = { center: 0.06, repel: 360, link: 1, distance: 110 };
const store = { positions: {}, view: null };

// The Chefe's empty conversation: his face in the middle and the memory map growing around him like an aura. It is the real
// map (move a note, hover to light up its links); the view is fixed so nothing can slide behind him, and notes cannot enter his disc.
// It goes away as soon as the first message of this visit is sent.
// What a person usually asks first; a touch writes it in the message field, ready to send or change.
const SUGGESTIONS = ['Como está a equipe hoje?', 'O que precisa de mim agora?', 'Crie um bot para me ajudar com…'];

export function ChiefHero({ bot, state, call, onSessions, resume, onResume, onSuggest, onTeam }) {
  const home = useStore(({ data }) => data);
  const team = (home?.bots || []).filter(item => !item.deletedAt && !item.isChief).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8);
  const waiting = (home?.approvals || []).length, working = (home?.active || []).filter(id => id !== bot.id).length;
  const sum = [working ? `${working} ${working > 1 ? 'bots trabalhando' : 'bot trabalhando'}` : '', waiting ? `${waiting} ${waiting > 1 ? 'decisões esperam' : 'decisão espera'} você` : ''].filter(Boolean).join(' · ') || `Diga o que precisa: ${bot.name} cuida ou chama quem sabe.`;
  // The conversation screen only knows its own bot, so the colours need the whole team from the store.
  const bots = useStore(({ data }) => data?.bots);
  const [data, setData] = useState(null), [fit, setFit] = useState(null);
  useEffect(() => {
    let live = true;
    Promise.resolve(call?.('notes.graph', {})).then(value => { if (live && value?.nodes) setData(value); }).catch(() => {});
    return () => { live = false; };
  }, [call]);
  const model = useMemo(() => data && graphModel(data, { ghosts: true, orphans: true }), [data]);
  const hole = useMemo(() => 11.5 * Math.sqrt(model?.nodes.length || 0) + 34, [model]);
  const forces = useMemo(() => ({ ...FORCES, hole }), [hole]);
  const { positions, fitKey, drag } = useLayout(model, store, forces);
  const L = look();
  const hues = useMemo(() => botHues(bots || []), [bots, L]);
  const colorOf = useMemo(() => node => node.botId ? hues.get(node.botId) || L.node : L.node, [hues, L]);
  const live = model?.nodes.length && fit;
  // The face is as big as the disc it keeps clear, wherever the map puts its centre on screen.
  const disc = live ? Math.min(420, Math.max(160, 2 * hole * fit.k)) : 240;
  const at = live ? { left: fit.x - disc / 2, top: fit.y - disc / 2 } : null;
  return <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
    {model?.nodes.length ? <GraphCanvas model={model} positions={positions} colorOf={colorOf} onOpen={() => {}} fitKey={fitKey} store={store} transparent lockView soloLabel drag={drag} onFit={setFit} /> : null}
    <View pointerEvents="none" style={[{ position: 'absolute', width: disc, height: disc, borderRadius: disc / 2, alignItems: 'center', justifyContent: 'center' }, at || { left: '50%', top: '50%', marginLeft: -disc / 2, marginTop: -disc / 2 }]}>
      <Avatar bot={bot} size={Math.round(disc * 0.95)} state={state} tile={false} animated />
    </View>
    <View pointerEvents="none" style={{ position: 'absolute', top: desktop ? 28 : 14, left: 16, right: 16, alignItems: 'center', gap: 4 }}>
      <Text style={{ color: C.text, fontFamily: F.b, fontSize: desktop ? 28 : 22, letterSpacing: -0.6, textAlign: 'center' }}>{greeting()}{home?.person?.name ? `, ${home.person.name}` : ''}.</Text>
      <Text style={{ color: C.muted, fontFamily: F.m, fontSize: desktop ? 15 : 13.5, textAlign: 'center' }} numberOfLines={2}>{sum}</Text>
    </View>
    <View style={{ position: 'absolute', bottom: 8, left: 0, right: 0, alignItems: 'center', gap: 10 }}>
      {team.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, maxWidth: '100%' }} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, alignItems: 'center' }}>
        {team.map(item => { const line = botLine(item, home); const busy = line.state !== 'idle'; return <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Ir para ${item.name}`} onPress={() => desktopBus.emit('open-bot', item.id)}
          style={({ pressed, hovered }) => [{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingLeft: 6, paddingRight: 14, borderRadius: 22, backgroundColor: C.surface, borderWidth: 1, borderColor: busy ? C.accent + '66' : C.line }, hovered && { backgroundColor: C.surface2 }, pressed && { opacity: 0.7 }]}>
          <Avatar bot={item} size={32} state={line.state} animated={busy} />
          <View><Text style={{ color: C.text, fontFamily: F.s, fontSize: 13 }} numberOfLines={1}>{item.name}</Text>
            {busy || item.unread > 0 ? <Text style={{ color: line.tone || C.accent, fontFamily: F.m, fontSize: 10.5 }} numberOfLines={1}>{busy ? (line.state === 'waiting' ? 'espera você' : 'trabalhando') : 'mensagem nova'}</Text> : null}</View>
        </Pressable>; })}
        {onTeam ? <Pressable accessibilityRole="button" accessibilityLabel="Ver a equipe inteira" onPress={onTeam} style={({ pressed, hovered }) => [{ height: 44, paddingHorizontal: 14, borderRadius: 22, justifyContent: 'center' }, hovered && { backgroundColor: C.surface }, pressed && { opacity: 0.7 }]}>
          <Text style={{ color: C.muted, fontFamily: F.m, fontSize: 13 }}>Equipe</Text></Pressable> : null}
      </ScrollView> : null}
      {onSuggest ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, paddingHorizontal: 16 }}>
        {SUGGESTIONS.map(text => <Pressable key={text} accessibilityRole="button" onPress={() => onSuggest(text.replace(/…$/, ' '))} style={({ pressed, hovered }) => [{ paddingVertical: 7, paddingHorizontal: 13, borderRadius: 16, borderWidth: 1, borderColor: C.line2 }, hovered && { backgroundColor: C.surface }, pressed && { opacity: 0.7 }]}>
          <Text style={{ color: C.text2, fontFamily: F.m, fontSize: 13 }}>{text}</Text></Pressable>)}
      </View> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'center', paddingHorizontal: 16 }}>
      {resume && onResume ? <Pressable accessibilityRole="button" accessibilityLabel={`Continuar a sessão ${resume}`} onPress={onResume} style={({ pressed }) => [{ maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 18, borderWidth: 1, borderColor: C.accent + '66', backgroundColor: C.accent + '14', paddingVertical: 8, paddingHorizontal: 14 }, pressed && { opacity: 0.7 }]}>
        <Icon name="right" size={14} color={C.accent} /><Text numberOfLines={1} style={{ flexShrink: 1, color: C.accent, fontFamily: F.b, fontSize: 13.5 }}>Continuar: {resume}</Text></Pressable> : null}
      {onSessions ? <Pressable accessibilityRole="button" onPress={onSessions} style={{ paddingVertical: 6, paddingHorizontal: 12 }}>
        <Text style={{ color: C.muted, fontFamily: F.m, fontSize: 13 }}>Ver sessões</Text></Pressable> : null}
      </View>
    </View>
  </View>;
}
