import { useState } from 'react';
import { View, Pressable, Text, TextInput } from 'react-native';
import { styles } from '../styles';
import { C, Icon } from '../theme';

/** The bot's line: what waits (each item can be cancelled), pause and resume, and "Corrigir rumo" for the turn in progress. */
export function QueuePanel({ queued, running, paused, onPause, onCancel, onSteer }) {
  const [steering, setSteering] = useState(false); const [text, setText] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  if (!queued.length && !running && !paused) return null;
  const steer = async () => {
    if (!text.trim() || busy) return; setBusy(true); setError('');
    try { await onSteer(text.trim()); setText(''); setSteering(false); } catch (failure) { setError(failure.message || 'Não deu para enviar.'); } finally { setBusy(false); }
  };
  return <View style={styles.queuePanel}>
    <View style={styles.queueHead}>
      <Text style={styles.queueTitle}>{paused ? 'Fila pausada' : 'Fila'}{queued.length ? ` · ${queued.length} esperando` : ''}</Text>
      {running ? <Pressable accessibilityRole="button" accessibilityLabel="Corrigir rumo" onPress={() => setSteering(value => !value)} style={styles.queueAction}><Icon name="reply" size={14} color={C.sky} /><Text style={styles.queueActionText}>Corrigir rumo</Text></Pressable> : null}
      {queued.length || paused ? <Pressable accessibilityRole="button" accessibilityLabel={paused ? 'Retomar a fila' : 'Pausar a fila'} onPress={() => onPause(!paused)} style={styles.queueAction}><Icon name={paused ? 'right' : 'pause'} size={14} color={paused ? C.accent : C.amber} /><Text style={styles.queueActionText}>{paused ? 'Retomar' : 'Pausar'}</Text></Pressable> : null}
    </View>
    {steering ? <View style={styles.queueSteer}>
      <TextInput accessibilityLabel="Instrução para a tarefa em andamento" style={styles.queueInput} value={text} onChangeText={setText} placeholder="O que ele deve fazer diferente?" placeholderTextColor={C.faint} multiline maxLength={2000} />
      <Pressable accessibilityRole="button" accessibilityLabel="Enviar instrução" disabled={!text.trim() || busy} onPress={steer} style={[styles.queueAction, (!text.trim() || busy) && styles.buttonDisabled]}><Text style={styles.queueActionText}>Enviar</Text></Pressable>
    </View> : null}
    {error ? <Text style={styles.composerError}>{error}</Text> : null}
    {queued.map(task => <View key={task.id} style={styles.queueItem}>
      <Text style={styles.queueItemText} numberOfLines={1}>{task.steer ? 'Correção · ' : ''}{task.preview || 'Mensagem'}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Cancelar: ${task.preview || 'mensagem'}`} onPress={() => onCancel(task.id)} hitSlop={8}><Icon name="close" size={16} color={C.muted} /></Pressable>
    </View>)}
  </View>;
}
