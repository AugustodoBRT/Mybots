import { useEffect, useState } from 'react';
import { Modal, View, ScrollView, TextInput, Pressable, Text } from 'react-native';
import { styles } from '../styles';
import { C, Icon } from '../theme';
import { SheetHeader } from './shared';

/** Search across every conversation (and the pinned messages), a result opens its chat or room. */
export function SearchSheet({ visible, call, bots, rooms, onClose, onOpen }) {
  const [query, setQuery] = useState(''); const [pinned, setPinned] = useState(false); const [results, setResults] = useState([]); const [error, setError] = useState('');
  useEffect(() => {
    if (!visible) return;
    if (!pinned && !query.trim()) { setResults([]); setError(''); return; }
    let alive = true;
    // A short pause while typing, so every key does not ask the supervisor.
    const timer = setTimeout(() => call('chat.search', { query: query.trim(), pinned }).then(found => { if (alive) { setResults(found.results); setError(''); } }).catch(failure => { if (alive) setError(failure.message); }), 180);
    return () => { alive = false; clearTimeout(timer); };
  }, [visible, query, pinned]);
  const nameOf = item => item.kind === 'room' ? rooms.find(room => room.id === item.ownerId)?.name || 'Sala' : bots.find(bot => bot.id === item.ownerId)?.name || 'Bot';
  return <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
    <View style={styles.sheetBackdrop}><View style={[styles.sheet, styles.sheetTall]}>
      <View style={styles.sheetHandle} />
      <SheetHeader title="Buscar nas conversas" subtitle="Em todos os bots e salas." onClose={onClose} />
      <View style={styles.searchRow}>
        <Icon name="search" size={18} color={C.faint} />
        <TextInput accessibilityLabel="Buscar nas conversas" style={styles.searchInput} value={query} onChangeText={setQuery} placeholder="Digite palavras da conversa" placeholderTextColor={C.faint} autoFocus returnKeyType="search" />
        <Pressable accessibilityRole="button" accessibilityLabel="Só fixadas" accessibilityState={{ selected: pinned }} onPress={() => setPinned(value => !value)} style={[styles.searchPin, pinned && styles.searchPinOn]}><Icon name="pin" size={16} color={pinned ? C.amber : C.faint} /></Pressable>
      </View>
      <ScrollView style={styles.sheetOptions} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 18 }}>
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
