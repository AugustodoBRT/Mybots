import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Avatar, IconButton } from '../components/shared';
import { RichText } from '../RichMessage';
import { MemoryGraph } from './MemoryGraph';
import { noteChanged } from '../state/note-view';
import { TOP } from '../styles';
import { C, F, themed } from '../theme';

const folders = { chefe: 'Chefe', entrega: 'Entregas', arquivo: 'Arquivo' };
const periods = [[0, 'Qualquer data'], [1, 'Últimas 24 horas'], [7, 'Últimos 7 dias'], [30, 'Últimos 30 dias']];
const noFilters = { query: '', kind: '', botId: '', days: 0 };
// The chosen view (list or map) is kept while the app is open. The list stays the default and the accessible path.
let rememberedView = 'list';

function Button({ label, name, onPress, selected, danger, disabled }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={name} disabled={disabled} accessibilityState={{ selected, disabled }} onPress={onPress}
    style={[s.button, selected && { borderColor: C.accent }, disabled && { opacity: 0.5 }]}>
    <Text style={[s.label, danger && { color: C.red }, selected && { color: C.accent }]}>{label}</Text></Pressable>;
}

function Highlight({ text, range }) {
  return range ? <>{text.slice(0, range[0])}<Text style={s.highlight}>{text.slice(...range)}</Text>{text.slice(range[1])}</> : text;
}

function age(date) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(date)) / 60000));
  if (!minutes) return 'agora';
  if (minutes < 60) return 'há ' + minutes + ' min';
  if (minutes < 1440) return 'há ' + Math.floor(minutes / 60) + ' h';
  const days = Math.floor(minutes / 1440);
  return days === 1 ? 'há 1 dia' : 'há ' + days + ' dias';
}

export function NoteRow({ note, bot, onOpen }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={'Ler ' + note.title} onPress={() => onOpen(note.path)} style={s.card}>
    <Text style={s.title}><Highlight text={note.title} range={note.titleMatch} /></Text>
    <View style={s.row}>{bot ? <Avatar bot={bot} animated={false} size={24} /> : null}
      <Text style={s.meta}>{note.botName || (note.botId ? 'Bot' : 'Você')} · {age(note.updatedAt)}</Text></View>
    <Text style={s.body} numberOfLines={3}><Highlight text={note.snippet} range={note.snippetMatch} /></Text>
    <View style={s.row}><Text style={s.meta}>{note.outgoingCount} de saída · {note.incomingCount} de entrada</Text>
      {!note.outgoingCount && !note.incomingCount ? <Text style={s.badge}>Órfã</Text> : null}</View>
  </Pressable>;
}

export function ViewToggle({ view, onChange }) {
  return <View style={s.row}>
    <Button label="Lista" name="Ver como lista" selected={view === 'list'} onPress={() => onChange('list')} />
    <Button label="Grafo" name="Ver como grafo" selected={view === 'graph'} onPress={() => onChange('graph')} />
  </View>;
}

function NoteFilters({ bots, filters, onChange }) {
  const { query, kind, botId, days } = filters, [open, setOpen] = useState(false);
  function choices(label, options, selected, key) {
    return <View style={s.group}><Text style={s.meta}>{label}</Text><View style={s.row}>{options.map(([id, name]) =>
      <Button key={id} label={name} selected={selected === id} onPress={() => onChange({ [key]: id })} />)}</View></View>;
  }
  return <>
    <TextInput accessibilityLabel="Buscar nas notas" placeholder="Buscar nas notas" placeholderTextColor={C.muted} style={s.input}
      maxLength={200} value={query} onChangeText={value => onChange({ query: value })} />
    <View style={s.row}><Button label={open ? 'Fechar filtros' : 'Filtros'} selected={Boolean(kind || days || botId)} onPress={() => setOpen(!open)} />
      {kind || days || botId ? <Button label="Limpar filtros" onPress={() => onChange({ kind: '', days: 0, botId: '' })} /> : null}</View>
    {open ? <View style={s.card}>
      {choices('Pasta', [['', 'Todas'], ...Object.entries(folders)], kind, 'kind')}
      {choices('Autor', [['', 'Todos'], ...bots.map(bot => [bot.id, bot.name])], botId, 'botId')}
      {choices('Período', periods, days, 'days')}
    </View> : null}
  </>;
}

