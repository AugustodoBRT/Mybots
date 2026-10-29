import { useEffect, useMemo, useState } from 'react';
import { Modal, View, ScrollView, Text, Pressable, TextInput } from 'react-native';
import { styles } from '../styles';
import { C, Icon, F, themed } from '../theme';
import { termuxAvailable, passwordsList } from '../termux';
import { desktop } from '../desktop';
import { IconButton, Avatar, PrimaryButton, PersonName, ThemeChoice, ComputerPanel, DesktopPair, WidgetRow, PhoneAccess, ScreenOff, EmailConnection, AccountConnections, AppConnections, UpdateCard, offline } from './shared';
import { PasswordsScreen } from './Passwords';
import { matchCategories } from '../settings-search.js';
import { passwordSummary } from '../password-groups.js';

const s = themed(() => ({
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  title: { flex: 1, color: C.text, fontFamily: F.x, fontSize: 26, letterSpacing: -0.8 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, minHeight: 48, borderRadius: 16, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line, marginBottom: 6 },
  searchInput: { flex: 1, color: C.text, fontFamily: F.m, fontSize: 15, paddingVertical: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.line },
  rowTitle: { color: C.text, fontFamily: F.b, fontSize: 16.5 },
  rowSummary: { color: C.muted, fontFamily: F.m, fontSize: 14, marginTop: 2 },
  empty: { color: C.muted, fontFamily: F.m, fontSize: 14.5, lineHeight: 21, paddingVertical: 18 },
  botRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line }
}));

/**
 * Ajustes by category: a list with search; a category opens its own page (and Senhas has a page of its own, a long list).
 * `a` carries what App knows (data, handlers); each category only arranges the existing panels.
 */
