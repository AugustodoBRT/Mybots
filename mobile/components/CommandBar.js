import { Pressable, Text, View } from 'react-native';
import { C, Icon, F, themed } from '../theme';

const s = themed(() => ({
  bar: { position: 'absolute', left: 16, right: 16, bottom: 18, minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, borderRadius: 27, backgroundColor: C.elevated, borderWidth: 1, borderColor: C.line2, elevation: 6 },
  text: { flex: 1, color: C.muted, fontFamily: F.m, fontSize: 15 }
}));

/** The floating bar at the bottom of the home: one tap searches every conversation, and "@bot tarefa" hands a bot a task. */
export function CommandBar({ onPress }) {
  return <Pressable accessibilityRole="search" accessibilityLabel="Buscar nas conversas ou dar uma tarefa com @" onPress={onPress} style={({ pressed }) => [s.bar, pressed && { opacity: 0.8 }]}>
    <Icon name="search" size={20} color={C.muted} /><Text style={s.text} numberOfLines={1}>Busque ou digite @ para dar uma tarefa</Text>
  </Pressable>;
}
