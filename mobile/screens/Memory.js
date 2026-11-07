import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { MemoryGraph } from './MemoryGraph';
import { NoteReader } from './NoteReader';
import { noteChanged } from '../state/note-view';
import { TOP } from '../styles';
import { F, Icon, themed } from '../theme';
import { KIND_NAMES, botHues, look } from './memory-look';

const folders = { chefe: 'Chefe', entrega: 'Entregas', arquivo: 'Arquivo' };
const periods = [[0, 'Qualquer data'], [1, 'Últimas 24 horas'], [7, 'Últimos 7 dias'], [30, 'Últimos 30 dias']];
const noFilters = { query: '', kind: '', botId: '', days: 0 };
// The chosen view (list or map) is kept while the app is open. The list stays the default and the accessible path.
let rememberedView = 'list';

function Button({ label, name, onPress, selected, danger, disabled, primary }) {
  const L = look();
  return <Pressable accessibilityRole="button" accessibilityLabel={name} disabled={disabled} accessibilityState={{ selected, disabled }} onPress={onPress}
    style={({ hovered }) => [s.button, { borderColor: L.panelBorder, backgroundColor: primary ? L.accent : hovered || selected ? L.hover : L.panel }, disabled && { opacity: 0.5 }]}>
    <Text style={[s.label, { color: primary ? '#ffffff' : danger ? L.danger : selected ? L.text : L.muted }]}>{label}</Text></Pressable>;
}

function BarIcon({ icon, label, onPress, disabled }) {
  const L = look();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} disabled={disabled} hitSlop={6}
    style={({ hovered }) => [s.barIcon, hovered && { backgroundColor: L.hover }]}><Icon name={icon} size={20} color={L.muted} /></Pressable>;
}

function Highlight({ text, range, color }) {
  return range ? <>{text.slice(0, range[0])}<Text style={[s.highlight, { color }]}>{text.slice(...range)}</Text>{text.slice(range[1])}</> : text;
}

function age(date) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(date)) / 60000));
  if (!minutes) return 'agora';
  if (minutes < 60) return 'há ' + minutes + ' min';
  if (minutes < 1440) return 'há ' + Math.floor(minutes / 60) + ' h';
  const days = Math.floor(minutes / 1440);
  return days === 1 ? 'há 1 dia' : 'há ' + days + ' dias';
}

export function NoteRow({ note, hue, onOpen }) {
  const L = look();
  return <Pressable accessibilityRole="button" accessibilityLabel={'Ler ' + note.title} onPress={() => onOpen(note.path)}
    style={({ hovered }) => [s.row, { borderBottomColor: L.panelBorder }, hovered && { backgroundColor: L.hover }]}>
    <Text style={[s.rowTitle, { color: L.text }]} numberOfLines={1}><Highlight text={note.title} range={note.titleMatch} color={L.accent} /></Text>
    <View style={s.inline}>
      <View style={[s.dot, { backgroundColor: hue || L.node }]} />
      <Text style={[s.meta, { color: L.muted }]}>{note.botName || (note.botId ? 'Bot' : 'Você')} · {age(note.updatedAt)} · {note.outgoingCount} de saída · {note.incomingCount} de entrada</Text>
      {!note.outgoingCount && !note.incomingCount ? <Text style={[s.badge, { color: L.muted, borderColor: L.panelBorder }]}>Órfã</Text> : null}
    </View>
    <Text style={[s.snippet, { color: L.faint }]} numberOfLines={2}><Highlight text={note.snippet} range={note.snippetMatch} color={L.accent} /></Text>
  </Pressable>;
}

export function ViewToggle({ view, onChange }) {
  const L = look();
  return <View style={[s.segment, { backgroundColor: L.panel, borderColor: L.panelBorder }]}>
    {[['list', 'Lista', 'Ver como lista'], ['graph', 'Grafo', 'Ver como grafo']].map(([id, label, name]) =>
      <Pressable key={id} accessibilityRole="button" accessibilityLabel={name} accessibilityState={{ selected: view === id }} onPress={() => onChange(id)}
        style={[s.segmentItem, view === id && { backgroundColor: L.hover }]}>
        <Text style={[s.label, { color: view === id ? L.text : L.muted }]}>{label}</Text></Pressable>)}
  </View>;
}

