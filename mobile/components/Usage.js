import { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import Svg, { Line, Path, Circle, Text as SvgText } from 'react-native-svg';
import { styles } from '../styles';
import { C, Icon, F, themed, hueOf } from '../theme';
import { costOf } from '../../lib/pricing.mjs';
import { Avatar, tokensLabel, PLAN_NAMES, WINDOW_NAMES, resetLabel, nativeMessage } from './shared';

const u = themed(() => ({
  card: { borderRadius: 18, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, padding: 18, marginBottom: 16 },
  title: { color: C.text, fontFamily: F.b, fontSize: 16 }, hint: { color: C.muted, fontFamily: F.m, fontSize: 13, lineHeight: 19, marginTop: 4 },
  head: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  big: { color: C.text, fontFamily: F.x, fontSize: 30, letterSpacing: -1 }, bigNote: { color: C.muted, fontFamily: F.m, fontSize: 13.5, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 11, borderTopWidth: 1, borderTopColor: C.line },
  name: { color: C.text, fontFamily: F.b, fontSize: 15, flexShrink: 1 }, money: { color: C.text, fontFamily: F.b, fontSize: 16 },
  meta: { color: C.muted, fontFamily: F.m, fontSize: 12.5, marginTop: 3, lineHeight: 18 },
  share: { height: 5, borderRadius: 3, backgroundColor: C.line, overflow: 'hidden', marginTop: 7 }, shareFill: { height: 5, borderRadius: 3 },
  limits: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 }
}));

// US$ 1.234,56 in Brazilian format; anything above zero but under a cent still shows.
export const usd = value => !value ? 'US$ 0,00' : value < 0.01 ? 'menos de US$ 0,01' : `US$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// An older supervisor on the phone does not send the spend in dollars: then the chart shows tokens and each bot's value is
// worked out here from its tokens and the provider's main model (marked with ≈).
export const hasCost = usage => (usage?.days || []).some(day => typeof day.cost === 'number');
const botCost = (usage, id, period) => {
  const item = usage?.bots?.[id]; if (!item) return { value: 0, estimated: false };
  if (typeof item.cost?.[period] === 'number') return { value: item.cost[period], estimated: false };
  return { value: costOf({ provider: item.provider, ...item[period] }), estimated: true };
};
const weekday = date => new Date(date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
const niceMax = value => { const exp = 10 ** Math.floor(Math.log10(value)); const n = value / exp; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * exp; };

/** The estimated spend of each day as a line, with the value over every point and the tokens under the day. */
export function UsageChart({ days, byTokens = false }) {
  const [width, setWidth] = useState(0); const height = 250; const narrow = width > 0 && width < 560; const pad = { left: narrow ? 58 : 74, right: narrow ? 14 : 26, top: 34, bottom: narrow ? 52 : 62 };
  const costs = days.map(day => byTokens ? day.input + day.output : day.cost || 0); const top = niceMax(Math.max(byTokens ? 1 : 0.01, ...costs));
  const label = value => byTokens ? tokensLabel(Math.round(value)) : usd(value).replace('US$ ', '$ ');
  const wide = width >= 560; const peak = costs.indexOf(Math.max(...costs));
  // The first and last points keep away from the edges so their values do not touch the axis.
  const inner = narrow ? 16 : 38; const x = index => pad.left + inner + (width - pad.left - pad.right - 2 * inner) * (days.length > 1 ? index / (days.length - 1) : 0.5);
  const y = value => pad.top + (height - pad.top - pad.bottom) * (1 - value / top);
  const line = days.map((day, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)} ${y(costs[index]).toFixed(1)}`).join('');
  return <View onLayout={event => setWidth(Math.floor(event.nativeEvent.layout.width))} accessible accessibilityRole="image"
    accessibilityLabel={`${byTokens ? 'Uso em tokens por dia' : 'Gasto estimado por dia'}: ${days.map((day, index) => `${weekday(day.date)} ${byTokens ? tokensLabel(costs[index]) : usd(costs[index])}`).join(', ')}`}>
    {width > 0 ? <Svg width={width} height={height}>
      {[0, 0.5, 1].map(part => <Line key={part} x1={pad.left} x2={width - pad.right} y1={y(top * part)} y2={y(top * part)} stroke={C.line} strokeWidth="1" strokeDasharray={part ? '4 5' : undefined} />)}
      {[0, 0.5, 1].map(part => <SvgText key={'v' + part} x={pad.left - 10} y={y(top * part) + 4} fill={C.muted} fontSize="11.5" fontFamily={F.m} textAnchor="end">{part ? label(top * part) : byTokens ? '0' : '$ 0'}</SvgText>)}
      <Path d={line} stroke={C.accent} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" fill="none" />
      {days.map((day, index) => <Circle key={day.date} cx={x(index)} cy={y(costs[index])} r={index === days.length - 1 ? 5.5 : 4} fill={index === days.length - 1 ? C.accent : C.bg} stroke={C.accent} strokeWidth="2.2" />)}
      {days.map((day, index) => (wide || index === peak || index === days.length - 1) && costs[index] > 0
        ? <SvgText key={'l' + day.date} x={x(index)} y={y(costs[index]) - 12} fill={C.text} fontSize="12" fontFamily={F.b} textAnchor="middle">{label(costs[index])}</SvgText> : null)}
      {narrow ? days.map((day, index) => <SvgText key={'d' + day.date} x={x(index)} y={height - 30} fill={C.text2} fontSize="11.5" fontFamily={F.s} textAnchor="middle">{weekday(day.date).slice(0, 3)}</SvgText>)
        : days.map((day, index) => <SvgText key={'d' + day.date} x={x(index)} y={height - 34} fill={C.text2} fontSize="12" fontFamily={F.s} textAnchor="middle">{weekday(day.date)} {day.date.slice(8)}/{day.date.slice(5, 7)}</SvgText>)}
      {narrow ? days.map((day, index) => <SvgText key={'t' + day.date} x={x(index)} y={height - 14} fill={C.muted} fontSize="11" fontFamily={F.m} textAnchor="middle">{day.date.slice(8)}</SvgText>)
        : days.map((day, index) => <SvgText key={'t' + day.date} x={x(index)} y={height - 15} fill={C.muted} fontSize="11" fontFamily={F.m} textAnchor="middle">{tokensLabel(day.input + day.output)}</SvgText>)}
    </Svg> : <View style={{ height }} />}
  </View>;
}

