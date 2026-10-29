import { useEffect, useState } from 'react';
import { Modal, View, ScrollView, TextInput, Pressable, Text } from 'react-native';
import { styles } from '../styles';
import { C, Icon } from '../theme';
import { SheetHeader } from './shared';

/** Search across every conversation (and the pinned messages), a result opens its chat or room. */
export function SearchSheet({ visible, call, bots, rooms, onClose, onOpen, onTask }) {
  const [query, setQuery] = useState(''); const [pinned, setPinned] = useState(false); const [results, setResults] = useState([]); const [error, setError] = useState('');
  useEffect(() => {
    if (!visible) return;
    if (!pinned && !query.trim()) { setResults([]); setError(''); return; }
    let alive = true;
    // A short pause while typing, so every key does not ask the supervisor.
    const timer = setTimeout(() => call('chat.search', { query: query.trim(), pinned }).then(found => { if (alive) { setResults(found.results); setError(''); } }).catch(failure => { if (alive) setError(failure.message); }), 180);
    return () => { alive = false; clearTimeout(timer); };
  }, [visible, query, pinned]);
  // "@Atlas confira o prazo" hands that bot a task: its chat opens with the text ready to send.
  const task = (() => { const match = query.match(/^@(\S+)\s+(\S[\s\S]*)$/u); const bot = match && bots.find(item => !item.deletedAt && item.name.toLowerCase() === match[1].toLowerCase()); return bot ? { bot, text: match[2].trim() } : null; })();
  const nameOf = item => item.kind === 'room' ? rooms.find(room => room.id === item.ownerId)?.name || 'Sala' : bots.find(bot => bot.id === item.ownerId)?.name || 'Bot';
  return <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
    <View style={styles.sheetBackdrop}><View style={[styles.sheet, styles.sheetTall]}>
      <View style={styles.sheetHandle} />
      <SheetHeader title="Buscar nas conversas" subtitle="Em todos os bots e salas. Com @ e o nome de um bot, você dá uma tarefa." onClose={onClose} />
      <View style={styles.searchRow}>
        <Icon name="search" size={18} color={C.faint} />
        <TextInput accessibilityLabel="Buscar nas conversas" style={styles.searchInput} value={query} onChangeText={setQuery} placeholder="Palavras da conversa ou @bot tarefa" placeholderTextColor={C.faint} autoFocus returnKeyType="search" />
        <Pressable accessibilityRole="button" accessibilityLabel="Só fixadas" accessibilityState={{ selected: pinned }} onPress={() => setPinned(value => !value)} style={[styles.searchPin, pinned && styles.searchPinOn]}><Icon name="pin" size={16} color={pinned ? C.amber : C.faint} /></Pressable>
      </View>
      <ScrollView style={styles.sheetOptions} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 18 }}>
        {task && onTask ? <Pressable accessibilityRole="button" onPress={() => { onTask(task.bot, task.text); onClose(); }} style={({ pressed }) => [styles.modeOption, styles.rowOption, pressed && styles.pressed]}>
          <Icon name="send" size={18} color={C.accent} /><View style={{ flex: 1 }}><Text style={styles.optionLabel}>Dar a tarefa a {task.bot.name}</Text><Text style={styles.optionDetail} numberOfLines={2}>{task.text}</Text></View></Pressable> : null}
        {error ? <Text style={styles.composerError}>{error}</Text> : null}
        {!results.length && (query.trim() || pinned) && !error ? <Text style={styles.optionDetail}>{pinned ? 'Nenhuma mensagem fixada ainda.' : 'Nada encontrado.'}</Text> : null}
        {results.map(item => <Pressable key={item.message.id} accessibilityRole="button" onPress={() => { onOpen(item); onClose(); }} style={({ pressed }) => [styles.modeOption, pressed && styles.pressed]}>
          <Text style={styles.optionLabel}>{nameOf(item)}{item.kind === 'room' ? ' · sala' : ''} · {new Date(item.message.createdAt).toLocaleDateString('pt-BR')}</Text>
          <Text style={styles.optionDetail} numberOfLines={3}>{item.snippet}</Text>
        </Pressable>)}
      </ScrollView>
    </View></View>
  </Modal>;
}
