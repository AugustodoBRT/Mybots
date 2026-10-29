import { useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { C, Icon, F, themed } from '../theme';
import BotAvatar, { FACE_SWATCHES } from '../BotAvatar';
import { PIECES, PIECE_NAMES, botColor } from '../../lib/face.mjs';

const PART_TITLES = { head: 'Cabeça', tex: 'Textura', eye: 'Olhos', mouth: 'Boca', top: 'Topo' };
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

/**
 * Choosing a bot's face: the big face moves while you pick. "Sortear" draws a whole new face from a new seed;
 * "Montar" lets you pin the head, texture, eyes, mouth and top one by one (anything not pinned keeps coming from the seed).
 * `face` is { seed, color, pieces } or null (then the name is the seed); `onChange` gets the next one.
 */
export function FacePicker({ name, face, onChange, state = 'idle', showStage = true }) {
  const [building, setBuilding] = useState(false);
  const seed = face?.seed || (name || '').trim() || 'bot';
  const bot = { name: name || 'Seu bot', face: { seed, ...(face?.color ? { color: face.color } : {}), ...(face?.pieces ? { pieces: face.pieces } : {}) } };
  const color = botColor(bot);
  const set = patch => onChange({ seed, ...(face?.color ? { color: face.color } : { color }), ...(face?.pieces ? { pieces: face.pieces } : {}), ...patch });
  const pin = (part, value) => { const pieces = { ...(face?.pieces || {}) }; if (value) pieces[part] = value; else delete pieces[part]; set({ pieces: Object.keys(pieces).length ? pieces : undefined }); };
  return <View>
    {showStage ? <View style={s.stage}><BotAvatar bot={bot} size={330} state={state} animated /></View> : null}
    <View style={s.actions}>
      <Pressable accessibilityRole="button" onPress={() => { onChange({ seed: `${(name || 'bot').trim() || 'bot'}-${draw()}`, color }); }} style={({ pressed }) => [s.action, pressed && { opacity: 0.7 }]}>
        <Icon name="refresh" size={17} color={C.accent} /><Text style={s.actionText}>Sortear</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: building }} onPress={() => setBuilding(value => !value)} style={({ pressed }) => [s.action, building && s.actionOn, pressed && { opacity: 0.7 }]}>
        <Icon name="edit" size={17} color={C.accent} /><Text style={s.actionText}>Montar</Text></Pressable>
    </View>
    {building ? <View>
      {Object.keys(PIECES).map(part => <View key={part}>
        <Text style={s.part}>{PART_TITLES[part]}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          {[[null, 'Do sorteio'], ...PIECES[part].map(value => [value, PIECE_NAMES[part][value]])].map(([value, label]) => { const on = (face?.pieces?.[part] || null) === value;
            return <Pressable key={label} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => pin(part, value)} style={[s.chip, on && s.chipOn]}><Text style={[s.chipText, on && { color: C.accent }]}>{label}</Text></Pressable>; })}
        </ScrollView>
      </View>)}
    </View> : null}
    <Text style={s.part}>Cor</Text>
    <View style={s.swatches}>{FACE_SWATCHES.map(([hex, label]) => { const on = color.toLowerCase() === hex.toLowerCase();
      return <Pressable key={hex} accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ selected: on }} onPress={() => set({ color: hex })} style={[s.ring, on && { borderColor: hex }]}>
        <View style={[s.dot, { backgroundColor: hex }]}>{on ? <Icon name="check" size={14} color="#000" stroke={2.6} /> : null}</View></Pressable>; })}</View>
  </View>;
}
