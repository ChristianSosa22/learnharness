# Local desktop launcher (Windows)

Status: **approved 2026-10-24; not started.** Local convenience; not submitted upstream.

## Goal

One desktop shortcut that opens LearnHarness **built from this repo**, including
every local change, without typing commands. It rebuilds only when the code has
changed, and it shares all data with the installed (downloaded) app.

## Decisions (owner, 2026-10-24)

| Topic | Decision |
|---|---|
| What runs | **Real local build** — an unpacked packaged app (`electron-builder --dir`), not `next dev`. |
| Updates | **Updater disabled in the local build** (new opt-out in `electron/main.cjs`). |
| Build fails | **Show the error and offer the last working build** (staging folder, swapped only on success). |
| Checks | **Build + boot smoke only** (no full test suite / lint per rebuild). |
| Source | **The current checkout**, including uncommitted edits. |

## Why data sharing needs no configuration

A packaged build names itself `LearnHarness` (`electron/main.cjs:50`), so it uses
`%APPDATA%\LearnHarness` — the installed app's folder: chats, graph, jobs,
settings (`data\`), API keys (`auth.json`) and the ChatGPT login
(`chatgpt-credentials.json`). Electron's single-instance lock is tied to that
folder, so **the local build and the installed app cannot run at the same
time**, which protects the shared files.

## Files

| File | Role |
|---|---|
| `scripts/local-desktop/launch.ps1` *(new)* | what the shortcut runs |
| `scripts/local-desktop/install-shortcut.ps1` *(new)* | one-time: creates the desktop shortcut |
| `electron/main.cjs` | `LH_DISABLE_UPDATER=1` → log `auto-update: local build — updater disabled` and return, before `electron-updater` loads |
| `.gitignore` | `dist-local/` |

## Shortcut

`%USERPROFILE%\Desktop\LearnHarness (Local).lnk` → `powershell.exe -NoProfile
-ExecutionPolicy Bypass -File <repo>\scripts\local-desktop\launch.ps1`, icon
`build\icon.ico`, working folder = repo. `install-shortcut.ps1` is re-runnable
(it overwrites only that one `.lnk`).

## `launch.ps1` flow

1. **Already open?** If a `LearnHarness.exe` is running:
   - from `dist-local\` → just start the exe again (the single-instance lock
     focuses the open window) and exit;
   - from anywhere else (the installed app) → print "The installed LearnHarness
     is open. Close it, then click the shortcut again." and wait for a key. (A
     second launch would only focus the installed app, and you might think you
     are in the local one.)
2. **Is `next dev` running from this repo?** (port 3000 owned by a `node`
   process whose command line includes this repo) → ask the user to stop it
   (both write `.next\`).
3. **Fingerprint the source**: SHA-256 of `git rev-parse HEAD` +
   `git diff HEAD --binary` + the contents of untracked, non-ignored files
   (`git ls-files --others --exclude-standard`). Compare with
   `dist-local\build-stamp.txt`. Equal and `dist-local\win-unpacked\LearnHarness.exe`
   exists → skip to step 6.
4. **Dependencies**: if `package-lock.json`'s hash differs from the stamp's
   recorded lock hash → `npm ci`.
5. **Build into staging** (`dist-local-staging\`), printing each step:
   1. `npx next build`
   2. `node scripts/build-server.mjs`
   3. `node scripts/smoke-server.mjs --electron`
   4. `npx electron-builder --win --x64 --dir --publish never -c.directories.output=dist-local-staging`

   On success: replace `dist-local\` with the staging output and write the stamp.
   On failure: keep the console open with the error, print "Build failed. Open the
   last working build instead? [Y/N]" (only if one exists), and leave
   `dist-local\` untouched.
6. **Launch** `dist-local\win-unpacked\LearnHarness.exe` with
   `LH_DISABLE_UPDATER=1`, detached, then close the console. The console stays
   open only while it is building or when there is an error.

Expected times: first build several minutes; unchanged launches about 1–2 s
before the window appears.

## Caveats

- **Version skew.** If the installed app auto-updates to a newer upstream release
  than this repo, it may write data the local build doesn't know. Keep the repo
  current (`git pull upstream main`); the next launch rebuilds.
- **Claude Code models in shared settings.** If a model slot is set to
  `claude-code`, the installed app (which lacks the provider) refuses that turn
  until another model is picked. Learning content (chats, graph) is unaffected.
- Building a broken checkout falls back to the last good build only if you
  accept the prompt.
- `npm test` / `npm run desktop:dev` still use Unix-style env syntax and need
  Git Bash as npm's script shell; the launcher does not depend on them.

## Verification

- `install-shortcut.ps1` creates the shortcut with the right target and icon.
- Clean first build launches the window; the app log shows `auto-update: local
  build — updater disabled` and `data dir: …\AppData\Roaming\LearnHarness\data`.
- Second click with no changes skips the build.
- A one-line source edit triggers a rebuild; a deliberate type error shows the
  error + Y/N prompt, and "Y" opens the previous build.
- With the installed app open, the shortcut shows the "close it first" message.
- Chats created in the installed app appear in the local build and vice versa.
