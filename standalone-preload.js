
const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const exifr = require('exifr');
const sizeOf = require('image-size');
const ffprobe = require('ffprobe-static').path;

const appConfigFile = path.join(path.dirname(process.execPath), 'config.json');
const configCache = (() => {
  try { return JSON.parse(fs.readFileSync(appConfigFile, 'utf8')); } catch (_) { return {}; }
})();

const genericIcon = (() => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect x="4" y="3" width="24" height="26" rx="3" fill="#eef1f5" stroke="#9aa4b2"/><path d="M8 9h16M8 14h16M8 19h10" stroke="#667085" stroke-width="2" stroke-linecap="round"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
})();

function parseRenameFiles(files) {
  const out = [];
  for (const file of files || []) {
    try {
      const st = fs.lstatSync(file);
      const isDirectory = st.isDirectory();
      const parsed = path.parse(file);
      out.push({
        path: file,
        name: parsed.base,
        basename: isDirectory ? parsed.base : parsed.name,
        ext: isDirectory ? '' : parsed.ext.toLowerCase(),
        isDirectory,
        isFile: st.isFile(),
        size: st.size,
        birthtimeMs: st.birthtimeMs,
        mtimeMs: st.mtimeMs
      });
    } catch (_) {}
  }
  return out;
}

function readDirectoryAllFiles(dir, progress, done) {
  let cancelled = false;
  const results = [];
  const stack = [dir];

  function step() {
    if (cancelled) return;
    const current = stack.pop();
    if (!current) return done(results);
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch (_) {}
    for (const entry of entries) {
      if (cancelled) return;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) {
        results.push(full);
        progress(results.length);
      }
    }
    setImmediate(step);
  }
  step();
  return () => { cancelled = true; };
}

function targetName(item) {
  if (Array.isArray(item.rename)) return `${item.rename[0]}${item.ext || ''}`;
  return `${item.rename ?? item.name}${item.ext || ''}`;
}

function renameFiles(items, progress, done) {
  const results = (items || []).map(x => ({ ...x }));
  const changes = results
    .map(item => ({ item, from: item.path, to: path.join(path.dirname(item.path), targetName(item)) }))
    .filter(x => x.from !== x.to);

  if (!changes.length) return done(null, results);

  const sourceSet = new Set(changes.map(x => path.resolve(x.from).toLowerCase()));
  const targetSet = new Set();
  for (const c of changes) {
    const key = path.resolve(c.to).toLowerCase();
    if (targetSet.has(key)) {
      c.item.error = '目标文件名重复';
      c.item.errorName = path.basename(c.to);
    }
    targetSet.add(key);
    if (fs.existsSync(c.to) && !sourceSet.has(key)) {
      c.item.error = '目标文件已存在';
      c.item.errorName = path.basename(c.to);
    }
  }
  const valid = changes.filter(c => !c.item.error);
  const temp = [];
  let completed = 0;

  try {
    for (const c of valid) {
      const ext = path.extname(c.from);
      let tmp;
      do {
        tmp = path.join(path.dirname(c.from), `.renamer-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`);
      } while (fs.existsSync(tmp));
      fs.renameSync(c.from, tmp);
      temp.push({ ...c, tmp });
    }
    for (const c of temp) {
      fs.renameSync(c.tmp, c.to);
      c.item.prevName = c.item.name;
      c.item.name = path.basename(c.to);
      const p = path.parse(c.to);
      c.item.basename = p.name;
      c.item.path = c.to;
      completed++;
      progress(completed);
    }
    done(null, results);
  } catch (err) {
    for (const c of temp) {
      try { if (fs.existsSync(c.tmp)) fs.renameSync(c.tmp, c.from); } catch (_) {}
    }
    done(err, results);
  }
}

function imageMetadata(p) {
  try {
    const d = sizeOf(p);
    return d ? { width: d.width, height: d.height, type: d.type } : {};
  } catch (_) {
    return {};
  }
}

async function exifMetadata(p) {
  try {
    return (await exifr.parse(p, { translateValues: true, translateKeys: true, reviveValues: true })) || {};
  } catch (_) {
    return {};
  }
}

