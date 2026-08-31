# ReadMD

Native Windows desktop app for opening, editing, and exporting Markdown, HTML, and text files. Local-first — not a website.

## Download (Windows)

Latest build: **0.2.1**

| File | What it is |
| --- | --- |
| [readmd_0.2.1_x64-setup.exe](release/readmd_0.2.1_x64-setup.exe) | Installer (recommended) |
| [readmd_0.2.1_x64_en-US.msi](release/readmd_0.2.1_x64_en-US.msi) | MSI installer |
| [readmd.exe](release/readmd.exe) | Portable app binary |

Run the setup exe. After install, double-click `.md`, `.txt`, or `.html` files to open them in ReadMD.

## Features

- Reader, split, and editor views with live preview
- Outline, command palette (`Ctrl+K`), find (`Ctrl+F`)
- Export PDF, DOCX, and clean TXT
- HTML files and raw HTML in Markdown
- Remembers recent files and last folders
- Offline, no account

## Develop

Needs Node.js and [Rust](https://rustup.rs/).

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
