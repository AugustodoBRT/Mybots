import { sameMessage } from '../message-cache';
import { memo, useState } from 'react';
import { View, Pressable, Text } from 'react-native';
import { styles } from '../styles';
import { Icon, C } from '../theme';
import { claudeName, findModel, EFFORT_NAMES, Avatar, tokensLabel } from './shared';
import { FileChip, FileCard, RichText } from '../RichMessage';

export function MessageView({ message, bot, models, onRetry, busy, onFile, fileBusy }) {
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
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => onRetry(message.text, message)} style={styles.retryButton}><Icon name="refresh" size={14} color={C.text} /><Text style={styles.retryText}>Tentar de novo</Text></Pressable>
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
      <RichText id={message.id} text={message.text} textStyle={styles.messageText} />
      {error}
    </View>
  </View>;
}

export const Message = memo(MessageView, sameMessage);
