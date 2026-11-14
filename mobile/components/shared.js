import { useStore } from '../state/useStore';
import { selectHome, selectBots, selectShareTargets } from '../state/store';
import { C, F, Icon, HUES, hueOf } from '../theme';
import { stillOf } from '../../lib/mimo.mjs';
import BotAvatar from '../BotAvatar';
import { PermissionsAndroid, Pressable, Text, Animated, Easing, View, ActivityIndicator, Modal, ScrollView, useWindowDimensions, TextInput, AppState, Linking, Alert, StyleSheet, Image } from 'react-native';
import { styles } from '../styles';
import { useRef, useState, useEffect, useCallback } from 'react';
import { formatSize, RichText, FileChip } from '../RichMessage';
import { embeddedEnabled, copyText, publishShareTargets, nativeAvailable, notificationAccess, openNotificationAccess, botNotificationStatus, notificationPermission, openNotificationSettings, openAppSettings, passwordsList, passwordSave, passwordDelete, passwordImport, passwordImportDelete, walletCards, walletCardBots, cardEditor, cardDelete, walletRules, walletFreeze, walletRulesEditor, walletPurchases, walletDismiss, widgetStatus, requestWidget, keepAliveStatus, openPowerSettings, setKeepAlive, phoneAccess, openAccessibility, onSpeech, stopListening, microphonePermission, startListening } from '../native';
import { SvgXml, Svg, Defs, LinearGradient, Stop, Rect as SvgRect, Circle as SvgCircle, Text as SvgText } from 'react-native-svg';
import { useCameraPermissions, CameraView } from 'expo-camera';
import { desktop, pwa } from '../desktop';
import { accountChoices, DEFAULT_ACCOUNT } from '../ai-accounts';


export const COLORS = HUES;

export const COLOR_NAMES = { green: 'Verde', blue: 'Azul', purple: 'Lilás', orange: 'Laranja' };

export const EFFORT_NAMES = { none: 'Sem raciocínio', minimal: 'Mínimo', low: 'Baixo', medium: 'Médio', high: 'Alto', xhigh: 'Muito alto', max: 'Máximo', ultra: 'Ultra' };

export const RUN_COMMANDS = { pair: 'iniciar o MyBots deste celular', merge: 'juntar as conversas salvas no celular', open: 'abrir o MyBots' };

export const nativeMessage = error => String(error?.message || error).split(/Exception: /).pop().trim();

export function safeLog(value) {
  return String(value || '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redigido]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|sess-[A-Za-z0-9_-]{16,}|codex_[A-Za-z0-9_-]{16,})\b/g, '[token redigido]')
    .replace(/(OPENAI_API_KEY|CODEX_ACCESS_TOKEN|access_token|refresh_token|client_secret)(\s*[:=]\s*)([^\s,;"']+)/gi, '$1$2[redigido]')
    .replace(/((?:access_token|refresh_token|client_secret|api_key)"?\s*:\s*")[^"]+("?)/gi, '$1[redigido]$2')
    .slice(-12000);
}

export function formatRunLog(log) {
  const lines = [
    'MyBots · diagnóstico do celular',
    `Operação: ${log.operation || 'desconhecida'}`,
    `Comando: ${RUN_COMMANDS[log.operation] || log.operation || 'desconhecido'}`,
    `Horário: ${log.startedAt ? new Date(log.startedAt).toLocaleString('pt-BR') : 'indisponível'}`
  ];
  if (log.exitCode !== undefined) lines.push(`Código de saída: ${log.exitCode}`);
  if (log.errorCode !== undefined) lines.push(`Código: ${log.errorCode}`);
  if (log.nativeCode) lines.push(`Código nativo: ${log.nativeCode}`);
  if (log.errorMessage) lines.push(`Mensagem: ${safeLog(log.errorMessage)}`);
  if (log.nativeMessage) lines.push(`Mensagem do MyBots: ${safeLog(log.nativeMessage)}`);
  if (log.stdout?.trim()) lines.push('', 'Saída:', safeLog(log.stdout));
  if (log.stderr?.trim()) lines.push('', 'Erro:', safeLog(log.stderr));
  if (!log.stdout?.trim() && !log.stderr?.trim() && !log.errorMessage && !log.nativeMessage) lines.push('', 'O comando não retornou saída de texto.');
  return lines.join('\n');
}

export const Avatar = BotAvatar;

export const seenText = (presence, short = false) => {
  if (!presence?.lastSeen) return short ? 'computador desligado' : 'esperando o computador';
  const seen = new Date(presence.lastSeen); const today = new Date(); const yesterday = new Date(Date.now() - 86400000);
  const hour = seen.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const day = seen.toDateString() === today.toDateString() ? 'hoje' : seen.toDateString() === yesterday.toDateString() ? 'ontem' : seen.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return `${short ? 'visto' : 'visto por último'} ${day} às ${hour}`;
};

export const offline = (data, botId) => data?.presence?.[botId]?.online === false;

export const HUE_OF = hueOf;

export function PrimaryButton({ title, onPress, disabled, compact = false, style, icon, tone = 'mint' }) {
  const ghost = tone === 'ghost';
  return <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled}
    style={({ pressed }) => [styles.primaryButton, compact && styles.compactButton, ghost && styles.ghostButton, disabled && styles.buttonDisabled, pressed && !disabled && styles.pressed, style]}>
    {icon ? <Icon name={icon} size={compact ? 17 : 19} color={ghost ? C.text : C.accentInk} stroke={2.2} /> : null}
    <Text style={[styles.primaryButtonText, compact && styles.compactButtonText, ghost && styles.ghostButtonText]}>{title}</Text>
  </Pressable>;
}

export function useStickyScroll() {
  const scroll = useRef(null); const [away, setAway] = useState(false);
  const onScroll = useCallback(event => { const next = event.nativeEvent.contentOffset.y > 120; setAway(old => old === next ? old : next); }, []);
  const toEnd = useCallback(() => { setAway(false); scroll.current?.scrollToOffset({ offset: 0, animated: true }); }, []);
  return { scroll, toEnd, away, props: { onScroll, scrollEventThrottle: 100 } };
}

export function ToEndButton({ onPress }) {
  return <Pressable accessibilityRole="button" accessibilityLabel="Ir para as mensagens mais novas" onPress={onPress} style={({ pressed }) => [styles.toEnd, pressed && styles.pressed]}><Icon name="down" size={20} color={C.accent} stroke={2.2} /></Pressable>;
}

export function IconButton({ icon, label, onPress, active, disabled, tint = C.text2, size = 42 }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} disabled={disabled} hitSlop={6}
    style={({ pressed }) => [styles.iconButton, { width: size, height: size, borderRadius: size * 0.36 }, active && styles.iconButtonActive, pressed && styles.pressed, disabled && styles.buttonDisabled]}>
    <Icon name={icon} size={size * 0.5} color={active ? C.accent : tint} />
  </Pressable>;
}

export function Dots({ color = C.accent }) {
  const values = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.stagger(160, values.map(value => Animated.sequence([
      Animated.timing(value, { toValue: 1, duration: 280, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(value, { toValue: 0, duration: 280, easing: Easing.in(Easing.quad), useNativeDriver: true }), Animated.delay(200)]))));
    loop.start(); return () => loop.stop();
  }, []);
  return <View style={styles.dots}>{values.map((value, index) => <Animated.View key={index} style={[styles.dot, { backgroundColor: color, opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }), transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) }] }]} />)}</View>;
}

/** Nothing to show yet: what this place is for and, when there is one, the next step to take. */
export function EmptyState({ icon = 'spark', title, text, action, onAction, children }) {
  return <View style={{ alignItems: 'center', paddingVertical: desktop ? 56 : 30, paddingHorizontal: 20, gap: 6 }}>
    <View style={{ width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface, borderWidth: 1, borderColor: C.line2, marginBottom: 8 }}><Icon name={icon} size={24} color={C.accent} /></View>
    <Text style={{ color: C.text, fontFamily: F.b, fontSize: 16.5, letterSpacing: -0.2, textAlign: 'center' }}>{title}</Text>
    {text ? <Text style={{ color: C.muted, fontFamily: F.m, fontSize: 14, lineHeight: 21, textAlign: 'center', maxWidth: 440 }}>{text}</Text> : null}
    {children}
    {action ? <Pressable accessibilityRole="button" onPress={onAction} style={({ pressed, hovered }) => [{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingHorizontal: 18, borderRadius: 12, backgroundColor: C.accent, marginTop: 12 }, hovered && { opacity: 0.9 }, pressed && { opacity: 0.7 }]}>
      <Text style={{ color: C.accentInk, fontFamily: F.b, fontSize: 14 }}>{action}</Text></Pressable> : null}
  </View>;
}

export function SheetHeader({ title, subtitle, onClose, icon }) {
  return <View style={styles.sheetHeader}>
    {icon ? <View style={styles.sheetIcon}><Icon name={icon} size={20} color={C.accent} /></View> : null}
    <View style={{ flex: 1 }}><Text style={styles.sheetTitle} numberOfLines={2}>{title}</Text>{subtitle ? <Text style={styles.sheetSubtitle} numberOfLines={3}>{subtitle}</Text> : null}</View>
    {onClose ? <IconButton icon="close" label="Fechar" onPress={onClose} size={38} /> : null}
  </View>;
}

export function Notice({ text, onRetry, onLogs, loading = false }) {
  if (!text) return null;
  return <View style={styles.notice}>
    <View style={styles.noticeIcon}><Icon name="alert" size={18} color={C.amber} /></View>
    <View style={styles.noticeCopy}><Text style={styles.noticeTitle}>{loading ? 'Conectando…' : 'Atenção'}</Text><Text style={styles.noticeText}>{text}</Text></View>
    <View style={styles.noticeActions}>
      {onLogs && !loading && <Pressable accessibilityRole="button" accessibilityLabel="Ver detalhes do erro" onPress={onLogs} style={styles.noticeRetry}>
        <Text style={styles.noticeLogsText}>Logs</Text>
      </Pressable>}
      {onRetry && <Pressable accessibilityRole="button" accessibilityLabel="Tentar conectar novamente" onPress={onRetry} style={styles.noticeRetry}>
        {loading ? <ActivityIndicator color={C.amber} /> : <Text style={styles.noticeRetryText}>Tentar</Text>}
      </Pressable>}
    </View>
  </View>;
}

export function RunLogModal({ visible, log, copied, onClose, onCopy }) {
  if (!log) return null;
  return <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
    <Pressable style={styles.sheetBackdrop} onPress={onClose}>
      <Pressable style={styles.logsSheet} onPress={event => event.stopPropagation()}>
        <View style={styles.sheetHandle} />
        <View style={styles.logsHeading}>
          <View style={styles.logsHeadingCopy}><Text style={styles.sheetTitle}>Detalhes do erro</Text><Text style={styles.logsHint}>Copie este diagnóstico e cole aqui na conversa.</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Fechar logs" onPress={onClose} style={styles.modalClose}><Text style={styles.modalCloseText}>×</Text></Pressable>
        </View>
        <ScrollView style={styles.logsScroll} contentContainerStyle={styles.logsContent}>
          <Text selectable style={styles.logsText}>{formatRunLog(log)}</Text>
        </ScrollView>
        <Text style={styles.logsPrivacy}>Chaves e tokens reconhecidos são ocultados. Confira o texto antes de enviar.</Text>
        <PrimaryButton title={copied ? 'Logs copiados ✓' : 'Copiar logs'} onPress={onCopy} />
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeSheet}><Text style={styles.closeSheetText}>Fechar</Text></Pressable>
      </Pressable>
    </Pressable>
  </Modal>;
}

