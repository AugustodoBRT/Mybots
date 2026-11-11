import { useRef, useState } from 'react';
import { Modal, View, ScrollView, Text, Pressable, StyleSheet, Linking, TextInput } from 'react-native';
import { pwa } from '../desktop';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { styles } from '../styles';
import { C, Icon } from '../theme';
import { Avatar, PrimaryButton } from './shared';

const PATHS = { direct: 'pela rede local', relay: 'pelo relé do MyBots' };

/** Reads the QR the computer's MyBots shows. Calls `onRead(text)` once. */
export function QrScanner({ visible, onRead, onClose, title = 'Aponte para o QR do MyBots no computador.' }) {
  if (pwa) return <PasteLink visible={visible} onRead={onRead} onClose={onClose} />;
  return <CameraScanner visible={visible} onRead={onRead} onClose={onClose} title={title} />;
}

/** The iPhone's web app has no QR reader of its own (the iPhone's camera opens the link): the link can also be pasted. */
function PasteLink({ visible, onRead, onClose }) {
  const [text, setText] = useState('');
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <View style={{ flex: 1, justifyContent: 'center', padding: 22, backgroundColor: 'rgba(0,0,0,0.6)' }}>
      <View style={styles.modeOption}>
        <Text style={styles.optionLabel}>Colar o link do computador</Text>
        <Text style={styles.optionDetail}>No MyBots do computador, abra Ajustes → Celular → iPhone, copie o link e cole aqui.</Text>
        <TextInput value={text} onChangeText={setText} autoCapitalize="none" autoCorrect={false} placeholder="https://…" placeholderTextColor={C.faint} style={styles.formInput} accessibilityLabel="Link de pareamento" />
        <PrimaryButton icon="phone" title="Parear" disabled={!text.trim()} onPress={() => { const value = text.trim(); setText(''); onRead(value); }} style={{ marginTop: 12 }} />
        <Pressable accessibilityRole="button" onPress={onClose} style={{ marginTop: 12, alignSelf: 'center' }}><Text style={styles.stopText}>Cancelar</Text></Pressable>
      </View>
    </View>
  </Modal>;
}

function CameraScanner({ visible, onRead, onClose, title }) {
  const [permission, requestPermission] = useCameraPermissions(); const reading = useRef(false);
  return <Modal visible={visible} animationType="slide" onRequestClose={onClose} onShow={() => { reading.current = false; if (!permission?.granted) requestPermission(); }}>
    <View style={styles.scanner}>
      {permission?.granted ? <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => { if (reading.current || !/^mybots:\/\/computador\?/.test(data || '')) return; reading.current = true; onRead(data); }} /> : null}
      <View style={styles.scannerFrame} />
      <Text style={styles.scannerText}>{permission?.granted === false ? 'Permita a câmera para ler o QR do computador.' : title}</Text>
      <Pressable accessibilityRole="button" onPress={onClose} style={styles.scannerClose}><Text style={styles.denyText}>Cancelar</Text></Pressable>
    </View>
  </Modal>;
}

/** What using Termux means and how to set it up: the whole process, step by step. */
export function TermuxGuide({ onEnable, busy, enabled = false }) {
  const step = (n, title, detail, code) => <View key={n} style={{ marginTop: 14 }}>
    <Text style={styles.optionLabel}>{n}. {title}</Text>
    {detail ? <Text style={styles.optionDetail}>{detail}</Text> : null}
    {code ? <Text selectable style={[styles.optionDetail, { fontFamily: 'monospace', color: C.text, backgroundColor: C.surface2, padding: 10, borderRadius: 10, marginTop: 6 }]}>{code}</Text> : null}
  </View>;
  return <View>
    <Text style={styles.optionDetail}>O Termux deixa o celular ter o <Text style={{ color: C.text }}>próprio MyBots</Text>: bots, conversas e rotinas guardados nele, funcionando mesmo com o computador desligado e sincronizados com o computador quando os dois estão ligados. Também libera o que só existe no celular: controlar outros apps, senhas e carteira do bot, e avisos com a tela apagada. Sem o Termux, o celular depende do computador ficar ligado.</Text>
    {step(1, 'Instale o Termux e o Termux:API', 'Baixe os dois da mesma fonte (F-Droid ou GitHub), nunca um de cada. A versão da Play Store não serve.')}
    {step(2, 'Libere o MyBots no Termux', 'Abra o Termux e cole:', 'echo "allow-external-apps=true" >> ~/.termux/termux.properties && termux-reload-settings')}
    {step(3, 'Instale uma IA no Termux', 'O Codex é o mais simples. Depois entre na sua conta:', 'pkg install codex && codex login')}
    {step(4, 'Volte aqui e ative', 'Na primeira vez o MyBots prepara tudo no Termux sozinho e pode levar alguns minutos. Se ele pedir uma permissão, aceite. O que já está no computador continua lá, e o celular passa a sincronizar com ele.')}
    <Pressable accessibilityRole="link" onPress={() => Linking.openURL('https://github.com/AugustodoBRT/Mybots/blob/main/docs/configurar-celular.md').catch(() => {})} style={{ marginTop: 12 }}><Text style={[styles.stopText, { color: C.accent }]}>Guia completo, com soluções para problemas comuns</Text></Pressable>
    {onEnable ? <PrimaryButton icon="bolt" title={busy ? 'Preparando…' : enabled ? 'Preparar de novo' : 'Ativar o Termux'} disabled={busy} onPress={onEnable} style={{ marginTop: 16 }} /> : null}
  </View>;
}

