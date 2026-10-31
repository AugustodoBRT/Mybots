import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Image } from 'react-native';
import { C, Icon, F, themed } from '../theme';
import { IconButton } from './shared';
import BotBrowserPanel, { browserFrames, TabStrip, AddressRow } from '../BotBrowserPanel';
import { native } from '../desktop';

const s = themed(() => ({
  side: { flex: 1, borderLeftWidth: 1, borderLeftColor: C.line, backgroundColor: C.bg2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 44, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: C.line },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 7, maxWidth: 170, height: 30, paddingLeft: 10, paddingRight: 8, borderRadius: 9 },
  tabOn: { backgroundColor: C.surface2 }, hover: { backgroundColor: C.surface },
  tabText: { color: C.muted, fontFamily: F.b, fontSize: 12.5, flexShrink: 1 }, tabTextOn: { color: C.text },
  menu: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  item: { width: '100%', maxWidth: 300, flexDirection: 'row', alignItems: 'center', gap: 12, height: 40, paddingHorizontal: 14, borderRadius: 10, backgroundColor: C.surface, borderWidth: 1, borderColor: 'transparent' },
  itemText: { flex: 1, color: C.text, fontFamily: F.b, fontSize: 13.5 },
  badge: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#000', fontFamily: F.x, fontSize: 10.5 },
  card: { gap: 8, alignItems: 'center' },
  shot: { width: '100%', borderRadius: 10, overflow: 'hidden', backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { color: C.text2, fontFamily: F.m, fontSize: 12.5, textAlign: 'center', paddingHorizontal: 6 },
  note: { color: C.muted, fontFamily: F.m, fontSize: 13, textAlign: 'center', padding: 24, lineHeight: 20 },
  full: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 40, backgroundColor: C.bg },
  composer: { position: 'absolute', left: 0, right: 0, bottom: 22, alignItems: 'center', zIndex: 2 },
  pill: { width: '60%', minWidth: 300, maxWidth: 640, flexDirection: 'row', alignItems: 'center', gap: 8, height: 42, paddingLeft: 16, paddingRight: 6, borderRadius: 21, backgroundColor: C.elevated, borderWidth: 1, borderColor: C.line2 },
  pillInput: { flex: 1, color: C.text, fontFamily: F.m, fontSize: 14, outlineStyle: 'none' },
  stripFlow: { height: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, backgroundColor: C.bg2, borderTopWidth: 1, borderTopColor: C.line },
  back: { width: 150, flexDirection: 'row', alignItems: 'center', gap: 8, height: 34, paddingHorizontal: 12, borderRadius: 10 },
  go: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: C.text }
}));

export const SIDE_KINDS = {
  browser: { label: 'Navegador', icon: 'globe', open: 'Abrir Navegador' },
  settings: { label: 'Configurações', icon: 'settings', open: 'Abrir Configurações do agente' },
  today: { label: 'Hoje', icon: 'hand', open: 'Aprovações e hoje' },
  file: { label: 'Arquivo', icon: 'file', open: 'Arquivo' }
};

/** The right bar's head: the open tabs (each closable), "+" for another one, expand and close. */
export function SideHeader({ tabs, active, onPick, onClose, onNew, wide, onWide, onHide, badge }) {
  return <View style={s.head}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ gap: 2, alignItems: 'center' }}>
      {tabs.map(kind => { const on = kind === active, info = SIDE_KINDS[kind];
        return <Pressable key={kind} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onPick(kind)} style={({ hovered }) => [s.tab, hovered && s.hover, on && s.tabOn]}>
          <Icon name={info.icon} size={15} color={on ? C.text : C.muted} /><Text numberOfLines={1} style={[s.tabText, on && s.tabTextOn]}>{info.label}</Text>
          {kind === 'today' && badge ? <View style={s.badge}><Text style={s.badgeText}>{badge}</Text></View> : null}
          <Pressable accessibilityRole="button" accessibilityLabel={`Fechar ${info.label}`} hitSlop={6} onPress={() => onClose(kind)}><Icon name="close" size={12} color={C.faint} /></Pressable></Pressable>; })}
    </ScrollView>
    <IconButton icon="plus" label="Abrir outra aba da barra" onPress={onNew} size={30} />
    <IconButton icon={wide ? 'shrink' : 'expand'} label={wide ? 'Estreitar a barra' : 'Alargar a barra'} onPress={onWide} size={30} />
    <IconButton icon="close" label="Fechar a barra" onPress={onHide} size={30} />
  </View>;
}