/** The spend of the week in one number and as a line per day. */
export function UsageChartCard({ usage, bots = [] }) {
  const days = usage?.days || []; const priced = hasCost(usage); const total = days.reduce((sum, day) => sum + day.input + day.output, 0);
  const cost = priced ? days.reduce((sum, day) => sum + (day.cost || 0), 0) : Object.keys(usage?.bots || {}).reduce((sum, id) => sum + botCost(usage, id, 'week').value, 0);
  return <View style={u.card}>
    <View style={u.head}>
      <View><Text style={u.title}>{priced ? 'Gasto nos últimos 7 dias' : 'Uso nos últimos 7 dias'}</Text><Text style={u.big}>{priced ? usd(cost) : `${tokensLabel(total)} tokens`}</Text>
        {priced ? null : <Text style={u.bigNote}>≈ {usd(cost)} estimados</Text>}</View>
      <View style={{ alignItems: 'flex-end' }}>{priced ? <Text style={u.money}>{tokensLabel(total)} tokens</Text> : null}<Text style={u.bigNote}>só os bots do MyBots</Text></View>
    </View>
    <UsageChart days={days} byTokens={!priced} />
    {priced ? null : <Text style={[u.hint, { color: C.amber }]}>O supervisor do celular ainda é de uma versão anterior e não manda o gasto de cada dia em dólar. Atualize o app do celular para ver o dia a dia em dólar; por enquanto o gráfico mostra tokens e o valor de cada bot é uma estimativa com o preço do modelo principal.</Text>}
    <Text style={u.hint}>Valores estimados com os preços de tabela da API de cada modelo, para você ter uma ideia do peso do uso; a assinatura não cobra por token. A cada passo de uma resposta (cada ferramenta usada) a IA relê a conversa; a parte em cache custa bem menos.</Text>
  </View>;
}

/** Every bot with what it spent: dollars (week and today), tokens and answers, largest first. */
export function BotSpendCard({ usage, bots }) {
  const live = bots.filter(bot => !bot.deletedAt);
  const rows = live.map(bot => { const item = usage?.bots?.[bot.id]; const week = botCost(usage, bot.id, 'week'), today = botCost(usage, bot.id, 'today'); return { bot, week: item?.week || { input: 0, cached: 0, output: 0, turns: 0 }, today: item?.today || { input: 0, output: 0 }, cost: { week: week.value, today: today.value }, estimated: week.estimated }; })
    .sort((a, b) => b.cost.week - a.cost.week || (b.week.input + b.week.output) - (a.week.input + a.week.output) || a.bot.name.localeCompare(b.bot.name));
  const total = rows.reduce((sum, row) => sum + row.cost.week, 0); const tokens = rows.reduce((sum, row) => sum + row.week.input + row.week.output, 0);
  return <View style={u.card}>
    <View style={u.head}><View><Text style={u.title}>Gasto de cada bot</Text><Text style={u.hint}>Na semana, do maior para o menor.</Text></View>
      <View style={{ alignItems: 'flex-end' }}><Text style={u.money}>{rows.some(row => row.estimated && row.cost.week) ? '≈ ' : ''}{usd(total)}</Text><Text style={u.bigNote}>{tokensLabel(tokens)} tokens</Text></View></View>
    <View style={{ marginTop: 8 }}>
      {rows.map(row => <View key={row.bot.id} style={u.row}>
        <Avatar bot={row.bot} size={36} animated={false} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.limitHead}><Text style={u.name} numberOfLines={1}>{row.bot.name}</Text><Text style={u.money}>{row.estimated && row.cost.week ? '≈ ' : ''}{usd(row.cost.week)}</Text></View>
          <View style={u.share}><View style={[u.shareFill, { width: `${total ? Math.max(row.cost.week ? 2 : 0, row.cost.week / total * 100) : 0}%`, backgroundColor: hueOf(row.bot) }]} /></View>
          <Text style={u.meta}>{row.week.turns ? `${row.week.turns} ${row.week.turns > 1 ? 'respostas' : 'resposta'} · ${tokensLabel(row.week.input)} processados (${Math.round(row.week.cached / Math.max(1, row.week.input) * 100)}% em cache) · ${tokensLabel(row.week.output)} escritos · hoje ${row.estimated && row.cost.today ? '≈ ' : ''}${usd(row.cost.today)}` : 'Nenhuma resposta nesta semana'}</Text>
        </View>
      </View>)}
      {!rows.length ? <Text style={u.hint}>Crie um bot e o gasto de cada um aparece aqui.</Text> : null}
    </View>
  </View>;
}