/** First screen when nothing is set up: connect to the computer (the default) or set up Termux. */
export function SetupScreen({ onScanned, onTermux, onEmbedded, busy, error }) {
  const [scanning, setScanning] = useState(false); const [guide, setGuide] = useState(false);
  return <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 22, gap: 6 }}>
    <View style={{ alignItems: 'center', marginBottom: 8 }}><Avatar bot={{ name: 'MyBots', color: 'green', avatar: 'orbit' }} size={96} state="idle" /></View>
    <Text style={[styles.loadingTitle, { textAlign: 'center' }]}>Bem-vindo ao MyBots</Text>
    {guide ? <View style={{ marginTop: 10 }}>
      <TermuxGuide onEnable={onTermux} busy={busy} />
      <Pressable accessibilityRole="button" onPress={() => setGuide(false)} style={{ marginTop: 16, alignSelf: 'center' }}><Text style={styles.stopText}>Voltar</Text></Pressable>
    </View> : <>
      <Text style={[styles.loadingText, { textAlign: 'center' }]}>Seus bots trabalham no seu computador, e este app é a tela deles no celular.</Text>
      {onEmbedded ? <View style={[styles.modeOption, { marginTop: 18 }]}>
        <Text style={styles.optionLabel}>Usar só neste celular</Text>
        <Text style={styles.optionDetail}>Tudo roda dentro do app, sem computador e sem instalar mais nada. Na primeira vez a preparação leva alguns minutos.</Text>
        <PrimaryButton icon="phone" title={busy ? 'Preparando…' : 'Usar neste celular'} disabled={busy} onPress={onEmbedded} style={{ marginTop: 12 }} />
      </View> : null}
      <View style={[styles.modeOption, { marginTop: 18 }]}>
        <Text style={styles.optionLabel}>1. No computador</Text>
        <Text style={styles.optionDetail}>{pwa ? 'Instale o MyBots, entre nas suas contas de IA por lá e abra Ajustes → Celular → iPhone.' : 'Instale o MyBots, entre nas suas contas de IA por lá e abra Ajustes → Celular → Mostrar QR.'}</Text>
        <Text style={[styles.optionLabel, { marginTop: 10 }]}>2. Aqui</Text>
        <Text style={styles.optionDetail}>{pwa ? 'Aponte a câmera do iPhone para o QR da tela do computador e abra o link. Se preferir, cole o link abaixo. Pronto: os bots, as conversas e as rotinas aparecem. O computador precisa ficar ligado.' : 'Leia o QR. Pronto: a conversa, os bots e as rotinas aparecem, de qualquer rede. O computador precisa ficar ligado.'}</Text>
        <PrimaryButton icon="phone" title={busy ? 'Conectando…' : pwa ? 'Colar o link do computador' : 'Ler o QR do computador'} disabled={busy} onPress={() => setScanning(true)} style={{ marginTop: 14 }} />
      </View>
      {error ? <Text style={[styles.optionDetail, { color: C.amber, textAlign: 'center' }]}>{error}</Text> : null}
      {pwa ? null : <Pressable accessibilityRole="button" onPress={() => setGuide(true)} style={{ marginTop: 18, alignSelf: 'center', padding: 8 }}>
        <Text style={styles.stopText}>Prefere usar só o celular, sem depender do computador? (avançado, com Termux)</Text></Pressable>}
    </>}
    <QrScanner visible={scanning} onClose={() => setScanning(false)} onRead={data => { setScanning(false); onScanned(data); }} />
  </ScrollView>;
}

/** Settings → Computador when the phone has no Termux: who it is paired with, how it is connected, pair again or forget. */
export function RemotePanel({ link, state, onScanned, onForget, busy, note }) {
  const [scanning, setScanning] = useState(false);
  const online = state?.supervisorConnected !== false;
  return <View style={styles.modeOption}>
    <Text style={styles.optionLabel}>{link?.target?.name || 'Seu computador'}</Text>
    <View style={styles.passwordRow}>
      <View style={styles.rowIcon}><Icon name="laptop" size={17} color={online ? C.accent : C.faint} /></View>
      <View style={{ flex: 1 }}><Text style={styles.limitName}>{online ? `Conectado${state?.via ? ` ${PATHS[state.via] || ''}` : ''}` : 'Desligado ou fora de alcance'}</Text>
        <Text style={styles.limitMeta}>Seus bots, conversas e rotinas ficam no computador. Com ele desligado, o app não mostra nada novo.</Text></View>
    </View>
    <View style={{ flexDirection: 'row', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => setScanning(true)} style={styles.stopButton}><Icon name="laptop" size={13} color={C.accent} /><Text style={[styles.stopText, { color: C.accent }]}>Parear de novo</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={busy} onPress={onForget} style={styles.stopButton}><Icon name="trash" size={13} color={C.muted} /><Text style={styles.stopText}>Esquecer</Text></Pressable>
    </View>
    {note ? <Text style={[styles.optionDetail, { color: C.amber }]}>{note}</Text> : null}
    <QrScanner visible={scanning} onClose={() => setScanning(false)} onRead={data => { setScanning(false); onScanned(data); }} />
  </View>;
}
