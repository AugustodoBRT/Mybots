import { useState } from 'react';
import { Modal, View, Pressable, Text } from 'react-native';
import { styles } from '../styles';
import { C, Icon } from '../theme';
import { copyText } from '../termux';
import { useLiveCallback } from './shared';

/** A row of the conversation that opens the message actions when held; pinned messages carry a small mark. */
export function Actionable({ message, onHold, children }) {
  return <Pressable accessible={false} delayLongPress={350} onLongPress={() => onHold(message)} onContextMenu={event => { event?.preventDefault?.(); onHold(message); }}>
    {message.pinned ? <View style={styles.pinnedMark}><Icon name="pin" size={12} color={C.amber} /><Text style={styles.pinnedMarkText}>Fixada</Text></View> : null}
    {children}
  </Pressable>;
}

/** What can be done with one message: copy, answer quoting it, pin and send again (own messages). */
export function MessageActionSheet({ message, onClose, onQuote, onPin, onResend, canResend }) {
  const [notice, setNotice] = useState('');
  const run = useLiveCallback(async (action, close = true) => {
    try { await action(); if (close) onClose(); } catch (error) { setNotice(error.message || 'Não deu certo.'); }
  });
  const text = String(message?.text || '').trim();
  const mine = message?.role === 'user';
  const options = !message ? [] : [
    { key: 'copy', icon: 'copy', label: 'Copiar', show: Boolean(text), run: () => copyText(text) },
    { key: 'quote', icon: 'reply', label: 'Responder citando', show: Boolean(text), run: () => onQuote(message) },
    { key: 'pin', icon: 'pin', label: message.pinned ? 'Desafixar' : 'Fixar', show: true, run: () => onPin(message, !message.pinned) },
    { key: 'resend', icon: 'refresh', label: 'Reenviar', show: mine && Boolean(text) && canResend, run: () => onResend(message) }
  ].filter(option => option.show);
  return <Modal transparent visible={Boolean(message)} animationType="fade" onRequestClose={onClose}>
    <Pressable style={styles.sheetBackdrop} onPress={onClose}>
      <Pressable style={styles.sheet} onPress={event => event.stopPropagation()}>
        <View style={styles.sheetHandle} />
        <Text style={styles.sheetTitle} numberOfLines={2}>{text.slice(0, 90) || 'Mensagem'}</Text>
        {options.map(option => <Pressable key={option.key} accessibilityRole="button" accessibilityLabel={option.label} onPress={() => run(option.run)} style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
          <Icon name={option.icon} size={18} color={C.text2} /><View style={styles.optionCopy}><Text style={styles.optionLabel}>{option.label}</Text></View>
        </Pressable>)}
        {notice ? <Text style={styles.composerError}>{notice}</Text> : null}
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeSheet}><Text style={styles.closeSheetText}>Voltar</Text></Pressable>
      </Pressable>
    </Pressable>
  </Modal>;
}

/** The citation that starts an answer to a message. */
export const quoteOf = message => `> ${String(message.text || '').trim().split('\n')[0].slice(0, 160)}\n\n`;