function NoteFilters({ bots, filters, onChange }) {
  const L = look();
  const { query, kind, botId, days } = filters, [open, setOpen] = useState(false);
  function choices(label, options, selected, key) {
    return <View style={s.group}><Text style={[s.meta, { color: L.muted }]}>{label}</Text><View style={s.wrap}>{options.map(([id, name]) =>
      <Button key={id} label={name} selected={selected === id} onPress={() => onChange({ [key]: id })} />)}</View></View>;
  }
  return <View style={s.group}>
    <View style={s.inline}>
      <TextInput accessibilityLabel="Buscar nas notas" placeholder="Buscar nas notas" placeholderTextColor={L.faint} maxLength={200} value={query}
        onChangeText={value => onChange({ query: value })} style={[s.input, { flex: 1, backgroundColor: L.input, borderColor: L.panelBorder, color: L.text }]} />
      <Button label={open ? 'Fechar filtros' : 'Filtros'} selected={Boolean(kind || days || botId)} onPress={() => setOpen(!open)} />
      {kind || days || botId ? <Button label="Limpar filtros" onPress={() => onChange({ kind: '', days: 0, botId: '' })} /> : null}
    </View>
    {open ? <View style={[s.box, { backgroundColor: L.panel, borderColor: L.panelBorder }]}>
      {choices('Pasta', [['', 'Todas'], ...Object.entries(folders)], kind, 'kind')}
      {choices('Autor', [['', 'Todos'], ...bots.map(bot => [bot.id, bot.name])], botId, 'botId')}
      {choices('Período', periods, days, 'days')}
    </View> : null}
  </View>;
}

function NoteList({ bots, hues, call, version, onOpen, filters, pages, setPages }) {
  const L = look();
  const { query, kind, botId, days } = filters;
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    setLoading(true); setError('');
    const load = async () => {
      const params = { ...(kind && { kind }), ...(botId && { botId }), ...(days && { since: new Date(Date.now() - days * 86400000).toISOString() }) };
      let page;
      if (query.trim()) page = await call('notes.search', { ...params, query: query.trim(), limit: 100 });
      else {
        const notes = [];
        for (let i = 0; i < pages && live; i++) {
          page = await call('notes.list', { ...params, ...(page?.nextCursor && { cursor: page.nextCursor }) });
          notes.push(...page.notes);
          if (!page.nextCursor) break;
        }
        page = { ...page, notes };
      }
      if (live) setResult(page);
    };
    const timer = setTimeout(() => load().catch(e => { if (live) setError(e.message); }).finally(() => { if (live) setLoading(false); }), query ? 180 : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [call, query, kind, botId, days, version, pages, retry]);
  return <>
    {loading && !result ? <Text style={[s.meta, { color: L.muted }]}>Carregando notas…</Text> : error ? <><Text style={[s.meta, { color: L.danger }]}>{error}</Text><Button label="Tentar novamente" onPress={() => setRetry(n => n + 1)} /></> :
      !result?.notes.length ? <Text style={[s.empty, { color: L.muted }]}>{query || kind || days || botId ? 'Nenhuma nota encontrada. Tente outro termo ou ajuste os filtros.' : 'Os bots ainda não deixaram anotações. Peça ao Chefe para anotar algo.'}</Text> :
      Object.entries(folders).map(([id, name]) => {
        const items = result.notes.filter(note => note.kind === id);
        return items.length ? <View key={id}><Text style={[s.folder, { color: L.muted }]}>{name.toUpperCase()} · {items.length}</Text>
          {items.map(note => <NoteRow key={note.path} note={note} hue={hues.get(note.botId)} onOpen={onOpen} />)}</View> : null;
      })}
    {!loading && !error && result?.more ? query.trim() ? <Text style={[s.meta, { color: L.muted }]}>Mostrando os 100 primeiros resultados. Refine sua busca.</Text> :
      <Button label="Carregar mais notas" onPress={() => setPages(n => n + 1)} /> : null}
  </>;
}

