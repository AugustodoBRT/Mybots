import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, AppState } from 'react-native';
import { styles } from '../styles';
import { C, Icon } from '../theme';
import { embeddedEnabled, embeddedSupported, keepAliveStatus, setKeepAlive, openPowerSettings, botNotificationStatus, notificationPermission, openNotificationSettings, notificationAccess, openNotificationAccess, openAppSettings } from '../native';
import { PrimaryButton, PhoneControlAccess, PhonePermissions, WidgetRow } from './shared';
import { EmbeddedConnect } from './EmbeddedConnect';

function Step({ number, title, done, children }) {
  return <View style={styles.modeOption}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={styles.rowIcon}>{done ? <Icon name="check" size={17} color={C.good} /> : <Text style={styles.optionLabel}>{number}</Text>}</View>
      <Text style={[styles.optionLabel, { flex: 1 }]}>{title}{done === undefined ? '' : done ? ' · Pronto' : ' · Falta'}</Text>
    </View>
    {children}
  </View>;
}
const Detail = ({ children }) => <Text style={[styles.optionDetail, { marginTop: 8 }]}>{children}</Text>;
const Action = ({ title, onPress }) => <Pressable accessibilityRole="button" onPress={onPress} style={{ marginTop: 10 }}><Text style={styles.deleteText}>{title}</Text></Pressable>;

/**
 * Ajustes → Celular: everything it takes to run MyBots with the phone alone, in order. Each step reads the phone's real state
 * (and again when the person comes back from Android's screens) and has the button that opens the right place.
 */