function videoMetadata(p) {
  // Keep this synchronous-free and portable. ffprobe is shipped by ffprobe-static.
  try {
    const cp = require('child_process');
    const result = cp.spawnSync(ffprobe, ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', p], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024
    });
    if (result.status !== 0 || !result.stdout) return {};
    const data = JSON.parse(result.stdout);
    const v = (data.streams || []).find(s => s.codec_type === 'video');
    const a = (data.streams || []).find(s => s.codec_type === 'audio');
    const out = {};
    if (data.format?.duration) out.duration = Number(data.format.duration);
    if (data.format?.bit_rate) out.bitrate = Number(data.format.bit_rate);
    if (v) {
      out.video = {
        codec: v.codec_name,
        width: Number(v.width),
        height: Number(v.height),
        frameRate: v.avg_frame_rate && String(v.avg_frame_rate).includes('/') ?
          (() => { const [x,y] = String(v.avg_frame_rate).split('/').map(Number); return y ? x/y : null; })() :
          Number(v.avg_frame_rate) || null
      };
    }
    if (a) out.audio = { codec: a.codec_name, sampleRate: Number(a.sample_rate) || null, channels: Number(a.channels) || null };
    return out;
  } catch (_) {
    return {};
  }
}

window.utools = {
  getFileIcon: () => genericIcon,
  hideMainWindow: () => {},
  shellOpenPath: p => ipcRenderer.invoke('shell:openPath', p),
  shellOpenExternal: url => ipcRenderer.invoke('shell:openExternal', url),
  showOpenDialog: opts => {
    try { return ipcRenderer.sendSync('dialog:open-sync', opts || {}); }
    catch (_) { return null; }
  },
  isMacOs: () => process.platform === 'darwin',
  getCurrentFolderPath: () => '',
  getAppVersion: () => '7.0.0',
  dbStorage: {
    getItem: key => configCache[key],
    setItem: (key, value) => {
      configCache[key] = value;
      try { fs.writeFileSync(appConfigFile, JSON.stringify(configCache, null, 2), 'utf8'); } catch (_) {}
    }
  },
  allAiModels: async () => [],
  ai: async () => { throw new Error('AI 重命名在独立便携版中未启用'); }
};

window.services = {
  parseRenameFiles,
  renameFiles,
  readDirectoryAllFiles,
  parseFilesImageSizeOf(files) {
    for (const f of files || []) {
      if (!f.isDirectory && f.ext) f.imageSizeOf = `${imageMetadata(f.path).width || ''}x${imageMetadata(f.path).height || ''}`.replace(/^x$|^nullxnull$/, '');
      else f.imageSizeOf = '';
    }
  },
  async parseFilesPhotoTakenTime(files) {
    for (const f of files || []) {
      if (!f.ext || !['.jpg','.jpeg','.tif','.tiff','.png','.heic','.avif','.iiq'].includes(f.ext.toLowerCase())) {
        f.photoTakenTime = '';
        continue;
      }
      try {
        const d = await exifMetadata(f.path);
        f.photoTakenTime = d.DateTimeOriginal || '';
      } catch (_) { f.photoTakenTime = ''; }
    }
  },
  async getImagesExif(files) {
    const out = {};
    for (const f of files || []) {
      if (!f.ext || !['.jpg','.jpeg','.tif','.tiff','.png','.heic','.avif','.iiq'].includes(f.ext.toLowerCase())) continue;
      const d = await exifMetadata(f.path);
      if (d) out[f.name] = d;
    }
    return out;
  },
  async getImagesMetadata(files) {
    const out = {};
    for (const f of files || []) {
      if (!f.ext || !['.jpg','.jpeg','.png','.webp','.avif','.tif','.tiff','.gif','.svg','.heic','.heif'].includes(f.ext.toLowerCase())) continue;
      out[f.name] = imageMetadata(f.path);
    }
    return out;
  },
  async getVideosMetadata(files) {
    const out = {};
    for (const f of files || []) {
      if (!f.ext) continue;
      const ext = f.ext.toLowerCase();
      if (['.mp4','.m4v','.mov','.mkv','.avi','.wmv','.flv','.f4v','.webm','.mpeg','.mpg','.mpe','.mp2','.m2v','.ts','.mts','.m2ts','.vob','.3gp','.3g2','.ogv','.asf','.rm','.rmvb','.divx','.xvid','.nut','.mp3','.aac','.m4a','.m4b','.m4p','.wav','.flac','.ape','.alac','.ogg','.oga','.opus','.wma','.amr','.aiff','.aif','.aifc','.au','.snd','.caf','.mka','.ac3','.eac3','.dts','.tta','.wv','.ra'].includes(ext)) {
        out[f.name] = videoMetadata(f.path);
      }
    }
    return out;
  }
};

ipcRenderer.on('standalone-files', (_e, paths) => {
  if (window.utools?._enter) window.utools._enter(paths);
  else window.dispatchEvent(new CustomEvent('standalone-files', { detail: paths }));
});

// Original plugin's onPluginEnter hook.
window.utools._enter = (paths) => {
  try {
    window.__standaloneEnter?.({ type: 'files', payload: paths });
  } catch (_) {}
};
let enterCallback = null;
window.utools.onPluginEnter = cb => {
  enterCallback = cb;
  window.__standaloneEnter = cb;
};
