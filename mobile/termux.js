import { requireNativeModule, requireNativeViewManager } from 'expo-modules-core';
import { currentTheme } from './theme';

let native;
try { native = requireNativeModule('TermuxBridge'); } catch { /* Expo Go uses only the computer backend. */ }

export const termuxAvailable = Boolean(native);
// The link to the computer, for the phone without Termux (kept encrypted by the native side), and secure random bytes.
// In the browser (the iPhone's web app) there is no native side: the pairing and the small cache live in the page's own storage.
const webStore = !native && typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null;
const webRead = key => { try { return webStore?.getItem(key) ?? null; } catch { return null; } };
const webWrite = (key, value) => { try { if (value == null) webStore?.removeItem(key); else webStore?.setItem(key, value); } catch {} };
if (webStore) { try { globalThis.navigator?.storage?.persist?.(); } catch {} }
// The link to the computer, for the phone without Termux (kept encrypted by the native side), and secure random bytes.
export const readPcLink = async () => { const raw = native ? await native.readPcLink() : webRead('mybots.pcLink'); if (!raw) return null; try { return JSON.parse(raw); } catch { return null; } };
export const savePcLink = value => native ? native.savePcLink(JSON.stringify(value)) : webWrite('mybots.pcLink', JSON.stringify(value));
export const clearPcLink = () => native ? native.clearPcLink() : webWrite('mybots.pcLink', null);
export const randomBytesNative = count => {
  if (native?.randomBase64) { const binary = atob(native.randomBase64(count)); const out = new Uint8Array(count); for (let i = 0; i < count; i++) out[i] = binary.charCodeAt(i); return out; }
  if (globalThis.crypto?.getRandomValues) return globalThis.crypto.getRandomValues(new Uint8Array(count));
  throw new Error('Este aparelho não tem fonte de números aleatórios seguros.');
};
export const readLocalStore = async () => { if (native) return JSON.parse(await native.readStore()); const raw = webRead('mybots.store'); try { return raw ? JSON.parse(raw) : null; } catch { return null; } };
export const writeLocalStore = value => native ? native.writeStore(JSON.stringify(value)) : webWrite('mybots.store', JSON.stringify(value));
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
export const copyText = async value => { if (native) await native.copyText(String(value)); else await globalThis.navigator?.clipboard?.writeText(String(value)); };
export const dictate = () => native.dictate();
export const takeLaunchBot = () => native?.takeLaunchBot();
export const onOpenBot = listener => native.addListener('onOpenBot', listener);
// "Compartilhar → MyBots": what another app shared, and the bots offered as Direct Share targets.
export const takeShare = () => native?.takeShare();
export const onShare = listener => native.addListener('onShare', listener);
// Updates from GitHub Releases (same signing certificate only).
export const updateCheck = () => native.updateCheck();
export const updateInstall = (apkUrl, shaUrl) => native.updateInstall(apkUrl, shaUrl);
export const updateCanInstall = () => native.updateCanInstall();
export const onUpdate = listener => native.addListener('onUpdate', listener);
export const widgetStatus = () => native.widgetStatus();
export const requestWidget = () => native.requestWidget();
// Saved site logins: kept in the app (Keystore); the bots' browser fills them, the model never sees them.
export const walletCards = async () => JSON.parse(await native.walletCards());
export const walletCardBots = (cardId, bots) => native.walletCardBots(cardId, bots);
export const cardEditor = () => native.cardEditor(currentTheme() === 'light');
export const cardDelete = id => native.cardDelete(id);
export const walletRules = async () => JSON.parse(await native.walletRules());
export const walletFreeze = () => native.walletFreeze();
export const walletRulesEditor = () => native.walletRulesEditor(currentTheme() === 'light');
export const walletPurchases = async () => JSON.parse(await native.walletPurchases());
export const walletDismiss = id => native.walletDismiss(id);
export const passwordsList = () => native.passwordsList();
export const passwordSave = (site, username, password, bots) => native.passwordSave(site, username, password, bots);
export const passwordDelete = id => native.passwordDelete(id);
export const passwordImport = bots => native.passwordImport(bots);
export const passwordImportDelete = () => native.passwordImportDelete();
export const passwordOffer = () => native.passwordOffer();
export const passwordOfferAnswer = scope => native.passwordOfferAnswer(scope);
export const onPasswordOffer = listener => native.addListener('onPasswordOffer', listener);
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
// Controle do celular (nível Livre): the accessibility service, an instant Parar and the app's own copy of who is Livre.
export const phoneAccess = () => native.phoneAccess();
export const openAccessibility = () => native.openAccessibility();
export const phoneStopNow = () => native?.phoneStop();
export const freeGuard = () => native ? native.freeGuard() : Promise.resolve(null);
export const freeGuardSet = (botId, on) => native?.freeGuardSet(botId, on);
export const freeGuardAsk = value => native?.freeGuardAsk(value);
// Each bot's own browser: the live WebView for the chat panel, and the person's back/reload after "Assumir".
export const BotBrowserView = native ? requireNativeViewManager('TermuxBridge', 'BotBrowserView') : null;
let frameView;
try { frameView = native ? requireNativeViewManager('TermuxBridge', 'BotFrameView') : null; } catch {}
export const BotFrameView = frameView;
let mimoView;
try { mimoView = native ? requireNativeViewManager('TermuxBridge', 'MimoView') : null; } catch {}
export const MimoView = mimoView;
export const browserInfo = () => native.browserInfo();
export const browserAction = (botId, action) => native.browserAction(botId, action);
export const fileStage = (id, name, chunk, append) => native.fileStage(id, name, chunk, append);
export const fileAction = (id, name, mime, action) => native.fileAction(id, name, mime, action);
export const copyTermuxText = value => native?.copyText(value);
export const runTermux = (operation, payload = {}) => {
  if (!native) throw new Error('A conexão com o Termux exige instalar o APK próprio do MyBots. No Expo Go, use o modo computador.');
  return native.runCodex(operation, payload);
};

export const browserPresentation = on => native?.browserPresentation(on);

export const browserInput = (botId, input) => native?.browserInput(botId, input);
