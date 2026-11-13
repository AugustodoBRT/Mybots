import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { C, F } from '../theme';
import { CLAUDE_MARK, OPENAI_MARK, CLAUDE_COLOR, AGY_MARK, AGY_COLOR } from '../brand';

const NAMES = { agy: 'Antigravity', claude: 'Claude', codex: 'Codex' };
const LABEL = { five_hour: '5 horas', week: 'Semana' };
const left = window => window ? Math.max(0, Math.min(100, 100 - window.used)) : null;
const windowOf = (limits, key) => limits?.windows?.find(item => item.key === key) || null;
const renews = at => {
  if (!at) return '';
  const date = new Date(at), today = new Date();
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return date.toDateString() === today.toDateString() ? `renova às ${time}` : `renova ${date.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')} ${time}`;
};

function Mark({ provider, size }) {
  return <Svg width={size} height={size} viewBox={provider === 'agy' ? '0 0 24 24' : '0 0 25 25'}>
    <Path d={provider === 'claude' ? CLAUDE_MARK : provider === 'agy' ? AGY_MARK : OPENAI_MARK} fill={provider === 'claude' ? CLAUDE_COLOR : provider === 'agy' ? AGY_COLOR : C.text2} />
  </Svg>;
}

/** One IA: its mark inside a ring that is the part of the 5-hour window still free; the details show on hover (or a tap). */
function Ring({ provider, limits }) {
  const [open, setOpen] = useState(false);
  const five = left(windowOf(limits, 'five_hour')) ?? left(limits?.windows?.[0]);
  const size = 28, stroke = 2.4, radius = (size - stroke) / 2, length = 2 * Math.PI * radius;
  const color = five == null ? C.line2 : five < 15 ? C.red : C.accent;
  const line = window => `${LABEL[window.key] || window.key}: ${Math.round(left(window))}% livre${window.resetsAt ? ' · ' + renews(window.resetsAt) : ''}`;
  const spoken = five == null ? `${NAMES[provider]}: uso ainda não informado` : `${NAMES[provider]}: ${Math.round(five)}% livre nas 5 horas`;
  return <View style={{ position: 'relative' }}>
    <Pressable accessibilityRole="button" accessibilityLabel={spoken} onHoverIn={() => setOpen(true)} onHoverOut={() => setOpen(false)} onPress={() => setOpen(value => !value)}
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={C.line} strokeWidth={stroke} fill="none" />
        {five != null ? <Circle cx={size / 2} cy={size / 2} r={radius} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={`${length * five / 100} ${length}`} /> : null}
      </Svg>
      <Mark provider={provider} size={13} />
    </Pressable>
    {open ? <View pointerEvents="none" style={{ position: 'absolute', top: size + 6, right: 0, zIndex: 50, minWidth: 230, maxWidth: 300, padding: 12, gap: 6, borderRadius: 12,
      backgroundColor: C.elevated, borderWidth: 1, borderColor: C.line2, boxShadow: '0 12px 30px rgba(0,0,0,0.25)' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}><Mark provider={provider} size={15} /><Text style={{ color: C.text, fontFamily: F.s, fontSize: 13 }}>{NAMES[provider]}</Text></View>
      {limits?.windows?.length ? limits.windows.map(window => <Text key={window.key} style={{ color: C.text2, fontFamily: F.m, fontSize: 12 }}>{line(window)}</Text>)
        : <Text style={{ color: C.muted, fontFamily: F.m, fontSize: 12 }}>O uso aparece depois da primeira resposta desta IA.</Text>}
      {/* Antigravity counts some groups of models apart (Claude and GPT, a single Gemini model): each one, below. */}
      {(limits?.groups || []).length > 1 ? limits.groups.slice(1).map(group => <View key={group.name} style={{ marginTop: 4 }}>
        <Text style={{ color: C.muted, fontFamily: F.s, fontSize: 11.5 }}>{group.name}</Text>
        {group.windows.map(window => <Text key={window.key} style={{ color: C.text2, fontFamily: F.m, fontSize: 12 }}>{line(window)}</Text>)}</View>) : null}
    </View> : null}
  </View>;
}

/** The connected IAs' usage, small, at the top of the window: Antigravity, Claude and Codex. */
export function UsageRings({ data }) {
  const limits = data?.usage?.limits || {};
  const shown = ['agy', 'claude', 'codex'].filter(provider => limits[provider] || data?.connections?.[provider]?.loggedIn);
  if (!shown.length) return null;
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 }}>
    {shown.map(provider => <Ring key={provider} provider={provider} limits={limits[provider]} />)}
  </View>;
}