function NoteList({ bots, call, version, onOpen, filters, pages, setPages }) {
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
    {loading ? <Text style={s.meta}>Carregando notas…</Text> : error ? <><Text style={s.error}>{error}</Text><Button label="Tentar novamente" onPress={() => setRetry(n => n + 1)} /></> :
      !result?.notes.length ? <Text style={s.body}>{query || kind || days || botId ? 'Nenhuma nota encontrada. Tente outro termo ou ajuste os filtros.' : 'Os bots ainda não deixaram anotações. Peça ao Chefe para anotar algo.'}</Text> :
      Object.entries(folders).map(([id, name]) => {
        const items = result.notes.filter(note => note.kind === id);
        return items.length ? <View key={id} style={s.group}><Text style={s.section}>{name}</Text>
          {items.map(note => <NoteRow key={note.path} note={note} bot={bots.find(item => item.id === note.botId)} onOpen={onOpen} />)}</View> : null;
      })}
    {!loading && !error && result?.more ? query.trim() ? <Text style={s.meta}>Mostrando os 100 primeiros resultados. Refine sua busca.</Text> :
      <Button label="Carregar mais notas" onPress={() => setPages(n => n + 1)} /> : null}
  </>;
}

export function References({ label, items, onOpen }) {
  return <View style={s.group}><Text style={s.section}>{label}</Text>
    {items.length ? items.map(item => <Pressable key={item.path} accessibilityRole={item.exists === false ? undefined : 'link'}
      disabled={item.exists === false} onPress={() => onOpen(item.path)} style={s.card}>
      <Text style={item.exists === false ? s.meta : s.link}>{item.title}</Text>
      <Text style={s.meta}>{item.exists === false ? 'Nota ainda não criada' : item.path}</Text>
      {item.snippet ? <Text style={s.meta} numberOfLines={2}>{item.snippet}</Text> : null}</Pressable>) : <Text style={s.meta}>Nenhuma nota.</Text>}
  </View>;
}

