import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, Switch, StyleSheet } from 'react-native';
import { C, F, Icon, themed } from './theme';

const CHANNELS = [['whatsapp', 'WhatsApp'], ['olx', 'OLX'], ['marketplace', 'Facebook Marketplace'], ['email', 'E-mail']];
const TONES = [['friendly', 'Cordial'], ['direct', 'Direto'], ['formal', 'Formal'], ['casual', 'Descontraído']];
const STATUS = { active: 'Negociando', awaiting_you: 'Esperando você', closed: 'Fechado', expired: 'Prazo vencido', cancelled: 'Encerrado' };
const reais = cents => `R$ ${Math.floor(cents / 100).toLocaleString('pt-BR')},${String(cents % 100).padStart(2, '0')}`;
const when = value => new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const OFFER_STATE = { sent: 'enviada', blocked: 'bloqueada', proposed: 'proposta', accepted: 'aceita', refused: 'recusada' };
const blank = () => ({ id: null, objective: '', side: 'buy', target: '', limit: '', days: '3', channels: ['whatsapp'], canClose: false, tone: 'friendly', introduce: true });
const money = value => Number(String(value).replace(/\./g, '').replace(',', '.'));

/** The bot's negotiation mandates: what it may offer, until when and how it writes. The limits themselves live in the supervisor. */
export default function NegotiationPanel({ bot, negotiations, onNegotiation, disabled }) {
  const [form, setForm] = useState(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const field = (key, value) => setForm(old => ({ ...old, [key]: value }));
  const run = async action => { setBusy(true); setError(''); try { await action(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const save = () => run(async () => {
    await onNegotiation('negotiation.save', { id: form.id || undefined, botId: bot.id, objective: form.objective, side: form.side, target: money(form.target), limit: money(form.limit),
      deadline: new Date(Date.now() + Math.max(0.04, Number(String(form.days).replace(',', '.')) || 0) * 86400000).toISOString(), channels: form.channels, canClose: form.canClose, tone: form.tone, introduce: form.introduce });
    setForm(null);
  });
  const edit = item => setForm({ id: item.id, objective: item.objective, side: item.side, target: String(item.target / 100).replace('.', ','), limit: String(item.limit / 100).replace('.', ','),
    days: String(Math.max(0.1, Math.round((Date.parse(item.deadline) - Date.now()) / 8640000) / 10)).replace('.', ','), channels: item.channels, canClose: item.canClose, tone: item.tone, introduce: item.introduce });
  const chip = (on, label, onPress) => <Pressable key={label} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress} style={[s.chip, on && s.chipOn]}><Text style={[s.chipText, on && { color: C.accent }]}>{label}</Text></Pressable>;
  const own = negotiations.filter(item => item.botId === bot.id);
  const open = item => item.status === 'active' || item.status === 'awaiting_you';
  return <View>
    <Text style={s.title}>Negociar em seu nome</Text>
    <Text style={s.hint}>Você define o objetivo, o preço e o prazo. {bot.name} escreve como você, no tom escolhido, e o MyBots recusa qualquer oferta fora do teto (compra) ou do mínimo (venda). Fechar fora do mandato, ou sem sua permissão, vira um cartão Aceitar/Recusar. Senha, cartão e código nunca passam pela IA.</Text>
    {own.map(item => <View key={item.id} style={s.item}>
      <View style={s.row}><Text style={s.itemTitle} numberOfLines={2}>{item.objective}</Text><Text style={[s.status, item.status === 'awaiting_you' && { color: C.amber }, item.status === 'closed' && { color: C.accent }]}>{STATUS[item.status]}</Text></View>
      <Text style={s.hint}>{item.side === 'buy' ? 'Compra' : 'Venda'} · alvo {reais(item.target)} · {item.side === 'buy' ? 'teto' : 'mínimo'} {reais(item.limit)} · até {when(item.deadline)} · {item.canClose ? 'pode fechar' : 'só traz a proposta'}</Text>
      <Text style={s.hint}>{item.lastOffer ? `Última oferta: ${reais(item.lastOffer.amount)} (${item.lastOffer.direction === 'out' ? 'sua' : 'deles'}, ${OFFER_STATE[item.lastOffer.state] || item.lastOffer.state})` : 'Nenhuma oferta ainda.'}</Text>
      {item.offers.slice(-4).map(offer => <Text key={offer.id} style={s.history}>{when(offer.at)} · {offer.direction === 'out' ? 'Oferta' : 'Proposta'} {offer.amount ? reais(offer.amount) : ''} · {OFFER_STATE[offer.state]}{offer.reason ? ` — ${offer.reason}` : ''}</Text>)}
      {open(item) ? <View style={s.row}>
        <Pressable accessibilityRole="button" disabled={busy || disabled} onPress={() => edit(item)} style={s.small}><Icon name="edit" size={13} color={C.accent} /><Text style={[s.smallText, { color: C.accent }]}>Editar</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={busy || disabled} onPress={() => run(() => onNegotiation('negotiation.cancel', { id: item.id }))} style={s.small}><Icon name="stop" size={13} color={C.amber} /><Text style={[s.smallText, { color: C.amber }]}>Encerrar</Text></Pressable>
      </View> : null}
    </View>)}
    {form ? <View style={s.form}>
      <Text style={s.label}>OBJETIVO</Text>
      <TextInput value={form.objective} onChangeText={value => field('objective', value)} placeholder="Ex.: comprar a bicicleta aro 29 anunciada na OLX" placeholderTextColor={C.faint} multiline maxLength={300} style={[s.input, { minHeight: 64 }]} />
      <View style={s.row}>{chip(form.side === 'buy', 'Comprar', () => field('side', 'buy'))}{chip(form.side === 'sell', 'Vender', () => field('side', 'sell'))}</View>
      <View style={s.row}>
        <View style={{ flex: 1 }}><Text style={s.label}>PREÇO-ALVO (R$)</Text><TextInput value={form.target} onChangeText={value => field('target', value)} keyboardType="decimal-pad" placeholder="800" placeholderTextColor={C.faint} style={s.input} /></View>
        <View style={{ flex: 1 }}><Text style={s.label}>{form.side === 'buy' ? 'TETO (R$)' : 'MÍNIMO (R$)'}</Text><TextInput value={form.limit} onChangeText={value => field('limit', value)} keyboardType="decimal-pad" placeholder="900" placeholderTextColor={C.faint} style={s.input} /></View>
        <View style={{ flex: 0.8 }}><Text style={s.label}>PRAZO (DIAS)</Text><TextInput value={form.days} onChangeText={value => field('days', value)} keyboardType="decimal-pad" placeholder="3" placeholderTextColor={C.faint} style={s.input} /></View>
      </View>
      <Text style={s.label}>CANAIS</Text>
      <View style={[s.row, { flexWrap: 'wrap' }]}>{CHANNELS.map(([key, label]) => chip(form.channels.includes(key), label, () => field('channels', form.channels.includes(key) ? form.channels.filter(item => item !== key) : [...form.channels, key])))}</View>
      <View style={s.switchRow}><View style={{ flex: 1 }}><Text style={s.itemTitle}>Pode fechar sozinho</Text><Text style={s.hint}>Dentro do mandato, o bot fecha (e paga pela carteira, se for compra). Desligado, ele só traz a melhor proposta com Aceitar/Recusar.</Text></View>
        <Switch accessibilityLabel="Pode fechar sozinho" value={form.canClose} trackColor={{ false: C.line2, true: C.accent + '88' }} thumbColor={form.canClose ? C.accent : C.muted} onValueChange={value => field('canClose', value)} /></View>
      <Text style={s.label}>TOM DAS MENSAGENS</Text>
      <View style={[s.row, { flexWrap: 'wrap' }]}>{TONES.map(([key, label]) => chip(form.tone === key, label, () => field('tone', key)))}</View>
      <View style={s.switchRow}><View style={{ flex: 1 }}><Text style={s.itemTitle}>Apresentar-se como assistente</Text><Text style={s.hint}>Ligado, o bot diz que é o assistente de quem negocia. Desligado, ele escreve em seu nome sem se apresentar, mas nunca nega ser um assistente se perguntarem.</Text></View>
        <Switch accessibilityLabel="Apresentar-se como assistente" value={form.introduce} trackColor={{ false: C.line2, true: C.accent + '88' }} thumbColor={form.introduce ? C.accent : C.muted} onValueChange={value => field('introduce', value)} /></View>
      {error ? <Text style={[s.hint, { color: C.amber }]}>{error}</Text> : null}
      <View style={s.row}>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => { setForm(null); setError(''); }} style={s.small}><Text style={s.smallText}>Cancelar</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={busy || disabled} onPress={save} style={[s.small, s.primary]}><Icon name="check" size={13} color={C.accentInk} /><Text style={[s.smallText, { color: C.accentInk }]}>{busy ? 'Salvando…' : form.id ? 'Salvar mandato' : 'Criar mandato'}</Text></Pressable>
      </View>
    </View> : <Pressable accessibilityRole="button" disabled={busy || disabled} onPress={() => setForm(blank())} style={s.add}><Icon name="plus" size={16} color={C.accent} /><Text style={[s.itemTitle, { color: C.accent }]}>Novo mandato de negociação</Text></Pressable>}
    {!form && error ? <Text style={[s.hint, { color: C.amber }]}>{error}</Text> : null}
  </View>;
}

const s = themed(() => ({
  title: { color: C.text, fontFamily: F.b, fontSize: 16, marginBottom: 6 }, hint: { color: C.muted, fontFamily: F.m, fontSize: 12.5, lineHeight: 18, marginTop: 4 },
  item: { backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.line, padding: 14, marginTop: 10, gap: 2 },
  itemTitle: { color: C.text, fontFamily: F.b, fontSize: 14, flexShrink: 1 }, status: { color: C.muted, fontFamily: F.b, fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, justifyContent: 'space-between' },
  history: { color: C.faint, fontFamily: F.m, fontSize: 11.5, marginTop: 2 },
  form: { backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.line2, padding: 14, marginTop: 12 },
  label: { color: C.faint, fontFamily: F.b, fontSize: 11, letterSpacing: 0.8, marginTop: 12, marginBottom: 6 },
  input: { color: C.text, fontFamily: F.m, fontSize: 14, backgroundColor: C.bg2, borderRadius: 12, borderWidth: 1, borderColor: C.line, paddingHorizontal: 12, paddingVertical: 10, textAlignVertical: 'top' },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: C.line2, backgroundColor: C.bg2 }, chipOn: { borderColor: C.accent + '90', backgroundColor: C.accent + '18' }, chipText: { color: C.text2, fontFamily: F.s, fontSize: 13 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  small: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: C.line2 }, smallText: { color: C.text2, fontFamily: F.b, fontSize: 12.5 },
  primary: { backgroundColor: C.accent, borderColor: C.accent },
  add: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, marginTop: 12, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.line2 },
}));
