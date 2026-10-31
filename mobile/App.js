import { KeyboardProvider } from 'react-native-keyboard-controller';
import { appStore, selectShell } from './state/store';
import { useStore } from './state/useStore';
import { useFonts, PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold } from '@expo-google-fonts/plus-jakarta-sans';
import { useColorScheme, View, BackHandler, Linking, AppState, Alert, useWindowDimensions, StatusBar, Text, Pressable, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { styles } from './styles';
import { useState, useEffect, useRef, useCallback } from 'react';
import { DEFAULT_API_URL, nativeMessage, formatTermuxLog, shareText, DesktopNetwork, Avatar, PrimaryButton, DesktopPair, RoomSheet, ModelSettings, FallbackSettings, SheetHeader, PersonName, ThemeChoice, ScreenOff, ComputerPanel, WidgetRow, PhoneAccess, PhoneControlAccess, WalletPanel, EmailConnection, AccountConnections, AppConnections, UpdateCard, ApprovalCard, ItemsByDeadline, ShareSheet, ShareTargets, ModeSheet, TermuxLogModal } from './components/shared';
import { SearchSheet } from './components/Search';
import { SettingsSheet } from './components/Settings';
import { NewBot } from './components/NewBot';
import { DesktopShell } from './components/DesktopShell';
import { ActivityColumns, ActivityPage } from './components/Activity';
import { UsagePanel } from './components/Usage';
import { desktop, column, paintPage } from './desktop';
import { emptyLocalStore, createId, mergeBotLists, validateBackup, conversationCache, cachedConversations } from './local';
import { termuxAvailable, passwordOffer, onPasswordOffer, runTermux, readLocalStore, writeLocalStore, readSecretsKey, notificationPermission, readConnectorBundle, flushNotifications, startKeepAlive, showBotNotification, readPairing, supervisorParts, savePairing, fileStage, fileAction, copyTermuxText, takeLaunchBot, onOpenBot, takeShare, onShare, updateCheck, onUpdate, updateCanInstall, updateInstall, passwordOfferAnswer, readDeviceInfo, phoneStopNow, freeGuard, freeGuardSet, freeGuardAsk } from './termux';
import { createPhoneClient, activePhoneBots } from './phone';
import { SupervisorClient } from './supervisor-client';
import { browserFrames, browserEvents } from './BotBrowserPanel';
import { setImageReader } from './attachment-images';
import { createTermuxBackup } from './backup';
import { RoomScreen } from './screens/Room';
import { ChatScreen } from './screens/Chat';
import { C, Icon, setTheme, resolveTheme } from './theme';
import { HomeScreen } from './screens/Home';
import BotProfile from './BotProfile';
import { FilePreview } from './components/FilePreview';
import { FileBadge, formatSize } from './RichMessage';

const UPLOAD_PART = 3 * 1024 * 1024;
const blobBase64 = blob => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
  reader.onerror = () => reject(new Error('Não consegui ler o arquivo.'));
  reader.readAsDataURL(blob);
});
/** Files picked in the computer's window go to the phone in 3 MB parts, so no size limit applies; the phone's own files travel inline. */
async function uploadWebFiles(call, botId, files) {
  const out = [];
  for (const file of files) {
    if (!file.blob) { out.push({ name: file.name, mime: file.mime, data: file.data }); continue; }
    const { upload } = await call('file.uploadStart', { botId, name: file.name, mime: file.mime });
    for (let offset = 0; offset < file.blob.size; offset += UPLOAD_PART) await call('file.uploadChunk', { upload, offset, data: await blobBase64(file.blob.slice(offset, offset + UPLOAD_PART)) });
    out.push({ upload });
  }
  return out;
}

async function api(path, data, token, apiUrl) {
  if (!apiUrl || !token) throw new Error('Escaneie o QR code do MyBots no computador para conectar o app.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      method: data === undefined ? 'GET' : 'POST', signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, ...(data === undefined ? {} : { 'Content-Type': 'application/json', 'X-MyBots': '1' }) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) })
    });
  } catch {
    throw new Error('Sem conexão com o computador. Confira se os dois aparelhos estão na mesma rede Wi-Fi e se o MyBots continua aberto.');
  } finally { clearTimeout(timeout); }
  let value;
  try { value = await response.json(); } catch { throw new Error('O computador devolveu uma resposta inválida.'); }
  if (!response.ok) throw new Error(value.error || 'Não foi possível concluir o pedido.');
  return value;
}

export default function App() {
  const [fonts] = useFonts({ PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold });
  return fonts ? <KeyboardProvider><AppMain /></KeyboardProvider> : <View style={styles.app} />;
}

