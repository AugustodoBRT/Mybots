import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, TextInput, SectionList, Alert } from 'react-native';
import { styles } from '../styles';
import { C, Icon, F, themed } from '../theme';
import { passwordsList, passwordSave, passwordDelete, passwordImport, passwordImportDelete } from '../termux';
import { nativeMessage, PrimaryButton } from './shared';
import { groupPasswords } from '../password-groups.js';

const p = themed(() => ({
  host: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingTop: 18, paddingBottom: 6 },
  hostName: { color: C.text, fontFamily: F.b, fontSize: 16, flexShrink: 1 },
  hostCount: { color: C.muted, fontFamily: F.m, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.line },
  who: { color: C.text2, fontFamily: F.m, fontSize: 15 },
  meta: { color: C.muted, fontFamily: F.m, fontSize: 13, marginTop: 2 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, minHeight: 48, borderRadius: 16, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line },
  searchInput: { flex: 1, color: C.text, fontFamily: F.m, fontSize: 15, paddingVertical: 10 },
  empty: { color: C.muted, fontFamily: F.m, fontSize: 14.5, lineHeight: 21, paddingVertical: 16 }
}));

/**
 * The saved passwords on their own screen: search, grouped by site, rendered a screenful at a time so a thousand of them
 * open and scroll like ten. Only the site, the username and which bots may use it are listed; the password never leaves the vault.
 */
