# 💾 SD Card Recovery Tool

A desktop app built with Electron. The UI is plain HTML/CSS/JS/jQuery/Bootstrap 4 — no framework needed.

---

## Requirements

- [Node.js](https://nodejs.org) (v18 or later recommended)
- npm (comes with Node.js)
- Optional but recommended: **PhotoRec / TestDisk** for deeper raw recovery

---

## Setup (do this once)

1. Open a terminal / command prompt
2. Navigate into this folder:
   ```
   cd sd-recovery
   ```
3. Install Electron:
   ```
   npm install --legacy-peer-deps
   ```
   ```
   npm install -g electron
   ```

---

## Run the app

```
npm start
```

---

## How to use

1. **Insert your SD card** into your computer
2. Click **Refresh Drives** in the sidebar — your SD card should appear
3. Click on the drive to select it
4. Click **Choose Folder** to pick where recovered files will be saved (pick somewhere NOT on the SD card)
5. Click **▶ Start Recovery**
6. When done, click **Open Output** to see your recovered files

---

## For deeper recovery (recommended)

Install **PhotoRec** (free, open source) — the app will automatically use it if found:

- **Windows**: Download TestDisk from https://www.cgsecurity.org/wiki/TestDisk_Download
- **Mac**: `brew install testdisk`
- **Linux**: `sudo apt install testdisk`

Without PhotoRec, the app scans accessible files on the mounted volume.

---

## Tips

- **Do not write anything to the SD card** before recovering — this overwrites deleted data
- Run the app **as Administrator** (Windows) or with `sudo` (Mac/Linux) for best results
- Save recovered files to a **different drive**, never back to the SD card
