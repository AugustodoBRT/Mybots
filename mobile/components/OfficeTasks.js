import { useMemo } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useStore } from '../state/useStore';
import { selectConversation } from '../state/store';
import { C, F } from '../theme';
import { ApprovalCard } from './shared';

const LABEL = { queued: 'Na fila', running: 'Em andamento', waiting_approval: 'Aguardando sua decisão' };

// State comes from the supervisor. A missing step or objective is explicitly shown as unavailable.
export default function OfficeTasks({ data, selectionKey, selectionName, messages = [], onRespond, approvalBusy, onCancelTask }) {
  const [kind, id] = (selectionKey || '').split(':');
  const selector = useMemo(() => selectConversation(id, kind === 'room'), [id, kind]);
  const live = useStore(selector);
  data = live?.data || data;
  messages = (kind === 'room' ? live?.room?.messages : live?.bot?.messages) || messages;
  const room = kind === 'room' ? live?.room : null;
  const tasks = (data?.tasks || []).filter(task => kind === 'bot' ? task.bot_id === id : room?.activeTasks?.includes(task.id));
  const taskIds = new Set(tasks.map(task => task.id));
  const approvals = (data?.approvals || []).filter(item => kind === 'bot' ? item.botId === id : taskIds.has(item.taskId));
  const botName = botId => (data?.bots || []).find(bot => bot.id === botId)?.name || 'Bot';
  const lastReply = [...messages].reverse().find(message => message.role === 'assistant' && message.status === 'complete' && !message.progress && message.text?.trim());
  const label = { color: C.muted, fontFamily: F.s, fontSize: 12, marginTop: 12 };
  const text = { color: C.text, fontFamily: F.m, fontSize: 13, lineHeight: 19, marginTop: 4 };
  return <ScrollView accessibilityLabel={`Tarefas de ${selectionName || 'seleção'}`} style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}>
    <View><Text style={{ color: C.text, fontFamily: F.b, fontSize: 18 }}>Tarefas de {selectionName}</Text>
      <Text style={{ color: C.muted, fontFamily: F.m, fontSize: 12, marginTop: 4 }}>{tasks.length ? `${tasks.length} ${tasks.length === 1 ? 'tarefa ativa' : 'tarefas ativas'}` : 'Nenhuma tarefa ativa agora.'}</Text></View>
    {approvals.map(approval => <ApprovalCard key={approval.id} approval={approval} bot={(data?.bots || []).find(bot => bot.id === approval.botId)} onRespond={onRespond} busy={approvalBusy === approval.id} />)}
    {tasks.map(task => <View key={task.id} style={{ padding: 14, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.bg2 }}>
      <Text style={{ color: C.accent, fontFamily: F.b, fontSize: 13 }}>{LABEL[task.state] || task.state}</Text>
      <Text style={label}>Responsável</Text><Text style={text}>{botName(task.bot_id)}</Text>
      <Text style={label}>Pedido</Text><Text selectable style={text}>{(kind === 'room' ? messages.find(message => message.id === task.message_id)?.text : task.preview) || 'Pedido indisponível nesta tarefa.'}</Text>
      <Text style={label}>Etapa atual</Text><Text selectable style={text}>{task.step || (task.state === 'queued' ? 'Aguardando início.' : task.state === 'waiting_approval' ? 'Aguardando sua decisão.' : 'O bot ainda não informou uma etapa.')}</Text>
      {task.created_at && Number.isFinite(Date.parse(task.created_at)) ? <Text style={label}>Criada em {new Date(task.created_at).toLocaleString('pt-BR')}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={`Parar tarefa de ${botName(task.bot_id)}`} onPress={() => onCancelTask?.(task.id)} style={({ hovered }) => ({ alignSelf: 'flex-start', marginTop: 14, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: hovered ? C.surface2 : C.surface })}>
        <Text style={{ color: C.text, fontFamily: F.s, fontSize: 12 }}>Parar tarefa</Text></Pressable>
    </View>)}
    {lastReply ? <View style={{ padding: 14, borderRadius: 14, borderWidth: 1, borderColor: C.line }}><Text style={{ color: C.muted, fontFamily: F.s, fontSize: 12 }}>Última resposta na conversa</Text><Text selectable numberOfLines={8} style={text}>{lastReply.text}</Text></View> : null}
    <Text style={{ color: C.faint, fontFamily: F.m, fontSize: 11, lineHeight: 17 }}>O histórico completo e os arquivos ficam na conversa.</Text>
  </ScrollView>;
}
