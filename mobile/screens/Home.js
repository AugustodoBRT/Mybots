import { useState } from 'react';
import { useStore } from '../state/useStore';
import { selectHome } from '../state/store';
import { offline, Avatar, IconButton, greeting, Notice, UpdateCard, ApprovalCard, RoomFaces, PrimaryButton, latestOf, latestInRoom, plain, seenText, shortTime, Dots } from '../components/shared';
import { Drawer } from '../components/Drawer';
import { CommandBar } from '../components/CommandBar';
import { RoutinesSheet, NegotiationsSheet } from '../components/Lists';
import { View, ScrollView, Text, Pressable } from 'react-native';
import { styles, TOP } from '../styles';
import { desktop } from '../desktop';
import { Icon, C, F, themed, hueOf } from '../theme';

const s = themed(() => ({
  content: { paddingHorizontal: 20, paddingTop: TOP + 10, paddingBottom: 130 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  wordmark: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 3 },
  wordmarkText: { color: C.text, fontFamily: F.x, fontSize: 24, letterSpacing: -0.9 },
  wordmarkDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.accent, marginTop: 9 },
  modeChip: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line, marginTop: 6 },
  greeting: { color: C.text, fontFamily: F.x, fontSize: 28, letterSpacing: -0.9, marginTop: 20 },
  today: { color: C.muted, fontFamily: F.m, fontSize: 15, lineHeight: 22, marginTop: 4, marginBottom: 22 },
  todayLink: { color: C.text2 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 26, marginBottom: 4 },
  headingText: { color: C.text, fontFamily: F.b, fontSize: 19, letterSpacing: -0.4 },
  headingAction: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingLeft: 10 },
  headingActionText: { color: C.accent, fontFamily: F.b, fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: C.line },
  rowCopy: { flex: 1, gap: 3 },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  name: { color: C.text, fontFamily: F.b, fontSize: 17, flexShrink: 1 },
  stateWord: { fontFamily: F.m, fontSize: 13.5, flexShrink: 1 },
  time: { marginLeft: 'auto', color: C.muted, fontFamily: F.m, fontSize: 12.5 },
  preview: { color: C.muted, fontFamily: F.m, fontSize: 14.5, lineHeight: 20 },
  facts: { color: C.faint, fontFamily: F.m, fontSize: 12.5 },
  unread: { minWidth: 20, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 10, overflow: 'hidden', backgroundColor: C.accent, color: C.accentInk, fontFamily: F.b, fontSize: 11.5, textAlign: 'center' },
  more: { width: 34, height: 40, alignItems: 'center', justifyContent: 'center' },
  hint: { color: C.muted, fontFamily: F.m, fontSize: 14.5, lineHeight: 21, paddingVertical: 10 },
  empty: { alignItems: 'center', paddingTop: 40, gap: 6 },
  emptyTitle: { color: C.text, fontFamily: F.x, fontSize: 26, letterSpacing: -0.8, marginTop: 14 },
  emptyText: { color: C.muted, fontFamily: F.m, fontSize: 15, lineHeight: 22, textAlign: 'center', maxWidth: 320 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 30 },
  footerText: { color: C.faint, fontFamily: F.m, fontSize: 12.5 }
}));

const stateOf = (bot, data) => {
  const asleep = offline(data, bot.id), waiting = data.approvals?.some(item => item.botId === bot.id), busy = data.active?.includes(bot.id);
  return waiting ? 'waiting' : asleep ? 'sleeping' : busy ? 'working' : 'idle';
};

