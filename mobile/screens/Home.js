import { offline, Avatar, IconButton, greeting, Notice, UpdateCard, TodayStrip, ApprovalCard, RoomCard, BotCard, PrimaryButton, NavBar } from '../components/shared';
import { View, ScrollView, Text, Pressable } from 'react-native';
import { styles } from '../styles';
import { desktop } from '../desktop';
import { Icon, C } from '../theme';

export function HomeScreen({ data, error, onRetry, onLogs, onCreate, onOpen, onConnection, mode, onMode, onProfile, onMaintenance, onActivity, onRespond, approvalBusy, update, onUpdate, onUpdateDismiss, onRoom, onNewRoom }) {
  const bots = [...(data?.bots || [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const status = data?.connection?.loggedIn ? data.connection.message || 'Conectado' : data?.connection?.message || 'Verificando Codex…';
  const working = (data?.active || []).filter(id => !offline(data, id)).length;
  return <View style={{ flex: 1 }}><ScrollView contentContainerStyle={styles.homeContent} keyboardShouldPersistTaps="handled">
    <View style={styles.homeHeader}>
      <View style={styles.brandRow}><Avatar bot={{ name: 'MyBots', color: 'green', avatar: 'orbit' }} size={34} tile={false} /><Text style={styles.brand}>mybots</Text></View>
      <View style={styles.headerActions}>
        <Pressable accessibilityRole="button" accessibilityLabel="Trocar modo de conexão" disabled={Boolean(desktop)} onPress={onMode} style={styles.modeButton}><View style={[styles.statusDot, data?.connection?.loggedIn && styles.statusGood]} /><Text style={styles.modeButtonText}>{desktop ? 'No computador' : mode === 'phone' ? 'No celular' : 'No PC'}</Text></Pressable>
        <IconButton icon="refresh" label="Atualizar conexão" onPress={onConnection} size={38} />
      </View>
    </View>
    <Text style={styles.greeting} numberOfLines={2}>{greeting()}{data?.person?.name ? `, ${data.person.name}` : ''}.</Text>
    <Text style={styles.tagline}>{bots.length ? `${bots.length} ${bots.length > 1 ? 'bots no seu time' : 'bot no seu time'}${working ? ` · ${working} trabalhando agora` : ''}` : 'Seu pequeno time pessoal começa aqui.'}</Text>
    {error ? <Notice text={error} onRetry={onRetry} onLogs={onLogs} /> : null}
    {!data?.connection?.loggedIn && !error ? <Notice text={status} onRetry={onConnection} /> : null}
    {data?.modelsError ? <Notice text={data.modelsError} onRetry={onConnection} /> : null}
    {update?.info?.available && !update.dismissed ? <UpdateCard update={update} onInstall={onUpdate} onDismiss={onUpdateDismiss} /> : null}
    {bots.length ? <TodayStrip data={data} onActivity={mode === 'phone' ? onActivity : onConnection} /> : null}
    {(data?.approvals || []).map(approval => <ApprovalCard key={approval.id} approval={approval} bot={bots.find(bot => bot.id === approval.botId)} onRespond={onRespond} busy={approvalBusy === approval.id} />)}
    {mode === 'phone' && (data?.rooms?.length || bots.length >= 2) ? <>
      <View style={styles.listHeading}><Text style={styles.sectionTitle}>Salas</Text>
        <Pressable accessibilityRole="button" disabled={bots.length < 2} onPress={onNewRoom} style={({ pressed }) => [styles.newBotButton, pressed && styles.pressed]}><Icon name="plus" size={16} color={C.mint} stroke={2.2} /><Text style={styles.newBotText}>Nova sala</Text></Pressable></View>
      {(data?.rooms || []).length ? data.rooms.map(room => <RoomCard key={room.id} room={room} bots={data.bots || []} onPress={() => onRoom(room.id)} />)
        : <Text style={styles.roomHint}>Junte vários bots numa conversa: eles respondem um de cada vez e podem se chamar com @.</Text>}
    </> : null}
    {bots.length ? <View style={styles.listHeading}><Text style={styles.sectionTitle}>Seus bots</Text>
      <Pressable accessibilityRole="button" disabled={!data?.models?.length} onPress={onCreate} style={({ pressed }) => [styles.newBotButton, pressed && styles.pressed]}><Icon name="plus" size={16} color={C.mint} stroke={2.2} /><Text style={styles.newBotText}>Novo</Text></Pressable></View> : null}
    {bots.length ? bots.map(bot => <BotCard key={bot.id} bot={bot} busy={data.active?.includes(bot.id)} waiting={data.approvals?.some(item => item.botId === bot.id)} presence={data.presence?.[bot.id]}
      routines={(data.routines || []).filter(item => item.botId === bot.id && item.enabled).length} items={(data.pendingItems || []).filter(item => item.botId === bot.id && item.state === 'open').length}
      onPress={() => onOpen(bot.id)} onProfile={() => onProfile(bot)} />)
      : <View style={styles.emptyBots}>
        <View style={styles.emptyCrew}>{[['orbit', 'green'], ['spark', 'purple'], ['cat', 'orange'], ['pixel', 'blue']].map(([avatar, color], index) => <View key={avatar} style={{ marginTop: index % 2 ? 18 : 0 }}><Avatar bot={{ name: avatar, avatar, color, id: avatar }} size={index === 0 ? 74 : 60} /></View>)}</View>
        <Text style={styles.emptyTitle}>Monte seu time.</Text>
        <Text style={styles.emptyText}>Cada bot cuida de uma parte da sua vida: faculdade, e-mails, lembretes. Você decide o que cada um pode fazer.</Text>
        <PrimaryButton icon="plus" title="Criar meu primeiro bot" onPress={onCreate} disabled={!data?.models?.length} style={{ marginTop: 20, alignSelf: 'stretch' }} />
      </View>}
    <View style={styles.homeFooter}><Icon name="shield" size={14} color={C.faint} /><Text style={styles.homeFooterText}>{mode === 'phone' ? 'Bots, conversas e arquivos ficam neste celular.' : 'Bots e conversas ficam no computador.'}</Text></View>
  </ScrollView>
  <NavBar mode={mode} onActivity={onActivity} onMaintenance={onMaintenance} onConnection={onConnection} onMode={onMode} attention={Boolean(data?.approvals?.length)} />
  </View>;
}
