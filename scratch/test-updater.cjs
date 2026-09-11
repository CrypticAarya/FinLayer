const { app } = require('electron');
const { NsisUpdater } = require('electron-updater');

app.whenReady().then(async () => {
  try {
    const updater = new NsisUpdater();
    updater.forceDevUpdateConfig = true;
    updater.autoDownload = true;
    updater.setFeedURL({
      provider: 'generic',
      url: 'http://127.0.0.1:4005'
    });
    console.log('[TEST] Checking for updates via NsisUpdater...');
    updater.on('checking-for-update', () => console.log('[TEST] checking-for-update'));
    updater.on('update-available', (info) => console.log('[TEST] update-available:', info.version));
    updater.on('update-not-available', () => console.log('[TEST] update-not-available'));
    updater.on('error', (err) => console.log('[TEST] error:', err.message));
    updater.on('update-downloaded', (info) => {
      console.log('[TEST] update-downloaded:', info.version);
      app.quit();
    });

    const result = await updater.checkForUpdates();
    console.log('[TEST] checkForUpdates returned:', result?.updateInfo?.version);
  } catch (err) {
    console.error('[TEST] Exception:', err);
    app.quit();
  }
});
