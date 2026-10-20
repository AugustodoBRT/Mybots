import React, { useEffect, useRef, useState } from 'react';
import { View, Animated, Easing, AccessibilityInfo } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Rect, Circle, Path, Ellipse, G } from 'react-native-svg';
import { HUES } from './theme';

export const BOT_COLORS = HUES;
export const BOT_FORMS = ['orbit', 'pixel', 'cat', 'spark'];
export const BOT_FORM_NAMES = { orbit: 'Órbita', pixel: 'Pixel', cat: 'Felino', spark: 'Faísca' };
export function formFor(bot) {
  if (BOT_FORMS.includes(bot.avatar)) return bot.avatar;
  return BOT_FORMS[[...(bot.id || bot.name || '')].reduce((sum, char) => sum + char.charCodeAt(0), 0) % BOT_FORMS.length];
}

let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled?.().then(value => { reduceMotion = value; }).catch(() => {});

const shade = (hex, amount) => {
  const n = parseInt(hex.slice(1), 16);
  const mix = channel => Math.round(amount < 0 ? channel * (1 + amount) : channel + (255 - channel) * amount);
  return '#' + [mix(n >> 16), mix((n >> 8) & 255), mix(n & 255)].map(value => value.toString(16).padStart(2, '0')).join('');
};

// Each form on a 100×100 grid: head, face screen, and where the eyes sit.
const SHAPES = {
  orbit: { head: { x: 17, y: 32, w: 66, h: 52, r: 24 }, face: { x: 25, y: 42, w: 50, h: 32, r: 15 }, eye: { w: 8, h: 11, r: 4 } },
  pixel: { head: { x: 18, y: 32, w: 64, h: 52, r: 9 }, face: { x: 26, y: 42, w: 48, h: 32, r: 5 }, eye: { w: 9, h: 9, r: 1.5 } },
  cat: { head: { x: 16, y: 36, w: 68, h: 50, r: 25 }, face: { x: 24, y: 45, w: 52, h: 32, r: 15 }, eye: { w: 9, h: 9, r: 4.5 } },
  spark: { head: { x: 17, y: 33, w: 66, h: 51, r: 20 }, face: { x: 25, y: 43, w: 50, h: 31, r: 13 }, eye: { w: 10, h: 7, r: 3.5 } }
};

/**
 * A bot's face. Idle: it breathes and blinks now and then. Working: eyes glance side to side and the antenna
 * light pulses. Waiting for you: the antenna light blinks amber. Static when small, in lists of many, or when
 * the phone asks for reduced motion.
 */
