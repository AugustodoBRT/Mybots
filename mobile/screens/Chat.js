import { useStickyScroll, offline, HUE_OF, IconButton, Avatar, Dots, seenText, findModel, EFFORT_NAMES, Notice, ModelSettings, EarlierButton, PasswordOfferCard, ApprovalCard, ToEndButton, Composer } from '../components/shared';
import { useState, useEffect } from 'react';
import { termuxAvailable, pickFile } from '../termux';
import { desktop } from '../desktop';
import { KeyboardAvoidingView, Platform, View, Pressable, Text, ScrollView } from 'react-native';
import { styles } from '../styles';
import { C, Icon } from '../theme';
import BotBrowserPanel, { BrowserHelpCard } from '../BotBrowserPanel';
import { Message } from '../components/Message';
import { FileChip } from '../RichMessage';

export function ChatScreen({ bot, data, error, onLogs, draft, setDraft, sending, saving, mode, onBack, onMode, onSend, onRetry, onSettings, onConnection, onDelete, onCancel, onProfile, onRespond, approvalBusy, onBrowserControl, browserCall, onFile, fileBusy, incoming, onIncoming, passwordAsk, onPasswordAnswer, more, onEarlier }) {
  const { scroll, toEnd, away, props: scrollProps } = useStickyScroll();
  const [showModels, setShowModels] = useState(false);
  const busy = sending || saving || data.active?.includes(bot.id);
  const selection = bot.model ? bot : data.defaultSelection;
  // A bot answering from the computer needs its IA logged in there, not on the phone; while the computer is off it just waits.
  const presence = data.presence?.[bot.id]; const computer = data.nodes?.find(node => node.online);
  const remote = presence?.where === 'pc' || (bot.home === 'pc' && !presence?.online);
  const own = remote ? (presence?.online ? computer?.connections?.[selection?.provider || 'codex'] || { loggedIn: false, message: 'Esta IA não está conectada no computador.' } : null) : data.connections?.[selection?.provider || 'codex'];
  const status = error || (own && !own.loggedIn ? own.message : !remote && !data.connection?.loggedIn ? data.connection?.message : data.modelsError);
  const phone = mode === 'phone' && termuxAvailable;
  // A bot answering from the computer browses in its own Chrome there, shown live here and in the computer's window.
  const pcBrowser = remote || data.browser?.pages?.[bot.id]?.where === 'pc';
  const browsing = phone || (desktop && pcBrowser);
  const [files, setFiles] = useState([]); const [composerError, setComposerError] = useState('');
  // The bot's own browser panel; it stays open while the person has taken over.
  const [browserOpen, setBrowserOpen] = useState(false); const [browserKey, setBrowserKey] = useState(0);
  const help = data.browser?.help?.[bot.id];
  const assumed = data.browser?.control?.[bot.id] === 'person';
  useEffect(() => { setFiles([]); setComposerError(''); setBrowserOpen(false); }, [bot.id]);
  // Files shared from another app land in the tray, ready to send with a message.
  useEffect(() => {
    if (!incoming) return;
    const room = 5 - files.length; const added = phone ? (incoming.files || []).slice(0, room) : [];
    if (added.length) setFiles(old => [...old, ...added]);
    const problems = [...(incoming.problems || []), ...(phone && (incoming.files || []).length > room ? ['Uma mensagem leva até 5 arquivos.'] : []), ...(!phone && incoming.files?.length ? ['Arquivos só chegam aos bots no modo Só no celular.'] : [])];
    setComposerError(problems.join(' '));
    onIncoming();
  }, [incoming]);
  useEffect(() => { if (assumed) setBrowserOpen(true); }, [assumed]);
  // While the bot works, new messages still go out and wait their turn (phone mode).
  const typing = phone ? sending || saving : busy;
  const canSend = !typing && (draft.trim() || files.length) && selection?.model;
  const attach = async () => {
    setComposerError('');
    try {
      const file = await pickFile(); if (!file) return;
      if (files.reduce((sum, item) => sum + item.size, file.size) > 10 * 1024 * 1024) throw new Error('Os anexos de uma mensagem podem somar até 10 MB.');
      setFiles(old => [...old, file]);
    } catch (e) { setComposerError(e.message); }
  };
  // The latest tool step of the running task, so the person sees what the bot is doing right now.
  const running = data.tasks?.find(task => task.bot_id === bot.id && ['queued', 'running', 'waiting_approval'].includes(task.state));
  const step = running && data.activity?.find(item => item.task_id === running.id && /^tool_|^approval_/.test(item.kind));
  const waiting = data.approvals?.some(item => item.botId === bot.id);
  const asleep = offline(data, bot.id);
  const working = data.active?.includes(bot.id) && !asleep;
  const hue = HUE_OF(bot);
  return <KeyboardAvoidingView style={styles.chatScreen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <View style={styles.chatHeader}>
      {onBack ? <IconButton icon="back" label="Voltar à lista de bots" onPress={onBack} size={40} /> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={`Abrir perfil de ${bot.name}`} onPress={onProfile}><Avatar bot={bot} size={44} state={waiting ? 'waiting' : asleep ? 'sleeping' : working ? 'working' : 'idle'} /></Pressable>
      <View style={styles.chatTitleCopy}>
        <Text style={styles.chatTitle} numberOfLines={1}>{bot.name}</Text>
        {waiting ? <Text style={[styles.chatSubtitle, { color: C.amber }]}>Esperando sua decisão</Text>
          : working ? <View style={styles.botWorking}><Text style={[styles.chatSubtitle, { color: hue }]}>Trabalhando</Text><Dots color={hue} /></View>
          : <Pressable accessibilityRole="button" accessibilityLabel="Alterar modelo e raciocínio" onPress={() => setShowModels(value => !value)} style={styles.modelToggle}>
            <Text style={styles.chatSubtitle} numberOfLines={1}>{asleep ? `Offline · ${seenText(data.presence[bot.id], true)}` : `${bot.home === 'any' && data.presence?.[bot.id]?.where === 'pc' ? 'No computador · ' : ''}${findModel(data.models || [], selection)?.displayName || 'Escolha o modelo'} · ${EFFORT_NAMES[selection?.reasoningEffort] || 'Padrão'}`}</Text><Icon name="down" size={13} color={C.muted} /></Pressable>}
      </View>
      {browsing ? <IconButton icon="globe" label={browserOpen ? 'Esconder navegador do bot' : 'Ver navegador do bot'} active={browserOpen || assumed} onPress={() => assumed ? setBrowserKey(key => key + 1) : setBrowserOpen(value => !value)} size={40} /> : null}
      <IconButton icon="more" label="Perfil e permissões" onPress={onProfile} size={40} />
    </View>
    {status ? <Notice text={status} onRetry={onConnection} onLogs={error ? onLogs : null} /> : null}
    {showModels && !working ? <View style={styles.modelPanel}><ModelSettings models={data.models || []} connections={data.connections} selection={selection} disabled={busy} onChange={onSettings} /></View> : null}
    {/* While the person drives, the browser cannot be lost: the globe brings the full screen back. */}
    {browsing && (browserOpen || assumed) ? <BotBrowserPanel key={browserKey} bot={bot} browser={data.browser} pc={pcBrowser} call={browserCall} onControl={onBrowserControl} onClose={() => setBrowserOpen(false)} /> : null}
    <View style={styles.messagesWrap}>
    <ScrollView ref={scroll} style={styles.messages} contentContainerStyle={styles.messagesContent} keyboardShouldPersistTaps="handled" {...scrollProps} maintainVisibleContentPosition={{ minIndexForVisible: more ? 1 : 0 }}>
      {more ? <EarlierButton onPress={onEarlier} /> : null}
      {!bot.messages.length && !bot.messageCount && <View style={styles.chatEmpty}><Avatar bot={bot} size={96} state={asleep ? 'sleeping' : 'idle'} /><Text style={styles.chatEmptyTitle}>Diga oi para {bot.name}.</Text>
        <Text style={styles.chatEmptyText}>Conte o que você precisa. Em Perfil você vê e muda o que este bot pode fazer.</Text>
        {['Oi! Vamos nos conhecer?', 'O que você consegue fazer por mim?'].map(text => <Pressable key={text} accessibilityRole="button" disabled={busy} onPress={() => onSend(text)} style={({ pressed }) => [styles.greetingButton, pressed && styles.pressed]}><Text style={styles.greetingText}>{text}</Text><Icon name="send" size={15} color={C.mint} /></Pressable>)}
      </View>}
      {bot.messages.map(message => <Message key={message.id} message={message} bot={bot} models={data.models || []} busy={busy} onRetry={onRetry} onFile={mode === 'phone' ? onFile : () => {}} fileBusy={fileBusy} />)}
      {phone && passwordAsk?.botId === bot.id ? <PasswordOfferCard offer={passwordAsk} bot={bot} onAnswer={onPasswordAnswer} /> : null}
      {browsing && help && !assumed ? <BrowserHelpCard bot={bot} help={help} onPc={pcBrowser} onOpen={() => { setBrowserOpen(true); onBrowserControl('person').catch(() => {}); }} /> : null}
      {(data.approvals || []).filter(item => item.botId === bot.id).map(approval => <ApprovalCard key={approval.id} approval={approval} bot={bot} onRespond={onRespond} busy={approvalBusy === approval.id} />)}
      {asleep && running ? <View style={styles.thinking}><Avatar bot={bot} size={34} state="sleeping" tile={false} />
        <View style={styles.thinkingCard}>
          <Text style={styles.thinkingText}>Esperando o computador ligar</Text>
          <Text style={styles.thinkingStep}>{bot.name} vive no computador. A mensagem segue assim que ele conectar.</Text>
          <Pressable accessibilityRole="button" onPress={onCancel} hitSlop={8} style={styles.stopButton}><Icon name="stop" size={13} color={C.muted} /><Text style={styles.stopText}>Cancelar</Text></Pressable>
        </View>
      </View> : null}
      {working && <View style={styles.thinking}><Avatar bot={bot} size={34} state={waiting ? 'waiting' : 'working'} tile={false} />
        <View style={styles.thinkingCard}>
          <View style={styles.botWorking}><Text style={styles.thinkingText}>{waiting ? 'Esperando sua aprovação' : running?.state === 'queued' ? 'Na fila' : 'Pensando'}</Text>{waiting ? null : <Dots color={hue} />}</View>
          {running?.step || step ? <Text style={styles.thinkingStep} numberOfLines={1}>{running?.step || step.detail}</Text> : null}
          {mode === 'phone' ? <Pressable accessibilityRole="button" onPress={onCancel} hitSlop={8} style={styles.stopButton}><Icon name="stop" size={13} color={C.muted} /><Text style={styles.stopText}>Parar</Text></Pressable> : null}
        </View>
      </View>}
    </ScrollView>
    {away ? <ToEndButton onPress={toEnd} /> : null}
    </View>
    <View style={styles.composerArea}>
      {error ? <Text style={styles.composerError}>Confira a conexão antes de enviar.</Text> : null}
      {composerError ? <Text style={styles.composerError}>{composerError}</Text> : null}
      {files.length ? <ScrollView horizontal style={styles.fileTray} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">{files.map((file, index) =>
        <View key={index} style={styles.fileChip}><FileChip file={file} onRemove={() => setFiles(old => old.filter((_, i) => i !== index))} /></View>)}</ScrollView> : null}
      <Composer value={draft} setValue={setDraft} editable={!typing} canSend={Boolean(canSend)} phone={phone} call={browserCall} onError={setComposerError}
        onSend={async () => { if (await onSend(draft, files)) { setFiles([]); toEnd(); } }} accessibilityLabel="Sua mensagem"
        placeholder={typing ? 'Aguarde a resposta…' : busy ? 'Mande mais, ele lê na sequência…' : `Converse com ${bot.name}…`}
        onAttach={phone ? attach : null} attachDisabled={typing || files.length >= 5} />
    </View>
  </KeyboardAvoidingView>;
}