// One conversation per line: face with its state, name, a few words about what is going on, the time, a line of preview.
function BotRow({ bot, data, onPress, onProfile }) {
  const state = stateOf(bot, data), presence = data.presence?.[bot.id], hue = hueOf(bot);
  const latest = latestOf(bot);
  const preview = latest?.origin === 'routine' ? `Rotina · ${latest.routineTitle}` : latest?.attachments?.length && latest.text === 'Veja o anexo.' ? latest.attachments[0].name : plain(latest?.text);
  const updated = new Date(bot.updatedAt);
  const time = Date.now() - updated < 86400000 ? updated.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : updated.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const routines = (data.routines || []).filter(item => item.botId === bot.id && item.enabled).length;
  const items = (data.pendingItems || []).filter(item => item.botId === bot.id && item.state === 'open').length;
  const word = state === 'waiting' ? ['espera você', C.amber] : state === 'sleeping' ? [data.active?.includes(bot.id) ? 'esperando o computador' : 'dormindo', C.muted] : state === 'working' ? ['trabalhando', hue] : null;
  const facts = [routines ? `${routines} ${routines > 1 ? 'rotinas' : 'rotina'}` : '', items ? `${items} ${items > 1 ? 'pendências' : 'pendência'}` : ''].filter(Boolean).join(' · ');
  return <Pressable accessibilityRole="button" accessibilityLabel={`Conversar com ${bot.name}`} onPress={onPress} style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}>
    <Avatar bot={bot} size={52} state={state} />
    <View style={s.rowCopy}>
      <View style={s.rowTop}>
        <Text style={s.name} numberOfLines={1}>{bot.name}</Text>
        {word ? <Text style={[s.stateWord, { color: word[1] }]} numberOfLines={1}>{word[0]}</Text> : null}
        <Text style={s.time}>{time}</Text>{bot.unread ? <Text style={s.unread}>{bot.unread > 99 ? '99+' : bot.unread}</Text> : null}
      </View>
      <Text style={s.preview} numberOfLines={1}>{state === 'sleeping' && !data.active?.includes(bot.id) ? seenText(presence) : preview || 'Pronto para começar'}</Text>
      {facts ? <Text style={s.facts}>{facts}</Text> : null}
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={`Perfil de ${bot.name}`} hitSlop={8} onPress={event => { event.stopPropagation(); onProfile(); }} style={s.more}><Icon name="more" size={20} color={C.faint} /></Pressable>
  </Pressable>;
}

function RoomRow({ room, bots, data, onPress }) {
  const members = room.botIds.map(id => bots.find(bot => bot.id === id)).filter(Boolean);
  const latest = latestInRoom(room); const who = latest?.role === 'user' ? 'Você' : bots.find(bot => bot.id === latest?.botId)?.name;
  const working = members.filter(bot => room.active?.includes(bot.id));
  return <Pressable accessibilityRole="button" accessibilityLabel={`Abrir a sala ${room.name}`} onPress={onPress} style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}>
    <RoomFaces bots={members} size={44} />
    <View style={s.rowCopy}>
      <View style={s.rowTop}><Text style={s.name} numberOfLines={1}>{room.name}</Text>{working.length ? <Text style={[s.stateWord, { color: C.accent }]} numberOfLines={1}>{working.length > 1 ? `${working.length} respondendo` : `${working[0].name} respondendo`}</Text> : null}
        <Text style={s.time}>{latest ? shortTime(latest.createdAt) : ''}</Text></View>
      <Text style={s.preview} numberOfLines={2}>{latest ? `${who ? `${who}: ` : ''}${plain(latest.text)}` : members.map(bot => bot.name).join(', ')}</Text>
    </View>
  </Pressable>;
}

