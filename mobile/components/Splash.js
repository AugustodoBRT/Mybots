import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, View, Text, useWindowDimensions } from 'react-native';
import { C, F } from '../theme';

// The opening screen: a little street of bots walking, carrying things and thinking while the app wakes up (the first start after an
// update can take a while: the core is prepared in Termux). It covers the app until it is ready and then fades away, so the person
// never sees the half-loaded screens underneath.
const COLORS = ['#A78BFA', '#FB923C', '#4ADE80', '#60A5FA', '#F472B6', '#22D3EE'];
const LINES = ['Acordando seu time…', 'Arrumando a mesa dos bots…', 'Reunindo as memórias…', 'Quase lá…'];
const MIN_MS = 1600, MAX_MS = 90000, FADE_MS = 650;

function Walker({ color, lane, width, seconds, delay, carry, think }) {
  const x = useRef(new Animated.Value(0)).current, face = useRef(new Animated.Value(1)).current, step = useRef(new Animated.Value(0)).current, blink = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const span = Math.max(40, width - 80), native = { useNativeDriver: true };
    const walk = Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(x, { toValue: span, duration: seconds * 1000, easing: Easing.inOut(Easing.quad), ...native }),
      Animated.timing(face, { toValue: -1, duration: 1, ...native }), Animated.delay(500 + delay % 700),
      Animated.timing(x, { toValue: 0, duration: seconds * 1000, easing: Easing.inOut(Easing.quad), ...native }),
      Animated.timing(face, { toValue: 1, duration: 1, ...native }), Animated.delay(400)]));
    const hop = Animated.loop(Animated.sequence([Animated.timing(step, { toValue: 1, duration: 230, easing: Easing.out(Easing.quad), ...native }), Animated.timing(step, { toValue: 0, duration: 230, easing: Easing.in(Easing.quad), ...native })]));
    const eyes = Animated.loop(Animated.sequence([Animated.delay(1800 + delay), Animated.timing(blink, { toValue: 0.1, duration: 90, ...native }), Animated.timing(blink, { toValue: 1, duration: 120, ...native })]));
    walk.start(); hop.start(); eyes.start();
    return () => { walk.stop(); hop.stop(); eyes.stop(); };
  }, [width]);
  const lift = step.interpolate({ inputRange: [0, 1], outputRange: [0, -6] });
  const squash = step.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  return <Animated.View style={{ position: 'absolute', left: 20, top: lane, transform: [{ translateX: x }, { scaleX: face }] }}>
    <Animated.View style={{ alignItems: 'center', transform: [{ translateY: lift }, { scaleY: squash }] }}>
      {think ? <View style={{ position: 'absolute', top: -26, flexDirection: 'row', gap: 3, paddingHorizontal: 7, paddingVertical: 5, borderRadius: 10, backgroundColor: C.surface2 }}>{[0, 1, 2].map(i => <View key={i} style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: C.muted }} />)}</View> : null}
      {carry ? <View style={{ position: 'absolute', top: -17, width: 20, height: 16, borderRadius: 4, backgroundColor: '#C08A4D', borderWidth: 1, borderColor: '#8A5E2F' }}><View style={{ height: 3, marginTop: 5, backgroundColor: '#E8C48F' }} /></View> : null}
      <View style={{ position: 'absolute', top: -7, left: 3, width: 8, height: 12, borderRadius: 3, backgroundColor: color, opacity: 0.9, transform: [{ rotate: '-18deg' }] }} />
      <View style={{ position: 'absolute', top: -7, right: 3, width: 8, height: 12, borderRadius: 3, backgroundColor: color, opacity: 0.9, transform: [{ rotate: '18deg' }] }} />
      <View style={{ width: 38, height: 34, borderRadius: 11, backgroundColor: color, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: '#FFFFFF', opacity: 0.18 }} />
        <Animated.View style={{ flexDirection: 'row', gap: 9, transform: [{ scaleY: blink }] }}>{[0, 1].map(i => <View key={i} style={{ width: 5, height: 7, borderRadius: 3, backgroundColor: '#14101F' }} />)}</Animated.View>
        <View style={{ width: 7, height: 2, borderRadius: 1, marginTop: 5, backgroundColor: '#14101F' }} />
      </View>
      <View style={{ flexDirection: 'row', gap: 12, marginTop: -1 }}>{[0, 1].map(i => <View key={i} style={{ width: 7, height: 5, borderRadius: 2, backgroundColor: color, opacity: 0.8 }} />)}</View>
    </Animated.View>
  </Animated.View>;
}

/** `ready`: the app is ready to be seen. `note`: what the core is doing now, when it says so (shown instead of the rotating lines). */
export function Splash({ ready, note = '' }) {
  const { width } = useWindowDimensions();
  const [gone, setGone] = useState(false), [line, setLine] = useState(0), [minDone, setMinDone] = useState(false), [late, setLate] = useState(false);
  const opacity = useRef(new Animated.Value(1)).current, text = useRef(new Animated.Value(1)).current, logo = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(logo, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    const a = setTimeout(() => setMinDone(true), MIN_MS), b = setTimeout(() => setLate(true), MAX_MS);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => Animated.timing(text, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => { setLine(n => (n + 1) % LINES.length); Animated.timing(text, { toValue: 1, duration: 260, useNativeDriver: true }).start(); }), 2600);
    return () => clearInterval(timer);
  }, []);
  const open = (ready && minDone) || late;
  useEffect(() => { if (open) Animated.timing(opacity, { toValue: 0, duration: FADE_MS, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }).start(() => setGone(true)); }, [open]);
  const lanes = useMemo(() => [0, 1, 2, 3, 4, 5].map(i => ({ color: COLORS[i], lane: 120 + i * 62, seconds: 5.5 + (i * 7 % 5) * 0.9, delay: i * 420, carry: i === 1 || i === 4, think: i === 3 })), []);
  if (gone) return null;
  return <Animated.View pointerEvents={open ? 'none' : 'auto'} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 1000, backgroundColor: C.bg, opacity }}>
    <Animated.View style={{ alignItems: 'center', marginTop: 70, opacity: logo, transform: [{ translateY: logo.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}>
      <Text style={{ color: C.text, fontFamily: F.x, fontSize: 34, letterSpacing: -1 }}>mybots</Text>
    </Animated.View>
    <View style={{ flex: 1 }}>{lanes.map((item, index) => <View key={index} style={{ position: 'absolute', left: 0, right: 0, top: 0 }}>
      <View style={{ position: 'absolute', left: 24, right: 24, top: item.lane + 46, height: 2, borderRadius: 1, backgroundColor: C.line, opacity: 0.7 }} />
      <Walker {...item} width={width} /></View>)}</View>
    <View style={{ position: 'absolute', left: 24, right: 24, bottom: 90, alignItems: 'center', gap: 6 }}>
      <Animated.Text numberOfLines={3} style={{ color: C.muted, fontFamily: F.m, fontSize: 15, textAlign: 'center', lineHeight: 22, opacity: note ? 1 : text }}>{note || LINES[line]}</Animated.Text>
    </View>
  </Animated.View>;
}
