const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('miloCompanion', {
  getSettings: () => ipcRenderer.invoke('companion:get-settings'),
  getReminderStatus: () => ipcRenderer.invoke('companion:get-reminder-status'),
  getCloudStatus: () => ipcRenderer.invoke('companion:get-cloud-status'),
  signIn: credentials => ipcRenderer.invoke('companion:sign-in', credentials),
  signOut: () => ipcRenderer.invoke('companion:sign-out'),
  syncAttendance: () => ipcRenderer.invoke('companion:sync-attendance'),
  saveSettings: settings => ipcRenderer.invoke('companion:save-settings', settings),
  startReminders: () => ipcRenderer.invoke('companion:start-reminders'),
  stopReminders: () => ipcRenderer.invoke('companion:stop-reminders'),
  play: () => ipcRenderer.send('companion:play'),
  onSettings: callback => {
    const listener = (_event, settings) => callback(settings);
    ipcRenderer.on('companion:settings', listener);
    return () => ipcRenderer.removeListener('companion:settings', listener);
  },
  onSay: callback => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('companion:say', listener);
    return () => ipcRenderer.removeListener('companion:say', listener);
  },
  onSaved: callback => {
    const listener = (_event, settings) => callback(settings);
    ipcRenderer.on('companion:saved', listener);
    return () => ipcRenderer.removeListener('companion:saved', listener);
  },
  onReminderStatus: callback => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('companion:reminder-status', listener);
    return () => ipcRenderer.removeListener('companion:reminder-status', listener);
  },
  onAttendance: callback => {
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on('companion:attendance', listener);
    return () => ipcRenderer.removeListener('companion:attendance', listener);
  },
  onAttendanceError: callback => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('companion:attendance-error', listener);
    return () => ipcRenderer.removeListener('companion:attendance-error', listener);
  },
});
