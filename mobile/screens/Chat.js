import { useKeyboardPad } from '../keyboard';
import { useMemo } from 'react';
import { useStore } from '../state/useStore';
import { selectConversation } from '../state/store';
import { useLiveCallback, useStickyScroll, offline, HUE_OF, IconButton, Avatar, Dots, seenText, findModel, EFFORT_NAMES, Notice, ModelSettings, EarlierButton, PasswordOfferCard, ApprovalCard, ToEndButton, Composer } from '../components/shared';
import { useState, useEffect, useRef } from 'react';
import { termuxAvailable, pickFile } from '../termux';
import { desktop, desktopBus, readingColumn } from '../desktop';
import { FlatList, View, Pressable, Text, ScrollView } from 'react-native';
import { styles } from '../styles';
import { C, Icon } from '../theme';
import PhoneBrowserLive from '../components/PhoneBrowserLive';
import BotBrowserPanel, { BrowserHelpCard, BrowserTimeline, PhoneLiveCard } from '../BotBrowserPanel';
import { Message } from '../components/Message';
import { FileChip } from '../RichMessage';
import { QueuePanel } from '../components/QueuePanel';
import { Actionable, MessageActionSheet, quoteOf } from '../components/MessageActions';

// The computer's window attaches files from the browser (button or drop), up to 5 per message and of any size: the file
// stays a Blob here and goes to the phone in parts when the message is sent (uploadWebFiles in App.js).
const readWebFile = file => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: file.name, mime: file.type || 'application/octet-stream', size: file.size, blob: file });

