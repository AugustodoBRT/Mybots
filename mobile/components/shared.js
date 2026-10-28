import { useStore } from '../state/useStore';
import { selectHome, selectBots, selectShareTargets } from '../state/store';
import { C, Icon } from '../theme';
import BotAvatar from '../BotAvatar';
import { Pressable, Text, Animated, Easing, View, ActivityIndicator, Modal, ScrollView, useWindowDimensions, TextInput, AppState, Linking, Alert, StyleSheet } from 'react-native';
import { styles } from '../styles';
import { useRef, useState, useEffect, useCallback } from 'react';
import { formatSize, RichText, FileChip } from '../RichMessage';
import { publishShareTargets, termuxAvailable, notificationAccess, openNotificationAccess, botNotificationStatus, notificationPermission, openNotificationSettings, openAppSettings, termuxApiStatus, passwordsList, passwordSave, passwordDelete, passwordImport, passwordImportDelete, widgetStatus, requestWidget, keepAliveStatus, openPowerSettings, setKeepAlive, phoneAccess, openAccessibility, onSpeech, stopListening, microphonePermission, startListening } from '../termux';
import { SvgXml } from 'react-native-svg';
import { useCameraPermissions, CameraView } from 'expo-camera';
import { desktop } from '../desktop';

export const DEFAULT_API_URL = (process.env.EXPO_PUBLIC_MYBOTS_API_URL || '').replace(/\/$/, '');

export const COLORS = { green: C.mint, blue: C.sky, purple: C.lilac, orange: C.peach };

export const COLOR_NAMES = { green: 'Verde', blue: 'Azul', purple: 'Lilás', orange: 'Laranja' };

export const EFFORT_NAMES = { none: 'Sem raciocínio', minimal: 'Mínimo', low: 'Baixo', medium: 'Médio', high: 'Alto', xhigh: 'Muito alto', max: 'Máximo', ultra: 'Ultra' };

export const TERMUX_COMMANDS = { status: 'codex login status', models: 'catálogo de modelos do Codex', reply: 'codex exec / resume (mensagem pela entrada padrão)', recover: 'recuperação da resposta salva no Termux' };

export const nativeMessage = error => String(error?.message || error).split(/Exception: /).pop().trim();

export function safeLog(value) {
  return String(value || '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redigido]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|sess-[A-Za-z0-9_-]{16,}|codex_[A-Za-z0-9_-]{16,})\b/g, '[token redigido]')
    .replace(/(OPENAI_API_KEY|CODEX_ACCESS_TOKEN|access_token|refresh_token|client_secret)(\s*[:=]\s*)([^\s,;"']+)/gi, '$1$2[redigido]')
    .replace(/((?:access_token|refresh_token|client_secret|api_key)"?\s*:\s*")[^"]+("?)/gi, '$1[redigido]$2')
    .slice(-12000);
}

export function formatTermuxLog(log) {
  const lines = [
    'MyBots · diagnóstico do Termux',
    `Operação: ${log.operation || 'desconhecida'}`,
    `Comando: ${TERMUX_COMMANDS[log.operation] || log.operation || 'desconhecido'}`,
    `Horário: ${log.startedAt ? new Date(log.startedAt).toLocaleString('pt-BR') : 'indisponível'}`
  ];
  if (log.exitCode !== undefined) lines.push(`Código de saída: ${log.exitCode}`);
  if (log.errorCode !== undefined) lines.push(`Código do Termux: ${log.errorCode}`);
  if (log.nativeCode) lines.push(`Código nativo: ${log.nativeCode}`);
  if (log.errorMessage) lines.push(`Mensagem do Termux: ${safeLog(log.errorMessage)}`);
  if (log.nativeMessage) lines.push(`Mensagem do MyBots: ${safeLog(log.nativeMessage)}`);
  if (log.stdout?.trim()) lines.push('', 'Saída:', safeLog(log.stdout));
  if (log.stderr?.trim()) lines.push('', 'Erro:', safeLog(log.stderr));
  if (!log.stdout?.trim() && !log.stderr?.trim() && !log.errorMessage && !log.nativeMessage) lines.push('', 'O Termux não retornou saída de texto.');
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

export const HUE_OF = bot => ({ green: C.mint, blue: C.sky, purple: C.lilac, orange: C.peach })[bot?.color] || C.mint;

export function PrimaryButton({ title, onPress, disabled, compact = false, style, icon, tone = 'mint' }) {
  const ghost = tone === 'ghost';
  return <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled}
    style={({ pressed }) => [styles.primaryButton, compact && styles.compactButton, ghost && styles.ghostButton, disabled && styles.buttonDisabled, pressed && !disabled && styles.pressed, style]}>
    {icon ? <Icon name={icon} size={compact ? 17 : 19} color={ghost ? C.text : C.mintInk} stroke={2.2} /> : null}
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
  return <Pressable accessibilityRole="button" accessibilityLabel="Ir para as mensagens mais novas" onPress={onPress} style={({ pressed }) => [styles.toEnd, pressed && styles.pressed]}><Icon name="down" size={20} color={C.mint} stroke={2.2} /></Pressable>;
}

export function IconButton({ icon, label, onPress, active, disabled, tint = C.text2, size = 42 }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} disabled={disabled} hitSlop={6}
    style={({ pressed }) => [styles.iconButton, { width: size, height: size, borderRadius: size * 0.36 }, active && styles.iconButtonActive, pressed && styles.pressed, disabled && styles.buttonDisabled]}>
    <Icon name={icon} size={size * 0.5} color={active ? C.mint : tint} />
  </Pressable>;
}

export function Dots({ color = C.mint }) {
  const values = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.stagger(160, values.map(value => Animated.sequence([
      Animated.timing(value, { toValue: 1, duration: 280, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(value, { toValue: 0, duration: 280, easing: Easing.in(Easing.quad), useNativeDriver: true }), Animated.delay(200)]))));
    loop.start(); return () => loop.stop();
  }, []);
  return <View style={styles.dots}>{values.map((value, index) => <Animated.View key={index} style={[styles.dot, { backgroundColor: color, opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }), transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) }] }]} />)}</View>;
}

export function SheetHeader({ title, subtitle, onClose, icon }) {
  return <View style={styles.sheetHeader}>
    {icon ? <View style={styles.sheetIcon}><Icon name={icon} size={20} color={C.mint} /></View> : null}
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
      {onLogs && !loading && <Pressable accessibilityRole="button" accessibilityLabel="Ver logs do Termux" onPress={onLogs} style={styles.noticeRetry}>
        <Text style={styles.noticeLogsText}>Logs</Text>
      </Pressable>}
      {onRetry && <Pressable accessibilityRole="button" accessibilityLabel="Tentar conectar novamente" onPress={onRetry} style={styles.noticeRetry}>
        {loading ? <ActivityIndicator color={C.amber} /> : <Text style={styles.noticeRetryText}>Tentar</Text>}
      </Pressable>}
    </View>
  </View>;
}