export default function BotAvatar({ bot, size = 54, state = 'idle', animated = true, tile = true }) {
  const color = BOT_COLORS[bot.color] || BOT_COLORS.green; const form = formFor(bot); const shape = SHAPES[form];
  const id = useRef('a' + Math.random().toString(36).slice(2, 8)).current;
  const live = animated && !reduceMotion && size >= 28;
  const bob = useRef(new Animated.Value(0)).current;
  const blink = useRef(new Animated.Value(1)).current;
  const look = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const [, force] = useState(0);

  useEffect(() => {
    if (!live) return undefined;
    const breathe = Animated.loop(Animated.sequence([
      Animated.timing(bob, { toValue: 1, duration: 1700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(bob, { toValue: 0, duration: 1700, easing: Easing.inOut(Easing.sin), useNativeDriver: true })]));
    breathe.start();
    let timer, stopped = false;
    const blinkOnce = () => {
      if (stopped) return;
      Animated.sequence([
        Animated.timing(blink, { toValue: 0.1, duration: 70, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 110, useNativeDriver: true })
      ]).start(() => { timer = setTimeout(blinkOnce, 2200 + Math.random() * 4200); });
    };
    timer = setTimeout(blinkOnce, 600 + Math.random() * 3000);
    return () => { stopped = true; clearTimeout(timer); breathe.stop(); };
  }, [live]);

  useEffect(() => {
    if (!live) { look.setValue(0); glow.setValue(0); return undefined; }
    let loops = [];
    if (state === 'working') {
      loops = [Animated.loop(Animated.sequence([
        Animated.timing(look, { toValue: -1, duration: 520, easing: Easing.inOut(Easing.quad), useNativeDriver: true }), Animated.delay(260),
        Animated.timing(look, { toValue: 1, duration: 720, easing: Easing.inOut(Easing.quad), useNativeDriver: true }), Animated.delay(260),
        Animated.timing(look, { toValue: 0, duration: 420, easing: Easing.inOut(Easing.quad), useNativeDriver: true }), Animated.delay(500)])),
      Animated.loop(Animated.sequence([Animated.timing(glow, { toValue: 1, duration: 600, useNativeDriver: true }), Animated.timing(glow, { toValue: 0.2, duration: 600, useNativeDriver: true })]))];
    } else if (state === 'waiting') {
      loops = [Animated.loop(Animated.sequence([Animated.timing(glow, { toValue: 1, duration: 280, useNativeDriver: true }), Animated.delay(240), Animated.timing(glow, { toValue: 0, duration: 280, useNativeDriver: true }), Animated.delay(700)]))];
    } else glow.setValue(0);
    loops.forEach(loop => loop.start());
    force(value => value + 1);
    return () => loops.forEach(loop => loop.stop());
  }, [live, state]);

  const k = size / 100; const light = state === 'waiting' ? '#FFC86E' : color;
  const eyeColor = shade(color, 0.55);
  const tilt = form === 'spark' ? -6 : 0;
  const lift = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -2.6 * k] });
  const shadow = bob.interpolate({ inputRange: [0, 1], outputRange: [1, 0.86] });
  const eyeShift = look.interpolate({ inputRange: [-1, 1], outputRange: [-4.5 * k, 4.5 * k] });
  const eyes = [shape.face.x + shape.face.w * 0.31, shape.face.x + shape.face.w * 0.69];
  const eyeY = shape.face.y + shape.face.h * 0.46;

  return <View accessible accessibilityLabel={`${bot.name || 'Bot'}, aparência ${BOT_FORM_NAMES[form]}`} style={{ width: size, height: size }}>
    {tile ? <Svg width={size} height={size} viewBox="0 0 100 100" style={{ position: 'absolute' }}>
      <Defs>
        <RadialGradient id={id + 't'} cx="50%" cy="38%" r="70%"><Stop offset="0" stopColor={color} stopOpacity="0.26" /><Stop offset="1" stopColor={color} stopOpacity="0.05" /></RadialGradient>
      </Defs>
      <Rect x="0.5" y="0.5" width="99" height="99" rx="30" fill={`url(#${id}t)`} stroke={color} strokeOpacity="0.22" />
    </Svg> : null}
    <Animated.View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, transform: [{ scaleX: shadow }] }}>
      <Svg width={size} height={size} viewBox="0 0 100 100"><Ellipse cx="50" cy="90" rx="22" ry="3.2" fill="#000" opacity="0.35" /></Svg>
    </Animated.View>
    <Animated.View style={{ position: 'absolute', left: 0, top: 0, width: size, height: size, transform: [{ translateY: lift }, { rotate: `${tilt}deg` }] }}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id={id + 'h'} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={shade(color, 0.25)} /><Stop offset="1" stopColor={shade(color, -0.12)} /></LinearGradient>
          <LinearGradient id={id + 'f'} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#1A2130" /><Stop offset="1" stopColor="#0C1018" /></LinearGradient>
        </Defs>
        {form === 'cat' ? <G fill={shade(color, 0.1)}>
          <Path d="M22 46 L27 18 L44 37 Z" /><Path d="M78 46 L73 18 L56 37 Z" />
          <Path d="M27.5 39 L29.5 26 L37 34.5 Z" fill={shade(color, -0.25)} /><Path d="M72.5 39 L70.5 26 L63 34.5 Z" fill={shade(color, -0.25)} />
        </G> : <G>
          <Rect x="48" y="16" width="4" height="17" rx="2" fill={shade(color, -0.1)} />
          {form === 'pixel' ? <Rect x="43.5" y="9" width="13" height="10" rx="2.5" fill={shade(color, 0.2)} /> : form === 'spark' ? null : <Circle cx="50" cy="13" r="6.5" fill={shade(color, 0.2)} />}
        </G>}
        {form !== 'cat' ? <><Rect x={shape.head.x - 5} y={shape.head.y + 18} width="8" height="16" rx="4" fill={shade(color, -0.18)} /><Rect x={shape.head.x + shape.head.w - 3} y={shape.head.y + 18} width="8" height="16" rx="4" fill={shade(color, -0.18)} /></> : null}
        <Rect x={shape.head.x} y={shape.head.y} width={shape.head.w} height={shape.head.h} rx={shape.head.r} fill={`url(#${id}h)`} />
        <Ellipse cx={shape.head.x + shape.head.w * 0.3} cy={shape.head.y + 7} rx={shape.head.w * 0.2} ry="3.2" fill="#fff" opacity="0.32" />
        <Rect x={shape.face.x} y={shape.face.y} width={shape.face.w} height={shape.face.h} rx={shape.face.r} fill={`url(#${id}f)`} />
        <Path d={`M${50 - 5} ${shape.face.y + shape.face.h * 0.78} Q50 ${shape.face.y + shape.face.h * 0.92} ${50 + 5} ${shape.face.y + shape.face.h * 0.78}`} stroke={eyeColor} strokeWidth="2.4" strokeLinecap="round" fill="none" opacity="0.85" />
        {form === 'orbit' || form === 'pixel' ? <Circle cx="50" cy={form === 'pixel' ? 14 : 13} r="3" fill="#fff" opacity="0.5" /> : null}
      </Svg>
      {/* Antenna light (or the spark's star): pulses while working, blinks amber while waiting for you. */}
      {form === 'spark' ? <Animated.View style={{ position: 'absolute', left: 60 * k, top: 4 * k, width: 26 * k, height: 26 * k, transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.25] }) }, { rotate: lift.interpolate({ inputRange: [-2.6 * k || -1, 0], outputRange: ['14deg', '0deg'] }) }] }}>
        <Svg width={26 * k} height={26 * k} viewBox="0 0 24 24"><Path d="M12 1.5l2.4 7.2 7.1 2.4-7.1 2.4L12 21l-2.4-7.5L2.5 11.1l7.1-2.4z" fill={state === 'waiting' ? '#FFC86E' : shade(color, 0.35)} /></Svg>
      </Animated.View> : form !== 'cat' ? <Animated.View style={{ position: 'absolute', left: (50 - 9) * k, top: (form === 'pixel' ? 5 : 4) * k, width: 18 * k, height: 18 * k, borderRadius: 9 * k, backgroundColor: light, opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0, 0.7] }), transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.25] }) }] }} /> : null}
      {eyes.map((x, index) => <Animated.View key={index} style={{ position: 'absolute', left: (x - shape.eye.w / 2) * k, top: (eyeY - shape.eye.h / 2) * k, width: shape.eye.w * k, height: shape.eye.h * k,
        borderRadius: shape.eye.r * k, backgroundColor: eyeColor, shadowColor: color, shadowOpacity: 0.9, shadowRadius: 4 * k,
        transform: [{ translateX: eyeShift }, { scaleY: blink }] }} />)}
    </Animated.View>
  </View>;
}
