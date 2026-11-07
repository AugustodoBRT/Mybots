import { useEffect, useMemo, useState } from 'react';
import { Modal, View, ScrollView, Text, Pressable, TextInput, Switch, useWindowDimensions } from 'react-native';
import { styles } from '../styles';
import { C, Icon, F, themed } from '../theme';
import { termuxAvailable, passwordsList } from '../termux';
import { desktop } from '../desktop';
import { IconButton, Avatar, PrimaryButton, PersonName, ThemeChoice, ComputerPanel, DesktopPair, WidgetRow, PhoneAccess, ScreenOff, UpdateCard, offline } from './shared';
import { GoogleAccounts } from './GoogleAccounts';
import { AiAccounts } from './AiAccounts';
import { RemotePanel, TermuxGuide } from './Setup';
import { DesktopUpdate } from './DesktopUpdate';
import { PasswordsScreen } from './Passwords';
import { matchCategories } from '../settings-search.js';
import { passwordSummary } from '../password-groups.js';
import { FACES_3D_AVAILABLE, setFaces3d, useFaces3d } from '../faces3d';

/** "3 contas em 2 IAs", or the invitation when there is only the main login of each. */
function aiSummary(aiAccounts) {
  const extra = new Set(); let count = 0;
  for (const device of [aiAccounts?.here, aiAccounts?.computer]) for (const [provider, list] of Object.entries(device?.accounts || {})) for (const item of list) if (!item.default) { count++; extra.add(provider); }
  return count ? `${count} ${count > 1 ? 'contas extras' : 'conta extra'} em ${extra.size} ${extra.size > 1 ? 'IAs' : 'IA'}` : 'Mais de uma conta de Claude, Codex e outras';
}

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
export function SettingsSheet({ visible, inline, onClose, a }) {
  const { data, mode } = a; const phone = mode === 'phone';
  const [page, setPage] = useState(null); const [query, setQuery] = useState(''); const [passwords, setPasswords] = useState(null);
  useEffect(() => { if (!visible) { setPage(null); setQuery(''); } }, [visible]);
  useEffect(() => { if (visible && (termuxAvailable || desktop)) passwordsList().then(setPasswords).catch(() => setPasswords(null)); }, [visible, page]);
  const remote = a.backend === 'pc';   // the phone without Termux: the computer's MyBots is the backend
  const bots = (data?.bots || []).filter(bot => !bot.deletedAt);
  const computers = data?.nodes?.filter(node => node.online)?.length || 0;
  const solid = useFaces3d();
  const categories = useMemo(() => [
    { key: 'account', icon: 'user', title: 'Conta e IA', summary: data?.person?.name ? `${data.person.name} · aparência e contas Google` : 'Seu nome, aparência e contas Google', keywords: ['nome', 'tema', 'escuro', 'claro', 'sistema', 'gmail', 'e-mail', 'google', 'contas', 'login'] },
    ...(phone ? [{ key: 'ai', icon: 'user', title: 'Contas de IA', summary: aiSummary(data?.aiAccounts), keywords: ['claude', 'codex', 'antigravity', 'opencode', 'login', 'conta', 'contas', 'assinatura', 'duas contas', 'várias contas', 'trocar'] }] : []),
    { key: 'bots', icon: 'bots', title: 'Bots', summary: bots.length ? `${bots.length} ${bots.length > 1 ? 'bots' : 'bot'}: perfil, acesso e rotinas` : 'Nenhum bot ainda', keywords: ['perfil', 'acesso', 'rotinas', 'novo', 'criar', '3d', 'aparência', 'rosto', ...bots.map(bot => bot.name)] },
    { key: 'phone', icon: 'phone', title: 'Celular', summary: desktop ? 'Pareamento com o celular' : remote ? 'Avisos dos bots' : 'Tela apagada, widget e notificações', keywords: ['widget', 'notificações', 'tela apagada', 'bateria', 'pareamento', 'qr'] },
    ...(phone && !desktop ? [{ key: 'computer', icon: 'laptop', title: 'Computador', summary: remote ? (data?.supervisorConnected === false ? 'Desligado ou fora de alcance' : 'Conectado') : computers ? 'Conectado' : data?.computer ? 'Pareado, desligado agora' : 'Nenhum computador pareado', keywords: ['pc', 'pareamento', 'rede', 'tailscale', 'qr'] }] : []),
    // Termux is optional: a guide for the whole process, and the switch to a supervisor of the phone's own.
    ...(!desktop && termuxAvailable ? [{ key: 'termux', icon: 'bolt', title: 'Termux (avançado)', summary: remote ? 'Usar o celular sem depender do computador' : 'Ativo: o celular tem o próprio MyBots', keywords: ['termux', 'sozinho', 'sem computador', 'offline', 'tutorial', 'instalar', 'codex'] }] : []),
    ...(termuxAvailable || desktop ? [{ key: 'secrets', icon: 'key', title: desktop ? 'Senhas' : 'Senhas e carteira', summary: passwords ? passwordSummary(passwords, bots) : desktop ? 'Senhas de sites, as mesmas do celular' : 'Senhas de sites e cartões', keywords: ['cartão', 'cartões', 'pagamento', 'compras', 'limites', 'cofre', 'login', 'importar'] }] : []),
    ...(!desktop && !remote ? [{ key: 'backup', icon: 'download', title: 'Backup e diagnóstico', summary: 'Cópias do estado e informações do aparelho', keywords: ['restaurar', 'salvar', 'diagnóstico', 'copiar', 'termux'] }] : []),
    { key: 'about', icon: 'info', title: 'Sobre', summary: `MyBots ${a.update?.info?.currentName || ''}${a.update?.info?.available ? ' · atualização disponível' : ''}`.trim(), keywords: ['versão', 'atualização', 'atualizar', 'novidades', 'privacidade'] }
  ], [data, phone, remote, passwords, a.update?.info?.available, a.update?.info?.currentName, data?.aiAccounts]);
  const shown = matchCategories(query, categories);
  const current = categories.find(item => item.key === page);
  const body = key => {
    if (key === 'account') return <>
      {phone ? <PersonName name={data?.person?.name} onSave={async name => { await a.call('person.update', { name }); await a.reload(); }} /> : null}
      {phone ? <ThemeChoice value={data?.person?.theme || 'dark'} onSave={async theme => { await a.call('person.update', { theme }); await a.reload(); }} /> : null}
      <GoogleAccounts accounts={data?.googleAccounts || []} bots={bots} busy={a.busy}
        onAdd={async account => { await a.call('google.accounts.add', { account }); await a.reload(); }}
        onLogin={async (botId, account) => { onClose(); await a.googleLogin(botId, account); }} />
    </>;
    if (key === 'ai') return <AiAccounts aiAccounts={data?.aiAccounts} call={a.call} reload={a.reload} />;
    if (key === 'bots') return <>
      {FACES_3D_AVAILABLE ? <View style={[s.botRow, { gap: 12 }]}>
        <View style={{ flex: 1 }}><Text style={s.rowTitle}>Bots em 3D (teste)</Text>
          <Text style={s.rowSummary}>Mostra em todo o app os bots do Escritório 3D, com volume, luz e brilho. Vale só neste aparelho.</Text></View>
        <Switch accessibilityLabel="Bots em 3D" value={solid} onValueChange={setFaces3d} />
      </View> : null}
      {bots.map(bot => <Pressable key={bot.id} accessibilityRole="button" accessibilityLabel={`Perfil de ${bot.name}`} onPress={() => { onClose(); a.openProfile(bot); }} style={({ pressed }) => [s.botRow, pressed && { opacity: 0.7 }]}>
        <Avatar bot={bot} size={44} animated={false} state={offline(data, bot.id) ? 'sleeping' : 'idle'} />
        <View style={{ flex: 1 }}><Text style={s.rowTitle} numberOfLines={1}>{bot.name}</Text><Text style={s.rowSummary} numberOfLines={1}>{bot.phoneControl ? 'Acesso total · controla o celular' : 'Acesso total'}</Text></View>
        <Icon name="right" size={16} color={C.faint} />
      </Pressable>)}
      <PrimaryButton icon="plus" tone="ghost" title="Novo bot" disabled={!data?.models?.length} onPress={() => { onClose(); a.onCreate(); }} style={{ marginTop: 14 }} />
    </>;
    if (key === 'phone') return desktop ? <><DesktopPair call={a.call} />
      <View style={styles.modeOption}><Text style={styles.optionLabel}>MyBots no computador</Text><Text style={styles.optionDetail}>{data?.source === 'local' ? 'Esta janela usa o MyBots deste computador, que se sincroniza com o celular pareado. Backup e senhas de sites ficam nos Ajustes do app do celular.' : 'Esta janela usa os dados do celular pareado. Backup e senhas de sites ficam nos Ajustes do app do celular.'}</Text></View></>
      : remote ? <View style={styles.modeOption}><Text style={styles.optionLabel}>Avisos dos bots</Text><Text style={styles.optionDetail}>Com o app aberto, os avisos dos bots chegam como notificações do MyBots. Para receber com a tela apagada e controlar outros apps do celular, ative o Termux em Ajustes → Termux (avançado).</Text></View>
      : <>{phone ? <ScreenOff heartbeat={data?.heartbeat} nextRoutineAt={data?.nextRoutineAt} /> : null}{termuxAvailable ? <WidgetRow /> : null}<PhoneAccess stats={data?.notifications} lastPoll={data?.botNotices?.lastPoll} /></>;
    if (key === 'computer' && remote) return <RemotePanel link={a.pcLink} state={{ supervisorConnected: data?.supervisorConnected, via: a.pcVia }} busy={a.setupBusy} note={a.setupError} onScanned={a.pairPc} onForget={() => a.forgetPc()} />;
    if (key === 'termux') return <>
      <TermuxGuide onEnable={remote ? a.enableTermux : null} busy={a.setupBusy} enabled={!remote} />
      {!remote && a.pcLink ? <PrimaryButton icon="laptop" tone="ghost" title="Voltar a usar só o computador" onPress={a.useComputerOnly} style={{ marginTop: 12 }} /> : null}
    </>;
    if (key === 'computer') return <ComputerPanel computer={data?.computer} nodes={data?.nodes} sync={data?.sync}
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
      {desktop ? <DesktopUpdate full /> : null}
      {termuxAvailable ? (a.update?.info?.available ? <UpdateCard compact update={a.update} onInstall={a.installUpdate} />
        : <View style={[styles.modeOption, styles.rowOption]}>
          <View style={styles.rowIcon}><Icon name="check" size={19} color={C.good} /></View>
          <View style={{ flex: 1 }}><Text style={styles.optionLabel}>MyBots {a.update?.info?.currentName || ''}</Text>
            <Text style={[styles.optionDetail, a.update?.error && { color: C.amber }]}>{a.update?.checking ? 'Procurando…' : a.update?.error || (a.update?.info ? 'Você está na versão mais nova.' : 'O app procura versões novas sozinho ao abrir.')}</Text></View>
          <Pressable accessibilityRole="button" disabled={a.update?.checking} onPress={() => a.checkUpdate(true)} style={styles.stopButton}><Icon name="refresh" size={13} color={C.accent} /><Text style={[styles.stopText, { color: C.accent }]}>Procurar</Text></Pressable>
        </View>) : null}
      <View style={styles.modeOption}><Text style={styles.optionLabel}>Privacidade</Text><Text style={styles.optionDetail}>{data?.sync ? 'Bots, conversas e arquivos ficam no celular e no computador, que se sincronizam entre si.' : phone && !remote ? 'Bots, conversas e arquivos ficam neste celular.' : 'Bots e conversas ficam no computador.'} Fora de casa os dois se falam por um relé que só encaminha dados cifrados de ponta a ponta: ele não lê nem guarda nada. Senhas, cartões e códigos nunca passam pela IA e não saem do aparelho onde foram salvos.</Text></View>
      <View style={styles.modeOption}><Text style={styles.optionLabel}>Versão beta</Text><Text style={styles.optionDetail}>Você está usando o beta do MyBots: o computador funciona sozinho, celular e computador se conectam de qualquer rede e se sincronizam. Ainda em teste: a sincronização em redes que bloqueiam portas incomuns (faculdade, empresa), arquivos acima de 20 MB (ficam onde foram criados) e dois aparelhos editando a mesma coisa ao mesmo tempo (vale a versão mais recente e o aviso aparece em Atividade). Se algo não se comportar como o esperado, anote o horário e o que você fazia: isso ajuda a corrigir.</Text></View>
    </>;
    return null;
  };
  const back = page === 'passwords' ? 'secrets' : null;
  const wide = inline || (Boolean(desktop) && useWindowDimensions().width >= 860);
  // On the computer the categories stay on the left and the open one fills the right.
  const active = wide && !page ? 'account' : page;
  const activeCategory = categories.find(item => item.key === active);
  const title = active === 'passwords' ? 'Senhas guardadas' : activeCategory ? activeCategory.title : 'Ajustes';
  const search = <View style={s.search}><Icon name="search" size={18} color={C.faint} />
    <TextInput accessibilityLabel="Buscar nos ajustes" style={s.searchInput} value={query} onChangeText={setQuery} placeholder="Buscar nos ajustes" placeholderTextColor={C.faint} autoCorrect={false} /></View>;
  const rows = shown.map(category => <Pressable key={category.key} accessibilityRole="button" accessibilityLabel={`${category.title}. ${category.summary}`} accessibilityState={{ selected: wide && (active === category.key || (active === 'passwords' && category.key === 'secrets')) }} onPress={() => setPage(category.key)}
    style={({ pressed, hovered }) => [s.row, wide && { paddingHorizontal: 12, borderRadius: 12, borderBottomWidth: 0, paddingVertical: 12 }, wide && (active === category.key || (active === 'passwords' && category.key === 'secrets')) && { backgroundColor: C.surface2 }, hovered && { backgroundColor: C.surface }, pressed && { opacity: 0.7 }]}>
    <Icon name={category.icon} size={22} color={C.muted} />
    <View style={{ flex: 1 }}><Text style={s.rowTitle}>{category.title}</Text><Text style={s.rowSummary} numberOfLines={2}>{category.summary}</Text></View>
    {wide ? null : <Icon name="right" size={16} color={C.faint} />}
  </Pressable>);
  const pane = active === 'passwords' ? <PasswordsScreen bots={bots} onChanged={setPasswords} />
    : <ScrollView style={styles.sheetOptions} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">{body(active)}</ScrollView>;
  const inner = <>
      {wide ? <View style={{ flex: 1, flexDirection: 'row', gap: 28 }}>
        <View style={{ width: 300 }}><Text style={[s.title, { flex: 0, marginBottom: 14 }]}>Ajustes</Text>{search}<ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">{rows}{!shown.length ? <Text style={s.empty}>Nada nos ajustes combina com essa busca.</Text> : null}</ScrollView></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={s.header}>{active === 'passwords' ? <IconButton icon="back" label="Voltar a Senhas e carteira" onPress={() => setPage('secrets')} size={42} /> : null}<Text style={s.title} numberOfLines={1}>{title}</Text>{inline ? null : <IconButton icon="close" label="Fechar os ajustes" onPress={onClose} size={42} />}</View>
          <View style={{ flex: 1, maxWidth: 920 }}>{pane}</View></View>
      </View> : <>
        <View style={s.header}>
          {page ? <IconButton icon="back" label="Voltar aos ajustes" onPress={() => setPage(back)} size={42} /> : null}
          <Text style={s.title} numberOfLines={1}>{title}</Text>
          <IconButton icon="close" label="Fechar os ajustes" onPress={onClose} size={42} />
        </View>
        {page ? pane : <ScrollView style={styles.sheetOptions} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">{search}{rows}{!shown.length ? <Text style={s.empty}>Nada nos ajustes combina com essa busca.</Text> : null}</ScrollView>}
      </>}
  </>;
  if (inline) return <View style={{ flex: 1, paddingHorizontal: 32, paddingTop: 26, paddingBottom: 12 }}>{inner}</View>;
  return <Modal transparent visible={visible} animationType="slide" onRequestClose={() => (page && !wide ? setPage(back) : onClose())}>
    <View style={styles.sheetBackdrop}><View style={[styles.sheet, styles.sheetTall, wide && { maxWidth: 1040, width: '100%', alignSelf: 'center' }]}>
      <View style={styles.sheetHandle} />
      {inner}
    </View></View>
  </Modal>;
}
