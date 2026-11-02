import { useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { C } from '../theme';
import { styles } from '../styles';
import { PrimaryButton } from './shared';

export function GoogleAccounts({ accounts = [], bots = [], busy, onAdd, onLogin }) {
  const [email, setEmail] = useState(''); const [botId, setBotId] = useState(null); const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const target = bots.find(bot => bot.id === botId) || bots[0];
  const act = async action => { setSaving(true); setError(''); try { await action(); } catch (failure) { setError(failure.message); } finally { setSaving(false); } };
  return <View style={styles.modeOption}>
    <Text style={styles.optionLabel}>Contas Google no navegador</Text>
    <Text style={styles.optionDetail}>Os bots usam Gmail, Agenda e Drive diretamente nos sites. Adicione os e-mails aqui e escolha uma conta no perfil de cada bot. A lista guarda sua escolha; o login é feito por você no navegador.</Text>
    {accounts.map(account => <View key={account} style={{ marginTop: 14, gap: 6 }}><Text style={styles.optionLabel}>{account}</Text>
      {target ? <Pressable accessibilityRole="button" disabled={busy || saving} onPress={() => act(() => onLogin(target.id, account))}><Text style={styles.deleteText}>Entrar no navegador</Text></Pressable> : null}</View>)}
    <TextInput accessibilityLabel="Adicionar conta Google" style={styles.formInput} placeholder="seu@gmail.com" placeholderTextColor={C.faint} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" value={email} onChangeText={setEmail} />
    <PrimaryButton tone="ghost" title="Adicionar conta Google" disabled={busy || saving || !email.trim()} onPress={() => act(async () => { await onAdd(email.trim().toLowerCase()); setEmail(''); })} />
    {accounts.length && bots.length > 1 ? <><Text style={styles.optionDetail}>Abrir o navegador de:</Text>{bots.map(bot => <Pressable key={bot.id} accessibilityRole="radio" accessibilityState={{ selected: target?.id === bot.id }} disabled={saving} onPress={() => setBotId(bot.id)}><Text style={[styles.deleteText, target?.id === bot.id && { color: C.text }]}>{target?.id === bot.id ? '● ' : '○ '}{bot.name}</Text></Pressable>)}</> : null}
    <Text style={styles.optionDetail}>Você pode conectar mais de uma conta sem sair das outras. O celular e o PC mantêm seus próprios logins.</Text>
    {error ? <Text style={[styles.optionDetail, { color: C.red }]}>{error}</Text> : null}
  </View>;
}
