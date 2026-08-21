const { app, BrowserWindow } = require('electron');
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

  // 补齐 uTools 完整的模拟垫片，防止 React 渲染崩溃
  win.webContents.on('dom-ready', () => {
    win.webContents.executeJavaScript(`
      window.utools = window.utools || {
        isDarkColors: () => true,
        onPluginEnter: (cb) => {
          try { cb({ code: 'renamer', type: 'files', payload: [] }); } catch(e){}
        },
        onPluginOut: () => {},
        onPluginReady: (cb) => { try { cb(); } catch(e){} },
        showOpenDialog: (opts) => [],
        db: {
          get: () => null,
          put: () => {},
          remove: () => {},
          promises: { get: async () => null, put: async () => {}, remove: async () => {} }
        },
        getNativeId: () => 'fake-id',
        getUser: () => ({ nickname: 'LocalUser' })
      };
    `);
  });

  win.loadFile('index.html');

  // 按 F12 可以打开开发者工具排查报错
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
