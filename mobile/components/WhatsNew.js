import { useEffect, useState } from 'react';
import { Modal, View, Text, ScrollView, Platform } from 'react-native';
import { styles } from '../styles';
import { C, F } from '../theme';
import { prefGet, prefSet } from '../termux';
import { CHANGELOG, KIND_LABEL, unseenVersions } from '../changelog';
import { SheetHeader, PrimaryButton } from './shared';

// Kept on this device: each phone and each computer shows the news once.
const KEY = 'mybots.seenVersion';
const readSeen = () => { try { return Platform.OS === 'web' ? globalThis.localStorage?.getItem(KEY) : prefGet(KEY); } catch { return null; } };
const saveSeen = value => { try { if (Platform.OS === 'web') globalThis.localStorage?.setItem(KEY, value); else prefSet(KEY, value); } catch {} };
const tone = kind => ({ novo: C.accent, melhoria: C.sky, correcao: C.good })[kind] || C.muted;
const date = iso => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });

/** After an update, as soon as the app is ready, a window with what changed; it closes only with the button and then stays quiet. */
export function WhatsNew({ ready }) {
  const [versions, setVersions] = useState([]);
  useEffect(() => {
    if (!ready) return undefined;
    // A moment after the app is ready, so it does not fight with the opening screen.
    const timer = setTimeout(() => setVersions(unseenVersions(readSeen())), 900);
    return () => clearTimeout(timer);
  }, [ready]);
  const close = () => { saveSeen(CHANGELOG[0].version); setVersions([]); };
  if (!versions.length) return null;
  return <Modal transparent visible animationType="fade" onRequestClose={close}>
    <View style={[styles.sheetBackdrop, { justifyContent: 'center', padding: 16 }]}>
      <View style={[styles.sheet, { maxWidth: 520, width: '100%', alignSelf: 'center', borderRadius: 24, maxHeight: '86%' }]}>
        <SheetHeader icon="spark" title={`Novidades do MyBots ${versions[0].version}`} subtitle={versions.length > 1 ? 'O que mudou desde a última vez que você abriu o app.' : 'O que mudou nesta versão.'} />
        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingBottom: 6 }}>
          {versions.map((entry, position) => <View key={entry.version} style={position > 0 && { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: C.line }}>
            {versions.length > 1 ? <Text style={[styles.optionLabel, { marginBottom: 6 }]}>{entry.version} · {date(entry.date)}</Text> : null}
            {entry.items.map(([kind, text]) => <View key={text} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 6 }}>
              <View style={{ minWidth: 76, alignItems: 'center', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: tone(kind) + '22', marginTop: 1 }}>
                <Text style={{ color: tone(kind), fontFamily: F.s, fontSize: 12 }}>{KIND_LABEL[kind]}</Text></View>
              <Text style={[styles.optionDetail, { flex: 1, marginTop: 0, color: C.text2 }]}>{text}</Text>
            </View>)}
          </View>)}
        </ScrollView>
        <PrimaryButton icon="check" title="Entendi" onPress={close} style={{ marginTop: 14 }} />
      </View>
    </View>
  </Modal>;
}
