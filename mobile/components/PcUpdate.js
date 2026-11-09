import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { C, F, Icon } from '../theme';
import { styles } from '../styles';

/**
 * A small row for when the phone is away and the computer is at home: it asks the computer's MyBots to look for its new version and, if
 * there is one, to update and restart itself, exactly like its own "Atualizar" button. Goes through the link of the phone's supervisor.
 */
export function PcUpdate({ call }) {
  const [state, setState] = useState(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const live = useRef(true);
  const ask = async op => { try { const next = await call('pc.update', { op }); if (live.current) { setState(next); setError(''); } return next; } catch (e) { if (live.current) setError(e.message); return null; } };
  useEffect(() => { live.current = true; ask('state'); return () => { live.current = false; }; }, []);
  const running = state?.phase === 'downloading' || state?.phase === 'installing';
  // While it downloads and restarts, look again every few seconds (the computer goes away for a moment when it restarts).
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => ask('state'), 4000); return () => clearInterval(timer);
  }, [running]);
  const press = async () => {
    setBusy(true); setError('');
    try {
      if (state?.phase === 'available') await ask('install');
      else { const next = await ask('check'); if (next && next.phase === 'none') setError(''); }
    } finally { if (live.current) setBusy(false); }
  };
  const text = error ? error : !state ? 'Perguntando ao computador…'
    : state.unavailable ? 'Este computador não atualiza por aqui.'
    : state.phase === 'available' ? `Versão ${state.version} disponível (o computador está na ${state.current}).`
    : state.phase === 'downloading' ? `Baixando a versão ${state.version}… ${state.percent}%`
    : state.phase === 'installing' ? 'Instalando e reiniciando o computador…'
    : `O computador está na versão ${state.current}, a mais nova.`;
  const label = running ? 'Atualizando…' : state?.phase === 'available' ? (state.mode === 'self' ? 'Atualizar o computador' : 'Abrir a página de download no computador') : 'Procurar versão nova';
  return <View style={[styles.modeOption, styles.rowOption, { marginTop: 12 }]}>
    <View style={styles.rowIcon}><Icon name={state?.phase === 'available' ? 'download' : 'laptop'} size={19} color={error ? C.amber : C.accent} /></View>
    <View style={{ flex: 1 }}><Text style={styles.optionLabel}>Atualizar o computador</Text><Text style={[styles.optionDetail, error && { color: C.amber }]}>{text}</Text></View>
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={busy || running || state?.unavailable} onPress={press} style={[styles.stopButton, (busy || running) && { opacity: 0.6 }]}>
      <Icon name={state?.phase === 'available' ? 'download' : 'refresh'} size={13} color={C.accent} /><Text style={[styles.stopText, { color: C.accent }]}>{busy ? '…' : state?.phase === 'available' ? 'Atualizar' : 'Procurar'}</Text></Pressable>
  </View>;
}