function ChatView({ drafts, onQueuePause, onSteer, onCancelTask, onPin, bot, data, error, onLogs, draft, setDraft, sending, saving, mode, onBack, onMode, onSend, onRetry, onSettings, onConnection, onDelete, onCancel, onProfile, onRespond, approvalBusy, onBrowserControl, browserCall, onPhoneStop, onPhoneControl, onFile, fileBusy, incoming, onIncoming, passwordAsk, onPasswordAnswer, more, onEarlier }) {
  const [keyboard, keyboardRef] = useKeyboardPad();
  const retryMessage = useLiveCallback(onRetry);
  const [draftTime] = useState(() => new Date().toISOString());
  const [held, setHeld] = useState(null);
  const hold = useLiveCallback(message => setHeld(message));
  const openFile = useLiveCallback(onFile);
  const messages = useMemo(() => [...bot.messages].reverse(), [bot.messages]);
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
  const pcBrowser = Boolean(desktop) || remote || data.browser?.pages?.[bot.id]?.where === 'pc';
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
  // The computer's window keeps the bot's browser in its right bar: it asks for it there and tells here whether it is open.
  const openBrowser = () => (desktop ? desktopBus.emit('browser-open', { botId: bot.id }) : setBrowserOpen(true));
  useEffect(() => { if (assumed) openBrowser(); }, [assumed]);
  useEffect(() => desktopBus.on('browser-state', state => { if (desktop && state.botId === bot.id) setBrowserOpen(Boolean(state.open)); }), [bot.id]);
  // Tablets and the computer's window: the browser sits beside the conversation instead of above it.
  const [width, setWidth] = useState(0);
  // On the computer, a bot whose browser is not on this computer lives on the phone: its page is shown live here (PhoneBrowserLive).
  const phoneView = Boolean(desktop) && !browsing && (browserOpen || assumed);
  const showBrowser = browsing && (browserOpen || assumed), side = !desktop && (showBrowser || phoneView) && width >= 820;
  // While the bot works, new messages still go out and wait their turn (phone mode).
  const typing = phone ? sending || saving : busy;
  const canSend = !typing && (draft.trim() || files.length) && selection?.model;
  const addWebFiles = async list => {
    setComposerError('');
    try {
      const picked = Array.from(list || []); if (!picked.length) return;
      if (files.length + picked.length > 5) throw new Error('Uma mensagem leva até 5 arquivos.');
      if (picked.some(item => !item.size)) throw new Error('O arquivo está vazio.');
      const read = picked.map(readWebFile); setFiles(old => [...old, ...read].slice(0, 5));
    } catch (e) { setComposerError(e.message); }
  };
  const pickWebFile = () => { const input = globalThis.document.createElement('input'); input.type = 'file'; input.multiple = true; input.onchange = () => addWebFiles(input.files); input.click(); };
  // Files dropped anywhere in the window, or pasted with Ctrl+V (a screenshot, a copied picture or file), attach to the open conversation.
  const dropRef = useRef(addWebFiles); dropRef.current = addWebFiles; const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!desktop) return undefined;
    let depth = 0; const has = event => Boolean(event.dataTransfer?.types?.includes('Files'));
    const enter = event => { if (has(event)) { depth++; setDragging(true); } };
    const over = event => { if (has(event)) event.preventDefault(); };
    const leave = event => { if (has(event) && --depth <= 0) { depth = 0; setDragging(false); } };
    const drop = event => { depth = 0; setDragging(false); if (event.dataTransfer?.files?.length) { event.preventDefault(); dropRef.current(event.dataTransfer.files); } };
    const paste = event => {
      const list = Array.from(event.clipboardData?.files || []); if (!list.length) return;
      // Copied text that also carries a picture (cells of a sheet) stays text; a screenshot or a copied picture or file becomes an attachment.
      if (event.clipboardData.getData('text/plain').trim()) return;
      event.preventDefault(); dropRef.current(list);
    };
    const events = [['dragenter', enter], ['dragover', over], ['dragleave', leave], ['drop', drop], ['paste', paste]];
    for (const [name, handler] of events) globalThis.addEventListener(name, handler);
    return () => { for (const [name, handler] of events) globalThis.removeEventListener(name, handler); };
  }, []);
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
  const panel = desktop ? null : phoneView ? <PhoneBrowserLive bot={bot} assumed={assumed} call={browserCall} onControl={onBrowserControl} onClose={() => setBrowserOpen(false)} />
    : showBrowser ? <BotBrowserPanel key={browserKey} bot={bot} browser={data.browser} pc={pcBrowser} call={browserCall} onControl={onBrowserControl} onClose={() => setBrowserOpen(false)} side={side} onFile={onFile} color={hue} /> : null;
  return <View style={styles.chatScreen} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    <View style={styles.chatHeader}>
      {onBack ? <IconButton icon="back" label="Voltar à lista de bots" onPress={onBack} size={40} /> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={`Abrir perfil de ${bot.name}`} onPress={onProfile}><Avatar bot={bot} size={desktop ? 32 : 44} state={waiting ? 'waiting' : asleep ? 'sleeping' : working ? 'working' : 'idle'} /></Pressable>
      <View style={styles.chatTitleCopy}>
        <Text style={styles.chatTitle} numberOfLines={1}>{bot.name}</Text>
        {waiting ? <Text style={[styles.chatSubtitle, { color: C.amber }]}>Esperando sua decisão</Text>
          : working ? <View style={styles.botWorking}><Text style={[styles.chatSubtitle, { color: hue }]}>Trabalhando</Text><Dots color={hue} /></View>
          : <Pressable accessibilityRole="button" accessibilityLabel="Alterar modelo e raciocínio" onPress={() => setShowModels(value => !value)} style={styles.modelToggle}>
            <Text style={styles.chatSubtitle} numberOfLines={1}>{asleep ? `Offline · ${seenText(data.presence[bot.id], true)}` : `${bot.home === 'any' && data.presence?.[bot.id]?.where === 'pc' ? 'No computador · ' : ''}${findModel(data.models || [], selection)?.displayName || 'Escolha o modelo'} · ${EFFORT_NAMES[selection?.reasoningEffort] || 'Padrão'}`}</Text><Icon name="down" size={13} color={C.muted} /></Pressable>}
      </View>
      {browsing && !desktop ? <IconButton icon="globe" label={browserOpen ? 'Esconder navegador do bot' : 'Ver navegador do bot'} active={browserOpen || assumed} onPress={() => assumed ? setBrowserKey(key => key + 1) : setBrowserOpen(value => !value)} size={40} /> : null}
      {desktop ? null : <IconButton icon="more" label="Perfil e permissões" onPress={onProfile} size={40} />}
    </View>
    {status ? <Notice text={status} onRetry={onConnection} onLogs={error ? onLogs : null} /> : null}
    {showModels && !working ? <View style={styles.modelPanel}><ModelSettings models={data.models || []} connections={data.connections} selection={selection} disabled={busy} onChange={onSettings} /></View> : null}
    {/* While the person drives, the browser cannot be lost: the globe brings the full screen back. */}
    {side ? null : panel}
    <View style={side ? styles.chatSplit : { flex: 1 }}>
    <View style={side ? { width: Math.max(360, Math.round(width * 0.42)) } : { flex: 1 }}>
    <View ref={keyboardRef} collapsable={false} style={{ flex: 1, paddingBottom: keyboard }}>
    <View style={styles.messagesWrap}>
    <FlatList showsVerticalScrollIndicator={!desktop} ref={scroll} style={[styles.messages, readingColumn]} contentContainerStyle={styles.messagesContent} keyboardShouldPersistTaps="handled"
      inverted data={messages} keyExtractor={messageKey} initialNumToRender={15} windowSize={7} maxToRenderPerBatch={4}
      {...scrollProps} maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 120 }}
      onEndReached={more ? () => onEarlier().catch(() => {}) : undefined} onEndReachedThreshold={0.25}
      ListFooterComponent={more ? <EarlierButton onPress={onEarlier} /> : null}
      ListEmptyComponent={<View>
      {!bot.messageCount && <View style={styles.chatEmpty}><Avatar bot={bot} size={96} state={asleep ? 'sleeping' : 'idle'} /><Text style={styles.chatEmptyTitle}>Diga oi para {bot.name}.</Text>
        <Text style={styles.chatEmptyText}>Conte o que você precisa. Em Perfil você vê e muda o que este bot pode fazer.</Text>
        {['Oi! Vamos nos conhecer?', 'O que você consegue fazer por mim?'].map(text => <Pressable key={text} accessibilityRole="button" disabled={busy} onPress={() => onSend(text)} style={({ pressed }) => [styles.greetingButton, pressed && styles.pressed]}><Text style={styles.greetingText}>{text}</Text><Icon name="send" size={15} color={C.accent} /></Pressable>)}
      </View>}
      </View>}
      renderItem={({ item }) => <Actionable message={item} onHold={hold}><Message message={item} bot={bot} models={data.models || []} busy={busy} onRetry={retryMessage} onFile={openFile} fileBusy={fileBusy} /></Actionable>}
      ListHeaderComponent={<View style={{ gap: 16 }}>
      {phone && passwordAsk?.botId === bot.id ? <PasswordOfferCard offer={passwordAsk} bot={bot} onAnswer={onPasswordAnswer} /> : null}
      {browsing && help && !assumed ? <BrowserHelpCard bot={bot} help={help} onPc={pcBrowser} onOpen={() => { openBrowser(); onBrowserControl('person').catch(() => {}); }} /> : null}
      {browserCall && (data.phone?.controller?.botId === bot.id || data.phone?.help?.[bot.id] || data.phone?.control === 'person') ? <PhoneLiveCard bot={bot} phone={data.phone} call={browserCall} onStop={onPhoneStop} onControl={onPhoneControl} /> : null}
      {/* the steps of the bot's browser belong to the browser: they show only while it is open */}
      {browserCall && showBrowser ? <BrowserTimeline bot={bot} call={browserCall} working={Boolean(working)} /> : null}
      {(data.approvals || []).filter(item => item.botId === bot.id).map(approval => <ApprovalCard key={approval.id} approval={approval} bot={bot} onRespond={onRespond} busy={approvalBusy === approval.id} />)}
      {asleep && running ? <View style={styles.thinking}><Avatar bot={bot} size={34} state="sleeping" tile={false} />
        <View style={styles.thinkingCard}>
          <Text style={styles.thinkingText}>Esperando o computador ligar</Text>
          <Text style={styles.thinkingStep}>{bot.name} vive no computador. A mensagem segue assim que ele conectar.</Text>
          <Pressable accessibilityRole="button" onPress={onCancel} hitSlop={8} style={styles.stopButton}><Icon name="stop" size={13} color={C.muted} /><Text style={styles.stopText}>Cancelar</Text></Pressable>
        </View>
      </View> : null}
      {mode === 'phone' ? <QueuePanel queued={(data.tasks || []).filter(task => task.bot_id === bot.id && task.state === 'queued')} running={(data.tasks || []).some(task => task.bot_id === bot.id && ['running', 'waiting_approval'].includes(task.state))} paused={Boolean(data.pausedQueues?.includes(bot.id))}
        onPause={paused => onQueuePause(bot.id, paused)} onCancel={onCancelTask} onSteer={text => onSteer(bot.id, text)} /> : null}
      {drafts?.[bot.id] ? <Message message={{ id: 'draft:' + bot.id, role: 'assistant', text: drafts[bot.id], status: 'complete', createdAt: draftTime }} bot={bot} models={data.models || []} busy onRetry={retryMessage} onFile={openFile} fileBusy={null} /> : null}
      {working && <View style={styles.thinking}><Avatar bot={bot} size={34} state={waiting ? 'waiting' : 'working'} tile={false} />
        <View style={styles.thinkingCard}>
          <View style={styles.botWorking}><Text style={styles.thinkingText}>{waiting ? 'Esperando sua aprovação' : running?.state === 'queued' ? 'Na fila' : 'Pensando'}</Text>{waiting ? null : <Dots color={hue} />}</View>
          {running?.step || step ? <Text style={styles.thinkingStep} numberOfLines={1}>{running?.step || step.detail}</Text> : null}
          {mode === 'phone' ? <Pressable accessibilityRole="button" onPress={onCancel} hitSlop={8} style={styles.stopButton}><Icon name="stop" size={13} color={C.muted} /><Text style={styles.stopText}>Parar</Text></Pressable> : null}
        </View>
      </View>}
      </View>} />
    {away ? <ToEndButton onPress={toEnd} /> : null}
    </View>
    {dragging ? <View pointerEvents="none" style={styles.dropOverlay}><View style={styles.dropBox}><Icon name="plus" size={28} color={C.accent} /><Text style={styles.dropText}>Solte para anexar à mensagem</Text></View></View> : null}
    <View style={[styles.composerArea, readingColumn]}>
      {error ? <Text style={styles.composerError}>Confira a conexão antes de enviar.</Text> : null}
      {composerError ? <Text style={styles.composerError}>{composerError}</Text> : null}
      {files.length ? <ScrollView horizontal style={styles.fileTray} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">{files.map((file, index) =>
        <View key={index} style={styles.fileChip}><FileChip file={file} onRemove={() => setFiles(old => old.filter((_, i) => i !== index))} /></View>)}</ScrollView> : null}
      <Composer value={draft} setValue={setDraft} editable={!typing} canSend={Boolean(canSend)} phone={phone} call={browserCall} onError={setComposerError}
        onSend={async () => { if (await onSend(draft, files)) { setFiles([]); toEnd(); } }} accessibilityLabel="Sua mensagem"
        placeholder={typing ? 'Aguarde a resposta…' : busy ? 'Mande mais, ele lê na sequência…' : `Converse com ${bot.name}…`}
        onAttach={phone ? attach : desktop ? pickWebFile : null} attachDisabled={typing || files.length >= 5} />
    </View>
    </View>
    <MessageActionSheet message={held} onClose={() => setHeld(null)} onQuote={message => setDraft(old => quoteOf(message) + old)} onPin={onPin} onResend={message => onSend(message.text)} canResend={!typing} />
    </View>
    {side ? <View style={styles.chatSide}>{panel}</View> : null}
    </View>
  </View>;
}

export function ChatScreen(props) {
  const selector = useMemo(() => selectConversation(props.bot.id), [props.bot.id]);
  const slice = useStore(selector);
  return slice?.bot ? <ChatView key={props.bot.id} {...props} {...slice} /> : null;
}

const messageKey = message => message.id;