export function MemoryScreen({ bots, call, version, onClose }) {
  const [stack, setStack] = useState([]), path = stack.at(-1);
  const [note, setNote] = useState(null), [editor, setEditor] = useState(null), [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [loadError, setLoadError] = useState(''), [reload, setReload] = useState(0);
  const scroll = useRef(null), listOffset = useRef(0);
  const [filters, setFilters] = useState(noFilters), [pages, setPages] = useState(1);
  const [view, setView] = useState(rememberedView), [graphMounted, setGraphMounted] = useState(rememberedView === 'graph');
  const changeFilters = patch => { setFilters(old => ({ ...old, ...patch })); setPages(1); };
  const chooseView = next => { rememberedView = next; setView(next); if (next === 'graph') setGraphMounted(true); };
  const editing = Boolean(editor);
  useEffect(() => {
    scroll.current?.scrollTo({ y: path || editing ? 0 : listOffset.current, animated: false });
  }, [path, editing]);
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

  return <ScrollView ref={scroll} onScroll={event => { if (!path && !editor) listOffset.current = event.nativeEvent.contentOffset.y; }}
    scrollEventThrottle={100} keyboardShouldPersistTaps="handled" style={s.screen} contentContainerStyle={s.content}>
    <View style={s.header}><IconButton icon="back" label="Voltar" onPress={back} disabled={busy} />
      <Text style={s.heading}>{editor ? editor.base ? 'Editar nota' : 'Nova nota' : 'Memória'}</Text>
      {!path && !editor ? <Button label="Nova nota" onPress={() => { setError(''); setEditor({ name: '', text: '' }); }} /> : null}</View>
    <View style={{ display: path || editor ? 'none' : 'flex', gap: 16 }}>
      <ViewToggle view={view} onChange={chooseView} />
      <NoteFilters bots={bots} filters={filters} onChange={changeFilters} />
      <View style={{ display: view === 'list' ? 'flex' : 'none', gap: 16 }}>
        <NoteList bots={bots} call={call} version={version + reload} onOpen={open} filters={filters} pages={pages} setPages={setPages} /></View>
      {graphMounted ? <View style={{ display: view === 'graph' ? 'flex' : 'none' }}>
        <MemoryGraph bots={bots} call={call} version={version + reload} filters={filters} onOpen={open} /></View> : null}
    </View>
    {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
    {editor ? <>
      {editor.base ? <Text style={s.meta}>{path}</Text> : <><Text style={s.meta}>Caminho dentro de chefe/</Text>
        <TextInput accessibilityLabel="Caminho da nova nota" style={s.input} placeholder="projetos/site.md" placeholderTextColor={C.muted}
          value={editor.name} autoCapitalize="none" editable={!busy} onChangeText={name => setEditor({ ...editor, name })} /></>}
      {editor.base?.kind === 'entrega' && editor.base.botId ? <Text style={s.meta}>Esta entrega foi escrita por um bot. A versão anterior ficará no histórico.</Text> : null}
      <TextInput accessibilityLabel="Texto da nota em Markdown" multiline textAlignVertical="top" style={[s.input, s.editor]}
        value={editor.text} editable={!busy} onChangeText={text => setEditor({ ...editor, text })} />
      {conflict ? <View style={s.card}><Text style={s.error}>{loadError || 'Esta nota mudou enquanto você editava. Seu rascunho está preservado.'}</Text>
        {latest ? <><Text style={s.title}>Versão salva</Text><Text selectable style={s.body}>{latest.body}</Text>
          <Button label="Continuar com meu rascunho" onPress={() => setEditor({ ...editor, base: latest })} /></> : null}</View> : null}
      <View style={s.row}><Button label={busy ? 'Salvando…' : 'Salvar'} selected disabled={busy || Boolean(conflict)} onPress={() => act('write')} />
        <Button label="Cancelar" disabled={busy} onPress={back} /></View>
    </> : path ? loadError ? <><Text style={s.error}>{loadError}</Text><Button label="Tentar novamente" onPress={() => setReload(n => n + 1)} /></> :
      latest ? <>
        <Text style={s.meta}>{latest.path}</Text><Text style={s.heading}>{latest.title}</Text>
        <View style={s.row}>{latest.kind === 'arquivo' ? <Button label="Apagar para sempre" danger onPress={() => setConfirm('remove')} /> :
          <><Button label="Editar" onPress={() => { setConfirm(''); setError(''); setEditor({ base: latest, text: latest.body }); }} />
            <Button label="Arquivar" onPress={() => setConfirm('archive')} /></>}</View>
        {confirm ? <View style={s.card}><Text style={s.body}>{confirm === 'archive' ? 'Mover para o arquivo? Nada é apagado.' : 'Apagar esta nota para sempre? A exclusão será sincronizada com os outros aparelhos e não dá para desfazer.'}</Text>
          <View style={s.row}><Button label="Cancelar" disabled={busy} onPress={back} />
            <Button label={confirm === 'archive' ? 'Mover para o arquivo' : 'Confirmar exclusão definitiva'} danger={confirm === 'remove'} disabled={busy} onPress={() => act(confirm)} /></View></View> : null}
        <View style={s.card}><RichText id={'note:' + latest.path} text={latest.body} textStyle={s.body} notes={{ links: latest.links, onOpen: open }} /></View>
        <References label="Aponta para" items={latest.links} onOpen={open} /><References label="Quem aponta para esta" items={latest.backlinks} onOpen={open} />
      </> : <Text style={s.meta}>Carregando nota…</Text> : null}
  </ScrollView>;
}

const s = themed(() => ({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { width: '100%', maxWidth: 820, alignSelf: 'center', paddingHorizontal: 18, paddingTop: TOP + 16, paddingBottom: 72, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heading: { flexShrink: 1, flexGrow: 1, color: C.text, fontFamily: F.x, fontSize: 26 },
  title: { color: C.text, fontFamily: F.b, fontSize: 17 }, section: { color: C.text, fontFamily: F.b, fontSize: 19 },
  body: { color: C.text2, fontFamily: F.r, fontSize: 15, lineHeight: 22 }, meta: { color: C.muted, fontFamily: F.m, fontSize: 13 },
  card: { gap: 8, padding: 14, backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.line },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }, group: { gap: 8 },
  input: { borderWidth: 1, borderColor: C.line2, borderRadius: 12, backgroundColor: C.surface, padding: 12, color: C.text, fontFamily: F.r, fontSize: 16 },
  editor: { minHeight: 210, fontFamily: 'monospace' }, error: { color: C.red, fontFamily: F.m },
  button: { paddingHorizontal: 12, minHeight: 38, justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: C.line2, backgroundColor: C.surface },
  label: { color: C.text2, fontFamily: F.s, fontSize: 14 }, link: { color: C.sky, fontFamily: F.s },
  highlight: { color: C.accent, fontFamily: F.b }, badge: { color: C.muted, fontSize: 12, fontFamily: F.m, backgroundColor: C.elevated, paddingHorizontal: 7, borderRadius: 6 }
}));
