import { useEffect, useState } from 'react';
import { View, Text, Image, Pressable, ActivityIndicator } from 'react-native';
import { C, themed } from '../theme';
import { F } from '../theme';
import { readImage, cachedImage } from '../attachment-images';

const s = themed(() => ({
  frame: { alignSelf: 'flex-start', width: '100%', maxWidth: 340, borderRadius: 18, overflow: 'hidden', backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line },
  hold: { alignItems: 'center', justifyContent: 'center', aspectRatio: 1.2, gap: 8, padding: 16 },
  note: { color: C.muted, fontFamily: F.m, fontSize: 13, textAlign: 'center' }
}));

/** A picture in the conversation, shown in its bubble like in a chat app; a tap opens the usual open / share / save sheet. */
export function ImageBubble({ file, onPress }) {
  const [uri, setUri] = useState(() => cachedImage(file)); const [failed, setFailed] = useState(''); const [ratio, setRatio] = useState(null); const [attempt, setAttempt] = useState(0);
  // Right after the app opens the connection may not be ready: try again a few times before giving up (a tap tries once more).
  useEffect(() => {
    let live = true, timer; if (uri) return undefined;
    readImage(file).then(value => { if (live) { setUri(value); setFailed(''); } }).catch(error => {
      if (!live) return; setFailed(error.message || 'Não consegui abrir a imagem.');
      if (attempt < 5) timer = setTimeout(() => { if (live) setAttempt(value => value + 1); }, 2500);
    });
    return () => { live = false; clearTimeout(timer); };
  }, [file.id, attempt]);
  return <Pressable accessibilityRole="imagebutton" accessibilityLabel={`Imagem ${file.name}: abrir, compartilhar ou salvar`} onPress={() => { if (!uri) { setFailed(''); setAttempt(value => value + 1); } else onPress(file); }} style={s.frame}>
    {uri ? <Image source={{ uri }} resizeMode="cover" style={{ width: '100%', aspectRatio: ratio || 1.2 }}
      onLoad={event => { const source = event.nativeEvent?.source || {}; if (source.width && source.height) setRatio(Math.min(2, Math.max(0.6, source.width / source.height))); }} onError={() => setFailed('Não consegui mostrar a imagem.')} />
      : <View style={s.hold}>{failed && attempt >= 5 ? <Text style={s.note}>{failed} Toque para tentar de novo.</Text> : <ActivityIndicator color={C.muted} />}</View>}
  </Pressable>;
}
