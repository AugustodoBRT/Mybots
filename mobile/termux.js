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
// On the computer's own window the saved logins are the computer's vault (the local supervisor); on the phone, the app's Keystore.
let vaultCall = null;
export const useComputerVault = call => { vaultCall = call; };
const pickText = () => new Promise((resolve, reject) => {
  const input = globalThis.document.createElement('input'); input.type = 'file'; input.accept = '.csv,text/csv,text/plain';
  input.onchange = async () => { const file = input.files?.[0]; if (!file) { resolve(null); return; } try { resolve({ name: file.name, text: await file.text() }); } catch (error) { reject(error); } };
  input.click();
});
export const passwordsList = () => vaultCall ? vaultCall('passwords.list', {}) : native.passwordsList();
export const passwordSave = (site, username, password, bots) => vaultCall ? vaultCall('passwords.save', { site, username, password, bots }) : native.passwordSave(site, username, password, bots);
export const passwordsSyncState = async () => JSON.parse(await native.passwordsSyncState());
export const passwordsSyncMerge = async state => JSON.parse(await native.passwordsSyncMerge(JSON.stringify(state)));
export const passwordDelete = async id => vaultCall ? (await vaultCall('passwords.remove', { id })).removed : native.passwordDelete(id);
export const passwordImport = async bots => {
  if (!vaultCall) return native.passwordImport(bots);
  const file = await pickText(); if (!file) return null;
  return { ...await vaultCall('passwords.import', { text: file.text, bots }), name: '' };
};
export const passwordImportDelete = () => vaultCall ? Promise.resolve(false) : native.passwordImportDelete();
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
// 3D bots on the phone (see Avatar3d.kt). An APK from before this existed has no such function: the flat face stays.
export const avatar3dAvailable = () => { try { return typeof native?.avatar3dAvailable === 'function' && Boolean(native.avatar3dAvailable()) && typeof native.avatar3dRender === 'function'; } catch { return false; } };
// While the opening screen's 3D bot plays, the bots' pictures wait: both WebViews share one renderer process on Android, and the
// opening bot should keep the whole frame rate.
let splashGate = Promise.resolve(), openGate = null;
export const holdAvatars = () => { if (!openGate) splashGate = new Promise(resolve => { openGate = resolve; }); };
export const releaseAvatars = () => { openGate?.(); openGate = null; };
export const avatar3dRender = json => splashGate.then(() => native.avatar3dRender(json));
// A live 3D bot drawn at the screen's frame rate (Bot3dView.kt); an APK from before it has none.
let bot3dView = null;
try { bot3dView = native ? requireNativeViewManager('TermuxBridge', 'Bot3dView') : null; } catch {}
export const Bot3dView = bot3dView;
// A bot's HTML page on the canvas, isolated (HtmlCardView.kt); an APK from before it has none and the card says so.
let htmlCardView = null;
try { htmlCardView = native ? requireNativeViewManager('TermuxBridge', 'HtmlCardView') : null; } catch {}
export const HtmlCardView = htmlCardView;
// The opening screen's 3D bot (Splash3d.kt); an APK from before it has none and the opening screen draws its own bot.
export const splash3dAvailable = () => { try { return avatar3dAvailable() && typeof native.splash3dShow === 'function'; } catch { return false; } };
export const splash3dShow = (size, offset, bot) => native.splash3dShow(size, offset, String(bot?.id || 'mybots'), String(bot?.name || 'MyBots'), JSON.stringify(bot?.face || null));
export const splash3dFinish = () => native.splash3dFinish();
export const splash3dHide = ms => native.splash3dHide(ms);
export const prefGet = key => { try { return typeof native?.prefGet === 'function' ? native.prefGet(key) : null; } catch { return null; } };
export const prefSet = (key, value) => { try { if (typeof native?.prefSet === 'function') native.prefSet(key, value); } catch {} };
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
