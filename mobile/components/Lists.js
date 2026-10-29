import { Modal, View, ScrollView, Text, Pressable } from 'react-native';
import { styles } from '../styles';
import { C, Icon, F, themed } from '../theme';
import { SheetHeader, Avatar } from './shared';
import { describeTrigger } from '../routine-text';

const r = themed(() => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.line },
  title: { color: C.text, fontFamily: F.b, fontSize: 16 },
  detail: { color: C.muted, fontFamily: F.m, fontSize: 14, lineHeight: 20 }
}));
const NEGOTIATION_STATUS = { active: 'em andamento', awaiting_you: 'espera você', closed: 'encerrada', cancelled: 'cancelada', expired: 'vencida' };

/** Every bot's routines in one list; a row opens that bot's profile on the routines tab. */
export function RoutinesSheet({ visible, routines = [], bots = [], onClose, onOpen }) {
  const rows = routines.filter(item => bots.some(bot => bot.id === item.botId));
  return <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
    <View style={styles.sheetBackdrop}><View style={[styles.sheet, styles.sheetTall]}>
      <View style={styles.sheetHandle} />
      <SheetHeader title="Rotinas" subtitle="O que cada bot faz sozinho, no horário ou quando algo chega." onClose={onClose} />
      <ScrollView style={styles.sheetOptions} contentContainerStyle={{ paddingBottom: 18 }}>
        {rows.length ? rows.map(item => { const bot = bots.find(entry => entry.id === item.botId);
          return <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.title}, de ${bot.name}`} onPress={() => { onClose(); onOpen(bot, 'routines'); }} style={({ pressed }) => [r.row, pressed && { opacity: 0.7 }]}>
            <Avatar bot={bot} size={40} animated={false} />
            <View style={{ flex: 1 }}><Text style={r.title} numberOfLines={1}>{item.title}</Text><Text style={r.detail} numberOfLines={2}>{bot.name} · {item.enabled ? describeTrigger(item.trigger) : 'desligada'}</Text></View>
            <Icon name="right" size={16} color={C.faint} />
          </Pressable>; })
          : <Text style={r.detail}>Nenhuma rotina ainda. Abra um bot e crie uma em Rotinas.</Text>}
      </ScrollView>
    </View></View>
  </Modal>;
}

/** Every bot's negotiations; a row opens that bot's profile on the negotiation tab. */
export function NegotiationsSheet({ visible, negotiations = [], bots = [], onClose, onOpen }) {
  const rows = negotiations.filter(item => bots.some(bot => bot.id === item.botId));
  return <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
    <View style={styles.sheetBackdrop}><View style={[styles.sheet, styles.sheetTall]}>
      <View style={styles.sheetHandle} />
      <SheetHeader title="Negociações" subtitle="Compras e vendas em que um bot fala em seu nome." onClose={onClose} />
      <ScrollView style={styles.sheetOptions} contentContainerStyle={{ paddingBottom: 18 }}>
        {rows.length ? rows.map(item => { const bot = bots.find(entry => entry.id === item.botId);
          return <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.objective}, de ${bot.name}`} onPress={() => { onClose(); onOpen(bot, 'negotiate'); }} style={({ pressed }) => [r.row, pressed && { opacity: 0.7 }]}>
            <Avatar bot={bot} size={40} animated={false} />
            <View style={{ flex: 1 }}><Text style={r.title} numberOfLines={2}>{item.objective}</Text>
              <Text style={[r.detail, item.status === 'awaiting_you' && { color: C.amber }]} numberOfLines={1}>{bot.name} · {NEGOTIATION_STATUS[item.status] || item.status}</Text></View>
            <Icon name="right" size={16} color={C.faint} />
          </Pressable>; })
          : <Text style={r.detail}>Nenhuma negociação ainda. Abra um bot e crie uma em Negociar.</Text>}
      </ScrollView>
    </View></View>
  </Modal>;
}
