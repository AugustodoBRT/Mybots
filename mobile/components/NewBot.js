import { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, ScrollView } from 'react-native';
import { C, Icon, F, themed } from '../theme';
import { IconButton, ModelSettings, PrimaryButton } from './shared';
import { ACCESS, HOMES, useKeyboardRoom } from '../BotProfile';
import { BOT_TEMPLATES } from '../bot-templates';
import { FacePicker } from './FacePicker';
import { botColor } from '../../lib/face.mjs';
import { desktop } from '../desktop';

// On the computer the steps stay in a column about as wide as a phone.
const column = desktop ? { width: '100%', maxWidth: 680, alignSelf: 'center' } : {};

const STEPS = ['Rosto', 'Jeito e acesso', 'Primeira mensagem'];
const GREETINGS = ['Oi! Vamos nos conhecer?', 'O que você consegue fazer por mim?'];
const s = themed(() => ({
  backdrop: { flex: 1, backgroundColor: C.bg },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 44, paddingBottom: 6 },
  title: { color: C.text, fontFamily: F.x, fontSize: 22, letterSpacing: -0.6 },
  step: { color: C.muted, fontFamily: F.m, fontSize: 13.5, marginTop: 1 },
  bar: { flexDirection: 'row', gap: 6, paddingHorizontal: 20, marginTop: 8, marginBottom: 6 },
  barPart: { flex: 1, height: 4, borderRadius: 2, backgroundColor: C.line2 },
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  label: { color: C.text2, fontFamily: F.b, fontSize: 15, marginTop: 24, marginBottom: 10 },
  input: { minHeight: 52, borderRadius: 16, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line, color: C.text, fontFamily: F.m, fontSize: 16, paddingHorizontal: 16, paddingVertical: 12 },
  area: { minHeight: 120, textAlignVertical: 'top' },
  chips: { gap: 8, paddingRight: 8 },
  chip: { paddingHorizontal: 14, minHeight: 40, justifyContent: 'center', borderRadius: 20, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line },
  chipOn: { borderColor: C.accent, backgroundColor: C.accent + '22' },
  chipText: { color: C.text2, fontFamily: F.m, fontSize: 14 },
  choice: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: C.line },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: C.line2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  radioOn: { borderColor: C.accent }, radioWarn: { borderColor: C.peach },
  dotOn: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.accent },
  choiceTitle: { color: C.text, fontFamily: F.b, fontSize: 16 },
  hint: { color: C.muted, fontFamily: F.m, fontSize: 13.5, lineHeight: 20, marginTop: 2 },
  error: { color: C.red, fontFamily: F.m, fontSize: 14, marginTop: 14 }
}));

/**
 * Creating a bot in three steps: its face (Sortear or Montar), how it behaves and what it may do, and the first message.
 * The buttons sit at the end of each step, never over the options.
 */
