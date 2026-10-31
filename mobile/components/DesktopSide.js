import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Image } from 'react-native';
import { C, Icon, F, themed } from '../theme';
import { IconButton } from './shared';
import BotBrowserPanel, { browserFrames } from '../BotBrowserPanel';

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
export function BrowserCards({ bot, call, onOpen }) {
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

/** One tab of the bot's browser filling the whole app, like a normal browser, with a field to talk to the bot while it works. */
export function BrowserFull({ bot, data, call, onControl, onFile, onClose, onSend, color }) {
  const [text, setText] = useState(''); const busy = Boolean(data.active?.includes(bot.id));
  const go = async () => { const value = text.trim(); if (!value || busy) return; setText(''); if ((await onSend(value)) === false) setText(value); };
  return <View style={s.full}>
    <BotBrowserPanel bot={bot} browser={data.browser} pc call={call} onControl={onControl} onClose={onClose} side onFile={onFile} color={color} keepView />
    <View pointerEvents="box-none" style={s.composer}>
      <View style={s.pill}>
        <TextInput accessibilityLabel={`Mensagem para ${bot.name}`} value={text} onChangeText={setText} onSubmitEditing={go} placeholder={busy ? `${bot.name} está trabalhando…` : `Mensagem para ${bot.name}`} placeholderTextColor={C.faint} style={s.pillInput} selectionColor={C.accent} />
        <Pressable accessibilityRole="button" accessibilityLabel="Enviar" disabled={!text.trim() || busy} onPress={go} style={[s.go, (!text.trim() || busy) && { opacity: 0.4 }]}><Icon name="send" size={15} color={C.bg} /></Pressable>
      </View>
    </View>
  </View>;
}
