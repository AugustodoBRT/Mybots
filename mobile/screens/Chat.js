import { ChiefStatus, DelegationCards } from '../components/ChiefTeam';
import { ChiefHero } from '../components/ChiefHero';
import { sessionsOf, openedLine } from '../state/sessions';
import { KeyboardArea } from '../keyboard';
import { useMemo } from 'react';
import { useStore } from '../state/useStore';
import { selectConversation } from '../state/store';
import { useLiveCallback, useStickyScroll, offline, HUE_OF, IconButton, Avatar, Dots, seenText, findModel, EFFORT_NAMES, Notice, ModelSettings, EarlierButton, PasswordOfferCard, ApprovalCard, ToEndButton, Composer } from '../components/shared';
import { useState, useEffect, useRef } from 'react';
import { termuxAvailable, pickFile } from '../termux';
import { reportOpen } from '../components/Report';
import { desktop, pwa, desktopBus, readingColumn, pendingBrowser } from '../desktop';
import { FlatList, View, Pressable, Text, ScrollView } from 'react-native';
import { styles } from '../styles';
import { C, F, Icon } from '../theme';
import PhoneBrowserLive from '../components/PhoneBrowserLive';
import BotBrowserPanel, { BrowserHelpCard, BrowserTimeline, PhoneLiveCard, ReturnCard } from '../BotBrowserPanel';
import { Message } from '../components/Message';
import { FileChip } from '../RichMessage';
import { QueuePanel } from '../components/QueuePanel';
import { Actionable, MessageActionSheet, quoteOf } from '../components/MessageActions';
// Files in one message (the supervisor's attachments LIMITS.files says the same).
const MAX_FILES = 20;

// The computer's window attaches files from the browser (button or drop), up to 5 per message and of any size: the file
// stays a Blob here and goes to the phone in parts when the message is sent (uploadWebFiles in App.js).
const readWebFile = file => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: file.name, mime: file.type || 'application/octet-stream', size: file.size, blob: file });

