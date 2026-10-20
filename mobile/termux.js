import { requireNativeModule, requireNativeViewManager } from 'expo-modules-core';

let native;
try { native = requireNativeModule('TermuxBridge'); } catch { /* Expo Go uses only the computer backend. */ }

export const termuxAvailable = Boolean(native);
export const readLocalStore = async () => native ? JSON.parse(await native.readStore()) : null;
export const writeLocalStore = value => native?.writeStore(JSON.stringify(value));
export const readPairing = () => native.readPairing();
export const savePairing = value => native.savePairing(value);
export const readDeviceInfo = () => native.deviceInfo();
export const readSecretsKey = () => native.secretsKey();
export const readConnectorBundle = () => native.connectorBundle();
export const notificationAccess = () => native.notificationAccess();
export const openNotificationAccess = () => native.openNotificationAccess();
export const flushNotifications = () => native.flushNotifications();
export const supervisorParts = () => native.supervisorParts();
export const pickFile = () => native.pickFile();
export const dictate = () => native.dictate();
export const takeLaunchBot = () => native?.takeLaunchBot();
export const onOpenBot = listener => native.addListener('onOpenBot', listener);
// "Compartilhar → MyBots": what another app shared, and the bots offered as Direct Share targets.
export const takeShare = () => native?.takeShare();
export const onShare = listener => native.addListener('onShare', listener);
export const publishShareTargets = bots => native?.publishShareTargets(bots);
export const showBotNotification = item => native.showBotNotification(item);
export const botNotificationStatus = () => native.botNotificationStatus();
export const openNotificationSettings = () => native.openNotificationSettings();
export const notificationPermission = () => native.notificationPermission();
export const microphonePermission = () => native.microphonePermission();
export const startListening = () => native.startListening();
export const stopListening = (cancel = false) => native.stopListening(cancel);
export const onSpeech = listener => native.addListener('onSpeech', listener);
export const termuxApiStatus = () => native.termuxApiStatus();
export const openAppSettings = packageName => native.openAppSettings(packageName);
export const keepAliveStatus = () => native.keepAliveStatus();
export const setKeepAlive = enabled => native.setKeepAlive(enabled);
export const startKeepAlive = () => native?.startKeepAlive();
export const openPowerSettings = target => native.openPowerSettings(target);
// Each bot's own browser: the live WebView for the chat panel, and the person's back/reload after "Assumir".
export const BotBrowserView = native ? requireNativeViewManager('TermuxBridge') : null;
export const browserInfo = () => native.browserInfo();
export const browserAction = (botId, action) => native.browserAction(botId, action);
export const fileStage = (id, name, chunk, append) => native.fileStage(id, name, chunk, append);
export const fileAction = (id, name, mime, action) => native.fileAction(id, name, mime, action);
export const copyTermuxText = value => native?.copyText(value);
export const runTermux = (operation, payload = {}) => {
  if (!native) throw new Error('A conexão com o Termux exige instalar o APK próprio do MyBots. No Expo Go, use o modo computador.');
  return native.runCodex(operation, payload);
};
