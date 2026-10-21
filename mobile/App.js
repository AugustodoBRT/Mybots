import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, BackHandler, AppState, ActivityIndicator, Animated, Easing, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView,
  Linking, StatusBar, StyleSheet, Text, TextInput, View, useWindowDimensions
} from 'react-native';
import { useFonts, PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold } from '@expo-google-fonts/plus-jakarta-sans';
import { C, F, Icon } from './theme';
import { termuxAvailable, readLocalStore, writeLocalStore, runTermux, copyTermuxText, readDeviceInfo, readPairing, savePairing, readSecretsKey, readConnectorBundle, notificationAccess, openNotificationAccess, flushNotifications, supervisorParts, pickFile, termuxApiStatus, openAppSettings, microphonePermission, notificationPermission, startListening, stopListening, onSpeech, takeLaunchBot, onOpenBot, takeShare, onShare, publishShareTargets, updateCheck, updateInstall, updateCanInstall, onUpdate, widgetStatus, requestWidget, passwordsList, passwordSave, passwordDelete, passwordOffer, passwordOfferAnswer, onPasswordOffer, showBotNotification, botNotificationStatus, openNotificationSettings, keepAliveStatus, setKeepAlive, startKeepAlive, openPowerSettings, fileStage, fileAction } from './termux';
import { createId, emptyLocalStore, mergeBotLists, validateBackup } from './local';

import { createTermuxBackup } from './backup';
import BotAvatar from './BotAvatar';
import { SvgXml } from 'react-native-svg';
import { CameraView, useCameraPermissions } from 'expo-camera';
import BotProfile from './BotProfile';
import BotBrowserPanel, { BrowserHelpCard } from './BotBrowserPanel';
import { RichText, FileCard, FileChip, FileBadge, fileIcon, formatSize } from './RichMessage';
import { SupervisorClient } from './supervisor-client';
import { desktop, column, dialogBackdrop, dialogShape, noHandle } from './desktop';
import { activePhoneBots, createPhoneClient } from './phone';

const DEFAULT_API_URL = (process.env.EXPO_PUBLIC_MYBOTS_API_URL || '').replace(/\/$/, '');
const COLORS = { green: C.mint, blue: C.sky, purple: C.lilac, orange: C.peach };
const COLOR_NAMES = { green: 'Verde', blue: 'Azul', purple: 'Lilás', orange: 'Laranja' };
const EFFORT_NAMES = { none: 'Sem raciocínio', minimal: 'Mínimo', low: 'Baixo', medium: 'Médio', high: 'Alto', xhigh: 'Muito alto', max: 'Máximo', ultra: 'Ultra' };
const TERMUX_COMMANDS = { status: 'codex login status', models: 'catálogo de modelos do Codex', reply: 'codex exec / resume (mensagem pela entrada padrão)', recover: 'recuperação da resposta salva no Termux' };

// Native rejections arrive as "Call to function … has been rejected. → Caused by: …Exception: <message>".
const nativeMessage = error => String(error?.message || error).split(/Exception: /).pop().trim();
function safeLog(value) {
  return String(value || '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redigido]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|sess-[A-Za-z0-9_-]{16,}|codex_[A-Za-z0-9_-]{16,})\b/g, '[token redigido]')
    .replace(/(OPENAI_API_KEY|CODEX_ACCESS_TOKEN|access_token|refresh_token|client_secret)(\s*[:=]\s*)([^\s,;"']+)/gi, '$1$2[redigido]')
    .replace(/((?:access_token|refresh_token|client_secret|api_key)"?\s*:\s*")[^"]+("?)/gi, '$1[redigido]$2')
    .slice(-12000);
}

function formatTermuxLog(log) {
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

const Avatar = BotAvatar;
// A bot of the computer, while it is off: "visto por último hoje às 18:40" (or never, before the first connection).
const seenText = (presence, short = false) => {
  if (!presence?.lastSeen) return short ? 'computador desligado' : 'esperando o computador';
  const seen = new Date(presence.lastSeen); const today = new Date(); const yesterday = new Date(Date.now() - 86400000);
  const hour = seen.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const day = seen.toDateString() === today.toDateString() ? 'hoje' : seen.toDateString() === yesterday.toDateString() ? 'ontem' : seen.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return `${short ? 'visto' : 'visto por último'} ${day} às ${hour}`;
};
const offline = (data, botId) => data?.presence?.[botId]?.online === false;
const HUE_OF = bot => ({ green: C.mint, blue: C.sky, purple: C.lilac, orange: C.peach })[bot?.color] || C.mint;

function PrimaryButton({ title, onPress, disabled, compact = false, style, icon, tone = 'mint' }) {
  const ghost = tone === 'ghost';
  return <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled}
    style={({ pressed }) => [styles.primaryButton, compact && styles.compactButton, ghost && styles.ghostButton, disabled && styles.buttonDisabled, pressed && !disabled && styles.pressed, style]}>
    {icon ? <Icon name={icon} size={compact ? 17 : 19} color={ghost ? C.text : C.mintInk} stroke={2.2} /> : null}
    <Text style={[styles.primaryButtonText, compact && styles.compactButtonText, ghost && styles.ghostButtonText]}>{title}</Text>
  </Pressable>;
}

function IconButton({ icon, label, onPress, active, disabled, tint = C.text2, size = 42 }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} disabled={disabled} hitSlop={6}
    style={({ pressed }) => [styles.iconButton, { width: size, height: size, borderRadius: size * 0.36 }, active && styles.iconButtonActive, pressed && styles.pressed, disabled && styles.buttonDisabled]}>
    <Icon name={icon} size={size * 0.5} color={active ? C.mint : tint} />
  </Pressable>;
}

// "Trabalhando" with three dots that rise in turn.
function Dots({ color = C.mint }) {
  const values = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.stagger(160, values.map(value => Animated.sequence([
      Animated.timing(value, { toValue: 1, duration: 280, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(value, { toValue: 0, duration: 280, easing: Easing.in(Easing.quad), useNativeDriver: true }), Animated.delay(200)]))));
    loop.start(); return () => loop.stop();
  }, []);
  return <View style={styles.dots}>{values.map((value, index) => <Animated.View key={index} style={[styles.dot, { backgroundColor: color, opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }), transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) }] }]} />)}</View>;
}

// Bottom sheets share one header: title, optional subtitle and a close button.
function SheetHeader({ title, subtitle, onClose, icon }) {
  return <View style={styles.sheetHeader}>
    {icon ? <View style={styles.sheetIcon}><Icon name={icon} size={20} color={C.mint} /></View> : null}
    <View style={{ flex: 1 }}><Text style={styles.sheetTitle} numberOfLines={2}>{title}</Text>{subtitle ? <Text style={styles.sheetSubtitle} numberOfLines={3}>{subtitle}</Text> : null}</View>
    {onClose ? <IconButton icon="close" label="Fechar" onPress={onClose} size={38} /> : null}
  </View>;
}

