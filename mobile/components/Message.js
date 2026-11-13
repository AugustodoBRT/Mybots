import { desktop } from '../desktop';
import { sameMessage } from '../message-cache';
import { memo, useState } from 'react';
import { View, Pressable, Text, TextInput } from 'react-native';
import { styles } from '../styles';
import { Icon, C, F } from '../theme';
import { claudeName, findModel, EFFORT_NAMES, Avatar, tokensLabel } from './shared';
import { FileChip, FileCard, RichText } from '../RichMessage';
import { ImageBubble } from './ImageBubble';
import { isPicture } from '../attachment-images';
import { copyText } from '../termux';

/** On the computer, a quiet button that copies the message; it shows while the pointer is over the message. */
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  if (!desktop || !String(text || '').trim()) return null;
  return <Pressable accessibilityRole="button" accessibilityLabel={copied ? 'Mensagem copiada' : 'Copiar mensagem'} dataSet={{ hoverOnly: copied ? 'shown' : 'true' }} hitSlop={6}
    onPress={async () => { try { await copyText(String(text).trim()); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch {} }}
    style={({ hovered }) => [{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 22, paddingHorizontal: 6, borderRadius: 6 }, hovered && { backgroundColor: C.text + '12' }]}>
    <Icon name={copied ? 'check' : 'copy'} size={13} color={copied ? C.good : C.muted} /><Text style={{ color: copied ? C.good : C.muted, fontFamily: F.m, fontSize: 11 }}>{copied ? 'Copiado' : 'Copiar'}</Text></Pressable>;
}

// Answers a bot's decision (user_decide); App sets it to the supervisor call, so the cards need no extra prop through the lists.
export const decisionHandler = { current: null };

/** A bot's question with options to tap and, always last, "Escrever minha resposta"; after the answer, what was chosen stays marked. */
export function DecisionCard({ decision }) {
  const [writing, setWriting] = useState(false), [text, setText] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const done = decision.answer !== undefined && decision.answer !== null, closed = done || decision.expired;
  const send = async answer => {
    if (busy || closed || !decisionHandler.current) return;
    setBusy(true); setError('');
    try { await decisionHandler.current(decision.id, answer); setWriting(false); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const pill = (label, chosen, onPress, key) => <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected: chosen, disabled: closed || busy }} disabled={closed || busy} onPress={onPress}
    style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: chosen ? C.accent : C.line2, backgroundColor: chosen ? C.accent + '22' : C.surface2 }, pressed && { opacity: 0.7 }, closed && !chosen && { opacity: 0.45 }]}>
    {chosen ? <Icon name="check" size={15} color={C.accent} /> : null}<Text style={{ flex: 1, color: chosen ? C.accent : C.text, fontFamily: F.s, fontSize: 14.5 }}>{label}</Text></Pressable>;
  return <View style={{ gap: 8, marginTop: 10 }}>
    {decision.options.map((option, index) => pill(option, done && !decision.written && decision.answer === option, () => send({ option: index + 1 }), option))}
    {done && decision.written ? pill(decision.answer, true, null, 'written') : null}
    {!closed ? (writing ? <View style={{ gap: 8 }}>
      <TextInput value={text} onChangeText={setText} autoFocus multiline maxLength={4000} placeholder="Sua resposta…" placeholderTextColor={C.faint}
        style={{ minHeight: 44, borderRadius: 14, borderWidth: 1, borderColor: C.line2, backgroundColor: C.surface2, color: C.text, fontFamily: F.m, fontSize: 14.5, paddingHorizontal: 14, paddingVertical: 10 }} />
      <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
        <Pressable accessibilityRole="button" onPress={() => setWriting(false)} style={{ paddingVertical: 8, paddingHorizontal: 12 }}><Text style={{ color: C.muted, fontFamily: F.m }}>Cancelar</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={!text.trim() || busy} onPress={() => send({ text: text.trim() })} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 12, backgroundColor: C.accent, opacity: text.trim() && !busy ? 1 : 0.5 }}>
          <Icon name="send" size={14} color={C.accentInk} /><Text style={{ color: C.accentInk, fontFamily: F.b }}>Enviar</Text></Pressable>
      </View></View>
      : pill('Escrever minha resposta', false, () => setWriting(true), 'write')) : null}
    {decision.expired ? <Text style={{ color: C.muted, fontFamily: F.m, fontSize: 12.5 }}>{decision.replaced ? 'Substituída por uma pergunta mais nova logo abaixo.' : 'Expirou sem resposta; o bot seguiu sem essa escolha.'}</Text> : null}
    {decision.deadline && !closed ? <Text style={{ color: C.muted, fontFamily: F.m, fontSize: 12.5 }}>Responda até {new Date(decision.deadline).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</Text> : null}
    {error ? <Text style={styles.messageErrorText}>{error}</Text> : null}
  </View>;
}

