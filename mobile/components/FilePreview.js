import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, Pressable } from 'react-native';
import { C, F } from '../theme';
import { IconButton } from './shared';
import { RichText, FileBadge, formatSize } from '../RichMessage';
import { previewKind } from '../file-references';

export function FilePreview({ file, call, onClose, onAction, busy, note }) {
  const [state, setState] = useState({ loading: true });
  const [zoom, setZoom] = useState(1); const [source, setSource] = useState(false);
  const caller = useRef(call); caller.current = call;
  useEffect(() => {
    let live = true, url;
    setState({ loading: true }); setZoom(1); setSource(false);
    (async () => {
      const resolved = file.id ? file : await caller.current('file.resolve', { botId: file.botId, reference: file.reference });
      if (!live) return;
      const kind = previewKind(resolved);
      if (['archive', 'other'].includes(kind)) { setState({ file: resolved, kind }); return; }
      const limit = kind === 'text' ? 2 * 1024 * 1024 : 128 * 1024 * 1024;
      if (resolved.size > limit) { setState({ file: resolved, kind: 'other', detail: 'Arquivo grande para a prévia. Você pode baixar ou abrir no programa do computador.' }); return; }
      const chunks = []; let offset = 0, total = 0;
      do {
        const part = await caller.current('file.read', { id: resolved.id, offset });
        if (!live) return;
        const bytes = Uint8Array.from(atob(part.chunk), c => c.charCodeAt(0)); total += bytes.length;
        if (total > limit) throw new Error('Arquivo grande demais para a prévia.');
        chunks.push(bytes);
        if (part.next != null && (!Number.isInteger(part.next) || part.next <= offset)) throw new Error('Não foi possível ler o arquivo.');
        offset = part.next;
      } while (offset != null);
      const blob = new Blob(chunks, { type: resolved.mime || 'application/octet-stream' });
      if (kind === 'text') {
        const text = await blob.text(); if (live) setState({ file: resolved, kind, text });
      } else {
        url = URL.createObjectURL(blob); if (live) setState({ file: resolved, kind, url });
      }
    })().catch(error => { if (live) setState({ error: /método|method/i.test(error.message) ? 'Esta referência ainda não está disponível. Peça ao bot para enviar o arquivo como anexo.' : error.message }); });
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [file.id, file.reference, file.botId]);
  const shown = state.file || file;
  const bodyStyle = { color: C.text, fontFamily: F.r, fontSize: 14, lineHeight: 23 };
  const mediaStyle = { width: '100%', height: '100%', minHeight: 0, objectFit: 'contain', background: '#101113', border: 0 };
  return <View accessibilityLabel="Prévia do arquivo" style={{ flex: 1, borderLeftWidth: 1, borderLeftColor: C.line, backgroundColor: C.bg2 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderBottomWidth: 1, borderBottomColor: C.line }}>
      <FileBadge file={shown} size={30} />
      <View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} style={{ color: C.text, fontFamily: F.b, fontSize: 12 }}>{shown.name}</Text>{shown.size != null ? <Text style={{ color: C.muted, fontSize: 10 }}>{formatSize(shown.size)}</Text> : null}</View>
      {state.kind === 'text' && /\.md$/i.test(shown.name) ? <IconButton icon="file" label={source ? 'Mostrar texto formatado' : 'Mostrar código-fonte'} size={28} onPress={() => setSource(v => !v)} /> : null}
      {state.file ? <><IconButton icon="download" label="Baixar arquivo" size={28} disabled={Boolean(busy)} onPress={() => onAction(state.file, 'save')} />
        {state.kind !== 'archive' ? <IconButton icon="open" label="Abrir no programa padrão" size={28} disabled={Boolean(busy)} onPress={() => onAction(state.file, 'open')} /> : null}</> : null}
      <IconButton icon="close" label="Fechar prévia" size={28} onPress={onClose} />
    </View>
    {state.loading ? <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 }}><ActivityIndicator color={C.accent} /><Text style={bodyStyle}>Preparando prévia…</Text></View>
      : state.error ? <Text style={[bodyStyle, { padding: 24 }]}>{state.error}</Text>
      : state.kind === 'text' ? <ScrollView contentContainerStyle={{ padding: 24 }}>{/\.md$/i.test(shown.name) && !source ? <RichText text={state.text} textStyle={bodyStyle} /> : <Text selectable style={[bodyStyle, { fontFamily: 'monospace', fontSize: 12.5 }]}>{state.text}</Text>}</ScrollView>
      : state.kind === 'image' ? <>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 8, gap: 12 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Diminuir imagem" onPress={() => setZoom(v => Math.max(0.5, v - 0.25))}><Text style={bodyStyle}>−</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Ajustar imagem" onPress={() => setZoom(1)}><Text style={bodyStyle}>{Math.round(zoom * 100)}%</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Ampliar imagem" onPress={() => setZoom(v => Math.min(4, v + 0.25))}><Text style={bodyStyle}>+</Text></Pressable>
        </View>
        {React.createElement('div', { style: { flex: 1, minHeight: 0, overflow: 'auto', display: 'grid', placeItems: zoom <= 1 ? 'center' : 'start', padding: 16 } }, React.createElement('img', { src: state.url, alt: shown.name, onError: () => setState(old => ({ ...old, kind: 'other', detail: 'Não foi possível exibir esta imagem. Você pode baixar o arquivo.' })), onClick: () => setZoom(v => v === 1 ? 2 : 1), style: { width: `${zoom * 100}%`, maxWidth: 'none', height: 'auto', cursor: zoom === 1 ? 'zoom-in' : 'zoom-out' } }))}
      </> : state.kind === 'video' || state.kind === 'audio' ? React.createElement(state.kind, { key: state.url, src: state.url, controls: true, preload: 'metadata', style: mediaStyle, onError: () => setState(old => ({ ...old, kind: 'other', detail: 'Este formato não é reproduzido aqui. Baixe ou abra no programa do computador.' })) })
      : state.kind === 'pdf' ? React.createElement('iframe', { title: shown.name, src: state.url, sandbox: '', style: { ...mediaStyle, flex: 1 } })
      : <View style={{ padding: 28, gap: 14 }}><FileBadge file={shown} size={56} /><Text style={bodyStyle}>{state.detail || (state.kind === 'archive' ? 'Arquivo compactado. Baixe para extrair o conteúdo.' : 'Este formato não tem prévia. Você pode baixar ou abrir no programa do computador.')}</Text></View>}
    {note ? <Text selectable style={[bodyStyle, { padding: 12, fontSize: 12, color: C.muted }]}>{note}</Text> : null}
  </View>;
}