export function PasswordsScreen({ bots, onChanged }) {
  const [list, setList] = useState([]); const [loaded, setLoaded] = useState(false); const [query, setQuery] = useState('');
  const [form, setForm] = useState(null); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const load = () => passwordsList().then(items => { setList(items); setLoaded(true); onChanged?.(items); }).catch(error => { setLoaded(true); setNote(nativeMessage(error)); });
  useEffect(() => { load(); }, []);
  const groups = useMemo(() => groupPasswords(list, query), [list, query]);
  const field = (key, value) => setForm(old => ({ ...old, [key]: value }));
  const save = async () => {
    setBusy(true); setNote('');
    try { await passwordSave(form.site, form.username || '', form.password || '', form.bots?.length ? form.bots : null); setForm(null); setNote('Senha salva. Os bots escolhidos já podem entrar nesse site.'); await load(); }
    catch (error) { setNote(nativeMessage(error)); } finally { setBusy(false); }
  };
  const remove = item => Alert.alert(`Apagar a senha de ${item.host}?`, 'Os bots deixam de entrar sozinhos nesse site.', [{ text: 'Cancelar', style: 'cancel' },
    { text: 'Apagar', style: 'destructive', onPress: () => passwordDelete(item.id).then(load).catch(error => setNote(nativeMessage(error))) }]);
  const names = ids => ids ? ids.map(id => bots.find(bot => bot.id === id)?.name).filter(Boolean).join(', ') || 'bot apagado' : 'todos os bots';
  // A password export (Chrome: chrome://password-manager → Configurações → Exportar senhas). The app reads it natively.
  const importFile = async () => {
    setBusy(true); setNote('');
    try {
      const result = await passwordImport(form?.bots?.length ? form.bots : null); if (!result) return;
      await load(); setForm(null);
      setNote(`${result.imported} ${result.imported === 1 ? 'senha importada' : 'senhas importadas'}${result.skipped ? ` (${result.skipped} sem site ou senha ficaram de fora)` : ''}. Os bots escolhidos já podem entrar nesses sites.`);
      Alert.alert('Apagar o arquivo exportado?', `${result.name} tem todas as suas senhas sem proteção. Elas já estão guardadas no MyBots.`, [{ text: 'Manter', style: 'cancel' },
        { text: 'Apagar arquivo', style: 'destructive', onPress: () => passwordImportDelete().then(done => setNote(old => old + (done ? ' Arquivo apagado.' : ' Não consegui apagar o arquivo; apague pelo gerenciador de arquivos.'))).catch(() => {}) }]);
    } catch (error) { setNote(nativeMessage(error)); } finally { setBusy(false); }
  };
  const header = <View>
    <Text style={styles.optionDetail}>O bot entra sozinho (ex.: no SIGAA) com a senha salva aqui. Ela fica protegida neste celular e só é preenchida no site em que foi salva; a IA nunca vê a senha. Dica: entre uma vez pelo Assumir do navegador do bot e toque em Salvar.</Text>
    {form ? <View style={{ marginTop: 10 }}>
      {form.importing ? <Text style={styles.optionDetail}>No Chrome: Gerenciador de senhas → Configurações → Exportar senhas, e escolha o arquivo aqui. Também aceita CSV do Firefox, Bitwarden e 1Password. Só entram logins de sites (http/https); um site e usuário já salvo fica com a senha nova.</Text> : <>
        <TextInput style={styles.formInput} placeholder="Site (ex.: sig.cefetmg.br)" placeholderTextColor={C.faint} autoCapitalize="none" autoCorrect={false} keyboardType="url" value={form.site || ''} onChangeText={value => field('site', value)} />
        <TextInput style={styles.formInput} placeholder="Usuário (CPF, matrícula ou e-mail)" placeholderTextColor={C.faint} autoCapitalize="none" autoCorrect={false} value={form.username || ''} onChangeText={value => field('username', value)} />
        <TextInput style={styles.formInput} placeholder="Senha" placeholderTextColor={C.faint} autoCapitalize="none" autoCorrect={false} secureTextEntry value={form.password || ''} onChangeText={value => field('password', value)} /></>}
      <Text style={[styles.limitMeta, { marginTop: 10 }]}>Quais bots podem usar</Text>
      <View style={styles.shareFiles}>
        {[{ id: null, name: 'Todos' }, ...bots].map(bot => { const all = !form.bots?.length; const on = bot.id ? form.bots?.includes(bot.id) : all; return <Pressable key={bot.id || 'all'} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
          onPress={() => field('bots', bot.id ? (on ? form.bots.filter(id => id !== bot.id) : [...(form.bots || []), bot.id]) : [])} style={[styles.botChoice, on && styles.botChoiceOn]}><Text style={[styles.botChoiceText, on && { color: C.accent }]}>{bot.name}</Text></Pressable>; })}
      </View>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
        <Pressable accessibilityRole="button" onPress={() => setForm(null)} style={[styles.denyButton, { flex: 1 }]}><Text style={styles.denyText}>Cancelar</Text></Pressable>
        {form.importing ? <PrimaryButton compact icon="download" title={busy ? 'Importando…' : 'Escolher arquivo'} disabled={busy} onPress={importFile} style={{ flex: 1.4 }} />
          : <PrimaryButton compact icon="check" title={busy ? 'Salvando…' : 'Salvar senha'} disabled={busy || !form.site || !form.password} onPress={save} style={{ flex: 1.4 }} />}
      </View>
    </View> : <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
      <Pressable accessibilityRole="button" onPress={() => { setNote(''); setForm({}); }} style={styles.stopButton}><Icon name="plus" size={13} color={C.accent} /><Text style={[styles.stopText, { color: C.accent }]}>Adicionar senha</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => { setNote(''); setForm({ importing: true }); }} style={styles.stopButton}><Icon name="download" size={13} color={C.accent} /><Text style={[styles.stopText, { color: C.accent }]}>Importar CSV</Text></Pressable>
    </View>}
    {note ? <Text style={[styles.optionDetail, /salva|importada/.test(note) ? { color: C.accent } : { color: C.amber }]}>{note}</Text> : null}
    <View style={[p.search, { marginTop: 16 }]}>
      <Icon name="search" size={18} color={C.faint} />
      <TextInput accessibilityLabel="Buscar senha por site ou usuário" style={p.searchInput} value={query} onChangeText={setQuery} placeholder="Buscar por site ou usuário" placeholderTextColor={C.faint} autoCapitalize="none" autoCorrect={false} />
    </View>
  </View>;
  return <SectionList sections={groups} keyExtractor={item => String(item.id)} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 30 }} keyboardShouldPersistTaps="handled"
    initialNumToRender={24} maxToRenderPerBatch={16} windowSize={9} stickySectionHeadersEnabled={false} ListHeaderComponent={header}
    ListEmptyComponent={loaded ? <Text style={p.empty}>{query.trim() ? 'Nenhuma senha encontrada para essa busca.' : 'Nenhuma senha guardada ainda.'}</Text> : <Text style={p.empty}>Carregando…</Text>}
    renderSectionHeader={({ section }) => <View style={p.host}><Text style={p.hostName} numberOfLines={1}>{section.host}</Text><Text style={p.hostCount}>{section.data.length > 1 ? `${section.data.length} logins` : '1 login'}</Text></View>}
    renderItem={({ item }) => <View style={p.row}>
      <Icon name="key" size={17} color={C.accent} />
      <View style={{ flex: 1 }}><Text style={p.who} numberOfLines={1}>{item.username || 'sem usuário'}</Text><Text style={p.meta} numberOfLines={1}>{names(item.bots)}</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Apagar a senha de ${item.host}`} hitSlop={10} onPress={() => remove(item)}><Icon name="trash" size={17} color={C.faint} /></Pressable>
    </View>} />;
}