function Notice({ text, onRetry, onLogs, loading = false }) {
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

function TermuxLogModal({ visible, log, copied, onClose, onCopy }) {
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

function ChoiceSheet({ visible, title, options, value, onClose, onSelect }) {
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

function ChoiceField({ label, value, disabled, onPress }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value || 'indisponível'}`}
    accessibilityState={{ disabled }} onPress={onPress} disabled={disabled} style={[styles.choiceField, disabled && styles.choiceDisabled]}>
    <Text style={styles.choiceLabel}>{label}</Text><Text style={styles.choiceValue} numberOfLines={1}>{value || 'Carregando opções…'}</Text>
    <Text style={styles.choiceChevron}>⌄</Text>
  </Pressable>;
}

const PROVIDER_NAMES = { codex: 'Codex', claude: 'Claude' };
const providerOf = item => item?.provider || 'codex';
// Models without a provider (computer mode) are Codex models; the IA field only appears when both are available.
function findModel(models, selection) { return models.find(item => item.model === selection?.model && providerOf(item) === providerOf(selection)) || models.find(item => item.model === selection?.model); }
function ModelSettings({ models, selection, disabled, onChange, connections }) {
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

function ApprovalCard({ approval, bot, onRespond, busy }) {
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

const plain = text => (text || '').replace(/```[\s\S]*?```/g, ' ').replace(/[*`#>]+/g, '').replace(/\s+/g, ' ').trim();
function BotCard({ bot, busy, waiting, presence, routines = 0, items = 0, onPress, onProfile }) {
  const asleep = presence?.online === false;
  const latest = bot.messages.at(-1);
  const preview = latest?.origin === 'routine' ? `Rotina · ${latest.routineTitle}` : latest?.attachments?.length && latest.text === 'Veja o anexo.' ? latest.attachments[0].name : plain(latest?.text);
  const updated = new Date(bot.updatedAt);
  const time = Date.now() - updated < 86400000 ? updated.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : updated.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const hue = HUE_OF(bot);
  return <Pressable accessibilityRole="button" accessibilityLabel={`Conversar com ${bot.name}`} onPress={onPress}
    style={({ pressed }) => [styles.botCard, busy && !asleep && { borderColor: hue + '70', shadowColor: hue, shadowOpacity: 0.5, shadowRadius: 14, elevation: 6 }, waiting && styles.botCardWaiting, pressed && styles.pressed]}>
    <View><Avatar bot={bot} size={58} state={waiting ? 'waiting' : asleep ? 'sleeping' : busy ? 'working' : 'idle'} />
      {bot.home === 'pc' || bot.home === 'any' ? <View style={[styles.presenceDot, !asleep && styles.presenceOn]} /> : null}</View>
    <View style={styles.botCardCopy}>
      <View style={styles.botNameRow}><Text style={styles.botCardName} numberOfLines={1}>{bot.name}</Text><Text style={styles.botTime}>{time}</Text></View>
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

// What deserves a glance today, in place of a decorative banner: decisions, the next deadline, the next routine.
function TodayStrip({ data, onActivity }) {
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

function greeting() { const hour = new Date().getHours(); return hour < 5 ? 'Boa noite' : hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite'; }

function NavBar({ mode, onActivity, onMaintenance, onConnection, onMode, attention }) {
  const items = [['bots', 'Bots', null, true], ['activity', mode === 'phone' ? 'Atividade' : 'Conexão', mode === 'phone' ? onActivity : onConnection], ['settings', 'Ajustes', mode === 'phone' ? onMaintenance : onMode]];
  return <View style={styles.bottomNav}>{items.map(([icon, label, onPress, active]) =>
    <Pressable key={icon} accessibilityRole="button" accessibilityState={{ selected: Boolean(active) }} onPress={onPress || undefined} style={[styles.navItem, active && styles.navItemActive]}>
      <View><Icon name={icon} size={21} color={active ? C.mint : C.muted} />{icon === 'activity' && attention ? <View style={styles.navBadge} /> : null}</View>
      <Text style={active ? styles.navTextActive : styles.navText}>{label}</Text>
    </Pressable>)}</View>;
}

// A new MyBots version from GitHub Releases: what changed, then download → Android's confirmation → restart on it.
const UPDATE_STEPS = { downloading: 'Baixando', installing: 'Conferindo e instalando…', confirm: 'Confirme a instalação na janela do Android.', permission: 'Permita "Instalar apps desconhecidos" para o MyBots e toque em Atualizar de novo.' };
function UpdateCard({ update, onInstall, onDismiss, compact = false }) {
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

// ---- The computer's layout: conversations on the left, the open one in the middle, today on the right.
const shortTime = value => { const date = new Date(value); return Date.now() - date < 86400000 ? date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); };
// What a bot's row says under its name, like the phone's card.
function botLine(bot, data) {
  const waiting = data.approvals?.some(item => item.botId === bot.id); const asleep = offline(data, bot.id); const busy = data.active?.includes(bot.id);
  const latest = bot.messages.at(-1);
  if (waiting) return { text: 'Esperando sua decisão', tone: C.amber, state: 'waiting' };
  if (asleep) return { text: busy ? 'Esperando o computador' : `Dormindo · ${seenText(data.presence?.[bot.id])}`, tone: C.faint, state: 'sleeping' };
  if (busy) return { text: 'Trabalhando…', tone: HUE_OF(bot), state: 'working' };
  return { text: latest?.origin === 'routine' ? `Rotina · ${latest.routineTitle}` : latest?.role === 'user' ? `Você: ${plain(latest.text)}` : plain(latest?.text) || 'Pronto para começar', tone: C.muted, state: 'idle' };
}

function SideRow({ selected, onPress, label, face, title, time, line, tone, dot, working }) {
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

function DesktopShell({ data, error, selected, roomId, onOpen, onRoom, onCreate, onNewRoom, onProfile, onActivity, onMaintenance, onRespond, approvalBusy, onComplete, onConnection, call, children }) {
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
            const members = room.botIds.map(id => data.bots.find(bot => bot.id === id)).filter(Boolean); const latest = room.messages.at(-1);
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
            title={bot.name} time={bot.messages.at(-1) ? shortTime(bot.updatedAt) : ''} line={line.text} tone={line.tone} working={line.state === 'working'} />;
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

// Nothing open yet: the greeting, what needs the person, and where to start.
function DeskWelcome({ data, error, onRespond, approvalBusy, onCreate, onConnection, call }) {
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

// The right column on a wide screen: decisions, deadlines, routines and what just happened.
function TodayPanel({ data, onOpen, onRespond, approvalBusy, onComplete, onActivity }) {
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

function HomeScreen({ data, error, onRetry, onLogs, onCreate, onOpen, onConnection, mode, onMode, onProfile, onMaintenance, onActivity, onRespond, approvalBusy, update, onUpdate, onUpdateDismiss, onRoom, onNewRoom }) {
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

function ModeSheet({ visible, mode, onClose, onSelect }) {
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

function Message({ message, bot, models, onRetry, busy, onFile, fileBusy }) {
  const routine = message.origin === 'routine';
  const user = message.role === 'user' && !routine;
  const [expanded, setExpanded] = useState(false);
  const time = new Date(message.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (routine) return <View style={styles.routineRow}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Rotina ${message.routineTitle}`} onPress={() => setExpanded(value => !value)} style={styles.routineChip}>
      <View style={styles.routineChipHead}><Icon name="bolt" size={14} color={C.sky} /><Text style={styles.routineChipText} numberOfLines={1}>Rotina · {message.routineTitle} · {time}</Text><Icon name={expanded ? 'back' : 'down'} size={14} color={C.faint} /></View>
      {expanded && <Text selectable style={styles.routineDetail}>{message.text}</Text>}
    </Pressable>
    {message.status === 'error' && <Text style={styles.messageErrorText}>{message.error || 'A rotina não foi concluída.'}</Text>}
  </View>;
  const model = message.model ? `${claudeName(message.modelId) || findModel(models, message)?.displayName || message.model}${message.reasoningEffort ? ` · ${EFFORT_NAMES[message.reasoningEffort] || message.reasoningEffort}` : ''}` : '';
  const error = message.status === 'error' && <View style={styles.messageError}>
    <Icon name="alert" size={16} color={C.red} /><Text style={styles.messageErrorText}>{message.error || 'A resposta não foi concluída.'}</Text>
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => onRetry(message.text)} style={styles.retryButton}><Icon name="refresh" size={14} color={C.text} /><Text style={styles.retryText}>Tentar de novo</Text></Pressable>
  </View>;
  const files = message.attachments?.length ? <View style={styles.messageFiles}>{message.attachments.map(file => user ? <FileChip key={file.id} file={file} busy={fileBusy === file.id} onPress={onFile} /> : <FileCard key={file.id} file={file} busy={fileBusy === file.id} onPress={onFile} />)}</View> : null;
  if (user) return <View style={[styles.messageRow, styles.userMessageRow]}>
    <View style={[styles.messageBubble, styles.userBubble]}>
      {files}
      {message.text && message.text !== 'Veja o anexo.' ? <Text selectable style={styles.messageText}>{message.text}</Text> : null}
      <Text style={styles.userTime}>{time}</Text>
      {error}
    </View>
  </View>;
  return <View style={styles.messageRow}>
    <Avatar bot={bot} size={30} animated={false} tile={false} />
    <View style={[styles.messageBubble, styles.assistantBubble]}>
      <View style={styles.messageMeta}><Text style={styles.messageSpeaker}>{bot.name}</Text><Text style={styles.messageTime}>{time}{model ? ` · ${model}` : ''}{message.usage ? ` · ${tokensLabel(message.usage.input + message.usage.output)} tokens` : ''}</Text></View>
      {files}
      <RichText text={message.text} textStyle={styles.messageText} />
      {error}
    </View>
  </View>;
}

function PhoneAccess({ stats, lastPoll }) {
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
  </View>;
}

// Explains the three ways termux-api calls silently hang on a phone, so the person fixes the right one.
// Whether bots' notifications can appear as MyBots: Android permission, channel and the background delivery.
function BotNoticeStatus({ lastPoll }) {
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

function TermuxApiStatus() {
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

// "Funcionar com a tela apagada": the MyBots service that wakes and restarts the supervisor, and what Android/HyperOS may still block.
// On the computer's window: the QR the phone reads to pair (Ajustes → Computador → Conectar computador on the phone).
// It closes by itself once a phone pairs.
function DesktopPair({ call, compact = false }) {
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
    <Text style={styles.optionDetail}>No celular, abra o MyBots → Ajustes → Computador → Conectar computador e aponte a câmera para o QR. Ele vale por 10 minutos e uma vez só.</Text>
    {qr ? <View style={styles.pairQr}><View accessibilityLabel="QR para parear o celular"><SvgXml xml={qr.svg} width={260} height={260} /></View>
      <Text style={styles.limitMeta}>Esperando o celular ler…</Text></View> : null}
    <View style={{ flexDirection: 'row', gap: 14, marginTop: 10 }}>
      <Pressable accessibilityRole="button" disabled={busy} onPress={qr ? () => setQr(null) : show} style={styles.stopButton}><Icon name={qr ? 'close' : 'phone'} size={13} color={C.mint} /><Text style={[styles.stopText, { color: C.mint }]}>{qr ? 'Esconder QR' : busy ? 'Gerando…' : 'Mostrar QR'}</Text></Pressable>
    </View>
    {note ? <Text style={[styles.optionDetail, /pareado/.test(note) ? { color: C.mint } : { color: C.amber }]}>{note}</Text> : null}
  </View>;
}

// The computer paired with this phone (Ajustes → Computador): its bots are online while it is on. The phone dials
// the computer; pairing reads the QR that `node pc/node.mjs pair` shows on it.
function ComputerPanel({ computer, nodes = [], onPair, onForget, onRetry }) {
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

// Saved site logins (Ajustes → Senhas): the bots' browser fills them on that site only; nobody sees them again.
function PasswordsPanel({ bots }) {
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
  return <View style={styles.modeOption}>
    <Text style={styles.optionLabel}>Senhas de sites</Text>
    <Text style={styles.optionDetail}>O bot entra sozinho (ex.: no SIGAA) com a senha salva aqui. Ela fica protegida neste celular e só é preenchida no site em que foi salva; a IA nunca vê a senha. Dica: entre uma vez pelo Assumir do navegador do bot e toque em Salvar.</Text>
    {list.map(item => <View key={item.id} style={styles.passwordRow}>
      <View style={styles.rowIcon}><Icon name="key" size={17} color={C.mint} /></View>
      <View style={{ flex: 1 }}><Text style={styles.limitName} numberOfLines={1}>{item.host}</Text><Text style={styles.limitMeta} numberOfLines={1}>{item.username || 'sem usuário'} · {names(item.bots)}</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Apagar a senha de ${item.host}`} hitSlop={10} onPress={() => remove(item)}><Icon name="trash" size={17} color={C.faint} /></Pressable>
    </View>)}
    {form ? <View style={{ marginTop: 6 }}>
      <TextInput style={styles.formInput} placeholder="Site (ex.: sig.cefetmg.br)" placeholderTextColor="#6F7787" autoCapitalize="none" autoCorrect={false} keyboardType="url" value={form.site || ''} onChangeText={value => field('site', value)} />
      <TextInput style={styles.formInput} placeholder="Usuário (CPF, matrícula ou e-mail)" placeholderTextColor="#6F7787" autoCapitalize="none" autoCorrect={false} value={form.username || ''} onChangeText={value => field('username', value)} />
      <TextInput style={styles.formInput} placeholder="Senha" placeholderTextColor="#6F7787" autoCapitalize="none" autoCorrect={false} secureTextEntry value={form.password || ''} onChangeText={value => field('password', value)} />
      <Text style={[styles.limitMeta, { marginTop: 10 }]}>Quais bots podem usar</Text>
      <View style={styles.shareFiles}>
        {[{ id: null, name: 'Todos' }, ...bots].map(bot => { const all = !form.bots?.length; const on = bot.id ? form.bots?.includes(bot.id) : all; return <Pressable key={bot.id || 'all'} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
          onPress={() => field('bots', bot.id ? (on ? form.bots.filter(id => id !== bot.id) : [...(form.bots || []), bot.id]) : [])} style={[styles.botChoice, on && styles.botChoiceOn]}><Text style={[styles.botChoiceText, on && { color: C.mint }]}>{bot.name}</Text></Pressable>; })}
      </View>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
        <Pressable accessibilityRole="button" onPress={() => setForm(null)} style={[styles.denyButton, { flex: 1 }]}><Text style={styles.denyText}>Cancelar</Text></Pressable>
        <PrimaryButton compact icon="check" title={busy ? 'Salvando…' : 'Salvar senha'} disabled={busy || !form.site || !form.password} onPress={save} style={{ flex: 1.4 }} />
      </View>
    </View> : <Pressable accessibilityRole="button" onPress={() => { setNote(''); setForm({}); }} style={[styles.stopButton, { alignSelf: 'flex-start', marginTop: 10 }]}><Icon name="plus" size={13} color={C.mint} /><Text style={[styles.stopText, { color: C.mint }]}>Adicionar senha</Text></Pressable>}
    {note ? <Text style={[styles.optionDetail, /salva/.test(note) ? { color: C.mint } : { color: C.amber }]}>{note}</Text> : null}
  </View>;
}

// After the person logs in through "Assumir": offer to keep that login so the bot can enter by itself next time.
function PasswordOfferCard({ offer, bot, onAnswer }) {
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

// The home-screen widget: placed or not, and a button that asks Android to add it.
function WidgetRow() {
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

// The name the home screen greets ("Bom dia, Augusto."); saved in the supervisor when the field loses focus.
function PersonName({ name, onSave }) {
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

function ScreenOff({ heartbeat, nextRoutineAt }) {
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

// Open items by deadline: late, today, this week, later and without a deadline (the phone's local time).
// The exact Claude model a reply used: "claude-opus-5-5" → "Claude Opus 5.5".
function claudeName(id) {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id || '');
  return match ? `Claude ${match[1][0].toUpperCase()}${match[1].slice(1)} ${match[2]}${match[3] ? '.' + match[3] : ''}` : null;
}
// Tokens per bot and the plan's limits, as the IA reported them.
const tokensLabel = value => value >= 1e6 ? `${(value / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi` : value >= 1000 ? `${(value / 1000).toLocaleString('pt-BR', { maximumFractionDigits: value >= 1e5 ? 0 : 1 })} mil` : String(value);
const PLAN_NAMES = { codex: 'ChatGPT', claude: 'Claude' };
const WINDOW_NAMES = { five_hour: 'Últimas 5 horas', week: 'Semana' };
function resetLabel(iso) {
  if (!iso) return '';
  const at = new Date(iso); const soon = at - Date.now() < 86400000;
  return `renova ${soon ? 'às ' + at.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : at.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}`;
}
function UsagePanel({ usage, bots, connections, onRefresh }) {
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

function ItemsByDeadline({ items, bots, onComplete }) {
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

const EMAIL_STATUS = { connected: 'Conectado', syncing: 'Sincronizando…', auth_error: 'Reconectar conta', offline: 'Sem rede', locked: 'Bloqueado', unavailable: 'Instalando conector', error: 'Erro', disconnected: 'Desconectado' };
function EmailConnection({ email, busy, onAction }) {
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

const CONNECTOR_PAGES = { claude: 'https://claude.ai/settings/connectors', codex: 'https://chatgpt.com/#settings/Connectors' };
// The official connectors of each IA account: OAuth happens on Anthropic's or OpenAI's own page, never in MyBots.
function AccountConnections({ load }) {
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

function AppConnections({ apps = [], busy, onAction }) {
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

// What another app shared ("Compartilhar → MyBots"): the person picks the bot; nothing is sent until they confirm in the chat.
function shareText(share) {
  const text = (share?.text || '').trim(); const subject = (share?.subject || '').trim();
  return subject && !text.includes(subject) ? `${subject}\n${text}`.trim() : text;
}
function ShareSheet({ share, bots, phone, onPick, onClose }) {
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

function ChatScreen({ bot, data, error, onLogs, draft, setDraft, sending, saving, mode, onBack, onMode, onSend, onRetry, onSettings, onConnection, onDelete, onCancel, onProfile, onRespond, approvalBusy, onBrowserControl, onFile, fileBusy, incoming, onIncoming, passwordAsk, onPasswordAnswer }) {
  const scroll = useRef(null);
  const [showModels, setShowModels] = useState(false);
  const busy = sending || saving || data.active?.includes(bot.id);
  const selection = bot.model ? bot : data.defaultSelection;
  // A bot answering from the computer needs its IA logged in there, not on the phone; while the computer is off it just waits.
  const presence = data.presence?.[bot.id]; const computer = data.nodes?.find(node => node.online);
  const remote = presence?.where === 'pc' || (bot.home === 'pc' && !presence?.online);
  const own = remote ? (presence?.online ? computer?.connections?.[selection?.provider || 'codex'] || { loggedIn: false, message: 'Esta IA não está conectada no computador.' } : null) : data.connections?.[selection?.provider || 'codex'];
  const status = error || (own && !own.loggedIn ? own.message : !remote && !data.connection?.loggedIn ? data.connection?.message : data.modelsError);
  const phone = mode === 'phone' && termuxAvailable;
  const [files, setFiles] = useState([]); const [composerError, setComposerError] = useState('');
  // The bot's own browser panel; it stays open while the person has taken over.
  const [browserOpen, setBrowserOpen] = useState(false);
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
  // Inline dictation: partial text shows live in a slim bar; the final text joins the draft for review.
  const [voice, setVoice] = useState(null);
  useEffect(() => {
    if (!phone) return undefined;
    const subscription = onSpeech(event => {
      if (event.type === 'level') setVoice(old => old && { ...old, level: event.level });
      else if (event.type === 'partial') setVoice(old => old && { ...old, text: event.text });
      else if (event.type === 'final') { if (event.text) setDraft(old => old.trim() ? `${old.trim()} ${event.text}` : event.text); setVoice(null); }
      else if (event.type === 'error') { setVoice(null); setComposerError(event.message); }
    });
    return () => { subscription.remove(); stopListening(true).catch(() => {}); };
  }, [phone]);
  const speak = async () => {
    setComposerError('');
    try {
      const permission = await microphonePermission();
      if (permission?.status !== 'granted') throw new Error('Permita o microfone para ditar mensagens.');
      setVoice({ text: '', level: 0 }); await startListening();
    } catch (e) { setVoice(null); setComposerError(e.message); }
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
      {phone ? <IconButton icon="globe" label={browserOpen ? 'Esconder navegador do bot' : 'Ver navegador do bot'} active={browserOpen} onPress={() => !assumed && setBrowserOpen(value => !value)} size={40} /> : null}
      <IconButton icon="more" label="Perfil e permissões" onPress={onProfile} size={40} />
    </View>
    {status ? <Notice text={status} onRetry={onConnection} onLogs={error ? onLogs : null} /> : null}
    {showModels && !working ? <View style={styles.modelPanel}><ModelSettings models={data.models || []} connections={data.connections} selection={selection} disabled={busy} onChange={onSettings} /></View> : null}
    {phone && browserOpen ? <BotBrowserPanel bot={bot} browser={data.browser} onControl={onBrowserControl} onClose={() => setBrowserOpen(false)} /> : null}
    <ScrollView ref={scroll} style={styles.messages} contentContainerStyle={styles.messagesContent} keyboardShouldPersistTaps="handled"
      onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
      {!bot.messages.length && <View style={styles.chatEmpty}><Avatar bot={bot} size={96} state={asleep ? 'sleeping' : 'idle'} /><Text style={styles.chatEmptyTitle}>Diga oi para {bot.name}.</Text>
        <Text style={styles.chatEmptyText}>Conte o que você precisa. Em Perfil você vê e muda o que este bot pode fazer.</Text>
        {['Oi! Vamos nos conhecer?', 'O que você consegue fazer por mim?'].map(text => <Pressable key={text} accessibilityRole="button" disabled={busy} onPress={() => onSend(text)} style={({ pressed }) => [styles.greetingButton, pressed && styles.pressed]}><Text style={styles.greetingText}>{text}</Text><Icon name="send" size={15} color={C.mint} /></Pressable>)}
      </View>}
      {bot.messages.map(message => <Message key={message.id} message={message} bot={bot} models={data.models || []} busy={busy} onRetry={onRetry} onFile={mode === 'phone' ? onFile : () => {}} fileBusy={fileBusy} />)}
      {phone && passwordAsk?.botId === bot.id ? <PasswordOfferCard offer={passwordAsk} bot={bot} onAnswer={onPasswordAnswer} /> : null}
      {phone && help && !assumed ? <BrowserHelpCard bot={bot} help={help} onOpen={() => { setBrowserOpen(true); onBrowserControl('person').catch(() => {}); }} /> : null}
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
    <View style={styles.composerArea}>
      {error ? <Text style={styles.composerError}>Confira a conexão antes de enviar.</Text> : null}
      {composerError ? <Text style={styles.composerError}>{composerError}</Text> : null}
      {files.length ? <ScrollView horizontal style={styles.fileTray} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">{files.map((file, index) =>
        <View key={index} style={styles.fileChip}><FileChip file={file} onRemove={() => setFiles(old => old.filter((_, i) => i !== index))} /></View>)}</ScrollView> : null}
      {voice ? <View style={[styles.composer, styles.voiceBar]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Cancelar ditado" hitSlop={8} onPress={() => { stopListening(true).catch(() => {}); setVoice(null); }} style={styles.composerTool}><Icon name="close" size={20} color={C.text2} /></Pressable>
        <View style={styles.voiceLive}>
          <View style={styles.voiceLevels}>{[0.5, 0.8, 1, 0.7, 0.4].map((weight, index) => <View key={index} style={[styles.voiceLevel, { height: 4 + Math.round(18 * Math.max(0.15, (voice.level || 0) * weight)) }]} />)}</View>
          <Text style={styles.voiceText} numberOfLines={2}>{voice.text || 'Ouvindo…'}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Terminar ditado" onPress={() => stopListening(false).catch(() => {})} style={[styles.sendButton, styles.voiceDone]}><Icon name="check" size={20} color={C.mintInk} stroke={2.6} /></Pressable>
      </View> : <View style={styles.composer}>
        {phone && <Pressable accessibilityRole="button" accessibilityLabel="Anexar arquivo ou foto" disabled={typing || files.length >= 5} onPress={attach} style={({ pressed }) => [styles.composerTool, (typing || files.length >= 5) && styles.sendDisabled, pressed && styles.pressed]}><Icon name="plus" size={21} color={C.text2} stroke={2} /></Pressable>}
        <TextInput accessibilityLabel="Sua mensagem" value={draft} onChangeText={setDraft} editable={!typing}
          placeholder={typing ? 'Aguarde a resposta…' : busy ? 'Mande mais, ele lê na sequência…' : `Converse com ${bot.name}…`} placeholderTextColor={C.faint}
          multiline maxLength={8000} textAlignVertical="center" style={styles.messageInput} selectionColor={C.mint}
          // On the computer, Enter sends and Shift+Enter breaks the line.
          onKeyPress={desktop ? event => { if (event.nativeEvent.key === 'Enter' && !event.nativeEvent.shiftKey) { event.preventDefault(); if (canSend) onSend(draft, files).then(sent => sent && setFiles([])); } } : undefined} />
        {phone && !draft.trim() && !files.length ? <Pressable accessibilityRole="button" accessibilityLabel="Ditar mensagem por voz" disabled={typing} onPress={speak}
          style={({ pressed }) => [styles.sendButton, styles.micButton, pressed && styles.pressed]}><Icon name="mic" size={20} color={C.text} /></Pressable>
        : <Pressable accessibilityRole="button" accessibilityLabel="Enviar mensagem" disabled={!canSend}
          onPress={async () => { if (await onSend(draft, files)) setFiles([]); }} style={({ pressed }) => [styles.sendButton, !canSend && styles.sendDisabled, pressed && styles.pressed]}>
          <Icon name="send" size={20} color={C.mintInk} stroke={2.6} />
        </Pressable>}
      </View>}
    </View>
  </KeyboardAvoidingView>;
}

// Rooms: the person and several bots in one conversation. Without @ every bot answers in turn; with @ only the named ones.
function RoomFaces({ bots, size = 40 }) {
  const shown = bots.slice(0, 3);
  return <View style={{ width: size + (shown.length - 1) * size * 0.42, height: size }}>
    {shown.map((bot, index) => <View key={bot.id} style={{ position: 'absolute', left: index * size * 0.42, top: 0, zIndex: 10 - index, borderRadius: size * 0.3, borderWidth: 2, borderColor: C.bg }}>
      <Avatar bot={bot} size={size - 4} animated={false} /></View>)}
  </View>;
}

function RoomCard({ room, bots, onPress }) {
  const members = room.botIds.map(id => bots.find(bot => bot.id === id)).filter(Boolean);
  const latest = room.messages.at(-1);
  const who = latest?.role === 'user' ? 'Você' : members.find(bot => bot.id === latest?.botId)?.name;
  const working = room.active?.length ? members.filter(bot => room.active.includes(bot.id)).map(bot => bot.name) : [];
  return <Pressable accessibilityRole="button" accessibilityLabel={`Abrir a sala ${room.name}`} onPress={onPress} style={({ pressed }) => [styles.botCard, pressed && styles.pressed]}>
    <RoomFaces bots={members} size={44} />
    <View style={styles.botCardCopy}>
      <View style={styles.botNameRow}><Text style={styles.botCardName} numberOfLines={1}>{room.name}</Text><Text style={styles.botTime}>{members.length} bots</Text></View>
      {working.length ? <View style={styles.botWorking}><Text style={[styles.botPreview, { color: C.mint }]} numberOfLines={1}>{working.join(', ')} {working.length > 1 ? 'respondendo' : 'respondendo'}</Text><Dots /></View>
        : <Text style={styles.botPreview} numberOfLines={1}>{latest ? `${who || 'Bot'}: ${plain(latest.text) || (latest.status === 'error' ? 'não conseguiu responder' : '')}` : members.map(bot => bot.name).join(', ')}</Text>}
    </View>
  </Pressable>;
}

function RoomSheet({ visible, room, bots, onClose, onSave, onDelete }) {
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

function RoomScreen({ room, data, onBack, onSend, onEdit, onCancel, onRespond, approvalBusy, onFile, fileBusy }) {
  const scroll = useRef(null); const input = useRef(null);
  const [draft, setDraft] = useState(''); const [sending, setSending] = useState(false); const [error, setError] = useState('');
  const members = room.botIds.map(id => data.bots.find(bot => bot.id === id)).filter(Boolean);
  const byId = Object.fromEntries(members.map(bot => [bot.id, bot]));
  const working = members.filter(bot => room.active?.includes(bot.id));
  const approvals = (data.approvals || []).filter(item => room.activeTasks?.includes(item.taskId));
  const named = members.filter(bot => new RegExp(`@${bot.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`, 'iu').test(draft));
  const send = async text => {
    if (!text.trim() || sending) return; setSending(true); setError('');
    try { await onSend(text); setDraft(''); } catch (e) { setError(nativeMessage(e)); } finally { setSending(false); }
  };
  const mention = bot => { setDraft(old => (old.trim() ? old.replace(/\s*$/, ' ') : '') + `@${bot.name} `); input.current?.focus(); };
  const retry = message => { const asked = room.messages.find(item => item.id === message.replyTo); const bot = byId[message.botId]; if (asked && bot) send(`@${bot.name} ${asked.text.replace(/@\S+\s?/g, '').trim() || asked.text}`); };
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
    <ScrollView ref={scroll} style={styles.messages} contentContainerStyle={styles.messagesContent} keyboardShouldPersistTaps="handled" onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
      {!room.messages.length ? <View style={styles.chatEmpty}><RoomFaces bots={members} size={72} />
        <Text style={styles.chatEmptyTitle}>{room.name}</Text>
        <Text style={styles.chatEmptyText}>Escreva para todos ou chame alguém com @. Os bots também podem se chamar entre si.</Text></View> : null}
      {room.messages.map(message => message.role === 'user' || byId[message.botId]
        ? <Message key={message.id} message={message} bot={byId[message.botId] || members[0]} models={data.models || []} busy={sending} onRetry={() => retry(message)} onFile={onFile} fileBusy={fileBusy} />
        : <Text key={message.id} style={styles.roomGone}>Um bot que saiu da sala respondeu aqui.</Text>)}
      {approvals.map(approval => <ApprovalCard key={approval.id} approval={approval} bot={byId[approval.botId]} onRespond={onRespond} busy={approvalBusy === approval.id} />)}
      {working.map(bot => <View key={bot.id} style={styles.thinking}><Avatar bot={bot} size={34} state={approvals.some(item => item.botId === bot.id) ? 'waiting' : offline(data, bot.id) ? 'sleeping' : 'working'} tile={false} />
        <View style={styles.thinkingCard}><View style={styles.botWorking}><Text style={styles.thinkingText}>{bot.name} {offline(data, bot.id) ? 'responde quando o computador ligar' : data.tasks?.find(task => room.activeTasks?.includes(task.id) && task.bot_id === bot.id)?.state === 'queued' ? 'na fila' : 'pensando'}</Text>{offline(data, bot.id) ? null : <Dots color={HUE_OF(bot)} />}</View>
          {(() => { const step = data.tasks?.find(task => room.activeTasks?.includes(task.id) && task.bot_id === bot.id)?.step; return step ? <Text style={styles.thinkingStep} numberOfLines={1}>{step}</Text> : null; })()}
          <Pressable accessibilityRole="button" onPress={() => onCancel(bot.id)} hitSlop={8} style={styles.stopButton}><Icon name="stop" size={13} color={C.muted} /><Text style={styles.stopText}>Parar</Text></Pressable></View>
      </View>)}
    </ScrollView>
    <View style={styles.composerArea}>
      {error ? <Text style={styles.composerError}>{error}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.mentionBar} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">
        {members.map(bot => <Pressable key={bot.id} accessibilityRole="button" accessibilityLabel={`Chamar ${bot.name}`} onPress={() => mention(bot)} style={({ pressed }) => [styles.mentionChip, named.includes(bot) && styles.mentionChipOn, pressed && styles.pressed]}>
          <Avatar bot={bot} size={22} animated={false} tile={false} /><Text style={[styles.mentionText, named.includes(bot) && { color: C.mint }]}>@{bot.name}</Text></Pressable>)}
      </ScrollView>
      <View style={styles.composer}>
        <TextInput ref={input} accessibilityLabel="Mensagem para a sala" value={draft} onChangeText={setDraft} editable={!sending} multiline maxLength={8000} textAlignVertical="center" style={[styles.messageInput, { paddingLeft: 14 }]} selectionColor={C.mint}
          placeholder={named.length ? `Só ${named.map(bot => bot.name).join(' e ')} ${named.length > 1 ? 'respondem' : 'responde'}…` : 'Sem @, todos os bots respondem…'} placeholderTextColor={C.faint}
          onKeyPress={desktop ? event => { if (event.nativeEvent.key === 'Enter' && !event.nativeEvent.shiftKey) { event.preventDefault(); if (draft.trim() && !sending) send(draft); } } : undefined} />
        <Pressable accessibilityRole="button" accessibilityLabel="Enviar para a sala" disabled={!draft.trim() || sending} onPress={() => send(draft)} style={({ pressed }) => [styles.sendButton, (!draft.trim() || sending) && styles.sendDisabled, pressed && styles.pressed]}>
          <Icon name="send" size={20} color={C.mintInk} stroke={2.6} /></Pressable>
      </View>
    </View>
  </KeyboardAvoidingView>;
}


// The app waits for its typeface before the first frame, so text never jumps from the system font.
export default function App() {
  const [fonts] = useFonts({ PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold });
  return fonts ? <AppMain /> : <View style={styles.app} />;
}

function AppMain() {
  const [data, setData] = useState(null);
  const [apiToken, setApiToken] = useState('');
  const [apiBase, setApiBase] = useState(DEFAULT_API_URL);
  const [mode, setMode] = useState(desktop ? 'phone' : 'computer');
  const [localCache, setLocalCache] = useState(emptyLocalStore());
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
  const [profileId, setProfileId] = useState(null);
  const [approvalBusy, setApprovalBusy] = useState(null);
  const [modeVisible, setModeVisible] = useState(false);
  const [maintenanceVisible, setMaintenanceVisible] = useState(false);
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);
  const [maintenanceText, setMaintenanceText] = useState('Backups ficam no Termux e sobrevivem à desinstalação do MyBots.');
  const [backupNames, setBackupNames] = useState([]);
  const [activityVisible, setActivityVisible] = useState(false);
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
  const phoneConnecting = useRef(null);

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

  const loadSupervisorState = useCallback(async () => {
    const next = await supervisor.current.call('state.get');
    if (phoneMode.current !== 'phone') return next;
    setData(next); setLoadError('');
    const cache = { schema: 1, mode: 'phone', supervisorMigrated: true, bots: [...next.bots, ...(next.deletedBots || [])] };
    setLocalCache(cache);
    try { await writeLocalStore(cache); }
    catch { setLoadError('Não consegui atualizar a cópia local. Os dados continuam salvos no supervisor.'); }
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
  if (!supervisor.current) supervisor.current = Object.assign(new SupervisorClient({
    onEvent: (event, data) => {
      // A bot notice while the app is open: MyBots shows it and confirms, so Termux:API does not repeat it.
      if (event === 'bot.notify' && data?.id && !desktop) {
        showBotNotification(data).then(shown => shown && supervisor.current.call('outbox.ack', { ids: [data.id] })).catch(() => {});
        return;
      }
      clearTimeout(eventRefresh.current);
      eventRefresh.current = setTimeout(() => { if (phoneMode.current === 'phone') loadSupervisorState().catch(error => setLoadError(error.message)); }, 150);
    },
    onConnection: connected => {
      if (phoneMode.current !== 'phone') return;
      if (connected) prepareSupervisor().catch(error => setLoadError(error.message)).finally(() => loadSupervisorState().catch(error => setLoadError(error.message)));
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
      setData(current => ({ ...(current || {}), bots: store.bots.filter(bot => !bot.deletedAt), active: activePhoneBots(store), models: current?.models || [],
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
      await supervisor.current.call('chat.send', { botId: bot.id, requestId: createId(), text: text.trim(), ...(files.length ? { attachments: files.map(({ name, mime, data }) => ({ name, mime, data })) } : {}) });
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
  const createBot = async payload => {
    if (maintenanceBusy) throw new Error('Aguarde o backup ou a restauração terminar.');
    if (mode === 'phone') {
      const bot = await supervisor.current.call('bot.create', payload);
      await loadSupervisorState(); setSelected(bot.id); setDraft(''); setCreateVisible(false); return;
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
    try { await supervisor.current.call('approval.respond', { approvalId: approval.id, actionHash: approval.actionHash, approved, always }); await loadSupervisorState(); }
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
    const open = id => { if (id) { setSelected(id); setRoomId(null); setProfileId(null); setCreateVisible(false); setMaintenanceVisible(false); setActivityVisible(false); setFileSheet(null); setDraft(''); } };
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
  const checkUpdate = useCallback(async function checkUpdate(manual = false) {
    if (!termuxAvailable) return;
    if (!manual && Date.now() - updateChecked.current < 6 * 3600000) return;
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
    const foreground = AppState.addEventListener('change', state => { if (state === 'active') { checkUpdate(); resumeUpdate.current?.(); } });
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
  // Each bot as a Direct Share target in Android's share sheet, most recently used first.
  const shareTargets = (data?.bots || []).slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(({ id, name, color, avatar }) => ({ id, name, color: color || 'green', avatar: avatar || '' }));
  const shareKey = JSON.stringify(shareTargets);
  useEffect(() => { if (termuxAvailable && data?.bots) publishShareTargets(shareTargets)?.catch(() => {}); }, [shareKey]);

  // The computer's wide window shows the list, the open conversation and today side by side.
  const wide = Boolean(desktop) && windowWidth >= 900;
  const roomView = data && room ? <RoomScreen room={room} data={data} onBack={wide ? null : () => setRoomId(null)} onEdit={() => setRoomSheet({ room })} onRespond={respondApproval} approvalBusy={approvalBusy} onFile={file => setFileSheet(file)} fileBusy={fileBusy}
          onSend={async text => { await supervisor.current.call('room.send', { roomId: room.id, requestId: createId(), text: text.trim() }); await loadSupervisorState(); }}
          onCancel={botId => { const task = data.tasks?.find(item => room.activeTasks?.includes(item.id) && item.bot_id === botId); if (task) cancelTask(task.id); }} /> : null;
  const chatView = data && bot && !room ? <ChatScreen bot={bot} data={data} error={loadError} onLogs={openLogs} draft={draft} setDraft={setDraft} sending={sending} saving={savingSettings || maintenanceBusy} mode={mode}
          onBack={wide ? null : () => { setSelected(null); setDraft(''); }} onMode={() => setModeVisible(true)} onSend={send} onRetry={send} onSettings={saveSettings} onConnection={checkConnection} onProfile={() => setProfileId(bot.id)} onRespond={respondApproval} approvalBusy={approvalBusy} onDelete={() => deleteBot(bot)}
          onFile={file => setFileSheet(file)} fileBusy={fileBusy} incoming={incoming?.botId === bot.id ? incoming : null} onIncoming={() => setIncoming(null)}
          passwordAsk={passwordAsk} onPasswordAnswer={async scope => { await passwordOfferAnswer(scope).catch(error => setLoadError(nativeMessage(error))); setPasswordAsk(null); }}
          onBrowserControl={async who => { await supervisor.current.call('browser.control', { botId: bot.id, who }); await loadSupervisorState(); }} onCancel={() => { const task = data.tasks?.find(item => item.bot_id === bot.id && ['queued','running','waiting_approval'].includes(item.state)); if (task) cancelTask(task.id); }} /> : null;
  return <View style={[styles.app, desktop && !wide && column]}>
    <StatusBar barStyle="light-content" backgroundColor={C.bg} />
    {initialLoading && !data ? <View style={styles.loading}><Avatar bot={{ name: 'MyBots', color: 'green', avatar: 'orbit' }} size={110} state="working" /><Text style={styles.loadingTitle}>mybots</Text><Text style={styles.loadingText}>Acordando seu time…</Text></View>
      : !data ? <View style={styles.loading}><Avatar bot={{ name: 'MyBots', color: 'orange', avatar: 'cat' }} size={96} state="waiting" /><Text style={styles.loadingTitle}>Não consegui conectar</Text><Text style={styles.loadingText}>{loadError}</Text><PrimaryButton icon="refresh" title={connectionBusy ? 'Conectando…' : 'Tentar novamente'} disabled={connectionBusy} onPress={() => refresh().catch(error => setLoadError(error.message))} style={{ alignSelf: 'stretch' }} />{desktop ? <DesktopPair compact call={(method, params) => supervisor.current.call(method, params)} /> : <Pressable accessibilityRole="button" onPress={() => setModeVisible(true)} style={styles.changeModeButton}><Text style={styles.changeModeText}>Trocar modo de conexão</Text></Pressable>}</View>
      : wide ? <DesktopShell data={data} error={loadError} selected={room ? null : selected} roomId={roomId} onConnection={checkConnection}
          onOpen={id => { setSelected(id); setRoomId(null); setDraft(''); }} onRoom={id => { setRoomId(id); setSelected(null); }} onCreate={() => setCreateVisible(true)} onNewRoom={() => setRoomSheet({})}
          onProfile={target => setProfileId(target.id)} onActivity={() => setActivityVisible(true)} onMaintenance={() => setMaintenanceVisible(true)} onRespond={respondApproval} approvalBusy={approvalBusy} onComplete={completeItem} call={(method, params) => supervisor.current.call(method, params)}>
          {roomView || chatView}</DesktopShell>
      : roomView || chatView || <HomeScreen data={data} error={loadError} onRetry={() => refresh().catch(error => setLoadError(error.message))} onLogs={openLogs}
            onCreate={() => setCreateVisible(true)} onOpen={id => { setSelected(id); setDraft(''); }} onConnection={checkConnection} mode={mode} onMode={() => setModeVisible(true)} onProfile={target => setProfileId(target.id)} onRespond={respondApproval} approvalBusy={approvalBusy} onMaintenance={() => setMaintenanceVisible(true)} onActivity={() => setActivityVisible(true)}
            update={update} onUpdate={installUpdate} onUpdateDismiss={() => setUpdate(old => ({ ...old, dismissed: true }))}
            onRoom={id => { setRoomId(id); setSelected(null); }} onNewRoom={() => setRoomSheet({})} />}
    {confirm ? <Modal transparent visible animationType="fade" onRequestClose={() => { setConfirm(null); confirm.buttons.find(item => item.style === 'cancel')?.onPress?.(); }}>
      <View style={styles.sheetBackdrop}><View style={[styles.sheet, { maxWidth: 440 }]}>
        <Text style={styles.optionLabel}>{confirm.title}</Text>{confirm.message ? <Text style={[styles.optionDetail, { marginTop: 6 }]}>{confirm.message}</Text> : null}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>{confirm.buttons.map(button => <Pressable key={button.text} accessibilityRole="button" onPress={() => { setConfirm(null); button.onPress?.(); }}
          style={[button.style === 'cancel' ? styles.denyButton : styles.confirmButton, { flex: 1 }, button.style === 'destructive' && { backgroundColor: C.red + '22', borderColor: C.red + '66' }]}>
          <Text style={[styles.denyText, button.style === 'destructive' && { color: C.red }, !button.style && { color: C.mint }]}>{button.text}</Text></Pressable>)}</View>
      </View></View>
    </Modal> : null}
    {data ? <RoomSheet visible={Boolean(roomSheet)} room={roomSheet?.room} bots={data.bots || []} onClose={() => setRoomSheet(null)} onSave={roomSave} onDelete={() => roomDelete(roomSheet.room)} /> : null}
    {data && <BotProfile visible={createVisible || Boolean(profileId)} bot={data.bots.find(item => item.id === profileId)} models={data.models || []} defaultSelection={data.defaultSelection}
      phone={mode === 'phone'} active={data.active?.includes(profileId)} ModelSettings={ModelSettings} connections={data.connections} grants={data.grants?.[profileId] || []} nodes={data.nodes || []}
      memories={(data.memories || []).filter(item => item.botId === profileId)} items={(data.pendingItems || []).filter(item => item.botId === profileId)}
      routines={(data.routines || []).filter(item => item.botId === profileId)}
      accountApps={data.accountApps?.[profileId] || []} accountServers={data.accountServers || []}
      onApps={async apps => { await supervisor.current.call('bot.apps', { botId: profileId, apps }); await loadSupervisorState(); }}
      onFolders={async folders => { await supervisor.current.call('bot.update', { botId: profileId, folders }); await loadSupervisorState(); }}
      skills={(data.skills || []).filter(skill => data.bots.find(item => item.id === profileId)?.skills?.includes(skill.id))}
      onSkill={async (method, id) => {
        if (method === 'skill.remove') await new Promise((resolve, reject) => Alert.alert('Remover a habilidade?', 'O programa e a rotina dele saem deste celular.', [{ text: 'Cancelar', style: 'cancel', onPress: () => reject(new Error('')) }, { text: 'Remover', style: 'destructive', onPress: resolve }]));
        await supervisor.current.call(method, method === 'skill.run' ? { id, botId: profileId } : { id }); await loadSupervisorState();
      }}
      onRoutine={async (method, id, params = {}) => { await supervisor.current.call(method, { id, ...params }); await loadSupervisorState(); }}
      onClose={() => { setCreateVisible(false); setProfileId(null); }} onSave={saveProfile}
      onGrant={async (tool, allowed) => { await supervisor.current.call('grants.set', { botId: profileId, tool, allowed }); await loadSupervisorState(); }}
      onAccess={async access => { await supervisor.current.call('bot.update', { botId: profileId, access }); await loadSupervisorState(); }}
      onComplete={async id => { await supervisor.current.call('item.complete', { id }); await loadSupervisorState(); }}
      onDelete={() => deleteBot(data.bots.find(item => item.id === profileId))} />}
    <Modal transparent visible={maintenanceVisible} animationType="slide" onRequestClose={() => setMaintenanceVisible(false)}>
      <View style={styles.sheetBackdrop}><View style={[styles.sheet, styles.sheetTall]}>
        <View style={styles.sheetHandle} />
        <SheetHeader title="Ajustes" subtitle={desktop ? 'Como o MyBots funciona neste computador.' : 'Como o MyBots funciona neste celular.'} onClose={() => setMaintenanceVisible(false)} />
        <ScrollView style={styles.sheetOptions} contentContainerStyle={{ paddingBottom: 18 }}>
          {mode === 'phone' ? <><Text style={styles.sheetSection}>VOCÊ</Text>
            <PersonName name={data?.person?.name} onSave={async name => { await supervisor.current.call('person.update', { name }); await loadSupervisorState(); }} /></> : null}
          {mode === 'phone' && !desktop ? <><Text style={styles.sheetSection}>FUNCIONAMENTO</Text><ScreenOff heartbeat={data?.heartbeat} nextRoutineAt={data?.nextRoutineAt} /></> : null}
          {mode === 'phone' && !desktop ? <><Text style={styles.sheetSection}>COMPUTADOR</Text><ComputerPanel computer={data?.computer} nodes={data?.nodes}
            onPair={async link => { const result = await supervisor.current.call('computer.pair', { link }); await loadSupervisorState(); return result; }}
            onForget={async () => { await supervisor.current.call('computer.forget', {}); await loadSupervisorState(); }}
            onRetry={async () => { await supervisor.current.call('computer.retry', {}); await loadSupervisorState(); }} /></> : null}
          {desktop ? <><Text style={styles.sheetSection}>CELULAR</Text><DesktopPair call={(method, params) => supervisor.current.call(method, params)} />
            <View style={styles.modeOption}><Text style={styles.optionLabel}>MyBots no computador</Text><Text style={styles.optionDetail}>Esta janela usa os dados do celular pareado. Backup, e-mail por senha de app e senhas de sites ficam nos Ajustes do app do celular.</Text></View></> : <>
          <Text style={styles.sheetSection}>CELULAR</Text>
          {termuxAvailable ? <WidgetRow /> : null}
          <PhoneAccess stats={data?.notifications} lastPoll={data?.botNotices?.lastPoll} /></>}
          {termuxAvailable ? <><Text style={styles.sheetSection}>SENHAS</Text><PasswordsPanel bots={data?.bots || []} /></> : null}
          <Text style={styles.sheetSection}>CONTAS E APPS</Text>
          {desktop ? null : <EmailConnection email={data?.email} busy={maintenanceBusy} onAction={(method, params) => maintenance(async () => {
            const result = await supervisor.current.call(method, params); await loadSupervisorState();
            setMaintenanceText(result?.message || 'Conta de e-mail desconectada.');
          })} />}
          <AccountConnections load={async refresh => supervisor.current.call('account.connectors', { refresh })} />
          {desktop ? null : <AppConnections apps={data?.apps} busy={maintenanceBusy} onAction={(method, params) => maintenance(async () => {
            const result = await supervisor.current.call(method, params); await loadSupervisorState();
            setMaintenanceText(method === 'app.remove' ? 'App desconectado; os bots perderam o acesso a ele.' : result?.status === 'connected' ? `${result.name}: ${result.tools.length} ferramentas disponíveis. Libere no perfil de cada bot.` : result?.message || 'Pronto.');
          })} />}
          {termuxAvailable ? <><Text style={styles.sheetSection}>ATUALIZAÇÕES</Text>
            {update?.info?.available ? <UpdateCard compact update={update} onInstall={installUpdate} />
              : <View style={[styles.modeOption, styles.rowOption]}>
                <View style={styles.rowIcon}><Icon name="check" size={19} color={C.mint} /></View>
                <View style={{ flex: 1 }}><Text style={styles.optionLabel}>MyBots {update?.info?.currentName || ''}</Text>
                  <Text style={[styles.optionDetail, update?.error && { color: C.amber }]}>{update?.checking ? 'Procurando…' : update?.error || (update?.info ? 'Você está na versão mais nova.' : 'O app procura versões novas sozinho ao abrir.')}</Text></View>
                <Pressable accessibilityRole="button" disabled={update?.checking} onPress={() => checkUpdate(true)} style={styles.stopButton}><Icon name="refresh" size={13} color={C.mint} /><Text style={[styles.stopText, { color: C.mint }]}>Procurar</Text></Pressable>
              </View>}</> : null}
          {desktop ? null : <><Text style={styles.sheetSection}>BACKUP E DIAGNÓSTICO</Text>
          <View style={styles.modeOption}><Text selectable style={styles.optionDetail}>{maintenanceText}</Text></View>
          <PrimaryButton icon="download" tone="ghost" title="Salvar backup agora" disabled={maintenanceBusy} onPress={() => maintenance(async () => {
            const backup = await saveBackup(); setMaintenanceText(`Backup salvo em ${backup.path}`);
          })} />
          <PrimaryButton icon="refresh" tone="ghost" title="Restaurar um backup" disabled={maintenanceBusy || Boolean(data?.active?.length)} onPress={() => maintenance(async () => {
            const names = await supervisor.current.call('backup.list');
            setBackupNames(names.sort().reverse()); setMaintenanceText(names.length ? 'Escolha a cópia que deseja restaurar:' : 'Nenhum backup salvo ainda.');
          })} />
          {backupNames.map(name => <Pressable key={name} disabled={maintenanceBusy} onPress={() => restoreBackup(name)} style={styles.modeOption}><Text style={styles.optionLabel}>{name.slice(13, 15)}/{name.slice(11, 13)}/{name.slice(7, 11)} · {name.slice(16, 18)}:{name.slice(18, 20)}:{name.slice(20, 22)} UTC</Text><Text style={styles.optionDetail}>Restaurar esta cópia</Text></Pressable>)}
          <PrimaryButton icon="info" tone="ghost" title="Ver diagnóstico do aparelho" disabled={maintenanceBusy} onPress={() => maintenance(async () => {
            const device = await readDeviceInfo();
            const result = await supervisor.current.call('environment.get');
            setMaintenanceText(`${device}\n\n${result.report}`);
          })} />
          <Pressable disabled={maintenanceBusy} onPress={() => copyTermuxText(maintenanceText).catch(error => setMaintenanceText(error.message))} style={styles.closeSheet}><Icon name="copy" size={16} color={C.mint} /><Text style={styles.closeSheetText}>Copiar informações</Text></Pressable></>}
        </ScrollView>
      </View></View>
    </Modal>
    <Modal transparent visible={activityVisible} animationType="slide" onRequestClose={() => setActivityVisible(false)}>
      <View style={styles.sheetBackdrop}><View style={[styles.sheet, styles.sheetTall]}>
        <View style={styles.sheetHandle} />
        <SheetHeader title="Atividade" subtitle={`${data?.supervisorConnected ? 'Supervisor conectado' : 'Supervisor desconectado'} · último sinal ${data?.heartbeat ? new Date(data.heartbeat).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'não confirmado'}`} onClose={() => setActivityVisible(false)} />
        <ScrollView style={styles.sheetOptions} contentContainerStyle={{ paddingBottom: 18 }}>
          {mode === 'phone' ? <><Text style={styles.sheetSection}>USO</Text><UsagePanel usage={data?.usage} bots={data?.bots || []} connections={data?.connections}
            onRefresh={async provider => { await supervisor.current.call('limits.refresh', { provider }); await loadSupervisorState(); }} /></> : null}
          {mode === 'phone' ? <Text style={styles.sheetSection}>FUNCIONAMENTO</Text> : null}
          {mode === 'phone' ? <View style={styles.modeOption}>
            <Text style={styles.optionLabel}>Interrupções · {(data?.interruptions || []).length ? `${data.interruptions.filter(item => Date.now() - Date.parse(item.created_at) < 7 * 86400000).length} nos últimos 7 dias` : 'nenhuma registrada'}</Text>
            {(data?.interruptions || []).slice(0, 5).map(item => <View key={item.id} style={styles.interruption}><Icon name={item.kind === 'supervisor_restarted' ? 'refresh' : 'pause'} size={14} color={item.kind === 'supervisor_restarted' ? C.mint : C.amber} /><Text style={[styles.optionDetail, { flex: 1, marginTop: 0 }]}>{item.detail}</Text></View>)}
            {!(data?.interruptions || []).length ? <Text style={styles.optionDetail}>Quando o celular pausar ou parar o supervisor, aparece aqui quando foi e como ele voltou.</Text> : null}
          </View> : null}
          {(data?.approvals || []).length ? <Text style={styles.sheetSection}>DECISÕES</Text> : null}
          {(data?.approvals || []).map(approval => <ApprovalCard key={approval.id} approval={approval} bot={data.bots.find(item => item.id === approval.botId)} onRespond={respondApproval} busy={approvalBusy === approval.id} />)}
          <ItemsByDeadline items={(data?.pendingItems || []).filter(item => item.state === 'open')} bots={data?.bots || []} onComplete={completeItem} />
          {(data?.tasks || []).filter(task => ['queued','running','waiting_approval'].includes(task.state)).length ? <Text style={styles.sheetSection}>EM ANDAMENTO</Text> : null}
          {(data?.tasks || []).filter(task => ['queued','running','waiting_approval'].includes(task.state)).map(task => <View key={task.id} style={[styles.modeOption, styles.rowOption]}>
            <Avatar bot={data.bots.find(item => item.id === task.bot_id) || { name: 'Bot' }} size={36} state={task.state === 'waiting_approval' ? 'waiting' : 'working'} tile={false} />
            <View style={{ flex: 1 }}><Text style={styles.optionLabel}>{data?.bots?.find(item => item.id === task.bot_id)?.name || 'Bot'}</Text><Text style={styles.optionDetail}>{({ queued: 'Na fila', running: 'Respondendo', waiting_approval: 'Aguardando decisão' })[task.state]}</Text></View>
            <Pressable accessibilityRole="button" onPress={() => cancelTask(task.id)} style={styles.stopButton}><Icon name="stop" size={13} color={C.muted} /><Text style={styles.stopText}>Parar</Text></Pressable>
          </View>)}
          <Text style={styles.sheetSection}>HISTÓRICO</Text>
          <View style={styles.timeline}>{(data?.activity || []).slice(0, 40).map(item => <View key={item.id} style={styles.timelineRow}>
            <View style={[styles.timelineDot, /fail|denied|late|error/.test(item.kind) && { backgroundColor: C.red }, /approval/.test(item.kind) && { backgroundColor: C.amber }, /done|created|accepted|reminder|downloaded/.test(item.kind) && { backgroundColor: C.mint }]} />
            <View style={{ flex: 1 }}><Text style={styles.timelineText}>{item.detail}</Text><Text style={styles.timelineMeta}>{data.bots.find(bot => bot.id === item.bot_id)?.name ? `${data.bots.find(bot => bot.id === item.bot_id).name} · ` : ''}{new Date(item.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</Text></View>
          </View>)}</View>
        </ScrollView>
      </View></View>
    </Modal>
    <Modal transparent visible={Boolean(fileSheet)} animationType="slide" onRequestClose={() => { setFileSheet(null); setFileNote(''); }}>
      <View style={styles.sheetBackdrop}><View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        {fileSheet ? <View style={{ alignItems: 'center', marginBottom: 6 }}><FileBadge file={fileSheet} size={64} /></View> : null}
        <SheetHeader title={fileSheet?.name || ''} subtitle={`${fileSheet ? formatSize(fileSheet.size) : ''}${fileBusy ? ' · preparando…' : ''}`} onClose={() => { setFileSheet(null); setFileNote(''); }} />
        {(desktop ? [['open', 'Abrir', 'No programa padrão do computador (fica salvo em Downloads).', 'open'], ['save', 'Salvar em Downloads', 'Na pasta Downloads do computador.', 'download']]
          : [['open', 'Abrir', 'Num app do celular que abra este tipo de arquivo.', 'open'], ['share', 'Compartilhar', 'WhatsApp, Drive, e-mail ou outro app.', 'share'], ['save', 'Salvar em Downloads', 'Fica na pasta Download/MyBots.', 'download']]).map(([action, title, detail, icon]) =>
          <Pressable key={action} accessibilityRole="button" disabled={Boolean(fileBusy)} onPress={() => fileAct(fileSheet, action)} style={({ pressed }) => [styles.modeOption, styles.rowOption, fileBusy && { opacity: 0.5 }, pressed && styles.pressed]}>
            <View style={styles.rowIcon}><Icon name={icon} size={19} color={C.mint} /></View>
            <View style={{ flex: 1 }}><Text style={styles.optionLabel}>{title}</Text><Text style={styles.optionDetail}>{detail}</Text></View>
            {fileBusy === fileSheet?.id ? <ActivityIndicator color={C.mint} /> : <Icon name="right" size={16} color={C.faint} />}
          </Pressable>)}
        {fileNote ? <View style={styles.fileNote}><Icon name={/Salvo/.test(fileNote) ? 'check' : 'info'} size={16} color={/Salvo/.test(fileNote) ? C.mint : C.amber} /><Text selectable style={styles.fileNoteText}>{fileNote}</Text></View> : null}
      </View></View>
    </Modal>
    {data && !share?.botId ? <ShareSheet share={share} bots={data.bots || []} phone={mode === 'phone'} onPick={pickShare} onClose={() => setShare(null)} /> : null}
    <ModeSheet visible={modeVisible} mode={mode} onClose={() => setModeVisible(false)} onSelect={changeMode} />
    <TermuxLogModal visible={logsVisible} log={termuxLog} copied={logsCopied} onClose={() => setLogsVisible(false)} onCopy={copyLogs} />
  </View>;
}

const TOP = desktop ? 0 : Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 50;
const card = { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 22 };
const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: C.bg },
  pressed: { opacity: 0.72, transform: [{ scale: 0.985 }] },
  // Buttons
  primaryButton: { minHeight: 52, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, borderRadius: 18, backgroundColor: C.mint, marginTop: 10 },
  primaryButtonText: { color: C.mintInk, fontFamily: F.b, fontSize: 15 },
  compactButton: { minHeight: 46, borderRadius: 15, marginTop: 0, paddingHorizontal: 14 }, compactButtonText: { fontSize: 14 },
  ghostButton: { backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line2 }, ghostButtonText: { color: C.text },
  buttonDisabled: { opacity: 0.4 },
  iconButton: { alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line },
  iconButtonActive: { backgroundColor: C.mint + '1C', borderColor: C.mint + '55' },
  dots: { flexDirection: 'row', gap: 3, alignItems: 'center', marginLeft: 5, height: 14 }, dot: { width: 4.5, height: 4.5, borderRadius: 3 },
  // Loading
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 12 },
  loadingTitle: { color: C.text, fontFamily: F.x, fontSize: 26, letterSpacing: -0.8, marginTop: 10, textAlign: 'center' },
  loadingText: { color: C.muted, fontFamily: F.m, fontSize: 15, textAlign: 'center', lineHeight: 22 },
  changeModeButton: { alignItems: 'center', padding: 12 }, changeModeText: { color: C.mint, fontFamily: F.b, fontSize: 14 },
  // Home
  homeContent: { paddingHorizontal: 18, paddingTop: TOP + 12, paddingBottom: 120 },
  homeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  brand: { color: C.text, fontFamily: F.x, fontSize: 21, letterSpacing: -0.8 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modeButton: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 38, paddingHorizontal: 12, borderRadius: 14, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line },
  modeButtonText: { color: C.text2, fontFamily: F.s, fontSize: 12 },
  scanner: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  scannerFrame: { width: 250, height: 250, borderRadius: 28, borderWidth: 3, borderColor: C.mint },
  scannerText: { color: '#fff', fontFamily: F.b, fontSize: 15, marginTop: 24, textAlign: 'center', paddingHorizontal: 30 },
  scannerClose: { position: 'absolute', bottom: 60, backgroundColor: '#000000AA', paddingHorizontal: 26, paddingVertical: 14, borderRadius: 18, borderWidth: 1, borderColor: C.line2 },
  desk: { flex: 1, flexDirection: 'row', backgroundColor: C.bg },
  side: { width: 310, borderRightWidth: 1, borderRightColor: C.line, backgroundColor: C.bg2, paddingTop: 14 },
  sideHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  sideGreeting: { color: C.text2, fontFamily: F.b, fontSize: 14, paddingHorizontal: 16, marginTop: 12 },
  sideSearch: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 12, marginTop: 12, marginBottom: 6, paddingHorizontal: 12, height: 38, borderRadius: 12, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  sideSearchInput: { flex: 1, color: C.text, fontFamily: F.m, fontSize: 13.5, outlineStyle: 'none' },
  sideSection: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginTop: 14, marginBottom: 4 },
  sideSectionText: { color: C.faint, fontFamily: F.x, fontSize: 10.5, letterSpacing: 1.4 },
  sideRow: { flexDirection: 'row', alignItems: 'center', gap: 11, marginHorizontal: 8, paddingHorizontal: 9, paddingVertical: 8, borderRadius: 14 },
  sideRowHover: { backgroundColor: C.surface }, sideRowOn: { backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line2 },
  sideDot: { position: 'absolute', right: -2, bottom: -2, width: 12, height: 12, borderRadius: 6, borderWidth: 2.5, borderColor: C.bg2 },
  sideTitle: { flex: 1, color: C.text, fontFamily: F.b, fontSize: 14 }, sideTime: { color: C.faint, fontFamily: F.m, fontSize: 11 },
  sideLine: { color: C.muted, fontFamily: F.m, fontSize: 12.5, marginTop: 2, flexShrink: 1 },
  sideEmpty: { color: C.muted, fontFamily: F.m, fontSize: 13, paddingHorizontal: 16, paddingVertical: 10, lineHeight: 19 },
  sideFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.line },
  sideStatus: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 }, sideStatusText: { color: C.muted, fontFamily: F.s, fontSize: 12.5 },
  deskMain: { flex: 1, minWidth: 0 },
  deskWelcome: { width: '100%', maxWidth: 760, marginHorizontal: 'auto', paddingHorizontal: 32, paddingTop: 44, paddingBottom: 40 },
  deskHint: { alignItems: 'center', marginTop: 40, paddingHorizontal: 20 },
  today2: { width: 330, flexGrow: 0, borderLeftWidth: 1, borderLeftColor: C.line, backgroundColor: C.bg2 },
  todayTitle: { color: C.text, fontFamily: F.x, fontSize: 20, letterSpacing: -0.4, marginBottom: 10 },
  todaySpace: { marginTop: 18, marginBottom: 6, paddingHorizontal: 0 },
  todayRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line },
  todayCheck: { width: 18, height: 18, borderRadius: 6, borderWidth: 2, borderColor: C.line2, marginTop: 2 },
  todayRowTitle: { color: C.text, fontFamily: F.s, fontSize: 13.5, lineHeight: 18 }, todayRowMeta: { color: C.faint, fontFamily: F.m, fontSize: 11.5, marginTop: 2 },
  todayEmpty: { color: C.muted, fontFamily: F.m, fontSize: 12.5, paddingVertical: 4 }, todayMore: { color: C.mint, fontFamily: F.b, fontSize: 12 },
  todayActivity: { paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: C.line }, todayActivityText: { color: C.text2, fontFamily: F.m, fontSize: 12.5, lineHeight: 17, marginTop: 2 },
  confirmButton: { minHeight: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line2, backgroundColor: C.surface2 },
  pairQr: { alignSelf: 'center', alignItems: 'center', gap: 8, marginTop: 12, padding: 14, borderRadius: 18, backgroundColor: '#FFFFFF' },
  presenceDot: { position: 'absolute', right: -2, bottom: -2, width: 15, height: 15, borderRadius: 8, borderWidth: 3, borderColor: C.surface, backgroundColor: C.faint },
  presenceOn: { backgroundColor: C.mint },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.faint }, statusGood: { backgroundColor: C.mint, shadowColor: C.mint, shadowOpacity: 1, shadowRadius: 6 },
  greeting: { color: C.text, fontFamily: F.x, fontSize: 32, letterSpacing: -1.2, marginTop: 26 },
  tagline: { color: C.muted, fontFamily: F.m, fontSize: 14, marginTop: 4, marginBottom: 18 },
  todayScroll: { marginHorizontal: -18, marginBottom: 22, flexGrow: 0 }, today: { paddingHorizontal: 18, gap: 10 },
  todayTile: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingLeft: 11, paddingRight: 16, borderRadius: 18, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, maxWidth: 230 },
  todayIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  todayLabel: { color: C.text, fontFamily: F.b, fontSize: 13.5 }, todayDetail: { color: C.muted, fontFamily: F.m, fontSize: 11.5, marginTop: 1 },
  calm: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, backgroundColor: C.mint + '0F', borderWidth: 1, borderColor: C.mint + '26', marginBottom: 22 },
  calmText: { color: C.text2, fontFamily: F.m, fontSize: 13, flex: 1 },
  listHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { color: C.text, fontFamily: F.x, fontSize: 19, letterSpacing: -0.4 },
  newBotButton: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 36, paddingHorizontal: 13, borderRadius: 13, backgroundColor: C.mint + '17', borderWidth: 1, borderColor: C.mint + '33' },
  newBotText: { color: C.mint, fontFamily: F.b, fontSize: 13 },
  botCard: { ...card, flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, marginBottom: 11 },
  botCardWaiting: { borderColor: C.amber + '80', backgroundColor: '#17140F' },
  botCardCopy: { flex: 1, gap: 3 },
  botNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  botCardName: { color: C.text, fontFamily: F.b, fontSize: 16.5, flexShrink: 1, letterSpacing: -0.2 },
  botTime: { color: C.faint, fontFamily: F.m, fontSize: 11.5, marginLeft: 'auto' },
  botPreview: { color: C.muted, fontFamily: F.m, fontSize: 13.5 },
  botWorking: { flexDirection: 'row', alignItems: 'center' },
  botStatusRow: { flexDirection: 'row', gap: 6, marginTop: 5, flexWrap: 'wrap' },
  botChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3.5, borderRadius: 9, backgroundColor: C.surface2 },
  botChipText: { color: C.muted, fontFamily: F.s, fontSize: 11 },
  cardMore: { width: 30, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -4 },
  emptyBots: { ...card, alignItems: 'center', padding: 26, paddingTop: 30 },
  emptyCrew: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 20 },
  emptyTitle: { color: C.text, fontFamily: F.x, fontSize: 24, letterSpacing: -0.6 },
  emptyText: { color: C.muted, fontFamily: F.m, fontSize: 14.5, lineHeight: 21, textAlign: 'center', marginTop: 8 },
  homeFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 18 },
  homeFooterText: { color: C.faint, fontFamily: F.m, fontSize: 12 },
  bottomNav: { position: 'absolute', left: 16, right: 16, bottom: 16, height: 66, flexDirection: 'row', alignItems: 'center', padding: 6, borderRadius: 24, backgroundColor: C.surface2 + 'F5', borderWidth: 1, borderColor: C.line2, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 20, elevation: 12 },
  navItem: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: 18 },
  navItemActive: { backgroundColor: C.mint + '14' },
  navText: { color: C.muted, fontFamily: F.s, fontSize: 11 }, navTextActive: { color: C.mint, fontFamily: F.b, fontSize: 11 },
  navBadge: { position: 'absolute', top: -2, right: -4, width: 9, height: 9, borderRadius: 5, backgroundColor: C.amber, borderWidth: 2, borderColor: C.surface2 },
  // Notices and approvals
  notice: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13, marginBottom: 14, borderRadius: 18, backgroundColor: '#1B1710', borderWidth: 1, borderColor: C.amber + '40' },
  noticeIcon: { width: 34, height: 34, borderRadius: 12, backgroundColor: C.amber + '1A', alignItems: 'center', justifyContent: 'center' },
  noticeCopy: { flex: 1, gap: 2 }, noticeTitle: { color: C.amber, fontFamily: F.b, fontSize: 13 }, noticeText: { color: C.text2, fontFamily: F.m, fontSize: 12.5, lineHeight: 18 },
  noticeActions: { alignItems: 'flex-end', gap: 2 }, noticeRetry: { minWidth: 52, alignItems: 'center', paddingVertical: 6 },
  noticeRetryText: { color: C.amber, fontFamily: F.b, fontSize: 13 }, noticeLogsText: { color: C.muted, fontFamily: F.s, fontSize: 12 },
  approvalCard: { padding: 16, borderRadius: 22, borderWidth: 1, borderColor: C.amber + '55', backgroundColor: '#17140F', marginBottom: 14, shadowColor: C.amber, shadowOpacity: 0.18, shadowRadius: 16, elevation: 3 },
  approvalHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  approvalEyebrow: { color: C.amber, fontFamily: F.x, fontSize: 10, letterSpacing: 1.4 },
  approvalTitle: { color: C.text, fontFamily: F.b, fontSize: 15, lineHeight: 21, marginTop: 3 },
  approvalBody: { color: C.text2, fontFamily: F.m, fontSize: 13.5, lineHeight: 20, marginTop: 13, padding: 12, borderRadius: 14, backgroundColor: '#00000040' },
  approvalHintRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10 },
  approvalHint: { color: C.faint, fontFamily: F.m, fontSize: 11.5, flex: 1 },
  approvalActions: { flexDirection: 'row', gap: 9, marginTop: 13 },
  denyButton: { flex: 1, minHeight: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line2 },
  denyText: { color: C.text, fontFamily: F.b, fontSize: 14 },
  alwaysButton: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', minHeight: 40, marginTop: 6 },
  alwaysText: { color: C.amber, fontFamily: F.b, fontSize: 13 },
  // Chat
  chatScreen: { flex: 1, backgroundColor: C.bg },
  chatHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: TOP + 8, paddingBottom: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: C.line, backgroundColor: C.bg2 },
  chatTitleCopy: { flex: 1, minWidth: 0 },
  chatTitle: { color: C.text, fontFamily: F.x, fontSize: 18, letterSpacing: -0.4 },
  chatSubtitle: { color: C.muted, fontFamily: F.s, fontSize: 12, marginTop: 1 },
  modelToggle: { flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-start' },
  modelPanel: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, backgroundColor: C.bg2, borderBottomWidth: 1, borderBottomColor: C.line },
  messages: { flex: 1 }, messagesContent: { paddingHorizontal: 14, paddingTop: 18, paddingBottom: 18, gap: 16 },
  messageRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  userMessageRow: { justifyContent: 'flex-end', paddingLeft: 48 },
  messageBubble: { flexShrink: 1 },
  assistantBubble: { flex: 1, paddingTop: 2 },
  userBubble: { backgroundColor: '#1A3328', borderRadius: 22, borderBottomRightRadius: 7, paddingHorizontal: 15, paddingTop: 10, paddingBottom: 7, borderWidth: 1, borderColor: C.mint + '2A' },
  messageMeta: { flexDirection: 'row', alignItems: 'baseline', gap: 7, marginBottom: 5, flexWrap: 'wrap' },
  messageSpeaker: { color: C.text, fontFamily: F.b, fontSize: 13.5 },
  messageTime: { color: C.faint, fontFamily: F.m, fontSize: 11 },
  userTime: { color: C.mint + '99', fontFamily: F.m, fontSize: 10.5, alignSelf: 'flex-end', marginTop: 3 },
  messageText: { color: C.text, fontFamily: F.r, fontSize: 15.5, lineHeight: 23 },
  messageFiles: { gap: 7, marginBottom: 8 },
  messageError: { marginTop: 9, padding: 11, gap: 8, borderRadius: 14, backgroundColor: C.red + '14', borderWidth: 1, borderColor: C.red + '33' },
  messageErrorText: { color: '#FFC2C2', fontFamily: F.m, fontSize: 13, lineHeight: 19 },
  retryButton: { flexDirection: 'row', gap: 6, alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 11, backgroundColor: C.surface2 },
  retryText: { color: C.text, fontFamily: F.b, fontSize: 12.5 },
  routineRow: { alignItems: 'center', gap: 6 },
  routineChip: { maxWidth: '92%', paddingHorizontal: 13, paddingVertical: 8, borderRadius: 16, backgroundColor: C.sky + '12', borderWidth: 1, borderColor: C.sky + '2E' },
  routineChipHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  routineChipText: { color: C.text2, fontFamily: F.s, fontSize: 12, flexShrink: 1 },
  routineDetail: { color: C.text2, fontFamily: F.r, fontSize: 13, lineHeight: 19, marginTop: 8 },
  chatEmpty: { alignItems: 'center', paddingTop: 34, paddingHorizontal: 12, gap: 6 },
  chatEmptyTitle: { color: C.text, fontFamily: F.x, fontSize: 23, letterSpacing: -0.6, marginTop: 14 },
  chatEmptyText: { color: C.muted, fontFamily: F.m, fontSize: 14.5, lineHeight: 21, textAlign: 'center', marginBottom: 12 },
  greetingButton: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, minHeight: 46, borderRadius: 16, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line2, alignSelf: 'stretch', justifyContent: 'space-between' },
  greetingText: { color: C.text, fontFamily: F.s, fontSize: 14 },
  thinking: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  thinkingCard: { flex: 1, padding: 12, borderRadius: 18, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, gap: 4 },
  thinkingText: { color: C.text, fontFamily: F.b, fontSize: 14 },
  thinkingStep: { color: C.muted, fontFamily: F.m, fontSize: 12.5 },
  stopButton: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 11, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line2 },
  stopText: { color: C.text2, fontFamily: F.b, fontSize: 12 },
  composerArea: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 14, backgroundColor: C.bg },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 6, borderRadius: 28, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line2 },
  composerTool: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: C.elevated },
  messageInput: { flex: 1, minHeight: 44, maxHeight: 140, color: C.text, fontFamily: F.r, fontSize: 15.5, paddingHorizontal: 6, paddingTop: 11, paddingBottom: 11 },
  sendButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: C.mint },
  micButton: { backgroundColor: C.elevated },
  sendDisabled: { opacity: 0.35 },
  composerError: { color: C.red, fontFamily: F.m, fontSize: 12.5, marginBottom: 6, marginLeft: 6 },
  fileTray: { flexGrow: 0, marginBottom: 8 },
  fileChip: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: C.surface2, borderRadius: 16, paddingLeft: 6, paddingRight: 11, paddingVertical: 6, maxWidth: 250, borderWidth: 1, borderColor: C.line2 },
  fileChipText: { color: C.text2, fontFamily: F.s, fontSize: 12, flexShrink: 1 },
  updateCard: { backgroundColor: C.surface, borderRadius: 20, borderWidth: 1, borderColor: C.mint + '45', padding: 14, marginBottom: 12 },
  updateHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  updateIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: C.mint + '1F', alignItems: 'center', justifyContent: 'center' },
  updateNotesToggle: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10, alignSelf: 'flex-start' },
  updateNotesLink: { color: C.mint, fontFamily: F.s, fontSize: 13 },
  updateNotes: { marginTop: 8, padding: 12, borderRadius: 14, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.line },
  updateBar: { height: 6, borderRadius: 3, backgroundColor: C.line, overflow: 'hidden', marginTop: 12, marginBottom: 2 },
  limitRow: { marginTop: 10 },
  roomHint: { color: C.muted, fontFamily: F.m, fontSize: 13, lineHeight: 19, marginBottom: 6 },
  roomGone: { color: C.faint, fontFamily: F.m, fontSize: 12, textAlign: 'center', marginVertical: 6 },
  mentionBar: { flexGrow: 0, marginBottom: 8 },
  mentionChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 4, paddingRight: 11, paddingVertical: 4, borderRadius: 16, borderWidth: 1, borderColor: C.line2, backgroundColor: C.surface2 },
  mentionChipOn: { borderColor: C.mint + '80', backgroundColor: C.mint + '14' },
  mentionText: { color: C.text2, fontFamily: F.s, fontSize: 12.5 },
  passwordRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  botChoice: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14, borderWidth: 1, borderColor: C.line2, backgroundColor: C.surface2 },
  botChoiceOn: { borderColor: C.mint + '80', backgroundColor: C.mint + '14' },
  botChoiceText: { color: C.text2, fontFamily: F.s, fontSize: 12.5 },
  limitHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  limitName: { color: C.text2, fontFamily: F.s, fontSize: 13, flexShrink: 1 },
  limitValue: { color: C.text, fontFamily: F.b, fontSize: 13 },
  limitMeta: { color: C.faint, fontFamily: F.m, fontSize: 11.5, lineHeight: 16, marginTop: 4 },
  usageChart: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, height: 92, marginTop: 12, marginBottom: 6 },
  usageDay: { flex: 1, alignItems: 'center', gap: 5, height: '100%' },
  usageTrack: { flex: 1, width: '100%', justifyContent: 'flex-end', borderRadius: 7, backgroundColor: C.bg2 },
  usageColumn: { width: '100%', borderRadius: 7, backgroundColor: C.mint },
  usageDayText: { color: C.faint, fontFamily: F.s, fontSize: 10.5 },
  usageBot: { flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 14 },
  usageShare: { height: 5, borderRadius: 3, backgroundColor: C.line, overflow: 'hidden', marginTop: 6 },
  usageShareFill: { height: 5, borderRadius: 3 },
  updateNotesText: { color: C.text2, fontFamily: F.m, fontSize: 13, lineHeight: 19 },
  updateFill: { height: 6, borderRadius: 3, backgroundColor: C.mint },
  sharePreview: { backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.line, padding: 12, gap: 8, marginBottom: 10 },
  sharePreviewText: { color: C.text2, fontFamily: F.m, fontSize: 13, lineHeight: 19 },
  shareFiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  shareProblem: { color: C.amber, fontFamily: F.m, fontSize: 12, lineHeight: 17 },
  voiceBar: { alignItems: 'center' }, voiceLive: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  voiceLevels: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 24 }, voiceLevel: { width: 4, borderRadius: 2, backgroundColor: C.mint },
  voiceText: { flex: 1, color: C.text, fontFamily: F.m, fontSize: 14 }, voiceDone: {},
  // Model choice
  settingsRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  settingsHint: { color: C.faint, fontFamily: F.m, fontSize: 11.5, marginBottom: 8 },
  choiceField: { flex: 1, minHeight: 56, justifyContent: 'center', paddingHorizontal: 13, paddingRight: 30, borderRadius: 16, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line2 },
  choiceDisabled: { opacity: 0.45 },
  choiceLabel: { color: C.muted, fontFamily: F.s, fontSize: 11 }, choiceValue: { color: C.text, fontFamily: F.b, fontSize: 14, marginTop: 2 },
  choiceChevron: { position: 'absolute', right: 12, top: 17, color: C.muted, fontSize: 16 },
  // Sheets
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#000000B3', ...dialogBackdrop },
  sheet: { ...column, maxHeight: '88%', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 24, borderTopLeftRadius: 30, borderTopRightRadius: 30, backgroundColor: C.bg2, borderTopWidth: 1, borderColor: C.line2, ...dialogShape, ...(desktop ? { maxWidth: 720, paddingTop: 18 } : {}) },
  sheetTall: { height: '90%' },
  sheetHandle: { alignSelf: 'center', width: 42, height: 5, borderRadius: 3, backgroundColor: C.line2, marginBottom: 12, ...noHandle },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  sheetIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: C.mint + '17' },
  sheetTitle: { color: C.text, fontFamily: F.x, fontSize: 22, letterSpacing: -0.6 },
  sheetSubtitle: { color: C.muted, fontFamily: F.m, fontSize: 13, marginTop: 2, lineHeight: 18 },
  sheetSection: { color: C.faint, fontFamily: F.x, fontSize: 11, letterSpacing: 1.6, marginTop: 16, marginBottom: 8, marginLeft: 4 },
  sheetOptions: { flexGrow: 0 },
  modeIntro: { color: C.muted, fontFamily: F.m, fontSize: 13, lineHeight: 19, marginBottom: 10 },
  modeOption: { padding: 15, borderRadius: 20, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, marginBottom: 9 },
  rowOption: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface2 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 15, borderRadius: 18, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, marginBottom: 8 },
  optionChosen: { borderColor: C.mint + '66', backgroundColor: C.mint + '0D' },
  optionCopy: { flex: 1 },
  optionLabel: { color: C.text, fontFamily: F.b, fontSize: 15 }, optionLabelChosen: { color: C.mint },
  optionDetail: { color: C.muted, fontFamily: F.m, fontSize: 13, lineHeight: 19, marginTop: 3 },
  optionCheck: { color: C.mint, fontSize: 18, fontFamily: F.b },
  appRow: { borderTopWidth: 1, borderColor: C.line, paddingTop: 11, marginTop: 11, gap: 4 },
  appActions: { flexDirection: 'row', gap: 16, flexWrap: 'wrap', marginTop: 6 },
  deleteText: { color: C.mint, fontFamily: F.b, fontSize: 13.5 },
  formInput: { minHeight: 50, color: C.text, fontFamily: F.m, fontSize: 15, paddingHorizontal: 14, borderRadius: 15, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line2, marginTop: 8 },
  closeSheet: { flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', minHeight: 48, borderRadius: 16, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, marginTop: 10 },
  closeSheetText: { color: C.mint, fontFamily: F.b, fontSize: 14 },
  fileNote: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 15, backgroundColor: C.surface2, marginTop: 4 },
  fileNoteText: { color: C.text2, fontFamily: F.m, fontSize: 13, flex: 1, lineHeight: 18 },
  itemCheck: { width: 26, height: 26, borderRadius: 13, borderWidth: 2 },
  dueTag: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 9, marginTop: 7 },
  dueTagText: { fontFamily: F.b, fontSize: 11.5 },
  interruption: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 8 },
  timeline: { paddingLeft: 6 },
  timelineRow: { flexDirection: 'row', gap: 12, paddingBottom: 14, borderLeftWidth: 1, borderLeftColor: C.line, paddingLeft: 14, marginLeft: 4 },
  timelineDot: { position: 'absolute', left: -5, top: 4, width: 9, height: 9, borderRadius: 5, backgroundColor: C.faint, borderWidth: 2, borderColor: C.bg2 },
  timelineText: { color: C.text2, fontFamily: F.m, fontSize: 13.5, lineHeight: 19 },
  timelineMeta: { color: C.faint, fontFamily: F.m, fontSize: 11.5, marginTop: 2 },
  // Termux log
  logsSheet: { maxHeight: '88%', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 24, borderTopLeftRadius: 30, borderTopRightRadius: 30, backgroundColor: C.bg2, borderTopWidth: 1, borderColor: C.line2 },
  logsHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 }, logsHeadingCopy: { flex: 1 },
  logsHint: { color: C.muted, fontFamily: F.m, fontSize: 13, marginTop: 3 },
  logsScroll: { maxHeight: 360, borderRadius: 16, backgroundColor: '#05070A', borderWidth: 1, borderColor: C.line },
  logsContent: { padding: 13 }, logsText: { color: '#CFE3D8', fontFamily: 'monospace', fontSize: 11.5, lineHeight: 17 },
  logsPrivacy: { color: C.faint, fontFamily: F.m, fontSize: 11.5, marginTop: 10 },
  modalClose: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface2 },
  modalCloseText: { color: C.text2, fontSize: 22, lineHeight: 24 }
});
