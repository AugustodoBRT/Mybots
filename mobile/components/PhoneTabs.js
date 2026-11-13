import { Pressable, Text, View } from 'react-native';
import { C, Icon, F, themed } from '../theme';

const s = themed(() => ({
  bar: { flexDirection: 'row', backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 6, paddingBottom: 8, paddingHorizontal: 8 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, paddingVertical: 4, borderRadius: 14 },
  pill: { width: 56, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  on: { backgroundColor: C.accent + '22' },
  label: { fontFamily: F.b, fontSize: 11.5, color: C.muted },
  labelOn: { color: C.text },
  dot: { position: 'absolute', top: 3, right: 12, width: 8, height: 8, borderRadius: 4, backgroundColor: C.accent, borderWidth: 1.5, borderColor: C.bg }
}));

export const PHONE_TABS = [['home', 'home', 'Início'], ['canvas', 'canvas', 'Canvas'], ['memory', 'memory', 'Memória'], ['settings', 'settings', 'Ajustes']];

/** The phone's sections, always at the bottom outside a conversation: Início (the list, with the Chefe pinned), Canvas, Memória and Ajustes. */
export function PhoneTabs({ current, onPick, dots = {} }) {
  return <View style={s.bar} accessibilityRole="tablist">
    {PHONE_TABS.map(([key, icon, label]) => {
      const on = current === key;
      return <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={label} onPress={() => onPick(key)} style={({ pressed }) => [s.tab, pressed && { opacity: 0.7 }]}>
        <View style={[s.pill, on && s.on]}><Icon name={icon} size={22} color={on ? C.accent : C.muted} />{dots[key] ? <View style={s.dot} /> : null}</View>
        <Text style={[s.label, on && s.labelOn]}>{label}</Text>
      </Pressable>;
    })}
  </View>;
}
