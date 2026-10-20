const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withTermuxBridge(config) {
  return withAndroidManifest(config, config => {
    const manifest = config.modResults.manifest;
    manifest['uses-permission'] ||= [];
    if (!manifest['uses-permission'].some(item => item.$['android:name'] === 'com.termux.permission.RUN_COMMAND')) {
      manifest['uses-permission'].push({ $: { 'android:name': 'com.termux.permission.RUN_COMMAND' } });
    }
    // Screen-off work: foreground service, exact alarms for routines, restart after boot, wake lock while a bot works.
    for (const [name, extra] of [['android.permission.FOREGROUND_SERVICE'], ['android.permission.FOREGROUND_SERVICE_SPECIAL_USE'], ['android.permission.WAKE_LOCK'],
      ['android.permission.RECEIVE_BOOT_COMPLETED'], ['android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS'], ['android.permission.USE_EXACT_ALARM'],
      ['android.permission.SCHEDULE_EXACT_ALARM', { 'android:maxSdkVersion': '32' }]]) {
      if (!manifest['uses-permission'].some(item => item.$['android:name'] === name)) manifest['uses-permission'].push({ $: { 'android:name': name, ...extra } });
    }
    manifest.queries ||= [];
    let queries = manifest.queries.find(item => item.package || item.intent || item.provider);
    if (!queries) {
      queries = {};
      manifest.queries.push(queries);
    }
    queries.package ||= [];
    if (!queries.package.some(entry => entry.$['android:name'] === 'com.termux')) {
      queries.package.push({ $: { 'android:name': 'com.termux' } });
    }
    // Lets notification events name the app ("Gmail") instead of its package on Android 11+.
    queries.intent ||= [];
    if (!queries.intent.some(entry => entry.action?.[0]?.$['android:name'] === 'android.intent.action.MAIN')) {
      queries.intent.push({ action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }], category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }] });
    }
    // Opening a file a bot sent lists the apps that view it.
    if (!queries.intent.some(entry => entry.data?.[0]?.$['android:mimeType'] === '*/*')) {
      queries.intent.push({ action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }], data: [{ $: { 'android:mimeType': '*/*' } }] });
    }
    const application = manifest.application[0];
    // "Compartilhar → MyBots" from any app, and each bot as a Direct Share target.
    const main = application.activity.find(item => item.$['android:name'] === '.MainActivity');
    main['intent-filter'] ||= [];
    for (const action of ['android.intent.action.SEND', 'android.intent.action.SEND_MULTIPLE']) {
      if (!main['intent-filter'].some(filter => filter.action?.some(item => item.$['android:name'] === action))) {
        main['intent-filter'].push({ $: { 'android:label': 'Enviar a um bot' }, action: [{ $: { 'android:name': action } }], category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }], data: [{ $: { 'android:mimeType': '*/*' } }] });
      }
    }
    main['meta-data'] ||= [];
    if (!main['meta-data'].some(item => item.$['android:name'] === 'android.app.shortcuts')) main['meta-data'].push({ $: { 'android:name': 'android.app.shortcuts', 'android:resource': '@xml/mybots_shortcuts' } });
    // Only the on-device supervisor may use cleartext transport.
    delete application.$['android:usesCleartextTraffic'];
    application.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    application.receiver ||= [];
    if (!application.receiver.some(item => item.$['android:name'] === 'expo.modules.termuxbridge.TermuxResultReceiver')) {
      application.receiver.push({ $: {
        'android:name': 'expo.modules.termuxbridge.TermuxResultReceiver',
        'android:enabled': 'true',
        'android:exported': 'false'
      } });
    }
    application.service ||= [];
    // Forwards every notification to the supervisor once the person grants notification access.
    if (!application.service.some(item => item.$['android:name'] === 'expo.modules.termuxbridge.MyBotsNotificationListener')) {
      application.service.push({ $: {
        'android:name': 'expo.modules.termuxbridge.MyBotsNotificationListener',
        'android:exported': 'true',
        'android:label': 'MyBots',
        'android:permission': 'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE'
      }, 'intent-filter': [{ action: [{ $: { 'android:name': 'android.service.notification.NotificationListenerService' } }] }] });
    }
    if (!application.service.some(item => item.$['android:name'] === 'expo.modules.termuxbridge.KeepAliveService')) {
      application.service.push({ $: { 'android:name': 'expo.modules.termuxbridge.KeepAliveService', 'android:exported': 'false', 'android:foregroundServiceType': 'specialUse' },
        property: [{ $: { 'android:name': 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE', 'android:value': 'Mantém o supervisor local dos bots e suas rotinas agendadas funcionando com a tela apagada.' } }] });
    }
    // Files the bots send are opened and shared through this provider (staging folder only).
    application.provider ||= [];
    if (!application.provider.some(item => item.$['android:authorities'] === config.android.package + '.mybots.files')) {
      application.provider.push({ $: { 'android:name': 'androidx.core.content.FileProvider', 'android:authorities': config.android.package + '.mybots.files', 'android:exported': 'false', 'android:grantUriPermissions': 'true' },
        'meta-data': [{ $: { 'android:name': 'android.support.FILE_PROVIDER_PATHS', 'android:resource': '@xml/mybots_files' } }] });
    }
    if (!application.receiver.some(item => item.$['android:name'] === 'expo.modules.termuxbridge.KeepAliveReceiver')) {
      application.receiver.push({ $: { 'android:name': 'expo.modules.termuxbridge.KeepAliveReceiver', 'android:exported': 'true' },
        'intent-filter': [{ action: [{ $: { 'android:name': 'android.intent.action.BOOT_COMPLETED' } }, { $: { 'android:name': 'android.intent.action.MY_PACKAGE_REPLACED' } }] }] });
    }
    return config;
  });
};
