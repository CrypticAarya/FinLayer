# FinLayer Desktop — Developer Workflow & Release Guide

This document outlines the standard engineering workflow for developing, testing, and distributing the FinLayer Windows desktop connector app.

---

## 1. Local Development (`npm run dev`)

Developers do **NOT** need to package `FinLayerSetup.exe` to test code or renderer changes.

### Running in Development
From the repository root:
```bash
npm run dev:app
```
Or directly from `apps/windows-app`:
```bash
cd apps/windows-app
npm run dev
```

### How It Works:
- `npm run dev` executes `node build.mjs` (which bundles TypeScript in ~50ms using esbuild) and immediately launches the Electron executable against `dist/main.js` and `public/index.html`.
- **Live HTML/CSS/JS Updates**: Since Electron loads `public/index.html` directly from disk in development, any change to `renderer.js`, `index.html`, or `styles.css` is immediately reflected by pressing `Ctrl+R` (or `Cmd+R`) or closing and running `npm run dev`.
- **DevTools Inspection**: Press **F12** or **Ctrl+Shift+I** anytime in the application window to open Chrome DevTools for console inspection and network debugging.

---

## 2. Typechecking and Building Locally

Run TypeScript verification:
```bash
npm run typecheck:app
```

Compile TypeScript bundles:
```bash
npm --prefix apps/windows-app run build:ts
```

Build the native Windows installer (`FinLayerSetup.exe`) and update metadata (`latest.yml`):
```bash
npm run build:app
```
Artifacts will be written to `apps/windows-app/release/`:
- `FinLayerSetup.exe` — Self-extracting NSIS installer
- `latest.yml` — Cryptographic hash and version metadata for auto-updater
- `FinLayerSetup.exe.blockmap` — Differential delta update blockmap

---

## 3. Production Release Workflow

Releases are fully automated through GitHub Actions and GitHub Releases. Existing installed apps receive updates silently without reinstalling.

### Release Steps:

1. **Update Version**:
   Edit `apps/windows-app/package.json` and bump the `"version"` field:
   ```json
   {
     "name": "finlayer-windows-app",
     "version": "1.0.1"
   }
   ```

2. **Commit Changes**:
   ```bash
   git add apps/windows-app/package.json
   git commit -m "chore(release): v1.0.1"
   ```

3. **Tag & Push**:
   ```bash
   git tag v1.0.1
   git push origin main --tags
   ```

4. **Automated CI/CD Build**:
   - The GitHub Actions workflow `.github/workflows/windows-build.yml` triggers on the `v1.0.1` tag.
   - It installs dependencies, verifies types, compiles the application, and builds `FinLayerSetup.exe` and `latest.yml`.
   - The release assets are published to GitHub Releases under tag `v1.0.1`.

---

## 4. Automatic Updates (`electron-updater`)

- **Silent Background Check**: When the app launches, it automatically checks the update server/GitHub Releases for newer versions.
- **Silent Download**: If a newer version is found, `electron-updater` downloads the update package in the background with zero user disruption.
- **Restart & Update Banner**: Once downloaded, a banner appears in the app:
  ```
  Update Ready (v1.0.1) [Restart & Install]
  ```
- **State Preservation Guarantee**:
  - All user configurations, connector state, device IDs, and company mappings are permanently stored in `%APPDATA%/FinLayer/` (`connector-state.json`).
  - The installer explicitly sets `deleteAppDataOnUninstall: false` and never touches `%APPDATA%/FinLayer/` during updates or reinstallations.

---

## 5. Custom Update URL Override (Testing & Staging)

For staging or local test verification, you can override the update source using the environment variable:
```bash
FINLAYER_UPDATE_URL=http://your-update-server/finlayer
```
If not specified, `electron-updater` defaults to `CrypticAarya/FinLayer` on GitHub Releases.