export function SettingsSheet({ visible, onClose, a }) {
  const { data, mode } = a; const phone = mode === 'phone';
  const [page, setPage] = useState(null); const [query, setQuery] = useState(''); const [passwords, setPasswords] = useState(null);
  useEffect(() => { if (!visible) { setPage(null); setQuery(''); } }, [visible]);
  useEffect(() => { if (visible && termuxAvailable) passwordsList().then(setPasswords).catch(() => setPasswords(null)); }, [visible, page]);
  const bots = (data?.bots || []).filter(bot => !bot.deletedAt);
  const computers = data?.nodes?.filter(node => node.online)?.length || 0;
  const categories = useMemo(() => [
    { key: 'account', icon: 'user', title: 'Conta e IA', summary: data?.person?.name ? `${data.person.name} · aparência, e-mail e apps` : 'Seu nome, aparência, e-mail e apps', keywords: ['nome', 'tema', 'escuro', 'claro', 'sistema', 'gmail', 'e-mail', 'conectores', 'claude', 'codex', 'mcp'] },
    { key: 'bots', icon: 'bots', title: 'Bots', summary: bots.length ? `${bots.length} ${bots.length > 1 ? 'bots' : 'bot'}: perfil, acesso e rotinas` : 'Nenhum bot ainda', keywords: ['perfil', 'acesso', 'rotinas', 'novo', 'criar', ...bots.map(bot => bot.name)] },
    { key: 'phone', icon: 'phone', title: 'Celular', summary: desktop ? 'Pareamento com o celular' : 'Tela apagada, widget e notificações', keywords: ['widget', 'notificações', 'tela apagada', 'bateria', 'pareamento', 'qr'] },
    ...(phone && !desktop ? [{ key: 'computer', icon: 'laptop', title: 'Computador', summary: computers ? 'Conectado' : data?.computer ? 'Pareado, desligado agora' : 'Nenhum computador pareado', keywords: ['pc', 'pareamento', 'rede', 'tailscale'] }] : []),
    ...(termuxAvailable ? [{ key: 'secrets', icon: 'key', title: 'Senhas e carteira', summary: passwords ? passwordSummary(passwords, bots) : 'Senhas de sites e cartões', keywords: ['cartão', 'cartões', 'pagamento', 'compras', 'limites', 'cofre', 'login', 'importar'] }] : []),
    ...(!desktop ? [{ key: 'backup', icon: 'download', title: 'Backup e diagnóstico', summary: 'Cópias do estado e informações do aparelho', keywords: ['restaurar', 'salvar', 'diagnóstico', 'copiar', 'termux'] }] : []),
    { key: 'about', icon: 'info', title: 'Sobre', summary: `MyBots ${a.update?.info?.currentName || ''}${a.update?.info?.available ? ' · atualização disponível' : ''}`.trim(), keywords: ['versão', 'atualização', 'atualizar', 'novidades', 'privacidade'] }
  ], [data, phone, passwords, a.update?.info?.available, a.update?.info?.currentName]);
  const shown = matchCategories(query, categories);
  const current = categories.find(item => item.key === page);
  const body = key => {
    if (key === 'account') return <>
      {phone ? <PersonName name={data?.person?.name} onSave={async name => { await a.call('person.update', { name }); await a.reload(); }} /> : null}
      {phone ? <ThemeChoice value={data?.person?.theme || 'dark'} onSave={async theme => { await a.call('person.update', { theme }); await a.reload(); }} /> : null}
      {desktop ? null : <EmailConnection email={data?.email} busy={a.busy} onAction={(method, params) => a.maintenance(async () => {
        const result = await a.call(method, params); await a.reload(); a.setText(result?.message || 'Conta de e-mail desconectada.');
      })} />}
      <AccountConnections load={async refresh => a.call('account.connectors', { refresh })} />
      {desktop ? null : <AppConnections apps={data?.apps} busy={a.busy} onAction={(method, params) => a.maintenance(async () => {
        const result = await a.call(method, params); await a.reload();
        a.setText(method === 'app.remove' ? 'App desconectado; os bots perderam o acesso a ele.' : result?.status === 'connected' ? `${result.name}: ${result.tools.length} ferramentas disponíveis. Libere no perfil de cada bot.` : result?.message || 'Pronto.');
      })} />}
    </>;
    if (key === 'bots') return <>
      {bots.map(bot => <Pressable key={bot.id} accessibilityRole="button" accessibilityLabel={`Perfil de ${bot.name}`} onPress={() => { onClose(); a.openProfile(bot); }} style={({ pressed }) => [s.botRow, pressed && { opacity: 0.7 }]}>
        <Avatar bot={bot} size={44} animated={false} state={offline(data, bot.id) ? 'sleeping' : 'idle'} />
        <View style={{ flex: 1 }}><Text style={s.rowTitle} numberOfLines={1}>{bot.name}</Text><Text style={s.rowSummary} numberOfLines={1}>{{ basic: 'Pouco acesso', ask: 'Pergunta antes', full: 'Acesso total', free: 'Livre' }[bot.access] || 'Acesso personalizado'}</Text></View>
        <Icon name="right" size={16} color={C.faint} />
      </Pressable>)}
      <PrimaryButton icon="plus" tone="ghost" title="Novo bot" disabled={!data?.models?.length} onPress={() => { onClose(); a.onCreate(); }} style={{ marginTop: 14 }} />
    </>;
    if (key === 'phone') return desktop ? <><DesktopPair call={a.call} />
      <View style={styles.modeOption}><Text style={styles.optionLabel}>MyBots no computador</Text><Text style={styles.optionDetail}>Esta janela usa os dados do celular pareado. Backup, e-mail por senha de app e senhas de sites ficam nos Ajustes do app do celular.</Text></View></>
      : <>{phone ? <ScreenOff heartbeat={data?.heartbeat} nextRoutineAt={data?.nextRoutineAt} /> : null}{termuxAvailable ? <WidgetRow /> : null}<PhoneAccess stats={data?.notifications} lastPoll={data?.botNotices?.lastPoll} /></>;
    if (key === 'computer') return <ComputerPanel computer={data?.computer} nodes={data?.nodes}
      onPair={async link => { const result = await a.call('computer.pair', { link }); await a.reload(); return result; }}
      onForget={async () => { await a.call('computer.forget', {}); await a.reload(); }}
      onRetry={async () => { await a.call('computer.retry', {}); await a.reload(); }} />;
    if (key === 'secrets') return <>
      <Pressable accessibilityRole="button" onPress={() => setPage('passwords')} style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}>
        <Icon name="key" size={22} color={C.muted} /><View style={{ flex: 1 }}><Text style={s.rowTitle}>Senhas guardadas</Text><Text style={s.rowSummary}>{passwords ? passwordSummary(passwords, bots) : 'Abrir a lista'}</Text></View><Icon name="right" size={16} color={C.faint} /></Pressable>
      {!desktop ? <Pressable accessibilityRole="button" onPress={() => { onClose(); a.openWallet(); }} style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}>
        <Icon name="wallet" size={22} color={C.muted} /><View style={{ flex: 1 }}><Text style={s.rowTitle}>Carteira</Text><Text style={s.rowSummary}>Cartões, quais bots podem usar cada um, regras de gasto e extrato.</Text></View><Icon name="right" size={16} color={C.faint} /></Pressable> : null}
    </>;
    if (key === 'backup') return <>
      <View style={styles.modeOption}><Text selectable style={styles.optionDetail}>{a.text}</Text></View>
      <PrimaryButton icon="download" tone="ghost" title="Salvar backup agora" disabled={a.busy} onPress={() => a.maintenance(async () => { const backup = await a.saveBackup(); a.setText(`Backup salvo em ${backup.path}`); })} />
      <PrimaryButton icon="refresh" tone="ghost" title="Restaurar um backup" disabled={a.busy || Boolean(data?.active?.length)} onPress={() => a.maintenance(async () => {
        const names = await a.call('backup.list'); a.setBackupNames(names.sort().reverse()); a.setText(names.length ? 'Escolha a cópia que deseja restaurar:' : 'Nenhum backup salvo ainda.');
      })} />
      {a.backupNames.map(name => <Pressable key={name} disabled={a.busy} onPress={() => a.restoreBackup(name)} style={styles.modeOption}><Text style={styles.optionLabel}>{name.slice(13, 15)}/{name.slice(11, 13)}/{name.slice(7, 11)} · {name.slice(16, 18)}:{name.slice(18, 20)}:{name.slice(20, 22)} UTC</Text><Text style={styles.optionDetail}>Restaurar esta cópia</Text></Pressable>)}
      <PrimaryButton icon="info" tone="ghost" title="Ver diagnóstico do aparelho" disabled={a.busy} onPress={() => a.maintenance(async () => {
        const device = await a.readDeviceInfo(); const result = await a.call('environment.get'); a.setText(`${device}\n\n${result.report}`);
      })} />
      <Pressable disabled={a.busy} onPress={() => a.copyText(a.text).catch(error => a.setText(error.message))} style={styles.closeSheet}><Icon name="copy" size={16} color={C.accent} /><Text style={styles.closeSheetText}>Copiar informações</Text></Pressable>
    </>;
    if (key === 'about') return <>
      {termuxAvailable ? (a.update?.info?.available ? <UpdateCard compact update={a.update} onInstall={a.installUpdate} />
        : <View style={[styles.modeOption, styles.rowOption]}>
          <View style={styles.rowIcon}><Icon name="check" size={19} color={C.good} /></View>
          <View style={{ flex: 1 }}><Text style={styles.optionLabel}>MyBots {a.update?.info?.currentName || ''}</Text>
            <Text style={[styles.optionDetail, a.update?.error && { color: C.amber }]}>{a.update?.checking ? 'Procurando…' : a.update?.error || (a.update?.info ? 'Você está na versão mais nova.' : 'O app procura versões novas sozinho ao abrir.')}</Text></View>
          <Pressable accessibilityRole="button" disabled={a.update?.checking} onPress={() => a.checkUpdate(true)} style={styles.stopButton}><Icon name="refresh" size={13} color={C.accent} /><Text style={[styles.stopText, { color: C.accent }]}>Procurar</Text></Pressable>
        </View>) : null}
      <View style={styles.modeOption}><Text style={styles.optionLabel}>Privacidade</Text><Text style={styles.optionDetail}>{phone ? 'Bots, conversas e arquivos ficam neste celular.' : 'Bots e conversas ficam no computador.'} Senhas, cartões e códigos nunca passam pela IA.</Text></View>
    </>;
    return null;
  };
  const back = page === 'passwords' ? 'secrets' : null;
  const title = page === 'passwords' ? 'Senhas guardadas' : current ? current.title : 'Ajustes';
  return <Modal transparent visible={visible} animationType="slide" onRequestClose={() => (page ? setPage(back) : onClose())}>
    <View style={styles.sheetBackdrop}><View style={[styles.sheet, styles.sheetTall]}>
      <View style={styles.sheetHandle} />
      <View style={s.header}>
        {page ? <IconButton icon="back" label="Voltar aos ajustes" onPress={() => setPage(back)} size={42} /> : null}
        <Text style={s.title} numberOfLines={1}>{title}</Text>
        <IconButton icon="close" label="Fechar os ajustes" onPress={onClose} size={42} />
      </View>
      {page === 'passwords' ? <PasswordsScreen bots={bots} onChanged={setPasswords} />
        : page ? <ScrollView style={styles.sheetOptions} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">{body(page)}</ScrollView>
        : <ScrollView style={styles.sheetOptions} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
          <View style={s.search}><Icon name="search" size={18} color={C.faint} />
            <TextInput accessibilityLabel="Buscar nos ajustes" style={s.searchInput} value={query} onChangeText={setQuery} placeholder="Buscar nos ajustes" placeholderTextColor={C.faint} autoCorrect={false} /></View>
          {shown.map(category => <Pressable key={category.key} accessibilityRole="button" accessibilityLabel={`${category.title}. ${category.summary}`} onPress={() => setPage(category.key)} style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}>
            <Icon name={category.icon} size={22} color={C.muted} />
            <View style={{ flex: 1 }}><Text style={s.rowTitle}>{category.title}</Text><Text style={s.rowSummary} numberOfLines={2}>{category.summary}</Text></View>
            <Icon name="right" size={16} color={C.faint} />
          </Pressable>)}
          {!shown.length ? <Text style={s.empty}>Nada nos ajustes combina com essa busca.</Text> : null}
        </ScrollView>}
    </View></View>
  </Modal>;
}