export function MessageView({ message, bot, models, onRetry, busy, onFile, fileBusy, group = false }) {
  const routine = message.origin === 'routine' || message.origin === 'team' || message.origin === 'decision';
  const user = message.role === 'user' && !routine;
  const [expanded, setExpanded] = useState(false);
  const time = new Date(message.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (routine) return <View style={styles.routineRow}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Rotina ${message.routineTitle}`} onPress={() => setExpanded(value => !value)} style={styles.routineChip}>
      <View style={styles.routineChipHead}><Icon name="bolt" size={14} color={C.sky} /><Text style={styles.routineChipText} numberOfLines={1}>{message.origin === 'decision' ? 'Sua decisão foi entregue ao bot' : message.origin === 'team' ? '' : 'Rotina · '}{message.origin === 'decision' ? '' : message.routineTitle} · {time}</Text><Icon name={expanded ? 'back' : 'down'} size={14} color={C.faint} /></View>
      {expanded && <Text selectable style={styles.routineDetail}>{message.text}</Text>}
    </Pressable>
    {message.status === 'error' && <Text style={styles.messageErrorText}>{message.error || 'A rotina não foi concluída.'}</Text>}
  </View>;
  const model = message.model ? `${message.fallback ? 'Reserva · ' : ''}${claudeName(message.modelId) || findModel(models, message)?.displayName || message.model}${message.reasoningEffort ? ` · ${EFFORT_NAMES[message.reasoningEffort] || message.reasoningEffort}` : ''}` : '';
  const error = message.status === 'error' && <View style={styles.messageError}>
    <Icon name="alert" size={16} color={C.red} /><Text style={styles.messageErrorText}>{message.error || 'A resposta não foi concluída.'}</Text>
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => onRetry(message.text, message)} style={styles.retryButton}><Icon name="refresh" size={14} color={C.text} /><Text style={styles.retryText}>Tentar de novo</Text></Pressable>
  </View>;
  const files = message.attachments?.length ? <View style={styles.messageFiles}>{message.attachments.map(file => isPicture(file) ? <ImageBubble key={file.id} file={file} onPress={onFile} /> : user ? <FileChip key={file.id} file={file} busy={fileBusy === file.id} onPress={onFile} /> : <FileCard key={file.id} file={file} busy={fileBusy === file.id} onPress={onFile} />)}</View> : null;
  if (user) return <View dataSet={desktop ? { desktopMessage: "user" } : undefined} style={[styles.messageRow, styles.userMessageRow]}>
    <View style={[styles.messageBubble, styles.userBubble]}>
      {files}
      {message.text && message.text !== 'Veja o anexo.' ? <Text selectable style={styles.messageText}>{message.text}</Text> : null}
      {(() => { const stamp = (message.via === 'chief' ? `${message.asker || 'Você'} · ` : '') + time + (message.live ? (message.delivered === 'live' ? ' · entregue ao bot enquanto ele trabalhava' : ' · chega ao bot na próxima ação dele') : '');
        return desktop ? <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6, marginTop: 5 }}>{message.text !== 'Veja o anexo.' ? <CopyButton text={message.text} /> : null}<Text style={[styles.userTime, { marginTop: 0 }]}>{stamp}</Text></View>
          : <Text style={styles.userTime}>{stamp}</Text>; })()}
      {error}
    </View>
  </View>;
  return <View dataSet={desktop ? { desktopMessage: "assistant" } : undefined} style={styles.messageRow}>
    {group ? <Avatar bot={bot} size={30} animated={false} tile={false} /> : null}
    <View style={[styles.messageBubble, styles.assistantBubble]}>
      {desktop ? <View style={styles.messageMeta}>{group || desktop ? <Text style={styles.messageSpeaker}>{bot.name}</Text> : null}<Text style={styles.messageTime}>{time}{model ? ` · ${model}` : ''}{message.usage ? ` · ${tokensLabel(message.usage.input + message.usage.output)} tokens` : ''}</Text>{desktop ? <View style={{ flex: 1, minWidth: 8 }} /> : null}<CopyButton text={message.text} /></View>
        : <View style={styles.messageMeta}>{group || desktop ? <Text style={styles.messageSpeaker}>{bot.name}</Text> : null}<Text style={styles.messageTime}>{time}{model ? ` · ${model}` : ''}{message.usage ? ` · ${tokensLabel(message.usage.input + message.usage.output)} tokens` : ''}</Text></View>}
      {files}
      <RichText files={message.attachments} botId={bot.id} onFile={desktop ? onFile : undefined} id={message.id} text={message.text} textStyle={styles.messageText} />
      {message.decision ? <><DecisionCard decision={message.decision} />{error}</> : error}
    </View>
  </View>;
}

export const Message = memo(MessageView, sameMessage);
