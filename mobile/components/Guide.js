import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { styles, TOP } from '../styles';
import { C, Icon } from '../theme';
import { desktop, native } from '../desktop';
import { copyText } from '../native';
import { CHANGELOG } from '../changelog';
import { SheetHeader, PrimaryButton } from './shared';
import { readSeen, saveSeen } from './WhatsNew';

/** True once, on a device that never showed any news: it starts at this guide instead of the list of changes. */
export function useFirstUse(ready, open) {
  useEffect(() => { if (ready && !readSeen()) { saveSeen(CHANGELOG[0].version); open(); } }, [ready]);
}

const steps = () => [
  ['spark', 'Peça ao Chefe', 'Na primeira conversa, escreva como falaria com uma pessoa. Ele faz ou chama o bot que sabe fazer.'],
  ['plus', 'Crie seus bots', 'Um para cada assunto: estudos, vagas, finanças… Em cada um você escolhe a IA e o modelo, no alto da conversa.'],
  ['check', 'Você decide o que importa', 'Antes de ações sensíveis aparece um cartão para aprovar ou recusar.'],
  ['bolt', 'Peça rotinas', 'Por exemplo: "todo dia às 8h, veja minhas tarefas e me avise".'],
  ['alert', 'Algo errado?', desktop ? 'O botão Reportar, na barra lateral, manda direto para quem faz o MyBots.' : 'Em Ajustes → Reportar você manda direto para quem faz o MyBots.']
];

// On the computer's window: each AI with its state and one button that opens a terminal already doing the next step.
function ComputerAis({ onChanged }) {
  const [ais, setAis] = useState(null); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const checking = useRef(false); const watching = useRef(null); const ready = useRef(0);
  const check = useCallback(async () => {
    if (checking.current) return; checking.current = true; setBusy(true);
    try {
      const report = await native.ai.check(); if (!report?.ais) throw new Error();
      setAis(report.ais);
      const count = report.ais.filter(item => item.loggedIn).length;
      // A new login: the bots learn of it right away.
      if (count > ready.current) onChanged?.();
      ready.current = count;
    } catch { setNote('Não consegui verificar agora. Toque em Verificar para tentar de novo.'); }
    finally { checking.current = false; setBusy(false); }
  }, [onChanged]);
  useEffect(() => { check(); return () => clearInterval(watching.current); }, []);
  const act = async item => {
    const action = item.available ? 'login' : 'install';
    const opened = await native.ai.run(item.key, action).catch(() => false);
    if (!opened) { const command = action === 'login' ? item.login : item.install; await copyText(command).catch(() => {}); setNote(`Não consegui abrir o terminal. O comando foi copiado, cole num terminal: ${command}`); }
    else setNote(action === 'install' ? 'Instalando no terminal. Quando terminar, o botão Entrar aparece aqui.' : 'Termine o login no terminal e na página que abrir.');
    // Keeps looking for ten minutes, so the new state shows up by itself.
    clearInterval(watching.current); let rounds = 0;
    watching.current = setInterval(() => { if (++rounds >= 60) clearInterval(watching.current); check(); }, 10000);
  };
  return <View style={styles.modeOption}>
    <Text style={styles.optionDetail}>Use a assinatura que você já tem. Instalar e Entrar abrem o terminal com tudo pronto; esta tela confere sozinha.</Text>
    {!ais ? <Text style={[styles.optionDetail, { marginTop: 10 }]}>Verificando…</Text> : ais.map(item => <View key={item.key} style={[styles.passwordRow, { paddingVertical: 8 }]}>
      <View style={styles.rowIcon}><Icon name={item.loggedIn ? 'check' : 'user'} size={16} color={item.loggedIn ? C.good : C.faint} /></View>
      <View style={{ flex: 1 }}><Text style={styles.limitName}>{item.name}</Text>
        <Text style={styles.limitMeta}>{item.loggedIn ? 'Pronto' : item.available ? 'Instalado, falta entrar na sua conta' : item.install.startsWith('npm ') ? 'Não instalado (precisa do Node.js antes)' : 'Não instalado'}</Text></View>
      {item.loggedIn ? null : <Pressable accessibilityRole="button" accessibilityLabel={`${item.available ? 'Entrar no' : 'Instalar'} ${item.name}`} onPress={() => act(item)} style={styles.stopButton}><Text style={[styles.stopText, { color: C.accent }]}>{item.available ? 'Entrar' : 'Instalar'}</Text></Pressable>}
    </View>)}
    {note ? <Text selectable style={[styles.optionDetail, { color: C.amber }]}>{note}</Text> : null}
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => { setNote(''); check(); }} style={[styles.stopButton, { marginTop: 8, alignSelf: 'flex-start' }]}><Icon name="refresh" size={13} color={C.muted} /><Text style={styles.stopText}>{busy ? 'Verificando…' : 'Verificar'}</Text></Pressable>
  </View>;
}

/** The first-use guide: a page of the app itself. `connect` is the phone's own "Conectar uma IA", when the AIs run on it. */
export function Guide({ onClose, onChanged, connect = null }) {
  return <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 18, paddingTop: 18 + TOP, paddingBottom: 30, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
    <SheetHeader icon="spark" title="Como usar o MyBots" subtitle="Conecte uma IA e já pode conversar." onClose={onClose} />
    <Text style={[styles.optionLabel, { marginTop: 14, marginBottom: 8 }]}>1. Conecte uma IA (basta uma)</Text>
    {native?.ai ? <ComputerAis onChanged={onChanged} />
      : connect || <View style={styles.modeOption}><Text style={styles.optionDetail}>As IAs ficam no computador: abra o MyBots lá e siga este mesmo passo. Depois é só usar daqui.</Text></View>}
    {steps().map(([icon, title, text], position) => <View key={title} style={{ flexDirection: 'row', gap: 12, paddingTop: 16 }}>
      <View style={styles.rowIcon}><Icon name={icon} size={17} color={C.accent} /></View>
      <View style={{ flex: 1 }}><Text style={styles.optionLabel}>{position + 2}. {title}</Text><Text style={styles.optionDetail}>{text}</Text></View>
    </View>)}
    <PrimaryButton icon="check" title="Começar" onPress={onClose} style={{ marginTop: 22 }} />
  </ScrollView>;
}
