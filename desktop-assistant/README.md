# Milo Desktop Companion

An independent desktop companion for Windows, macOS, and Linux. Milo places a transparent, click-through animated cat overlay on each display, speaks user-written Malayalam dialogue through an installed system voice when available, and offers timed reminders from the system tray or menu bar.

## Run locally

```sh
cd desktop-assistant
npm install
npm start
```

Use the Milo tray or menu-bar icon to edit dialogue, add multiple elapsed-time reminders (such as 1 hour and 8 hours), set an automatic appearance interval, preview a line, enable launch at sign-in, or hide/quit the companion. Click **Start reminders from now** to begin the reminder countdown. The countdown resumes after Milo reopens. Dialogue, reminders, and preferences are stored locally in the operating system's app data folder.

In settings, sign in with the same Milo account used in the web app to sync today's punch sessions and work target. Account access uses the public Supabase URL and anon key with the account's normal row-level security; the password is sent only to Supabase for sign-in and is not stored by the desktop app. The returned session is encrypted with the operating system's secure storage. Work-time animation reminders are measured against net worked time, so punched-out breaks do not advance them. The companion syncs attendance while it is running and checks milestones every 30 seconds. Attendance created only in offline guest mode on another device is not available until that history has been transferred into the signed-in account.

## Build installers

Build on the target operating system:

```sh
npm run package:mac       # macOS DMG and ZIP
npm run package:win       # Windows installer and ZIP
npm run package:linux    # Linux AppImage and Debian package
```

Installers are written to `dist/`. Use `npm run package:mac:universal` on macOS to create a universal Intel and Apple Silicon build. The Windows NSIS installer lets the user choose the install location and creates Start Menu and desktop shortcuts. Linux launch-at-sign-in uses the user's XDG autostart folder.

The GitHub Actions workflow in `.github/workflows/milo-desktop.yml` builds the app on separate macOS, Windows, and Linux runners and uploads each platform's installers as downloadable workflow artifacts. Builds are unsigned: Windows and macOS may show an operating-system warning until the app is code-signed. Linux desktop-overlay behavior depends on the desktop compositor; X11 generally allows overlays, while Wayland can restrict windows from appearing above other applications. Speech quality depends on the voices installed on each system. Mohanlal's likeness or voice is not included; use licensed media or permission before adding it.
