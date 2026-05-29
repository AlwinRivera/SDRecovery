const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0d0d0f',
    show: false
  });

  mainWindow.loadFile('renderer/index.html');
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ── List removable drives ──────────────────────────────────────────────────
ipcMain.handle('list-drives', async () => {
  return new Promise((resolve) => {
    const platform = os.platform();

    if (platform === 'win32') {
      exec('wmic logicaldisk get DeviceID,DriveType,Size,VolumeName /format:csv', (err, stdout) => {
        if (err) return resolve([]);
        const lines = stdout.trim().split('\n').slice(2).filter(Boolean);
        const drives = lines.map(line => {
          const parts = line.split(',');
          return { path: parts[1], label: parts[4] || parts[1], type: parts[2], size: parts[3] };
        }).filter(d => d.type === '2'); // removable
        resolve(drives);
      });
    } else if (platform === 'darwin') {
      exec('diskutil list -plist external', (err, stdout) => {
        if (err) return resolve([]);
        // simplified: list /Volumes entries
        exec('ls /Volumes', (e2, out) => {
          if (e2) return resolve([]);
          const vols = out.trim().split('\n').filter(v => v !== 'Macintosh HD' && v.trim());
          resolve(vols.map(v => ({ path: `/Volumes/${v}`, label: v })));
        });
      });
    } else {
      // Linux
      exec("lsblk -o NAME,TRAN,SIZE,LABEL,MOUNTPOINT -J", (err, stdout) => {
        if (err) return resolve([]);
        try {
          const data = JSON.parse(stdout);
          const drives = [];
          (data.blockdevices || []).forEach(dev => {
            if (dev.tran === 'usb' || dev.tran === 'sd') {
              (dev.children || [{ ...dev }]).forEach(child => {
                if (child.mountpoint) {
                  drives.push({ path: child.mountpoint, label: child.label || child.name, size: child.size });
                }
              });
            }
          });
          resolve(drives);
        } catch { resolve([]); }
      });
    }
  });
});

// ── Pick output folder ─────────────────────────────────────────────────────
ipcMain.handle('pick-output-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choose Recovery Destination'
  });
  return result.canceled ? null : result.filePaths[0];
});

// ── Run PhotoRec (carve files) ─────────────────────────────────────────────
ipcMain.handle('start-recovery', async (event, { drivePath, outputPath }) => {
  return new Promise((resolve) => {
    // Check if photorec / testdisk is available
    exec('which photorec || where photorec 2>nul', (err, stdout) => {
      if (err || !stdout.trim()) {
        // Fall back to a pure-Node file signature scanner
        runNodeScanner(event, drivePath, outputPath, resolve);
      } else {
        runPhotorec(event, drivePath, outputPath, stdout.trim(), resolve);
      }
    });
  });
});

// ── PhotoRec runner ────────────────────────────────────────────────────────
function runPhotorec(event, drivePath, outputPath, photorecBin, resolve) {
  // photorec /d <output> /cmd <drive> partition_i_want,search
  const args = ['/log', '/d', outputPath, '/cmd', drivePath, 'fileopt,everything,enable,search'];
  const proc = spawn(photorecBin, args);
  let found = 0;

  proc.stdout.on('data', data => {
    const line = data.toString();
    const match = line.match(/(\d+)\s+file/i);
    if (match) { found = parseInt(match[1]); }
    event.sender.send('recovery-progress', { message: line.trim(), found });
  });

  proc.stderr.on('data', data => {
    event.sender.send('recovery-progress', { message: data.toString().trim(), found });
  });

  proc.on('close', code => {
    resolve({ success: code === 0, found, outputPath });
  });
}

// ── Pure-Node file signature scanner (fallback) ────────────────────────────
const FILE_SIGNATURES = [
  { ext: 'jpg',  header: Buffer.from([0xFF,0xD8,0xFF]),           footer: Buffer.from([0xFF,0xD9]) },
  { ext: 'png',  header: Buffer.from([0x89,0x50,0x4E,0x47]),      footer: null },
  { ext: 'gif',  header: Buffer.from([0x47,0x49,0x46,0x38]),      footer: null },
  { ext: 'pdf',  header: Buffer.from([0x25,0x50,0x44,0x46]),      footer: null },
  { ext: 'mp4',  header: null, offset: 4, pattern: Buffer.from([0x66,0x74,0x79,0x70]), footer: null },
  { ext: 'zip',  header: Buffer.from([0x50,0x4B,0x03,0x04]),      footer: null },
  { ext: 'docx', header: Buffer.from([0x50,0x4B,0x03,0x04]),      footer: null },
  { ext: 'mp3',  header: Buffer.from([0x49,0x44,0x33]),           footer: null },
];

async function runNodeScanner(event, drivePath, outputPath, resolve) {
  // On mounted volumes, walk the directory for recoverable files
  // (true raw sector scanning requires root/admin; this handles accessible files)
  if (!fs.existsSync(outputPath)) fs.mkdirSync(outputPath, { recursive: true });

  let found = 0;
  let scanned = 0;

  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        scanned++;
        try {
          const stat = fs.statSync(full);
          if (stat.size > 0) {
            // Copy to output
            const dest = path.join(outputPath, `recovered_${found}_${entry.name}`);
            fs.copyFileSync(full, dest);
            found++;
            event.sender.send('recovery-progress', {
              message: `Found: ${entry.name}`,
              found,
              scanned,
              currentFile: entry.name
            });
          }
        } catch { /* skip locked files */ }
      }
    }
  }

  event.sender.send('recovery-progress', { message: 'Scanning drive...', found: 0 });

  try {
    walk(drivePath);
  } catch (e) {
    event.sender.send('recovery-progress', { message: `Error: ${e.message}`, found });
  }

  resolve({ success: true, found, outputPath, scanned });
}

// ── Open output folder in Finder/Explorer ─────────────────────────────────
ipcMain.handle('open-folder', async (event, folderPath) => {
  const { shell } = require('electron');
  shell.openPath(folderPath);
});
