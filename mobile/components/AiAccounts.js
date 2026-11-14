import { useState } from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import { styles } from '../styles';
import { C, Icon } from '../theme';
import { copyText } from '../native';
import { PrimaryButton, PROVIDER_NAMES } from './shared';
import { DEFAULT_ACCOUNT } from '../ai-accounts';

const PROVIDERS = ['codex', 'claude', 'agy', 'opencode'];

/**
 * Settings → Contas de IA: the logins of each IA on each device (this phone, the computer). The IA's own login is the main account;
 * more can be added (two Claude, two Codex...) and a bot picks one in its profile. Logging in happens in a terminal of the device
 * (the app shows the exact command), then "Verificar" reads who is logged in.
 */
export function AiAccounts({ aiAccounts, call, reload }) {
  const devices = [['here', aiAccounts?.here], ['computer', aiAccounts?.computer]].filter(([, device]) => device);
  const [busy, setBusy] = useState(false); const [note, setNote] = useState('');
  const [adding, setAdding] = useState(null);   // { where, provider, label }
  const [command, setCommand] = useState(null); // { where, provider, id, text }
  const run = async (work, success) => {
    setBusy(true); setNote('');
    try { const result = await work(); await reload(); if (success) setNote(success); return result; }
    catch (error) { setNote(error.message || 'Não consegui concluir.'); return null; }
    finally { setBusy(false); }
  };
  const act = (where, op, params = {}) => call('ai.accounts', { where, op, ...params });
  if (!devices.length) return <View style={styles.modeOption}><Text style={styles.optionLabel}>Contas de IA</Text>
    <Text style={styles.optionDetail}>Conecte o computador (ou use o MyBots deste celular) para ver e adicionar contas. Cada aparelho guarda os próprios logins.</Text></View>;

  return <View>
    <Text style={[styles.optionDetail, { marginBottom: 6 }]}>Use mais de uma conta da mesma IA, por exemplo dois Claude ou dois Codex. Cada bot escolhe a conta no próprio perfil. Os logins ficam no aparelho onde você entrou e nunca são copiados.</Text>
    {devices.map(([where, device]) => <View key={where} style={[styles.modeOption, { marginTop: 12 }]}>
      <Text style={styles.optionLabel}>{device.name}</Text>
      {PROVIDERS.filter(provider => device.accounts?.[provider]).map(provider => <View key={provider} style={{ marginTop: 12 }}>
        <Text style={[styles.limitName, { marginBottom: 4 }]}>{PROVIDER_NAMES[provider]}</Text>
        {device.accounts[provider].map(item => <View key={item.id} style={{ paddingVertical: 6 }}>
          <View style={styles.passwordRow}>
            <View style={styles.rowIcon}><Icon name="user" size={16} color={item.loggedIn ? C.accent : C.faint} /></View>
            <View style={{ flex: 1 }}><Text style={styles.limitName}>{item.label}</Text>
              <Text style={styles.limitMeta}>{item.loggedIn ? 'Conectada' : item.default ? 'Sem login' : 'Aguardando o login'}</Text></View>
          </View>
          {item.default ? null : <View style={{ flexDirection: 'row', gap: 14, flexWrap: 'wrap', marginTop: 4 }}>
            {item.loggedIn ? null : <Pressable accessibilityRole="button" disabled={busy} onPress={async () => { const result = await run(() => act(where, 'command', { provider, id: item.id })); if (result?.command) setCommand({ where, provider, id: item.id, text: result.command }); }} style={styles.stopButton}><Icon name="bolt" size={13} color={C.accent} /><Text style={[styles.stopText, { color: C.accent }]}>Como entrar</Text></Pressable>}
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => run(() => act(where, 'verify', { provider }), 'Logins conferidos.')} style={styles.stopButton}><Icon name="refresh" size={13} color={C.muted} /><Text style={styles.stopText}>Verificar</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => run(() => act(where, 'remove', { provider, id: item.id }), `${item.label} removida.`).then(() => setCommand(null))} style={styles.stopButton}><Icon name="trash" size={13} color={C.muted} /><Text style={styles.stopText}>Remover</Text></Pressable>
          </View>}
          {command && command.where === where && command.provider === provider && command.id === item.id ? <View style={{ marginTop: 8 }}>
            <Text style={styles.optionDetail}>{where === 'here' ? 'Abra o terminal deste celular, cole este comando e entre na conta' : 'Abra um terminal no computador, cole este comando e entre na conta'}. Depois toque em Verificar.</Text>
            <Text selectable style={[styles.optionDetail, { fontFamily: 'monospace', color: C.text, backgroundColor: C.surface2, padding: 10, borderRadius: 10, marginTop: 6 }]}>{command.text}</Text>
            <Pressable accessibilityRole="button" onPress={() => copyText(command.text).then(() => setNote('Comando copiado.')).catch(() => {})} style={[styles.stopButton, { marginTop: 8 }]}><Icon name="copy" size={13} color={C.accent} /><Text style={[styles.stopText, { color: C.accent }]}>Copiar o comando</Text></Pressable>
            {provider === 'agy' ? <Text style={[styles.optionDetail, { marginTop: 6 }]}>Antigravity: o login de contas extras é experimental.</Text> : null}
          </View> : null}
        </View>)}
        {adding && adding.where === where && adding.provider === provider ? <View style={{ marginTop: 8 }}>
          <TextInput accessibilityLabel="Nome da conta" value={adding.label} onChangeText={label => setAdding({ ...adding, label })} maxLength={40} placeholder="Nome da conta, por exemplo Trabalho" placeholderTextColor={C.faint} style={styles.formInput} />
          <View style={{ flexDirection: 'row', gap: 14, marginTop: 8 }}>
            <PrimaryButton compact icon="plus" title="Criar conta" disabled={busy || !adding.label.trim()} onPress={async () => {
              const result = await run(() => act(where, 'add', { provider, label: adding.label }));
              if (result?.account) { setCommand({ where, provider, id: result.account.id, text: result.command }); setAdding(null); }
            }} style={{ flex: 1 }} />
            <Pressable accessibilityRole="button" onPress={() => setAdding(null)} style={styles.stopButton}><Text style={styles.stopText}>Cancelar</Text></Pressable>
          </View>
        </View> : <Pressable accessibilityRole="button" disabled={busy} onPress={() => { setNote(''); setAdding({ where, provider, label: '' }); }} style={[styles.stopButton, { marginTop: 6 }]}><Icon name="plus" size={13} color={C.accent} /><Text style={[styles.stopText, { color: C.accent }]}>Adicionar conta de {PROVIDER_NAMES[provider]}</Text></Pressable>}
      </View>)}
    </View>)}
    {note ? <Text style={[styles.optionDetail, { marginTop: 10, color: /não|já|erro|Escolha|Dê|até/i.test(note) ? C.amber : C.accent }]}>{note}</Text> : null}
  </View>;
}
