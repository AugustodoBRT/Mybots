import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Dimensions } from 'react-native';
import { BotBrowserView, browserAction, browserInfo } from './termux';
import { C, F, Icon } from './theme';

// The bot's request for help with its browser (login, password, CAPTCHA), shown in the conversation.
export function BrowserHelpCard({ bot, help, onOpen }) {
  return <View style={styles.helpCard}>
    <View style={styles.helpHead}><View style={styles.helpIcon}><Icon name="hand" size={18} color={C.sky} /></View><Text style={styles.helpEyebrow}>NAVEGADOR DO BOT</Text></View>
    <Text style={styles.helpTitle}>{bot.name} precisa de você</Text>
    <Text style={styles.helpBody}>{help.reason}</Text>
    <Text style={styles.helpHint}>Toque em Assumir, faça isso na página e depois em “Devolver ao bot”. A senha fica no navegador do bot; ela não vai para a IA.</Text>
    <Pressable accessibilityRole="button" onPress={onOpen} style={styles.helpButton}><Icon name="globe" size={17} color="#0F1D2E" stroke={2} /><Text style={styles.helpButtonText}>Abrir navegador e assumir</Text></Pressable>
  </View>;
}

/**
 * "Navegador do bot": the bot's own WebView, live. Watching only until the person taps "Assumir"; then the
 * bot's browser commands are refused until "Devolver ao bot".
 */
export default function BotBrowserPanel({ bot, browser, onControl, onClose }) {
  const [page, setPage] = useState(browser?.pages?.[bot.id] || null);
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const assumed = browser?.control?.[bot.id] === 'person';
  useEffect(() => { browserInfo().then(setInfo).catch(() => {}); }, []);
  const control = async who => {
    setBusy(true); setError('');
    try { await onControl(who); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const act = action => browserAction(bot.id, action).catch(() => {});
  if (!BotBrowserView) return null;
  return <View style={styles.panel}>
    <View style={styles.bar}>
      <View style={styles.lock}><Icon name="globe" size={16} color={assumed ? C.mint : C.muted} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1}>{page?.loading ? 'Carregando… ' : ''}{page?.title || (page?.url ? '' : `Navegador de ${bot.name}`)}</Text>
        <Text style={styles.url} numberOfLines={1}>{page?.url && page.url !== 'about:blank' ? page.url.replace(/^https?:\/\//, '') : 'Ainda não abriu nenhuma página.'}</Text>
      </View>
      {assumed ? <>
        <Pressable accessibilityRole="button" accessibilityLabel="Voltar página" hitSlop={6} onPress={() => act('back')} style={styles.tool}><Icon name="back" size={18} color={C.text2} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Recarregar página" hitSlop={6} onPress={() => act('reload')} style={styles.tool}><Icon name="refresh" size={17} color={C.text2} /></Pressable>
      </> : <Pressable accessibilityRole="button" accessibilityLabel="Fechar navegador" hitSlop={6} onPress={onClose} style={styles.tool}><Icon name="close" size={17} color={C.text2} /></Pressable>}
    </View>
    <View style={[styles.frame, assumed && styles.frameAssumed]}>
      <BotBrowserView botId={bot.id} interactive={assumed} style={StyleSheet.absoluteFill} onPage={event => setPage(event.nativeEvent)} />
      {!assumed ? <View pointerEvents="none" style={styles.watching}><Icon name="info" size={12} color={C.text2} /><Text style={styles.watchingText}>Só olhando</Text></View> : null}
    </View>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {assumed ? <Text style={styles.hint}>Você está usando o navegador; o bot espera. Login do Google não funciona aqui: para Gmail, Agenda e Drive use os apps da conta.</Text> : null}
    {info && !info.isolated ? <Text style={styles.hint}>Este celular não separa os navegadores dos bots: quando outro bot usar o navegador, os logins deste são apagados. Atualize o “Android System WebView”.</Text> : null}
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => control(assumed ? 'bot' : 'person')} style={[styles.control, assumed && styles.controlBack, busy && { opacity: 0.5 }]}>
      <Icon name={assumed ? 'bots' : 'hand'} size={18} color={assumed ? C.mint : C.mintInk} stroke={2} /><Text style={[styles.controlText, assumed && styles.controlBackText]}>{assumed ? 'Devolver ao bot' : 'Assumir'}</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  panel: { marginHorizontal: 12, marginTop: 10, marginBottom: 6, padding: 10, borderRadius: 24, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line2, gap: 9 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lock: { width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface2 },
  title: { color: C.text, fontFamily: F.b, fontSize: 13.5 }, url: { color: C.muted, fontFamily: F.m, fontSize: 11.5, marginTop: 1 },
  tool: { width: 36, height: 36, borderRadius: 12, backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line },
  frame: { height: Math.round(Dimensions.get('window').height * 0.42), borderRadius: 16, overflow: 'hidden', backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: C.line2 },
  frameAssumed: { borderColor: C.mint },
  watching: { position: 'absolute', right: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10, backgroundColor: '#090B10D9' },
  watchingText: { color: C.text2, fontFamily: F.b, fontSize: 10.5 },
  hint: { color: C.muted, fontFamily: F.m, fontSize: 11.5, lineHeight: 17 }, error: { color: C.red, fontFamily: F.m, fontSize: 12 },
  control: { minHeight: 48, flexDirection: 'row', gap: 8, borderRadius: 16, backgroundColor: C.mint, alignItems: 'center', justifyContent: 'center' }, controlText: { color: C.mintInk, fontFamily: F.x, fontSize: 14.5 },
  controlBack: { backgroundColor: C.surface2, borderWidth: 1, borderColor: C.mint }, controlBackText: { color: C.mint },
  helpCard: { padding: 16, borderRadius: 22, borderWidth: 1, borderColor: C.sky + '55', backgroundColor: '#111925', gap: 7 },
  helpHead: { flexDirection: 'row', alignItems: 'center', gap: 9 }, helpIcon: { width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: C.sky + '1C' },
  helpEyebrow: { color: C.sky, fontFamily: F.x, fontSize: 10, letterSpacing: 1.4 }, helpTitle: { color: C.text, fontFamily: F.x, fontSize: 16.5, marginTop: 2 },
  helpBody: { color: C.text2, fontFamily: F.m, fontSize: 14, lineHeight: 21 }, helpHint: { color: C.muted, fontFamily: F.m, fontSize: 12, lineHeight: 17 },
  helpButton: { minHeight: 48, flexDirection: 'row', gap: 8, borderRadius: 16, backgroundColor: C.sky, alignItems: 'center', justifyContent: 'center', marginTop: 6 }, helpButtonText: { color: '#0F1D2E', fontFamily: F.x, fontSize: 14 }
});
