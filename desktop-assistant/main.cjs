const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, screen, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  dialogues: ['നമസ്കാരം! ഞാൻ മിലോ.', 'ഒരു ചെറിയ ഇടവേള എടുക്കാം!'],
  reminders: [
    { id: 'one-hour', afterMinutes: 60, message: 'ഒരു മണിക്കൂർ ആയി! ഒരു ചെറിയ ഇടവേള എടുക്കാം.' },
    { id: 'eight-hour', afterMinutes: 480, message: 'എട്ട് മണിക്കൂർ പൂർത്തിയായി! ഇന്നത്തെ ജോലി നന്നായി ചെയ്തു.' },
  ],
  attendanceReminders: [
    { id: 'work-one-hour', afterWorkMinutes: 60, message: 'ഒരു മണിക്കൂർ ജോലി പൂർത്തിയായി! ഒരു ചെറിയ ഇടവേള എടുക്കാം.' },
    { id: 'work-eight-hour', afterWorkMinutes: 480, message: 'എട്ട് മണിക്കൂർ ജോലി പൂർത്തിയായി! ഇന്നത്തെ ജോലി നന്നായി ചെയ്തു.' },
  ],
  intervalMinutes: 10,
  speak: true,
  enabled: true,
  launchAtLogin: false,
};

let tray;
let overlays = [];
let settingsWindow;
let rotationTimer;
let reminderTimers = new Map();
let reminderRun = { startedAt: null, completed: [] };
let dialogueIndex = 0;
let settings = { ...DEFAULTS };
let firstRun = false;
let cloudSession = null;
let cloudUser = null;
let attendanceReminderRun = { date: null, completed: [] };
let attendancePollTimer;
const cloudConfig = require('./cloud-config.json');
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const reminderRunPath = () => path.join(app.getPath('userData'), 'reminder-run.json');
const cloudSessionPath = () => path.join(app.getPath('userData'), 'cloud-session.bin');
const attendanceReminderRunPath = () => path.join(app.getPath('userData'), 'attendance-reminder-run.json');
const linuxAutostartPath = () => path.join(app.getPath('home'), '.config', 'autostart', 'milo-desktop-companion.desktop');

function setLaunchAtLogin(enabled) {
  if (process.platform === 'linux') {
    const file = linuxAutostartPath();
    if (!enabled) {
      try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      return;
    }
    const executable = process.env.APPIMAGE || app.getPath('exe');
    const escapedExecutable = executable.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `[Desktop Entry]\nType=Application\nName=Milo Desktop Companion\nExec="${escapedExecutable}"\nX-GNOME-Autostart-enabled=true\nNoDisplay=true\n`, { mode: 0o600 });
    return;
  }
  if (process.platform === 'darwin' || process.platform === 'win32') {
    app.setLoginItemSettings({ openAtLogin: enabled });
  }
}

function normalizeReminders(reminders) {
  if (!Array.isArray(reminders)) return DEFAULTS.reminders;
  return reminders.slice(0, 30).map((reminder, index) => ({
    id: typeof reminder?.id === 'string' ? reminder.id.slice(0, 80) : `reminder-${index + 1}`,
    afterMinutes: Math.max(1, Math.min(10080, Number(reminder?.afterMinutes) || 1)),
    message: typeof reminder?.message === 'string' ? reminder.message.trim().slice(0, 500) : '',
  })).filter(reminder => reminder.message);
}