function HomeView({ data, error, onRetry, onLogs, onCreate, onOpen, onConnection, mode, onMode, onProfile, onMaintenance, onWallet, onActivity, onRespond, approvalBusy, update, onUpdate, onUpdateDismiss, onRoom, onNewRoom, onSearch }) {
  const [menu, setMenu] = useState(false); const [routinesOpen, setRoutinesOpen] = useState(false); const [negotiationsOpen, setNegotiationsOpen] = useState(false);
  const bots = [...(data?.bots || [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const status = data?.connection?.loggedIn ? data.connection.message || 'Conectado' : data?.connection?.message || 'Verificando Codex…';
  const working = (data?.active || []).filter(id => !offline(data, id)).length;
  const waiting = (data?.approvals || []).length;
  const openItems = (data?.pendingItems || []).filter(item => item.state === 'open').length;
  const routines = (data?.routines || []).filter(item => item.enabled).length;
  const open = (data?.negotiations || []).filter(item => item.status === 'active' || item.status === 'awaiting_you');
  const phone = mode === 'phone';
  const nextDue = (data?.pendingItems || []).filter(item => item.state === 'open' && item.due).sort((a, b) => a.due.localeCompare(b.due))[0];
  const ahead = [nextDue ? `Próximo prazo: ${nextDue.title}, ${nextDue.dueLabel || nextDue.due}` : '', data?.nextRoutineAt ? `Próxima rotina: ${new Date(data.nextRoutineAt).toLocaleString('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ''].filter(Boolean);
  const summary = [working ? `${working} trabalhando` : '', waiting ? `${waiting} ${waiting > 1 ? 'esperam' : 'espera'} você` : '', openItems ? `${openItems} ${openItems > 1 ? 'pendências' : 'pendência'}` : ''].filter(Boolean).join(' · ');
  const menuItems = [
    { key: 'chats', label: 'Conversas', icon: 'bots', on: true },
    ...(phone ? [{ key: 'activity', label: 'Atividade', icon: 'activity', dot: waiting > 0, onPress: onActivity }] : [{ key: 'activity', label: 'Conexão', icon: 'activity', onPress: onConnection }]),
    ...(onWallet ? [{ key: 'wallet', label: 'Carteira', icon: 'wallet', onPress: onWallet }] : []),
    ...(phone ? [{ key: 'routines', label: 'Rotinas', icon: 'bolt', count: routines || null, onPress: () => setRoutinesOpen(true) },
      { key: 'negotiations', label: 'Negociações', icon: 'hand', count: open.length || null, dot: open.some(item => item.status === 'awaiting_you'), onPress: () => setNegotiationsOpen(true) }] : []),
    { key: 'rule', rule: true },
    { key: 'settings', label: 'Ajustes', icon: 'settings', onPress: phone ? onMaintenance : onMode }
  ];
  return <View style={{ flex: 1 }}>
    <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <View style={s.header}>
        <View><IconButton icon="menu" label={waiting ? 'Abrir o menu, algo espera você' : 'Abrir o menu'} onPress={() => setMenu(true)} size={42} />
          {waiting ? <View style={{ position: 'absolute', top: 2, right: 2, width: 11, height: 11, borderRadius: 6, backgroundColor: C.accent, borderWidth: 2, borderColor: C.bg }} /> : null}</View>
        <View style={s.wordmark}><Text style={s.wordmarkText}>mybots</Text><View style={s.wordmarkDot} /></View>
        <IconButton icon="refresh" label="Atualizar conexão" onPress={onConnection} size={42} />
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Trocar modo de conexão" disabled={Boolean(desktop)} onPress={onMode} style={s.modeChip}>
        <View style={[styles.statusDot, data?.connection?.loggedIn && styles.statusGood]} />
        <Text style={styles.modeButtonText}>{desktop ? 'No computador' : phone ? 'No celular' : 'No PC'}</Text>
      </Pressable>
      <Text style={s.greeting} numberOfLines={2}>{greeting()}{data?.person?.name ? `, ${data.person.name}` : ''}.</Text>
      {bots.length ? <Pressable accessibilityRole="button" disabled={!summary} onPress={phone ? onActivity : onConnection}>
        <Text style={s.today}>{summary ? <Text style={s.todayLink}>{summary}</Text> : `${bots.length} ${bots.length > 1 ? 'bots no seu time' : 'bot no seu time'}. Tudo em dia.`}</Text></Pressable>
        : <Text style={s.today}>Seu pequeno time pessoal começa aqui.</Text>}
      {bots.length && ahead.length ? <View style={{ marginTop: -14, marginBottom: 20, gap: 2 }}>{ahead.map(line => <Text key={line} style={s.facts} numberOfLines={1}>{line}</Text>)}</View> : null}
      {error ? <Notice text={error} onRetry={onRetry} onLogs={onLogs} /> : null}
      {!data?.connection?.loggedIn && !error ? <Notice text={status} onRetry={onConnection} /> : null}
      {data?.modelsError ? <Notice text={data.modelsError} onRetry={onConnection} /> : null}
      {update?.info?.available && !update.dismissed ? <UpdateCard update={update} onInstall={onUpdate} onDismiss={onUpdateDismiss} /> : null}
      {(data?.approvals || []).map(approval => <ApprovalCard key={approval.id} approval={approval} bot={bots.find(bot => bot.id === approval.botId)} onRespond={onRespond} busy={approvalBusy === approval.id} />)}
      {phone && (data?.rooms?.length || bots.length >= 2) ? <>
        <View style={s.heading}><Text style={s.headingText}>Salas</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Nova sala" disabled={bots.length < 2} onPress={onNewRoom} style={({ pressed }) => [s.headingAction, bots.length < 2 && { opacity: 0.4 }, pressed && { opacity: 0.6 }]}><Icon name="plus" size={16} color={C.accent} stroke={2.2} /><Text style={s.headingActionText}>Nova</Text></Pressable></View>
        {(data?.rooms || []).length ? data.rooms.map(room => <RoomRow key={room.id} room={room} bots={data.bots || []} data={data} onPress={() => onRoom(room.id)} />)
          : <Text style={s.hint}>Junte vários bots numa conversa: eles respondem um de cada vez e podem se chamar com @.</Text>}
      </> : null}
      {bots.length ? <View style={s.heading}><Text style={s.headingText}>Seus bots</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Novo bot" disabled={!data?.models?.length} onPress={onCreate} style={({ pressed }) => [s.headingAction, !data?.models?.length && { opacity: 0.4 }, pressed && { opacity: 0.6 }]}><Icon name="plus" size={16} color={C.accent} stroke={2.2} /><Text style={s.headingActionText}>Novo</Text></Pressable></View> : null}
      {bots.length ? bots.map(bot => <BotRow key={bot.id} bot={bot} data={data} onPress={() => onOpen(bot.id)} onProfile={() => onProfile(bot)} />)
        : <View style={s.empty}>
          <Avatar bot={{ name: 'Atlas' }} size={120} state="idle" />
          <Text style={s.emptyTitle}>Monte seu time.</Text>
          <Text style={s.emptyText}>Cada bot cuida de uma parte da sua vida: faculdade, e-mails, lembretes. Você decide o que cada um pode fazer.</Text>
          <PrimaryButton icon="plus" title="Criar meu primeiro bot" onPress={onCreate} disabled={!data?.models?.length} style={{ marginTop: 20, alignSelf: 'stretch' }} />
        </View>}
      <View style={s.footer}><Icon name="shield" size={14} color={C.faint} /><Text style={s.footerText}>{phone ? 'Bots, conversas e arquivos ficam neste celular.' : 'Bots e conversas ficam no computador.'}</Text></View>
    </ScrollView>
    {phone && onSearch ? <CommandBar onPress={onSearch} /> : null}
    <Drawer visible={menu} onClose={() => setMenu(false)} items={menuItems} footer={phone ? 'Bots, conversas e arquivos ficam neste celular.' : 'Bots e conversas ficam no computador.'} />
    <RoutinesSheet visible={routinesOpen} routines={data?.routines || []} bots={data?.bots || []} onClose={() => setRoutinesOpen(false)} onOpen={onProfile} />
    <NegotiationsSheet visible={negotiationsOpen} negotiations={data?.negotiations || []} bots={data?.bots || []} onClose={() => setNegotiationsOpen(false)} onOpen={onProfile} />
  </View>;
}

export function HomeScreen(props) {
  const data = useStore(selectHome);
  return <HomeView {...props} data={data} />;
}
