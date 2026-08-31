# ReadMD - Simple , small - just does the work Open any Md , txt files easily 

Native desktop app for opening, editing, and exporting Markdown, HTML, and text files. Local-first — not a website. Windows and Linux.

## Download

Latest: **[GitHub Releases](https://github.com/Saaalil/ReadMD/releases)**

### Windows

| File | What it is |
| --- | --- |
| `readmd_*_x64-setup.exe` | Installer (recommended) |
| `readmd_*_x64_en-US.msi` | MSI installer |
| `readmd.exe` | Portable app binary |

### Linux

| File | What it is |
| --- | --- |
| `readmd_*_amd64.AppImage` | Portable app (recommended) |
| `readmd_*_amd64.deb` | Debian / Ubuntu package |

Make the AppImage executable: `chmod +x readmd_*.AppImage`, then run it.

Installed copies check GitHub Releases for newer versions and show an **Update now** bar. Command palette → **Check for updates**.

Tag a version (`v0.3.2`) to cut a new release. GitHub Actions builds Windows and Linux installers, signs updater artifacts, and publishes `latest.json`.

## Features

- Reader, split, and editor views with live preview
- Images from https URLs and from files next to the saved document
- Split-view scroll sync between editor and preview
- Outline, command palette (`Ctrl+K`), find and replace (`Ctrl+F` / `Ctrl+H`)
- Idle auto-save for files already on disk
- In-app updates from GitHub Releases
- Export PDF, DOCX, and clean TXT
- HTML files and raw HTML in Markdown
- Remembers recent files and last folders
- Offline, no account
- <img width="1901" height="1023" alt="image" src="https://github.com/user-attachments/assets/182a30c2-890c-49bf-8bc9-87abadb64017" />
<img width="1895" height="993" alt="image" src="https://github.com/user-attachments/assets/2850192c-c260-4b6f-b4d8-9f6e5257916f" />
<img width="1914" height="1026" alt="image" src="https://github.com/user-attachments/assets/9d81a869-06a2-4f99-a0fa-5c4a6e6fcd75" />




## Develop

Needs Node.js and [Rust](https://rustup.rs/). On Linux also install WebKitGTK 4.1 (see the release workflow).

```powershell
npm.cmd install
npm.cmd run desktop:dev
```

Build installers:

```powershell
npm.cmd run desktop:build
```

Frontend-only (browser fallback):

```powershell
npm.cmd run dev
```