function normalizeAttendanceReminders(reminders) {
  if (!Array.isArray(reminders)) return DEFAULTS.attendanceReminders;
  return reminders.slice(0, 30).map((reminder, index) => ({
    id: typeof reminder?.id === 'string' ? reminder.id.slice(0, 80) : `work-reminder-${index + 1}`,
    afterWorkMinutes: Math.max(1, Math.min(1440, Number(reminder?.afterWorkMinutes) || 1)),
    message: typeof reminder?.message === 'string' ? reminder.message.trim().slice(0, 500) : '',
  })).filter(reminder => reminder.message);
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function secureSessionStorageAvailable() {
  if (!safeStorage.isEncryptionAvailable()) return false;
  return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text';
}

function loadCloudSession() {
  try {
    if (!secureSessionStorageAvailable()) return;
    const encrypted = fs.readFileSync(cloudSessionPath());
    cloudSession = JSON.parse(safeStorage.decryptString(encrypted));
    cloudUser = cloudSession.user ?? null;
  } catch { cloudSession = null; cloudUser = null; }
  try {
    attendanceReminderRun = JSON.parse(fs.readFileSync(attendanceReminderRunPath(), 'utf8'));
  } catch { attendanceReminderRun = { date: null, completed: [] }; }
}

function saveCloudSession(session) {
  if (!secureSessionStorageAvailable()) throw new Error('Secure session storage is unavailable. On Linux, unlock or install your desktop keyring, then try again.');
  fs.mkdirSync(path.dirname(cloudSessionPath()), { recursive: true });
  fs.writeFileSync(cloudSessionPath(), safeStorage.encryptString(JSON.stringify(session)), { mode: 0o600 });
  cloudSession = session;
  cloudUser = session.user ?? null;
}

function clearCloudSession() {
  cloudSession = null;
  cloudUser = null;
  try { fs.unlinkSync(cloudSessionPath()); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (attendancePollTimer) clearInterval(attendancePollTimer);
  attendancePollTimer = null;
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send('companion:attendance', { connected: false });
}

async function cloudRequest(pathname, options = {}, token = cloudSession?.access_token) {
  const response = await fetch(`${cloudConfig.url}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: cloudConfig.anonKey,
      Authorization: `Bearer ${token || cloudConfig.anonKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const body = await response.text();
  const data = body ? JSON.parse(body) : null;
  if (!response.ok) throw new Error(data?.message || data?.msg || `Cloud request failed (${response.status}).`);
  return data;
}

async function refreshCloudSession() {
  if (!cloudSession?.refresh_token) throw new Error('Sign in to your Milo account.');
  if ((cloudSession.expires_at || 0) > Date.now() / 1000 + 60) return cloudSession;
  const response = await fetch(`${cloudConfig.url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST', headers: { apikey: cloudConfig.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: cloudSession.refresh_token }),
  });
  const data = await response.json();
  if (!response.ok) { clearCloudSession(); throw new Error(data?.msg || data?.message || 'Your session expired. Sign in again.'); }
  saveCloudSession({ ...data, expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600), user: data.user || cloudUser });
  return cloudSession;
}

function netWorkSeconds(day, now = Date.now()) {
  const sessions = Array.isArray(day?.sessions) && day.sessions.length
    ? day.sessions
    : (day?.punch_in_at ? [{ punchInAt: day.punch_in_at, punchOutAt: day.punch_out_at, breakMinutes: day.break_minutes }] : []);
  return sessions.reduce((total, session) => {
    const start = new Date(session.punchInAt).getTime();
    const end = session.punchOutAt ? new Date(session.punchOutAt).getTime() : now;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return total;
    const seconds = Math.max(0, Math.floor((end - start) / 1000));
    const breakSeconds = Math.min(seconds, Math.max(0, Number(session.breakMinutes) || 0) * 60);
    return total + seconds - breakSeconds;
  }, 0);
}

async function syncCloudAttendance() {
  await refreshCloudSession();
  const date = localDateKey();
  const dayRows = await cloudRequest(`attendance_days?select=work_date,punch_in_at,punch_out_at,office_out_at,sessions,break_minutes&work_date=eq.${date}&limit=1`);
  const settingRows = await cloudRequest(`milo_user_settings?select=settings&user_id=eq.${encodeURIComponent(cloudUser.id)}&limit=1`);
  const day = dayRows?.[0] ?? null;
  const netSeconds = netWorkSeconds(day);
  const userSettings = settingRows?.[0]?.settings ?? {};
  const targetMinutes = Math.max(1, Number(userSettings.policy?.recordedWorkTargetMinutes) || 480);
  const snapshot = { connected: true, email: cloudUser.email, date, day, netSeconds, targetMinutes };
  if (attendanceReminderRun.date !== date) attendanceReminderRun = { date, completed: [] };
  for (const reminder of settings.attendanceReminders) {
    if (netSeconds >= reminder.afterWorkMinutes * 60 && !attendanceReminderRun.completed.includes(reminder.id)) {
      sayText(reminder.message);
      attendanceReminderRun.completed.push(reminder.id);
      fs.writeFileSync(attendanceReminderRunPath(), JSON.stringify(attendanceReminderRun, null, 2), { mode: 0o600 });
    }
  }
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send('companion:attendance', snapshot);
  return snapshot;
}

function startAttendancePolling() {
  if (attendancePollTimer) clearInterval(attendancePollTimer);
  if (!cloudSession) return;
  void syncCloudAttendance().catch(error => {
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send('companion:attendance-error', error.message);
  });
  attendancePollTimer = setInterval(() => {
    void syncCloudAttendance().catch(error => {
      if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send('companion:attendance-error', error.message);
    });
  }, 30_000);
}

function loadSettings() {
  firstRun = !fs.existsSync(settingsPath());
  try {
    const saved = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    settings = {
      ...DEFAULTS,
      ...saved,
      dialogues: Array.isArray(saved.dialogues) ? saved.dialogues.filter(line => typeof line === 'string' && line.trim()).slice(0, 100) : DEFAULTS.dialogues,
      reminders: normalizeReminders(saved.reminders),
      attendanceReminders: normalizeAttendanceReminders(saved.attendanceReminders),
      intervalMinutes: Math.max(0, Math.min(180, Number(saved.intervalMinutes) || 0)),
    };
  } catch { settings = { ...DEFAULTS }; }
  try {
    const savedRun = JSON.parse(fs.readFileSync(reminderRunPath(), 'utf8'));
    reminderRun = { startedAt: Number(savedRun.startedAt) || null, completed: Array.isArray(savedRun.completed) ? savedRun.completed.filter(id => typeof id === 'string') : [] };
  } catch { reminderRun = { startedAt: null, completed: [] }; }
}

function persistSettings(next) {
  const dialogues = Array.isArray(next.dialogues)
    ? next.dialogues.filter(line => typeof line === 'string').map(line => line.trim()).filter(Boolean).slice(0, 100)
    : [];
  settings = {
    ...DEFAULTS,
    ...next,
    dialogues: dialogues.length ? dialogues : DEFAULTS.dialogues,
    reminders: normalizeReminders(next.reminders),
    attendanceReminders: normalizeAttendanceReminders(next.attendanceReminders),
    intervalMinutes: Math.max(0, Math.min(180, Number(next.intervalMinutes) || 0)),
  };
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), { mode: 0o600 });
  setLaunchAtLogin(settings.launchAtLogin);
  restartRotation();
  scheduleReminders();
  return settings;
}

function saveReminderRun() {
  fs.mkdirSync(path.dirname(reminderRunPath()), { recursive: true });
  fs.writeFileSync(reminderRunPath(), JSON.stringify(reminderRun, null, 2), { mode: 0o600 });
}

function reminderStatus() {
  const enabledCount = settings.reminders.length;
  const deliveredCount = settings.reminders.filter(reminder => reminderRun.completed.includes(reminder.id)).length;
  return { startedAt: reminderRun.startedAt, completed: reminderRun.completed, enabledCount, deliveredCount };
}

function broadcastReminderStatus() {
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send('companion:reminder-status', reminderStatus());
}

function scheduleReminders() {
  for (const timer of reminderTimers.values()) clearTimeout(timer);
  reminderTimers.clear();
  if (!reminderRun.startedAt || !settings.enabled) {
    broadcastReminderStatus();
    return;
  }
  const active = settings.reminders.filter(reminder => !reminderRun.completed.includes(reminder.id));
  if (!active.length) {
    reminderRun.startedAt = null;
    reminderRun.completed = [];
    saveReminderRun();
    broadcastReminderStatus();
    return;
  }
  for (const reminder of active) {
    const dueAt = reminderRun.startedAt + reminder.afterMinutes * 60_000;
    const timer = setTimeout(() => {
      reminderTimers.delete(reminder.id);
      if (!settings.enabled) return;
      sayText(reminder.message);
      reminderRun.completed.push(reminder.id);
      saveReminderRun();
      scheduleReminders();
    }, Math.max(0, dueAt - Date.now()));
    reminderTimers.set(reminder.id, timer);
  }
  broadcastReminderStatus();
}

function startReminders() {
  reminderRun = { startedAt: Date.now(), completed: [] };
  saveReminderRun();
  scheduleReminders();
}

function stopReminders() {
  for (const timer of reminderTimers.values()) clearTimeout(timer);
  reminderTimers.clear();
  reminderRun = { startedAt: null, completed: [] };
  saveReminderRun();
  broadcastReminderStatus();
}

function createOverlay(display, index) {
  const bounds = display.bounds;
  const window = new BrowserWindow({
    x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
    show: false, frame: false, transparent: true, resizable: false,
    movable: false, fullscreenable: false, skipTaskbar: true,
    alwaysOnTop: true, hasShadow: false, focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (process.platform === 'darwin') {
    window.setAlwaysOnTop(true, 'screen-saver');
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } else {
    window.setAlwaysOnTop(true);
  }
  window.setIgnoreMouseEvents(true, { forward: true });
  window.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
  window.webContents.on('did-finish-load', () => {
    window.webContents.send('companion:settings', settings);
    window.webContents.send('companion:monitor', index);
  });
  window.on('closed', () => { overlays = overlays.filter(item => item !== window); });
  return window;
}

function refreshOverlays() {
  overlays.forEach(window => window.close());
  overlays = screen.getAllDisplays().map(createOverlay);
  if (settings.enabled) overlays.forEach(window => window.showInactive());
}

function sayText(text, speak = settings.speak) {
  if (!settings.enabled) return;
  overlays.forEach((window, index) => window.webContents.send('companion:say', { text, speak: speak && index === 0 }));
}

function playNextDialogue() {
  if (!settings.enabled) return;
  const lines = settings.dialogues.length ? settings.dialogues : DEFAULTS.dialogues;
  const line = lines[dialogueIndex % lines.length];
  dialogueIndex += 1;
  sayText(line);
}

function restartRotation() {
  if (rotationTimer) clearInterval(rotationTimer);
  rotationTimer = null;
  if (settings.enabled && settings.intervalMinutes > 0) {
    rotationTimer = setInterval(playNextDialogue, settings.intervalMinutes * 60_000);
  }
}

function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    settingsWindow.webContents.send('companion:settings', settings);
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 480, height: 900, minWidth: 380, minHeight: 620,
    title: 'Milo Desktop Companion', show: false,
    backgroundColor: '#f7f7fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  settingsWindow.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWindow.once('ready-to-show', () => settingsWindow.show());
  settingsWindow.webContents.on('did-finish-load', () => settingsWindow.webContents.send('companion:settings', settings));
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'milo-tray.png');
  tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip('Milo Desktop Companion');
  tray.on('double-click', openSettings);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Say the next dialogue', click: playNextDialogue },
    { label: 'Start reminders from now', click: startReminders },
    { label: 'Settings…', click: openSettings },
    { type: 'separator' },
    { label: settings.enabled ? 'Hide companion' : 'Show companion', click: () => {
      settings = persistSettings({ ...settings, enabled: !settings.enabled });
      overlays.forEach(window => settings.enabled ? window.showInactive() : window.hide());
      createTrayMenu();
    } },
    { label: 'Quit Milo Companion', click: () => app.quit() },
  ]));
}

function createApplicationMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Milo Desktop Companion', submenu: [
      { label: 'Settings…', accelerator: 'Command+,', click: openSettings },
      { label: 'Say the next dialogue', accelerator: 'Command+Shift+S', click: playNextDialogue },
      { label: 'Start reminders from now', click: startReminders },
      { type: 'separator' },
      { role: 'quit', label: 'Quit Milo Companion' },
    ] },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]));
}

function createTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Say the next dialogue', click: playNextDialogue },
    { label: 'Start reminders from now', click: startReminders },
    { label: 'Settings…', click: openSettings },
    { type: 'separator' },
    { label: settings.enabled ? 'Hide companion' : 'Show companion', click: () => {
      settings = persistSettings({ ...settings, enabled: !settings.enabled });
      overlays.forEach(window => settings.enabled ? window.showInactive() : window.hide());
      createTrayMenu();
    } },
    { label: 'Quit Milo Companion', click: () => app.quit() },
  ]));
}

ipcMain.handle('companion:get-settings', () => settings);
ipcMain.handle('companion:get-reminder-status', () => reminderStatus());
ipcMain.handle('companion:get-cloud-status', async () => {
  if (!cloudSession) return { connected: false };
  try { return await syncCloudAttendance(); }
  catch (error) { return { connected: true, email: cloudUser?.email, error: error.message }; }
});
ipcMain.handle('companion:sign-in', async (_event, credentials) => {
  const response = await fetch(`${cloudConfig.url}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: cloudConfig.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: String(credentials?.email || '').trim(), password: String(credentials?.password || '') }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.msg || data?.message || 'Could not sign in. Check your email and password.');
  if (!data.user || data.user.is_anonymous) throw new Error('Sign in with a registered Milo account to sync attendance.');
  saveCloudSession({ ...data, expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600) });
  startAttendancePolling();
  return await syncCloudAttendance();
});
ipcMain.handle('companion:sign-out', () => { clearCloudSession(); return { connected: false }; });
ipcMain.handle('companion:sync-attendance', () => syncCloudAttendance());
ipcMain.handle('companion:start-reminders', () => { startReminders(); return reminderStatus(); });
ipcMain.handle('companion:stop-reminders', () => { stopReminders(); return reminderStatus(); });
ipcMain.handle('companion:save-settings', (_event, next) => {
  const safe = {
    dialogues: Array.isArray(next?.dialogues) ? next.dialogues.filter(line => typeof line === 'string').map(line => line.slice(0, 500)) : settings.dialogues,
    reminders: normalizeReminders(next?.reminders),
    attendanceReminders: normalizeAttendanceReminders(next?.attendanceReminders),
    intervalMinutes: Number(next?.intervalMinutes),
    speak: Boolean(next?.speak),
    enabled: Boolean(next?.enabled),
    launchAtLogin: Boolean(next?.launchAtLogin),
  };
  settings = persistSettings(safe);
  overlays.forEach(window => {
    settings.enabled ? window.showInactive() : window.hide();
    window.webContents.send('companion:settings', settings);
  });
  createTrayMenu();
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send('companion:saved', settings);
  return settings;
});
ipcMain.on('companion:play', playNextDialogue);

app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock.hide();
  loadSettings();
  loadCloudSession();
  setLaunchAtLogin(settings.launchAtLogin);
  refreshOverlays();
  createTray();
  createApplicationMenu();
  restartRotation();
  scheduleReminders();
  startAttendancePolling();
  screen.on('display-added', refreshOverlays);
  screen.on('display-removed', refreshOverlays);
  const openedAtLogin = (process.platform === 'darwin' || process.platform === 'win32')
    ? app.getLoginItemSettings().wasOpenedAtLogin
    : false;
  if (firstRun && !openedAtLogin) openSettings();
});

app.on('before-quit', () => { if (rotationTimer) clearInterval(rotationTimer); });