export function PhoneSetup({ data, remote, busy, error, onEmbedded, onCreate, reload }) {
  const [alive, setAlive] = useState(null); const [notices, setNotices] = useState(null); const [listener, setListener] = useState(null);
  const check = useCallback(() => {
    keepAliveStatus().then(setAlive).catch(() => setAlive(null));
    botNotificationStatus().then(setNotices).catch(() => setNotices(null));
    notificationAccess().then(setListener).catch(() => setListener(null));
  }, []);
  useEffect(() => {
    check();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') check(); });
    return () => subscription.remove();
  }, [check]);

  const here = embeddedEnabled() && !remote;
  const connected = here && Object.values(data?.connections || {}).some(item => item?.loggedIn);
  const bots = (data?.bots || []).filter(bot => !bot.deletedAt).length;
  const noticesOk = Boolean(notices?.enabled && !notices.channelBlocked);
  const aliveOk = Boolean(alive?.enabled && alive.batteryUnrestricted && alive.exactAlarms && !alive.backgroundRestricted);
  const done = [here, connected, here && bots > 0, noticesOk, aliveOk].filter(Boolean).length;
  const open = target => openPowerSettings(target).then(check).catch(() => {});

  return <View>
    <Text style={[styles.optionDetail, { marginBottom: 12 }]}>Os bots rodando só no celular, sem computador. {done} de 5 passos prontos; esta tela confere sozinha quando você volta das configurações do Android.</Text>

    <Step number={1} title="Rodar tudo neste celular" done={here}>
      {here ? <Detail>Os bots rodam dentro do app.</Detail> : embeddedSupported() ? <>
        <Detail>Na primeira vez a preparação leva alguns minutos. Deixe o app aberto e use Wi-Fi. Não precisa instalar outro aplicativo.</Detail>
        <PrimaryButton icon="phone" title={busy ? 'Preparando…' : 'Usar neste celular'} disabled={busy} onPress={onEmbedded} style={{ marginTop: 10 }} />
        {error ? <Detail>{error}</Detail> : null}
      </> : <Detail>Este celular não é compatível: é preciso Android 14 ou mais novo e processador ARM de 64 bits.</Detail>}
    </Step>

    <Step number={2} title="Baixar e conectar uma IA" done={Boolean(connected)}>
      <Detail>Basta uma, com a assinatura que você já tem (Claude, ChatGPT ou Google). Toque em Conectar: o app baixa a IA do fabricante e abre a página de login. Se a página mostrar um código, cole no campo que aparece.</Detail>
      {here ? <View style={{ marginTop: 10 }}><EmbeddedConnect connections={data?.connections} reload={reload} /></View> : <Detail>Faça o passo 1 primeiro.</Detail>}
    </Step>

    <Step number={3} title="Criar o seu Chefe" done={here && bots > 0}>
      <Detail>É o primeiro bot: você pede e ele faz ou chama quem sabe. Depois crie um para cada assunto. A IA e o modelo se escolhem no alto da conversa.</Detail>
      {here && !bots ? <Action title="Criar o Chefe" onPress={onCreate} /> : null}
    </Step>

    <Step number={4} title="Receber os avisos dos bots" done={noticesOk}>
      <Detail>Libere as notificações do MyBots.</Detail>
      {noticesOk ? null : <Action title="Liberar notificações" onPress={() => notificationPermission().then(() => openNotificationSettings()).then(check).catch(() => {})} />}
    </Step>

    <Step number={5} title="Funcionar com a tela apagada" done={aliveOk}>
      <Detail>Sem isso o Android pausa o app, e rotinas e avisos atrasam.</Detail>
      {!alive ? <Detail>Não consegui ler o estado do celular.</Detail> : <>
        {!alive.enabled ? <Action title="Ligar o funcionamento com a tela apagada" onPress={() => setKeepAlive(true).then(setAlive).catch(() => {})} /> : <Detail>✓  Serviço ligado</Detail>}
        <Detail>{alive.batteryUnrestricted ? '✓' : '!'}  Bateria do MyBots sem restrições</Detail>
        {alive.batteryUnrestricted ? null : <Action title="Liberar a bateria" onPress={() => open('battery')} />}
        <Detail>{alive.exactAlarms ? '✓' : '!'}  Alarmes no horário exato</Detail>
        {alive.exactAlarms ? null : <Action title="Permitir alarmes" onPress={() => open('exactAlarm')} />}
        <Detail>{!alive.backgroundRestricted ? '✓' : '!'}  Atividade em segundo plano</Detail>
        {alive.backgroundRestricted ? <Action title="Abrir informações do app" onPress={() => open('details')} /> : null}
        {alive.xiaomi ? <>
          <Detail>Seu celular tem duas travas a mais (o app não consegue ler se estão ligadas): em Economia de bateria escolha Sem restrições, e ligue o Início automático.</Detail>
          <Action title="Abrir a economia de bateria" onPress={() => open('hyperosBattery')} />
          <Action title="Abrir o Início automático" onPress={() => open('autostart')} />
        </> : <>
          <Detail>Muitos celulares têm uma economia de bateria própria. Nas informações do app, em Bateria, escolha a opção sem restrições e tire o MyBots de listas de apps em repouso.</Detail>
          <Action title="Abrir informações do app" onPress={() => open('details')} />
        </>}
      </>}
    </Step>

    <Text style={[styles.optionLabel, { marginTop: 8, marginBottom: 8 }]}>Opcional, só se você quiser</Text>

    <Step number={6} title="Bots lerem as notificações do celular" done={Boolean(listener)}>
      <Detail>Para perceberem e-mails e mensagens quando chegam. Cada bot só lê se você permitir no perfil dele.</Detail>
      {listener ? null : <>
        <Detail>Se aparecer “Configuração restrita” (comum em app instalado fora da loja): abra as informações do app, toque nos três pontos (⋮), escolha “Permitir configurações restritas” e tente de novo.</Detail>
        <Action title="Ativar acesso a notificações" onPress={() => openNotificationAccess().catch(() => {})} />
        <Action title="Abrir informações do app" onPress={() => openAppSettings('com.mybots.app').catch(() => {})} />
      </>}
    </Step>

    <Step number={7} title="Bots usarem outros apps, SMS, contatos e localização">
      <PhoneControlAccess />
      <PhonePermissions />
    </Step>

    <WidgetRow />

    <Step number={8} title="Se o MyBots continuar parando sozinho">
      <Detail>Só neste caso. Ative as Opções do desenvolvedor (Configurações → Sobre o telefone → toque 7 vezes no número da versão ou compilação). Lá, procure “Desativar restrições de processos filhos” e ligue. O nome e o lugar mudam um pouco de um celular para outro.</Detail>
    </Step>
  </View>;
}