function AppMain() {
  const data = useStore(selectShell);
  // The look (dark, light or the system's) is applied before anything below renders; a change repaints the tree through `key`.
  const systemScheme = useColorScheme();
  const look = resolveTheme(data?.person?.theme, systemScheme); setTheme(look);
  useEffect(() => { paintPage({ bg: C.bg, line2: C.line2, dark: look === 'dark' }); }, [look]);
  const { setData, setChats } = appStore;
  const [apiToken, setApiToken] = useState('');
  const [apiBase, setApiBase] = useState(DEFAULT_API_URL);
  const [mode, setMode] = useState(desktop ? 'phone' : 'computer');
  const [localCache, setLocalCache] = useState(emptyLocalStore());
  const localCacheRef = useRef(localCache);
  useEffect(() => { localCacheRef.current = localCache; }, [localCache]);
  const [selected, setSelected] = useState(null);
  // The open room, and the create/edit sheet (null closed, {} new, {room} editing).
  const [roomId, setRoomId] = useState(null);
  const [roomSheet, setRoomSheet] = useState(null);
  const [draft, setDraft] = useState('');
  const [loadError, setLoadError] = useState('');
  const [termuxLog, setTermuxLog] = useState(null);
  const [logsVisible, setLogsVisible] = useState(false);
  const [logsCopied, setLogsCopied] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [profileId, setProfileId] = useState(null); const [profileTab, setProfileTab] = useState(null);
  const [approvalBusy, setApprovalBusy] = useState(null);
  const [modeVisible, setModeVisible] = useState(false);
  const [maintenanceVisible, setMaintenanceVisible] = useState(false);
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);
  const [maintenanceText, setMaintenanceText] = useState('Backups ficam no Termux e sobrevivem à desinstalação do MyBots.');
  const [backupNames, setBackupNames] = useState([]);
  const [activityVisible, setActivityVisible] = useState(false); const [deskPage, setDeskPage] = useState(null); const [searchVisible, setSearchVisible] = useState(false);
  const [walletVisible, setWalletVisible] = useState(false);
  // A file in the conversation: fetched from the supervisor in parts, then opened, shared or saved.
  const [fileSheet, setFileSheet] = useState(null);
  const [fileBusy, setFileBusy] = useState(null);
  const [fileNote, setFileNote] = useState('');
  // Shared from another app: waiting for the person to pick a bot (share), then handed to that chat (incoming).
  const [share, setShare] = useState(null);
  const [incoming, setIncoming] = useState(null);
  // In-app update: the latest release found, the download/install step, and when it was last checked.
  const [update, setUpdate] = useState(null);
  // A login the person typed in a bot's browser, waiting for "Salvar?" (the app keeps the password; this holds site and user).
  const [passwordAsk, setPasswordAsk] = useState(null);
  useEffect(() => {
    if (!termuxAvailable) return undefined;
    Promise.resolve(passwordOffer()).then(offer => offer && setPasswordAsk(offer)).catch(() => {});
    const subscription = onPasswordOffer(setPasswordAsk);
    return () => subscription.remove();
  }, []);
  const updateChecked = useRef(0);
  const staged = useRef(new Set());
  const supervisor = useRef(null);
  const phoneMode = useRef(mode); phoneMode.current = mode;
  const eventRefresh = useRef(null);
  // The supervisor's state has no messages: the open conversations are loaded by page (chat.page) and kept up to date
  // by the message events. `seq` is the number of the last applied event; a gap reloads the state and these pages.
  const chatsRef = { get current() { return appStore.getSnapshot().chats; } };
  const lastSeq = useRef(null);
  const loadingPages = useRef(new Map());
  const openChat = useRef(null);
  // Skills, memories and permissions of the bot whose profile is open (bot.profile).
  const [profile, setProfile] = useState(null);
  const phoneConnecting = useRef(null);
  const resyncing = useRef(null);
  useEffect(() => {
    let timer; let writing = Promise.resolve();
    const persist = () => {
      const { data, chats } = appStore.getSnapshot();
      if (phoneMode.current !== 'phone' || !data?.supervisorConnected || desktop) return;
      const cache = conversationCache(localCacheRef.current, data, chats);
      localCacheRef.current = cache;
      writing = writing.catch(() => {}).then(() => writeLocalStore(cache)).catch(() => setLoadError('Não consegui atualizar a cópia local. Os dados continuam salvos no supervisor.'));
    };
    const stop = appStore.subscribe(() => { clearTimeout(timer); timer = setTimeout(persist, 200); });
    return () => { stop(); clearTimeout(timer); persist(); };
  }, []);


  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (roomId) { setRoomId(null); return true; }
      if (!selected) return false;
      setSelected(null); setDraft('');
      return true;
    });
    return () => subscription.remove();
  }, [selected, roomId]);

  const runPhoneCommand = useCallback(async (operation, payload = {}) => {
    const startedAt = new Date().toISOString();
    try {
      const result = await runTermux(operation, payload);
      if (operation !== 'recover' || result.exitCode !== 0 || result.errorMessage) setTermuxLog({ operation, startedAt, ...result });
      return result;
    } catch (error) {
      setTermuxLog({ operation, startedAt, nativeCode: error?.code || error?.nativeErrorCode || '', nativeMessage: error?.message || String(error) });
      throw error;
    }
  }, []);

  const phone = useRef(null);
  if (!phone.current) phone.current = createPhoneClient({
    read: readLocalStore, write: writeLocalStore, run: runPhoneCommand,
    onStore: store => {
      setLocalCache(store);
      setData(current => current ? { ...current, bots: store.bots.filter(bot => !bot.deletedAt), active: activePhoneBots(store) } : current);
    }
  });

  // The Livre level is the person's choice, made in this app: a bot the supervisor says is Livre but the app never put
  // there (changed from Termux, a backup) goes back to Acesso total, and the person is told.
  const freeChecking = useRef(false);
  const checkFree = useCallback(async next => {
    if (desktop || !termuxAvailable || freeChecking.current) return;
    const guard = await freeGuard(); if (!guard) return;
    const strays = (next.bots || []).filter(bot => bot.access === 'free' && !guard.bots.includes(bot.id));
    for (const id of guard.bots.filter(id => !(next.bots || []).some(bot => bot.id === id && bot.access === 'free'))) await freeGuardSet(id, false);
    if (!strays.length) return;
    freeChecking.current = true;
    try {
      for (const bot of strays) await supervisor.current.call('bot.update', { botId: bot.id, access: 'full' });
      Alert.alert('Nível Livre desfeito', `${strays.map(bot => bot.name).join(', ')} ${strays.length > 1 ? 'estavam' : 'estava'} no nível Livre sem ter sido escolhido neste app. Por segurança, ${strays.length > 1 ? 'voltaram' : 'voltou'} para Acesso total. Se foi você (por exemplo, restaurando um backup), escolha Livre de novo no perfil.`);
    } finally { freeChecking.current = false; }
  }, []);
  const [freeSettings, setFreeSettings] = useState(null);
  // The "sempre perguntar" list: the app keeps its own copy and puts it back if the supervisor's was changed elsewhere.
  const loadFree = useCallback(async () => {
    let settings = await supervisor.current.call('free.get');
    const guard = !desktop && termuxAvailable ? await freeGuard().catch(() => null) : null;
    const retired = ['phone/act', 'phone.open_app'];
    const mine = guard?.ask ? JSON.parse(guard.ask).filter(key => !retired.includes(key)) : null; const theirs = settings.options.filter(item => item.ask).map(item => item.key);
    if (Array.isArray(mine) && JSON.stringify([...mine].sort()) !== JSON.stringify([...theirs].sort())) {
      settings = await supervisor.current.call('free.set', { ask: mine });
      Alert.alert('Lista restaurada', 'A lista “Sempre perguntar” do nível Livre tinha sido mudada fora do app. O MyBots pôs de volta a que você escolheu.');
    }
    setFreeSettings(settings); return settings;
  }, []);
  const loadSupervisorState = useCallback(async () => {
    const next = await supervisor.current.call('state.get');
    if (phoneMode.current !== 'phone') return next;
    lastSeq.current = typeof next.seq === 'number' ? next.seq : null;
    appStore.sequence(lastSeq.current);
    // The conversation on screen is being read: its new messages are not unseen.
    const seen = item => item.id === openChat.current ? { ...item, unread: 0 } : item;
    setData({ ...next, bots: next.bots.map(seen), rooms: (next.rooms || []).map(seen) }); setLoadError('');
    checkFree(next).catch(() => {});

    return next;
  }, []);
  // Every (re)connection hands the supervisor the secrets key and, once per release, the connector bundle.
  const prepareSupervisor = useCallback(async () => {
    // The window on the computer only talks to the phone; secrets, connectors and the time zone are the phone's.
    if (desktop) return;
    await supervisor.current.call('secrets.unlock', { key: await readSecretsKey() });
    // Bot notifications are shown by MyBots itself; Android 13+ asks once.
    notificationPermission().catch(() => {});
    // Daily routines run on the phone's wall clock; Termux's Node may not know the Android time zone.
    try { await supervisor.current.call('device.timezone', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }); } catch {}
    if (!(await supervisor.current.call('connectors.status')).installed) await supervisor.current.call('connectors.install', { data: await readConnectorBundle() });
    // Notifications queued while the supervisor was down are delivered now.
    flushNotifications().catch(() => {});
    // Keeps routines and notices working with the screen off (only if the person did not turn it off).
    startKeepAlive()?.catch(() => {});
  }, []);
  // A page of a conversation: the latest (replacing what was loaded) or the one before the oldest loaded.
  const loadChat = useCallback(async (target, older = false) => {
    const key = target.botId || target.roomId;
    const pending = loadingPages.current.get(key);
    if (pending) { if (!older && pending.older) { await pending.work; return loadChat(target); } return pending.work; }
    const before = older ? chatsRef.current[key]?.before : undefined;
    if (older && !before) return;
    const work = (async () => {
    const page = await supervisor.current.call('chat.page', { ...target, ...(before ? { before } : {}) });
    appStore.page(key, page, older);
    if (!older) setData(old => old ? { ...old, bots: old.bots?.map(bot => bot.id === key ? { ...bot, unread: 0 } : bot), rooms: old.rooms?.map(room => room.id === key ? { ...room, unread: 0 } : room) } : old);
    })().finally(() => loadingPages.current.delete(key));
    loadingPages.current.set(key, { work, older }); return work;
  }, []);
  // After a missed event or a reconnection: the state again, and the latest page of each loaded conversation.
  const resync = useCallback(() => {
    if (resyncing.current) return resyncing.current;
    resyncing.current = (async () => {
    const next = await loadSupervisorState();
    const known = [...(next.bots || []).map(bot => bot.id), ...(next.rooms || []).map(room => room.id)];
    const loaded = Object.keys(chatsRef.current);
    setChats(old => Object.fromEntries(Object.entries(old).filter(([key]) => known.includes(key))));
    for (const key of loaded.filter(key => known.includes(key))) await loadChat((next.rooms || []).some(room => room.id === key) ? { roomId: key } : { botId: key }).catch(() => {});
    })().finally(() => { resyncing.current = null; });
    return resyncing.current;
  }, []);
  if (!supervisor.current) supervisor.current = Object.assign(new SupervisorClient({
    onEvent: (event, data) => {
      // A bot notice while the app is open: MyBots shows it and confirms, so Termux:API does not repeat it.
      if (event === 'bot.notify' && data?.id && !desktop) {
        showBotNotification(data).then(shown => shown && supervisor.current.call('outbox.ack', { ids: [data.id] })).catch(() => {});
        return;
      }
      // Frames of a bot's Chrome on the computer go straight to its open panel, without reloading the state.
      // The reply as it is written goes straight to the store, without reloading anything.
      if (event === 'message.draft') { appStore.draft(data); return; }
      if (event === 'browser.frame') { for (const listener of browserFrames) listener(data); return; }
      // The browser's timeline and downloads go to the open conversation's panels.
      if (event === 'browser.step' || event === 'browser.download') { for (const listener of browserEvents) listener(event, data); return; }
      if (phoneMode.current === 'phone' && typeof data?.seq === 'number') {
        const result = appStore.event(event, data, openChat.current);
        if (result.duplicate) return;
        if (result.gap) { clearTimeout(eventRefresh.current); resync().catch(error => setLoadError(error.message)); return; }
        if (['message.added', 'message.updated', 'bot.updated'].includes(event)) return;
        if (event === 'chat.reset') { const key = data.botId || data.roomId; if (chatsRef.current[key]) loadChat(data.botId ? { botId: key } : { roomId: key }).catch(() => {}); return; }
        if (event === 'task.progress' && 'step' in data) return;
      }
      clearTimeout(eventRefresh.current);
      eventRefresh.current = setTimeout(() => { if (phoneMode.current === 'phone') loadSupervisorState().catch(error => setLoadError(error.message)); }, 150);
    },
    onConnection: connected => {
      if (phoneMode.current !== 'phone') return;
      if (connected) prepareSupervisor().catch(error => setLoadError(error.message)).finally(() => resync().catch(error => setLoadError(error.message)));
      else setData(current => current ? { ...current, supervisorConnected: false, connection: { available: false, loggedIn: false, message: desktop ? 'O MyBots do computador reiniciou. Reconectando…' : 'Supervisor desconectado. Reconectando ao Termux…' } } : current);
    }
  }), {
    // The window on the computer: a refused token means the page is older than the node's; a fresh page has the right one.
    onRefused: error => { if (desktop && /Acesso negado/.test(error?.message || '')) setTimeout(() => globalThis.location?.reload(), 1500); }
  });

  const refreshComputer = useCallback(async (token = apiToken, base = apiBase) => {
    const next = await api('/api/state', undefined, token, base);
    setData(next); setLoadError('');
    return next;
  }, [apiBase, apiToken]);
  const refreshPhone = useCallback(async (saved = localCache) => {
    if (!termuxAvailable && !desktop) throw new Error('O supervisor exige o APK próprio do MyBots.');
    if (phoneConnecting.current) return phoneConnecting.current;
    phoneConnecting.current = (async () => {
      if (desktop) {
        setData(current => current || { bots: [], active: [], models: [], supervisorConnected: false, connection: { available: false, loggedIn: false, message: 'Conectando ao celular pelo computador…' }, device: 'MyBots no computador' });
        await supervisor.current.connect({ port: desktop.port, token: desktop.token });
        return loadSupervisorState();
      }
      const store = { ...emptyLocalStore(), ...(saved || {}), mode: 'phone', bots: saved?.bots || [] };
      setLocalCache(store);
      setChats(current => ({ ...cachedConversations(store), ...current }));
      setData(current => ({ ...(current || {}), bots: store.bots.filter(bot => !bot.deletedAt), rooms: store.rooms || [], active: activePhoneBots(store), models: current?.models || [],
        supervisorConnected: false, connection: { available: false, loggedIn: false, message: 'Conectando ao supervisor no Termux…' }, device: 'Supervisor no Termux' }));
      const existing = await readPairing();
      if (existing) {
        try { await supervisor.current.connect(existing); return await loadSupervisorState(); }
        catch { supervisor.current.close(); }
      }
      let snapshot = (await readLocalStore()) || store;
      if (!snapshot.supervisorMigrated) {
        await phone.current.recover();
        snapshot = (await readLocalStore()) || snapshot;
        if (activePhoneBots(snapshot).length) throw new Error('Aguarde a resposta da versão anterior terminar antes de iniciar o supervisor.');
      }
      setData(current => ({ ...current, connection: { available: false, loggedIn: false, message: 'Preparando o núcleo no Termux. Na primeira vez pode levar alguns minutos…' } }));
      const backup = await createTermuxBackup(runPhoneCommand, snapshot);
      // Pairing returns a secret: never pass this operation through the diagnostic logger.
      const parts = await supervisorParts();
      for (let index = 0; index < parts; index++) {
        const staged = await runTermux('pairPart', { index });
        if (staged.exitCode !== 0 || staged.errorMessage) throw new Error('Não consegui copiar o pacote do supervisor para o Termux. Toque em conectar novamente.');
      }
      const result = await runTermux('pair', { migrationBackup: backup.name });
      if (result.exitCode !== 0 || result.errorMessage) {
        setTermuxLog({ operation: 'pair', startedAt: new Date().toISOString(), exitCode: result.exitCode, stderr: result.stderr, errorMessage: result.errorMessage });
        throw new Error('Não consegui preparar o supervisor. Abra o Termux e confira ~/.mybots/ambiente-supervisor.txt, ~/.mybots/testes-supervisor.txt e ~/.mybots/supervisor.log. Depois toque em conectar novamente.');
      }
      let envelope; try { envelope = JSON.parse(result.stdout); } catch { throw new Error('O Termux não confirmou o pareamento.'); }
      const credentials = await savePairing(envelope);
      await supervisor.current.connect(credentials);
      return loadSupervisorState();
    })().finally(() => { phoneConnecting.current = null; });
    return phoneConnecting.current;
  }, [localCache, loadSupervisorState, runPhoneCommand]);
  const refresh = useCallback((token = apiToken) => mode === 'phone' ? refreshPhone() : refreshComputer(token),
    [apiToken, mode, refreshComputer, refreshPhone]);
  useEffect(() => {
    let mounted = true;
    const loadFromLink = async url => {
      if (desktop) { if (mounted) setMode('phone'); await refreshPhone(); return; }
      const params = url ? new URL(url).searchParams : null;
      const token = params?.get('token');
      if (!token) {
        const saved = termuxAvailable ? await readLocalStore() : null;
        if (saved?.mode === 'phone') {
          if (mounted) { setMode('phone'); setLocalCache(saved); }
          await refreshPhone(saved);
          return;
        }
        throw new Error('Escaneie o QR code do MyBots no computador para conectar o app.');
      }
      const base = (params.get('api') || DEFAULT_API_URL).replace(/\/$/, '');
      if (mounted) { setMode('computer'); setApiToken(token); setApiBase(base); setInitialLoading(true); }
      const next = await api('/api/state', undefined, token, base);
      if (mounted) { setData(next); setLoadError(''); }
    };
    const subscription = Linking.addEventListener('url', event => {
      loadFromLink(event.url).catch(error => { if (mounted) setLoadError(error.message); })
        .finally(() => { if (mounted) setInitialLoading(false); });
    });
    Linking.getInitialURL().then(url => loadFromLink(url))
      .catch(error => { if (mounted) setLoadError(error.message); })
      .finally(() => { if (mounted) setInitialLoading(false); });
    return () => { mounted = false; subscription.remove(); };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      if (mode === 'computer' && (data?.active?.length || loadError)) refresh().catch(error => setLoadError(error.message));
    }, 1500);
    return () => clearInterval(timer);
  }, [data?.active?.length, loadError, mode, refresh]);

  useEffect(() => {
    if (mode !== 'phone') { supervisor.current.close(); return; }
    const refreshState = () => {
      if (supervisor.current.authenticated) loadSupervisorState().catch(error => setLoadError(error.message));
      else if (!phoneConnecting.current) refreshPhone().catch(error => setLoadError(error.message));
    };
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') refreshState(); });
    const timer = setInterval(() => { if (AppState.currentState === 'active' && supervisor.current.authenticated) refreshState(); }, 15000);
    return () => { subscription.remove(); clearInterval(timer); };
  }, [mode, loadSupervisorState, refreshPhone]);
  useEffect(() => () => { clearTimeout(eventRefresh.current); supervisor.current.close(); }, []);

  // Pictures in the conversation are read through the same file call as Open / Share / Save (in 3 MB parts).
  useEffect(() => {
    setImageReader(async file => {
      let offset = 0, data = '';
      do { const part = await supervisor.current.call('file.read', { id: file.id, offset }); data += part.chunk; offset = part.next; } while (offset !== null);
      return `data:${file.mime};base64,${data}`;
    });
  }, []);
  const openConversationFile = file => {
    setFileNote('');
    if (!file.id && file.reference && file.botId) {
      const messages = chatsRef.current[file.botId]?.messages || [];
      const matches = new Map(messages.flatMap(message => message.attachments || []).filter(item => item.name === file.name).map(item => [item.id, item]));
      if (matches.size === 1) file = [...matches.values()][0];
    }
    setFileSheet({ ...file });
  };
  const fileAct = async (file, action) => {
    setFileBusy(file.id); setFileNote('');
    // On the computer the node saves the file in ~/Downloads and opens it with the default app.
    if (desktop) {
      try { const result = await supervisor.current.call('desktop.file', { id: file.id, name: file.name, action }); if (action === 'save') setFileNote(`Salvo em ${result.path}.`); else setFileSheet(null); }
      catch (error) { setFileNote(error.message); } finally { setFileBusy(null); }
      return;
    }
    try {
      if (!staged.current.has(file.id)) {
        let offset = 0, first = true;
        do {
          const part = await supervisor.current.call('file.read', { id: file.id, offset });
          await fileStage(file.id, file.name, part.chunk, !first); first = false; offset = part.next;
        } while (offset !== null);
        staged.current.add(file.id);
      }
      const result = await fileAction(file.id, file.name, file.mime || 'application/octet-stream', action);
      if (action === 'save') setFileNote(`Salvo em ${result}.`); else setFileSheet(null);
    } catch (error) { setFileNote(nativeMessage(error)); }
    finally { setFileBusy(null); }
  };
  const completeItem = async id => {
    try { await supervisor.current.call('item.complete', { id }); await loadSupervisorState(); } catch (error) { setLoadError(error.message); }
  };
  const checkConnection = async () => {
    setConnectionBusy(true);
    try {
      if (mode === 'phone') {
        if (supervisor.current.authenticated) { await supervisor.current.call('connection.refresh'); await loadSupervisorState(); }
        else await refreshPhone();
      }
      else { await api('/api/connection', {}, apiToken, apiBase); await refreshComputer(); }
    }
    catch (error) { setLoadError(error.message); }
    finally { setConnectionBusy(false); }
  };
  const pinMessage = (message, pinned) => supervisor.current.call('message.pin', { messageId: message.id, pinned });
  const send = async (text, files = []) => {
    const bot = data?.bots.find(item => item.id === selected);
    // On the phone the supervisor queues messages sent while the bot works; the computer backend still answers one at a time.
    if (!bot || maintenanceBusy || (!text.trim() && !files.length) || sending || (mode === 'computer' && data.active?.includes(bot.id))) return false;
    setSending(true);
    if (mode === 'computer') {
      try {
        await api(`/api/bots/${bot.id}/messages`, { text: text.trim() }, apiToken, apiBase);
        setDraft(''); await refreshComputer();
      } catch (error) { setLoadError(error.message); }
      finally { setSending(false); }
      return;
    }
    try {
      await supervisor.current.call('chat.send', { botId: bot.id, requestId: createId(), text: text.trim(), ...(files.length ? { attachments: await uploadWebFiles((...args) => supervisor.current.call(...args), bot.id, files) } : {}) });
      setDraft(''); await loadSupervisorState(); return true;
    } catch (error) { setLoadError(error.message); return false; }
    finally { setSending(false); }
  };
  const cancelTask = async taskId => {
    try { await supervisor.current.call('task.cancel', { taskId }); await loadSupervisorState(); }
    catch (error) { setLoadError(error.message); }
  };
  const saveSettings = async (model, reasoningEffort, provider) => {
    const bot = data?.bots.find(item => item.id === selected);
    if (!bot || maintenanceBusy || savingSettings || data.active?.includes(bot.id)) return;
    setSavingSettings(true);
    try {
      if (mode === 'phone') {
        await supervisor.current.call('bot.update', { botId: bot.id, model, reasoningEffort, ...(provider ? { provider } : {}) });
        await loadSupervisorState();
      } else { await api(`/api/bots/${bot.id}/settings`, { model, reasoningEffort }, apiToken, apiBase); await refreshComputer(); }
    }
    catch (error) { setLoadError(error.message); }
    finally { setSavingSettings(false); }
  };
  // Changes a bot's access level; Livre first shows its warning (once) and records the bot natively before the supervisor hears of it.
  const applyAccess = async (botId, access) => {
        if (access === 'free') {
          const guard = await freeGuard().catch(() => null);
          if (!guard?.warned) await new Promise((resolve, reject) => Alert.alert('Nível Livre: o bot age como você no celular',
            'Ele vai poder abrir e usar os outros apps do celular (mandar mensagens, pedir comida, mexer em configurações), usar o terminal completo do Termux e agir nos sites e contas em que você está logado, sem pedir licença a cada passo.\n\nSó pedem aprovação os itens que você deixar em “Sempre perguntar”. Senhas, cartões e códigos continuam sem passar pela IA, CAPTCHA e bancos continuam com você, e cada ação fica na Atividade.\n\nEnquanto ele controla o celular, uma barra com Parar fica sempre na tela. Use Livre só com bots e pedidos em que você confia.',
            [{ text: 'Cancelar', style: 'cancel', onPress: () => reject(new Error('')) }, { text: 'Entendi, usar Livre', style: 'destructive', onPress: resolve }]));
        }
        // The app's own record comes first: MyBotsAccess obeys only bots it lists.
        if (!desktop && termuxAvailable) await freeGuardSet(botId, access === 'free');
        await supervisor.current.call('bot.update', { botId, access }); await loadSupervisorState(); if (profileId === botId) await loadProfile(botId);
        if (access === 'free') loadFree().catch(() => {});
  };
  const createBot = async (payload, extra = {}) => {
    if (maintenanceBusy) throw new Error('Aguarde o backup ou a restauração terminar.');
    if (mode === 'phone') {
      const bot = await supervisor.current.call('bot.create', payload);
      await loadSupervisorState(); setSelected(bot.id); setDraft(extra.first || ''); setCreateVisible(false);
      // Livre needs its warning, so it is applied after the bot exists, like in the profile; declining leaves the bot at Médio.
      if (extra.free) applyAccess(bot.id, 'free').catch(() => {});
      return;
    }
    const bot = await api('/api/bots', payload, apiToken, apiBase);
    await refreshComputer(); setSelected(bot.id); setDraft(''); setCreateVisible(false);
  };
  const changeMode = async nextMode => {
    setModeVisible(false);
    if (nextMode === mode) return;
    if (data?.active?.length || sending || savingSettings || maintenanceBusy) { setLoadError('Aguarde a resposta atual terminar antes de trocar o modo.'); return; }
    setLoadError(''); setTermuxLog(null); setConnectionBusy(true);
    if (nextMode === 'phone') {
      setMode('phone'); setData(null);
      try {
        let saved = termuxAvailable ? (await readLocalStore()) || emptyLocalStore() : emptyLocalStore();
        if (apiToken && apiBase) {
          try {
            const remote = await api('/api/state', undefined, apiToken, apiBase);
            saved = { ...saved, bots: mergeBotLists(saved.bots, [...remote.bots, ...(remote.deletedBots || [])].map(({ codexSessionId, ...bot }) => bot)) };
          } catch { /* The phone can use its saved conversations while the PC is unavailable. */ }
        }
        saved = { ...saved, mode: 'phone' };
        await writeLocalStore(saved); setLocalCache(saved);
        await refreshPhone(saved);
        if (saved.supervisorMigrated) {
          await supervisor.current.call('bots.merge', { bots: saved.bots });
          await loadSupervisorState();
        }
      } catch (error) { setLoadError(error.message); }
      finally { setConnectionBusy(false); }
      return;
    }
    try {
      if (supervisor.current.authenticated) await loadSupervisorState();
      const saved = termuxAvailable ? await readLocalStore() : localCache;
      if (!apiToken || !apiBase) throw new Error('Abra o QR code do computador para conectar ao modo Celular + computador.');
      if (saved?.bots?.length) await api('/api/sync', { bots: saved.bots }, apiToken, apiBase);
      const remote = await api('/api/state', undefined, apiToken, apiBase);
      setMode('computer'); setData(remote); setLocalCache({ ...saved, mode: 'computer' });
      if (termuxAvailable) await writeLocalStore({ ...saved, mode: 'computer' });
    } catch (error) { setLoadError(error.message); }
    finally { setConnectionBusy(false); }
  };
  const saveBackup = async () => {
    return supervisor.current.call('backup.create');
  };
  const maintenance = async action => {
    if (maintenanceBusy) return;
    setMaintenanceBusy(true);
    try { await action(); }
    catch (error) { setMaintenanceText(error.message); }
    finally { setMaintenanceBusy(false); }
  };
  const restoreBackup = name => Alert.alert('Restaurar este backup?', 'Bots e conversas serão substituídos pelo estado salvo. Antes, uma cópia do estado atual será salva no Termux.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Restaurar', onPress: () => maintenance(async () => {
      if (data?.active?.length || sending) throw new Error('Aguarde as respostas terminarem antes de restaurar.');
      const backup = validateBackup(await supervisor.current.call('backup.read', { name }));
      await supervisor.current.call('backup.restore', { snapshot: backup });
      await loadSupervisorState();
      setSelected(null); setDraft('');
      setMaintenanceText('Backup restaurado. Bots e identificadores foram preservados.');
    }) }
  ]);
  const deleteBot = target => Alert.alert(`Apagar ${target.name}?`, 'O bot e suas conversas serão removidos. Backups anteriores continuam disponíveis.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Apagar bot', style: 'destructive', onPress: async () => {
      try {
        if (maintenanceBusy) throw new Error('Aguarde a manutenção terminar.');
        if (mode === 'phone') { await supervisor.current.call('bot.delete', { botId: target.id }); await loadSupervisorState(); }
        else { await api(`/api/bots/${target.id}/delete`, {}, apiToken, apiBase); await refreshComputer(); }
        if (profileId === target.id) setProfileId(null);
        if (selected === target.id) { setSelected(null); setDraft(''); }
      } catch (error) { setLoadError(error.message); }
    } }
  ]);
  const copyLogs = async () => {
    if (!termuxLog) return;
    try {
      await copyTermuxText(formatTermuxLog(termuxLog));
      setLogsCopied(true);
    } catch { setLogsCopied(false); }
  };
  const respondApproval = async (approval, approved, always = false) => {
    setApprovalBusy(approval.id);
    try { await supervisor.current.call(...(approval.kind === 'negotiation' ? ['negotiation.respond', { offerId: approval.offerId, accept: approved }] : ['approval.respond', { approvalId: approval.id, actionHash: approval.actionHash, approved, always }])); await loadSupervisorState(); }
    catch (error) { setLoadError(error.message); }
    finally { setApprovalBusy(null); }
  };
  const saveProfile = async payload => {
    if (!profileId) return createBot(payload);
    if (mode === 'phone') { await supervisor.current.call('bot.update', { botId: profileId, ...payload }); await loadSupervisorState(); }
    else { await api(`/api/bots/${profileId}/settings`, payload, apiToken, apiBase); await refreshComputer(); }
    setProfileId(null);
  };
  const openLogs = termuxLog ? () => { setLogsCopied(false); setLogsVisible(true); } : null;
  const { width: windowWidth } = useWindowDimensions();
  // React Native's Alert does nothing on the web: on the computer the same confirmations open as a small dialog.
  const [confirm, setConfirm] = useState(null);
  useEffect(() => { if (desktop) Alert.alert = (title, message, buttons = [{ text: 'OK' }]) => setConfirm({ title, message, buttons }); }, []);
  const bot = data?.bots.find(item => item.id === selected);
  const room = data?.rooms?.find(item => item.id === roomId);
  // The conversation on screen loads its latest page when opened (resync reloads it after a reconnection); leaving it
  // marks it as seen up to the end.
  const openKey = mode === 'phone' && data?.supervisorConnected ? room?.id || bot?.id || null : null; const openRoom = Boolean(room);
  useEffect(() => {
    openChat.current = openKey;
    if (!openKey) return undefined;
    const target = openRoom ? { roomId: openKey } : { botId: openKey };
    loadChat(target).catch(error => setLoadError(nativeMessage(error)));
    return () => { supervisor.current?.call('chat.read', target).catch(() => {}); };
  }, [openKey]);
  const loadProfile = useCallback(id => supervisor.current.call('bot.profile', { botId: id }).then(setProfile).catch(error => setLoadError(nativeMessage(error))), []);
  useEffect(() => { if (profileId && mode === 'phone') loadProfile(profileId); else setProfile(null); }, [profileId]);
  const shownProfile = profile?.botId === profileId ? profile : null;
  // After a change in the profile: the state and the profile's own lists.
  const profileChanged = async () => { await loadSupervisorState(); if (profileId) await loadProfile(profileId); };
  const profileFree = data?.bots?.find(item => item.id === profileId)?.access === 'free';
  useEffect(() => { if (profileId && profileFree) loadFree().catch(() => {}); }, [profileId, profileFree]);
  const roomSave = async payload => {
    if (roomSheet?.room) await supervisor.current.call('room.update', { roomId: roomSheet.room.id, ...payload });
    else { const created = await supervisor.current.call('room.create', payload); setRoomId(created.id); setSelected(null); }
    await loadSupervisorState(); setRoomSheet(null);
  };
  const roomDelete = target => Alert.alert(`Apagar a sala ${target.name}?`, 'A conversa da sala some. Os bots e as conversas privadas deles continuam.', [{ text: 'Cancelar', style: 'cancel' },
    { text: 'Apagar sala', style: 'destructive', onPress: async () => { try { await supervisor.current.call('room.delete', { roomId: target.id }); setRoomSheet(null); setRoomId(null); await loadSupervisorState(); } catch (error) { setLoadError(nativeMessage(error)); } } }]);
  // Tapping a bot notification opens that bot's conversation, whether MyBots was closed or in the background.
  useEffect(() => {
    if (!termuxAvailable) return undefined;
    const open = id => { if (id) { setSelected(id); setRoomId(null); setProfileId(null); setCreateVisible(false); setMaintenanceVisible(false); setActivityVisible(false); setFileSheet(null); setDraft(''); supervisor.current?.call('state.get').then(state => { if (/captcha|desafio/i.test(state.browser?.help?.[id]?.reason || '')) return supervisor.current.call('browser.control', { botId:id,who:'person' }).then(loadSupervisorState); }).catch(() => {}); } };
    const check = () => { Promise.resolve(takeLaunchBot()).then(open).catch(() => {}); };
    check();
    const subscription = onOpenBot(event => open(event?.botId));
    const foreground = AppState.addEventListener('change', state => { if (state === 'active') check(); });
    return () => { subscription.remove(); foreground.remove(); };
  }, []);
  useEffect(() => {
    if (!termuxAvailable) return undefined;
    const check = () => { Promise.resolve(takeShare()).then(next => next && setShare(next)).catch(() => {}); };
    check();
    const subscription = onShare(check);
    const foreground = AppState.addEventListener('change', state => { if (state === 'active') check(); });
    return () => { subscription.remove(); foreground.remove(); };
  }, []);
  const checkUpdate = useCallback(async function checkUpdate(manual = false, foreground = false) {
    if (!termuxAvailable) return;
    if (!manual && Date.now() - updateChecked.current < (foreground ? 1 : 6) * 3600000) return;
    updateChecked.current = Date.now();
    if (manual) setUpdate(old => ({ ...old, checking: true, error: '' }));
    try { const info = await updateCheck(); setUpdate(old => ({ ...old, info, checking: false, error: '', dismissed: manual ? false : old?.dismissed })); }
    catch (error) {
      setUpdate(old => ({ ...old, checking: false, error: manual ? nativeMessage(error) : '' }));
      // The network may not be up yet when the app opens: try again in a minute.
      if (!manual) { updateChecked.current = 0; setTimeout(() => checkUpdate(), 60000); }
    }
  }, []);
  useEffect(() => {
    if (!termuxAvailable) return undefined;
    checkUpdate();
    const subscription = onUpdate(step => setUpdate(old => ({ ...old, step })));
    const foreground = AppState.addEventListener('change', state => { if (state === 'active') { checkUpdate(false, true); resumeUpdate.current?.(); } });
    return () => { subscription.remove(); foreground.remove(); };
  }, [checkUpdate]);
  // Back from "Instalar apps desconhecidos": the update continues by itself.
  const resumeUpdate = useRef(null);
  resumeUpdate.current = () => { if (update?.step?.state === 'permission') updateCanInstall().then(allowed => allowed && installUpdate()).catch(() => {}); };
  const installUpdate = async () => {
    const info = update?.info; if (!info?.apkUrl) return;
    setUpdate(old => ({ ...old, step: { state: 'downloading', percent: 0 } }));
    try { const result = await updateInstall(info.apkUrl, info.shaUrl); if (result === 'permission') setUpdate(old => ({ ...old, step: { state: 'permission' } })); }
    catch (error) { setUpdate(old => ({ ...old, step: { state: 'error', message: nativeMessage(error) } })); }
  };
  const pickShare = target => {
    setIncoming({ ...share, botId: target.id }); setShare(null);
    setSelected(target.id); setRoomId(null); setProfileId(null); setCreateVisible(false);
    const text = shareText(share);
    setDraft(old => selected === target.id && old.trim() ? `${old.trim()}\n${text}`.trim() : text);
  };
  // Direct Share from the system sheet names its bot; the others ask which one.
  useEffect(() => {
    if (!share?.botId || !data?.bots) return;
    const target = data.bots.find(item => item.id === share.botId);
    if (target) pickShare(target); else setShare({ ...share, botId: null });
  }, [share, data?.bots]);
  const roomView = data && room ? <RoomScreen onPin={pinMessage} room={{ ...room, messages: chatsRef.current[room.id]?.messages || [] }} data={data} phone={mode === 'phone' && termuxAvailable} call={(method, params) => supervisor.current.call(method, params)} more={Boolean(chatsRef.current[room.id]?.more)} onEarlier={() => loadChat({ roomId: room.id }, true).catch(error => setLoadError(nativeMessage(error)))} onBack={desktop ? null : () => setRoomId(null)} onEdit={() => setRoomSheet({ room })} onRespond={respondApproval} approvalBusy={approvalBusy} onFile={openConversationFile} fileBusy={fileBusy}
          onSend={async (text, files = []) => { await supervisor.current.call('room.send', { roomId: room.id, requestId: createId(), text: text.trim(), ...(files.length ? { attachments: files.map(({ name, mime, data }) => ({ name, mime, data })) } : {}) }); await loadSupervisorState(); }}
          onCancel={botId => { const task = data.tasks?.find(item => room.activeTasks?.includes(item.id) && item.bot_id === botId); if (task) cancelTask(task.id); }} /> : null;
  const chatView = data && bot && !room ? <ChatScreen onPin={pinMessage} onQueuePause={async (botId, paused) => { await supervisor.current.call('queue.pause', { botId, paused }); await loadSupervisorState(); }} onSteer={async (botId, text) => { await supervisor.current.call('task.steer', { botId, requestId: createId(), text }); await loadSupervisorState(); }} onCancelTask={cancelTask} bot={mode === 'phone' ? { ...bot, messages: chatsRef.current[bot.id]?.messages || [] } : bot} data={data}
          more={mode === 'phone' && Boolean(chatsRef.current[bot.id]?.more)} onEarlier={() => loadChat({ botId: bot.id }, true).catch(error => setLoadError(nativeMessage(error)))} error={loadError} onLogs={openLogs} draft={draft} setDraft={setDraft} sending={sending} saving={savingSettings || maintenanceBusy} mode={mode}
          onBack={desktop ? null : () => { setSelected(null); setDraft(''); }} onMode={() => setModeVisible(true)} onSend={send} onRetry={send} onSettings={saveSettings} onConnection={checkConnection} onProfile={() => { setProfileTab(null); setProfileId(bot.id); }} onRespond={respondApproval} approvalBusy={approvalBusy} onDelete={() => deleteBot(bot)}
          onFile={openConversationFile} fileBusy={fileBusy} incoming={incoming?.botId === bot.id ? incoming : null} onIncoming={() => setIncoming(null)}
          passwordAsk={passwordAsk} onPasswordAnswer={async scope => { await passwordOfferAnswer(scope).catch(error => setLoadError(nativeMessage(error))); setPasswordAsk(null); }}
          onBrowserControl={async who => { await supervisor.current.call('browser.control', { botId: bot.id, who }); await loadSupervisorState(); }} browserCall={(method, params) => supervisor.current.call(method, params)} onCancel={() => { const task = data.tasks?.find(item => item.bot_id === bot.id && ['queued','running','waiting_approval'].includes(item.state)); if (task) cancelTask(task.id); }}
          onPhoneStop={async () => { await Promise.resolve(phoneStopNow()).catch(() => {}); await supervisor.current.call('phone.stop', {}); await loadSupervisorState(); }}
          onPhoneControl={desktop ? null : async who => { await supervisor.current.call('phone.control', { who }); await loadSupervisorState(); }} /> : null;
  const settingsContext = { data, mode, call: (method, params) => supervisor.current.call(method, params), reload: loadSupervisorState,
      busy: maintenanceBusy, text: maintenanceText, setText: setMaintenanceText, backupNames, setBackupNames, maintenance, saveBackup, restoreBackup, update, checkUpdate, installUpdate,
      openProfile: bot => { setProfileTab(null); setProfileId(bot.id); }, onCreate: () => setCreateVisible(true), openWallet: () => setWalletVisible(true), readDeviceInfo, copyText: copyTermuxText };
  // On the computer these are whole pages beside the icon bar instead of sheets.
  const deskPages = desktop ? {
    activity: <ActivityPage data={data} reload={loadSupervisorState} cancelTask={cancelTask} completeItem={completeItem} call={{ respond: respondApproval, busy: approvalBusy, method: (method, params) => supervisor.current.call(method, params) }} />,
    settings: <SettingsSheet inline onClose={() => setDeskPage(null)} a={settingsContext} />
  } : {};
  const profileSheet = data ? <BotProfile inline={Boolean(desktop)} initialTab={profileTab} visible={Boolean(profileId)} bot={data.bots.find(item => item.id === profileId)} models={data.models || []} defaultSelection={data.defaultSelection}
      phone={mode === 'phone'} active={data.active?.includes(profileId)} ModelSettings={ModelSettings} connections={data.connections} grants={shownProfile?.grants || []} nodes={data.nodes || []}
      memories={shownProfile?.memories || []} items={(data.pendingItems || []).filter(item => item.botId === profileId)}
      routines={(data.routines || []).filter(item => item.botId === profileId)}
      negotiations={data.negotiations || []} onNegotiation={async (method, params) => { await supervisor.current.call(method, params); await loadSupervisorState(); }}
      accountApps={shownProfile?.accountApps || []} accountServers={data.accountServers || []}
      onApps={async apps => { await supervisor.current.call('bot.apps', { botId: profileId, apps }); await profileChanged(); }}
      onFolders={async folders => { await supervisor.current.call('bot.update', { botId: profileId, folders }); await profileChanged(); }}
      loadAgentSkills={() => supervisor.current.call('agent.skills', {})}
      onAgentSkills={async skills => { await supervisor.current.call('bot.update', { botId: profileId, skills }); await profileChanged(); }}
      onFallback={async fallback => { await supervisor.current.call('bot.update', { botId: profileId, fallback }); await profileChanged(); }} FallbackSettings={FallbackSettings}
      onGpu={async gpu => { await supervisor.current.call('bot.update', { botId: profileId, gpu }); await profileChanged(); }}
      onBrowserMode={async browserMode => { await supervisor.current.call('bot.update', { botId: profileId, browserMode }); await profileChanged(); }}
      skills={shownProfile?.skills || []}
      onSkill={async (method, id) => {
        if (method === 'skill.remove') await new Promise((resolve, reject) => Alert.alert('Remover a habilidade?', 'O programa e a rotina dele saem deste celular.', [{ text: 'Cancelar', style: 'cancel', onPress: () => reject(new Error('')) }, { text: 'Remover', style: 'destructive', onPress: resolve }]));
        await supervisor.current.call(method, method === 'skill.run' ? { id, botId: profileId } : { id }); await profileChanged();
      }}
      onRoutine={async (method, id, params = {}) => { await supervisor.current.call(method, { id, ...params }); await loadSupervisorState(); }}
      onClose={() => { setCreateVisible(false); setProfileId(null); }} onSave={saveProfile}
      onGrant={async (tool, allowed) => { await supervisor.current.call('grants.set', { botId: profileId, tool, allowed }); await profileChanged(); }}
      onAccess={access => applyAccess(profileId, access)}
      freeChoice={mode === 'phone' && !desktop && termuxAvailable} freeSettings={freeSettings} PhoneControl={!desktop && termuxAvailable ? PhoneControlAccess : null}
      onFreeAsk={async (key, on) => {
        const list = (freeSettings?.options || []).filter(item => item.key === key ? on : item.ask).map(item => item.key);
        if (!desktop && termuxAvailable) await freeGuardAsk(JSON.stringify(list));
        setFreeSettings(await supervisor.current.call('free.set', { ask: list }));
      }}
      onComplete={async id => { await supervisor.current.call('item.complete', { id }); await loadSupervisorState(); }}
      onDelete={() => deleteBot(data.bots.find(item => item.id === profileId))} /> : null;
  return <View key={look} style={styles.app}>
    <ShareTargets />
    <StatusBar barStyle={look === 'light' ? 'dark-content' : 'light-content'} backgroundColor={C.bg} />
    {desktop ? <DesktopNetwork notice call={(method, params) => supervisor.current.call(method, params)} /> : null}
    {initialLoading && !data ? <View style={styles.loading}><Avatar bot={{ name: 'MyBots', color: 'green', avatar: 'orbit' }} size={110} state="working" /><Text style={styles.loadingTitle}>mybots</Text><Text style={styles.loadingText}>Acordando seu time…</Text></View>
      : !data ? <View style={styles.loading}><Avatar bot={{ name: 'MyBots', color: 'orange', avatar: 'cat' }} size={96} state="waiting" /><Text style={styles.loadingTitle}>Não consegui conectar</Text><Text style={styles.loadingText}>{loadError}</Text><PrimaryButton icon="refresh" title={connectionBusy ? 'Conectando…' : 'Tentar novamente'} disabled={connectionBusy} onPress={() => refresh().catch(error => setLoadError(error.message))} style={{ alignSelf: 'stretch' }} />{desktop ? <DesktopPair compact call={(method, params) => supervisor.current.call(method, params)} /> : <Pressable accessibilityRole="button" onPress={() => setModeVisible(true)} style={styles.changeModeButton}><Text style={styles.changeModeText}>Trocar modo de conexão</Text></Pressable>}</View>
      : desktop ? <DesktopShell fileKey={fileSheet} onFile={openConversationFile} profileOpen={Boolean(profileId)} profilePanel={profileSheet} onProfileClose={() => { setCreateVisible(false); setProfileId(null); }} onBrowserControl={async (botId, who) => { await supervisor.current.call('browser.control', { botId, who }); await loadSupervisorState(); }} onSend={send} fileOpen={Boolean(fileSheet)} onFileClose={() => { setFileSheet(null); setFileNote(''); }}
          filePanel={fileSheet ? <FilePreview file={fileSheet} call={(method, params) => supervisor.current.call(method, params)} onClose={() => { setFileSheet(null); setFileNote(''); }} onAction={fileAct} busy={fileBusy} note={fileNote} /> : null} page={deskPage} onPage={setDeskPage} pages={deskPages} data={data} error={loadError} selected={room ? null : selected} roomId={roomId} onConnection={checkConnection}
          onOpen={id => { setSelected(id); setRoomId(null); setDraft(''); }} onRoom={id => { setRoomId(id); setSelected(null); }} onHome={() => { setSelected(null); setRoomId(null); setDraft(''); }} onSearch={() => setSearchVisible(true)} onCreate={() => setCreateVisible(true)} onNewRoom={() => setRoomSheet({})}
          onProfile={(target, tab) => { setProfileTab(tab || null); setProfileId(target.id); }} onActivity={() => setActivityVisible(true)} onMaintenance={() => setMaintenanceVisible(true)} onWallet={termuxAvailable && !desktop ? () => setWalletVisible(true) : undefined} onRespond={respondApproval} approvalBusy={approvalBusy} onComplete={completeItem} call={(method, params) => supervisor.current.call(method, params)}>
          {roomView || chatView}</DesktopShell>
      : roomView || chatView || <HomeScreen onSearch={() => setSearchVisible(true)} data={data} error={loadError} onRetry={() => refresh().catch(error => setLoadError(error.message))} onLogs={openLogs}
            onCreate={() => setCreateVisible(true)} onOpen={id => { setSelected(id); setDraft(''); }} onConnection={checkConnection} mode={mode} onMode={() => setModeVisible(true)} onProfile={(target, tab) => { setProfileTab(tab || null); setProfileId(target.id); }} onRespond={respondApproval} approvalBusy={approvalBusy} onMaintenance={() => setMaintenanceVisible(true)} onWallet={termuxAvailable && !desktop ? () => setWalletVisible(true) : undefined} onActivity={() => setActivityVisible(true)}
            update={update} onUpdate={installUpdate} onUpdateDismiss={() => setUpdate(old => ({ ...old, dismissed: true }))}
            onRoom={id => { setRoomId(id); setSelected(null); }} onNewRoom={() => setRoomSheet({})} />}
    {confirm ? <Modal transparent visible animationType="fade" onRequestClose={() => { setConfirm(null); confirm.buttons.find(item => item.style === 'cancel')?.onPress?.(); }}>
      <View style={styles.sheetBackdrop}><View style={[styles.sheet, { maxWidth: 440 }]}>
        <Text style={styles.optionLabel}>{confirm.title}</Text>{confirm.message ? <Text style={[styles.optionDetail, { marginTop: 6 }]}>{confirm.message}</Text> : null}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>{confirm.buttons.map(button => <Pressable key={button.text} accessibilityRole="button" onPress={() => { setConfirm(null); button.onPress?.(); }}
          style={[button.style === 'cancel' ? styles.denyButton : styles.confirmButton, { flex: 1 }, button.style === 'destructive' && { backgroundColor: C.red + '22', borderColor: C.red + '66' }]}>
          <Text style={[styles.denyText, button.style === 'destructive' && { color: C.red }, !button.style && { color: C.accent }]}>{button.text}</Text></Pressable>)}</View>
      </View></View>
    </Modal> : null}
    {data ? <RoomSheet visible={Boolean(roomSheet)} room={roomSheet?.room} bots={data.bots || []} onClose={() => setRoomSheet(null)} onSave={roomSave} onDelete={() => roomDelete(roomSheet.room)} /> : null}
    {data ? <NewBot visible={createVisible} models={data.models || []} defaultSelection={data.defaultSelection} connections={data.connections} nodes={data.nodes || []} phone={mode === 'phone'}
      freeChoice={mode === 'phone' && !desktop && termuxAvailable} onClose={() => setCreateVisible(false)} onCreate={createBot} /> : null}
    {desktop ? null : profileSheet}
    <SettingsSheet visible={maintenanceVisible} onClose={() => setMaintenanceVisible(false)} a={settingsContext} />
    <Modal transparent visible={walletVisible} animationType="slide" onRequestClose={() => setWalletVisible(false)}>
      <View style={styles.sheetBackdrop}><View style={[styles.sheet, styles.sheetTall]}>
        <View style={styles.sheetHandle} />
        <SheetHeader title="Carteira" subtitle="Cartões dos seus bots, com limites que só você muda." onClose={() => setWalletVisible(false)} />
        <ScrollView style={styles.sheetOptions} contentContainerStyle={{ paddingBottom: 18 }}>
          {walletVisible ? <WalletPanel bots={(data?.bots || []).filter(bot => !bot.deletedAt)} /> : null}
        </ScrollView>
      </View></View>
    </Modal>
    <SearchSheet visible={searchVisible} call={(method, params) => supervisor.current.call(method, params)} bots={data?.bots || []} rooms={data?.rooms || []} onClose={() => setSearchVisible(false)} onTask={(target, text) => { setRoomId(null); setSelected(target.id); setDraft(text); }}
      onOpen={item => { if (item.kind === 'room') { setRoomId(item.ownerId); setSelected(null); } else { setSelected(item.ownerId); setRoomId(null); setDraft(''); } }} />
    <Modal transparent visible={activityVisible} animationType="slide" onRequestClose={() => setActivityVisible(false)}>
      <View style={styles.sheetBackdrop}><View style={[styles.sheet, styles.sheetTall, desktop && { maxWidth: 1180, width: '100%', alignSelf: 'center' }]}>
        <View style={styles.sheetHandle} />
        <SheetHeader title="Atividade" subtitle={`${data?.supervisorConnected ? 'Supervisor conectado' : 'Supervisor desconectado'} · último sinal ${data?.heartbeat ? new Date(data.heartbeat).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'não confirmado'}`} onClose={() => setActivityVisible(false)} />
        {desktop ? <ActivityColumns data={data} reload={loadSupervisorState} cancelTask={cancelTask} completeItem={completeItem} call={{ respond: respondApproval, busy: approvalBusy, method: (method, params) => supervisor.current.call(method, params) }} /> : <ScrollView style={styles.sheetOptions} contentContainerStyle={{ paddingBottom: 18 }}>
          {mode === 'phone' ? <><Text style={styles.sheetSection}>Uso</Text><UsagePanel usage={data?.usage} bots={data?.bots || []} connections={data?.connections}
            onRefresh={async provider => { await supervisor.current.call('limits.refresh', { provider }); await loadSupervisorState(); }} /></> : null}
          {mode === 'phone' ? <Text style={styles.sheetSection}>Funcionamento</Text> : null}
          {mode === 'phone' ? <View style={styles.modeOption}>
            <Text style={styles.optionLabel}>Interrupções · {(data?.interruptions || []).length ? `${data.interruptions.filter(item => Date.now() - Date.parse(item.created_at) < 7 * 86400000).length} nos últimos 7 dias` : 'nenhuma registrada'}</Text>
            {(data?.interruptions || []).slice(0, 5).map(item => <View key={item.id} style={styles.interruption}><Icon name={item.kind === 'supervisor_restarted' ? 'refresh' : 'pause'} size={14} color={item.kind === 'supervisor_restarted' ? C.accent : C.amber} /><Text style={[styles.optionDetail, { flex: 1, marginTop: 0 }]}>{item.detail}</Text></View>)}
            {!(data?.interruptions || []).length ? <Text style={styles.optionDetail}>Quando o celular pausar ou parar o supervisor, aparece aqui quando foi e como ele voltou.</Text> : null}
          </View> : null}
          {(data?.approvals || []).length ? <Pressable accessibilityRole="button" onPress={() => { setActivityVisible(false); setSelected(null); setRoomId(null); }} style={[styles.modeOption, styles.rowOption]}>
            <View style={[styles.rowIcon, { backgroundColor: C.accent + '22' }]}><Icon name="hand" size={19} color={C.accent} /></View>
            <View style={{ flex: 1 }}><Text style={styles.optionLabel}>{data.approvals.length > 1 ? `${data.approvals.length} decisões esperam você` : '1 decisão espera você'}</Text><Text style={styles.optionDetail}>Aprove ou recuse na tela inicial ou na conversa do bot. Cada decisão aparece num lugar só.</Text></View>
            <Icon name="right" size={16} color={C.faint} /></Pressable> : null}
          <ItemsByDeadline items={(data?.pendingItems || []).filter(item => item.state === 'open')} bots={data?.bots || []} onComplete={completeItem} />
          {(data?.tasks || []).filter(task => ['queued','running','waiting_approval'].includes(task.state)).length ? <Text style={styles.sheetSection}>Em andamento</Text> : null}
          {(data?.tasks || []).filter(task => ['queued','running','waiting_approval'].includes(task.state)).map(task => <View key={task.id} style={[styles.modeOption, styles.rowOption]}>
            <Avatar bot={data.bots.find(item => item.id === task.bot_id) || { name: 'Bot' }} size={36} state={task.state === 'waiting_approval' ? 'waiting' : 'working'} tile={false} />
            <View style={{ flex: 1 }}><Text style={styles.optionLabel}>{data?.bots?.find(item => item.id === task.bot_id)?.name || 'Bot'}</Text><Text style={styles.optionDetail}>{({ queued: 'Na fila', running: 'Respondendo', waiting_approval: 'Aguardando decisão' })[task.state]}</Text></View>
            <Pressable accessibilityRole="button" onPress={() => cancelTask(task.id)} style={styles.stopButton}><Icon name="stop" size={13} color={C.muted} /><Text style={styles.stopText}>Parar</Text></Pressable>
          </View>)}
          <Text style={styles.sheetSection}>Histórico</Text>
          <View style={styles.timeline}>{(data?.activity || []).slice(0, 40).map(item => <View key={item.id} style={styles.timelineRow}>
            <View style={[styles.timelineDot, /fail|denied|late|error/.test(item.kind) && { backgroundColor: C.red }, /approval/.test(item.kind) && { backgroundColor: C.amber }, /done|created|accepted|reminder|downloaded/.test(item.kind) && { backgroundColor: C.accent }]} />
            <View style={{ flex: 1 }}><Text style={styles.timelineText}>{item.detail}</Text><Text style={styles.timelineMeta}>{data.bots.find(bot => bot.id === item.bot_id)?.name ? `${data.bots.find(bot => bot.id === item.bot_id).name} · ` : ''}{new Date(item.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</Text></View>
          </View>)}</View>
        </ScrollView>}
      </View></View>
    </Modal>
    <Modal transparent visible={!desktop && Boolean(fileSheet)} animationType="slide" onRequestClose={() => { setFileSheet(null); setFileNote(''); }}>
      <View style={styles.sheetBackdrop}><View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        {fileSheet ? <View style={{ alignItems: 'center', marginBottom: 6 }}><FileBadge file={fileSheet} size={64} /></View> : null}
        <SheetHeader title={fileSheet?.name || ''} subtitle={`${fileSheet ? formatSize(fileSheet.size) : ''}${fileBusy ? ' · preparando…' : ''}`} onClose={() => { setFileSheet(null); setFileNote(''); }} />
        {(desktop ? [['open', 'Abrir', 'No programa padrão do computador (fica salvo em Downloads).', 'open'], ['save', 'Salvar em Downloads', 'Na pasta Downloads do computador.', 'download']]
          : [['open', 'Abrir', 'Num app do celular que abra este tipo de arquivo.', 'open'], ['share', 'Compartilhar', 'WhatsApp, Drive, e-mail ou outro app.', 'share'], ['save', 'Salvar em Downloads', 'Fica na pasta Download/MyBots.', 'download']]).map(([action, title, detail, icon]) =>
          <Pressable key={action} accessibilityRole="button" disabled={Boolean(fileBusy)} onPress={() => fileAct(fileSheet, action)} style={({ pressed }) => [styles.modeOption, styles.rowOption, fileBusy && { opacity: 0.5 }, pressed && styles.pressed]}>
            <View style={styles.rowIcon}><Icon name={icon} size={19} color={C.accent} /></View>
            <View style={{ flex: 1 }}><Text style={styles.optionLabel}>{title}</Text><Text style={styles.optionDetail}>{detail}</Text></View>
            {fileBusy === fileSheet?.id ? <ActivityIndicator color={C.accent} /> : <Icon name="right" size={16} color={C.faint} />}
          </Pressable>)}
        {fileNote ? <View style={styles.fileNote}><Icon name={/Salvo/.test(fileNote) ? 'check' : 'info'} size={16} color={/Salvo/.test(fileNote) ? C.accent : C.amber} /><Text selectable style={styles.fileNoteText}>{fileNote}</Text></View> : null}
      </View></View>
    </Modal>
    {data && !share?.botId ? <ShareSheet share={share} bots={data.bots || []} phone={mode === 'phone'} onPick={pickShare} onClose={() => setShare(null)} /> : null}
    <ModeSheet visible={modeVisible} mode={mode} onClose={() => setModeVisible(false)} onSelect={changeMode} />
    <TermuxLogModal visible={logsVisible} log={termuxLog} copied={logsCopied} onClose={() => setLogsVisible(false)} onCopy={copyLogs} />
  </View>;
}
