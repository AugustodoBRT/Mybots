import { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useStore } from '../state/useStore';
import { teamStatus, delegationCards } from '../state/chief-home';
import { C, F, Icon, themed } from '../theme';

const s = themed(() => ({
  bar: { paddingHorizontal: 16, paddingVertical: 7, borderBottomWidth: 1, borderColor: C.line, gap: 4 },
  link: { paddingVertical: 5, flexDirection: 'row', gap: 8, alignItems: 'center' },
  status: { color: C.text2, fontFamily: F.m, fontSize: 13, flexShrink: 1 },
  approval: { color: C.amber, fontFamily: F.b, fontSize: 13 },
  card: { backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  room: { color: C.muted, fontSize: 12, fontFamily: F.m }
}));

const selectStatus = ({ data }) => data && ({ bots: data.bots.map(({ id }) => ({ id })), approvals: data.approvals, active: data.active, presence: data.presence, pendingItems: data.pendingItems, timeZone: data.timeZone });
export function ChiefStatus({ onTeam }) {
  const data = useStore(selectStatus);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  if (!data) return null;
  const { working, waiting, soon } = teamStatus(data, now);
  const status = [working && working + ' trabalhando', waiting && waiting + ' esperando você', soon && soon + (soon === 1 ? ' pendência' : ' pendências') + ' com prazo próximo'].filter(Boolean).join(' · ');
  const count = data.approvals?.length || 0;
  return status || count ? <View style={s.bar}>
    {status ? <Pressable accessibilityRole="button" onPress={onTeam} style={s.link}><Text style={s.status}>{status}</Text><Icon name="right" size={14} color={C.muted} /></Pressable> : null}
    {count ? <Pressable accessibilityRole="button" onPress={onTeam} style={s.link}><Icon name="shield" size={15} color={C.amber} /><Text style={s.approval}>Revisar {count} {count === 1 ? 'aprovação' : 'aprovações'}</Text></Pressable> : null}
  </View> : null;
}

// Only what happened after the last message of the conversation: once the person writes or the Chefe answers, the cards go away.
export function DelegationCards({ onRoom, since = '' }) {
  const all = useStore(delegationCards);
  const cards = all.filter(card => card.at > since);
  return cards.length ? <View style={{ gap: 6 }}>{cards.map(card => <Pressable key={card.id} accessibilityRole="button" onPress={() => onRoom(card.roomId)} style={s.card}>
    <Icon name="bots" size={18} color={C.accent} /><View style={{ flex: 1 }}><Text style={s.status}>{card.label}</Text><Text style={s.room}>{card.room}</Text></View><Icon name="right" size={15} color={C.muted} />
  </Pressable>)}</View> : null;
}
