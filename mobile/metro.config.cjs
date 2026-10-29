const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

// lib/ (shared with the supervisor) holds the face generator the app imports.
const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders || []), path.resolve(__dirname, '..', 'lib')];
module.exports = config;
