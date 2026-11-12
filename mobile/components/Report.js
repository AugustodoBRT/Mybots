import { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, Image, Platform, ScrollView } from 'react-native';
import { styles } from '../styles';
import { C, F, Icon } from '../theme';
import { desktop } from '../desktop';
import { pickFile, shrinkImage } from '../termux';
import { APP_VERSION } from '../changelog';
import { SheetHeader, PrimaryButton } from './shared';

// Relatos go to the owner's own server (relay/reports.mjs). The app only sends; reading needs the owner's password.
export const REPORTS_URL = 'https://mybots-rele.duckdns.org/relatos/enviar';
const MAX_IMAGE = 4.5 * 1024 * 1024;
const web = Platform.OS === 'web';
// While a report form is open, files dropped or pasted on the window are its own (the conversation checks this).
let openForms = 0;
export const reportOpen = () => openForms > 0;

export const reportPlatform = () => Platform.OS === 'android' ? 'android' : desktop ? 'pc' : /iPhone|iPad/.test(globalThis.navigator?.userAgent || '') ? 'iphone' : 'web';
const deviceName = () => {
  if (Platform.OS === 'android') { const info = Platform.constants || {}; return [info.Manufacturer, info.Model, info.Release && `Android ${info.Release}`].filter(Boolean).join(' '); }
  const agent = globalThis.navigator?.userAgent || '';
  return /Windows/.test(agent) ? 'Windows' : /Mac OS/.test(agent) ? (/iPhone|iPad/.test(agent) ? 'iOS' : 'Mac') : /Linux/.test(agent) ? 'Linux' : '';
};

// On the computer and the web app the picture is redrawn smaller in a canvas: at most 1600 px, JPEG.
async function shrinkWebImage(file) {
  if (!/^image\//.test(file.type)) throw new Error('Escolha uma imagem (foto ou print).');
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => { const item = new globalThis.Image(); item.onload = () => resolve(item); item.onerror = () => reject(new Error('Não consegui abrir essa imagem.')); item.src = url; });
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const uri = canvas.toDataURL('image/jpeg', 0.85);
    return { mime: 'image/jpeg', data: uri.split(',')[1], uri };
  } finally { URL.revokeObjectURL(url); }
}

async function pickPhoneImage() {
  const file = await pickFile(); if (!file) return null;
  if (!/^image\//.test(file.mime || '')) throw new Error('Escolha uma imagem (foto ou print).');
  const small = await shrinkImage(file.data).catch(() => null);
  const photo = small ? { mime: 'image/jpeg', data: small } : { mime: file.mime, data: file.data };
  if (photo.data.length * 0.75 > MAX_IMAGE) throw new Error('Essa imagem é grande demais. Tente um print ou outra foto.');
  return { ...photo, uri: `data:${photo.mime};base64,${photo.data}` };
}

export async function sendReport({ text, image }, { url = REPORTS_URL, fetcher = globalThis.fetch } = {}) {
  let response;
  try {
    response = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, image: image ? { mime: image.mime, data: image.data } : undefined, version: APP_VERSION, platform: reportPlatform(), device: deviceName() }) });
  } catch { throw new Error('Sem conexão com a internet. Tente de novo daqui a pouco.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não consegui enviar agora. Tente de novo daqui a pouco.');
  return data;
}

