import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Avatar } from './shared';
import { C, F } from '../theme';
import { graphModel } from '../state/graph-layout';
import { GraphCanvas, useLayout } from '../screens/MemoryGraph';
import { botHues, look } from '../screens/memory-look';

// The same forces as the memory map's defaults, plus a keep-out disc where the Chefe stands.
const FORCES = { center: 0.06, repel: 360, link: 1, distance: 110 };
const store = { positions: {}, view: null };

// The Chefe's empty conversation: his face in the middle and the memory map growing around him like an aura. It is the real
// map (move a note, hover to light up its links); the view is fixed so nothing can slide behind him, and notes cannot enter his disc.
// It goes away as soon as the first message of this visit is sent.
export function ChiefHero({ bot, state, bots, call, onSessions }) {
  const [data, setData] = useState(null), [fit, setFit] = useState(null);
  useEffect(() => {
    let live = true;
    Promise.resolve(call?.('notes.graph', {})).then(value => { if (live && value?.nodes) setData(value); }).catch(() => {});
    return () => { live = false; };
  }, [call]);
  const model = useMemo(() => data && graphModel(data, { ghosts: true, orphans: true }), [data]);
  const hole = useMemo(() => 11.5 * Math.sqrt(model?.nodes.length || 0) + 34, [model]);
  const forces = useMemo(() => ({ ...FORCES, hole }), [hole]);
  const { positions, fitKey, drag } = useLayout(model, store, forces);
  const L = look();
  const hues = useMemo(() => botHues(bots || []), [bots, L]);
  const colorOf = useMemo(() => node => node.botId ? hues.get(node.botId) || L.node : L.node, [hues, L]);
  const live = model?.nodes.length && fit;
  // The face is as big as the disc it keeps clear, wherever the map puts its centre on screen.
  const disc = live ? Math.min(420, Math.max(160, 2 * hole * fit.k)) : 240;
  const at = live ? { left: fit.x - disc / 2, top: fit.y - disc / 2 } : null;
  return <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
    {model?.nodes.length ? <GraphCanvas model={model} positions={positions} colorOf={colorOf} onOpen={() => {}} fitKey={fitKey} store={store} transparent lockView soloLabel drag={drag} onFit={setFit} /> : null}
    <View pointerEvents="none" style={[{ position: 'absolute', width: disc, height: disc, borderRadius: disc / 2, alignItems: 'center', justifyContent: 'center' }, at || { left: '50%', top: '50%', marginLeft: -disc / 2, marginTop: -disc / 2 }]}>
      <Avatar bot={bot} size={Math.round(disc * 0.95)} state={state} tile={false} animated />
    </View>
    {onSessions ? <Pressable accessibilityRole="button" onPress={onSessions} style={{ position: 'absolute', bottom: 8, alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 12 }}>
      <Text style={{ color: C.muted, fontFamily: F.m, fontSize: 13 }}>Ver sessões</Text></Pressable> : null}
  </View>;
}
