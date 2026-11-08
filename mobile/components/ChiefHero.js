import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Avatar } from './shared';
import { C, F } from '../theme';
import { graphModel } from '../state/graph-layout';
import { GraphCanvas, useLayout } from '../screens/MemoryGraph';
import { botHues, look } from '../screens/memory-look';

const FORCES = { center: 0.08, repel: 420, link: 1, distance: 120 };
const store = { positions: {}, view: null };

// The Chefe's empty conversation: his face in the middle, the memory graph around it, only to look at.
// It goes away as soon as the first message of this visit is sent.
export function ChiefHero({ bot, state, bots, call, onHistory }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let live = true;
    Promise.resolve(call?.('notes.graph', {})).then(value => { if (live && value?.nodes) setData(value); }).catch(() => {});
    return () => { live = false; };
  }, [call]);
  const model = useMemo(() => data && graphModel(data, { ghosts: false, orphans: true }), [data]);
  const { positions, fitKey, drag } = useLayout(model, store, FORCES);
  const L = look();
  const hues = useMemo(() => botHues(bots || []), [bots, L]);
  const colorOf = useMemo(() => node => node.botId ? hues.get(node.botId) || L.node : L.node, [hues, L]);
  return <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
    {model?.nodes.length ? <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, opacity: 0.55 }}>
      <GraphCanvas model={model} positions={positions} colorOf={colorOf} onOpen={() => {}} fitKey={fitKey} store={store} compact transparent /></View> : null}
    <View pointerEvents="none" style={{ width: 270, height: 270, borderRadius: 135, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Avatar bot={bot} size={240} state={state} tile={false} animated />
    </View>
    {onHistory ? <Pressable accessibilityRole="button" onPress={onHistory} style={{ position: 'absolute', bottom: 8 }}>
      <Text style={{ color: C.muted, fontFamily: F.m, fontSize: 13 }}>Ver conversa anterior</Text></Pressable> : null}
  </View>;
}