/** One plan's limit windows (5 hours, week) with the button that asks again; `onRefresh(provider)` does the asking. */
function LimitCard({ provider, item, connected, onRefresh }) {
  const [busy, setBusy] = useState(false); const [note, setNote] = useState('');
  const ask = async () => { setBusy(true); setNote(''); try { await onRefresh(provider); } catch (error) { setNote(nativeMessage(error)); } finally { setBusy(false); } };
  const button = <Pressable accessibilityRole="button" disabled={busy} onPress={ask} style={styles.stopButton}>{busy ? <ActivityIndicator size="small" color={C.accent} /> : <Icon name="refresh" size={13} color={C.accent} />}<Text style={[styles.stopText, { color: C.accent }]}>{busy ? 'Consultando' : 'Consultar agora'}</Text></Pressable>;
  if (!item) return <View style={[u.card, { flex: 1, minWidth: 290 }]}><Text style={u.title}>{PLAN_NAMES[provider]} · limite da assinatura</Text>
    <Text style={u.hint}>{provider === 'claude' ? 'O Claude só informa o limite junto de uma resposta. Aparece aqui depois que um bot com Claude responder, ou consulte agora com uma resposta curtinha do Haiku.' : 'Ainda não consultado.'}</Text>
    {note ? <Text style={[u.hint, { color: C.amber }]}>{note}</Text> : null}<View style={{ alignItems: 'flex-start', marginTop: 10 }}>{button}</View></View>;
  return <View style={[u.card, { flex: 1, minWidth: 290 }]}>
    <Text style={u.title}>{PLAN_NAMES[provider]}{item.plan ? ` ${item.plan[0].toUpperCase()}${item.plan.slice(1)}` : ''} · limite da assinatura</Text>
    {item.windows.map(window => { const tone = window.used >= 90 ? C.red : window.used >= 70 ? C.amber : C.accent; return <View key={window.key} style={styles.limitRow}>
      <View style={styles.limitHead}><Text style={styles.limitName}>{WINDOW_NAMES[window.key] || window.key}</Text><Text style={[styles.limitValue, { color: tone }]}>{window.used}% usado</Text></View>
      <View style={styles.updateBar}><View style={[styles.updateFill, { width: `${Math.max(2, window.used)}%`, backgroundColor: tone }]} /></View>
      <Text style={styles.limitMeta}>{resetLabel(window.resetsAt)}</Text>
    </View>; })}
    <Text style={styles.limitMeta}>Atualizado {new Date(item.checkedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · vale para tudo que usa esta conta, não só o MyBots.</Text>
    {note ? <Text style={[u.hint, { color: C.amber }]}>{note}</Text> : null}
    {connected ? <View style={{ alignItems: 'flex-start', marginTop: 10 }}>{button}</View> : null}
  </View>;
}

/** The plans' limits, side by side when there is room. */
export function LimitsRow({ usage, connections, onRefresh }) {
  const providers = ['codex', 'claude'].filter(provider => usage?.limits?.[provider] || connections?.[provider]?.loggedIn);
  if (!providers.length) return null;
  return <View style={u.limits}>{providers.map(provider => <LimitCard key={provider} provider={provider} item={usage?.limits?.[provider]} connected={connections?.[provider]?.loggedIn} onRefresh={onRefresh} />)}</View>;
}

/** Use on the phone: limits, the line of the week and each bot's spend, one under the other. */
export function UsagePanel({ usage, bots, connections, onRefresh }) {
  const any = (usage?.days || []).some(day => day.input + day.output > 0);
  return <>
    <LimitsRow usage={usage} connections={connections} onRefresh={onRefresh} />
    {any ? <UsageChartCard usage={usage} bots={bots} /> : <View style={u.card}><Text style={u.title}>Uso</Text><Text style={u.hint}>Depois das primeiras respostas aparecem aqui o gasto estimado e os tokens de cada dia e de cada bot.</Text></View>}
    <BotSpendCard usage={usage} bots={bots} />
  </>;
}
