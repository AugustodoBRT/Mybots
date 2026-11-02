import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, ScrollView, Keyboard, Switch, StyleSheet } from 'react-native';
import BotAvatar from './BotAvatar';
import { FacePicker } from './components/FacePicker';
import { botColor, botSeed } from '../lib/mimo.mjs';
import { BOT_TEMPLATES } from './bot-templates';
import { C, F, Icon, themed } from './theme';
import { plainText } from './markdown';
import NegotiationPanel from './NegotiationPanel';
import { column, dialogBackdrop, dialogShape, noHandle } from './desktop';
const when = value => new Date(value).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
/**
 * Android draws the app edge to edge, so the window does not shrink for the keyboard: the sheet leaves its height
 * free at the bottom and scrolls the field being typed in into view.
 */
export function useKeyboardRoom(scroll) {
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
export default function BotProfile({ initialTab, visible, bot, models, defaultSelection, memories = [], items = [], routines = [], negotiations = [], onNegotiation, phone, active, connections, skills = [], onSkill, loadAgentSkills, onAgentSkills, onFallback, FallbackSettings, googleAccounts = [], onGoogleAccount, onGoogleLogin, onPhoneControl, onClose, onSave, onComplete, onRoutine, onDelete, ModelSettings, PhoneControl, inline = false }) {
  const initialForm = () => bot ? { name: bot.name, instructions: bot.instructions, color: bot.color, avatar: bot.avatar || 'orbit', ...(bot.face ? { face: bot.face } : {}), autonomy: bot.autonomy || 'ask', provider: bot.provider, model: bot.model, reasoningEffort: bot.reasoningEffort } : { name: '', instructions: '', color: 'green', avatar: 'orbit', autonomy: 'ask', ...defaultSelection };
  const scroll = useRef(null); const keyboard = useKeyboardRoom(scroll);
  const [form, setForm] = useState(initialForm); const [error, setError] = useState(''); const [saving, setSaving] = useState(false); const [tab, setTab] = useState('profile'); const [account, setAccount] = useState(''); const [openRoutine, setOpenRoutine] = useState(null);
  useEffect(() => {
    if (!visible) return;
    setForm(initialForm());
    setError(''); setAccount(''); setTab(initialTab || 'profile');
  }, [visible, bot?.id]);
  const field = (key, value) => setForm(old => ({ ...old, [key]: value }));
  const act = async action => { setSaving(true); setError(''); try { await action(); } catch (e) { setError(e.message); } finally { setSaving(false); } };
  const tabs = [['profile', 'Perfil', 'user'], ['routines', 'Rotinas', 'bolt'], ...(phone && bot && onNegotiation ? [['negotiate', 'Negociar', 'hand']] : []), ['tools', 'Acesso', 'shield'], ['memory', 'Memória', 'memory']];
  const canSave = !(saving || active || !form.name?.trim() || !form.model);
  const radio = (selected, title, detail, onPress, options = {}) => <Pressable key={title} accessibilityRole="radio" accessibilityState={{ selected }} disabled={options.disabled} onPress={onPress}
    style={({ pressed }) => [s.choice, selected && s.choiceOn, selected && options.warn && s.choiceWarn, pressed && s.pressed]}>
    <View style={[s.radio, selected && (options.warn ? s.radioWarn : s.radioOn)]}>{selected ? <View style={[s.radioDot, options.warn && { backgroundColor: C.peach }]} /> : null}</View>
    <View style={{ flex: 1 }}><Text style={s.itemTitle}>{title}</Text>{detail ? <Text style={s.hint}>{detail}</Text> : null}</View>
  </Pressable>;
  // Skills (folders with SKILL.md) found on the computer: the bot only gets the ones turned on here.
  const [catalog, setCatalog] = useState(null); const [skillsOpen, setSkillsOpen] = useState(false);
  const onComputer = Boolean(phone && bot);
  useEffect(() => { if (visible && skillsOpen && onComputer && loadAgentSkills) { setCatalog(null); loadAgentSkills().then(setCatalog, error => setCatalog({ skills: [], message: error.message })); } }, [visible, skillsOpen, onComputer, bot?.id]);
  const setSkill = (skill, change) => { const current = bot.skills || []; const rest = current.filter(item => item.path !== skill.path); const mine = current.find(item => item.path === skill.path); return act(() => onAgentSkills(change === null ? rest : [...rest, { path: skill.path, write: true, ...mine, ...change }])); };
  const toggle = (value, onChange, label) => <Switch accessibilityLabel={label} value={value} disabled={saving} trackColor={{ false: C.line2, true: C.accent + '88' }} thumbColor={value ? C.accent : C.muted} onValueChange={onChange} />;
  // On the computer the profile lives inside the window's right bar instead of a dialog.
  const frame = sheet => inline ? (visible ? <View style={{ flex: 1 }}>{sheet}</View> : null)
    : <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}><View style={[s.backdrop, { paddingBottom: keyboard }]}><View style={s.keyboard}>{sheet}</View></View></Modal>;
  return frame(<View style={[s.sheet, inline && s.inlineSheet]}>
      <View style={s.handle} />
      <View style={s.heading}>
        <View style={{ flex: 1 }}><Text style={s.title}>{bot ? bot.name : 'Novo bot'}</Text><Text style={s.subtitle}>{bot ? 'Perfil, rotinas, acesso e memória' : 'Um rosto, um jeito e um trabalho'}</Text></View>
        {inline ? null : <Pressable accessibilityLabel="Fechar perfil" accessibilityRole="button" onPress={onClose} style={s.close}><Icon name="close" size={19} color={C.text2} /></Pressable>}
      </View>
      {bot && phone && <View style={s.tabs}>{tabs.map(([key, label, icon]) => <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: tab === key }} onPress={() => setTab(key)} style={[s.tab, tab === key && s.tabActive]}>
        <Icon name={icon} size={16} color={tab === key ? C.accent : C.muted} /><Text numberOfLines={1} style={[s.tabText, tab === key && s.tabTextActive]}>{label}</Text></Pressable>)}</View>}
      {error ? <Text accessibilityRole="alert" style={[s.error, { marginHorizontal: 20, marginBottom: 10 }]}>{error}</Text> : null}
      <ScrollView ref={scroll} style={s.scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
        {tab === 'profile' && <>
          <View style={s.preview}>
            <View style={[s.halo, { backgroundColor: botColor(form) + '14' }]}><BotAvatar bot={form} size={118} tile={false} /></View>
            <Text style={s.previewName}>{form.name || 'Seu próximo parceiro'}</Text>
          </View>
          {!bot && phone ? <><Text style={s.label}>Começar de um modelo</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }} style={{ marginHorizontal: -20, paddingHorizontal: 20, flexGrow: 0 }}>
              {[{ id: 'blank', label: 'Do zero', hint: 'Você escreve tudo.', profile: { name: '', instructions: '' } }, ...BOT_TEMPLATES].map(template => {
                const chosen = template.id === 'blank' ? !BOT_TEMPLATES.some(item => item.profile.instructions === form.instructions) : form.instructions === template.profile.instructions;
                return <Pressable key={template.id} accessibilityRole="button" onPress={() => setForm(old => { const { browserMode: _mode, ...rest } = old; return { ...rest, ...template.profile }; })} style={[s.template, chosen && s.choiceOn]}>
                  <Icon name={template.id === 'blank' ? 'edit' : template.icon || 'calendar'} size={20} color={chosen ? C.accent : C.muted} /><Text style={s.itemTitle}>{template.label}</Text><Text style={s.hint} numberOfLines={3}>{template.hint}</Text></Pressable>;
              })}
              <View style={{ width: 20 }} />
            </ScrollView></> : null}
          <Text style={s.label}>Nome</Text><TextInput accessibilityLabel="Nome do bot" value={form.name || ''} onChangeText={v => field('name', v)} maxLength={40} placeholder="Como ele vai se chamar?" placeholderTextColor={C.faint} selectionColor={C.accent} style={s.input} />
          <Text style={s.label}>Personalidade e função</Text><TextInput accessibilityLabel="Personalidade e função" value={form.instructions || ''} onChangeText={v => field('instructions', v)} maxLength={2000} multiline placeholder="Ex.: Me ajude com a faculdade. Seja direto, curioso e descontraído." placeholderTextColor={C.faint} selectionColor={C.accent} style={[s.input, s.instructions]} />
          <Text style={s.label}>Inteligência</Text><ModelSettings models={models} connections={connections} selection={form} disabled={saving || active} onChange={(model, reasoningEffort, provider) => setForm(old => ({ ...old, model, reasoningEffort, provider }))} />
          {bot && phone && onFallback && FallbackSettings ? <FallbackSettings models={models} bot={bot} disabled={saving || active} onChange={fallback => act(() => onFallback(fallback))} /> : null}
          <Text style={s.label}>Rosto</Text><FacePicker name={form.name} face={form.face || { seed: (bot?.name || form.name || 'bot').trim(), color: botColor(form) }} onChange={face => field('face', face)} showStage={false} />
          {active && <Text style={s.hint}>Aguarde ou cancele a tarefa para salvar o perfil.</Text>}
          <Pressable accessibilityRole="button" disabled={!canSave} onPress={() => act(() => onSave({ ...form, face: form.face || { seed: (bot?.name || form.name || 'bot').trim() } }))} style={({ pressed }) => [s.primary, !canSave && s.disabled, pressed && s.pressed]}>
            <Icon name={bot ? 'check' : 'spark'} size={19} color={C.accentInk} stroke={2.4} /><Text style={s.primaryText}>{saving ? 'Salvando…' : bot ? 'Salvar alterações' : 'Criar meu bot'}</Text></Pressable>
          {bot && <Pressable accessibilityRole="button" disabled={saving || active} onPress={onDelete} style={s.delete}><Icon name="trash" size={16} color={C.red} /><Text style={s.deleteText}>Apagar bot e conversa</Text></Pressable>}
        </>}
        {tab === 'tools' && <>
          <Text style={s.sectionTitle}>Acesso</Text>
          <Text style={s.hint}>Acesso total por padrão, no celular e no computador. Se algum recurso não estiver disponível, o bot avisa na conversa.</Text>
          <View style={s.group}><View style={[s.permission, { borderBottomWidth: 0 }]}>
            <View style={s.permissionCopy}><Text style={s.itemTitle}>Controlar o celular</Text><Text style={s.hint}>Permite ver a tela e usar os outros apps do celular. Você pode interromper pelo botão Parar.</Text></View>
            {toggle(bot?.phoneControl === true, on => act(() => onPhoneControl(on)), 'Controlar o celular')}
          </View></View>
          {bot?.phoneControl && PhoneControl ? <PhoneControl /> : null}
          <Text style={s.label}>Conta Google</Text>
          <Text style={s.hint}>Gmail, Agenda, Drive e outros serviços abrem direto no navegador. Escolha a conta que este bot deve usar. Se faltar login, ele pede para você entrar.</Text>
          {radio(!bot?.googleAccount, 'Conta já aberta no navegador', '', () => act(() => onGoogleAccount('')), { disabled: saving || active })}
          {[...new Set([...googleAccounts, bot?.googleAccount].filter(Boolean))].map(email => radio(bot?.googleAccount === email, email, '', () => act(() => onGoogleAccount(email)), { disabled: saving || active }))}
          <View style={[s.permission, { borderBottomWidth: 0 }]}>
            <TextInput accessibilityLabel="E-mail de outra conta Google" value={account} onChangeText={setAccount} placeholder="Outra conta Google" placeholderTextColor={C.faint} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" style={[s.input, { flex: 1 }]} />
            <Pressable accessibilityRole="button" disabled={saving || active || !account.trim()} onPress={() => act(async () => { await onGoogleAccount(account.trim().toLowerCase()); setAccount(''); })}><Text style={s.link}>Adicionar</Text></Pressable>
          </View>
          {bot?.googleAccount ? <Pressable accessibilityRole="button" disabled={saving || active} onPress={() => act(() => onGoogleLogin(bot.googleAccount))} style={s.smallButton}><Icon name="globe" size={16} color={C.accent} /><Text style={s.link}>Entrar nesta conta no navegador</Text></Pressable> : null}
          <Text style={s.hint}>Você pode manter várias contas conectadas no mesmo navegador. Os logins do celular e do PC são separados; entre em cada aparelho quando necessário.</Text>
          {onComputer && onAgentSkills ? <>
            <Pressable accessibilityRole="button" onPress={() => setSkillsOpen(value => !value)} style={s.disclosure}><Text style={s.link}>Skills{(bot.skills || []).length ? ` · ${(bot.skills || []).length} ligada${(bot.skills || []).length === 1 ? '' : 's'}` : ''}</Text><Icon name={skillsOpen ? 'down' : 'back'} size={15} color={C.accent} /></Pressable>
            {skillsOpen && <View style={s.group}>
              <Text style={[s.hint, { padding: 14, paddingBottom: 4 }]}>Skills são pastas com instruções e scripts que ficam no computador (as de ~/.claude, ~/.codex e ~/.agents). {bot.name} usa as que você escolher aqui, do mesmo jeito no Claude e no Codex.</Text>
              {catalog === null ? <Text style={[s.hint, { padding: 14 }]}>Procurando no computador…</Text> : catalog.skills.length === 0 ? <Text style={[s.hint, { padding: 14 }]}>{catalog.message || 'Nenhuma skill encontrada no computador.'}</Text> : catalog.skills.map(skill => {
                const mine = (bot.skills || []).find(item => item.path === skill.path);
                return <View key={skill.path} style={[s.permission, { alignItems: 'flex-start' }]}>
                  <View style={s.permissionCopy}><Text style={s.itemTitle}>{skill.name}</Text>{skill.source ? <Text style={[s.hint, { color: C.faint }]}>{skill.source}</Text> : null}<Text style={s.hint} numberOfLines={mine ? undefined : 2}>{skill.description || 'Sem descrição.'}</Text>
                  </View>
                  <Switch accessibilityLabel={`Ligar ${skill.name}`} value={Boolean(mine)} disabled={saving || active} trackColor={{ false: C.line2, true: C.accent + '88' }} thumbColor={mine ? C.accent : C.muted} onValueChange={on => setSkill(skill, on ? {} : null)} />
                </View>;
              })}
            </View>}</> : null}
        </>}
        {tab === 'routines' && <><Text style={s.sectionTitle}>O que {bot?.name} faz sozinho</Text><Text style={s.hint}>Peça na conversa, por exemplo: “todo dia às 8h me resume os e-mails” ou “quando chegar notificação do SIGAA, anote a atividade”. Você pode consultar e pausar as rotinas aqui.</Text>
          {routines.length ? routines.map(item => <View key={item.id} style={s.item}>
            <View style={s.routineHead}><View style={s.itemIcon}><Icon name={item.trigger?.type === 'notification' ? 'bell' : 'clock'} size={17} color={item.enabled ? C.sky : C.faint} /></View><Text style={[s.itemTitle, { flex: 1 }]}>{item.title}</Text>{toggle(item.enabled, enabled => act(() => onRoutine('routine.update', item.id, { enabled })), `Rotina ${item.title} ${item.enabled ? 'ativa' : 'pausada'}`)}</View>
            <Text style={s.routineTrigger}>{item.label}</Text>
            <Pressable accessibilityRole="button" onPress={() => setOpenRoutine(openRoutine === item.id ? null : item.id)}>
              <Text style={s.itemText} numberOfLines={openRoutine === item.id ? undefined : 3}>{item.instructions}</Text>
              <Text style={s.more}>{openRoutine === item.id ? 'Mostrar menos' : 'Ver instruções completas'}</Text>
            </Pressable>
            <Text style={s.hint}>{!item.enabled ? 'Pausada' : item.nextRunAt ? `Próxima: ${when(item.nextRunAt)}` : item.pending ? 'Notificação nova; roda em instantes' : 'Aguardando notificação'}{item.lastRunAt ? ` · Última: ${when(item.lastRunAt)}` : ''}{item.runsToday ? ` · ${item.runsToday} em 24 h` : ''}</Text>
            {item.lastResult ? <Text style={s.result} numberOfLines={3}>{plainText(item.lastResult)}</Text> : null}
            <View style={s.routineActions}><Pressable accessibilityRole="button" disabled={saving || active} onPress={() => act(() => onRoutine('routine.run', item.id))} style={[s.smallButton, active && s.disabled]}><Icon name="play" size={14} color={C.accent} /><Text style={s.link}>Executar agora</Text></Pressable>
              <Pressable accessibilityRole="button" disabled={saving} onPress={() => act(() => onRoutine('routine.delete', item.id))} style={s.smallButton}><Icon name="trash" size={14} color={C.red} /><Text style={s.deleteText}>Apagar</Text></Pressable></View>
          </View>) : <View style={s.emptyBox}><Icon name="bolt" size={26} color={C.faint} /><Text style={s.empty}>Nenhuma rotina ainda. Peça uma na conversa.</Text></View>}
          <Text style={s.hint}>O resultado de cada rotina chega como notificação do MyBots.</Text>
          {skills.length ? <><Text style={s.label}>Habilidades</Text>
            <Text style={s.hint}>Programas que você aprovou. Rodam neste celular, isolados e sem usar a IA: só acessam os sites listados, sem seus arquivos e sem outros programas.</Text>
            {skills.map(skill => <View key={skill.id} style={s.item}>
              <View style={s.routineHead}><View style={s.itemIcon}><Icon name="spark" size={17} color={C.sky} /></View><Text style={[s.itemTitle, { flex: 1 }]}>{skill.title}</Text><Text style={s.hint}>v{skill.version}</Text></View>
              <Text style={s.itemText}>{skill.description}</Text>
              <Text style={s.hint}>{skill.sites?.length ? `Acessa: ${skill.sites.join(', ')}` : 'Não acessa a internet'}</Text>
              <View style={s.routineActions}><Pressable accessibilityRole="button" disabled={saving} onPress={() => act(() => onSkill('skill.run', skill.id))} style={s.smallButton}><Icon name="play" size={14} color={C.accent} /><Text style={s.link}>{saving ? 'Rodando…' : 'Rodar agora'}</Text></Pressable>
                <Pressable accessibilityRole="button" disabled={saving} onPress={() => act(() => onSkill('skill.remove', skill.id))} style={s.smallButton}><Icon name="trash" size={14} color={C.red} /><Text style={s.deleteText}>Remover</Text></Pressable></View>
            </View>)}</> : null}</>}
        {tab === 'negotiate' && bot && <NegotiationPanel bot={bot} negotiations={negotiations} onNegotiation={onNegotiation} disabled={saving} />}
        {tab === 'memory' && <><Text style={s.sectionTitle}>O que {bot?.name} guardou</Text><Text style={s.hint}>Estas lembranças pertencem somente a este bot.</Text>
          {memories.length ? memories.map(item => <View key={item.id} style={s.item}><Text style={s.itemTitle}>{item.key}</Text><Text selectable style={s.itemText}>{item.text}</Text></View>) : <View style={s.emptyBox}><Icon name="memory" size={26} color={C.faint} /><Text style={s.empty}>Nenhuma lembrança ainda. Peça para o bot guardar algo.</Text></View>}
          <Text style={s.label}>Pendências</Text>
          {items.length ? items.map(item => <View key={item.id} style={[s.item, item.state === 'done' && { opacity: 0.55 }]}>
            <View style={s.routineHead}><View style={[s.check, item.state === 'done' && s.checkDone]}>{item.state === 'done' ? <Icon name="check" size={13} color={C.accentInk} stroke={3} /> : null}</View><Text style={[s.itemTitle, { flex: 1 }]}>{item.course ? `${item.course} · ` : ''}{item.title}</Text></View>
            {item.dueLabel ? <Text style={s.routineTrigger}>Prazo {item.dueLabel}</Text> : null}{item.details ? <Text style={s.itemText}>{item.details}</Text> : null}{item.source ? <Text style={s.hint}>Fonte: {item.source}</Text> : null}
            {item.state === 'open' && <Pressable accessibilityRole="button" disabled={saving} onPress={() => act(() => onComplete(item.id))} style={s.smallButton}><Icon name="check" size={14} color={C.accent} /><Text style={s.link}>Marcar como concluída</Text></Pressable>}</View>)
            : <View style={s.emptyBox}><Icon name="list" size={26} color={C.faint} /><Text style={s.empty}>As pendências criadas pelo bot aparecem aqui.</Text></View>}</>}
      </ScrollView>
    </View>);
}
const boxOf = () => ({ backgroundColor: C.surface, borderRadius: 20, borderWidth: 1, borderColor: C.line });
const s = themed(() => ({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#000000B3', ...dialogBackdrop }, keyboard: { height: '92%', ...column, ...(dialogShape.borderRadius ? { height: '100%', maxHeight: 900 } : {}) },
  sheet: { flex: 1, backgroundColor: C.bg2, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 20, paddingBottom: 20, borderTopWidth: 1, borderColor: C.line2, ...dialogShape, ...(dialogShape.borderRadius ? { paddingTop: 20 } : {}) },
  inlineSheet: { borderRadius: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0, borderWidth: 0, borderTopWidth: 0, paddingTop: 14, paddingHorizontal: 16 },
  handle: { alignSelf: 'center', width: 42, height: 5, backgroundColor: C.line2, borderRadius: 3, marginTop: 10, marginBottom: 12, ...noHandle },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  title: { color: C.text, fontFamily: F.x, fontSize: 23, letterSpacing: -0.7 }, subtitle: { color: C.muted, fontFamily: F.m, fontSize: 13, marginTop: 2 },
  close: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center', borderRadius: 14, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line },
  tabs: { flexDirection: 'row', gap: 4, backgroundColor: C.surface, borderRadius: 18, padding: 4, marginBottom: 12, borderWidth: 1, borderColor: C.line },
  tab: { flex: 1, minWidth: 0, flexDirection: 'column', gap: 3, paddingVertical: 8, paddingHorizontal: 2, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  tabActive: { backgroundColor: C.elevated }, tabText: { color: C.muted, fontFamily: F.s, fontSize: 11.5 }, tabTextActive: { color: C.text, fontFamily: F.b },
  scroll: { flex: 1 }, content: { paddingBottom: 30 },
  pressed: { opacity: 0.75 },
  preview: { alignItems: 'center', gap: 6, marginTop: 4, marginBottom: 6 },
  halo: { width: 160, height: 160, borderRadius: 80, alignItems: 'center', justifyContent: 'center' },
  previewName: { color: C.text, fontFamily: F.x, fontSize: 25, letterSpacing: -0.7 },
  hint: { color: C.muted, fontFamily: F.m, fontSize: 12.5, lineHeight: 19 },
  sectionName: { color: C.text2, fontFamily: F.b, fontSize: 14, marginTop: 22, marginBottom: 2 },
  label: { color: C.text2, fontFamily: F.b, fontSize: 15, marginTop: 24, marginBottom: 10 },
  template: { ...boxOf(), width: 150, padding: 14, gap: 6 },
  forms: { flexDirection: 'row', gap: 8 },
  formOption: { ...boxOf(), flex: 1, alignItems: 'center', paddingVertical: 12, gap: 6 },
  formName: { color: C.text2, fontFamily: F.s, fontSize: 11.5 },
  colors: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, paddingTop: 16 },
  swatchRing: { padding: 3, borderRadius: 24, borderWidth: 2, borderColor: 'transparent' },
  swatch: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  input: { backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.line2, color: C.text, fontFamily: F.m, paddingHorizontal: 15, paddingVertical: 13, minHeight: 52, fontSize: 15 },
  instructions: { minHeight: 110, textAlignVertical: 'top', lineHeight: 21 },
  choice: { ...boxOf(), flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 15, marginBottom: 9 },
  choiceOn: { borderColor: C.accent + '70', backgroundColor: C.accent + '0C' }, choiceWarn: { borderColor: C.peach + '80', backgroundColor: C.peach + '0D' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: C.line2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  radioOn: { borderColor: C.accent }, radioWarn: { borderColor: C.peach }, radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.accent },
  primary: { minHeight: 54, flexDirection: 'row', gap: 8, backgroundColor: C.accent, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  primaryText: { color: C.accentInk, fontFamily: F.x, fontSize: 15.5 }, disabled: { opacity: 0.35 },
  delete: { flexDirection: 'row', gap: 7, minHeight: 50, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  deleteText: { color: C.red, fontFamily: F.b, fontSize: 13 }, error: { color: C.red, fontFamily: F.m, fontSize: 13, marginTop: 10 },
  sectionTitle: { color: C.text, fontFamily: F.x, fontSize: 21, letterSpacing: -0.5, lineHeight: 27, marginTop: 6, marginBottom: 10 },
  disclosure: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 46 },
  group: { ...boxOf(), overflow: 'hidden' },
  permission: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: C.line, paddingVertical: 14, paddingHorizontal: 14, gap: 12 },
  permissionCopy: { flex: 1, gap: 4 },
  stateTag: { alignSelf: 'flex-start', fontFamily: F.b, fontSize: 10.5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: 'hidden', marginTop: 2 },
  stateAllow: { color: C.accent, backgroundColor: C.accent + '17' }, stateAsk: { color: C.amber, backgroundColor: C.amber + '17' }, stateDeny: { color: C.muted, backgroundColor: C.surface2 },
  itemTitle: { color: C.text, fontFamily: F.b, fontSize: 14.5 },
  itemText: { color: C.text2, fontFamily: F.r, fontSize: 14, lineHeight: 21, marginTop: 6 },
  itemIcon: { width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: C.sky + '14' },
  security: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', backgroundColor: C.accent + '0C', padding: 16, borderRadius: 20, marginTop: 20, borderWidth: 1, borderColor: C.accent + '22' },
  item: { ...boxOf(), padding: 15, marginTop: 11, gap: 2 },
  result: { color: C.text2, fontFamily: F.m, fontSize: 12.5, lineHeight: 18, marginTop: 8, padding: 10, borderRadius: 12, backgroundColor: C.surface2 },
  emptyBox: { ...boxOf(), alignItems: 'center', gap: 8, paddingVertical: 26, paddingHorizontal: 20, marginTop: 12, borderStyle: 'dashed' },
  empty: { color: C.muted, fontFamily: F.m, fontSize: 13.5, lineHeight: 20, textAlign: 'center' },
  smallButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, marginTop: 6 },
  link: { color: C.accent, fontFamily: F.b, fontSize: 13 }, more: { color: C.muted, fontFamily: F.s, fontSize: 12, marginTop: 4 },
  routineHead: { flexDirection: 'row', alignItems: 'center', gap: 10 }, routineTrigger: { color: C.sky, fontFamily: F.s, fontSize: 12.5, marginTop: 8 },
  routineActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  check: { width: 22, height: 22, borderRadius: 7, borderWidth: 2, borderColor: C.line2, alignItems: 'center', justifyContent: 'center' }, checkDone: { backgroundColor: C.accent, borderColor: C.accent }
}));
