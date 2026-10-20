import { requireNativeModule } from 'expo-modules-core';

let module;
try { module = requireNativeModule('TermuxBridge'); } catch { /* Expo Go does not contain the MyBots native bridge. */ }

export const available = Boolean(module);
export const readStore = () => module.readStore();
export const writeStore = value => module.writeStore(value);
export const runCodex = (operation, payload = {}) => module.runCodex(operation, payload);
