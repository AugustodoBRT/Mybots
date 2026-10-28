import { browserMode } from './local';
import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, ScrollView, Keyboard, Switch, StyleSheet } from 'react-native';
import BotAvatar, { BOT_COLORS, BOT_FORMS, BOT_FORM_NAMES, formFor } from './BotAvatar';
import { BOT_TEMPLATES } from './bot-templates';
import { C, F, Icon } from './theme';
import { plainText } from './markdown';
import { column, dialogBackdrop, dialogShape, noHandle } from './desktop';
const when = value => new Date(value).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
// The access levels, like Claude Code's permission modes; switches stay under "Ajustes finos". Livre is chosen only
// here, on the phone, after its warning.
export const ACCESS = [
  ['basic', 'Pouco acesso', 'Conversa, memória, pendências, anexos e rotinas. Nada do celular nem das suas contas.'],
  ['ask', 'Médio', 'Pode tudo, mas pergunta na primeira vez que precisar (ler notificações, mandar SMS…). Responda “Sempre permitir” e ele não pergunta de novo.'],
  ['full', 'Acesso total', 'Faz tudo sem perguntar: ler notificações, e-mails, SMS, mandar notificações e mensagens, agir nos apps da sua conta.'],
  ['free', 'Livre', 'Faz praticamente tudo o que você faz no celular: mexe nos outros apps, usa o terminal do Termux e não pede licença, só o que estiver em “Sempre perguntar”. Tudo fica na Atividade e o botão Parar fica sempre na tela.']
];
// Where the bot lives, like a person who is online only where they are.
export const HOMES = [
  ['phone', 'Celular', 'Sempre online enquanto o celular está ligado. Para lembretes, faculdade, e-mails e rotinas.'],
  ['pc', 'Computador', 'Online só com o computador ligado. Para programar e mexer no PC. Com ele desligado, suas mensagens esperam.'],
  ['any', 'Onde estiver', 'Sempre online. Quando o computador liga, ele passa a trabalhar lá e ganha os poderes do PC.']
];
/**
 * Android draws the app edge to edge, so the window does not shrink for the keyboard: the sheet leaves its height
 * free at the bottom and scrolls the field being typed in into view.
 */