/** Message plus an optional picture. On the computer the picture can also be dropped on the window or pasted with Ctrl+V. */
export function ReportForm({ active = true, onDone }) {
  const [text, setText] = useState(''), [image, setImage] = useState(null), [state, setState] = useState(''), [error, setError] = useState(''), [dragging, setDragging] = useState(false);
  const busy = state === 'sending' || state === 'reading';
  const take = async read => {
    setError(''); setState('reading');
    try { const picked = await read(); if (picked) setImage(picked); } catch (e) { setError(e.message); }
    setState('');
  };
  const takeRef = useRef(take); takeRef.current = take;
  // While the form is open, a dropped or pasted picture is its own: the capture phase keeps it from reaching the open conversation.
  useEffect(() => {
    if (!web || !active) return undefined;
    let depth = 0; const has = event => Boolean(event.dataTransfer?.types?.includes('Files'));
    const enter = event => { if (has(event)) { event.stopImmediatePropagation(); depth++; setDragging(true); } };
    const over = event => { if (has(event)) { event.preventDefault(); event.stopImmediatePropagation(); } };
    const leave = event => { if (has(event)) { event.stopImmediatePropagation(); if (--depth <= 0) { depth = 0; setDragging(false); } } };
    const drop = event => { depth = 0; setDragging(false); const file = event.dataTransfer?.files?.[0]; if (file) { event.preventDefault(); event.stopImmediatePropagation(); takeRef.current(() => shrinkWebImage(file)); } };
    const paste = event => { const file = Array.from(event.clipboardData?.files || []).find(item => /^image\//.test(item.type)); if (file) { event.preventDefault(); event.stopImmediatePropagation(); takeRef.current(() => shrinkWebImage(file)); } };
    const events = [['dragenter', enter], ['dragover', over], ['dragleave', leave], ['drop', drop], ['paste', paste]];
    for (const [name, handler] of events) globalThis.addEventListener(name, handler, true); openForms++;
    return () => { for (const [name, handler] of events) globalThis.removeEventListener(name, handler, true); openForms--; setDragging(false); };
  }, [active]);
  const choose = () => {
    if (!web) return take(pickPhoneImage);
    const input = globalThis.document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
    input.onchange = () => { const file = input.files?.[0]; if (file) take(() => shrinkWebImage(file)); }; input.click();
  };
  const submit = async () => {
    if (!text.trim()) { setError('Escreva o que aconteceu ou o que você gostaria.'); return; }
    setError(''); setState('sending');
    try { await sendReport({ text: text.trim(), image }); setText(''); setImage(null); setState('sent'); }
    catch (e) { setError(e.message); setState(''); }
  };
  if (state === 'sent') return <View style={{ alignItems: 'center', paddingVertical: 18, gap: 10 }}>
    <View style={{ width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: C.good + '22' }}><Icon name="check" size={26} color={C.good} /></View>
    <Text style={[styles.optionLabel, { textAlign: 'center' }]}>Recebido, obrigado!</Text>
    <Text style={[styles.optionDetail, { textAlign: 'center' }]}>Seu relato chegou para quem faz o MyBots.</Text>
    <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
      <PrimaryButton compact tone="ghost" icon="plus" title="Mandar outro" onPress={() => setState('')} />
      {onDone ? <PrimaryButton compact title="Fechar" onPress={onDone} /> : null}
    </View>
  </View>;
  return <View>
    <TextInput value={text} onChangeText={setText} editable={!busy} multiline maxLength={4000} textAlignVertical="top" placeholderTextColor={C.faint}
      placeholder="O que aconteceu, ou o que você gostaria que o MyBots fizesse?" accessibilityLabel="Mensagem do relato"
      style={[styles.formInput, { minHeight: 130, paddingTop: 12, paddingBottom: 12, fontFamily: F.r }, web && { outlineStyle: 'none' }]} />
    {image ? <View style={{ marginTop: 12, alignSelf: 'flex-start' }}>
      <Image source={{ uri: image.uri }} style={{ width: 180, height: 130, borderRadius: 12, backgroundColor: C.surface2 }} resizeMode="cover" accessibilityLabel="Foto anexada" />
      <Pressable accessibilityRole="button" accessibilityLabel="Tirar a foto" onPress={() => setImage(null)} hitSlop={8}
        style={{ position: 'absolute', top: 6, right: 6, width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.65)' }}><Icon name="close" size={15} color="#fff" /></Pressable>
    </View> : <Pressable accessibilityRole="button" onPress={choose} disabled={busy}
      style={({ pressed, hovered }) => [{ marginTop: 12, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: dragging ? C.accent : C.line2, paddingVertical: web ? 22 : 14, alignItems: 'center', gap: 6 },
        (hovered || dragging) && { backgroundColor: C.surface }, pressed && styles.pressed]}>
      <Icon name="clip" size={20} color={dragging ? C.accent : C.muted} />
      <Text style={[styles.optionDetail, { marginTop: 0, color: dragging ? C.accent : C.text2 }]}>{state === 'reading' ? 'Preparando a foto…' : dragging ? 'Solte a imagem aqui' : web ? 'Adicionar uma foto (opcional): clique, arraste ou cole com Ctrl+V' : 'Adicionar uma foto ou print (opcional)'}</Text>
    </Pressable>}
    {error ? <Text style={[styles.optionDetail, { color: C.amber, marginTop: 10 }]}>{error}</Text> : null}
    <Text style={[styles.optionDetail, { marginTop: 12, fontSize: 12.5 }]}>Vão junto só a versão do app ({APP_VERSION}) e o tipo de aparelho. Suas conversas não são enviadas.</Text>
    <PrimaryButton icon={state === 'sending' ? undefined : 'send'} title={state === 'sending' ? 'Enviando…' : 'Enviar'} disabled={busy || !text.trim()} onPress={submit} style={{ marginTop: 14 }} />
  </View>;
}

/** The same form in a window (the computer's side rail). */
export function ReportSheet({ visible, onClose }) {
  return <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
    <View style={[styles.sheetBackdrop, { justifyContent: 'center', padding: 16 }]}>
      <View style={[styles.sheet, { maxWidth: 520, width: '100%', alignSelf: 'center', borderRadius: 24, maxHeight: '90%' }]}>
        <SheetHeader icon="alert" title="Reportar" subtitle="Conte um problema ou peça uma melhoria. Chega direto para quem faz o MyBots." onClose={onClose} />
        <ScrollView style={{ flexGrow: 0 }} keyboardShouldPersistTaps="handled">{visible ? <ReportForm active={visible} onDone={onClose} /> : null}</ScrollView>
      </View>
    </View>
  </Modal>;
}