export function ChoiceSheet({ visible, title, options, value, onClose, onSelect }) {
  return <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
    <Pressable style={styles.sheetBackdrop} onPress={onClose}>
      <Pressable style={styles.sheet} onPress={event => event.stopPropagation()}>
        <View style={styles.sheetHandle} />
        <Text style={styles.sheetTitle}>{title}</Text>
        <ScrollView keyboardShouldPersistTaps="handled" style={styles.sheetOptions}>
          {options.map((option, index) => {
            const chosen = option.value === value;
            return <Pressable key={`${option.value ?? 'default'}-${index}`} accessibilityRole="button"
              accessibilityState={{ selected: chosen }} onPress={() => { onSelect(option.value); onClose(); }}
              style={[styles.option, chosen && styles.optionChosen]}>
              <View style={styles.optionCopy}><Text style={[styles.optionLabel, chosen && styles.optionLabelChosen]}>{option.label}</Text>
                {option.detail ? <Text style={styles.optionDetail}>{option.detail}</Text> : null}</View>
              {chosen && <Text style={styles.optionCheck}>✓</Text>}
            </Pressable>;
          })}
        </ScrollView>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeSheet}><Text style={styles.closeSheetText}>Voltar</Text></Pressable>
      </Pressable>
    </Pressable>
  </Modal>;
}

