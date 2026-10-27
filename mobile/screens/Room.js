import { useStickyScroll, nativeMessage, IconButton, RoomFaces, Dots, EarlierButton, ApprovalCard, Avatar, offline, HUE_OF, ToEndButton, Composer } from '../components/shared';
import { useRef, useState } from 'react';
import { pickFile } from '../termux';
import { KeyboardAvoidingView, Platform, View, Text, ScrollView, Pressable } from 'react-native';
import { styles } from '../styles';
import { C, Icon } from '../theme';
import { Message } from '../components/Message';
import { FileChip } from '../RichMessage';

export function RoomScreen({ room, data, onBack, onSend, onEdit, onCancel, onRespond, approvalBusy, onFile, fileBusy, phone, call, more, onEarlier }) {
  const { scroll, toEnd, away, props: scrollProps } = useStickyScroll(); const input = useRef(null);
  const [draft, setDraft] = useState(''); const [sending, setSending] = useState(false); const [error, setError] = useState(''); const [files, setFiles] = useState([]);
  const members = room.botIds.map(id => data.bots.find(bot => bot.id === id)).filter(Boolean);
  const byId = Object.fromEntries(members.map(bot => [bot.id, bot]));
  // The room's loaded pages; older ones come on demand, a page at a time.
  const shown = room.messages;
  const working = members.filter(bot => room.active?.includes(bot.id));
  const approvals = (data.approvals || []).filter(item => room.activeTasks?.includes(item.taskId));
  const named = members.filter(bot => new RegExp(`@${bot.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`, 'iu').test(draft));
  const send = async text => {
    if ((!text.trim() && !files.length) || sending) return; setSending(true); setError('');
    try { await onSend(text, files); setDraft(''); setFiles([]); toEnd(); } catch (e) { setError(nativeMessage(e)); } finally { setSending(false); }
  };
  // Files go to the room like to a private chat (phone mode): every bot in it can read them.
  const attach = async () => {
    setError('');
    try {
      const file = await pickFile(); if (!file) return;
      if (files.reduce((sum, item) => sum + item.size, file.size) > 10 * 1024 * 1024) throw new Error('Os anexos de uma mensagem podem somar até 10 MB.');
      setFiles(old => [...old, file]);
    } catch (e) { setError(nativeMessage(e)); }
  };
  const mention = bot => { setDraft(old => (old.trim() ? old.replace(/\s*$/, ' ') : '') + `@${bot.name} `); input.current?.focus(); };
  const retry = message => { const asked = shown.find(item => item.id === message.replyTo); const bot = byId[message.botId]; if (asked && bot) send(`@${bot.name} ${asked.text.replace(/@\S+\s?/g, '').trim() || asked.text}`); };
  return <KeyboardAvoidingView style={styles.chatScreen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <View style={styles.chatHeader}>
      {onBack ? <IconButton icon="back" label="Voltar" onPress={onBack} size={40} /> : null}
      <RoomFaces bots={members} size={40} />
      <View style={styles.chatTitleCopy}>
        <Text style={styles.chatTitle} numberOfLines={1}>{room.name}</Text>
        {working.length ? <View style={styles.botWorking}><Text style={[styles.chatSubtitle, { color: C.mint }]} numberOfLines={1}>{working.map(bot => bot.name).join(', ')} respondendo</Text><Dots /></View>
          : <Text style={styles.chatSubtitle} numberOfLines={1}>{members.map(bot => bot.name).join(', ')}</Text>}
      </View>
      <IconButton icon="more" label="Editar sala" onPress={onEdit} size={40} />
    </View>
    <View style={styles.messagesWrap}>
    <ScrollView ref={scroll} style={styles.messages} contentContainerStyle={styles.messagesContent} keyboardShouldPersistTaps="handled" {...scrollProps} maintainVisibleContentPosition={{ minIndexForVisible: more ? 1 : 0 }}>
      {more ? <EarlierButton onPress={onEarlier} /> : null}
      {!shown.length ? <View style={styles.chatEmpty}><RoomFaces bots={members} size={72} />
        <Text style={styles.chatEmptyTitle}>{room.name}</Text>
        <Text style={styles.chatEmptyText}>Escreva para todos ou chame alguém com @. Os bots também podem se chamar entre si.</Text></View> : null}
      {shown.map(message => message.role === 'system' ? <Text key={message.id} style={styles.roomGone}>{message.text}</Text> : message.role === 'user' || byId[message.botId]
        ? <Message key={message.id} message={message} bot={byId[message.botId] || members[0]} models={data.models || []} busy={sending} onRetry={() => retry(message)} onFile={onFile} fileBusy={fileBusy} />
        : <Text key={message.id} style={styles.roomGone}>Um bot que saiu da sala respondeu aqui.</Text>)}
      {approvals.map(approval => <ApprovalCard key={approval.id} approval={approval} bot={byId[approval.botId]} onRespond={onRespond} busy={approvalBusy === approval.id} />)}
      {working.map(bot => <View key={bot.id} style={styles.thinking}><Avatar bot={bot} size={34} state={approvals.some(item => item.botId === bot.id) ? 'waiting' : offline(data, bot.id) ? 'sleeping' : 'working'} tile={false} />
        <View style={styles.thinkingCard}><View style={styles.botWorking}><Text style={styles.thinkingText}>{bot.name} {offline(data, bot.id) ? 'responde quando o computador ligar' : data.tasks?.find(task => room.activeTasks?.includes(task.id) && task.bot_id === bot.id)?.state === 'queued' ? 'na fila' : 'pensando'}</Text>{offline(data, bot.id) ? null : <Dots color={HUE_OF(bot)} />}</View>
          {(() => { const step = data.tasks?.find(task => room.activeTasks?.includes(task.id) && task.bot_id === bot.id)?.step; return step ? <Text style={styles.thinkingStep} numberOfLines={1}>{step}</Text> : null; })()}
          <Pressable accessibilityRole="button" onPress={() => onCancel(bot.id)} hitSlop={8} style={styles.stopButton}><Icon name="stop" size={13} color={C.muted} /><Text style={styles.stopText}>Parar</Text></Pressable></View>
      </View>)}
    </ScrollView>
    {away ? <ToEndButton onPress={toEnd} /> : null}
    </View>
    <View style={styles.composerArea}>
      {error ? <Text style={styles.composerError}>{error}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.mentionBar} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">
        {members.map(bot => <Pressable key={bot.id} accessibilityRole="button" accessibilityLabel={`Chamar ${bot.name}`} onPress={() => mention(bot)} style={({ pressed }) => [styles.mentionChip, named.includes(bot) && styles.mentionChipOn, pressed && styles.pressed]}>
          <Avatar bot={bot} size={22} animated={false} tile={false} /><Text style={[styles.mentionText, named.includes(bot) && { color: C.mint }]}>@{bot.name}</Text></Pressable>)}
      </ScrollView>
      {files.length ? <ScrollView horizontal style={styles.fileTray} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">{files.map((file, index) =>
        <View key={index} style={styles.fileChip}><FileChip file={file} onRemove={() => setFiles(old => old.filter((_, i) => i !== index))} /></View>)}</ScrollView> : null}
      <Composer inputRef={input} value={draft} setValue={setDraft} editable={!sending} canSend={(Boolean(draft.trim()) || files.length > 0) && !sending} phone={phone} call={call} onError={setError}
        onAttach={phone ? attach : null} attachDisabled={sending || files.length >= 5}
        onSend={() => send(draft)} accessibilityLabel="Mensagem para a sala"
        placeholder={named.length ? `Só ${named.map(bot => bot.name).join(' e ')} ${named.length > 1 ? 'respondem' : 'responde'}…` : 'Sem @, todos os bots respondem…'} />
    </View>
  </KeyboardAvoidingView>;
}