/** Nothing open in the bar: the one place to pick what to open, always inside the bar. */
export function SideMenu({ bot, waiting, onPick }) {
  const rows = [bot ? ['browser', SIDE_KINDS.browser.open] : null, bot ? ['settings', SIDE_KINDS.settings.open] : null, ['today', waiting ? `${SIDE_KINDS.today.open} (${waiting})` : SIDE_KINDS.today.open]].filter(Boolean);
  return <View style={s.menu}>
    {rows.map(([kind, label]) => <Pressable key={kind} accessibilityRole="button" onPress={() => onPick(kind)} style={({ hovered }) => [s.item, hovered && { backgroundColor: C.surface2 }]}>
      <Icon name={SIDE_KINDS[kind].icon} size={17} color={C.muted} /><Text style={s.itemText}>{label}</Text></Pressable>)}
  </View>;
}

export function SideFrame({ children }) { return <View style={s.side}>{children}</View>; }

const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

/**
 * The bot's browser in the bar: one card per tab with the last picture seen of it. A card opens that tab full window.
 * Pictures come from the live frames (already masked by the computer), so a tab nobody looked at yet shows its icon.
 */
export function BrowserCards(props) { return native ? <NativeCards onOpen={props.onOpen} /> : <StreamCards {...props} />; }
function StreamCards({ bot, call, onOpen }) {
  const [tabs, setTabs] = useState([]); const [shots, setShots] = useState({}); const [state, setState] = useState('connecting'); const live = useRef([]); const last = useRef({});
  useEffect(() => {
    setTabs([]); setShots({}); setState('connecting'); live.current = [];
    const listener = data => {
      if (data?.botId !== bot.id) return;
      const list = data.tabbar?.tabs || data.tabs;
      if (list) { live.current = list; setTabs(list); }
      if (data.closed) setState('closed');
      else if ((data.blob || data.image) && data.width) {
        setState('live');
        // A card needs a new picture only now and then.
        const now = live.current.find(tab => tab.active);
        if (now && Date.now() - (last.current[now.tab] || 0) > 1500) {
          last.current[now.tab] = Date.now();
          const uri = data.blob ? URL.createObjectURL(data.blob) : 'data:image/jpeg;base64,' + data.image;
          setShots(old => { if (data.blob && old[now.tab]?.uri) URL.revokeObjectURL(old[now.tab].uri); return { ...old, [now.tab]: { uri, ratio: data.width / data.height, url: now.url || '' } }; });
        }
      }
    };
    browserFrames.add(listener);
    call('browser.view', { botId: bot.id, on: true, native: false }).then(result => { if (!result?.online) setState('offline'); }).catch(() => setState('offline'));
    return () => { browserFrames.delete(listener); call('browser.view', { botId: bot.id, on: false }).catch(() => {}); };
  }, [bot.id]);
  const pick = tab => { Promise.resolve(tab.active ? null : call('browser.input', { botId: bot.id, input: { type: 'tab', tab: tab.tab } })).catch(() => {}); onOpen(); };
  const fresh = () => { call('browser.input', { botId: bot.id, input: { type: 'tab_new' } }).catch(() => {}); onOpen(); };
  return <View style={{ flex: 1 }}>
    <ScrollView contentContainerStyle={{ padding: 14, gap: 18 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Nova aba do navegador" onPress={fresh} disabled={tabs.length >= 5} style={({ hovered }) => [{ width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', opacity: tabs.length >= 5 ? 0.35 : 1 }, hovered && s.hover]}><Icon name="plus" size={16} color={C.muted} /></Pressable>
      {tabs.map(tab => { const shot = shots[tab.tab];
        return <Pressable key={tab.tab} accessibilityRole="button" accessibilityLabel={`Abrir a aba ${tab.title || hostOf(tab.url) || tab.tab}`} onPress={() => pick(tab)} style={s.card}>
          <View style={[s.shot, { aspectRatio: shot?.ratio || 1.6 }, tab.active && { borderColor: C.line2 }]}>
            {shot ? <Image source={{ uri: shot.uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" fadeDuration={0} />
              : <><Icon name="globe" size={22} color={C.faint} /><Text style={[s.cardTitle, { color: C.faint, marginTop: 6 }]} numberOfLines={1}>{hostOf(tab.url) || 'Nova aba'}</Text></>}
          </View>
          <Text style={s.cardTitle} numberOfLines={1}>{tab.title || hostOf(tab.url) || 'Nova aba'}</Text>
        </Pressable>; })}
      {!tabs.length ? <Text style={s.note}>{state === 'offline' ? 'O computador está desconectado. As abas aparecem quando ele voltar.' : state === 'closed' ? 'O navegador deste bot está fechado.' : 'Abrindo o navegador do bot no computador…'}</Text> : null}
    </ScrollView>
  </View>;
}

/** The window's real tabs (Electron): the list, kept live by the window. */
function useNativeTabs() {
  const [state, setState] = useState({ active: null, tabs: [] });
  useEffect(() => { let live = true; native.tabs().then(value => live && value && setState(value)).catch(() => {}); const off = native.onTabs(value => live && setState(value)); return () => { live = false; off(); }; }, []);
  return state;
}

/** The sidebar's view of the real browser: one card per tab, with a picture the window takes of it now and then. */
function NativeCards({ onOpen }) {
  const { tabs, active } = useNativeTabs(); const [shots, setShots] = useState({});
  useEffect(() => {
    let live = true;
    const take = async () => { for (const tab of tabs.slice(0, 12)) { const uri = await native.thumb(tab.id).catch(() => null); if (!live) return; if (uri) setShots(old => ({ ...old, [tab.id]: uri })); } };
    take(); const timer = setInterval(take, 4000); return () => { live = false; clearInterval(timer); };
  }, [tabs.map(tab => tab.id).join()]);
  const open = async id => { await native.activate(id); onOpen(); };
  return <ScrollView contentContainerStyle={{ padding: 14, gap: 18 }}>
    <Pressable accessibilityRole="button" accessibilityLabel="Nova aba do navegador" onPress={async () => { await native.create(); onOpen(); }} style={({ hovered }) => [{ width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, hovered && s.hover]}><Icon name="plus" size={16} color={C.muted} /></Pressable>
    {tabs.map(tab => <Pressable key={tab.id} accessibilityRole="button" accessibilityLabel={`Abrir a aba ${tab.title || hostOf(tab.url) || tab.id}`} onPress={() => open(tab.id)} style={s.card}>
      <View style={[s.shot, { aspectRatio: 1.6 }, tab.id === active && { borderColor: C.line2 }]}>
        {shots[tab.id] ? <Image source={{ uri: shots[tab.id] }} style={{ width: '100%', height: '100%' }} resizeMode="cover" fadeDuration={0} /> : <Icon name="globe" size={22} color={C.faint} />}
      </View>
      <Text style={s.cardTitle} numberOfLines={1}>{tab.title || hostOf(tab.url) || 'Nova aba'}</Text>
    </Pressable>)}
  </ScrollView>;
}


/**
 * The bots' browser filling the whole app. In the Electron window it is real Chromium: the window puts the active tab over
 * the area this component leaves empty, so the page has its own mouse, selection, keyboard and speed. The tabs, the address
 * and the field to talk to the bot are ours. Anywhere else the page is streamed as pictures (BotBrowserPanel).
 */
function NativeFull({ bot, data, onClose, onSend }) {
  const { tabs, active } = useNativeTabs(); const hole = useRef(null); const [text, setText] = useState(''); const busy = Boolean(bot && data.active?.includes(bot.id));
  const current = tabs.find(tab => tab.id === active);
  useEffect(() => {
    const node = hole.current; if (!node?.getBoundingClientRect) return undefined;
    const send = () => { const box = node.getBoundingClientRect(); native.place({ x: box.left, y: box.top, width: box.width, height: box.height }); };
    send(); const watch = typeof ResizeObserver === 'function' ? new ResizeObserver(send) : null; watch?.observe(node); globalThis.addEventListener('resize', send);
    return () => { watch?.disconnect(); globalThis.removeEventListener('resize', send); native.place(null); };
  }, []);
  const go = async () => { const value = text.trim(); if (!value || busy) return; setText(''); if ((await onSend(value)) === false) setText(value); };
  return <View style={s.full}>
    <View style={{ paddingTop: 8, paddingHorizontal: 10, gap: 8, backgroundColor: C.bg2 }}>
      <TabStrip max={50} enabled tabs={tabs.map(tab => ({ tab: tab.id, title: tab.title, url: tab.url, icon: tab.icon, active: tab.id === active }))} onSwitch={id => native.activate(id)} onClose={id => native.close(id)} onNew={() => native.create()} />
      <AddressRow win enabled url={current?.url} back={current?.back} forward={current?.forward} onBack={() => native.nav(active, 'back')} onForward={() => native.nav(active, 'forward')} onReload={() => native.nav(active, 'reload')} onOpen={url => native.go(active, url)} placeholder="Digite um endereço ou uma busca" />
    </View>
    <View ref={hole} style={{ flex: 1 }} />
    <View style={s.stripFlow}>
      <Pressable accessibilityRole="button" accessibilityLabel="Voltar ao MyBots" onPress={onClose} style={({ hovered }) => [s.back, hovered && s.hover]}><Icon name="shrink" size={16} color={C.text2} /><Text style={s.tabText}>Voltar ao MyBots</Text></Pressable>
      <View style={{ flex: 1, alignItems: 'center' }}>{bot ? <View style={[s.pill, { width: '60%' }]}>
        <TextInput accessibilityLabel={`Mensagem para ${bot.name}`} value={text} onChangeText={setText} onSubmitEditing={go} placeholder={busy ? `${bot.name} está trabalhando…` : `Mensagem para ${bot.name}`} placeholderTextColor={C.faint} style={s.pillInput} selectionColor={C.accent} />
        <Pressable accessibilityRole="button" accessibilityLabel="Enviar" disabled={!text.trim() || busy} onPress={go} style={[s.go, (!text.trim() || busy) && { opacity: 0.4 }]}><Icon name="send" size={15} color={C.bg} /></Pressable>
      </View> : null}</View><View style={{ width: 150 }} />
    </View>
  </View>;
}

export function BrowserFull({ bot, data, call, onControl, onFile, onClose, onSend, color }) {
  const [text, setText] = useState(''); const busy = Boolean(data.active?.includes(bot.id));
  if (native) return <NativeFull bot={bot} data={data} onClose={onClose} onSend={onSend} />;
  const go = async () => { const value = text.trim(); if (!value || busy) return; setText(''); if ((await onSend(value)) === false) setText(value); };
  return <View style={s.full}>
    <BotBrowserPanel bot={bot} browser={data.browser} pc call={call} onControl={onControl} onClose={onClose} side onFile={onFile} color={color} keepView />
    <View pointerEvents="box-none" style={s.composer}><View style={s.pill}>
      <TextInput accessibilityLabel={`Mensagem para ${bot.name}`} value={text} onChangeText={setText} onSubmitEditing={go} placeholder={busy ? `${bot.name} está trabalhando…` : `Mensagem para ${bot.name}`} placeholderTextColor={C.faint} style={s.pillInput} selectionColor={C.accent} />
      <Pressable accessibilityRole="button" accessibilityLabel="Enviar" disabled={!text.trim() || busy} onPress={go} style={[s.go, (!text.trim() || busy) && { opacity: 0.4 }]}><Icon name="send" size={15} color={C.bg} /></Pressable>
    </View></View>
  </View>;
}
