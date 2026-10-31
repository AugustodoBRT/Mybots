import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View, Pressable, TextInput } from 'react-native';
import { C, Icon, F, setTheme, resolveTheme } from '../theme';
import { Avatar } from './shared';
import { native } from '../desktop';
import { useFonts, PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold } from '@expo-google-fonts/plus-jakarta-sans';

setTheme(resolveTheme(undefined, 'dark'));
if (typeof document !== 'undefined') { document.documentElement.style.background = 'transparent'; document.body.style.backgroundColor = 'transparent'; }

const SMALL = 44, BIG = 56, MS = 260;

/**
 * The bot's face floating over the browser, small. A click makes it grow and the field to talk to it unfold beside it,
 * smoothly; clicking again folds it back. The window gives this page room for the open state first and takes it back
 * only after the fold has finished, so the motion is never cut by the view's size.
 */
export function OverlayApp() {
  useFonts({ PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold });
  const [state, setState] = useState(null); const [open, setOpen] = useState(false); const [text, setText] = useState(''); 
  const input = useRef(null); const progress = useRef(new Animated.Value(0)).current; const timer = useRef(null);
  useEffect(() => native?.onOverlayState(setState), []);
  const toggle = value => {
    clearTimeout(timer.current); setOpen(value);
    const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (value) {
      native?.overlayExpand(true);
      Animated.timing(progress, { toValue: 1, duration: reduced ? 0 : MS, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
      timer.current = setTimeout(() => input.current?.focus(), reduced ? 0 : MS * 0.6);
    } else {
      Animated.timing(progress, { toValue: 0, duration: reduced ? 0 : MS, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }).start(() => native?.overlayExpand(false));
    }
  };
  const send = () => { const value = text.trim(); if (!value) return; native?.overlaySend(value); setText(''); toggle(false); };
  if (!state?.bot) return <View style={{ flex: 1 }} />;
  const { bot, working } = state;
  const face = progress.interpolate({ inputRange: [0, 1], outputRange: [SMALL, BIG] });
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [SMALL / BIG, 1] });
  return <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' }}>
    <Animated.View pointerEvents={open ? 'auto' : 'none'} style={{ flexGrow: progress, flexShrink: 1, flexBasis: 0, minWidth: 0, height: 44, marginRight: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 10] }), overflow: 'hidden', opacity: progress, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 16, paddingRight: 4, borderRadius: 22, backgroundColor: C.elevated, borderWidth: 1, borderColor: C.line2 }}>
      <TextInput ref={input} accessibilityLabel={`Mensagem para ${bot.name}`} value={text} onChangeText={setText} onSubmitEditing={send} onKeyPress={event => { if (event.nativeEvent.key === 'Escape') toggle(false); }}
        placeholder={working ? `${bot.name} está trabalhando… mande mais` : `Mensagem para ${bot.name}`} placeholderTextColor={C.faint} selectionColor={C.accent} style={{ flex: 1, minWidth: 0, color: C.text, fontFamily: F.m, fontSize: 14, outlineStyle: 'none' }} />
      <Pressable accessibilityRole="button" accessibilityLabel="Enviar" disabled={!text.trim()} onPress={send} style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: C.text, opacity: text.trim() ? 1 : 0.4 }}><Icon name="send" size={15} color={C.bg} /></Pressable>
    </Animated.View>
    <Pressable accessibilityRole="button" accessibilityLabel={open ? `Fechar a conversa com ${bot.name}` : `Falar com ${bot.name}`} onPress={() => toggle(!open)}>
      <Animated.View style={{ width: face, height: face, borderRadius: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: C.elevated, borderWidth: 1, borderColor: C.line2, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10 }}>
        <Animated.View style={{ transform: [{ scale }] }}><Avatar bot={bot} size={BIG - 8} state={working ? 'working' : 'idle'} animated tile={false} /></Animated.View>
      </Animated.View>
    </Pressable>
  </View>;
}
