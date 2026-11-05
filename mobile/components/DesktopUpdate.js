import { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { styles } from '../styles';
import { C, Icon, F } from '../theme';
import { native } from '../desktop';
import { PrimaryButton } from './shared';

/**
 * The computer app's own update, the way the phone does it: "Nova versão · Atualizar", a click downloads and installs it and the
 * app restarts by itself. Where the system cannot (macOS without a signature, the .deb) the button opens the download page.
 * `full` is the line in Ajustes → Sobre (version and a check now); without it, only the banner and only when there is something to say.
 */
export function DesktopUpdate({ full = false }) {
  const [state, setState] = useState(null); const [checking, setChecking] = useState(false);
  const api = native?.update;
  useEffect(() => {
    if (!api) return undefined;
    let live = true;
    api.state().then(next => { if (live) setState(next); }).catch(() => {});
    const off = api.onState(next => { if (live) setState(next); });
    return () => { live = false; off?.(); };
  }, [api]);
  if (!api || !state) return null;
  const self = state.mode === 'self';
  const text = state.phase === 'available' ? `Nova versão ${state.version}${self ? '' : ' (baixar e instalar à mão)'}`
    : state.phase === 'downloading' ? `Baixando a versão ${state.version}… ${state.percent}%`
    : state.phase === 'installing' ? 'Instalando e reiniciando o MyBots…' : null;
  const check = async () => { setChecking(true); try { setState(await api.check()); } catch {} finally { setChecking(false); } };
  if (!full && !text) return null;
  const busy = state.phase === 'downloading' || state.phase === 'installing';
  // Not in Ajustes: a small pill in the top corner, not a banner that pushes everything down.
  if (!full) {
    const label = state.phase === 'downloading' ? `Baixando ${state.percent}%` : state.phase === 'installing' ? 'Reiniciando…' : self ? `Atualizar · ${state.version}` : `Baixar · ${state.version}`;
    return <View pointerEvents="box-none" style={{ position: 'absolute', top: 8, right: 12, zIndex: 60, alignItems: 'flex-end', gap: 4 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={self ? `Atualizar para a versão ${state.version} e reiniciar` : `Baixar a versão ${state.version}`} disabled={busy} onPress={() => api.install()}
        style={({ hovered, pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, height: 26, paddingHorizontal: 10, borderRadius: 13, backgroundColor: C.accent, opacity: busy ? 0.75 : pressed ? 0.85 : hovered ? 0.95 : 1, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } })}>
        <Icon name={busy ? 'refresh' : 'download'} size={13} color={C.accentInk} />
        <Text style={{ color: C.accentInk, fontFamily: F.b, fontSize: 12.5 }}>{label}</Text>
      </Pressable>
      {state.error ? <Text style={{ color: C.amber, fontFamily: F.m, fontSize: 12, maxWidth: 260, textAlign: 'right' }}>{state.error}</Text> : null}
    </View>;
  }
  return <View style={[styles.modeOption, full ? null : { margin: 12, flexShrink: 1 }]}>
    <Text style={styles.optionLabel}>{full ? `MyBots ${state.current || ''}` : text}</Text>
    {full ? <Text style={[styles.optionDetail, text && { color: C.accent }]}>{text || (checking ? 'Procurando…' : 'Você está na versão mais nova.')}</Text> : null}
    {state.error ? <Text style={[styles.optionDetail, { color: C.amber }]}>{state.error}</Text> : null}
    {state.phase === 'available' ? <PrimaryButton icon="download" title={self ? 'Atualizar e reiniciar' : 'Baixar a versão nova'} onPress={() => api.install()} style={{ marginTop: 10 }} /> : null}
    {full && !busy && state.phase !== 'available' ? <PrimaryButton icon="refresh" tone="ghost" title={checking ? 'Procurando…' : 'Procurar atualizações'} disabled={checking} onPress={check} style={{ marginTop: 10 }} /> : null}
  </View>;
}
