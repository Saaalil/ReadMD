# ReadMD

Native Windows desktop app for opening, editing, and exporting Markdown, HTML, and text files. Local-first — not a website.

## Download (Windows)

Latest: **[0.2.2 on GitHub Releases](https://github.com/Saaalil/ReadMD/releases)** — that is the install page, same idea as [MarkEdit’s releases](https://github.com/MarkEdit-app/MarkEdit/releases).

| File | What it is |
| --- | --- |
| `readmd_*_x64-setup.exe` | NSIS installer (recommended) |
| `readmd_*_x64_en-US.msi` | MSI installer |
| `readmd.exe` | Portable app binary |

Run the setup exe. After install, double-click `.md`, `.txt`, or `.html` files to open them in ReadMD.

Tag a version (`v0.2.2`) to cut a new release. GitHub Actions builds Windows installers and attaches them to the release.

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