export function References({ label, items, onOpen }) {
  const L = look();
  return <View style={s.group}><Text style={[s.folder, { color: L.muted }]}>{label}</Text>
    {items.length ? items.map(item => <Pressable key={item.path} accessibilityRole={item.exists === false ? undefined : 'link'}
      disabled={item.exists === false} onPress={() => onOpen(item.path)} style={s.reference}>
      <Text style={{ color: L.link, opacity: item.exists === false ? 0.55 : 1, fontFamily: F.s }}>{item.title}</Text>
      <Text style={[s.meta, { color: L.faint }]}>{item.exists === false ? 'Nota ainda não criada' : item.path}</Text>
      {item.snippet ? <Text style={[s.meta, { color: L.faint }]} numberOfLines={2}>{item.snippet}</Text> : null}</Pressable>) : <Text style={[s.meta, { color: L.faint }]}>Nenhuma nota.</Text>}
  </View>;
}

export function MemoryScreen({ bots, call, version, onClose }) {
  const L = look();
  const [stack, setStack] = useState([]), path = stack.at(-1);
  const [note, setNote] = useState(null), [editor, setEditor] = useState(null), [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [loadError, setLoadError] = useState(''), [reload, setReload] = useState(0);
  const [filters, setFilters] = useState(noFilters), [pages, setPages] = useState(1), [width, setWidth] = useState(0);
  const [view, setView] = useState(rememberedView), [graphMounted, setGraphMounted] = useState(rememberedView === 'graph');
  const list = useRef(null), listOffset = useRef(0);
  const changeFilters = patch => { setFilters(old => ({ ...old, ...patch })); setPages(1); };
  const chooseView = next => { rememberedView = next; setView(next); if (next === 'graph') setGraphMounted(true); };
  const hues = useMemo(() => botHues(bots), [bots, L]);
  const browsing = !path && !editor;
  useEffect(() => { if (browsing) list.current?.scrollTo({ y: listOffset.current, animated: false }); }, [browsing]);
  const latest = note?.path === path ? note : null;
  const conflict = editor?.base && (loadError || (latest && noteChanged(editor.base, latest)));
  useEffect(() => {
    let live = true;
    setLoadError('');
    if (path) call('notes.read', { path }).then(value => { if (live) setNote(value); })
      .catch(e => { if (live) { setNote(null); setLoadError(e.message); } });
    return () => { live = false; };
  }, [call, path, version, reload]);
  function open(next) {
    setEditor(null); setConfirm(''); setError('');
    setStack(old => old.at(-1) === next ? old : [...old, next]);
  }
  function back() {
    if (busy) return;
    setError('');
    if (confirm) setConfirm('');
    else if (editor) setEditor(null);
    else if (path) setStack(old => old.slice(0, -1));
    else onClose();
  }
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    return () => sub.remove();
  });
  async function act(method) {
    setBusy(true); setError('');
    try {
      if (method === 'write') {
        const create = !editor.base;
        if (!create) {
          const current = await call('notes.read', { path });
          if (noteChanged(editor.base, current)) { setNote(current); return; }
        }
        const name = editor.name.trim();
        const destination = create ? 'chefe/' + name + (name.endsWith('.md') ? '' : '.md') : path;
        const saved = await call('notes.write', { path: destination, text: editor.text, create });
        open(saved.path);
      } else {
        const saved = await call('notes.' + method, method === 'remove' ? { path, confirm: true } : { path });
        setConfirm(''); setStack(old => method === 'archive' ? [...old.slice(0, -1), saved.path] : []);
      }
      setReload(n => n + 1);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  const narrow = width > 0 && width < 520;
  const title = editor ? editor.base ? 'Editar nota' : 'Nova nota' : path ? latest ? `${KIND_NAMES[latest.kind] || ''} / ${latest.title}` : 'Nota' : 'Memória';

  return <View style={[s.screen, { backgroundColor: L.bg }]} onLayout={e => setWidth(e.nativeEvent.layout.width)}>
    <View style={[s.bar, { borderBottomColor: L.panelBorder }]}>
      <BarIcon icon="back" label="Voltar" onPress={back} disabled={busy} />
      <Text style={[s.barTitle, { color: path || editor ? L.muted : L.text }]} numberOfLines={1}>{title}</Text>
      {browsing ? <><ViewToggle view={view} onChange={chooseView} />
        <Button label={narrow ? '+' : 'Nova nota'} name="Nova nota" onPress={() => { setError(''); setEditor({ name: '', text: '' }); }} /></> : null}
      {path && !editor && latest ? latest.kind === 'arquivo' ? <Button label="Apagar para sempre" danger onPress={() => setConfirm('remove')} /> :
        <><Button label="Editar" onPress={() => { setConfirm(''); setError(''); setEditor({ base: latest, text: latest.body }); }} />
          <Button label="Arquivar" onPress={() => setConfirm('archive')} /></> : null}
    </View>
    {error ? <Text accessibilityRole="alert" style={[s.notice, { color: L.danger }]}>{error}</Text> : null}
    {confirm && !editor ? <View style={[s.confirm, { backgroundColor: L.panel, borderBottomColor: L.panelBorder }]}>
      <Text style={[s.meta, { color: L.text, flex: 1 }]}>{confirm === 'archive' ? 'Mover para o arquivo? Nada é apagado.' : 'Apagar esta nota para sempre? A exclusão será sincronizada com os outros aparelhos e não dá para desfazer.'}</Text>
      <Button label="Cancelar" disabled={busy} onPress={back} />
      <Button label={confirm === 'archive' ? 'Mover para o arquivo' : 'Confirmar exclusão definitiva'} danger={confirm === 'remove'} disabled={busy} onPress={() => act(confirm)} />
    </View> : null}
    <View style={s.body}>
      <View style={[s.layer, { display: browsing && view === 'list' ? 'flex' : 'none' }]}>
        <ScrollView ref={list} onScroll={event => { listOffset.current = event.nativeEvent.contentOffset.y; }} scrollEventThrottle={100}
          keyboardShouldPersistTaps="handled" contentContainerStyle={s.listContent}>
          <NoteFilters bots={bots} filters={filters} onChange={changeFilters} />
          <NoteList bots={bots} hues={hues} call={call} version={version + reload} onOpen={open} filters={filters} pages={pages} setPages={setPages} />
        </ScrollView>
      </View>
      {graphMounted ? <View style={[s.layer, { display: browsing && view === 'graph' ? 'flex' : 'none' }]}>
        <MemoryGraph bots={bots} call={call} version={version + reload} filters={filters} onFilters={changeFilters} onOpen={open} /></View> : null}
      {editor ? <ScrollView style={s.layer} keyboardShouldPersistTaps="handled" contentContainerStyle={s.editorContent}>
        {editor.base ? <Text style={[s.meta, { color: L.faint }]}>{path}</Text> : <><Text style={[s.meta, { color: L.muted }]}>Caminho dentro de chefe/</Text>
          <TextInput accessibilityLabel="Caminho da nova nota" style={[s.input, { backgroundColor: L.input, borderColor: L.panelBorder, color: L.text }]} placeholder="projetos/site.md" placeholderTextColor={L.faint}
            value={editor.name} autoCapitalize="none" editable={!busy} onChangeText={name => setEditor({ ...editor, name })} /></>}
        {editor.base?.kind === 'entrega' && editor.base.botId ? <Text style={[s.meta, { color: L.muted }]}>Esta entrega foi escrita por um bot. A versão anterior ficará no histórico.</Text> : null}
        <TextInput accessibilityLabel="Texto da nota em Markdown" multiline textAlignVertical="top" style={[s.input, s.editor, { backgroundColor: L.bg, borderColor: L.panelBorder, color: L.text }]}
          value={editor.text} editable={!busy} onChangeText={text => setEditor({ ...editor, text })} />
        {conflict ? <View style={[s.box, { backgroundColor: L.panel, borderColor: L.panelBorder }]}><Text style={[s.meta, { color: L.danger }]}>{loadError || 'Esta nota mudou enquanto você editava. Seu rascunho está preservado.'}</Text>
          {latest ? <><Text style={[s.rowTitle, { color: L.text }]}>Versão salva</Text><Text selectable style={[s.snippet, { color: L.muted }]}>{latest.body}</Text>
            <Button label="Continuar com meu rascunho" onPress={() => setEditor({ ...editor, base: latest })} /></> : null}</View> : null}
        <View style={s.inline}><Button label={busy ? 'Salvando…' : 'Salvar'} primary disabled={busy || Boolean(conflict)} onPress={() => act('write')} />
          <Button label="Cancelar" disabled={busy} onPress={back} /></View>
      </ScrollView> : path ? <View style={s.layer}>{loadError ? <View style={s.center}><Text style={[s.meta, { color: L.danger }]}>{loadError}</Text>
        <Button label="Tentar novamente" onPress={() => setReload(n => n + 1)} /></View> :
        latest ? <NoteReader note={latest} bots={bots} hues={hues} onOpen={open} width={width} /> :
        <View style={s.center}><Text style={[s.meta, { color: L.muted }]}>Carregando nota…</Text></View>}</View> : null}
    </View>
  </View>;
}

const s = themed(() => ({
  screen: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: TOP + 6, paddingBottom: 6, paddingHorizontal: 10, borderBottomWidth: 1, minHeight: 50 },
  barIcon: { width: 34, height: 34, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  barTitle: { flex: 1, minWidth: 0, fontFamily: F.s, fontSize: 15 },
  body: { flex: 1, position: 'relative' },
  layer: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  listContent: { width: '100%', maxWidth: 820, alignSelf: 'center', paddingHorizontal: 18, paddingTop: 18, paddingBottom: 72, gap: 18 },
  editorContent: { width: '100%', maxWidth: 820, alignSelf: 'center', paddingHorizontal: 18, paddingTop: 18, paddingBottom: 72, gap: 12, flexGrow: 1 },
  notice: { paddingHorizontal: 16, paddingVertical: 8, fontFamily: F.m },
  confirm: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1 },
  row: { paddingVertical: 11, paddingHorizontal: 10, borderBottomWidth: 1, gap: 4, borderRadius: 6 },
  rowTitle: { fontFamily: F.s, fontSize: 15.5 },
  meta: { fontFamily: F.m, fontSize: 12.5 }, snippet: { fontFamily: F.r, fontSize: 13.5, lineHeight: 19 },
  empty: { fontFamily: F.r, fontSize: 15, lineHeight: 22 },
  folder: { fontFamily: F.s, fontSize: 11.5, letterSpacing: 0.8, marginTop: 6, marginBottom: 2, paddingHorizontal: 10 },
  inline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, group: { gap: 8 },
  box: { gap: 10, padding: 14, borderRadius: 8, borderWidth: 1 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  input: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 9, fontFamily: F.r, fontSize: 15 },
  editor: { flexGrow: 1, minHeight: 360, fontFamily: 'monospace', fontSize: 14.5, lineHeight: 22, padding: 16 },
  button: { paddingHorizontal: 12, minHeight: 32, justifyContent: 'center', borderRadius: 6, borderWidth: 1 },
  label: { fontFamily: F.s, fontSize: 13.5 },
  segment: { flexDirection: 'row', borderWidth: 1, borderRadius: 6, padding: 2, gap: 2 },
  segmentItem: { paddingHorizontal: 12, minHeight: 28, justifyContent: 'center', borderRadius: 4 },
  reference: { paddingVertical: 6, gap: 2 },
  highlight: { fontFamily: F.b }, badge: { fontSize: 11.5, fontFamily: F.m, borderWidth: 1, paddingHorizontal: 6, borderRadius: 4 }
}));
