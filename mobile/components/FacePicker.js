import { useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { C, Icon, F, themed } from '../theme';
import BotAvatar, { FACE_SWATCHES } from '../BotAvatar';
import { EYE_STYLES, MOUTHS, TOPS, MOODS, specFromFace, botColor } from '../../lib/mimo.mjs';

const BODIES = [['Redondo', 2.4], ['Meio', 4], ['Quadrado', 7]];
const STEPS = [['Pequeno', 0.86], ['Médio', 1], ['Grande', 1.14]];
const GAPS = [['Perto', 0.8], ['Normal', 1], ['Longe', 1.2]];
const same = (a, b) => Math.abs(a - b) < 0.09;
const PREVIEW = ['normal', 'feliz', 'curioso', 'surpreso', 'falando', 'trabalhando'];
const s = themed(() => ({
  stage: { alignItems: 'center', justifyContent: 'center', height: 340, marginTop: 6 },
  actions: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 4 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, minHeight: 46, borderRadius: 23, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line2 },
  actionOn: { borderColor: C.accent, backgroundColor: C.accent + '22' },
  actionText: { color: C.text, fontFamily: F.b, fontSize: 14.5 },
  part: { color: C.text2, fontFamily: F.b, fontSize: 14, marginTop: 16, marginBottom: 8 },
  chips: { gap: 8, paddingRight: 8 },
  chip: { paddingHorizontal: 14, minHeight: 38, justifyContent: 'center', borderRadius: 19, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line },
  chipOn: { borderColor: C.accent, backgroundColor: C.accent + '22' },
  chipText: { color: C.text2, fontFamily: F.m, fontSize: 14 },
  swatches: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 8 },
  ring: { padding: 3, borderRadius: 24, borderWidth: 2, borderColor: 'transparent' },
  dot: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }
}));

const draw = () => Math.random().toString(36).slice(2, 6);

function Chips({ title, options, value, onPick }) {
  return <View>
    <Text style={s.part}>{title}</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
      {options.map(([label, key, on = value === key]) => <Pressable key={label} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => onPick(key)} style={[s.chip, on && s.chipOn]}>
        <Text style={[s.chipText, on && { color: C.accent }]}>{label}</Text></Pressable>)}
    </ScrollView>
  </View>;
}

/**
 * Choosing a bot's face: the big face moves while you pick. "Sortear" draws a whole new body from a new seed;
 * "Montar" lets you pin the body, eyes, mouth and top one by one (what is not pinned keeps coming from the seed).
 * `face` is { seed, color, mimo } or null (then the name is the seed); `onChange` gets the next one.
 */
export function FacePicker({ name, face, onChange, state = 'idle', showStage = true }) {
  const [building, setBuilding] = useState(false), [mood, setMood] = useState(null);
  const seed = face?.seed || (name || '').trim() || 'bot';
  const bot = { name: name || 'Seu bot', face: { seed, ...(face?.color ? { color: face.color } : {}), ...(face?.mimo ? { mimo: face.mimo } : {}) } };
  const color = botColor(bot), spec = specFromFace(bot.face, bot.name);
  const set = patch => onChange({ seed, color: face?.color || color, ...(face?.mimo ? { mimo: face.mimo } : {}), ...patch });
  const pin = patch => set({ mimo: { ...(face?.mimo || {}), ...patch } });
  return <View>
    {showStage ? <View style={s.stage}><BotAvatar bot={bot} size={330} state={state} animated mood={mood || undefined} /></View> : null}
    <View style={s.actions}>
      <Pressable accessibilityRole="button" onPress={() => onChange({ seed: `${(name || 'bot').trim() || 'bot'}-${draw()}`, color })} style={({ pressed }) => [s.action, pressed && { opacity: 0.7 }]}>
        <Icon name="refresh" size={17} color={C.accent} /><Text style={s.actionText}>Sortear</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: building }} onPress={() => setBuilding(value => !value)} style={({ pressed }) => [s.action, building && s.actionOn, pressed && { opacity: 0.7 }]}>
        <Icon name="edit" size={17} color={C.accent} /><Text style={s.actionText}>Montar</Text></Pressable>
    </View>
    {building ? <View>
      <Chips title="Corpo" options={BODIES.map(([l, v]) => [l, v, same(spec.squar, v)])} onPick={squar => pin({ squar })} />
      <Chips title="Largura" options={STEPS.map(([l, v]) => [l, v, same(spec.sx, v)])} onPick={sx => pin({ sx })} />
      <Chips title="Altura" options={STEPS.map(([l, v]) => [l, v, same(spec.sy, v)])} onPick={sy => pin({ sy })} />
      <Chips title="Olhos" options={[[`Um`, 1], ['Dois', 2], ['Três', 3]]} value={spec.eyes} onPick={eyes => pin({ eyes })} />
      <Chips title="Formato do olho" options={Object.entries(EYE_STYLES).map(([k, v]) => [v[0], k])} value={spec.eyeStyle} onPick={eyeStyle => pin({ eyeStyle })} />
      <Chips title="Distância dos olhos" options={GAPS.map(([l, v]) => [l, v, same(spec.eyeGap, v)])} onPick={eyeGap => pin({ eyeGap })} />
      <Chips title="Boca" options={Object.entries(MOUTHS).map(([k, v]) => [v, k])} value={spec.mouth} onPick={mouth => pin({ mouth })} />
      <Chips title="Topo" options={Object.entries(TOPS).map(([k, v]) => [v, k])} value={spec.top} onPick={top => pin({ top })} />
      <Chips title="Bochechas" options={[['Sem', false], ['Com', true]]} value={Boolean(spec.blush)} onPick={blush => pin({ blush })} />
      <Chips title="Ver expressão" options={[['Automática', null], ...PREVIEW.map(m => [MOODS[m].label, m])]} value={mood} onPick={setMood} />
    </View> : null}
    <Text style={s.part}>Cor</Text>
    <View style={s.swatches}>{FACE_SWATCHES.map(([hex, label]) => { const on = color.toLowerCase() === hex.toLowerCase();
      return <Pressable key={hex} accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ selected: on }} onPress={() => set({ color: hex })} style={[s.ring, on && { borderColor: hex }]}>
        <View style={[s.dot, { backgroundColor: hex }]}>{on ? <Icon name="check" size={14} color="#000" stroke={2.6} /> : null}</View></Pressable>; })}</View>
  </View>;
}
