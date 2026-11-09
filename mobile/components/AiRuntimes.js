import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Switch } from 'react-native';
import { C, F, Icon } from '../theme';
import { styles } from '../styles';

/**
 * The IAs installed on this device and on the computer (Codex, Claude Code, Antigravity, opencode), their versions, one button that
 * updates them all on both, and "Atualizar sozinho" (once a day on each device). See lib/ai-runtimes.mjs.
 */
const SOURCE = { mybots: 'mantida pelo MyBots', sistema: 'instalada no sistema', ponte: 'pelo Debian do Termux' };
function Device({ title, status }) {
  if (!status) return null;
  if (status.error) return <Text style={[styles.optionDetail, { color: C.amber, marginTop: 8 }]}>{title}: {status.error}</Text>;
  const list = (status.ais || []).filter(item => item.installed || item.latest);
  return <View style={{ marginTop: 10, gap: 6 }}>
    <Text style={[styles.optionLabel, { fontSize: 13 }]}>{title}</Text>
    {list.length ? list.map(item => <View key={item.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: item.latest && item.installed && item.latest !== item.installed ? C.amber : C.good }} />
      <Text style={[styles.optionDetail, { flex: 1 }]}>{item.name} {item.installed || 'não instalado'}{item.latest && item.latest !== item.installed ? ` · nova: ${item.latest}` : ''}</Text>
      <Text style={[styles.optionDetail, { fontSize: 11, color: C.faint }]}>{SOURCE[item.source] || ''}</Text>
    </View>) : <Text style={styles.optionDetail}>Nenhuma IA instalada aqui.</Text>}
  </View>;
}
function Results({ title, done }) {
  if (!done) return null;
  if (done.error) return <Text style={[styles.optionDetail, { color: C.amber }]}>{title}: {done.error}</Text>;
  return <View style={{ gap: 3 }}>{(done.results || []).filter(item => !item.skipped).map(item => <Text key={item.key} style={[styles.optionDetail, !item.ok && { color: C.amber }]}>{title} · {item.name}: {item.message}</Text>)}</View>;
}

export function AiRuntimes({ call }) {
  const [state, setState] = useState(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [done, setDone] = useState(null);
  const live = useRef(true);
  const load = async (check = true) => { try { const next = await call('ai.status', { check }); if (live.current) { setState(next); setError(''); } } catch (e) { if (live.current) setError(e.message); } };
  useEffect(() => { live.current = true; load(); return () => { live.current = false; }; }, []);
  const update = async () => {
    setBusy(true); setError(''); setDone(null);
    try { const result = await call('ai.update', {}); if (live.current) setDone(result); await load(false); }
    catch (e) { if (live.current) setError(e.message); } finally { if (live.current) setBusy(false); }
  };
  const auto = async on => { setState(old => ({ ...old, auto: on })); try { await call('ai.auto', { on }); } catch (e) { setError(e.message); load(false); } };
  const pending = [...(state?.local?.ais || []), ...(state?.pc?.ais || [])].filter(item => item.latest && item.installed && item.latest !== item.installed).length;
  return <View style={[styles.modeOption, { marginTop: 16 }]}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={styles.rowIcon}><Icon name={pending ? 'download' : 'refresh'} size={19} color={pending ? C.amber : C.accent} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.optionLabel}>IAs instaladas</Text>
        <Text style={styles.optionDetail}>{!state && !error ? 'Conferindo as versões…' : pending ? `${pending} ${pending > 1 ? 'IAs têm' : 'IA tem'} versão nova.` : 'Os bots usam as IAs deste aparelho e do computador.'}</Text>
      </View>
    </View>
    <Device title="Neste aparelho" status={state?.local} />
    {state?.pc ? <Device title="No computador" status={state.pc} /> : null}
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 }}>
      <Text style={[styles.optionDetail, { flex: 1 }]}>Atualizar sozinho (uma vez por dia, no celular e no computador)</Text>
      <Switch accessibilityLabel="Atualizar as IAs sozinho" value={state?.auto !== false} onValueChange={auto} trackColor={{ true: C.accent }} />
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel="Atualizar as IAs" disabled={busy} onPress={update} style={[styles.stopButton, { alignSelf: 'flex-start', marginTop: 12 }, busy && { opacity: 0.6 }]}>
      <Icon name="refresh" size={13} color={C.accent} /><Text style={[styles.stopText, { color: C.accent }]}>{busy ? 'Atualizando… (pode levar alguns minutos)' : 'Atualizar as IAs'}</Text>
    </Pressable>
    {error ? <Text style={[styles.optionDetail, { color: C.amber, marginTop: 8 }]}>{error}</Text> : null}
    {done ? <View style={{ marginTop: 10, gap: 4 }}><Results title="Aqui" done={done.local} /><Results title="Computador" done={done.pc} /></View> : null}
  </View>;
}