function useKeyboardRoom(scroll) {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', event => {
      setHeight(event.endCoordinates.height);
      setTimeout(() => {
        const input = TextInput.State.currentlyFocusedInput?.(); const content = scroll.current?.getInnerViewRef?.() || scroll.current?.getInnerViewNode?.();
        if (input && content) input.measureLayout(content, (x, y) => scroll.current?.scrollTo({ y: Math.max(0, y - 140), animated: true }), () => {});
      }, 120);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return height;
}
const STATE = { allow: 'Liberado', ask: 'Pergunta antes', deny: 'Bloqueado' };
const colorNames = { green: 'Menta', blue: 'Céu', purple: 'Lavanda', orange: 'Pêssego' };
export default function BotProfile({ visible, bot, models, defaultSelection, grants = [], memories = [], items = [], routines = [], phone, active, connections, nodes = [], skills = [], onSkill, accountApps = [], accountServers = [], onApps, onFolders, loadAgentSkills, onAgentSkills, onGpu, onBrowserMode, onClose, onSave, onGrant, onAccess, onComplete, onRoutine, onDelete, ModelSettings, freeChoice = false, freeSettings = null, onFreeAsk, PhoneControl }) {
  const initialForm = () => bot ? { name: bot.name, instructions: bot.instructions, color: bot.color, avatar: formFor(bot), autonomy: bot.autonomy || 'ask', access: bot.access, home: bot.home || 'phone', provider: bot.provider, model: bot.model, reasoningEffort: bot.reasoningEffort } : { name: '', instructions: '', color: 'green', avatar: 'orbit', autonomy: 'ask', access: 'ask', home: 'phone', ...defaultSelection };
  const scroll = useRef(null); const keyboard = useKeyboardRoom(scroll);
  const [form, setForm] = useState(initialForm); const [error, setError] = useState(''); const [saving, setSaving] = useState(false); const [tab, setTab] = useState('profile'); const [fine, setFine] = useState(false); const [openRoutine, setOpenRoutine] = useState(null); const [folder, setFolder] = useState('');
  useEffect(() => {
    if (!visible) return;
    setForm(initialForm());
    setError(''); setTab('profile');
  }, [visible, bot?.id]);
  const field = (key, value) => setForm(old => ({ ...old, [key]: value }));
  const act = async action => { setSaving(true); setError(''); try { await action(); } catch (e) { setError(e.message); } finally { setSaving(false); } };
  const tabs = [['profile', 'Perfil', 'user'], ['routines', 'Rotinas', 'bolt'], ['tools', 'Acesso', 'shield'], ['memory', 'Memória', 'memory']];
  const canSave = !(saving || active || !form.name?.trim() || !form.model);
  const radio = (selected, title, detail, onPress, options = {}) => <Pressable key={title} accessibilityRole="radio" accessibilityState={{ selected }} disabled={options.disabled} onPress={onPress}
    style={({ pressed }) => [s.choice, selected && s.choiceOn, selected && options.warn && s.choiceWarn, pressed && s.pressed]}>
    <View style={[s.radio, selected && (options.warn ? s.radioWarn : s.radioOn)]}>{selected ? <View style={[s.radioDot, options.warn && { backgroundColor: C.peach }]} /> : null}</View>
    <View style={{ flex: 1 }}><Text style={s.itemTitle}>{title}</Text>{detail ? <Text style={s.hint}>{detail}</Text> : null}</View>
  </Pressable>;
  // Skills (folders with SKILL.md) found on the computer: the bot only gets the ones turned on here.
  const [catalog, setCatalog] = useState(null); const [skillsOpen, setSkillsOpen] = useState(false);
  const onComputer = Boolean(phone && bot && bot.home && bot.home !== 'phone');
  useEffect(() => { if (visible && skillsOpen && onComputer && loadAgentSkills) { setCatalog(null); loadAgentSkills().then(setCatalog, error => setCatalog({ skills: [], message: error.message })); } }, [visible, skillsOpen, onComputer, bot?.id]);
  const setSkill = (skill, change) => { const current = bot.skills || []; const rest = current.filter(item => item.path !== skill.path); const mine = current.find(item => item.path === skill.path); return act(() => onAgentSkills(change === null ? rest : [...rest, { path: skill.path, write: false, ...mine, ...change }])); };
  const toggle = (value, onChange, label) => <Switch accessibilityLabel={label} value={value} disabled={saving} trackColor={{ false: C.line2, true: C.mint + '88' }} thumbColor={value ? C.mint : '#9AA2B1'} onValueChange={onChange} />;
  return <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
    <View style={[s.backdrop, { paddingBottom: keyboard }]}><View style={s.keyboard}><View style={s.sheet}>
      <View style={s.handle} />
      <View style={s.heading}>
        <View style={{ flex: 1 }}><Text style={s.title}>{bot ? bot.name : 'Novo bot'}</Text><Text style={s.subtitle}>{bot ? 'Perfil, rotinas, acesso e memória' : 'Um rosto, um jeito e um trabalho'}</Text></View>
        <Pressable accessibilityLabel="Fechar perfil" accessibilityRole="button" onPress={onClose} style={s.close}><Icon name="close" size={19} color={C.text2} /></Pressable>
      </View>
      {bot && phone && <View style={s.tabs}>{tabs.map(([key, label, icon]) => <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: tab === key }} onPress={() => setTab(key)} style={[s.tab, tab === key && s.tabActive]}>
        <Icon name={icon} size={16} color={tab === key ? C.mint : C.muted} /><Text style={[s.tabText, tab === key && s.tabTextActive]}>{label}</Text></Pressable>)}</View>}
      <ScrollView ref={scroll} style={s.scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
        {tab === 'profile' && <>
          <View style={s.preview}>
            <View style={[s.halo, { backgroundColor: (BOT_COLORS[form.color] || C.mint) + '14' }]}><BotAvatar bot={form} size={118} tile={false} /></View>
            <Text style={s.previewName}>{form.name || 'Seu próximo parceiro'}</Text>
          </View>
          {!bot && phone ? <><Text style={s.label}>COMEÇAR DE UM MODELO</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }} style={{ marginHorizontal: -20, paddingHorizontal: 20, flexGrow: 0 }}>
              {[{ id: 'blank', label: 'Do zero', hint: 'Você escreve tudo.', profile: { name: '', instructions: '' } }, ...BOT_TEMPLATES].map(template => {
                const chosen = template.id === 'blank' ? !BOT_TEMPLATES.some(item => item.profile.instructions === form.instructions) : form.instructions === template.profile.instructions;
                return <Pressable key={template.id} accessibilityRole="button" onPress={() => setForm(old => { const { browserMode: _mode, ...rest } = old; return { ...rest, ...template.profile }; })} style={[s.template, chosen && s.choiceOn]}>
                  <Icon name={template.id === 'blank' ? 'edit' : template.icon || 'calendar'} size={20} color={chosen ? C.mint : C.muted} /><Text style={s.itemTitle}>{template.label}</Text><Text style={s.hint} numberOfLines={3}>{template.hint}</Text></Pressable>;
              })}
              <View style={{ width: 20 }} />
            </ScrollView></> : null}
          <Text style={s.label}>APARÊNCIA</Text>
          <View style={s.forms}>{BOT_FORMS.map(avatar => <Pressable key={avatar} accessibilityRole="radio" accessibilityLabel={BOT_FORM_NAMES[avatar]} accessibilityState={{ selected: form.avatar === avatar }} onPress={() => field('avatar', avatar)} style={[s.formOption, form.avatar === avatar && s.choiceOn]}><BotAvatar bot={{ ...form, avatar }} size={54} animated={form.avatar === avatar} tile={false} /><Text style={[s.formName, form.avatar === avatar && { color: C.mint }]}>{BOT_FORM_NAMES[avatar]}</Text></Pressable>)}</View>
          <View style={s.colors}>{Object.entries(BOT_COLORS).map(([key, color]) => <Pressable key={key} accessibilityRole="radio" accessibilityLabel={colorNames[key]} accessibilityState={{ selected: form.color === key }} onPress={() => field('color', key)} style={[s.swatchRing, form.color === key && { borderColor: color }]}><View style={[s.swatch, { backgroundColor: color }]}>{form.color === key ? <Icon name="check" size={16} color="#10141A" stroke={2.8} /> : null}</View></Pressable>)}</View>
          <Text style={s.label}>NOME</Text><TextInput accessibilityLabel="Nome do bot" value={form.name || ''} onChangeText={v => field('name', v)} maxLength={40} placeholder="Como ele vai se chamar?" placeholderTextColor={C.faint} selectionColor={C.mint} style={s.input} />
          <Text style={s.label}>PERSONALIDADE E FUNÇÃO</Text><TextInput accessibilityLabel="Personalidade e função" value={form.instructions || ''} onChangeText={v => field('instructions', v)} maxLength={2000} multiline placeholder="Ex.: Me ajude com a faculdade. Seja direto, curioso e descontraído." placeholderTextColor={C.faint} selectionColor={C.mint} style={[s.input, s.instructions]} />
          <Text style={s.label}>INTELIGÊNCIA</Text><ModelSettings models={models} connections={connections} selection={form} disabled={saving || active} onChange={(model, reasoningEffort, provider) => setForm(old => ({ ...old, model, reasoningEffort, provider }))} />
          {phone && <><Text style={s.label}>ONDE ELE VIVE</Text>{HOMES.map(([key, title, detail]) => radio(form.home === key, title, detail, () => field('home', key), { disabled: saving || active }))}
            {form.home !== 'phone' && !nodes.length ? <Text style={s.hint}>Nenhum computador conectado ainda. Até ele chegar, {form.home === 'pc' ? 'as mensagens para este bot ficam esperando' : 'este bot trabalha no celular'}.</Text> : null}</>}
          {phone && !bot && <><Text style={s.label}>NÍVEL DE ACESSO</Text>{ACCESS.filter(([key]) => key !== 'free').map(([key, title, detail]) => radio(form.access === key, title, detail, () => field('access', key), { warn: key === 'full' }))}<Text style={s.hint}>Dá para mudar depois, em Acesso.</Text></>}
          {active && <Text style={s.hint}>Aguarde ou cancele a tarefa para salvar o perfil.</Text>}
          <Pressable accessibilityRole="button" disabled={!canSave} onPress={() => act(() => onSave(form))} style={({ pressed }) => [s.primary, !canSave && s.disabled, pressed && s.pressed]}>
            <Icon name={bot ? 'check' : 'spark'} size={19} color={C.mintInk} stroke={2.4} /><Text style={s.primaryText}>{saving ? 'Salvando…' : bot ? 'Salvar alterações' : 'Criar meu bot'}</Text></Pressable>
          {bot && <Pressable accessibilityRole="button" disabled={saving || active} onPress={onDelete} style={s.delete}><Icon name="trash" size={16} color={C.red} /><Text style={s.deleteText}>Apagar bot e conversa</Text></Pressable>}
        </>}
        {tab === 'tools' && <><Text style={s.sectionTitle}>Quanto {bot?.name} pode fazer?</Text>
          {ACCESS.filter(([key]) => key !== 'free' || freeChoice || bot?.access === 'free').map(([key, title, detail]) => radio(bot?.access === key, title, detail, () => act(() => onAccess(key)), { warn: key === 'full' || key === 'free', disabled: saving || active || key === 'free' && !freeChoice }))}
          {!freeChoice && bot?.access !== 'free' && phone ? <Text style={s.hint}>O nível Livre se escolhe no app do celular.</Text> : null}
          {!bot?.access ? <Text style={s.hint}>Este bot usa a configuração personalizada antiga (os interruptores abaixo). Escolha um nível para simplificar.</Text> : null}
          {active ? <Text style={s.hint}>Aguarde a resposta terminar para mudar o nível.</Text> : null}
          {bot?.access === 'free' ? <>
            {PhoneControl ? <PhoneControl /> : null}
            <Text style={s.label}>SEMPRE PERGUNTAR (NÍVEL LIVRE)</Text>
            <View style={s.group}>
              <Text style={[s.hint, { padding: 14, paddingBottom: 4 }]}>No Livre, só o que estiver ligado aqui pede sua aprovação, num cartão como o de sempre. Vale para todos os bots no nível Livre e só muda por aqui, no app; o bot não consegue mudar. Senhas, cartões e códigos continuam sem passar pela IA, CAPTCHA continua com você, e o MyBots, instalar apps e dar permissões nunca são feitos por bots.{bot.provider !== 'claude' ? ' No Codex, o MyBots não consegue perguntar comando a comando no Termux: com “Comandos no Termux” ligado, ele fica sem terminal no celular, e “Comandos perigosos” vale só como instrução.' : ''}</Text>
              {(freeSettings?.options || []).map((item, index, list) => <View key={item.key} style={[s.permission, index === list.length - 1 && { borderBottomWidth: 0 }]}>
                <View style={s.permissionCopy}><Text style={s.itemTitle}>{item.label}</Text>{item.detail ? <Text style={s.hint}>{item.detail}</Text> : null}</View>
                {toggle(item.ask, on => act(() => onFreeAsk(item.key, on)), item.label)}
              </View>)}
              {!freeSettings ? <Text style={[s.hint, { padding: 14 }]}>Carregando…</Text> : null}
            </View></> : null}
          {phone && bot?.provider === 'claude' && grants.find(item => item.name === 'account.connectors')?.state !== 'deny' ? <>
            <Text style={s.label}>APPS DA SUA CONTA DO CLAUDE</Text>
            <View style={s.group}>
              <Text style={[s.hint, { padding: 14, paddingBottom: 4 }]}>Marque só o que {bot.name} usa. Cada app carrega todas as ferramentas dele em cada passo da resposta (de 5 a 20 mil tokens cada); os desmarcados ficam fora.</Text>
              {[...new Set([...accountServers, ...accountApps])].map((name, index, list) => <View key={name} style={[s.permission, index === list.length - 1 && { borderBottomWidth: 0 }]}>
                <View style={s.permissionCopy}><Text style={s.itemTitle}>{name}</Text></View>
                {toggle(accountApps.includes(name), on => act(() => onApps(on ? [...accountApps, name] : accountApps.filter(item => item !== name))), name)}
              </View>)}
              {!accountServers.length && !accountApps.length ? <Text style={[s.hint, { padding: 14 }]}>A lista aparece depois da primeira resposta de um bot com Claude, ou em Ajustes → Apps da sua conta → Atualizar.</Text> : null}
            </View></> : null}
          {phone && bot && bot.provider !== 'claude' && grants.find(item => item.name === 'account.connectors')?.state !== 'deny' ? <>
            <Text style={s.label}>APPS DA SUA CONTA DO CODEX</Text>
            <View style={s.group}>
              <View style={[s.permission, { borderBottomWidth: 0 }]}>
                <View style={s.permissionCopy}><Text style={s.itemTitle}>Usar os apps conectados (Indeed, Gmail, Agenda…)</Text>
                  <Text style={s.hint}>São os apps que você ligou na sua conta do ChatGPT/Codex. Ligado, {bot.name} pode usá-los; desligado, não vê nenhum. Cada app usado gasta mais tokens por resposta.</Text></View>
                {toggle(accountApps.length > 0, on => act(() => onApps(on ? ['ChatGPT'] : [])), 'Apps da conta do Codex')}
              </View>
            </View></> : null}
          {phone && bot ? <>
            <Text style={s.label}>NAVEGADOR</Text>
            {[
              ['shared', 'Navegador compartilhado', 'O padrão. Um navegador para todos os bots, com abas próprias de cada um: um login feito por um bot (ou por você, ao assumir) vale para os outros. Os bots agem logados nessas contas.'],
              ['separate', 'Navegador separado', 'Só deste bot, sem os logins dos outros. Use para isolar um bot.'],
              ...(bot.home !== 'phone' ? [['mine', 'Meu Chrome', 'Usa seus logins do Chrome, inclusive o Google, em abas próprias do bot. Suas outras abas são preservadas. No Médio, ações pedem aprovação.']] : []),
              ...(bot.home !== 'phone' && bot.provider === 'claude' ? [['claude', 'Claude in Chrome', 'Integração oficial do Claude, com extensão no seu Chrome e logins compartilhados.']] : [])
            ].map(([mode, title, detail]) => radio(browserMode(bot) === mode, title, detail, () => act(() => onBrowserMode(mode)), { disabled: saving || active || mode !== 'separate' && bot.access === 'basic' || ['mine', 'claude'].includes(mode) && grants.find(item => item.name === 'browser')?.state !== 'allow' }))}
            {['shared', 'separate'].includes(browserMode(bot)) ? <Text style={s.hint}>{bot.home === 'phone' ? 'Este bot navega no celular.' : bot.home === 'pc' ? 'Este bot navega no computador.' : 'Este bot navega no aparelho onde estiver respondendo.'} O navegador do computador e o do celular são diferentes: um login feito no computador não vale no celular, e vice-versa. Entre uma vez em cada um, se precisar dos dois.{bot.access === 'basic' ? ' Em Pouco acesso o navegador é sempre separado.' : ''}</Text> : null}
            {browserMode(bot) === 'mine' ? <Text style={s.hint}>No computador, abra o Chrome que você já usa. Entre em chrome://inspect/#remote-debugging e ligue a depuração remota uma vez. Quando o bot conectar, confirme a solicitação no Chrome. Ele usa só as abas que criou; nunca fecha seu Chrome. Para parar, desligue a depuração nessa mesma tela.</Text> : null}
            {bot.home !== 'phone' && grants.find(item => item.name === 'browser')?.state !== 'allow' ? <Text style={s.hint}>Libere Navegador em Ajustes finos para usar seus logins do Chrome.</Text> : null}
          </> : null}
          {phone && bot && bot.home && bot.home !== 'phone' && grants.find(item => item.name === 'computer')?.state !== 'deny' ? <>
            <Text style={s.label}>PASTAS NO COMPUTADOR</Text>
            <View style={s.group}>
              <Text style={[s.hint, { padding: 14, paddingBottom: 4 }]}>{bot.name} vê, cria e edita livremente na pasta dele (~/MyBots/{bot.name}) e nestas.{bot.access === 'full' ? ' Com Acesso total, também no resto da sua pasta pessoal.' : ' Fora delas, ler e salvar pedem sua aprovação.'} Senhas e chaves (como ~/.ssh) ficam sempre escondidas.</Text>
              {(bot.folders || []).map(path => <View key={path} style={s.permission}>
                <Icon name="list" size={16} color={C.mint} /><View style={s.permissionCopy}><Text style={s.itemTitle}>{path}</Text></View>
                <Pressable accessibilityRole="button" accessibilityLabel={`Tirar ${path}`} hitSlop={8} disabled={saving || active} onPress={() => act(() => onFolders((bot.folders || []).filter(item => item !== path)))}><Icon name="trash" size={16} color={C.faint} /></Pressable>
              </View>)}
              <View style={[s.permission, { borderBottomWidth: 0 }]}>
                <TextInput accessibilityLabel="Nova pasta no computador" value={folder} onChangeText={setFolder} placeholder="~/vscodeProjects" placeholderTextColor={C.faint} autoCapitalize="none" autoCorrect={false} selectionColor={C.mint} style={[s.input, { flex: 1, minHeight: 44, paddingVertical: 8 }]} />
                <Pressable accessibilityRole="button" disabled={saving || active || !folder.trim()} onPress={() => act(async () => { await onFolders([...new Set([...(bot.folders || []), folder.trim().replace(/\/+$/, '')])]); setFolder(''); })} style={[s.smallButton, { marginTop: 0 }, (!folder.trim() || active) && s.disabled]}><Icon name="plus" size={14} color={C.mint} /><Text style={s.link}>Liberar</Text></Pressable>
              </View>
            </View></> : null}
          {onComputer && onAgentSkills ? <>
            <Pressable accessibilityRole="button" onPress={() => setSkillsOpen(value => !value)} style={s.disclosure}><Text style={s.link}>Skills{(bot.skills || []).length ? ` · ${(bot.skills || []).length} ligada${(bot.skills || []).length === 1 ? '' : 's'}` : ''}</Text><Icon name={skillsOpen ? 'down' : 'back'} size={15} color={C.mint} /></Pressable>
            {skillsOpen && <View style={s.group}>
              <Text style={[s.hint, { padding: 14, paddingBottom: 4 }]}>Skills são pastas com instruções e scripts que ficam no computador (as de ~/.claude, ~/.codex e ~/.agents). {bot.name} só usa as que você ligar aqui, do mesmo jeito no Claude e no Codex, e só enxerga a pasta da skill, nunca o resto de ~/.claude ou ~/.codex.</Text>
              {catalog === null ? <Text style={[s.hint, { padding: 14 }]}>Procurando no computador…</Text> : catalog.skills.length === 0 ? <Text style={[s.hint, { padding: 14 }]}>{catalog.message || 'Nenhuma skill encontrada no computador.'}</Text> : catalog.skills.map(skill => {
                const mine = (bot.skills || []).find(item => item.path === skill.path);
                return <View key={skill.path} style={[s.permission, { alignItems: 'flex-start' }]}>
                  <View style={s.permissionCopy}><Text style={s.itemTitle}>{skill.name}</Text>{skill.source ? <Text style={[s.hint, { color: C.faint }]}>{skill.source}</Text> : null}<Text style={s.hint} numberOfLines={mine ? undefined : 2}>{skill.description || 'Sem descrição.'}</Text>
                    {mine ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 }}><Switch accessibilityLabel={`${skill.name} pode ser melhorada`} value={Boolean(mine.write)} disabled={saving || active} trackColor={{ false: C.line2, true: C.mint + '88' }} thumbColor={mine.write ? C.mint : '#9AA2B1'} onValueChange={write => setSkill(skill, { write })} /><Text style={[s.hint, { flex: 1 }]}>Pode melhorar a skill (gravar nela o que aprender)</Text></View> : null}
                  </View>
                  <Switch accessibilityLabel={`Ligar ${skill.name}`} value={Boolean(mine)} disabled={saving || active} trackColor={{ false: C.line2, true: C.mint + '88' }} thumbColor={mine ? C.mint : '#9AA2B1'} onValueChange={on => setSkill(skill, on ? {} : null)} />
                </View>;
              })}
              <View style={[s.permission, { borderBottomWidth: 0, alignItems: 'flex-start' }]}>
                <View style={s.permissionCopy}><Text style={s.itemTitle}>Usar a placa de vídeo</Text><Text style={s.hint}>Abre o acesso à GPU do computador para este bot (renderizar vídeo, por exemplo). Fica desligado por padrão: sem isso, o bot não enxerga a placa. Num bot Codex, ligar isso também tira o isolamento próprio do Codex: ele passa a poder gravar em qualquer lugar da sua pasta pessoal (senhas e chaves continuam escondidas).</Text></View>
                <Switch accessibilityLabel="Usar a placa de vídeo" value={bot.gpu === true} disabled={saving || active} trackColor={{ false: C.line2, true: C.mint + '88' }} thumbColor={bot.gpu === true ? C.mint : '#9AA2B1'} onValueChange={on => act(() => onGpu(on))} />
              </View>
            </View>}</> : null}
          <Pressable accessibilityRole="button" onPress={() => setFine(value => !value)} style={s.disclosure}><Text style={s.link}>Ajustes finos</Text><Icon name={fine || !bot?.access ? 'back' : 'down'} size={15} color={C.mint} /></Pressable>
          {(fine || !bot?.access) && <View style={s.group}><Text style={[s.hint, { padding: 14, paddingBottom: 4 }]}>Cada interruptor vale por cima do nível. Desligar uma ferramenta também cancela a aprovação que estiver aberta.</Text>
            {grants.map((grant, index) => <View key={grant.name} style={[s.permission, index === grants.length - 1 && { borderBottomWidth: 0 }]}><View style={s.permissionCopy}><Text style={s.itemTitle}>{grant.label}</Text><Text style={s.hint}>{grant.description}</Text>{bot?.access ? <Text style={[s.stateTag, grant.state === 'allow' ? s.stateAllow : grant.state === 'ask' ? s.stateAsk : s.stateDeny]}>{STATE[grant.state]}</Text> : null}</View>
              {toggle(bot?.access ? grant.state === 'allow' : grant.allowed, allowed => act(() => onGrant(grant.name, allowed)), grant.label)}</View>)}</View>}
          <View style={s.security}><Icon name="shield" size={20} color={C.mint} /><View style={{ flex: 1 }}><Text style={s.itemTitle}>Um bot não herda acessos de outro.</Text><Text style={s.hint}>{bot?.access === 'free' ? 'No Livre, só este bot ganha o terminal do Termux e o controle do celular; senhas, cartões, códigos e os arquivos do supervisor continuam fora do alcance dele.' : 'Sem terminal e sem ler os arquivos do celular.'} Cada ação fica registrada na Atividade.</Text></View></View></>}
        {tab === 'routines' && <><Text style={s.sectionTitle}>O que {bot?.name} faz sozinho</Text><Text style={s.hint}>Peça na conversa, por exemplo: “todo dia às 8h me resume os e-mails” ou “quando chegar notificação do SIGAA, anote a atividade”. Você aprova cada rotina antes de ela existir.</Text>
          {routines.length ? routines.map(item => <View key={item.id} style={s.item}>
            <View style={s.routineHead}><View style={s.itemIcon}><Icon name={item.trigger?.type === 'notification' ? 'bell' : 'clock'} size={17} color={item.enabled ? C.sky : C.faint} /></View><Text style={[s.itemTitle, { flex: 1 }]}>{item.title}</Text>{toggle(item.enabled, enabled => act(() => onRoutine('routine.update', item.id, { enabled })), `Rotina ${item.title} ${item.enabled ? 'ativa' : 'pausada'}`)}</View>
            <Text style={s.routineTrigger}>{item.label}</Text>
            <Pressable accessibilityRole="button" onPress={() => setOpenRoutine(openRoutine === item.id ? null : item.id)}>
              <Text style={s.itemText} numberOfLines={openRoutine === item.id ? undefined : 3}>{item.instructions}</Text>
              <Text style={s.more}>{openRoutine === item.id ? 'Mostrar menos' : 'Ver instruções completas'}</Text>
            </Pressable>
            <Text style={s.hint}>{!item.enabled ? 'Pausada' : item.nextRunAt ? `Próxima: ${when(item.nextRunAt)}` : item.pending ? 'Notificação nova; roda em instantes' : 'Aguardando notificação'}{item.lastRunAt ? ` · Última: ${when(item.lastRunAt)}` : ''}{item.runsToday ? ` · ${item.runsToday} em 24 h` : ''}</Text>
            {item.lastResult ? <Text style={s.result} numberOfLines={3}>{plainText(item.lastResult)}</Text> : null}
            <View style={s.routineActions}><Pressable accessibilityRole="button" disabled={saving || active} onPress={() => act(() => onRoutine('routine.run', item.id))} style={[s.smallButton, active && s.disabled]}><Icon name="play" size={14} color={C.mint} /><Text style={s.link}>Executar agora</Text></Pressable>
              <Pressable accessibilityRole="button" disabled={saving} onPress={() => act(() => onRoutine('routine.delete', item.id))} style={s.smallButton}><Icon name="trash" size={14} color={C.red} /><Text style={s.deleteText}>Apagar</Text></Pressable></View>
          </View>) : <View style={s.emptyBox}><Icon name="bolt" size={26} color={C.faint} /><Text style={s.empty}>Nenhuma rotina ainda. Peça uma na conversa.</Text></View>}
          <Text style={s.hint}>O resultado de cada rotina chega como notificação do MyBots.</Text>
          {skills.length ? <><Text style={s.label}>HABILIDADES</Text>
            <Text style={s.hint}>Programas que você aprovou. Rodam neste celular, isolados e sem usar a IA: só acessam os sites listados, sem seus arquivos e sem outros programas.</Text>
            {skills.map(skill => <View key={skill.id} style={s.item}>
              <View style={s.routineHead}><View style={s.itemIcon}><Icon name="spark" size={17} color={C.sky} /></View><Text style={[s.itemTitle, { flex: 1 }]}>{skill.title}</Text><Text style={s.hint}>v{skill.version}</Text></View>
              <Text style={s.itemText}>{skill.description}</Text>
              <Text style={s.hint}>{skill.sites?.length ? `Acessa: ${skill.sites.join(', ')}` : 'Não acessa a internet'}</Text>
              <View style={s.routineActions}><Pressable accessibilityRole="button" disabled={saving} onPress={() => act(() => onSkill('skill.run', skill.id))} style={s.smallButton}><Icon name="play" size={14} color={C.mint} /><Text style={s.link}>{saving ? 'Rodando…' : 'Rodar agora'}</Text></Pressable>
                <Pressable accessibilityRole="button" disabled={saving} onPress={() => act(() => onSkill('skill.remove', skill.id))} style={s.smallButton}><Icon name="trash" size={14} color={C.red} /><Text style={s.deleteText}>Remover</Text></Pressable></View>
            </View>)}</> : null}</>}
        {tab === 'memory' && <><Text style={s.sectionTitle}>O que {bot?.name} guardou</Text><Text style={s.hint}>Estas lembranças pertencem somente a este bot.</Text>
          {memories.length ? memories.map(item => <View key={item.id} style={s.item}><Text style={s.itemTitle}>{item.key}</Text><Text selectable style={s.itemText}>{item.text}</Text></View>) : <View style={s.emptyBox}><Icon name="memory" size={26} color={C.faint} /><Text style={s.empty}>Nenhuma lembrança ainda. Peça para o bot guardar algo.</Text></View>}
          <Text style={s.label}>PENDÊNCIAS</Text>
          {items.length ? items.map(item => <View key={item.id} style={[s.item, item.state === 'done' && { opacity: 0.55 }]}>
            <View style={s.routineHead}><View style={[s.check, item.state === 'done' && s.checkDone]}>{item.state === 'done' ? <Icon name="check" size={13} color={C.mintInk} stroke={3} /> : null}</View><Text style={[s.itemTitle, { flex: 1 }]}>{item.course ? `${item.course} · ` : ''}{item.title}</Text></View>
            {item.dueLabel ? <Text style={s.routineTrigger}>Prazo {item.dueLabel}</Text> : null}{item.details ? <Text style={s.itemText}>{item.details}</Text> : null}{item.source ? <Text style={s.hint}>Fonte: {item.source}</Text> : null}
            {item.state === 'open' && <Pressable accessibilityRole="button" disabled={saving} onPress={() => act(() => onComplete(item.id))} style={s.smallButton}><Icon name="check" size={14} color={C.mint} /><Text style={s.link}>Marcar como concluída</Text></Pressable>}</View>)
            : <View style={s.emptyBox}><Icon name="list" size={26} color={C.faint} /><Text style={s.empty}>As pendências criadas pelo bot aparecem aqui.</Text></View>}</>}
        {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
      </ScrollView>
    </View></View></View>
  </Modal>;
}
const box = { backgroundColor: C.surface, borderRadius: 20, borderWidth: 1, borderColor: C.line };
const s = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#000000B3', ...dialogBackdrop }, keyboard: { height: '92%', ...column, ...(dialogShape.borderRadius ? { height: '100%', maxHeight: 900 } : {}) },
  sheet: { flex: 1, backgroundColor: C.bg2, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 20, paddingBottom: 20, borderTopWidth: 1, borderColor: C.line2, ...dialogShape, ...(dialogShape.borderRadius ? { paddingTop: 20 } : {}) },
  handle: { alignSelf: 'center', width: 42, height: 5, backgroundColor: C.line2, borderRadius: 3, marginTop: 10, marginBottom: 12, ...noHandle },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  title: { color: C.text, fontFamily: F.x, fontSize: 23, letterSpacing: -0.7 }, subtitle: { color: C.muted, fontFamily: F.m, fontSize: 13, marginTop: 2 },
  close: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center', borderRadius: 14, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line },
  tabs: { flexDirection: 'row', gap: 4, backgroundColor: C.surface, borderRadius: 18, padding: 4, marginBottom: 12, borderWidth: 1, borderColor: C.line },
  tab: { flex: 1, flexDirection: 'row', gap: 5, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  tabActive: { backgroundColor: C.elevated }, tabText: { color: C.muted, fontFamily: F.s, fontSize: 12.5 }, tabTextActive: { color: C.text, fontFamily: F.b },
  scroll: { flex: 1 }, content: { paddingBottom: 30 },
  pressed: { opacity: 0.75 },
  preview: { alignItems: 'center', gap: 6, marginTop: 4, marginBottom: 6 },
  halo: { width: 160, height: 160, borderRadius: 80, alignItems: 'center', justifyContent: 'center' },
  previewName: { color: C.text, fontFamily: F.x, fontSize: 25, letterSpacing: -0.7 },
  hint: { color: C.muted, fontFamily: F.m, fontSize: 12.5, lineHeight: 19 },
  label: { color: C.faint, fontFamily: F.x, fontSize: 11, letterSpacing: 1.6, marginTop: 24, marginBottom: 10 },
  template: { ...box, width: 150, padding: 14, gap: 6 },
  forms: { flexDirection: 'row', gap: 8 },
  formOption: { ...box, flex: 1, alignItems: 'center', paddingVertical: 12, gap: 6 },
  formName: { color: C.text2, fontFamily: F.s, fontSize: 11.5 },
  colors: { flexDirection: 'row', justifyContent: 'center', gap: 14, paddingTop: 16 },
  swatchRing: { padding: 3, borderRadius: 24, borderWidth: 2, borderColor: 'transparent' },
  swatch: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  input: { backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.line2, color: C.text, fontFamily: F.m, paddingHorizontal: 15, paddingVertical: 13, minHeight: 52, fontSize: 15 },
  instructions: { minHeight: 110, textAlignVertical: 'top', lineHeight: 21 },
  choice: { ...box, flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 15, marginBottom: 9 },
  choiceOn: { borderColor: C.mint + '70', backgroundColor: C.mint + '0C' }, choiceWarn: { borderColor: C.peach + '80', backgroundColor: C.peach + '0D' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: C.line2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  radioOn: { borderColor: C.mint }, radioWarn: { borderColor: C.peach }, radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.mint },
  primary: { minHeight: 54, flexDirection: 'row', gap: 8, backgroundColor: C.mint, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  primaryText: { color: C.mintInk, fontFamily: F.x, fontSize: 15.5 }, disabled: { opacity: 0.35 },
  delete: { flexDirection: 'row', gap: 7, minHeight: 50, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  deleteText: { color: C.red, fontFamily: F.b, fontSize: 13 }, error: { color: C.red, fontFamily: F.m, fontSize: 13, marginTop: 10 },
  sectionTitle: { color: C.text, fontFamily: F.x, fontSize: 21, letterSpacing: -0.5, lineHeight: 27, marginTop: 6, marginBottom: 10 },
  disclosure: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 46 },
  group: { ...box, overflow: 'hidden' },
  permission: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: C.line, paddingVertical: 14, paddingHorizontal: 14, gap: 12 },
  permissionCopy: { flex: 1, gap: 4 },
  stateTag: { alignSelf: 'flex-start', fontFamily: F.b, fontSize: 10.5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: 'hidden', marginTop: 2 },
  stateAllow: { color: C.mint, backgroundColor: C.mint + '17' }, stateAsk: { color: C.amber, backgroundColor: C.amber + '17' }, stateDeny: { color: C.muted, backgroundColor: C.surface2 },
  itemTitle: { color: C.text, fontFamily: F.b, fontSize: 14.5 },
  itemText: { color: C.text2, fontFamily: F.r, fontSize: 14, lineHeight: 21, marginTop: 6 },
  itemIcon: { width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: C.sky + '14' },
  security: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', backgroundColor: C.mint + '0C', padding: 16, borderRadius: 20, marginTop: 20, borderWidth: 1, borderColor: C.mint + '22' },
  item: { ...box, padding: 15, marginTop: 11, gap: 2 },
  result: { color: C.text2, fontFamily: F.m, fontSize: 12.5, lineHeight: 18, marginTop: 8, padding: 10, borderRadius: 12, backgroundColor: C.surface2 },
  emptyBox: { ...box, alignItems: 'center', gap: 8, paddingVertical: 26, paddingHorizontal: 20, marginTop: 12, borderStyle: 'dashed' },
  empty: { color: C.muted, fontFamily: F.m, fontSize: 13.5, lineHeight: 20, textAlign: 'center' },
  smallButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, marginTop: 6 },
  link: { color: C.mint, fontFamily: F.b, fontSize: 13 }, more: { color: C.muted, fontFamily: F.s, fontSize: 12, marginTop: 4 },
  routineHead: { flexDirection: 'row', alignItems: 'center', gap: 10 }, routineTrigger: { color: C.sky, fontFamily: F.s, fontSize: 12.5, marginTop: 8 },
  routineActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  check: { width: 22, height: 22, borderRadius: 7, borderWidth: 2, borderColor: C.line2, alignItems: 'center', justifyContent: 'center' }, checkDone: { backgroundColor: C.mint, borderColor: C.mint }
});