export function ChoiceField({ label, value, disabled, onPress }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value || 'indisponível'}`}
    accessibilityState={{ disabled }} onPress={onPress} disabled={disabled} style={[styles.choiceField, disabled && styles.choiceDisabled]}>
    <Text style={styles.choiceLabel}>{label}</Text><Text style={styles.choiceValue} numberOfLines={1}>{value || 'Carregando opções…'}</Text>
    <Text style={styles.choiceChevron}>⌄</Text>
  </Pressable>;
}

export const PROVIDER_NAMES = { codex: 'Codex', claude: 'Claude', agy: 'Antigravity', opencode: 'opencode' };

export const providerOf = item => item?.provider || 'codex';

export function findModel(models, selection) { return models.find(item => item.model === selection?.model && providerOf(item) === providerOf(selection)) || models.find(item => item.model === selection?.model); }

export function ModelSettings({ models, selection, disabled, onChange, connections, aiAccounts, home, account }) {
  const [sheet, setSheet] = useState('');
  const model = findModel(models, selection);
  const providers = [...new Set(models.map(providerOf))];
  // Before a choice is made, the IA of the first model on offer (a computer with only Claude has no Codex models to start from).
  const provider = providerOf(model || (selection?.provider || selection?.model ? selection : models.find(item => item.isDefault) || models[0] || selection));
  const available = models.filter(item => providerOf(item) === provider);
  const modelOptions = available.map(item => ({ value: item.model, label: item.displayName, detail: item.modelId ? `${item.modelId} · sempre a versão mais nova` : item.model }));
  const providerOptions = providers.map(value => ({ value, label: PROVIDER_NAMES[value] || value, detail: connections?.[value]?.message || (value === 'claude' ? 'Claude Code' : value === 'agy' ? 'Antigravity (agy)' : value === 'opencode' ? 'opencode' : 'Codex') }));
  // Another IA starts on its own default account: accounts belong to one IA.
  const pickProvider = next => { const first = models.find(item => providerOf(item) === next && item.isDefault) || models.find(item => providerOf(item) === next); if (first) onChange(first.model, first.defaultEffort ?? null, next, DEFAULT_ACCOUNT); };
  const accountList = accountChoices(aiAccounts, provider, home);
  const accountOptions = accountList.map(item => ({ value: item.id, label: item.label, detail: item.loggedIn ? 'Conectada' : 'Ainda sem login nesse aparelho: entre pela tela Contas de IA' }));
  const accountName = accountList.find(item => item.id === (account || DEFAULT_ACCOUNT))?.label || 'Conta principal';
  const effortOptions = model ? (model.efforts.length
    ? model.efforts.map(value => ({ value, label: EFFORT_NAMES[value] || value }))
    : [{ value: null, label: 'Padrão do modelo' }]) : [];
  const effortName = selection?.reasoningEffort ? EFFORT_NAMES[selection.reasoningEffort] || selection.reasoningEffort : 'Padrão do modelo';
  return <View>
    {providers.length > 1 && <View style={styles.settingsRow}><ChoiceField label="IA" value={PROVIDER_NAMES[provider]} disabled={disabled} onPress={() => setSheet('provider')} /></View>}
    {accountList.length > 1 && <View style={styles.settingsRow}><ChoiceField label="Conta" value={accountName} disabled={disabled} onPress={() => setSheet('account')} /></View>}
    <View style={styles.settingsRow}>
      <ChoiceField label="Modelo" value={model?.displayName} disabled={disabled || !models.length} onPress={() => setSheet('model')} />
      <ChoiceField label="Raciocínio" value={model ? effortName : null} disabled={disabled || !model} onPress={() => setSheet('effort')} />
    </View>
    <Text style={styles.settingsHint}>{disabled ? 'Aguarde esta resposta terminar.' : connections?.[provider] && !connections[provider].loggedIn ? connections[provider].message : model ? 'Acesso confirmado ao gerar uma resposta.' : 'Carregando o catálogo de modelos…'}</Text>
    <ChoiceSheet visible={sheet === 'provider'} title="Escolha a IA" options={providerOptions} value={provider}
      onClose={() => setSheet('')} onSelect={next => { if (next !== provider) pickProvider(next); }} />
    <ChoiceSheet visible={sheet === 'account'} title={`Conta do ${PROVIDER_NAMES[provider] || 'IA'}`} options={accountOptions} value={account || DEFAULT_ACCOUNT}
      onClose={() => setSheet('')} onSelect={next => { if (next !== (account || DEFAULT_ACCOUNT)) onChange(selection?.model, selection?.reasoningEffort, provider, next); }} />
    <ChoiceSheet visible={sheet === 'model'} title="Escolha um modelo" options={modelOptions} value={selection?.model}
      onClose={() => setSheet('')} onSelect={next => { const chosen = available.find(item => item.model === next); onChange(next, chosen?.defaultEffort ?? null, provider); }} />
    <ChoiceSheet visible={sheet === 'effort'} title="Nível de raciocínio" options={effortOptions} value={selection?.reasoningEffort ?? null}
      onClose={() => setSheet('')} onSelect={effort => onChange(selection?.model, effort, provider)} />
  </View>;
}

/** "Se o limite acabar": the other IA's model that answers when the subscription's limit ends. It keeps the bot's level and permissions. */
export function FallbackSettings({ models, bot, disabled, onChange }) {
  const [sheet, setSheet] = useState(false);
  const own = providerOf(bot);
  const options = [{ value: '', label: 'Nenhum', detail: 'Quando o limite acabar, o bot avisa e espera.' }, ...models.filter(item => providerOf(item) !== own)
    .map(item => ({ value: `${providerOf(item)}|${item.model}`, label: `${PROVIDER_NAMES[providerOf(item)] || providerOf(item)} · ${item.displayName}`, detail: 'Responde no lugar quando o limite da assinatura acabar, com a conversa e o mesmo nível de acesso.' }))];
  const current = bot.fallback ? `${bot.fallback.provider}|${bot.fallback.model}` : '';
  const label = options.find(item => item.value === current)?.label || 'Nenhum';
  return <View>
    <View style={styles.settingsRow}><ChoiceField label="Se o limite acabar" value={label} disabled={disabled || options.length < 2} onPress={() => setSheet(true)} /></View>
    <Text style={styles.settingsHint}>{options.length < 2 ? 'Conecte a outra IA para ter um modelo reserva.' : 'O modelo reserva nunca ganha mais acesso do que o bot já tem.'}</Text>
    <ChoiceSheet visible={sheet} title="Se o limite acabar, usar" options={options} value={current} onClose={() => setSheet(false)}
      onSelect={value => { if (!value) return onChange(null); const [provider, model] = value.split('|'); const chosen = models.find(item => providerOf(item) === provider && item.model === model); onChange({ provider, model, reasoningEffort: chosen?.defaultEffort ?? null }); }} />
  </View>;
}

export function ApprovalCard({ approval, bot, onRespond, busy }) {
  const titles = { 'memory.write': 'Guardar uma lembrança', 'task.create_item': 'Criar uma pendência', 'notify.user': 'Enviar uma notificação', 'sms.send': 'Enviar um SMS' };
  const negotiation = approval.kind === 'negotiation';
  const summary = approval.summary ?? Object.values(approval.args).filter(value => typeof value === 'string' && value).join('\n');
  return <View style={styles.approvalCard}>
    <View style={styles.approvalHeading}><Avatar bot={bot || { name: 'Bot', color: 'orange' }} size={44} state="waiting" />
      <View style={{ flex: 1 }}><Text style={styles.approvalEyebrow}>{negotiation ? 'Proposta esperando você' : 'Precisa de você'}</Text><Text style={styles.approvalTitle}>{bot?.name || 'Seu bot'} quer {(approval.title || titles[approval.tool] || 'executar uma ação').replace(/^./, letter => letter.toLocaleLowerCase())}.</Text></View></View>
    {summary ? <Text selectable style={styles.approvalBody}>{summary}</Text> : null}
    <View style={styles.approvalHintRow}><Icon name="clock" size={14} color={C.faint} /><Text style={styles.approvalHint}>{negotiation ? 'Prazo do mandato: ' + new Date(approval.expiresAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + '.' : `${approval.canAlways ? 'Uma vez vale só agora. ' : ''}Expira às ${new Date(approval.expiresAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.`}</Text></View>
    <View style={styles.approvalActions}>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => onRespond(approval, false)} style={({ pressed }) => [styles.denyButton, pressed && styles.pressed]}><Text style={styles.denyText}>Recusar</Text></Pressable>
      <PrimaryButton compact icon="check" title={busy ? 'Aguarde…' : negotiation ? 'Aceitar' : 'Aprovar'} disabled={busy} onPress={() => onRespond(approval, true)} style={{ flex: 1.4 }} />
    </View>
    {approval.canAlways ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => onRespond(approval, true, true)} style={styles.alwaysButton}><Icon name="shield" size={15} color={C.amber} /><Text style={styles.alwaysText}>Sempre permitir</Text></Pressable> : null}
  </View>;
}

export const latestOf = item => item.lastMessage !== undefined ? item.lastMessage : item.messages?.at(-1);

export const latestInRoom = room => room.lastMessage !== undefined ? room.lastMessage : [...(room.messages || [])].reverse().find(item => item.role !== 'system');

export const plain = text => (text || '').replace(/```[\s\S]*?```/g, ' ').replace(/[*`#>]+/g, '').replace(/\s+/g, ' ').trim();

export function BotCard({ bot, busy, waiting, presence, routines = 0, items = 0, onPress, onProfile }) {
  const asleep = presence?.online === false;
  const latest = latestOf(bot);
  const preview = latest?.origin === 'routine' ? `Rotina · ${latest.routineTitle}` : latest?.attachments?.length && latest.text === 'Veja o anexo.' ? latest.attachments[0].name : plain(latest?.text);
  const updated = new Date(bot.updatedAt);
  const time = Date.now() - updated < 86400000 ? updated.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : updated.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const hue = HUE_OF(bot);
  return <Pressable accessibilityRole="button" accessibilityLabel={`Conversar com ${bot.name}`} onPress={onPress}
    style={({ pressed }) => [styles.botCard, busy && !asleep && { borderColor: hue + '70', shadowColor: hue, shadowOpacity: 0.5, shadowRadius: 14, elevation: 6 }, waiting && styles.botCardWaiting, pressed && styles.pressed]}>
    <View><Avatar bot={bot} size={58} state={waiting ? 'waiting' : asleep ? 'sleeping' : busy ? 'working' : 'idle'} />
      {bot.home === 'pc' || bot.home === 'any' ? <View style={[styles.presenceDot, !asleep && styles.presenceOn]} /> : null}</View>
    <View style={styles.botCardCopy}>
      <View style={styles.botNameRow}><Text style={styles.botCardName} numberOfLines={1}>{bot.name}</Text><Text style={styles.botTime}>{time}</Text>{bot.unread ? <Text style={styles.unread}>{bot.unread > 99 ? '99+' : bot.unread}</Text> : null}</View>
      {asleep && !waiting ? <Text style={styles.botPreview} numberOfLines={1}>{busy ? 'Esperando o computador' : `Dormindo · ${seenText(presence)}`}</Text>
        : busy && !waiting ? <View style={styles.botWorking}><Text style={[styles.botPreview, { color: hue }]}>Trabalhando</Text><Dots color={hue} /></View>
        : <Text style={[styles.botPreview, waiting && { color: C.amber }]} numberOfLines={1}>{waiting ? 'Esperando sua decisão' : preview || 'Pronto para começar'}</Text>}
      {routines || items ? <View style={styles.botStatusRow}>
        {routines ? <View style={styles.botChip}><Icon name="bolt" size={12} color={C.muted} /><Text style={styles.botChipText}>{routines} {routines > 1 ? 'rotinas' : 'rotina'}</Text></View> : null}
        {items ? <View style={styles.botChip}><Icon name="list" size={12} color={C.muted} /><Text style={styles.botChipText}>{items} {items > 1 ? 'pendências' : 'pendência'}</Text></View> : null}
      </View> : null}
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={`Editar ${bot.name}`} hitSlop={8} onPress={event => { event.stopPropagation(); onProfile(); }} style={styles.cardMore}><Icon name="more" size={20} color={C.faint} /></Pressable>
  </Pressable>;
}

export function greeting() { const hour = new Date().getHours(); return hour < 5 ? 'Boa noite' : hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite'; }

export const UPDATE_STEPS = { downloading: 'Baixando', installing: 'Conferindo e instalando…', confirm: 'Confirme a instalação na janela do Android.', permission: 'Permita "Instalar apps desconhecidos" para o MyBots e toque em Atualizar de novo.' };

export function UpdateCard({ update, onInstall, onDismiss, compact = false }) {
  const [notes, setNotes] = useState(false);
  const info = update?.info; const step = update?.step; const busy = ['downloading', 'installing', 'confirm'].includes(step?.state);
  if (!info?.available) return null;
  const body = (info.notes || '').replace(/\r/g, '').trim();
  return <View style={styles.updateCard}>
    <View style={styles.updateHead}>
      <View style={styles.updateIcon}><Icon name="download" size={18} color={C.accent} /></View>
      <View style={{ flex: 1 }}><Text style={styles.optionLabel}>{info.latestName || 'Nova versão'} disponível</Text>
        <Text style={styles.optionDetail}>Você está na {info.currentName}{info.size ? ` · ${formatSize(info.size)}` : ''}. Conversas e bots continuam.</Text></View>
      {!compact && !busy ? <Pressable accessibilityRole="button" accessibilityLabel="Lembrar depois" hitSlop={10} onPress={onDismiss}><Icon name="close" size={16} color={C.faint} /></Pressable> : null}
    </View>
    {body ? <Pressable accessibilityRole="button" onPress={() => setNotes(value => !value)} style={styles.updateNotesToggle}><Text style={styles.updateNotesLink}>{notes ? 'Esconder novidades' : 'Ver novidades'}</Text><Icon name={notes ? 'back' : 'down'} size={13} color={C.accent} /></Pressable> : null}
    {notes ? <View style={styles.updateNotes}><RichText text={body} textStyle={styles.updateNotesText} /></View> : null}
    {step?.state === 'downloading' ? <View style={styles.updateBar}><View style={[styles.updateFill, { width: `${Math.max(3, step.percent || 0)}%` }]} /></View> : null}
    {step ? <Text style={[styles.optionDetail, step.state === 'error' && { color: C.red }]}>{step.state === 'error' ? step.message : step.state === 'downloading' ? `${UPDATE_STEPS.downloading} · ${step.percent >= 0 ? step.percent + '%' : formatSize(step.done || 0)}` : UPDATE_STEPS[step.state] || ''}</Text> : null}
    <PrimaryButton compact icon={busy ? undefined : 'download'} title={busy ? 'Atualizando…' : step?.state === 'error' ? 'Tentar de novo' : 'Atualizar agora'} disabled={busy} onPress={onInstall} style={{ marginTop: 10 }} />
  </View>;
}

export const shortTime = value => { const date = new Date(value); return Date.now() - date < 86400000 ? date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); };

export function botLine(bot, data) {
  const waiting = data.approvals?.some(item => item.botId === bot.id); const asleep = offline(data, bot.id); const busy = data.active?.includes(bot.id);
  const latest = latestOf(bot);
  if (waiting) return { text: 'Esperando sua decisão', tone: C.amber, state: 'waiting' };
  if (asleep) return { text: busy ? 'Esperando o computador' : `Dormindo · ${seenText(data.presence?.[bot.id])}`, tone: C.faint, state: 'sleeping' };
  if (busy) return { text: 'Trabalhando…', tone: HUE_OF(bot), state: 'working' };
  return { text: latest?.origin === 'routine' ? `Rotina · ${latest.routineTitle}` : latest?.role === 'user' ? `Você: ${plain(latest.text)}` : plain(latest?.text) || 'Pronto para começar', tone: C.muted, state: 'idle' };
}

export function PhoneAccess({ stats, lastPoll }) {
  const [granted, setGranted] = useState(null);
  const check = useCallback(() => { notificationAccess().then(setGranted).catch(() => setGranted(false)); }, []);
  useEffect(() => {
    check();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') check(); });
    return () => subscription.remove();
  }, [check]);
  return <View style={styles.modeOption}>
    <Text style={styles.optionLabel}>Notificações do celular · {granted ? 'Ligado' : granted === false ? 'Desligado' : '…'}</Text>
    <Text style={styles.optionDetail}>{granted
      ? `Toda notificação (Gmail, bancos, apps) vira um evento para os bots. ${stats?.last24h ?? 0} nas últimas 24 h${stats?.lastAt ? `, a última às ${new Date(stats.lastAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}.`
      : 'Ligue para os bots perceberem e-mails, avisos e mensagens assim que chegam. O Android libera todas as notificações; cada bot só lê se você permitir no perfil dele.'}</Text>
    {!granted ? <Pressable onPress={() => openNotificationAccess().catch(() => {})} style={{ marginTop: 8 }}><Text style={styles.deleteText}>Ativar acesso a notificações</Text></Pressable> : null}
    <BotNoticeStatus lastPoll={lastPoll} />
    <PhonePermissions />
    <PhoneControlAccess />
  </View>;
}

/**
 * Controle do celular (nível Livre): Android's accessibility service for MyBots. On Android 13+, an app installed outside
 * a store needs "Permitir configurações restritas" in its info before the service can be turned on.
 */
export function PhoneControlAccess() {
  const [status, setStatus] = useState(null);
  const check = useCallback(() => { phoneAccess().then(setStatus).catch(() => setStatus(null)); }, []);
  useEffect(() => { check(); const subscription = AppState.addEventListener('change', state => { if (state === 'active') check(); }); return () => subscription.remove(); }, [check]);
  if (!status) return null;
  const on = status.enabled && status.connected;
  return <View style={styles.appRow}>
    <Text style={styles.optionLabel}>Controle do celular · {on ? 'Ligado' : status.enabled ? 'Ligado, esperando o Android' : 'Desligado'}</Text>
    <Text style={styles.optionDetail}>{on ? 'Bots com o controle do celular ligado podem ver a tela e usar os outros apps quando você pede. Enquanto isso, uma barra com Parar fica no topo da tela e uma notificação fixa aparece. Apps de banco costumam recusar: nesses, o bot chama você.'
      : status.enabled ? 'O serviço está ligado, mas o Android ainda não o iniciou. Desligue e ligue de novo em Acessibilidade.'
      : 'Ative o controle no perfil do bot. Para ligar: toque em Ligar o controle, procure MyBots (em Apps instalados ou Serviços baixados) e ative.'}</Text>
    {!status.enabled && status.sdk >= 33 ? <Text style={[styles.optionDetail, { marginTop: 6 }]}>No Android 13 ou mais novo, se aparecer “Configuração restrita”: volte aqui, toque em Abrir informações do app, toque nos três pontos (⋮) no canto de cima, escolha “Permitir configurações restritas”, confirme e tente ligar de novo.{status.restricted ? ' Neste celular esse bloqueio ainda está ativo.' : ''}</Text> : null}
    {!status.screenshots ? <Text style={[styles.optionDetail, { marginTop: 6 }]}>Neste Android (antes do 11) o bot lê a tela, mas não consegue ver capturas dela.</Text> : null}
    <View style={styles.appActions}>
      {!on ? <Pressable onPress={() => openAccessibility().catch(() => {})}><Text style={styles.deleteText}>Ligar o controle</Text></Pressable> : <Pressable onPress={() => openAccessibility().catch(() => {})}><Text style={styles.deleteText}>Desligar em Acessibilidade</Text></Pressable>}
      {!status.enabled && status.sdk >= 33 ? <Pressable onPress={() => openAppSettings('com.mybots.app').catch(() => {})}><Text style={styles.deleteText}>Abrir informações do app</Text></Pressable> : null}
    </View>
  </View>;
}

export function BotNoticeStatus({ lastPoll }) {
  const [status, setStatus] = useState(null);
  const check = useCallback(() => { botNotificationStatus().then(setStatus).catch(() => setStatus(null)); }, []);
  useEffect(() => { check(); const subscription = AppState.addEventListener('change', state => { if (state === 'active') check(); }); return () => subscription.remove(); }, [check]);
  if (!status) return null;
  const allowed = status.enabled && !status.channelBlocked;
  const recent = lastPoll && Date.now() - Date.parse(lastPoll) < 90000;
  return <View style={styles.appRow}>
    <Text style={styles.optionLabel}>Notificações dos bots · {allowed ? (recent ? 'Pelo MyBots' : 'Pelo MyBots com o app aberto') : 'Bloqueadas'}</Text>
    <Text style={styles.optionDetail}>{!allowed ? 'O Android está bloqueando as notificações do MyBots. Libere em Notificações do MyBots.'
      : recent ? 'Chegam como MyBots, aparecem na tela e abrem a conversa do bot ao tocar.'
      : 'Com o app fechado, o HyperOS pode parar o MyBots e os avisos não chegam. Para evitar: Configurações → Apps → MyBots → Economia de bateria: Sem restrições, e ligue o Início automático.'}</Text>
    <View style={styles.appActions}>
      {!allowed ? <Pressable onPress={() => notificationPermission().then(check).then(() => openNotificationSettings()).catch(() => {})}><Text style={styles.deleteText}>Liberar notificações do MyBots</Text></Pressable> : null}
      {allowed && !recent ? <Pressable onPress={() => openAppSettings('com.mybots.app').catch(() => {})}><Text style={styles.deleteText}>Abrir configurações do MyBots</Text></Pressable> : null}
    </View>
  </View>;
}

const PHONE_PERMISSIONS = [
  ['SMS', 'Ler e enviar SMS, quando o bot tiver essa permissão no perfil.', ['READ_SMS', 'SEND_SMS']],
  ['Contatos', 'Procurar um nome ou número.', ['READ_CONTACTS']],
  ['Chamadas', 'Ver o histórico de ligações.', ['READ_CALL_LOG']],
  ['Localização', 'Saber onde o celular está.', ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION']],
].map(([title, detail, names]) => ({ title, detail, names: names.map(name => `android.permission.${name}`) }));
const BACKGROUND_LOCATION = 'android.permission.ACCESS_BACKGROUND_LOCATION';

/** With everything inside the app, these are MyBots' own Android permissions: nothing is asked behind the person's back when a bot needs one. */
function PhonePermissions() {
  const [granted, setGranted] = useState({});
  const check = useCallback(async () => {
    const next = {};
    for (const name of [...PHONE_PERMISSIONS.flatMap(item => item.names), BACKGROUND_LOCATION]) next[name] = await PermissionsAndroid.check(name).catch(() => false);
    setGranted(next);
  }, []);
  useEffect(() => { check(); const subscription = AppState.addEventListener('change', state => { if (state === 'active') check(); }); return () => subscription.remove(); }, [check]);
  const ask = async names => {
    const answers = await PermissionsAndroid.requestMultiple(names).catch(() => ({}));
    if (Object.values(answers).includes(PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN)) openAppSettings('com.mybots.app').catch(() => {});
    check();
  };
  const located = granted['android.permission.ACCESS_FINE_LOCATION'];
  return <View style={styles.appRow}>
    <Text style={styles.optionLabel}>Permissões do celular</Text>
    <Text style={styles.optionDetail}>Quem acessa isso é o próprio MyBots. Cada bot continua só podendo usar o que você liberar no perfil dele. Se o Android avisar “Configuração restrita”, abra as informações do app, toque nos três pontos e escolha “Permitir configurações restritas”.</Text>
    {PHONE_PERMISSIONS.map(item => { const ok = item.names.every(name => granted[name]); return <View key={item.title} style={{ marginTop: 10 }}>
      <Text style={styles.optionLabel}>{item.title} · {ok ? 'Permitido' : 'Não permitido'}</Text><Text style={styles.optionDetail}>{item.detail}</Text>
      {ok ? null : <Pressable accessibilityRole="button" accessibilityLabel={`Permitir ${item.title}`} onPress={() => ask(item.names)} style={{ marginTop: 4 }}><Text style={styles.deleteText}>Permitir</Text></Pressable>}
    </View>; })}
    {located && !granted[BACKGROUND_LOCATION] ? <View style={{ marginTop: 10 }}><Text style={styles.optionDetail}>Para um bot ver a localização com o app fechado, escolha “Permitir o tempo todo”.</Text>
      <Pressable accessibilityRole="button" onPress={() => ask([BACKGROUND_LOCATION])} style={{ marginTop: 4 }}><Text style={styles.deleteText}>Permitir o tempo todo</Text></Pressable></View> : null}
  </View>;
}


export function DesktopNetwork({ call, notice = false }) {
  const [status, setStatus] = useState(null); const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let mounted = true;
    const check = async () => { try { const next = await call('desktop.status'); if (mounted) { setStatus(next); setNow(Date.now()); } } catch {} };
    check(); const timer = setInterval(check, 10000);
    return () => { mounted = false; clearInterval(timer); };
  }, []);
  if (!status) return null;
  if (!notice) return <><DesktopSource call={call} status={status} />
    <View style={{ marginTop: 10 }}><Text style={styles.optionLabel}>Conexão com o celular</Text><Text style={[styles.optionDetail, status.phone && { color: C.accent }]}>{status.phone ? 'Conectado' : 'Fora de alcance agora. Ele se conecta sozinho quando o celular estiver ligado e com internet.'}</Text></View>
    {status.apps?.length ? <View style={{ marginTop: 10 }}><Text style={styles.optionLabel}>Celulares usando o MyBots do computador</Text>
      {status.apps.map(item => <View key={item.id} style={styles.passwordRow}><View style={{ flex: 1 }}><Text style={styles.limitName}>{item.name}</Text><Text style={styles.limitMeta}>Pareado em {new Date(item.pairedAt).toLocaleDateString('pt-BR')}</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel={`Esquecer ${item.name}`} onPress={() => call('desktop.forgetApp', { id: item.id }).catch(() => {})} style={styles.stopButton}><Icon name="trash" size={13} color={C.muted} /><Text style={styles.stopText}>Esquecer</Text></Pressable></View>)}
      <Text style={styles.optionDetail}>Esquecer corta o acesso na hora. Para voltar, o celular precisa ler um QR novo.</Text></View> : null}
    <SyncCard sync={status.sync} onNow={() => call('desktop.sync')} onReset={() => call('desktop.sync', { reset: true })} /></>;
  if (status.source === 'local' || status.phone || !status.offlineSince || now - status.offlineSince < 120000) return null;
  return <View style={[styles.modeOption, { margin: 12, flexShrink: 1 }]}>
    <Text style={styles.optionLabel}>O celular não encontrou este computador</Text>
    <Text style={styles.optionDetail}>O celular se conecta sozinho quando estiver ligado e com internet. Se continuar sem conectar, mostre o QR de novo.</Text>
    {status.localAvailable ? <Pressable accessibilityRole="button" onPress={() => call('desktop.source', { source: 'local' }).catch(() => {})} style={styles.stopButton}><Icon name="bots" size={13} color={C.accent} /><Text style={[styles.stopText, { color: C.accent }]}>Usar só este computador</Text></Pressable> : null}
    <DesktopPair call={call} />
  </View>;
}


/** How the sync between the phone and the computer stands (state, progress, conflicts); the window adds a "Sincronizar agora". */
export function SyncCard({ sync, onNow, onReset }) {
  const [busy, setBusy] = useState(false); const [note, setNote] = useState('');
  if (!sync) return null;
  const peer = sync.peer || 'o outro aparelho'; const working = sync.state === 'syncing' || busy;
  const ago = sync.at ? (() => { const minutes = Math.round((Date.now() - Date.parse(sync.at)) / 60000); return minutes < 1 ? 'agora há pouco' : minutes < 60 ? `há ${minutes} min` : `às ${new Date(sync.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`; })() : '';
  const text = working ? (sync.progress?.total > 1 ? `Copiando… ${Math.min(sync.progress.done, sync.progress.total).toLocaleString('pt-BR')} de ${sync.progress.total.toLocaleString('pt-BR')}` : 'Sincronizando…')
    : sync.state === 'error' ? sync.error || 'A sincronização falhou.' : sync.online === false ? `Aguardando ${peer} ficar ligado${ago ? ` · última vez ${ago}` : ''}` : sync.at ? `Em dia com ${peer} · ${ago}` : `Pronto para sincronizar com ${peer}`;
  const run = async () => { setBusy(true); setNote(''); try { await onNow(); } catch (error) { setNote(error.message); } finally { setBusy(false); } };
  return <View style={{ marginTop: 10 }}>
    <Text style={styles.optionLabel}>Sincronização</Text>
    <Text style={[styles.optionDetail, sync.state === 'error' && !working && { color: C.amber }]}>{text}</Text>
    <Text style={styles.optionDetail}>Bots, conversas, memória, salas, rotinas, pendências e arquivos até 20 MB se juntam sozinhos quando os dois aparelhos estão ligados. Permissões, senhas e cartões não saem do aparelho. Se os dois mudarem a mesma coisa, vale a versão mais recente e o aviso aparece em Atividade.</Text>
    {sync.conflicts > 0 ? <Text style={styles.optionDetail}>{sync.conflicts === 1 ? '1 conflito resolvido' : `${sync.conflicts} conflitos resolvidos`} nos últimos 30 dias.</Text> : null}
    {onNow ? <Pressable accessibilityRole="button" disabled={working} onPress={run} style={[styles.stopButton, { marginTop: 8 }]}><Icon name="refresh" size={13} color={C.accent} /><Text style={[styles.stopText, { color: C.accent }]}>{working ? 'Sincronizando…' : 'Sincronizar agora'}</Text></Pressable> : null}
    {onReset ? <Pressable accessibilityRole="button" disabled={working} onPress={() => { setBusy(true); setNote(''); onReset().catch(error => setNote(error.message)).finally(() => setBusy(false)); }} style={[styles.stopButton, { marginTop: 6 }]}><Icon name="search" size={13} color={C.muted} /><Text style={styles.stopText}>Conferir tudo de novo</Text></Pressable> : null}
    {note ? <Text style={[styles.optionDetail, { color: C.amber }]}>{note}</Text> : null}
  </View>;
}

/** Where the window's bots and conversations come from: the paired phone, or this computer's own MyBots (works with the phone off). */
export function DesktopSource({ call, status }) {
  const [busy, setBusy] = useState(false); const [note, setNote] = useState('');
  if (!status?.localAvailable) return null;
  const choose = async source => {
    if (busy || source === status.source) return;
    setBusy(true); setNote('');
    try { await call('desktop.source', { source }); } catch (error) { setNote(error.message); setBusy(false); }
  };
  const options = [['local', 'Este computador', 'Bots e conversas guardados aqui. Funciona com o celular desligado.'], ['phone', 'Celular', 'Mostra o MyBots do celular pareado, como antes.']];
  return <View style={{ marginTop: 10 }}>
    <Text style={styles.optionLabel}>De onde vêm os bots e conversas</Text>
    {options.map(([key, label, detail]) => <Pressable key={key} accessibilityRole="radio" accessibilityState={{ selected: status.source === key }} disabled={busy} onPress={() => choose(key)} style={{ marginTop: 8, opacity: busy ? 0.6 : 1 }}>
      <Text style={[styles.optionLabel, status.source === key && { color: C.accent }]}>{status.source === key ? '● ' : '○ '}{label}</Text>
      <Text style={styles.optionDetail}>{detail}</Text>
    </Pressable>)}
    {status.sync ? null : <Text style={styles.optionDetail}>Quando você parear um celular, os bots e conversas dos dois lados se juntam sozinhos.</Text>}
    {note ? <Text style={[styles.optionDetail, { color: C.amber }]}>{note}</Text> : null}
  </View>;
}

export function DesktopPair({ call, compact = false }) {
  const [qr, setQr] = useState(null); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!qr) return undefined;
    const timer = setInterval(async () => {
      if (Date.now() > qr.expiresAt) { setQr(null); setNote('O QR venceu. Gere outro quando for parear.'); return; }
      try { const status = await call('desktop.status'); if (status.lastPaired && status.lastPaired > qr.shownAt) { setQr(null); setNote('Celular pareado. Pode fechar esta tela.'); } } catch {}
    }, 2000);
    return () => clearInterval(timer);
  }, [qr]);
  const show = async (iphone = false) => {
    setBusy(true); setNote('');
    try { const result = await call('desktop.pair', iphone ? { iphone: true } : {}); setQr({ ...result, iphone, shownAt: new Date(Date.now() - 1000).toISOString() }); }
    catch (error) { setNote(error.message); } finally { setBusy(false); }
  };
  return <View style={[styles.modeOption, compact && { alignSelf: 'stretch', marginTop: 18 }]}>
    <Text style={styles.optionLabel}>Parear um celular</Text>
    <DesktopNetwork call={call} />
    <Text style={styles.optionDetail}>No celular, abra o MyBots e leia o QR: na primeira tela é "Ler o QR do computador"; no app já em uso, Ajustes → Computador → Parear de novo (usando o MyBots deste celular, Conectar computador). Ele vale por 10 minutos e uma vez só.</Text>
    {qr ? <View style={styles.pairQr}><View accessibilityLabel={qr.iphone ? 'QR para parear o iPhone' : 'QR para parear o celular'}><SvgXml xml={qr.svg} width={260} height={260} /></View>
      <Text style={styles.limitMeta}>{qr.iphone ? 'Abra a câmera do iPhone, aponte para o QR e toque no link.' : 'Esperando o celular ler…'}</Text>
      {qr.text ? <Pressable accessibilityRole="button" onPress={() => copyText(qr.text).then(() => setNote('Link copiado.')).catch(() => {})} style={[styles.stopButton, { marginTop: 8 }]}><Icon name="copy" size={13} color={C.accent} /><Text style={[styles.stopText, { color: C.accent }]}>Copiar o link</Text></Pressable> : null}</View> : null}
    <View style={{ flexDirection: 'row', gap: 14, marginTop: 10 }}>
      <Pressable accessibilityRole="button" disabled={busy} onPress={qr ? () => setQr(null) : () => show(false)} style={styles.stopButton}><Icon name={qr ? 'close' : 'phone'} size={13} color={C.accent} /><Text style={[styles.stopText, { color: C.accent }]}>{qr ? 'Esconder QR' : busy ? 'Gerando…' : 'Mostrar QR (Android)'}</Text></Pressable>
      {qr ? null : <Pressable accessibilityRole="button" disabled={busy} onPress={() => show(true)} style={styles.stopButton}><Icon name="phone" size={13} color={C.accent} /><Text style={[styles.stopText, { color: C.accent }]}>Mostrar QR (iPhone)</Text></Pressable>}
    </View>
    {note ? <Text style={[styles.optionDetail, /pareado/.test(note) ? { color: C.accent } : { color: C.amber }]}>{note}</Text> : null}
  </View>;
}

export function ComputerPanel({ computer, nodes = [], sync = null, onPair, onForget, onRetry }) {
  const [scanning, setScanning] = useState(false); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const [permission, requestPermission] = useCameraPermissions(); const reading = useRef(false);
  const node = nodes.find(item => item.id === computer?.id);
  const logged = Object.entries(node?.connections || {}).filter(([, value]) => value.loggedIn).map(([key]) => PROVIDER_NAMES[key] || key);
  const scan = async () => {
    setNote('');
    const allowed = permission?.granted || (await requestPermission()).granted;
    if (!allowed) { setNote('Permita a câmera para ler o QR do computador.'); return; }
    reading.current = false; setScanning(true);
  };
  // The camera reports the same QR many times per second: only the first reading pairs.
  const read = async ({ data }) => {
    if (reading.current || !/^mybots:\/\/computador\?/.test(data || '')) return;
    reading.current = true; setScanning(false); setBusy(true); setNote('Conectando ao computador…');
    try { const result = await onPair(data); setNote(`${result.name} conectado. Os bots do computador já ficam online.`); }
    catch (error) { setNote(error.message); } finally { setBusy(false); }
  };
  const forget = () => Alert.alert(`Esquecer ${computer.name}?`, 'Os bots do computador ficam offline até você parear de novo.', [{ text: 'Cancelar', style: 'cancel' },
    { text: 'Esquecer', style: 'destructive', onPress: () => onForget().catch(error => setNote(error.message)) }]);
  const state = !computer?.paired ? null : computer.state === 'online' ? `Conectado${logged.length ? ` · ${logged.join(' e ')} no computador` : ' · nenhuma IA conectada nele'}`
    : computer.state === 'connecting' ? 'Procurando o computador…' : `Desligado ou fora de alcance${node?.lastSeen ? ` · ${seenText(node)}` : ''}`;
  return <View style={styles.modeOption}>
    <Text style={styles.optionLabel}>{computer?.paired ? computer.name : 'Seu computador'}</Text>
    {computer?.paired ? <SyncCard sync={sync} /> : null}
    {computer?.paired ? <View style={styles.passwordRow}>
      <View style={styles.rowIcon}><Icon name="laptop" size={17} color={computer.state === 'online' ? C.accent : C.faint} /></View>
      <View style={{ flex: 1 }}><Text style={styles.limitName}>{state}</Text>{computer.error && computer.state !== 'online' ? <Text style={[styles.limitMeta, { color: C.amber }]}>{computer.error}</Text> : null}</View>
    </View> : <Text style={styles.optionDetail}>Com o computador ligado, os bots que vivem nele ficam online e respondem de lá, usando o Claude ou o Codex do computador. No computador, rode node pc/node.mjs pair e leia o QR que aparecer.</Text>}
    <View style={{ flexDirection: 'row', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
      <Pressable accessibilityRole="button" disabled={busy} onPress={scan} style={styles.stopButton}><Icon name="laptop" size={13} color={C.accent} /><Text style={[styles.stopText, { color: C.accent }]}>{computer?.paired ? 'Parear de novo' : 'Conectar computador'}</Text></Pressable>
      {computer?.paired && computer.state !== 'online' ? <Pressable accessibilityRole="button" onPress={() => onRetry().catch(() => {})} style={styles.stopButton}><Icon name="refresh" size={13} color={C.muted} /><Text style={styles.stopText}>Tentar agora</Text></Pressable> : null}
      {computer?.paired ? <Pressable accessibilityRole="button" onPress={forget} style={styles.stopButton}><Icon name="trash" size={13} color={C.muted} /><Text style={styles.stopText}>Esquecer</Text></Pressable> : null}
    </View>
    {note ? <Text style={[styles.optionDetail, /conectado/.test(note) ? { color: C.accent } : /Conectando/.test(note) ? null : { color: C.amber }]}>{note}</Text> : null}
    <Modal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)}>
      <View style={styles.scanner}>
        <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={scanning ? read : undefined} />
        <View style={styles.scannerFrame} />
        <Text style={styles.scannerText}>Aponte para o QR do MyBots no computador.</Text>
        <Pressable accessibilityRole="button" onPress={() => setScanning(false)} style={styles.scannerClose}><Text style={styles.denyText}>Cancelar</Text></Pressable>
      </View>
    </Modal>
  </View>;
}

const reais = cents => `R$ ${Math.floor(cents / 100).toLocaleString('pt-BR')},${String(cents % 100).padStart(2, '0')}`;
const PURCHASE_STATUS = { paga: '', cancelada: ' · não concluída', desconsiderada: ' · desconsiderada' };
const CARD_BRANDS = { visa: ['VISA', '#1B2B6B', '#3E6BFF'], mastercard: ['Mastercard', '#2B2230', '#C2542D'], elo: ['elo', '#1C1C20', '#0F7F8F'], amex: ['AMEX', '#14464F', '#38A3B3'], hipercard: ['Hipercard', '#6A1620', '#D6455A'], card: ['', '#252B3A', '#566485'] };

/** A card drawn like a card: gradient by brand, chip, the last four digits, holder and validity. Nothing secret is ever shown. */
export function WalletCardArt({ card, frozen = false }) {
  const [brand, from, to] = CARD_BRANDS[card.brand] || CARD_BRANDS.card; const id = 'g' + card.id.slice(0, 8);
  const holder = String(card.holder || '').toUpperCase().slice(0, 26); const valid = `${String(card.month).padStart(2, '0')}/${String(card.year).slice(-2)}`;
  return <View accessible accessibilityLabel={`Cartão ${brand || ''} final ${card.last4}${card.label ? ', ' + card.label : ''}${frozen ? ', carteira congelada' : ''}`} style={{ aspectRatio: 1.62, width: '100%', maxWidth: 380, alignSelf: 'center', borderRadius: 18, overflow: 'hidden', opacity: frozen ? 0.55 : 1 }}>
    <Svg width="100%" height="100%" viewBox="0 0 320 198">
      <Defs><LinearGradient id={id} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={from} /><Stop offset="1" stopColor={to} /></LinearGradient></Defs>
      <SvgRect width="320" height="198" rx="18" fill={`url(#${id})`} />
      <SvgCircle cx="285" cy="30" r="95" fill="#FFFFFF" opacity="0.07" /><SvgCircle cx="250" cy="170" r="70" fill="#FFFFFF" opacity="0.06" />
      <SvgRect x="24" y="62" width="40" height="30" rx="6" fill="#E8C873" opacity="0.92" /><SvgRect x="24" y="76" width="40" height="2" fill="#B8963F" opacity="0.7" /><SvgRect x="42" y="62" width="2" height="30" fill="#B8963F" opacity="0.7" />
      <SvgText x="24" y="38" fill="#FFFFFF" fontSize="13" fontWeight="700" opacity="0.9">{(card.label || 'Cartão virtual').slice(0, 24)}</SvgText>
      <SvgText x="24" y="128" fill="#FFFFFF" fontSize="21" fontWeight="600" letterSpacing="2">{`••••  ••••  ••••  ${card.last4}`}</SvgText>
      <SvgText x="24" y="168" fill="#FFFFFF" fontSize="11" opacity="0.85" letterSpacing="1">{holder}</SvgText>
      <SvgText x="24" y="184" fill="#FFFFFF" fontSize="9" opacity="0.7">{`Válido até ${valid}`}</SvgText>
      <SvgText x="298" y="182" fill="#FFFFFF" fontSize="19" fontWeight="800" fontStyle="italic" textAnchor="end">{brand}</SvgText>
      {frozen ? <SvgText x="296" y="36" fill="#FFFFFF" fontSize="12" fontWeight="700" textAnchor="end">Congelada</SvgText> : null}
    </Svg>
  </View>;
}

/** Carteira: the cards drawn as cards, which bots may pay with each one, the rules, Congelar and the extract with each receipt. */
export function WalletPanel({ bots = [] }) {
  const [cards, setCards] = useState([]); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const [rules, setRules] = useState({ frozen: true }); const [purchases, setPurchases] = useState([]); const [receipt, setReceipt] = useState(null); const [open, setOpen] = useState(null);
  const load = async () => { try { setCards(await walletCards()); setRules(await walletRules()); setPurchases(await walletPurchases()); } catch (error) { setNote(nativeMessage(error)); } };
  useEffect(() => { load(); }, []);
  const native = action => async () => { setBusy(true); setNote(''); try { await action(); await load(); } catch (error) { setNote(nativeMessage(error)); } finally { setBusy(false); } };
  const remove = card => Alert.alert(`Apagar o cartão final ${card.last4}?`, 'O cartão será removido deste celular e nenhum bot poderá usá-lo.', [{ text: 'Cancelar', style: 'cancel' },
    { text: 'Apagar', style: 'destructive', onPress: () => cardDelete(card.id).then(load).catch(error => setNote(nativeMessage(error))) }]);
  const dismiss = item => Alert.alert('Desconsiderar esta compra?', 'Use quando a compra não aconteceu (pedido cancelado ou recusado). Ela deixa de contar nos limites.', [{ text: 'Cancelar', style: 'cancel' },
    { text: 'Desconsiderar', onPress: () => walletDismiss(item.id).then(load).catch(error => setNote(nativeMessage(error))) }]);
  const toggle = (card, botId) => native(() => walletCardBots(card.id, card.bots.includes(botId) ? card.bots.filter(id => id !== botId) : [...card.bots, botId]))();
  const frozen = rules.frozen !== false;
  const month = new Date().toISOString().slice(0, 7);
  const spent = purchases.filter(item => item.status === 'paga' && new Date(item.at).toISOString().slice(0, 7) === month).reduce((sum, item) => sum + item.total, 0);
  return <View>
    <Text style={styles.optionDetail}>{frozen ? 'Carteira congelada: nenhum bot paga. ' : `Carteira ativa. ${rules.perMonth ? `Gasto no mês: ${reais(spent)} de ${reais(rules.perMonth)}. ` : ''}`}Os cartões ficam só neste celular; os bots veem apenas o final.</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 10 }}>
      <Pressable accessibilityRole="button" disabled={busy} onPress={native(walletRulesEditor)} style={styles.stopButton}><Text style={[styles.stopText, { color: C.accent }]}>{frozen ? 'Regras e descongelar' : 'Regras de gasto'}</Text></Pressable>
      {!frozen ? <Pressable accessibilityRole="button" onPress={native(walletFreeze)} style={styles.stopButton}><Icon name="stop" size={13} color={C.amber} /><Text style={[styles.stopText, { color: C.amber }]}>Congelar carteira</Text></Pressable> : null}
    </View>
    {cards.map(card => {
      const names = card.bots.map(id => bots.find(bot => bot.id === id)?.name).filter(Boolean);
      return <View key={card.id} style={{ marginBottom: 18 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Bots do cartão final ${card.last4}`} onPress={() => setOpen(open === card.id ? null : card.id)}><WalletCardArt card={card} frozen={frozen} /></Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <Text style={[styles.optionDetail, { flex: 1 }]}>{names.length ? `Usado por: ${names.join(', ')}` : 'Nenhum bot pode usar este cartão ainda.'}</Text>
          <Pressable accessibilityRole="button" onPress={() => setOpen(open === card.id ? null : card.id)} style={styles.stopButton}><Text style={[styles.stopText, { color: C.accent }]}>{open === card.id ? 'Fechar' : 'Escolher bots'}</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Apagar o cartão final ${card.last4}`} disabled={busy} onPress={() => remove(card)} style={styles.stopButton}><Icon name="trash" size={13} color={C.faint} /></Pressable>
        </View>
        {open === card.id ? <View style={{ marginTop: 8 }}>
          <Text style={styles.optionDetail}>Só os bots marcados podem pagar com este cartão, sempre dentro das regras de gasto.</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {bots.length ? bots.map(bot => { const on = card.bots.includes(bot.id); return <Pressable key={bot.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} disabled={busy} onPress={() => toggle(card, bot.id)} style={[styles.stopButton, on && { borderColor: C.accent + '90', backgroundColor: C.accent + '18' }]}><Icon name={on ? 'check' : 'plus'} size={13} color={on ? C.accent : C.faint} /><Text style={[styles.stopText, on && { color: C.accent }]}>{bot.name}</Text></Pressable>; }) : <Text style={styles.optionDetail}>Crie um bot para liberar o cartão.</Text>}
          </View>
        </View> : null}
      </View>;
    })}
    <Pressable accessibilityRole="button" disabled={busy} onPress={native(cardEditor)} style={{ minHeight: cards.length ? 96 : 150, width: '100%', maxWidth: 380, alignSelf: 'center', borderRadius: 18, borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.line2, alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14 }}>
      <Icon name="plus" size={22} color={C.accent} /><Text style={[styles.optionLabel, { color: C.accent }]}>{cards.length ? 'Adicionar outro cartão' : 'Adicionar cartão'}</Text><Text style={[styles.optionDetail, { textAlign: 'center', paddingHorizontal: 24 }]}>De preferência um cartão virtual do seu banco, com limite próprio.</Text>
    </Pressable>
    {note ? <Text style={[styles.optionDetail, { color: C.amber, marginTop: 8 }]}>{note}</Text> : null}
    {purchases.length ? <Text style={[styles.optionLabel, { marginTop: 18 }]}>Extrato</Text> : null}
    {purchases.slice(0, 30).map(item => <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 }}>
      {item.receipt ? <Pressable accessibilityRole="button" accessibilityLabel="Ver comprovante" onPress={() => setReceipt(item.receipt)}><Image source={{ uri: item.receipt }} style={{ width: 44, height: 44, borderRadius: 8, backgroundColor: C.surface2 }} /></Pressable> : null}
      <View style={{ flex: 1 }}>
        <Text style={[styles.optionLabel, item.status !== 'paga' && { color: C.faint }]}>{reais(item.total)} · {item.store}{PURCHASE_STATUS[item.status] || ''}</Text>
        <Text style={styles.optionDetail}>{(item.items || []).join(', ')} · {item.bot}{item.card ? ` · final ${item.card}` : ''} · {new Date(item.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}{item.reason ? `\n${item.reason}` : ''}</Text>
      </View>
      {item.status === 'paga' ? <Pressable accessibilityRole="button" onPress={() => dismiss(item)} style={styles.stopButton}><Text style={styles.stopText}>Desconsiderar</Text></Pressable> : null}
    </View>)}
    <Modal visible={Boolean(receipt)} transparent animationType="fade" onRequestClose={() => setReceipt(null)}>
      <Pressable style={{ flex: 1, backgroundColor: '#000000E6', justifyContent: 'center', padding: 16 }} onPress={() => setReceipt(null)}>
        {receipt ? <Image source={{ uri: receipt }} resizeMode="contain" style={{ width: '100%', height: '80%' }} /> : null}
        <Text style={[styles.optionDetail, { textAlign: 'center', marginTop: 10 }]}>Comprovante do checkout, com o cartão tapado. Toque para fechar.</Text>
      </Pressable>
    </Modal>
  </View>;
}

export function PasswordOfferCard({ offer, bot, onAnswer }) {
  const [busy, setBusy] = useState(false);
  const answer = async scope => { setBusy(true); try { await onAnswer(scope); } finally { setBusy(false); } };
  return <View style={[styles.updateCard, { marginTop: 4 }]}>
    <View style={styles.updateHead}><View style={styles.updateIcon}><Icon name="key" size={18} color={C.accent} /></View>
      <View style={{ flex: 1 }}><Text style={styles.optionLabel}>Salvar a senha de {offer.host}?</Text>
        <Text style={styles.optionDetail}>{offer.username ? `Usuário ${offer.username}. ` : ''}Assim {bot.name} entra sozinho da próxima vez. A IA nunca vê a senha.</Text></View></View>
    <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => answer('dismiss')} style={[styles.denyButton, { flex: 1 }]}><Text style={styles.denyText}>Agora não</Text></Pressable>
      <PrimaryButton compact icon="check" title={`Para ${bot.name}`} disabled={busy} onPress={() => answer('bot')} style={{ flex: 1.3 }} />
    </View>
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => answer('all')} style={styles.alwaysButton}><Text style={[styles.alwaysText, { color: C.accent }]}>Salvar para todos os bots</Text></Pressable>
  </View>;
}

export function WidgetRow() {
  const [status, setStatus] = useState(null); const [note, setNote] = useState('');
  const load = () => widgetStatus().then(setStatus).catch(() => {});
  useEffect(() => { load(); const sub = AppState.addEventListener('change', state => state === 'active' && load()); return () => sub.remove(); }, []);
  const add = async () => {
    setNote('');
    try { if (!(await requestWidget())) setNote('Este launcher não deixa o app adicionar. Toque e segure na tela inicial → Widgets → MyBots.'); else setTimeout(load, 4000); }
    catch (error) { setNote(nativeMessage(error)); }
  };
  return <View style={[styles.modeOption, styles.rowOption]}>
    <View style={styles.rowIcon}><Icon name="bots" size={19} color={C.accent} /></View>
    <View style={{ flex: 1 }}><Text style={styles.optionLabel}>Widget na tela inicial</Text>
      <Text style={styles.optionDetail}>{status?.placed ? `${status.placed > 1 ? status.placed + ' widgets' : 'Um widget'} na tela inicial, com seus bots ao vivo.` : 'Seus bots animados na tela inicial: quem trabalha, quem espera você e o próximo prazo.'}</Text>
      {note ? <Text style={[styles.optionDetail, { color: C.amber }]}>{note}</Text> : null}</View>
    {status?.canPin !== false ? <Pressable accessibilityRole="button" onPress={add} style={styles.stopButton}><Icon name="plus" size={13} color={C.accent} /><Text style={[styles.stopText, { color: C.accent }]}>{status?.placed ? 'Outro' : 'Adicionar'}</Text></Pressable> : null}
  </View>;
}

export function PersonName({ name, onSave }) {
  const [value, setValue] = useState(name || ''); const [state, setState] = useState('');
  useEffect(() => { setValue(name || ''); }, [name]);
  const save = async () => {
    if (value.trim() === (name || '')) return;
    setState('saving');
    try { await onSave(value); setState('saved'); setTimeout(() => setState(''), 2000); } catch (error) { setState(nativeMessage(error)); }
  };
  return <View style={styles.modeOption}>
    <Text style={styles.optionLabel}>Seu nome</Text>
    <Text style={styles.optionDetail}>Aparece na saudação da tela inicial, que muda com o horário: bom dia, boa tarde e boa noite.</Text>
    <TextInput accessibilityLabel="Seu nome" style={styles.formInput} placeholder="Como quer ser chamado?" placeholderTextColor={C.faint} maxLength={40}
      autoCapitalize="words" autoCorrect={false} returnKeyType="done" value={value} onChangeText={setValue} onBlur={save} onSubmitEditing={save} selectionColor={C.accent} />
    {state ? <Text style={[styles.optionDetail, state.length > 6 && state !== 'saving' && { color: C.amber }]}>{state === 'saving' ? 'Salvando…' : state === 'saved' ? 'Salvo.' : state}</Text> : null}
  </View>;
}

// Dark, light or whatever the system says; the change is applied on the spot.
export const THEME_CHOICES = [['dark', 'Escuro'], ['light', 'Claro'], ['system', 'Seguir o sistema']];
export function ThemeChoice({ value = 'dark', onSave }) {
  const [busy, setBusy] = useState(false);
  const pick = async next => { if (next === value || busy) return; setBusy(true); try { await onSave(next); } catch {} finally { setBusy(false); } };
  return <View style={styles.modeOption}>
    <Text style={styles.optionLabel}>Aparência</Text>
    <Text style={styles.optionDetail}>Escuro usa preto de verdade, que poupa bateria em telas OLED. A mudança vale na hora.</Text>
    <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
      {THEME_CHOICES.map(([key, label]) => <Pressable key={key} accessibilityRole="radio" accessibilityState={{ selected: value === key }} onPress={() => pick(key)}
        style={[styles.stopButton, { paddingHorizontal: 14, paddingVertical: 10 }, value === key && { borderColor: C.accent, backgroundColor: C.accent + '22' }]}>
        <Text style={[styles.stopText, { fontSize: 13.5 }, value === key && { color: C.accent }]}>{label}</Text></Pressable>)}
    </View>
  </View>;
}

export function ScreenOff({ heartbeat, nextRoutineAt }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const check = useCallback(() => { keepAliveStatus().then(setStatus).catch(() => setStatus(null)); }, []);
  useEffect(() => {
    check();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') check(); });
    const timer = setInterval(check, 10000);
    return () => { subscription.remove(); clearInterval(timer); };
  }, [check]);
  if (!status) return null;
  const when = value => value ? new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'ainda não';
  const open = target => openPowerSettings(target).then(check).catch(() => {});
  const toggle = () => { setBusy(true); setKeepAlive(!status.enabled).then(setStatus).catch(() => {}).finally(() => setBusy(false)); };
  const state = !status.enabled ? 'Desligado' : status.downSince ? 'Supervisor parado' : status.running ? 'Ativo' : 'Parado pelo Android';
  const checks = [
    { ok: status.batteryUnrestricted, label: 'Bateria do MyBots sem restrições', actions: [['Liberar', 'battery'], ...(status.xiaomi ? [['Economia de bateria do HyperOS', 'hyperosBattery']] : [])] },
    { ok: status.exactAlarms, label: 'Alarmes no horário exato (rotinas)', actions: [['Permitir', 'exactAlarm']] },
    { ok: !status.backgroundRestricted, label: 'Atividade em segundo plano permitida', actions: [['Abrir', 'details']] },
  ];
  return <View style={styles.modeOption}>
    <Text style={styles.optionLabel}>Funcionar com a tela apagada · {state}</Text>
    <Text style={styles.optionDetail}>{status.enabled
      ? 'Uma notificação discreta “MyBots ativo” mantém as rotinas e os avisos funcionando, acorda o celular no horário de cada rotina e reinicia o MyBots deste celular se ele parar.'
      : 'Desligado: com a tela apagada o Android pode pausar o MyBots, e rotinas e avisos atrasam até você abrir o MyBots.'}</Text>
    {status.enabled ? <Text style={[styles.optionDetail, { marginTop: 6 }]}>Último sinal do supervisor: {when(heartbeat)} · Última verificação: {when(status.lastCheckAt)}{status.nextAlarmAt ? ` · Próximo despertar: ${when(status.nextAlarmAt)}` : ''}{nextRoutineAt ? ` · Próxima rotina ou aviso: ${when(nextRoutineAt)}` : ''}</Text> : null}
    {status.enabled && status.lastRestartAt ? <Text style={styles.optionDetail}>Último reinício pelo MyBots: {when(status.lastRestartAt)}{status.restartMessage ? ` · ${status.restartMessage}` : ''}</Text> : null}
    {status.enabled && !status.running && status.startError ? <Text style={styles.optionDetail}>O Android não deixou o serviço iniciar em segundo plano. Libere a bateria abaixo e abra o MyBots de novo.</Text> : null}
    {status.enabled ? checks.map(item => <View key={item.label} style={styles.appRow}>
      <Text style={styles.optionDetail}>{item.ok ? '✓' : '!'}  {item.label}</Text>
      {!item.ok ? <View style={styles.appActions}>{item.actions.map(([title, target]) => <Pressable key={target} onPress={() => open(target)}><Text style={styles.deleteText}>{title}</Text></Pressable>)}</View> : null}
    </View>) : null}
    {status.enabled && status.xiaomi ? <View style={styles.appRow}>
      <Text style={styles.optionDetail}>No HyperOS ligue também o Início automático do MyBots (o sistema não informa se está ligado).</Text>
      <View style={styles.appActions}><Pressable onPress={() => open('autostart')}><Text style={styles.deleteText}>Abrir Início automático</Text></Pressable></View>
    </View> : null}
    {status.enabled && !status.notifications ? <Text style={styles.optionDetail}>As notificações do MyBots estão bloqueadas: o serviço funciona, mas sem o aviso “MyBots ativo” e sem os avisos dos bots.</Text> : null}
    <Pressable disabled={busy} onPress={toggle} style={{ marginTop: 8 }}><Text style={styles.deleteText}>{status.enabled ? 'Desligar' : 'Ligar'}</Text></Pressable>
  </View>;
}

export function claudeName(id) {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id || '');
  return match ? `Claude ${match[1][0].toUpperCase()}${match[1].slice(1)} ${match[2]}${match[3] ? '.' + match[3] : ''}` : null;
}

export const tokensLabel = value => value >= 1e6 ? `${(value / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi` : value >= 1000 ? `${(value / 1000).toLocaleString('pt-BR', { maximumFractionDigits: value >= 1e5 ? 0 : 1 })} mil` : String(value);

export const PLAN_NAMES = { codex: 'ChatGPT', claude: 'Claude' };

export const WINDOW_NAMES = { five_hour: 'Últimas 5 horas', week: 'Semana' };

export function resetLabel(iso) {
  if (!iso) return '';
  const at = new Date(iso); const soon = at - Date.now() < 86400000;
  return `renova ${soon ? 'às ' + at.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : at.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}`;
}

export function ItemsByDeadline({ items, bots, onComplete }) {
  if (!items.length) return null;
  const pad = value => String(value).padStart(2, '0');
  const day = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const now = new Date(); const today = day(now); const week = day(new Date(now.getTime() + 7 * 86400000));
  const groupOf = item => {
    if (!item.due) return 'none';
    const date = item.due.slice(0, 10);
    if (item.due.includes('T') ? new Date(item.due) < now : date < today) return 'late';
    return date === today ? 'today' : date <= week ? 'week' : 'later';
  };
  const order = item => item.due ? new Date(item.due.includes('T') ? item.due : item.due + 'T00:00').getTime() : Infinity;
  const groups = [['late', 'Atrasadas'], ['today', 'Hoje'], ['week', 'Próximos 7 dias'], ['later', 'Depois'], ['none', 'Sem prazo']];
  const tones = { late: C.red, today: C.amber, week: C.peach, later: C.sky, none: C.faint };
  return <View>
    {groups.map(([key, title]) => {
      const list = items.filter(item => groupOf(item) === key).sort((a, b) => order(a) - order(b));
      return list.length ? <View key={key}>
        <Text style={[styles.sheetSection, { color: tones[key] }]}>{title.toUpperCase()} · {list.length}</Text>
        {list.map(item => <View key={item.id} style={[styles.modeOption, styles.rowOption]}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Concluir ${item.title}`} hitSlop={8} onPress={() => onComplete(item.id)} style={[styles.itemCheck, { borderColor: tones[key] }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.optionLabel}>{item.title}</Text>
            <Text style={styles.optionDetail} numberOfLines={2}>{[item.course, bots.find(bot => bot.id === item.botId)?.name].filter(Boolean).join(' · ')}</Text>
            {item.dueLabel ? <View style={[styles.dueTag, { backgroundColor: tones[key] + '1A' }]}><Icon name="calendar" size={12} color={tones[key]} /><Text style={[styles.dueTagText, { color: tones[key] }]}>{item.dueLabel}</Text></View> : null}
          </View>
        </View>)}
      </View> : null;
    })}
  </View>;
}

export function shareText(share) {
  const text = (share?.text || '').trim(); const subject = (share?.subject || '').trim();
  return subject && !text.includes(subject) ? `${subject}\n${text}`.trim() : text;
}

export function ShareSheet({ share, bots: ignored, phone, onPick, onClose }) {
  const bots = useStore(selectBots);
  const text = shareText(share); const files = share?.files || [];
  const ordered = [...bots].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const parts = [text ? (/^https?:\/\/\S+$/.test((share?.text || '').trim()) ? 'um link' : 'um texto') : '', files.length ? `${files.length} ${files.length > 1 ? 'arquivos' : 'arquivo'}` : ''].filter(Boolean);
  return <Modal transparent visible={Boolean(share)} animationType="slide" onRequestClose={onClose}>
    <Pressable style={styles.sheetBackdrop} onPress={onClose}>
      <Pressable style={[styles.sheet, styles.sheetTall]} onPress={event => event.stopPropagation()}>
        <View style={styles.sheetHandle} />
        <SheetHeader icon="send" title="Enviar para um bot" subtitle={parts.length ? `Você compartilhou ${parts.join(' e ')}. Escolha quem recebe; você revisa antes de mandar.` : 'Nada chegou do outro app.'} onClose={onClose} />
        {text || files.length ? <View style={styles.sharePreview}>
          {text ? <Text style={styles.sharePreviewText} numberOfLines={3}>{text}</Text> : null}
          {files.length ? <View style={styles.shareFiles}>{files.map((file, index) => <View key={index} style={styles.fileChip}><FileChip file={file} /></View>)}</View> : null}
          {files.length && !phone ? <Text style={styles.shareProblem}>Arquivos só chegam aos bots no modo Só no celular; no modo computador vai só o texto.</Text> : null}
          {(share?.problems || []).map(problem => <Text key={problem} style={styles.shareProblem}>{problem}</Text>)}
        </View> : null}
        <ScrollView style={styles.sheetOptions} contentContainerStyle={{ paddingBottom: 18 }}>
          {ordered.length ? ordered.map(bot => <Pressable key={bot.id} accessibilityRole="button" accessibilityLabel={`Enviar para ${bot.name}`} onPress={() => onPick(bot)} style={({ pressed }) => [styles.modeOption, styles.rowOption, pressed && styles.pressed]}>
            <Avatar bot={bot} size={44} />
            <View style={{ flex: 1 }}><Text style={styles.optionLabel} numberOfLines={1}>{bot.name}</Text><Text style={styles.optionDetail} numberOfLines={1}>{plain(bot.instructions || '') || 'Sem descrição'}</Text></View>
            <Icon name="right" size={16} color={C.faint} />
          </Pressable>) : <Text style={styles.optionDetail}>Crie um bot primeiro para poder enviar coisas a ele.</Text>}
        </ScrollView>
      </Pressable>
    </Pressable>
  </Modal>;
}

export function useDictation({ phone, call, setValue, onError }) {
  const [voice, setVoice] = useState(null); const [, tick] = useState(0);
  // The iPhone's web app has no dictation of its own (the keyboard's microphone does it).
  const available = !pwa && (phone || Boolean(desktop && call));
  const add = text => { if (text) setValue(old => old.trim() ? `${old.trim()} ${text}` : text); };
  useEffect(() => {
    if (!phone || pwa) return undefined;
    const subscription = onSpeech(event => {
      if (event.type === 'level') setVoice(old => old && { ...old, level: event.level });
      else if (event.type === 'partial') setVoice(old => old && { ...old, text: event.text });
      else if (event.type === 'final') { add(event.text); setVoice(null); }
      else if (event.type === 'error') { setVoice(null); onError(event.message); }
    });
    return () => { subscription.remove(); stopListening(true).catch(() => {}); };
  }, [phone]);
  useEffect(() => { if (!voice?.since || voice.busy) return undefined; const timer = setInterval(() => tick(value => value + 1), 1000); return () => clearInterval(timer); }, [voice?.since, voice?.busy]);
  useEffect(() => () => { if (!phone && desktop && call) call('desktop.dictate', { action: 'cancel' }).catch(() => {}); }, []);
  const start = async () => {
    onError('');
    try {
      if (phone) {
        const permission = await microphonePermission();
        if (permission?.status !== 'granted') throw new Error('Permita o microfone para ditar mensagens.');
        setVoice({ text: '', level: 0 }); await startListening();
      } else { setVoice({ text: '', level: 0.4, since: Date.now() }); await call('desktop.dictate', { action: 'start' }); }
    } catch (e) { setVoice(null); onError(nativeMessage(e)); }
  };
  const stop = async () => {
    if (phone) { stopListening(false).catch(() => {}); return; }
    setVoice(old => old && { ...old, busy: true });
    try { add((await call('desktop.dictate', { action: 'stop' }))?.text); } catch (e) { onError(nativeMessage(e)); } finally { setVoice(null); }
  };
  const cancel = () => { if (phone) stopListening(true).catch(() => {}); else call('desktop.dictate', { action: 'cancel' }).catch(() => {}); setVoice(null); };
  const seconds = voice?.since ? Math.floor((Date.now() - voice.since) / 1000) : 0;
  const label = voice?.busy ? 'Transcrevendo…' : voice?.text || (voice?.since ? `Gravando · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : 'Ouvindo… pode fazer pausas.');
  return { voice, available, start, stop, cancel, label };
}

// The chat's slash commands, offered as soon as a "/" is typed (and narrowed as the name is written), like in Claude.
const COMMANDS = [{ name: '/clear', hint: 'Começar uma sessão nova. A conversa fica guardada.', aliases: ['/limpar', '/nova'] }];
const fold = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const commandsFor = text => {
  if (!/^\/[\p{L}]*$/u.test(text)) return [];
  const typed = fold(text);
  return COMMANDS.filter(item => [item.name, ...item.aliases].some(name => name.startsWith(typed)));
};
export function Composer({ value, setValue, onSend, canSend, placeholder, editable = true, inputRef, onAttach, attachDisabled, phone, call, onError, accessibilityLabel }) {
  const dictation = useDictation({ phone, call, setValue, onError });
  const { voice } = dictation;
  const commands = voice ? [] : commandsFor(value || '');
  const complete = commands.length && !commands.some(item => [item.name, ...item.aliases].includes((value || '').toLowerCase()));
  const field = <TextInput ref={inputRef} accessibilityLabel={accessibilityLabel} value={value} onChangeText={setValue} editable={editable}
      placeholder={placeholder} placeholderTextColor={C.faint} multiline rows={desktop ? 1 : undefined} maxLength={8000} textAlignVertical="top" style={styles.composerInput} selectionColor={C.accent}
      // On the computer, Enter sends and Shift+Enter breaks the line.
      onKeyPress={desktop ? event => { if ((event.nativeEvent.key === 'Enter' || event.nativeEvent.key === 'Tab') && !event.nativeEvent.shiftKey && complete) { event.preventDefault(); setValue(commands[0].name); } else if (event.nativeEvent.key === 'Enter' && !event.nativeEvent.shiftKey) { event.preventDefault(); if (canSend) onSend(); } } : undefined} />;
  const attachTool = <>{voice ? <Pressable accessibilityRole="button" accessibilityLabel="Cancelar ditado" disabled={voice.busy} onPress={dictation.cancel} style={({ pressed }) => [styles.composerTool, pressed && styles.pressed]}><Icon name="close" size={20} color={C.text2} /></Pressable>
        : onAttach ? <Pressable accessibilityRole="button" accessibilityLabel="Anexar arquivo ou foto" disabled={attachDisabled} onPress={onAttach} style={({ pressed }) => [styles.composerTool, attachDisabled && styles.sendDisabled, pressed && styles.pressed]}><Icon name="plus" size={21} color={C.text2} stroke={2} /></Pressable> : null}</>;
  const actions = <>{voice ? <Pressable accessibilityRole="button" accessibilityLabel="Parar ditado e colocar o texto na mensagem" disabled={voice.busy} onPress={dictation.stop} style={({ pressed }) => [styles.sendButton, voice.busy && styles.sendDisabled, pressed && styles.pressed]}><Icon name="check" size={20} color={C.accentInk} stroke={2.6} /></Pressable>
        : <>
          {dictation.available ? <Pressable accessibilityRole="button" accessibilityLabel="Ditar mensagem por voz" disabled={!editable} onPress={dictation.start} style={({ pressed }) => [styles.composerTool, !editable && styles.sendDisabled, pressed && styles.pressed]}><Icon name="mic" size={20} color={C.text} /></Pressable> : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Enviar mensagem" disabled={!canSend} onPress={onSend} style={({ pressed }) => [styles.sendButton, !canSend && styles.sendIdle, pressed && styles.pressed]}><Icon name="send" size={19} color={canSend ? C.accentInk : C.muted} stroke={2.6} /></Pressable>
        </>}</>;
  return <View dataSet={desktop ? { desktopComposer: "true" } : undefined} style={[styles.composerBox, voice && styles.composerListening]}>
    {commands.length ? <View accessibilityRole="menu" style={{ position: 'absolute', left: 0, right: 0, bottom: '100%', marginBottom: 6, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 4, zIndex: 20 }}>
      {commands.map(item => <Pressable key={item.name} accessibilityRole="menuitem" onPress={() => setValue(item.name)} style={({ pressed, hovered }) => [{ flexDirection: 'row', alignItems: 'baseline', gap: 10, paddingVertical: 9, paddingHorizontal: 10, borderRadius: 8 }, (pressed || hovered) && { backgroundColor: C.accent + '16' }]}>
        <Text style={{ color: C.accent, fontFamily: F.b, fontSize: 14 }}>{item.name}</Text><Text style={{ color: C.muted, fontFamily: F.m, fontSize: 13, flexShrink: 1 }}>{item.hint}</Text></Pressable>)}
    </View> : null}
    {voice ? <View style={styles.voiceLive}>
      <View style={styles.voiceLevels}>{[0.5, 0.8, 1, 0.7, 0.4].map((weight, index) => <View key={index} style={[styles.voiceLevel, { height: 4 + Math.round(18 * Math.max(0.15, (voice.level || 0) * weight)) }]} />)}</View>
      <Text style={[styles.voiceText, !voice.text && { color: C.muted }]} numberOfLines={4}>{dictation.label}</Text>
    </View>
    : desktop ? null : field}
    {desktop && !voice ? <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>{attachTool}{field}{actions}</View>
    : <View style={styles.composerRow}>
      {attachTool}
      <View style={{ flex: 1 }} />
      {actions}
    </View>}
  </View>;
}

export function RoomFaces({ bots, size = 40 }) {
  // Up to three faces overlapping, always in the same width so the text beside them lines up.
  const shown = bots.slice(0, 3), step = size * 0.5;
  return <View style={{ width: size + 2 * step, height: size }}>
    {shown.map((bot, index) => <View key={bot.id} style={{ position: 'absolute', left: index * step, top: 0, zIndex: 10 - index }}>
      <Avatar bot={bot} size={size} animated={false} /></View>)}
  </View>;
}

export function EarlierButton({ onPress }) {
  const [loading, setLoading] = useState(false);
  const load = async () => { setLoading(true); try { await onPress(); } finally { setLoading(false); } };
  return <Pressable accessibilityRole="button" disabled={loading} onPress={() => load().catch(() => {})} style={({ pressed }) => [styles.earlier, pressed && styles.pressed]}><Text style={styles.earlierText}>{loading ? 'Carregando…' : 'Ver mensagens anteriores'}</Text></Pressable>;
}

export function RoomCard({ room, bots, onPress }) {
  const members = room.botIds.map(id => bots.find(bot => bot.id === id)).filter(Boolean);
  const latest = latestInRoom(room);
  const who = latest?.role === 'user' ? 'Você' : members.find(bot => bot.id === latest?.botId)?.name;
  const working = room.active?.length ? members.filter(bot => room.active.includes(bot.id)).map(bot => bot.name) : [];
  return <Pressable accessibilityRole="button" accessibilityLabel={`Abrir a sala ${room.name}`} onPress={onPress} style={({ pressed }) => [styles.botCard, pressed && styles.pressed]}>
    <RoomFaces bots={members} size={44} />
    <View style={styles.botCardCopy}>
      <View style={styles.botNameRow}><Text style={styles.botCardName} numberOfLines={1}>{room.name}</Text><Text style={styles.botTime}>{members.length} bots</Text>{room.unread ? <Text style={styles.unread}>{room.unread > 99 ? '99+' : room.unread}</Text> : null}</View>
      {working.length ? <View style={styles.botWorking}><Text style={[styles.botPreview, { color: C.accent }]} numberOfLines={1}>{working.join(', ')} {working.length > 1 ? 'respondendo' : 'respondendo'}</Text><Dots /></View>
        : <Text style={styles.botPreview} numberOfLines={1}>{latest ? `${who || 'Bot'}: ${plain(latest.text) || (latest.status === 'error' ? 'não conseguiu responder' : '')}` : members.map(bot => bot.name).join(', ')}</Text>}
    </View>
  </Pressable>;
}

export function RoomSheet({ visible, room, bots, onClose, onSave, onDelete }) {
  const [name, setName] = useState(''); const [picked, setPicked] = useState([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { if (visible) { setName(room?.name || ''); setPicked(room?.botIds || []); setError(''); } }, [visible, room?.id]);
  const save = async () => { setBusy(true); setError(''); try { await onSave({ name, botIds: picked }); } catch (e) { setError(nativeMessage(e)); } finally { setBusy(false); } };
  return <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
    <View style={styles.sheetBackdrop}><View style={[styles.sheet, styles.sheetTall]}>
      <View style={styles.sheetHandle} />
      <SheetHeader title={room ? 'Editar sala' : 'Nova sala'} subtitle="Uma conversa com vários bots. Sem @, todos respondem; com @Nome, só quem você chamar." onClose={onClose} />
      <ScrollView style={styles.sheetOptions} contentContainerStyle={{ paddingBottom: 18 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.sheetSection}>Nome</Text>
        <TextInput accessibilityLabel="Nome da sala" style={styles.formInput} placeholder="Ex.: Faculdade e estágio" placeholderTextColor={C.faint} maxLength={40} value={name} onChangeText={setName} selectionColor={C.accent} />
        <Text style={styles.sheetSection}>BOTS DA SALA · {picked.length}</Text>
        {bots.map(bot => { const on = picked.includes(bot.id); return <Pressable key={bot.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => setPicked(old => on ? old.filter(id => id !== bot.id) : [...old, bot.id])}
          style={({ pressed }) => [styles.modeOption, styles.rowOption, on && styles.optionChosen, pressed && styles.pressed]}>
          <Avatar bot={bot} size={40} animated={false} />
          <View style={{ flex: 1 }}><Text style={[styles.optionLabel, on && styles.optionLabelChosen]} numberOfLines={1}>{bot.name}</Text><Text style={styles.optionDetail} numberOfLines={1}>{plain(bot.instructions || '') || 'Sem descrição'}</Text></View>
          {on ? <Icon name="check" size={18} color={C.accent} stroke={2.4} /> : null}
        </Pressable>; })}
        <Text style={styles.optionDetail}>Cada bot responde com as próprias permissões e não vê a memória nem as conversas privadas dos outros. Bots podem chamar uns aos outros com @, sem limite de rodadas.</Text>
        {error ? <Text style={[styles.optionDetail, { color: C.red }]}>{error}</Text> : null}
        <PrimaryButton icon="check" title={busy ? 'Salvando…' : room ? 'Salvar sala' : 'Criar sala'} disabled={busy || !name.trim() || picked.length < 2} onPress={save} style={{ marginTop: 16 }} />
        {room ? <Pressable accessibilityRole="button" onPress={onDelete} style={styles.closeSheet}><Icon name="trash" size={16} color={C.red} /><Text style={[styles.closeSheetText, { color: C.red }]}>Apagar sala</Text></Pressable> : null}
      </ScrollView>
    </View></View>
  </Modal>;
}

export function useLiveCallback(handler) {
  const latest = useRef(handler); latest.current = handler;
  return useCallback((...args) => latest.current(...args), []);
}

export function ShareTargets() {
  const targets = useStore(selectShareTargets); const key = JSON.stringify(targets);
  // Each shortcut's icon is a still frame of the bot's face, made here and painted natively.
  useEffect(() => { if (nativeAvailable) publishShareTargets(targets.map(bot => ({ ...bot, still: stillOf(bot, 'idle', { px: 192, dp: 52 }) })))?.catch(() => {}); }, [key]);
  return null;
}
