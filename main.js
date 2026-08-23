
const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let mainWindow = null;
  let pendingPaths = [];

  const configDir = path.dirname(app.getPath('exe'));
  const configPath = path.join(configDir, 'config.json');

  function loadConfig() {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (_) {
      return {};
    }
  }

  function saveConfig(obj) {
    try {
      fs.writeFileSync(configPath, JSON.stringify(obj, null, 2), 'utf8');
      return true;
    } catch (_) {
      return false;
    }
  }

  function validFilePath(p) {
    try { return typeof p === 'string' && fs.existsSync(p); } catch (_) { return false; }
  }

  function extractPaths(argv) {
    return argv
      .filter(p => typeof p === 'string')
      .filter(p => !/^--(no-sandbox|inspect|remote-debugging)/.test(p))
      .map(p => {
        try { return path.resolve(p); } catch (_) { return p; }
      })
      .filter(validFilePath);
  }

  pendingPaths = extractPaths(process.argv.slice(1));

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1000,
      height: 700,
      minWidth: 760,
      minHeight: 500,
      autoHideMenuBar: true,
      show: false,
      backgroundColor: '#ffffff',
      webPreferences: {
        preload: path.join(__dirname, 'standalone-preload.js'),
        contextIsolation: false,
        nodeIntegration: false,
        sandbox: false,
        webSecurity: true
      }
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    mainWindow.once('ready-to-show', () => {
      mainWindow.show();
      if (pendingPaths.length) {
        mainWindow.webContents.send('standalone-files', pendingPaths);
        pendingPaths = [];
      }
    });

    mainWindow.on('closed', () => { mainWindow = null; });
  }

  app.on('second-instance', (_event, commandLine) => {
    const paths = extractPaths(commandLine.slice(1));
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      if (paths.length) mainWindow.webContents.send('standalone-files', paths);
    }
  });

  ipcMain.handle('config:get', () => loadConfig());
  ipcMain.handle('config:set', (_event, data) => saveConfig(data || {}));
  ipcMain.handle('dialog:open', async (_event, opts) => {
    const result = await dialog.showOpenDialog(mainWindow, opts || {});
    return result.canceled ? null : result.filePaths;
  });
  ipcMain.on('dialog:open-sync', (event, opts) => {
    try {
      const result = dialog.showOpenDialogSync(mainWindow, opts || {});
      event.returnValue = result || null;
    } catch (_) {
      event.returnValue = null;
    }
  });
  ipcMain.handle('shell:openPath', async (_event, p) => shell.openPath(p));
  ipcMain.handle('shell:openExternal', async (_event, url) => shell.openExternal(url));

  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