export function NewBot({ visible, models, defaultSelection, connections, nodes = [], phone, freeChoice, onClose, onCreate }) {
  const [step, setStep] = useState(0); const [name, setName] = useState(''); const [face, setFace] = useState(null); const [instructions, setInstructions] = useState('');
  const [selection, setSelection] = useState({}); const [home, setHome] = useState('phone'); const [access, setAccess] = useState('ask'); const [first, setFirst] = useState(GREETINGS[0]);
  const [template, setTemplate] = useState(null); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const scroll = useRef(null); const keyboard = useKeyboardRoom(scroll);
  useEffect(() => { if (visible) { setStep(0); setName(''); setFace(null); setInstructions(''); setSelection({ ...defaultSelection }); setHome('phone'); setAccess('ask'); setFirst(GREETINGS[0]); setTemplate(null); setSaving(false); setError(''); } }, [visible]);
  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); }, [step]);
  const levels = ACCESS.filter(([key]) => key !== 'free' || freeChoice);
  const useTemplate = item => { setTemplate(item.id); setInstructions(item.profile.instructions); if (!name.trim()) setName(item.profile.name); if (item.profile.access) setAccess(item.profile.access); if (item.profile.home) setHome(item.profile.home); };
  const finish = async () => {
    setSaving(true); setError('');
    const seed = face?.seed || name.trim();
    const profile = BOT_TEMPLATES.find(item => item.id === template)?.profile || {};
    try {
      await onCreate({ ...profile, name: name.trim(), instructions: instructions.trim(), color: 'green', avatar: 'orbit', autonomy: 'ask', access: access === 'free' ? 'ask' : access, home, ...selection,
        face: { seed, color: face?.color || botColor({ name: name.trim(), face: { seed } }), ...(face?.pieces ? { pieces: face.pieces } : {}) } }, { first: first.trim(), free: access === 'free' });
    } catch (failure) { setError(failure.message || 'Não deu para criar o bot.'); setSaving(false); }
  };
  const radio = (selected, title, detail, onPress, warn) => <Pressable key={title} accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress} style={s.choice}>
    <View style={[s.radio, selected && (warn ? s.radioWarn : s.radioOn)]}>{selected ? <View style={[s.dotOn, warn && { backgroundColor: C.peach }]} /> : null}</View>
    <View style={{ flex: 1 }}><Text style={s.choiceTitle}>{title}</Text>{detail ? <Text style={s.hint}>{detail}</Text> : null}</View>
  </Pressable>;
  const ready = [name.trim().length > 0, Boolean(selection.model), true];
  return <Modal visible={visible} animationType="slide" onRequestClose={() => (step ? setStep(step - 1) : onClose())}>
    <View style={[s.backdrop, { paddingBottom: keyboard }]}>
      <View style={[s.head, column]}>
        <IconButton icon={step ? 'back' : 'close'} label={step ? 'Voltar ao passo anterior' : 'Cancelar'} onPress={() => (step ? setStep(step - 1) : onClose())} size={42} />
        <View style={{ flex: 1 }}><Text style={s.title}>Novo bot</Text><Text style={s.step}>Passo {step + 1} de 3 · {STEPS[step]}</Text></View>
      </View>
      <View style={[s.bar, column]}>{STEPS.map((label, index) => <View key={label} style={[s.barPart, index <= step && { backgroundColor: C.accent }]} />)}</View>
      <ScrollView ref={scroll} contentContainerStyle={[s.content, column]} keyboardShouldPersistTaps="handled">
        {step === 0 ? <>
          <Text style={s.label}>Nome</Text>
          <TextInput accessibilityLabel="Nome do bot" value={name} onChangeText={setName} maxLength={40} placeholder="Como ele vai se chamar?" placeholderTextColor={C.faint} selectionColor={C.accent} style={s.input} />
          <FacePicker name={name} face={face} onChange={setFace} />
          <PrimaryButton icon="right" title="Continuar" disabled={!ready[0]} onPress={() => setStep(1)} style={{ marginTop: 24 }} />
        </> : null}
        {step === 1 ? <>
          {phone ? <><Text style={s.label}>Começar de um modelo</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
              {[{ id: null, label: 'Do zero' }, ...BOT_TEMPLATES].map(item => <Pressable key={item.label} accessibilityRole="radio" accessibilityState={{ selected: template === item.id }} onPress={() => (item.id ? useTemplate(item) : (setTemplate(null), setInstructions('')))} style={[s.chip, template === item.id && s.chipOn]}>
                <Text style={[s.chipText, template === item.id && { color: C.accent }]}>{item.label}</Text></Pressable>)}
            </ScrollView></> : null}
          <Text style={s.label}>Personalidade e função</Text>
          <TextInput accessibilityLabel="Personalidade e função" value={instructions} onChangeText={setInstructions} maxLength={2000} multiline placeholder="Ex.: Me ajude com a faculdade. Seja direto, curioso e descontraído." placeholderTextColor={C.faint} selectionColor={C.accent} style={[s.input, s.area]} />
          <Text style={s.label}>Inteligência</Text>
          <ModelSettings models={models} connections={connections} selection={selection} disabled={saving} onChange={(model, reasoningEffort, provider) => setSelection(old => ({ ...old, model, reasoningEffort, provider }))} />
          {phone ? <><Text style={s.label}>Onde ele vive</Text>{HOMES.map(([key, title, detail]) => radio(home === key, title, detail, () => setHome(key)))}
            {home !== 'phone' && !nodes.length ? <Text style={s.hint}>Nenhum computador conectado ainda. Até ele chegar, {home === 'pc' ? 'as mensagens para este bot ficam esperando' : 'este bot trabalha no celular'}.</Text> : null}</> : null}
          {phone ? <><Text style={s.label}>Nível de acesso</Text>{levels.map(([key, title, detail]) => radio(access === key, title, detail, () => setAccess(key), key === 'full' || key === 'free'))}
            <Text style={s.hint}>Dá para mudar depois, no perfil do bot.{access === 'free' ? ' O aviso do nível Livre aparece quando o bot for criado.' : ''}</Text></> : null}
          <PrimaryButton icon="right" title="Continuar" disabled={!ready[1]} onPress={() => setStep(2)} style={{ marginTop: 24 }} />
        </> : null}
        {step === 2 ? <>
          <Text style={s.label}>O que você quer dizer a {name.trim() || 'ele'} primeiro?</Text>
          <TextInput accessibilityLabel="Primeira mensagem" value={first} onChangeText={setFirst} maxLength={2000} multiline placeholder="Escreva a primeira mensagem" placeholderTextColor={C.faint} selectionColor={C.accent} style={[s.input, s.area]} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[s.chips, { marginTop: 12 }]}>
            {GREETINGS.map(text => <Pressable key={text} accessibilityRole="button" onPress={() => setFirst(text)} style={[s.chip, first === text && s.chipOn]}><Text style={[s.chipText, first === text && { color: C.accent }]}>{text}</Text></Pressable>)}
          </ScrollView>
          <Text style={s.hint}>A mensagem fica pronta no campo da conversa; você envia quando quiser.</Text>
          {error ? <Text style={s.error}>{error}</Text> : null}
          <PrimaryButton icon="spark" title={saving ? 'Criando…' : 'Criar e conversar'} disabled={saving || !ready[0] || !ready[1]} onPress={finish} style={{ marginTop: 24 }} />
        </> : null}
      </ScrollView>
    </View>
  </Modal>;
}
