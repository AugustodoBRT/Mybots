import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, Linking } from 'react-native';
import { C } from '../theme';
import { styles } from '../styles';
import { PrimaryButton } from './shared';
import { onRuntimeTerminal, terminalStart, terminalStop, terminalWrite } from '../termux';

const AIS = [['claude', 'Claude Code', 'Com a sua conta Claude'], ['codex', 'Codex', 'Com a sua conta ChatGPT'], ['agy', 'Antigravity', 'Com a sua conta Google']];
const ANSI = /\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[=>()][0-9A-Za-z]?|\r/g;
// Only a link that already ended counts: output arrives in pieces and a cut one would open a broken page.
const link = text => /https:\/\/[^\s"'<>]+(?=\s)/.exec(text)?.[0];

/** On the phone with everything inside the app: installs an AI by its own official installer and runs its own login, on screen. */
export function EmbeddedConnect({ connections, reload }) {
  const [running, setRunning] = useState(null); const [text, setText] = useState(''); const [exit, setExit] = useState(null); const [input, setInput] = useState(''); const [url, setUrl] = useState(null);
  // The supervisor rechecks logins every 30 seconds, so a login that just finished is remembered here until it catches up.
  const [justConnected, setJustConnected] = useState({});
  const kindRef = useRef(null); const opened = useRef(false); const output = useRef(''); const entered = useRef(false);
  useEffect(() => {
    const subscription = onRuntimeTerminal(event => {
      if (event.text) {
        const next = (output.current + event.text.replace(ANSI, '')).slice(-6000); output.current = next; setText(next);
        const found = link(next);
        if (found && !opened.current) { opened.current = true; setUrl(found); Linking.openURL(found).catch(() => {}); }
        // Antigravity's login is a menu on its own screen: its first option is the Google account.
        if (kindRef.current === 'agy' && !entered.current && next.includes('Select login method')) { entered.current = true; setTimeout(() => terminalWrite('\r'), 500); }
      }
      if (event.exit !== undefined) { setExit(event.exit); if (event.exit === 0 && kindRef.current) setJustConnected(old => ({ ...old, [kindRef.current]: true })); reload?.(); }
    });
    return () => { subscription.remove(); terminalStop(); };
  }, [reload]);
  const start = kind => { kindRef.current = kind; opened.current = false; entered.current = false; output.current = ''; setUrl(null); setText(''); setExit(null); setInput(''); setRunning(kind); terminalStart(kind).catch(error => { setText(error.message); setExit(-1); }); };
  const name = AIS.find(item => item[0] === running)?.[1];
  const send = () => {
    if (running === 'agy') { terminalWrite(input.trim()); setTimeout(() => terminalWrite('\r'), 300); } else terminalWrite(input.trim() + '\n');
    setInput('');
  };
  // Antigravity draws a full screen meant for a terminal; here only what the person has to do is shown.
  const shown = exit === 0 ? 'Pronto. Já pode escolher esta IA nos seus bots.'
    : running === 'agy' && entered.current ? (exit !== null ? 'O login não terminou. Volte e tente de novo.' : url ? 'Entre com a sua conta Google na página que abriu. No fim ela mostra um código: copie e cole abaixo.' : 'Abrindo o login…')
    : text;
  return <View style={[styles.modeOption, { marginBottom: 16 }]}>
    <Text style={styles.optionLabel}>Conectar uma IA</Text>
    <Text style={styles.optionDetail}>A instalação vem do próprio fabricante e o login acontece na página dele. O MyBots não guarda a sua senha.</Text>
    {!running ? AIS.map(([kind, title, detail]) => <View key={kind} style={{ marginTop: 12 }}>
      <Text style={styles.optionLabel}>{title}</Text><Text style={styles.optionDetail}>{detail}</Text>
      {connections?.[kind]?.loggedIn || justConnected[kind]
        ? <View style={{ marginTop: 8 }}><Text style={[styles.optionDetail, { color: C.accent }]}>Conectado</Text>
          {kind === 'agy' ? null : <Pressable accessibilityRole="button" accessibilityLabel={`Entrar de novo no ${title}`} onPress={() => start(kind)} style={{ marginTop: 6 }}><Text style={styles.stopText}>Entrar de novo</Text></Pressable>}</View>
        : <PrimaryButton icon="user" title={`Conectar ${title}`} onPress={() => start(kind)} style={{ marginTop: 8 }} />}
    </View>) : <View style={{ marginTop: 12 }}>
      <Text style={styles.optionLabel}>{exit === null ? `Conectando ${name}…` : exit === 0 ? `${name} conectado` : `${name} não conectou`}</Text>
      <Text selectable style={[styles.optionDetail, { fontFamily: 'monospace', color: C.text, backgroundColor: C.surface2, padding: 10, borderRadius: 10, marginTop: 8 }]}>{shown || 'Baixando… pode levar alguns minutos.'}</Text>
      {url && exit === null ? <PrimaryButton icon="user" title="Abrir a página de login" onPress={() => Linking.openURL(url).catch(() => {})} style={{ marginTop: 10 }} /> : null}
      {exit === null ? <><Text style={[styles.optionDetail, { marginTop: 10 }]}>Se a página mostrar um código, cole aqui:</Text>
        <TextInput value={input} onChangeText={setInput} autoCapitalize="none" autoCorrect={false} placeholder="Código" placeholderTextColor={C.faint} style={styles.formInput} accessibilityLabel="Código de login" />
        <PrimaryButton title="Enviar" disabled={!input.trim()} onPress={send} style={{ marginTop: 8 }} /></> : null}
      <Pressable accessibilityRole="button" onPress={() => { terminalStop(); setRunning(null); }} style={{ marginTop: 12, alignSelf: 'center' }}><Text style={styles.stopText}>{exit === null ? 'Cancelar' : 'Voltar'}</Text></Pressable>
    </View>}
  </View>;
}
