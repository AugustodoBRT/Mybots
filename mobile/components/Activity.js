import { View, ScrollView, Text, Pressable } from 'react-native';
import { styles } from '../styles';
import { C, Icon, F, themed } from '../theme';
import { Avatar, ApprovalCard, ItemsByDeadline } from './shared';
import { LimitsRow, UsageChartCard, BotSpendCard } from './Usage';

const s = themed(() => ({
  cols: { flex: 1, flexDirection: 'row', gap: 32 },
  main: { flex: 1.9, minWidth: 0 },
  side: { flex: 1, minWidth: 340, maxWidth: 560 },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingBottom: 10, marginBottom: 6, marginTop: 4, borderBottomWidth: 1, borderBottomColor: C.line },
  title: { color: C.text, fontFamily: F.x, fontSize: 18, letterSpacing: -0.4 }, count: { color: C.muted, fontFamily: F.m, fontSize: 14 },
  empty: { color: C.muted, fontFamily: F.m, fontSize: 14.5, lineHeight: 21, paddingVertical: 10, marginBottom: 14 },
  task: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line },
  who: { color: C.text, fontFamily: F.b, fontSize: 15 }, what: { color: C.muted, fontFamily: F.m, fontSize: 13.5, marginTop: 2 }
}));

// What the bots did today that ended well (or not), as plain lines.
const FINISHED = /done|created|accepted|reminder|downloaded|fail|denied|late|error/;

/**
 * The computer's Activity as a dashboard: on the left the plans' limits side by side, the line of the week's spend and what each
 * bot spent; on the right what needs the person, what is running and what finished today.
 */
export function ActivityColumns({ data, call, reload, cancelTask, completeItem }) {
  const bots = data?.bots || []; const name = id => bots.find(bot => bot.id === id)?.name || '';
  const approvals = data?.approvals || []; const open = (data?.pendingItems || []).filter(item => item.state === 'open');
  const running = (data?.tasks || []).filter(task => ['queued', 'running', 'waiting_approval'].includes(task.state));
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const finished = (data?.activity || []).filter(item => FINISHED.test(item.kind) && !/^task_/.test(item.kind) && new Date(item.created_at) >= midnight).slice(0, 40);
  return <View style={s.cols}>
    <ScrollView style={s.main} contentContainerStyle={{ paddingBottom: 30 }}>
      <LimitsRow usage={data?.usage} connections={data?.connections} onRefresh={async provider => { await call.method('limits.refresh', { provider }); await reload(); }} />
      <UsageChartCard usage={data?.usage} />
      <BotSpendCard usage={data?.usage} bots={bots} />
    </ScrollView>
    <ScrollView style={s.side} contentContainerStyle={{ paddingBottom: 30 }}>
      <View style={s.head}><Text style={s.title}>Precisa de você</Text><Text style={s.count}>{approvals.length + open.length}</Text></View>
      {approvals.map(approval => <ApprovalCard key={approval.id} approval={approval} bot={bots.find(bot => bot.id === approval.botId)} onRespond={(...args) => call.respond(...args)} busy={call.busy === approval.id} />)}
      <ItemsByDeadline items={open} bots={bots} onComplete={completeItem} />
      {!approvals.length && !open.length ? <Text style={s.empty}>Nenhuma decisão nem prazo por perto.</Text> : null}
      <View style={s.head}><Text style={s.title}>Em andamento</Text><Text style={s.count}>{running.length}</Text></View>
      {running.map(task => <View key={task.id} style={s.task}>
        <Avatar bot={bots.find(item => item.id === task.bot_id) || { name: 'Bot' }} size={36} state={task.state === 'waiting_approval' ? 'waiting' : 'working'} />
        <View style={{ flex: 1 }}><Text style={s.who}>{name(task.bot_id) || 'Bot'}</Text><Text style={s.what}>{({ queued: 'Na fila', running: 'Respondendo', waiting_approval: 'Aguardando decisão' })[task.state]}</Text></View>
        <Pressable accessibilityRole="button" onPress={() => cancelTask(task.id)} style={styles.stopButton}><Icon name="stop" size={13} color={C.muted} /><Text style={styles.stopText}>Parar</Text></Pressable>
      </View>)}
      {!running.length ? <Text style={s.empty}>Nenhum bot trabalhando agora.</Text> : null}
      <View style={s.head}><Text style={s.title}>Concluído hoje</Text><Text style={s.count}>{finished.length}</Text></View>
      {finished.map(item => <View key={item.id} style={styles.timelineRow}>
        <View style={[styles.timelineDot, /fail|denied|late|error/.test(item.kind) && { backgroundColor: C.red }, /done|created|accepted|reminder|downloaded/.test(item.kind) && { backgroundColor: C.accent }]} />
        <View style={{ flex: 1 }}><Text style={styles.timelineText}>{item.detail}</Text><Text style={styles.timelineMeta}>{name(item.bot_id) ? `${name(item.bot_id)} · ` : ''}{new Date(item.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</Text></View>
      </View>)}
      {!finished.length ? <Text style={s.empty}>Nada concluído ainda hoje.</Text> : null}
    </ScrollView>
  </View>;
}

/** Atividade as a whole page next to the computer's icon bar. */
export function ActivityPage({ data, ...columns }) {
  return <View style={{ flex: 1, paddingHorizontal: 32, paddingTop: 26 }}>
    <Text style={{ color: C.text, fontFamily: F.x, fontSize: 28, letterSpacing: -0.8 }}>Atividade</Text>
    <Text style={{ color: C.muted, fontFamily: F.m, fontSize: 15, marginTop: 4, marginBottom: 18 }}>{`${data?.supervisorConnected ? 'Celular conectado' : 'Celular fora de alcance'} · último sinal ${data?.heartbeat ? new Date(data.heartbeat).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'não confirmado'}`}</Text>
    <ActivityColumns data={data} {...columns} />
  </View>;
}
