const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    }
  });

  // 在任何脚本执行前注入完备的 utools 垫片
  win.webContents.on('did-start-loading', () => {
    win.webContents.executeJavaScript(`
      window.utools = window.utools || {
        getAppVersion: () => '1.0.0',
        isDarkColors: () => true,
        onPluginEnter: (cb) => {
          try { cb({ code: 'renamer', type: 'files', payload: [] }); } catch(e){}
        },
        onPluginOut: () => {},
        onPluginReady: (cb) => { try { cb(); } catch(e){} },
        showOpenDialog: (opts) => {
          return null;
        },
        db: {
          get: () => null,
          put: () => {},
          remove: () => {},
          promises: { get: async () => null, put: async () => {}, remove: async () => {} }
        },
        getNativeId: () => 'fake-id',
        getUser: () => ({ nickname: 'LocalUser' }),
        getCurrentFolderPath: () => '',
        shellOpenPath: (p) => require('electron').shell.openPath(p),
        showNotification: (msg) => console.log('Notification:', msg)
      };
    `);
  });

  win.loadFile('index.html');

  // 支持按 F12 随时查看控制台
  win.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      win.webContents.toggleDevTools();
    }
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
