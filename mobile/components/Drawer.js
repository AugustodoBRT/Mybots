import { useEffect, useRef } from 'react';
import { Modal, View, Text, Pressable, Animated, Easing, useWindowDimensions, ScrollView } from 'react-native';
import { C, Icon, F, themed } from '../theme';
import { TOP } from '../styles';
import { Avatar } from './shared';

const s = themed(() => ({
  backdrop: { flex: 1, backgroundColor: '#000000B0', flexDirection: 'row' },
  panel: { backgroundColor: C.bg, borderRightWidth: 1, borderRightColor: C.line, paddingTop: TOP + 14, paddingBottom: 22, paddingHorizontal: 12 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, marginBottom: 18 },
  brandText: { color: C.text, fontFamily: F.x, fontSize: 22, letterSpacing: -0.8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 50, paddingHorizontal: 12, borderRadius: 14 },
  itemOn: { backgroundColor: C.surface2 },
  itemText: { flex: 1, color: C.text2, fontFamily: F.s, fontSize: 16 },
  itemTextOn: { color: C.text },
  count: { color: C.muted, fontFamily: F.m, fontSize: 13.5 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: C.accent },
  rule: { height: 1, backgroundColor: C.line, marginVertical: 10, marginHorizontal: 10 },
  foot: { color: C.faint, fontFamily: F.m, fontSize: 12.5, lineHeight: 18, paddingHorizontal: 12 }
}));

/**
 * The side menu: where the app goes (Conversas, Atividade, Carteira, Rotinas, Negociações, Ajustes). An orange dot or a
 * count says something waits; the decision itself stays where it happens.
 * `items` is [{ key, label, icon, count, dot, onPress, on }].
 */
export function Drawer({ visible, onClose, items, footer }) {
  const { width } = useWindowDimensions(); const panelWidth = Math.min(310, Math.round(width * 0.84));
  const slide = useRef(new Animated.Value(-panelWidth)).current;
  useEffect(() => { if (visible) { slide.setValue(-panelWidth); Animated.timing(slide, { toValue: 0, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(); } }, [visible]);
  return <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
    <View style={s.backdrop}>
      <Animated.View style={[s.panel, { width: panelWidth, transform: [{ translateX: slide }] }]} accessibilityViewIsModal>
        <View style={s.brand}><Text style={s.brandText}>mybots</Text><View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.accent, marginTop: 8 }} /></View>
        <ScrollView>
          {items.map(item => item.rule ? <View key={item.key} style={s.rule} /> : <Pressable key={item.key} accessibilityRole="button" accessibilityLabel={item.label} accessibilityState={{ selected: Boolean(item.on) }}
            onPress={() => { onClose(); item.onPress?.(); }} style={({ pressed }) => [s.item, item.on && s.itemOn, pressed && { opacity: 0.7 }]}>
            <Icon name={item.icon} size={22} color={item.on ? C.accent : C.muted} />
            <Text style={[s.itemText, item.on && s.itemTextOn]}>{item.label}</Text>
            {item.dot ? <View style={s.dot} accessibilityLabel="precisa de você" /> : item.count ? <Text style={s.count}>{item.count}</Text> : null}
          </Pressable>)}
        </ScrollView>
        {footer ? <Text style={s.foot}>{footer}</Text> : null}
      </Animated.View>
      <Pressable accessibilityRole="button" accessibilityLabel="Fechar o menu" onPress={onClose} style={{ flex: 1 }} />
    </View>
  </Modal>;
}