export function TermuxLogModal({ visible, log, copied, onClose, onCopy }) {
  if (!log) return null;
  return <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
    <Pressable style={styles.sheetBackdrop} onPress={onClose}>
      <Pressable style={styles.logsSheet} onPress={event => event.stopPropagation()}>
        <View style={styles.sheetHandle} />
        <View style={styles.logsHeading}>
          <View style={styles.logsHeadingCopy}><Text style={styles.sheetTitle}>Detalhes do Termux</Text><Text style={styles.logsHint}>Copie este diagnóstico e cole aqui na conversa.</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Fechar logs" onPress={onClose} style={styles.modalClose}><Text style={styles.modalCloseText}>×</Text></Pressable>
        </View>
        <ScrollView style={styles.logsScroll} contentContainerStyle={styles.logsContent}>
          <Text selectable style={styles.logsText}>{formatTermuxLog(log)}</Text>
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

export const PROVIDER_NAMES = { codex: 'Codex', claude: 'Claude' };

export const providerOf = item => item?.provider || 'codex';

export function findModel(models, selection) { return models.find(item => item.model === selection?.model && providerOf(item) === providerOf(selection)) || models.find(item => item.model === selection?.model); }

export function ModelSettings({ models, selection, disabled, onChange, connections }) {
  const [sheet, setSheet] = useState('');
  const model = findModel(models, selection);
  const providers = [...new Set(models.map(providerOf))];
  const provider = providerOf(model || selection);
  const available = models.filter(item => providerOf(item) === provider);
  const modelOptions = available.map(item => ({ value: item.model, label: item.displayName, detail: item.modelId ? `${item.modelId} · sempre a versão mais nova` : item.model }));
  const providerOptions = providers.map(value => ({ value, label: PROVIDER_NAMES[value] || value, detail: connections?.[value]?.message || (value === 'claude' ? 'Claude Code no Termux' : 'Codex no Termux') }));
  const pickProvider = next => { const first = models.find(item => providerOf(item) === next && item.isDefault) || models.find(item => providerOf(item) === next); if (first) onChange(first.model, first.defaultEffort ?? null, next); };
  const effortOptions = model ? (model.efforts.length
    ? model.efforts.map(value => ({ value, label: EFFORT_NAMES[value] || value }))
    : [{ value: null, label: 'Padrão do modelo' }]) : [];
  const effortName = selection?.reasoningEffort ? EFFORT_NAMES[selection.reasoningEffort] || selection.reasoningEffort : 'Padrão do modelo';
  return <View>
    {providers.length > 1 && <View style={styles.settingsRow}><ChoiceField label="IA" value={PROVIDER_NAMES[provider]} disabled={disabled} onPress={() => setSheet('provider')} /></View>}
    <View style={styles.settingsRow}>
      <ChoiceField label="Modelo" value={model?.displayName} disabled={disabled || !models.length} onPress={() => setSheet('model')} />
      <ChoiceField label="Raciocínio" value={model ? effortName : null} disabled={disabled || !model} onPress={() => setSheet('effort')} />
    </View>
    <Text style={styles.settingsHint}>{disabled ? 'Aguarde esta resposta terminar.' : connections?.[provider] && !connections[provider].loggedIn ? connections[provider].message : model ? 'Acesso confirmado ao gerar uma resposta.' : 'Carregando o catálogo de modelos…'}</Text>
    <ChoiceSheet visible={sheet === 'provider'} title="Escolha a IA" options={providerOptions} value={provider}
      onClose={() => setSheet('')} onSelect={next => { if (next !== provider) pickProvider(next); }} />
    <ChoiceSheet visible={sheet === 'model'} title="Escolha um modelo" options={modelOptions} value={selection?.model}
      onClose={() => setSheet('')} onSelect={next => { const chosen = available.find(item => item.model === next); onChange(next, chosen?.defaultEffort ?? null, provider); }} />
    <ChoiceSheet visible={sheet === 'effort'} title="Nível de raciocínio" options={effortOptions} value={selection?.reasoningEffort ?? null}
      onClose={() => setSheet('')} onSelect={effort => onChange(selection?.model, effort, provider)} />
  </View>;
}

export function ApprovalCard({ approval, bot, onRespond, busy }) {
  const titles = { 'memory.write': 'Guardar uma lembrança', 'task.create_item': 'Criar uma pendência', 'notify.user': 'Enviar uma notificação', 'sms.send': 'Enviar um SMS' };
  const summary = approval.summary ?? Object.values(approval.args).filter(value => typeof value === 'string' && value).join('\n');
  return <View style={styles.approvalCard}>
    <View style={styles.approvalHeading}><Avatar bot={bot || { name: 'Bot', color: 'orange' }} size={44} state="waiting" />
      <View style={{ flex: 1 }}><Text style={styles.approvalEyebrow}>PRECISA DE VOCÊ</Text><Text style={styles.approvalTitle}>{bot?.name || 'Seu bot'} quer {(approval.title || titles[approval.tool] || 'executar uma ação').replace(/^./, letter => letter.toLocaleLowerCase())}.</Text></View></View>
    {summary ? <Text selectable style={styles.approvalBody}>{summary}</Text> : null}
    <View style={styles.approvalHintRow}><Icon name="clock" size={14} color={C.faint} /><Text style={styles.approvalHint}>{approval.canAlways ? 'Uma vez vale só agora. ' : ''}Expira às {new Date(approval.expiresAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.</Text></View>
    <View style={styles.approvalActions}>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => onRespond(approval, false)} style={({ pressed }) => [styles.denyButton, pressed && styles.pressed]}><Text style={styles.denyText}>Recusar</Text></Pressable>
      <PrimaryButton compact icon="check" title={busy ? 'Aguarde…' : 'Permitir'} disabled={busy} onPress={() => onRespond(approval, true)} style={{ flex: 1.4 }} />
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

export function TodayStrip({ data, onActivity }) {
  const items = (data?.pendingItems || []).filter(item => item.state === 'open');
  const nextDue = items.filter(item => item.due).sort((a, b) => a.due.localeCompare(b.due))[0];
  const approvals = data?.approvals?.length || 0;
  const working = (data?.active || []).filter(id => !offline(data, id)).length;
  const tiles = [
    approvals ? { key: 'a', icon: 'hand', tone: C.amber, label: approvals > 1 ? `${approvals} decisões` : '1 decisão', detail: 'esperando você' } : null,
    nextDue ? { key: 'd', icon: 'calendar', tone: C.peach, label: nextDue.title, detail: `prazo ${nextDue.dueLabel || nextDue.due}` } : null,
    data?.nextRoutineAt ? { key: 'r', icon: 'bolt', tone: C.sky, label: 'Próxima rotina', detail: new Date(data.nextRoutineAt).toLocaleString('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) } : null,
    items.length ? { key: 'i', icon: 'list', tone: C.lilac, label: `${items.length} ${items.length > 1 ? 'pendências' : 'pendência'}`, detail: 'abertas' } : null,
    working ? { key: 'w', icon: 'spark', tone: C.mint, label: `${working} ${working > 1 ? 'bots' : 'bot'} agora`, detail: 'trabalhando' } : null
  ].filter(Boolean);
  if (!tiles.length) return <View style={styles.calm}><Icon name="check" size={16} color={C.mint} /><Text style={styles.calmText}>Tudo em dia. Nenhuma decisão ou prazo por perto.</Text></View>;
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.todayScroll} contentContainerStyle={styles.today}>
    {tiles.map(tile => <Pressable key={tile.key} accessibilityRole="button" onPress={onActivity} style={({ pressed }) => [styles.todayTile, pressed && styles.pressed]}>
      <View style={[styles.todayIcon, { backgroundColor: tile.tone + '1F' }]}><Icon name={tile.icon} size={17} color={tile.tone} /></View>
      <View style={{ flexShrink: 1 }}><Text style={styles.todayLabel} numberOfLines={1}>{tile.label}</Text><Text style={styles.todayDetail} numberOfLines={1}>{tile.detail}</Text></View>
    </Pressable>)}
  </ScrollView>;
}

export function greeting() { const hour = new Date().getHours(); return hour < 5 ? 'Boa noite' : hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite'; }

export function NavBar({ mode, onActivity, onMaintenance, onConnection, onMode, attention }) {
  const items = [['bots', 'Bots', null, true], ['activity', mode === 'phone' ? 'Atividade' : 'Conexão', mode === 'phone' ? onActivity : onConnection], ['settings', 'Ajustes', mode === 'phone' ? onMaintenance : onMode]];
  return <View style={styles.bottomNav}>{items.map(([icon, label, onPress, active]) =>
    <Pressable key={icon} accessibilityRole="button" accessibilityState={{ selected: Boolean(active) }} onPress={onPress || undefined} style={[styles.navItem, active && styles.navItemActive]}>
      <View><Icon name={icon} size={21} color={active ? C.mint : C.muted} />{icon === 'activity' && attention ? <View style={styles.navBadge} /> : null}</View>
      <Text style={active ? styles.navTextActive : styles.navText}>{label}</Text>
    </Pressable>)}</View>;
}

export const UPDATE_STEPS = { downloading: 'Baixando', installing: 'Conferindo e instalando…', confirm: 'Confirme a instalação na janela do Android.', permission: 'Permita "Instalar apps desconhecidos" para o MyBots e toque em Atualizar de novo.' };

export function UpdateCard({ update, onInstall, onDismiss, compact = false }) {
  const [notes, setNotes] = useState(false);
  const info = update?.info; const step = update?.step; const busy = ['downloading', 'installing', 'confirm'].includes(step?.state);
  if (!info?.available) return null;
  const body = (info.notes || '').replace(/\r/g, '').trim();
  return <View style={styles.updateCard}>
    <View style={styles.updateHead}>
      <View style={styles.updateIcon}><Icon name="download" size={18} color={C.mint} /></View>
      <View style={{ flex: 1 }}><Text style={styles.optionLabel}>{info.latestName || 'Nova versão'} disponível</Text>
        <Text style={styles.optionDetail}>Você está na {info.currentName}{info.size ? ` · ${formatSize(info.size)}` : ''}. Conversas e bots continuam.</Text></View>
      {!compact && !busy ? <Pressable accessibilityRole="button" accessibilityLabel="Lembrar depois" hitSlop={10} onPress={onDismiss}><Icon name="close" size={16} color={C.faint} /></Pressable> : null}
    </View>
    {body ? <Pressable accessibilityRole="button" onPress={() => setNotes(value => !value)} style={styles.updateNotesToggle}><Text style={styles.updateNotesLink}>{notes ? 'Esconder novidades' : 'Ver novidades'}</Text><Icon name={notes ? 'back' : 'down'} size={13} color={C.mint} /></Pressable> : null}
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

export function SideRow({ selected, onPress, label, face, title, time, line, tone, dot, working }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress}
    style={({ pressed, hovered }) => [styles.sideRow, hovered && styles.sideRowHover, selected && styles.sideRowOn, pressed && styles.pressed]}>
    <View>{face}{dot ? <View style={[styles.sideDot, { backgroundColor: dot }]} /> : null}</View>
    <View style={{ flex: 1, minWidth: 0 }}>
      <View style={styles.botNameRow}><Text style={styles.sideTitle} numberOfLines={1}>{title}</Text>{time ? <Text style={styles.sideTime}>{time}</Text> : null}</View>
      {working ? <View style={styles.botWorking}><Text style={[styles.sideLine, { color: tone }]} numberOfLines={1}>{line}</Text><Dots color={tone} /></View>
        : <Text style={[styles.sideLine, tone && { color: tone }]} numberOfLines={1}>{line}</Text>}
    </View>
  </Pressable>;
}

export function DesktopShell({ data: fallback, error, selected, roomId, onOpen, onRoom, onCreate, onNewRoom, onProfile, onActivity, onMaintenance, onRespond, approvalBusy, onComplete, onConnection, call, children }) {
  const data = useStore(selectHome) || fallback;
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const bots = [...(data.bots || [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).filter(bot => !needle || bot.name.toLowerCase().includes(needle));
  const rooms = (data.rooms || []).filter(room => !needle || room.name.toLowerCase().includes(needle));
  const phoneOnline = !error && data.supervisorConnected !== false;
  return <View style={styles.desk}>
    <View style={styles.side}>
      <View style={styles.sideHead}>
        <View style={styles.brandRow}><Avatar bot={{ name: 'MyBots', color: 'green', avatar: 'orbit' }} size={30} tile={false} /><Text style={[styles.brand, { fontSize: 21 }]}>mybots</Text></View>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <IconButton icon="plus" label="Novo bot" onPress={onCreate} size={34} tint={C.mint} />
          <IconButton icon="settings" label="Ajustes" onPress={onMaintenance} size={34} />
        </View>
      </View>
      <View style={styles.sideSearch}><Icon name="search" size={15} color={C.faint} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Buscar bot ou sala" placeholderTextColor={C.faint} style={styles.sideSearchInput} selectionColor={C.mint} /></View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }}>
        {rooms.length || (data.bots || []).length >= 2 ? <>
          <View style={styles.sideSection}><Text style={styles.sideSectionText}>SALAS</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Nova sala" disabled={(data.bots || []).length < 2} onPress={onNewRoom} hitSlop={8}><Icon name="plus" size={15} color={C.muted} /></Pressable></View>
          {rooms.map(room => {
            const members = room.botIds.map(id => data.bots.find(bot => bot.id === id)).filter(Boolean); const latest = latestInRoom(room);
            const working = members.filter(bot => room.active?.includes(bot.id));
            const who = latest?.role === 'user' ? 'Você' : members.find(bot => bot.id === latest?.botId)?.name;
            return <SideRow key={room.id} selected={room.id === roomId} onPress={() => onRoom(room.id)} label={`Abrir a sala ${room.name}`} face={<RoomFaces bots={members} size={36} />}
              title={room.name} time={latest ? shortTime(latest.createdAt) : ''} working={working.length > 0} tone={working.length ? C.mint : null}
              line={working.length ? `${working.map(bot => bot.name).join(', ')} respondendo` : latest ? `${who || 'Bot'}: ${plain(latest.text)}` : members.map(bot => bot.name).join(', ')} />;
          })}
        </> : null}
        <View style={styles.sideSection}><Text style={styles.sideSectionText}>BOTS</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Novo bot" onPress={onCreate} hitSlop={8}><Icon name="plus" size={15} color={C.muted} /></Pressable></View>
        {bots.map(bot => {
          const line = botLine(bot, data); const presence = data.presence?.[bot.id];
          return <SideRow key={bot.id} selected={bot.id === selected} onPress={() => onOpen(bot.id)} label={`Conversar com ${bot.name}`}
            face={<Avatar bot={bot} size={40} state={line.state} animated={line.state !== 'idle'} />} dot={bot.home === 'pc' || bot.home === 'any' ? (presence?.online === false ? C.faint : C.mint) : null}
            title={bot.name} time={latestOf(bot) ? shortTime(bot.updatedAt) : ''} line={line.text} tone={line.tone} working={line.state === 'working'} />;
        })}
        {!bots.length && !needle ? <Text style={styles.sideEmpty}>Nenhum bot ainda. Toque em + para criar o primeiro.</Text> : null}
      </ScrollView>
      <View style={styles.sideFoot}>
        <Pressable accessibilityRole="button" onPress={onConnection} style={styles.sideStatus}><View style={[styles.statusDot, phoneOnline && styles.statusGood]} />
          <Text style={styles.sideStatusText} numberOfLines={1}>{phoneOnline ? 'Celular conectado' : 'Celular fora de alcance'}</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={onActivity} style={styles.sideStatus}><Icon name="activity" size={15} color={C.muted} />
          <Text style={styles.sideStatusText}>Atividade</Text>{data.approvals?.length ? <View style={styles.navBadge} /> : null}</Pressable>
      </View>
    </View>
    <View style={styles.deskMain}>{children || <DeskWelcome data={data} error={error} onRespond={onRespond} approvalBusy={approvalBusy} onCreate={onCreate} onConnection={onConnection} call={call} />}</View>
    {width >= 1280 ? <TodayPanel data={data} onOpen={onOpen} onRespond={onRespond} approvalBusy={approvalBusy} onComplete={onComplete} onActivity={onActivity} /> : null}
  </View>;
}

export function DeskWelcome({ data, error, onRespond, approvalBusy, onCreate, onConnection, call }) {
  const bots = data.bots || [];
  const working = (data.active || []).filter(id => !offline(data, id)).length;
  return <ScrollView contentContainerStyle={styles.deskWelcome}>
    <Text style={styles.greeting}>{greeting()}{data.person?.name ? `, ${data.person.name}` : ''}.</Text>
    <Text style={styles.tagline}>{bots.length ? `${bots.length} ${bots.length > 1 ? 'bots no seu time' : 'bot no seu time'}${working ? ` · ${working} trabalhando agora` : ''}` : 'Seu pequeno time pessoal começa aqui.'}</Text>
    {error ? <Notice text={error} onRetry={onConnection} /> : null}
    {error && !bots.length ? <DesktopPair call={call} /> : null}
    {bots.length ? <TodayStrip data={data} onActivity={() => {}} /> : null}
    {(data.approvals || []).map(approval => <ApprovalCard key={approval.id} approval={approval} bot={bots.find(bot => bot.id === approval.botId)} onRespond={onRespond} busy={approvalBusy === approval.id} />)}
    <View style={styles.deskHint}>
      <View style={styles.emptyCrew}>{(bots.length ? bots.slice(0, 4) : [{ id: 'a', name: 'orbit', avatar: 'orbit', color: 'green' }, { id: 'b', name: 'spark', avatar: 'spark', color: 'purple' }, { id: 'c', name: 'cat', avatar: 'cat', color: 'orange' }]).map((bot, index) => <View key={bot.id} style={{ marginTop: index % 2 ? 16 : 0 }}><Avatar bot={bot} size={index === 0 ? 70 : 58} /></View>)}</View>
      <Text style={styles.emptyTitle}>{bots.length ? 'Escolha uma conversa à esquerda.' : 'Monte seu time.'}</Text>
      <Text style={styles.emptyText}>{bots.length ? 'As respostas, aprovações e pendências chegam aqui ao vivo, do celular e do computador.' : 'Cada bot cuida de uma parte da sua vida. Você decide o que cada um pode fazer.'}</Text>
      {!bots.length ? <PrimaryButton icon="plus" title="Criar meu primeiro bot" onPress={onCreate} disabled={!data.models?.length} style={{ marginTop: 18, alignSelf: 'stretch' }} /> : null}
    </View>
  </ScrollView>;
}

export function TodayPanel({ data, onOpen, onRespond, approvalBusy, onComplete, onActivity }) {
  const name = id => data.bots?.find(bot => bot.id === id)?.name || '';
  const items = (data.pendingItems || []).filter(item => item.state === 'open').sort((a, b) => (a.due || '9').localeCompare(b.due || '9')).slice(0, 8);
  const routines = (data.routines || []).filter(item => item.enabled && item.nextRunAt).sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt)).slice(0, 4);
  // What a bot did (tools, approvals, routines, files, failures), not every step of each reply.
  const activity = (data.activity || []).filter(item => name(item.bot_id) && !/^task_(queued|running|done|waiting_approval)$/.test(item.kind)).slice(0, 8);
  return <ScrollView style={styles.today2} contentContainerStyle={{ padding: 16, paddingBottom: 30, gap: 4 }}>
    <Text style={styles.todayTitle}>Hoje</Text>
    {(data.approvals || []).length ? <><Text style={styles.sideSectionText}>ESPERANDO VOCÊ</Text>
      {data.approvals.map(approval => <ApprovalCard key={approval.id} approval={approval} bot={data.bots.find(bot => bot.id === approval.botId)} onRespond={onRespond} busy={approvalBusy === approval.id} />)}</> : null}
    <Text style={[styles.sideSectionText, styles.todaySpace]}>PENDÊNCIAS</Text>
    {items.length ? items.map(item => <View key={item.id} style={styles.todayRow}>
      <Pressable accessibilityRole="checkbox" accessibilityLabel={`Concluir ${item.title}`} onPress={() => onComplete(item.id)} hitSlop={6} style={styles.todayCheck} />
      <Pressable style={{ flex: 1 }} onPress={() => onOpen(item.botId)}>
        <Text style={styles.todayRowTitle} numberOfLines={2}>{item.course ? `${item.course} · ` : ''}{item.title}</Text>
        <Text style={styles.todayRowMeta} numberOfLines={1}>{[item.dueLabel && `prazo ${item.dueLabel}`, name(item.botId)].filter(Boolean).join(' · ')}</Text></Pressable>
    </View>) : <Text style={styles.todayEmpty}>Nenhuma pendência aberta.</Text>}
    <Text style={[styles.sideSectionText, styles.todaySpace]}>PRÓXIMAS ROTINAS</Text>
    {routines.length ? routines.map(item => <Pressable key={item.id} onPress={() => onOpen(item.botId)} style={styles.todayRow}><Icon name="bolt" size={15} color={C.sky} />
      <View style={{ flex: 1 }}><Text style={styles.todayRowTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.todayRowMeta} numberOfLines={1}>{new Date(item.nextRunAt).toLocaleString('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })} · {name(item.botId)}</Text></View></Pressable>)
      : <Text style={styles.todayEmpty}>Nenhuma rotina marcada.</Text>}
    <View style={[styles.sideSection, styles.todaySpace]}><Text style={styles.sideSectionText}>ATIVIDADE</Text><Pressable onPress={onActivity} hitSlop={8}><Text style={styles.todayMore}>Ver tudo</Text></Pressable></View>
    {activity.map(item => <View key={item.id} style={styles.todayActivity}>
      <Text style={styles.todayRowMeta}>{shortTime(item.created_at)} · {name(item.bot_id)}</Text>
      <Text style={styles.todayActivityText} numberOfLines={2}>{item.detail}</Text></View>)}
  </ScrollView>;
}

export function ModeSheet({ visible, mode, onClose, onSelect }) {
  const options = [['computer', 'Celular + computador', 'O app fica no celular; o Codex e o histórico ficam no PC.', 'wifi'],
    ['phone', 'Só no celular', termuxAvailable ? 'O Codex ou o Claude rodam no Termux e tudo fica neste celular. Na primeira vez, permita apps externos no Termux.' : 'Requer o APK próprio do MyBots; o Expo Go não inclui a ponte Android.', 'phone']];
  return <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
    <Pressable style={styles.sheetBackdrop} onPress={onClose}>
      <Pressable style={styles.sheet} onPress={event => event.stopPropagation()}>
        <View style={styles.sheetHandle} />
        <SheetHeader title="Onde o MyBots roda?" subtitle="Escolha onde as IAs trabalham e onde as conversas ficam salvas." onClose={onClose} />
        {options.map(([value, title, detail, icon]) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: mode === value }} onPress={() => onSelect(value)} style={[styles.modeOption, styles.rowOption, mode === value && styles.optionChosen]}>
          <View style={styles.rowIcon}><Icon name={icon} size={19} color={mode === value ? C.mint : C.muted} /></View>
          <View style={{ flex: 1 }}><Text style={[styles.optionLabel, mode === value && styles.optionLabelChosen]}>{title}</Text><Text style={styles.optionDetail}>{detail}</Text></View>
          {mode === value ? <Icon name="check" size={18} color={C.mint} stroke={2.4} /> : null}
        </Pressable>)}
      </Pressable>
    </Pressable>
  </Modal>;
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
    <Text style={[styles.optionDetail, { marginTop: 8 }]}>SMS, contatos, chamadas, localização, bateria e as notificações que os bots mandam usam o Termux:API. Na primeira vez que um bot usar cada um, o Android pede a permissão.</Text>
    <BotNoticeStatus lastPoll={lastPoll} />
    <TermuxApiStatus />
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
    <Text style={styles.optionDetail}>{on ? 'Bots no nível Livre podem ver a tela e usar os outros apps quando você pede. Enquanto isso, uma barra com Parar fica no topo da tela e uma notificação fixa aparece. Apps de banco costumam recusar: nesses, o bot chama você.'
      : status.enabled ? 'O serviço está ligado, mas o Android ainda não o iniciou. Desligue e ligue de novo em Acessibilidade.'
      : 'Só bots no nível Livre usam. Para ligar: toque em Ligar o controle, procure MyBots (em Apps instalados ou Serviços baixados) e ative.'}</Text>
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
    <Text style={styles.optionDetail}>{!allowed ? 'O Android está bloqueando as notificações do MyBots, então elas saem pelo Termux:API (sem abrir a conversa ao tocar). Libere em Notificações do MyBots.'
      : recent ? 'Chegam como MyBots, aparecem na tela e abrem a conversa do bot ao tocar.'
      : 'Com o app fechado, o HyperOS pode parar o MyBots e o aviso sai pelo Termux:API. Para evitar: Configurações → Apps → MyBots → Economia de bateria: Sem restrições, e ligue o Início automático.'}</Text>
    <View style={styles.appActions}>
      {!allowed ? <Pressable onPress={() => notificationPermission().then(check).then(() => openNotificationSettings()).catch(() => {})}><Text style={styles.deleteText}>Liberar notificações do MyBots</Text></Pressable> : null}
      {allowed && !recent ? <Pressable onPress={() => openAppSettings('com.mybots.app').catch(() => {})}><Text style={styles.deleteText}>Abrir configurações do MyBots</Text></Pressable> : null}
    </View>
  </View>;
}

export function TermuxApiStatus() {
  const [api, setApi] = useState(null);
  const check = useCallback(() => { termuxApiStatus().then(setApi).catch(() => setApi(null)); }, []);
  useEffect(() => { check(); const subscription = AppState.addEventListener('change', state => { if (state === 'active') check(); }); return () => subscription.remove(); }, [check]);
  if (!api) return null;
  const ok = api.installed && api.sameSigner && api.enabled;
  return <View style={styles.appRow}>
    <Text style={styles.optionLabel}>Termux:API · {ok ? 'Pronto' : !api.installed ? 'App não instalado' : !api.sameSigner ? 'Fonte diferente do Termux' : 'Desativado'}</Text>
    <Text style={styles.optionDetail}>{!api.installed ? 'Instale o app Termux:API do mesmo lugar de onde veio o Termux (F-Droid ou GitHub). Só o comando pkg install termux-api não basta.'
      : !api.sameSigner ? 'O Termux e o Termux:API vieram de lugares diferentes (por exemplo F-Droid e GitHub/Play Store) e o Android não deixa um falar com o outro. Desinstale o Termux:API e instale do mesmo lugar do Termux.'
      : !api.enabled ? 'O Termux:API está desativado nas configurações do Android.'
      : 'Se um bot disser que a notificação demorou: abra o Termux:API uma vez, permita notificações e, no HyperOS/MIUI, ligue o Início automático e tire a economia de bateria dele.'}</Text>
    {api.installed ? <Pressable onPress={() => openAppSettings('com.termux.api').catch(() => {})} style={{ marginTop: 6 }}><Text style={styles.deleteText}>Abrir configurações do Termux:API</Text></Pressable> : null}
  </View>;
}

export function RemoteAccess({ tailscale }) {
  return <View style={{ marginTop: 10 }}>
    <Text style={styles.optionDetail}>{tailscale ? 'Tailscale detectado no PC. Para conectar de qualquer lugar, mantenha o Tailscale ligado nos dois aparelhos, na mesma conta.' : 'Sem Tailscale detectado no PC. No mesmo Wi-Fi, o celular procura o computador sozinho. Para usar de qualquer lugar, instale o Tailscale nos dois aparelhos e entre na mesma conta.'}</Text>
    {!tailscale ? <Pressable accessibilityRole="link" onPress={() => Linking.openURL('https://tailscale.com/download')} style={styles.stopButton}><Text style={[styles.stopText, { color: C.mint }]}>Instalar Tailscale</Text></Pressable> : null}
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
  if (!notice) return <RemoteAccess tailscale={status.tailscale} />;
  if (status.phone || !status.offlineSince || now - status.offlineSince < 120000) return null;
  return <View style={[styles.modeOption, { margin: 12, flexShrink: 1 }]}>
    <Text style={styles.optionLabel}>O celular não encontrou este computador</Text>
    <Text style={styles.optionDetail}>O computador mudou de rede? O celular procura sozinho no mesmo Wi-Fi; se não achar, mostre o QR. Em redes diferentes, use o Tailscale.</Text>
    <DesktopPair call={call} />
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
  const show = async () => {
    setBusy(true); setNote('');
    try { const result = await call('desktop.pair'); setQr({ ...result, shownAt: new Date(Date.now() - 1000).toISOString() }); }
    catch (error) { setNote(error.message); } finally { setBusy(false); }
  };
  return <View style={[styles.modeOption, compact && { alignSelf: 'stretch', marginTop: 18 }]}>
    <Text style={styles.optionLabel}>Parear um celular</Text>
    <DesktopNetwork call={call} />
    <Text style={styles.optionDetail}>No celular, abra o MyBots → Ajustes → Computador → Conectar computador e aponte a câmera para o QR. Ele vale por 10 minutos e uma vez só.</Text>
    {qr ? <View style={styles.pairQr}><View accessibilityLabel="QR para parear o celular"><SvgXml xml={qr.svg} width={260} height={260} /></View>
      <Text style={styles.limitMeta}>Esperando o celular ler…</Text></View> : null}
    <View style={{ flexDirection: 'row', gap: 14, marginTop: 10 }}>
      <Pressable accessibilityRole="button" disabled={busy} onPress={qr ? () => setQr(null) : show} style={styles.stopButton}><Icon name={qr ? 'close' : 'phone'} size={13} color={C.mint} /><Text style={[styles.stopText, { color: C.mint }]}>{qr ? 'Esconder QR' : busy ? 'Gerando…' : 'Mostrar QR'}</Text></Pressable>
    </View>
    {note ? <Text style={[styles.optionDetail, /pareado/.test(note) ? { color: C.mint } : { color: C.amber }]}>{note}</Text> : null}
  </View>;
}

export function ComputerPanel({ computer, nodes = [], onPair, onForget, onRetry }) {
  const [scanning, setScanning] = useState(false); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const [permission, requestPermission] = useCameraPermissions(); const reading = useRef(false);
  const node = nodes.find(item => item.id === computer?.id);
  const logged = Object.entries(node?.connections || {}).filter(([, value]) => value.loggedIn).map(([key]) => key === 'claude' ? 'Claude' : 'Codex');
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
    <RemoteAccess tailscale={computer?.tailscale} />
    {computer?.paired ? <View style={styles.passwordRow}>
      <View style={styles.rowIcon}><Icon name="laptop" size={17} color={computer.state === 'online' ? C.mint : C.faint} /></View>
      <View style={{ flex: 1 }}><Text style={styles.limitName}>{state}</Text>{computer.error && computer.state !== 'online' ? <Text style={[styles.limitMeta, { color: C.amber }]}>{computer.error}</Text> : null}</View>
    </View> : <Text style={styles.optionDetail}>Com o computador ligado, os bots que vivem nele ficam online e respondem de lá, usando o Claude ou o Codex do computador. No computador, rode node pc/node.mjs pair e leia o QR que aparecer.</Text>}
    <View style={{ flexDirection: 'row', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
      <Pressable accessibilityRole="button" disabled={busy} onPress={scan} style={styles.stopButton}><Icon name="laptop" size={13} color={C.mint} /><Text style={[styles.stopText, { color: C.mint }]}>{computer?.paired ? 'Parear de novo' : 'Conectar computador'}</Text></Pressable>
      {computer?.paired && computer.state !== 'online' ? <Pressable accessibilityRole="button" onPress={() => onRetry().catch(() => {})} style={styles.stopButton}><Icon name="refresh" size={13} color={C.muted} /><Text style={styles.stopText}>Tentar agora</Text></Pressable> : null}
      {computer?.paired ? <Pressable accessibilityRole="button" onPress={forget} style={styles.stopButton}><Icon name="trash" size={13} color={C.muted} /><Text style={styles.stopText}>Esquecer</Text></Pressable> : null}
    </View>
    {note ? <Text style={[styles.optionDetail, /conectado/.test(note) ? { color: C.mint } : /Conectando/.test(note) ? null : { color: C.amber }]}>{note}</Text> : null}
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

export function PasswordsPanel({ bots }) {
  const [list, setList] = useState([]); const [form, setForm] = useState(null); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const load = () => passwordsList().then(setList).catch(error => setNote(nativeMessage(error)));
  useEffect(() => { load(); }, []);
  const field = (key, value) => setForm(old => ({ ...old, [key]: value }));
  const save = async () => {
    setBusy(true); setNote('');
    try { await passwordSave(form.site, form.username || '', form.password || '', form.bots?.length ? form.bots : null); setForm(null); setNote('Senha salva. Os bots escolhidos já podem entrar nesse site.'); await load(); }
    catch (error) { setNote(nativeMessage(error)); } finally { setBusy(false); }
  };
  const remove = item => Alert.alert(`Apagar a senha de ${item.host}?`, 'Os bots deixam de entrar sozinhos nesse site.', [{ text: 'Cancelar', style: 'cancel' },
    { text: 'Apagar', style: 'destructive', onPress: () => passwordDelete(item.id).then(load).catch(error => setNote(nativeMessage(error))) }]);
  const names = ids => ids ? ids.map(id => bots.find(bot => bot.id === id)?.name).filter(Boolean).join(', ') || 'bot apagado' : 'todos os bots';
  // A password export (Chrome: chrome://password-manager → Configurações → Exportar senhas). The app reads it natively.
  const importFile = async () => {
    setBusy(true); setNote('');
    try {
      const result = await passwordImport(form?.bots?.length ? form.bots : null); if (!result) return;
      await load(); setForm(null);
      setNote(`${result.imported} ${result.imported === 1 ? 'senha importada' : 'senhas importadas'}${result.skipped ? ` (${result.skipped} sem site ou senha ficaram de fora)` : ''}. Os bots escolhidos já podem entrar nesses sites.`);
      Alert.alert('Apagar o arquivo exportado?', `${result.name} tem todas as suas senhas sem proteção. Elas já estão guardadas no MyBots.`, [{ text: 'Manter', style: 'cancel' },
        { text: 'Apagar arquivo', style: 'destructive', onPress: () => passwordImportDelete().then(done => setNote(old => old + (done ? ' Arquivo apagado.' : ' Não consegui apagar o arquivo; apague pelo gerenciador de arquivos.'))).catch(() => {}) }]);
    } catch (error) { setNote(nativeMessage(error)); } finally { setBusy(false); }
  };
  return <View style={styles.modeOption}>
    <Text style={styles.optionLabel}>Senhas de sites</Text>
    <Text style={styles.optionDetail}>O bot entra sozinho (ex.: no SIGAA) com a senha salva aqui. Ela fica protegida neste celular e só é preenchida no site em que foi salva; a IA nunca vê a senha. Dica: entre uma vez pelo Assumir do navegador do bot e toque em Salvar.</Text>
    {list.map(item => <View key={item.id} style={styles.passwordRow}>
      <View style={styles.rowIcon}><Icon name="key" size={17} color={C.mint} /></View>
      <View style={{ flex: 1 }}><Text style={styles.limitName} numberOfLines={1}>{item.host}</Text><Text style={styles.limitMeta} numberOfLines={1}>{item.username || 'sem usuário'} · {names(item.bots)}</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Apagar a senha de ${item.host}`} hitSlop={10} onPress={() => remove(item)}><Icon name="trash" size={17} color={C.faint} /></Pressable>
    </View>)}
    {form ? <View style={{ marginTop: 6 }}>
      {form.importing ? <Text style={styles.optionDetail}>No Chrome: Gerenciador de senhas → Configurações → Exportar senhas, e escolha o arquivo aqui. Também aceita CSV do Firefox, Bitwarden e 1Password. Só entram logins de sites (http/https); um site e usuário já salvo fica com a senha nova.</Text> : <>
      <TextInput style={styles.formInput} placeholder="Site (ex.: sig.cefetmg.br)" placeholderTextColor="#6F7787" autoCapitalize="none" autoCorrect={false} keyboardType="url" value={form.site || ''} onChangeText={value => field('site', value)} />
      <TextInput style={styles.formInput} placeholder="Usuário (CPF, matrícula ou e-mail)" placeholderTextColor="#6F7787" autoCapitalize="none" autoCorrect={false} value={form.username || ''} onChangeText={value => field('username', value)} />
      <TextInput style={styles.formInput} placeholder="Senha" placeholderTextColor="#6F7787" autoCapitalize="none" autoCorrect={false} secureTextEntry value={form.password || ''} onChangeText={value => field('password', value)} /></>}
      <Text style={[styles.limitMeta, { marginTop: 10 }]}>Quais bots podem usar</Text>
      <View style={styles.shareFiles}>
        {[{ id: null, name: 'Todos' }, ...bots].map(bot => { const all = !form.bots?.length; const on = bot.id ? form.bots?.includes(bot.id) : all; return <Pressable key={bot.id || 'all'} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
          onPress={() => field('bots', bot.id ? (on ? form.bots.filter(id => id !== bot.id) : [...(form.bots || []), bot.id]) : [])} style={[styles.botChoice, on && styles.botChoiceOn]}><Text style={[styles.botChoiceText, on && { color: C.mint }]}>{bot.name}</Text></Pressable>; })}
      </View>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
        <Pressable accessibilityRole="button" onPress={() => setForm(null)} style={[styles.denyButton, { flex: 1 }]}><Text style={styles.denyText}>Cancelar</Text></Pressable>
        {form.importing ? <PrimaryButton compact icon="download" title={busy ? 'Importando…' : 'Escolher arquivo'} disabled={busy} onPress={importFile} style={{ flex: 1.4 }} />
          : <PrimaryButton compact icon="check" title={busy ? 'Salvando…' : 'Salvar senha'} disabled={busy || !form.site || !form.password} onPress={save} style={{ flex: 1.4 }} />}
      </View>
    </View> : <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
      <Pressable accessibilityRole="button" onPress={() => { setNote(''); setForm({}); }} style={styles.stopButton}><Icon name="plus" size={13} color={C.mint} /><Text style={[styles.stopText, { color: C.mint }]}>Adicionar senha</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => { setNote(''); setForm({ importing: true }); }} style={styles.stopButton}><Icon name="download" size={13} color={C.mint} /><Text style={[styles.stopText, { color: C.mint }]}>Importar CSV</Text></Pressable>
    </View>}
    {note ? <Text style={[styles.optionDetail, /salva|importada/.test(note) ? { color: C.mint } : { color: C.amber }]}>{note}</Text> : null}
  </View>;
}

export function PasswordOfferCard({ offer, bot, onAnswer }) {
  const [busy, setBusy] = useState(false);
  const answer = async scope => { setBusy(true); try { await onAnswer(scope); } finally { setBusy(false); } };
  return <View style={[styles.updateCard, { marginTop: 4 }]}>
    <View style={styles.updateHead}><View style={styles.updateIcon}><Icon name="key" size={18} color={C.mint} /></View>
      <View style={{ flex: 1 }}><Text style={styles.optionLabel}>Salvar a senha de {offer.host}?</Text>
        <Text style={styles.optionDetail}>{offer.username ? `Usuário ${offer.username}. ` : ''}Assim {bot.name} entra sozinho da próxima vez. A IA nunca vê a senha.</Text></View></View>
    <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => answer('dismiss')} style={[styles.denyButton, { flex: 1 }]}><Text style={styles.denyText}>Agora não</Text></Pressable>
      <PrimaryButton compact icon="check" title={`Para ${bot.name}`} disabled={busy} onPress={() => answer('bot')} style={{ flex: 1.3 }} />
    </View>
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => answer('all')} style={styles.alwaysButton}><Text style={[styles.alwaysText, { color: C.mint }]}>Salvar para todos os bots</Text></Pressable>
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
    <View style={styles.rowIcon}><Icon name="bots" size={19} color={C.mint} /></View>
    <View style={{ flex: 1 }}><Text style={styles.optionLabel}>Widget na tela inicial</Text>
      <Text style={styles.optionDetail}>{status?.placed ? `${status.placed > 1 ? status.placed + ' widgets' : 'Um widget'} na tela inicial, com seus bots ao vivo.` : 'Seus bots animados na tela inicial: quem trabalha, quem espera você e o próximo prazo.'}</Text>
      {note ? <Text style={[styles.optionDetail, { color: C.amber }]}>{note}</Text> : null}</View>
    {status?.canPin !== false ? <Pressable accessibilityRole="button" onPress={add} style={styles.stopButton}><Icon name="plus" size={13} color={C.mint} /><Text style={[styles.stopText, { color: C.mint }]}>{status?.placed ? 'Outro' : 'Adicionar'}</Text></Pressable> : null}
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
    <TextInput accessibilityLabel="Seu nome" style={styles.formInput} placeholder="Como quer ser chamado?" placeholderTextColor="#6F7787" maxLength={40}
      autoCapitalize="words" autoCorrect={false} returnKeyType="done" value={value} onChangeText={setValue} onBlur={save} onSubmitEditing={save} selectionColor={C.mint} />
    {state ? <Text style={[styles.optionDetail, state.length > 6 && state !== 'saving' && { color: C.amber }]}>{state === 'saving' ? 'Salvando…' : state === 'saved' ? 'Salvo.' : state}</Text> : null}
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
    { ok: status.termuxBatteryUnrestricted, label: 'Bateria do Termux sem restrições', actions: [['Abrir', status.xiaomi ? 'termuxBattery' : 'termuxDetails']] },
    { ok: status.exactAlarms, label: 'Alarmes no horário exato (rotinas)', actions: [['Permitir', 'exactAlarm']] },
    { ok: !status.backgroundRestricted, label: 'Atividade em segundo plano permitida', actions: [['Abrir', 'details']] },
  ];
  return <View style={styles.modeOption}>
    <Text style={styles.optionLabel}>Funcionar com a tela apagada · {state}</Text>
    <Text style={styles.optionDetail}>{status.enabled
      ? 'Uma notificação discreta “MyBots ativo” mantém as rotinas e os avisos funcionando, acorda o celular no horário de cada rotina e reinicia o supervisor no Termux se ele parar.'
      : 'Desligado: com a tela apagada o Android pode pausar o Termux, e rotinas e avisos atrasam até você abrir o MyBots.'}</Text>
    {status.enabled ? <Text style={[styles.optionDetail, { marginTop: 6 }]}>Último sinal do supervisor: {when(heartbeat)} · Última verificação: {when(status.lastCheckAt)}{status.nextAlarmAt ? ` · Próximo despertar: ${when(status.nextAlarmAt)}` : ''}{nextRoutineAt ? ` · Próxima rotina ou aviso: ${when(nextRoutineAt)}` : ''}</Text> : null}
    {status.enabled && status.lastRestartAt ? <Text style={styles.optionDetail}>Último reinício pelo MyBots: {when(status.lastRestartAt)}{status.restartMessage ? ` · ${status.restartMessage}` : ''}</Text> : null}
    {status.enabled && !status.running && status.startError ? <Text style={styles.optionDetail}>O Android não deixou o serviço iniciar em segundo plano. Libere a bateria abaixo e abra o MyBots de novo.</Text> : null}
    {status.enabled ? checks.map(item => <View key={item.label} style={styles.appRow}>
      <Text style={styles.optionDetail}>{item.ok ? '✓' : '!'}  {item.label}</Text>
      {!item.ok ? <View style={styles.appActions}>{item.actions.map(([title, target]) => <Pressable key={target} onPress={() => open(target)}><Text style={styles.deleteText}>{title}</Text></Pressable>)}</View> : null}
    </View>) : null}
    {status.enabled && status.xiaomi ? <View style={styles.appRow}>
      <Text style={styles.optionDetail}>No HyperOS ligue também o Início automático do MyBots e do Termux (o sistema não informa se está ligado).</Text>
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

export function UsagePanel({ usage, bots, connections, onRefresh }) {
  const [busy, setBusy] = useState(null); const [note, setNote] = useState({});
  const refresh = async provider => {
    setBusy(provider); setNote(old => ({ ...old, [provider]: '' }));
    try { await onRefresh(provider); } catch (error) { setNote(old => ({ ...old, [provider]: nativeMessage(error) })); } finally { setBusy(null); }
  };
  // A connected IA without windows yet (Claude only reports them with a reply) gets a card that explains it.
  const missing = ['codex', 'claude'].filter(provider => connections?.[provider]?.loggedIn && !usage?.limits?.[provider]);
  const limits = Object.entries(usage?.limits || {});
  const rows = Object.entries(usage?.bots || {}).map(([id, value]) => ({ bot: bots.find(item => item.id === id), ...value })).filter(row => row.bot && row.week.turns)
    .sort((a, b) => (b.week.input + b.week.output) - (a.week.input + a.week.output));
  const days = usage?.days || []; const peak = Math.max(1, ...days.map(day => day.input + day.output));
  const total = rows.reduce((sum, row) => sum + row.week.input + row.week.output, 0);
  const refreshButton = provider => <Pressable accessibilityRole="button" disabled={Boolean(busy)} onPress={() => refresh(provider)} style={styles.stopButton}>
    {busy === provider ? <ActivityIndicator size="small" color={C.mint} /> : <Icon name="refresh" size={13} color={C.mint} />}<Text style={[styles.stopText, { color: C.mint }]}>{busy === provider ? 'Consultando' : 'Consultar agora'}</Text></Pressable>;
  return <>
    {!limits.length && !rows.length && !missing.length ? <View style={styles.modeOption}><Text style={styles.optionLabel}>Uso</Text><Text style={styles.optionDetail}>Depois das primeiras respostas aparecem aqui os tokens de cada bot e quanto do limite da sua assinatura já foi usado.</Text></View> : null}
    {missing.map(provider => <View key={provider} style={styles.modeOption}>
      <Text style={styles.optionLabel}>{PLAN_NAMES[provider]} · limite da assinatura</Text>
      <Text style={styles.optionDetail}>{provider === 'claude' ? 'O Claude só informa o limite junto de uma resposta. Aparece aqui depois que um bot com Claude responder, ou consulte agora com uma resposta curtinha do Haiku.' : 'Ainda não consultado.'}</Text>
      {note[provider] ? <Text style={[styles.optionDetail, { color: C.amber }]}>{note[provider]}</Text> : null}
      <View style={{ alignItems: 'flex-start', marginTop: 10 }}>{refreshButton(provider)}</View>
    </View>)}
    {limits.map(([provider, item]) => <View key={provider} style={styles.modeOption}>
      <Text style={styles.optionLabel}>{PLAN_NAMES[provider]}{item.plan ? ` ${item.plan[0].toUpperCase()}${item.plan.slice(1)}` : ''} · limite da assinatura</Text>
      {item.windows.map(window => { const tone = window.used >= 90 ? C.red : window.used >= 70 ? C.amber : C.mint; return <View key={window.key} style={styles.limitRow}>
        <View style={styles.limitHead}><Text style={styles.limitName}>{WINDOW_NAMES[window.key] || window.key}</Text><Text style={[styles.limitValue, { color: tone }]}>{window.used}% usado</Text></View>
        <View style={styles.updateBar}><View style={[styles.updateFill, { width: `${Math.max(2, window.used)}%`, backgroundColor: tone }]} /></View>
        <Text style={styles.limitMeta}>{resetLabel(window.resetsAt)}</Text>
      </View>; })}
      <Text style={styles.limitMeta}>Atualizado {new Date(item.checkedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · vale para tudo que usa esta conta, não só o MyBots.</Text>
      {note[provider] ? <Text style={[styles.optionDetail, { color: C.amber }]}>{note[provider]}</Text> : null}
      {connections?.[provider]?.loggedIn ? <View style={{ alignItems: 'flex-start', marginTop: 10 }}>{refreshButton(provider)}</View> : null}
    </View>)}
    {rows.length ? <View style={styles.modeOption}>
      <View style={styles.limitHead}><Text style={styles.optionLabel}>Tokens nos últimos 7 dias</Text><Text style={styles.limitValue}>{tokensLabel(total)}</Text></View>
      <Text style={styles.limitMeta}>Só os bots do MyBots. A cada passo de uma resposta (cada ferramenta usada) a IA relê a conversa e as ferramentas; a parte em cache custa bem menos do limite.</Text>
      <View style={styles.usageChart}>{days.map(day => { const value = day.input + day.output; return <View key={day.date} style={styles.usageDay}>
        <View style={styles.usageTrack}><View style={[styles.usageColumn, { height: `${Math.max(value ? 4 : 0, value / peak * 100)}%` }]} /></View>
        <Text style={styles.usageDayText}>{new Date(day.date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'narrow' }).toUpperCase()}</Text>
      </View>; })}</View>
      {rows.map(row => { const value = row.week.input + row.week.output; return <View key={row.bot.id} style={styles.usageBot}>
        <Avatar bot={row.bot} size={34} tile={false} animated={false} />
        <View style={{ flex: 1 }}>
          <View style={styles.limitHead}><Text style={styles.limitName} numberOfLines={1}>{row.bot.name}</Text><Text style={styles.limitValue}>{tokensLabel(value)}</Text></View>
          <View style={styles.usageShare}><View style={[styles.usageShareFill, { width: `${Math.max(2, value / Math.max(1, total) * 100)}%`, backgroundColor: HUE_OF(row.bot) }]} /></View>
          <Text style={styles.limitMeta}>{row.week.turns} {row.week.turns > 1 ? 'respostas' : 'resposta'} · {tokensLabel(row.week.input)} processados ({Math.round(row.week.cached / Math.max(1, row.week.input) * 100)}% em cache) · {tokensLabel(row.week.output)} escritos · hoje {tokensLabel(row.today.input + row.today.output)}</Text>
        </View>
      </View>; })}
    </View> : null}
  </>;
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

export const EMAIL_STATUS = { connected: 'Conectado', syncing: 'Sincronizando…', auth_error: 'Reconectar conta', offline: 'Sem rede', locked: 'Bloqueado', unavailable: 'Instalando conector', error: 'Erro', disconnected: 'Desconectado' };

export function EmailConnection({ email, busy, onAction }) {
  const [form, setForm] = useState(null);
  const field = (key, value) => setForm(old => ({ ...old, [key]: value }));
  const known = /@(gmail|googlemail|outlook|hotmail|live|yahoo|icloud)\.com$/i.test(form?.address || '');
  return <View style={styles.modeOption}>
    <Text style={styles.optionLabel}>E-mail · {EMAIL_STATUS[email?.status] || 'Desconectado'}</Text>
    <Text style={styles.optionDetail}>{email?.configured ? `${email.address}${email.lastSync ? ` · sincronizado ${new Date(email.lastSync).toLocaleString('pt-BR')}` : ''}\n${email.message || ''}` : 'Os bots podem buscar e ler e-mails (somente leitura) quando você permitir no perfil de cada um.'}</Text>
    {form ? <View style={{ gap: 8, marginTop: 10 }}>
      <TextInput style={styles.formInput} placeholder="seu@gmail.com" placeholderTextColor="#6F7787" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" value={form.address} onChangeText={value => field('address', value)} />
      <TextInput style={styles.formInput} placeholder="Senha de app (16 letras)" placeholderTextColor="#6F7787" autoCapitalize="none" autoCorrect={false} secureTextEntry value={form.password} onChangeText={value => field('password', value)} />
      {!known && form.address?.includes('@') ? <TextInput style={styles.formInput} placeholder="Servidor IMAP (ex.: imap.seuprovedor.com)" placeholderTextColor="#6F7787" autoCapitalize="none" autoCorrect={false} value={form.host} onChangeText={value => field('host', value)} /> : null}
      <Text style={styles.optionDetail}>No Gmail: Conta Google → Segurança → Verificação em duas etapas → Senhas de app. Use essa senha, nunca a senha normal. Ela fica cifrada no celular.</Text>
      <PrimaryButton title={busy ? 'Conectando…' : 'Conectar'} disabled={busy || !form.address || !form.password} onPress={() => { onAction('email.configure', { address: form.address, password: form.password, ...(form.host ? { host: form.host } : {}) }); setForm(null); }} />
      <Pressable onPress={() => setForm(null)} style={styles.closeSheet}><Text style={styles.closeSheetText}>Cancelar</Text></Pressable>
    </View> : <View style={{ flexDirection: 'row', gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
      <Pressable disabled={busy} onPress={() => setForm({ address: email?.address || '', password: '' })}><Text style={styles.deleteText}>{email?.configured ? 'Reconectar' : 'Conectar e-mail'}</Text></Pressable>
      {email?.configured ? <Pressable disabled={busy} onPress={() => onAction('email.sync')}><Text style={styles.deleteText}>Sincronizar agora</Text></Pressable> : null}
      {email?.configured ? <Pressable disabled={busy} onPress={() => onAction('email.disconnect')}><Text style={styles.deleteText}>Desconectar</Text></Pressable> : null}
    </View>}
  </View>;
}

export const CONNECTOR_PAGES = { claude: 'https://claude.ai/settings/connectors', codex: 'https://chatgpt.com/#settings/Connectors' };

export function AccountConnections({ load }) {
  const [state, setState] = useState(null); const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const loader = useRef(load); loader.current = load;
  const refresh = useCallback(async (force = false) => {
    setLoading(true); setError('');
    try { setState(await loader.current(force)); } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(false); }, [refresh]);
  useEffect(() => { const subscription = AppState.addEventListener('change', value => { if (value === 'active') refresh(true); }); return () => subscription.remove(); }, [refresh]);
  return <View style={styles.modeOption}>
    <Text style={styles.optionLabel}>Apps da sua conta</Text>
    <Text style={styles.optionDetail}>Gmail, Agenda, Drive e outros conectados direto na sua conta do Claude ou do ChatGPT, com o login oficial do Google. Depois, ligue “Apps da sua conta” no perfil de cada bot.</Text>
    <View style={styles.appRow}>
      <Text style={styles.optionLabel}>Claude</Text>
      {state?.claude ? state.claude.length ? state.claude.map(item => <Text key={item.name} style={styles.optionDetail}>{item.connected ? '✓' : item.needsAuth ? '!' : '○'}  {item.name}{item.needsAuth ? ' · entrar de novo' : item.connected ? '' : ' · indisponível'}</Text>)
        : <Text style={styles.optionDetail}>Nenhum conector ainda.</Text>
        : <Text style={styles.optionDetail}>{loading ? 'Consultando…' : state?.claudeError || error || 'Entre no Claude no Termux para ver os conectores.'}</Text>}
      <Pressable onPress={() => Linking.openURL(CONNECTOR_PAGES.claude)}><Text style={styles.deleteText}>＋ Conectar apps no Claude</Text></Pressable>
    </View>
    <View style={styles.appRow}>
      <Text style={styles.optionLabel}>ChatGPT (Codex)</Text>
      <Text style={styles.optionDetail}>{state?.codex ? 'Os bots do Codex usam os apps da sua conta do ChatGPT para ler. Ações que alteram algo ficam bloqueadas por enquanto.' : 'Entre no Codex no Termux para usar os apps do ChatGPT.'}</Text>
      <Pressable onPress={() => Linking.openURL(CONNECTOR_PAGES.codex)}><Text style={styles.deleteText}>＋ Conectar apps no ChatGPT</Text></Pressable>
    </View>
    <Pressable disabled={loading} onPress={() => refresh(true)} style={{ marginTop: 8 }}><Text style={styles.deleteText}>{loading ? 'Atualizando…' : 'Atualizar'}</Text></Pressable>
  </View>;
}

export function AppConnections({ apps = [], busy, onAction }) {
  const [form, setForm] = useState(null); const [open, setOpen] = useState(apps.length > 0);
  if (!open) return <Pressable onPress={() => setOpen(true)} style={styles.modeOption}><Text style={styles.optionDetail}>Avançado · conectar um servidor MCP próprio ▾</Text></Pressable>;
  const field = (key, value) => setForm(old => ({ ...old, [key]: value }));
  return <View style={styles.modeOption}>
    <Text style={styles.optionLabel}>Servidores MCP próprios · {apps.length ? `${apps.length}` : 'nenhum'}</Text>
    <Text style={styles.optionDetail}>Para quem já tem um servidor MCP (Zapier, Composio, um seu). Cada bot só usa os que você liberar no perfil dele.</Text>
    {apps.map(app => <View key={app.id} style={styles.appRow}>
      <Text style={styles.optionLabel}>{app.status === 'connected' ? '●' : '○'}  {app.name} <Text style={styles.optionDetail}>· {app.host}</Text></Text>
      <Text style={styles.optionDetail} numberOfLines={3}>{app.status === 'connected' ? `${app.tools.length} ferramentas: ${app.tools.slice(0, 6).map(tool => tool.name).join(', ')}${app.tools.length > 6 ? '…' : ''}` : app.message}</Text>
      <View style={styles.appActions}>
        <Pressable disabled={busy} onPress={() => onAction('app.configure', { id: app.id, askAlways: !app.askAlways })}><Text style={styles.deleteText}>{app.askAlways ? '✓ Perguntar antes de ações' : 'Seguir autonomia do bot'}</Text></Pressable>
        <Pressable disabled={busy} onPress={() => onAction('app.refresh', { id: app.id })}><Text style={styles.deleteText}>Atualizar</Text></Pressable>
        <Pressable disabled={busy} onPress={() => onAction('app.remove', { id: app.id })}><Text style={styles.deleteText}>Remover</Text></Pressable>
      </View>
    </View>)}
    {form ? <View style={{ gap: 8, marginTop: 10 }}>
      <TextInput style={styles.formInput} placeholder="Nome (ex.: Composio)" placeholderTextColor="#6F7787" value={form.name} onChangeText={value => field('name', value)} maxLength={40} />
      <TextInput style={styles.formInput} placeholder="Endereço MCP (https://…)" placeholderTextColor="#6F7787" autoCapitalize="none" autoCorrect={false} keyboardType="url" value={form.url} onChangeText={value => field('url', value)} />
      <TextInput style={styles.formInput} placeholder="Cabeçalho da chave (ex.: x-api-key)" placeholderTextColor="#6F7787" autoCapitalize="none" autoCorrect={false} value={form.headerName} onChangeText={value => field('headerName', value)} />
      <TextInput style={styles.formInput} placeholder="Chave da API (opcional)" placeholderTextColor="#6F7787" autoCapitalize="none" autoCorrect={false} secureTextEntry value={form.headerValue} onChangeText={value => field('headerValue', value)} />
      <Text style={styles.optionDetail}>No Composio: crie a conta, conecte os apps que quiser (Gmail, Calendar…), gere um servidor MCP e copie o endereço e a chave da API. A chave fica cifrada no celular e nunca é mostrada aos bots.</Text>
      <PrimaryButton title={busy ? 'Conectando…' : 'Conectar app'} disabled={busy || !form.name?.trim() || !form.url?.trim()} onPress={() => { onAction('app.add', { name: form.name, url: form.url.trim(), headerName: form.headerName?.trim() || undefined, headerValue: form.headerValue || undefined }); setForm(null); }} />
      <Pressable onPress={() => setForm(null)} style={styles.closeSheet}><Text style={styles.closeSheetText}>Cancelar</Text></Pressable>
    </View> : <Pressable disabled={busy} onPress={() => setForm({ name: '', url: '', headerName: 'x-api-key', headerValue: '' })} style={{ marginTop: 8 }}><Text style={styles.deleteText}>＋ Conectar app MCP</Text></Pressable>}
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
  const available = phone || Boolean(desktop && call);
  const add = text => { if (text) setValue(old => old.trim() ? `${old.trim()} ${text}` : text); };
  useEffect(() => {
    if (!phone) return undefined;
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

export function Composer({ value, setValue, onSend, canSend, placeholder, editable = true, inputRef, onAttach, attachDisabled, phone, call, onError, accessibilityLabel }) {
  const dictation = useDictation({ phone, call, setValue, onError });
  const { voice } = dictation;
  return <View style={[styles.composerBox, voice && styles.composerListening]}>
    {voice ? <View style={styles.voiceLive}>
      <View style={styles.voiceLevels}>{[0.5, 0.8, 1, 0.7, 0.4].map((weight, index) => <View key={index} style={[styles.voiceLevel, { height: 4 + Math.round(18 * Math.max(0.15, (voice.level || 0) * weight)) }]} />)}</View>
      <Text style={[styles.voiceText, !voice.text && { color: C.muted }]} numberOfLines={4}>{dictation.label}</Text>
    </View>
    : <TextInput ref={inputRef} accessibilityLabel={accessibilityLabel} value={value} onChangeText={setValue} editable={editable}
      placeholder={placeholder} placeholderTextColor={C.faint} multiline maxLength={8000} textAlignVertical="top" style={styles.composerInput} selectionColor={C.mint}
      // On the computer, Enter sends and Shift+Enter breaks the line.
      onKeyPress={desktop ? event => { if (event.nativeEvent.key === 'Enter' && !event.nativeEvent.shiftKey) { event.preventDefault(); if (canSend) onSend(); } } : undefined} />}
    <View style={styles.composerRow}>
      {voice ? <Pressable accessibilityRole="button" accessibilityLabel="Cancelar ditado" disabled={voice.busy} onPress={dictation.cancel} style={({ pressed }) => [styles.composerTool, pressed && styles.pressed]}><Icon name="close" size={20} color={C.text2} /></Pressable>
        : onAttach ? <Pressable accessibilityRole="button" accessibilityLabel="Anexar arquivo ou foto" disabled={attachDisabled} onPress={onAttach} style={({ pressed }) => [styles.composerTool, attachDisabled && styles.sendDisabled, pressed && styles.pressed]}><Icon name="plus" size={21} color={C.text2} stroke={2} /></Pressable> : null}
      <View style={{ flex: 1 }} />
      {voice ? <Pressable accessibilityRole="button" accessibilityLabel="Parar ditado e colocar o texto na mensagem" disabled={voice.busy} onPress={dictation.stop} style={({ pressed }) => [styles.sendButton, voice.busy && styles.sendDisabled, pressed && styles.pressed]}><Icon name="check" size={20} color={C.mintInk} stroke={2.6} /></Pressable>
        : <>
          {dictation.available ? <Pressable accessibilityRole="button" accessibilityLabel="Ditar mensagem por voz" disabled={!editable} onPress={dictation.start} style={({ pressed }) => [styles.composerTool, !editable && styles.sendDisabled, pressed && styles.pressed]}><Icon name="mic" size={20} color={C.text} /></Pressable> : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Enviar mensagem" disabled={!canSend} onPress={onSend} style={({ pressed }) => [styles.sendButton, !canSend && styles.sendIdle, pressed && styles.pressed]}><Icon name="send" size={19} color={canSend ? C.mintInk : C.muted} stroke={2.6} /></Pressable>
        </>}
    </View>
  </View>;
}

export function RoomFaces({ bots, size = 40 }) {
  const shown = bots.slice(0, 3);
  return <View style={{ width: size + (shown.length - 1) * size * 0.42, height: size }}>
    {shown.map((bot, index) => <View key={bot.id} style={{ position: 'absolute', left: index * size * 0.42, top: 0, zIndex: 10 - index, borderRadius: size * 0.3, borderWidth: 2, borderColor: C.bg }}>
      <Avatar bot={bot} size={size - 4} animated={false} /></View>)}
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
      {working.length ? <View style={styles.botWorking}><Text style={[styles.botPreview, { color: C.mint }]} numberOfLines={1}>{working.join(', ')} {working.length > 1 ? 'respondendo' : 'respondendo'}</Text><Dots /></View>
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
        <Text style={styles.sheetSection}>NOME</Text>
        <TextInput accessibilityLabel="Nome da sala" style={styles.formInput} placeholder="Ex.: Faculdade e estágio" placeholderTextColor="#6F7787" maxLength={40} value={name} onChangeText={setName} selectionColor={C.mint} />
        <Text style={styles.sheetSection}>BOTS DA SALA · {picked.length}</Text>
        {bots.map(bot => { const on = picked.includes(bot.id); return <Pressable key={bot.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => setPicked(old => on ? old.filter(id => id !== bot.id) : [...old, bot.id])}
          style={({ pressed }) => [styles.modeOption, styles.rowOption, on && styles.optionChosen, pressed && styles.pressed]}>
          <Avatar bot={bot} size={40} animated={false} />
          <View style={{ flex: 1 }}><Text style={[styles.optionLabel, on && styles.optionLabelChosen]} numberOfLines={1}>{bot.name}</Text><Text style={styles.optionDetail} numberOfLines={1}>{plain(bot.instructions || '') || 'Sem descrição'}</Text></View>
          {on ? <Icon name="check" size={18} color={C.mint} stroke={2.4} /> : null}
        </Pressable>; })}
        <Text style={styles.optionDetail}>Cada bot responde com as próprias permissões e não vê a memória nem as conversas privadas dos outros. Bots podem chamar uns aos outros com @, até 3 rodadas por mensagem sua.</Text>
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
  useEffect(() => { if (termuxAvailable) publishShareTargets(targets)?.catch(() => {}); }, [key]);
  return null;
}