const launchPast = new Map();
// When this visit began: the team's replies from before it are not news on the empty start.
const visitStart = new Date().toISOString();
function ChatView({ onResume, onMemory, onTeam, onTeamRoom, interactive = true, savedFiles, drafts, onQueuePause, onSteer, onCancelTask, onPin, bot, data, error, onLogs, draft, setDraft, sending, saving, mode, onBack, onMode, onSend, onRetry, onSettings, onConnection, onDelete, onCancel, onProfile, onRespond, approvalBusy, onBrowserControl, browserCall, onPhoneStop, onPhoneControl, onFile, fileBusy, incoming, onIncoming, passwordAsk, onPasswordAnswer, more, onEarlier }) {
  const retryMessage = useLiveCallback(onRetry);
  const [draftTime] = useState(() => new Date().toISOString());
  const [held, setHeld] = useState(null);
  const hold = useLiveCallback(message => setHeld(message));
  const openFile = useLiveCallback(onFile);
  // Opening the app lands on an empty conversation with the Chefe: every visit is a new session, like a new chat. What was said
  // before stays in the sessions list ("Ver sessões"), and the first message sent now starts the new one.
  // What existed when this visit began is remembered for the whole visit (not per screen), so leaving the Chefe's screen and coming back
  // does not hide the conversation started since, nor bring the old one back.
  const [sessionsOpen, setSessionsOpen] = useState(false); const [, refreshPast] = useState(0);
  const past = launchPast.get(bot.id);
  useEffect(() => {
    if (!bot.isChief || launchPast.has(bot.id)) return;
    if (bot.messages.length) launchPast.set(bot.id, { ids: new Set(bot.messages.map(item => item.id)) });
    else if (!bot.messageCount) launchPast.set(bot.id, { ids: new Set() });
    else return;
    refreshPast(n => n + 1);
  }, [bot.id, bot.isChief, bot.messages, bot.messageCount]);
  const sessions = useMemo(() => bot.isChief ? sessionsOf(bot.messages) : [], [bot.isChief, bot.messages]);
  // The newest session (the one being used on the other device too), offered on the empty start when it was used in the last day.
  const latestSession = useMemo(() => { const item = sessions[0]; return item && Date.now() - Date.parse(item.last) < 24 * 3600 * 1000 ? item : null; }, [sessions]);
  // The open session is the one of the newest message written or picked in this visit; until then the screen is the empty start.
  const current = useMemo(() => {
    if (!bot.isChief || !past) return null;
    const fresh = [...bot.messages].reverse().find(item => !past.ids.has(item.id));
    return fresh ? sessions.find(item => item.id === (fresh.session || 'base')) || null : null;
  }, [bot.isChief, bot.messages, past, sessions]);
  const messages = useMemo(() => (bot.isChief ? [...(current?.messages || [])].filter(item => !openedLine(item)) : [...bot.messages]).reverse(), [bot.isChief, bot.messages, current]);
  const heroAllowed = bot.isChief && !sessionsOpen && !messages.length && !sending && !saving && !data.active?.includes(bot.id) && !(data.approvals || []).some(item => item.botId === bot.id);
  // The start screen is for a conversation that is really empty: a list empty for an instant (it is being renewed) must not bring it back over the messages.
  const hadMessages = useRef(0); if (!heroAllowed) hadMessages.current = Date.now();
  const [, settleHero] = useState(0); const heroWait = hadMessages.current ? hadMessages.current + 2000 - Date.now() : 0;
  useEffect(() => { if (!heroAllowed || heroWait <= 0) return undefined; const timer = setTimeout(() => settleHero(n => n + 1), heroWait + 20); return () => clearTimeout(timer); }, [heroAllowed, heroWait > 0]);
  const showHero = heroAllowed && heroWait <= 0;
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
  const [localFiles, setLocalFiles] = useState([]); const files = savedFiles ? savedFiles.value : localFiles, setFiles = savedFiles ? savedFiles.set : setLocalFiles;
  const [composerError, setComposerError] = useState('');
  // The bot's own browser panel; it stays open while the person has taken over.
  const [browserOpen, setBrowserOpen] = useState(false); const [browserKey, setBrowserKey] = useState(0);
  const help = data.browser?.help?.[bot.id];
  const assumed = data.browser?.control?.[bot.id] === 'person';
  useEffect(() => { if (!savedFiles) setFiles([]); setComposerError(''); const asked = !desktop && pendingBrowser.botId === bot.id; pendingBrowser.botId = null; setBrowserOpen(asked); }, [bot.id]);
  // Files shared from another app land in the tray, ready to send with a message.
  useEffect(() => {
    if (!incoming) return;
    const room = MAX_FILES - files.length; const added = phone ? (incoming.files || []).slice(0, room) : [];
    if (added.length) setFiles(old => [...old, ...added]);
    const problems = [...(incoming.problems || []), ...(phone && (incoming.files || []).length > room ? [`Uma mensagem leva até ${MAX_FILES} arquivos.`] : []), ...(!phone && incoming.files?.length ? ['Arquivos só chegam aos bots no modo Só no celular.'] : [])];
    setComposerError(problems.join(' '));
    onIncoming();
  }, [incoming]);
  // The computer's window keeps the bot's browser in its right bar: it asks for it there and tells here whether it is open.
  const openBrowser = () => (desktop ? desktopBus.emit('browser-open', { botId: bot.id }) : setBrowserOpen(true));
  useEffect(() => { if (assumed && interactive) openBrowser(); }, [assumed, interactive]);
  useEffect(() => desktopBus.on('browser-state', state => { if (desktop && state.botId === bot.id) setBrowserOpen(Boolean(state.open)); }), [bot.id]);
  // Tablets and the computer's window: the browser sits beside the conversation instead of above it.
  const [width, setWidth] = useState(0);
  // On the computer, a bot whose browser is not on this computer lives on the phone: its page is shown live here (PhoneBrowserLive).
  const phoneView = Boolean(desktop) && !browsing && (browserOpen || assumed);
  const showBrowser = browsing && (browserOpen || assumed), side = !desktop && (showBrowser || phoneView) && width >= 820;
  // While the bot works, new messages still go out and wait their turn (phone mode).
  // The supervisor queues what is written while the bot works (phone, computer window and iPhone web app alike); only the old
  // token-based computer mode answers one message at a time.
  const typing = mode === 'phone' ? sending || saving : busy;
  const canSend = !typing && (draft.trim() || files.length) && selection?.model;
  const addWebFiles = async list => {
    setComposerError('');
    try {
      const picked = Array.from(list || []); if (!picked.length) return;
      if (files.length + picked.length > MAX_FILES) throw new Error(`Uma mensagem leva até ${MAX_FILES} arquivos.`);
      if (picked.some(item => !item.size)) throw new Error('O arquivo está vazio.');
      const read = picked.map(readWebFile); setFiles(old => [...old, ...read].slice(0, MAX_FILES));
    } catch (e) { setComposerError(e.message); }
  };
  const pickWebFile = () => { const input = globalThis.document.createElement('input'); input.type = 'file'; input.multiple = true; input.onchange = () => addWebFiles(input.files); input.click(); };
  // Files dropped anywhere in the window, or pasted with Ctrl+V (a screenshot, a copied picture or file), attach to the open conversation.
  const dropRef = useRef(addWebFiles); dropRef.current = addWebFiles; const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!desktop || !interactive) return undefined;
    let depth = 0; const has = event => Boolean(event.dataTransfer?.types?.includes('Files')) && !reportOpen();
    const enter = event => { if (has(event)) { depth++; setDragging(true); } };
    const over = event => { if (has(event)) event.preventDefault(); };
    const leave = event => { if (has(event) && --depth <= 0) { depth = 0; setDragging(false); } };
    const drop = event => { depth = 0; setDragging(false); if (event.dataTransfer?.files?.length && !reportOpen()) { event.preventDefault(); dropRef.current(event.dataTransfer.files); } };
    const paste = event => {
      const list = Array.from(event.clipboardData?.files || []); if (!list.length || reportOpen()) return;
      // Copied text that also carries a picture (cells of a sheet) stays text; a screenshot or a copied picture or file becomes an attachment.
      if (event.clipboardData.getData('text/plain').trim()) return;
      event.preventDefault(); dropRef.current(list);
    };
    const events = [['dragenter', enter], ['dragover', over], ['dragleave', leave], ['drop', drop], ['paste', paste]];
    for (const [name, handler] of events) globalThis.addEventListener(name, handler);
    return () => { for (const [name, handler] of events) globalThis.removeEventListener(name, handler); setDragging(false); };
  }, [interactive]);
  const attach = async () => {
    setComposerError('');
    try {
      const file = await pickFile(); if (!file) return;
      if (files.length >= MAX_FILES) throw new Error(`Uma mensagem leva até ${MAX_FILES} arquivos.`);
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
      {onBack ? <IconButton icon="back" label="Voltar ao início" onPress={onBack} size={40} /> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={`Abrir perfil de ${bot.name}`} onPress={onProfile}><Avatar bot={bot} size={desktop ? 32 : 44} state={waiting ? 'waiting' : asleep ? 'sleeping' : working ? 'working' : 'idle'} /></Pressable>
      <View style={styles.chatTitleCopy}>
        <Text style={styles.chatTitle} numberOfLines={1}>{bot.name}</Text>
        {waiting ? <Text style={[styles.chatSubtitle, { color: C.amber }]}>Esperando sua decisão</Text>
          : working ? <View style={styles.botWorking}><Text style={[styles.chatSubtitle, { color: hue }]}>Trabalhando</Text><Dots color={hue} /></View>
          : <Pressable accessibilityRole="button" accessibilityLabel="Alterar modelo e raciocínio" onPress={() => setShowModels(value => !value)} style={styles.modelToggle}>
            <Text style={styles.chatSubtitle} numberOfLines={1}>{asleep ? `Offline · ${seenText(data.presence[bot.id], true)}` : `${bot.home === 'any' && data.presence?.[bot.id]?.where === 'pc' ? 'No computador · ' : ''}${findModel(data.models || [], selection)?.displayName || 'Escolha o modelo'} · ${EFFORT_NAMES[selection?.reasoningEffort] || 'Padrão'}`}</Text><Icon name="down" size={13} color={C.muted} /></Pressable>}
      </View>
      {/* The bot's own settings open by touching its face; the memory map is on the start page. Only two buttons stay: its browser and
          the start page (the team, rooms, memory and the app's settings). */}
      {browsing && !desktop ? <IconButton icon="globe" label={browserOpen ? 'Esconder navegador do bot' : 'Ver navegador do bot'} active={browserOpen || assumed} onPress={() => assumed ? setBrowserKey(key => key + 1) : setBrowserOpen(value => !value)} size={40} /> : null}
      {bot.isChief && !desktop ? <IconButton icon="apps" label="Início: equipe, salas, memória e ajustes" onPress={onTeam} size={40} /> : null}
    </View>
    {bot.isChief ? <ChiefStatus onTeam={onTeam} /> : null}
    {status ? <Notice text={status} onRetry={onConnection} onLogs={error ? onLogs : null} /> : null}
    {showModels && !working ? <View style={styles.modelPanel}><ModelSettings models={data.models || []} connections={data.connections} selection={selection} disabled={busy} onChange={onSettings} aiAccounts={data.aiAccounts} home={bot.home || 'phone'} account={bot.aiAccount} /></View> : null}
    {/* While the person drives, the browser cannot be lost: the globe brings the full screen back. */}
    {side ? null : panel}
    <View style={side ? styles.chatSplit : { flex: 1 }}>
    <View style={side ? { width: Math.max(360, Math.round(width * 0.42)) } : { flex: 1 }}>
    <KeyboardArea>
    <View style={styles.messagesWrap}>
    {sessionsOpen ? <SessionList sessions={sessions} current={current?.id} more={more} onEarlier={onEarlier} onPick={id => { setSessionsOpen(false); if (id !== current?.id) onResume?.(id); }} onClose={() => setSessionsOpen(false)} /> : null}
    <FlatList showsVerticalScrollIndicator={!desktop} ref={scroll} style={[styles.messages, readingColumn]} contentContainerStyle={styles.messagesContent} keyboardShouldPersistTaps="handled"
      inverted data={messages} keyExtractor={messageKey} initialNumToRender={15} windowSize={7} maxToRenderPerBatch={4}
      {...scrollProps} removeClippedSubviews={false} maintainVisibleContentPosition={away ? { minIndexForVisible: 0 } : undefined}
      onEndReached={more && !bot.isChief ? () => onEarlier().catch(() => {}) : undefined} onEndReachedThreshold={0.25}
      ListFooterComponent={more && !bot.isChief ? <EarlierButton onPress={onEarlier} /> : null}
      ListEmptyComponent={<View>
      {!bot.messageCount && !bot.isChief && <View style={styles.chatEmpty}><Avatar bot={bot} size={96} state={asleep ? 'sleeping' : 'idle'} /><Text style={styles.chatEmptyTitle}>Diga oi para {bot.name}.</Text>
        <Text style={styles.chatEmptyText}>Conte o que você precisa. Em Perfil você vê e muda o que este bot pode fazer.</Text>
        {['Oi! Vamos nos conhecer?', 'O que você consegue fazer por mim?'].map(text => <Pressable key={text} accessibilityRole="button" disabled={busy} onPress={() => onSend(text)} style={({ pressed }) => [styles.greetingButton, pressed && styles.pressed]}><Text style={styles.greetingText}>{text}</Text><Icon name="send" size={15} color={C.accent} /></Pressable>)}
      </View>}
      </View>}
      renderItem={({ item }) => item.role === 'system' ? <Text style={styles.roomGone}>{item.text}</Text> : <Actionable message={item} onHold={hold}><Message message={item} bot={bot} models={data.models || []} busy={busy} onRetry={retryMessage} onFile={openFile} fileBusy={fileBusy} /></Actionable>}
      ListHeaderComponent={<View style={{ gap: 16 }}>
      {bot.isChief && !showHero ? <DelegationCards onRoom={onTeamRoom} since={messages[0]?.createdAt || visitStart} /> : null}
      {phone && passwordAsk?.botId === bot.id ? <PasswordOfferCard offer={passwordAsk} bot={bot} onAnswer={onPasswordAnswer} /> : null}
      {desktop && assumed ? <ReturnCard bot={bot} onReturn={() => onBrowserControl('bot')} /> : null}
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
    {showHero ? <ChiefHero bot={bot} call={browserCall} state={waiting ? 'waiting' : asleep ? 'sleeping' : working ? 'working' : 'idle'} onSessions={bot.messageCount ? () => setSessionsOpen(true) : null} resume={latestSession?.title} onResume={latestSession ? () => onResume?.(latestSession.id) : null} /> : null}
    {away ? <ToEndButton onPress={toEnd} /> : null}
    </View>
    {dragging ? <View pointerEvents="none" style={styles.dropOverlay}><View style={styles.dropBox}><Icon name="plus" size={28} color={C.accent} /><Text style={styles.dropText}>Solte para anexar à mensagem</Text></View></View> : null}
    <View style={[styles.composerArea, readingColumn]}>
      {error ? <Text style={styles.composerError}>Confira a conexão antes de enviar.</Text> : null}
      {composerError ? <Text style={styles.composerError}>{composerError}</Text> : null}
      {files.length ? <ScrollView horizontal style={styles.fileTray} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">{files.map((file, index) =>
        <View key={index} style={styles.fileChip}><FileChip file={file} onRemove={() => setFiles(old => old.filter((_, i) => i !== index))} /></View>)}</ScrollView> : null}
      <Composer value={draft} setValue={setDraft} editable={mode === 'phone' || !typing} canSend={Boolean(canSend)} phone={phone} call={browserCall} onError={setComposerError}
        onSend={async () => { if (await onSend(draft, files)) { setFiles([]); toEnd(); } }} accessibilityLabel="Sua mensagem"
        placeholder={mode !== 'phone' && typing ? 'Aguarde a resposta…' : busy ? 'Mande mais, ele lê na sequência…' : `Converse com ${bot.name}…`}
        onAttach={pwa ? pickWebFile : phone ? attach : desktop ? pickWebFile : null} attachDisabled={typing || files.length >= MAX_FILES} />
    </View>
    </KeyboardArea>
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

// "Ver sessões": every visit with the Chefe, newest first, each named by what the person said first.
function SessionList({ sessions, current, more, onEarlier, onPick, onClose }) {
  return <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: C.bg, zIndex: 5 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12 }}>
      <IconButton icon="back" label="Voltar" onPress={onClose} size={38} /><Text style={{ color: C.text, fontFamily: F.x, fontSize: 18, flex: 1 }}>Sessões</Text></View>
    <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}>
      {sessions.length ? sessions.map(item => <Pressable key={item.id} accessibilityRole="button" onPress={() => onPick(item.id)} style={({ pressed }) => [{ paddingVertical: 12, borderBottomWidth: 1, borderColor: C.line, gap: 2 }, pressed && { opacity: 0.7 }]}>
        <Text style={{ color: C.text, fontFamily: F.s, fontSize: 15 }} numberOfLines={2}>{item.title}</Text>
        <Text style={{ color: item.id === current || item.id === sessions[0]?.id ? C.accent : C.muted, fontFamily: F.m, fontSize: 12.5 }}>{item.id === current ? 'Aberta · ' : item.id === sessions[0]?.id ? 'Atual · ' : ''}{new Date(item.last).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · {item.count} {item.count === 1 ? 'mensagem' : 'mensagens'}</Text></Pressable>)
        : <Text style={{ color: C.muted, fontFamily: F.m, fontSize: 14, paddingTop: 12 }}>Nenhuma sessão carregada ainda.</Text>}
      {more ? <EarlierButton onPress={onEarlier} /> : null}
    </ScrollView>
  </View>;
}
