<script lang="ts">
  interface Props {
    onDone: () => void;
  }

  let { onDone }: Props = $props();
  let step = $state(0);
  let dir = $state(1);

  const steps = [
    {
      kicker: "ReadMD",
      title: "Markdown that lives on your machine.",
      lead: "This is a native desktop app — not a website. Files never leave your PC unless you export them.",
      points: [
        { label: "Windows and Linux", detail: "Installers, portable builds, no account." },
        { label: "Offline first", detail: "Open .md, .txt, and .html files locally." },
        { label: "Yours", detail: "No telemetry. No cloud lock-in." }
      ]
    },
    {
      kicker: "Views",
      title: "Write, split, or just read.",
      lead: "Three modes. Same document. The preview updates as you type, including images and math.",
      points: [
        { label: "Reader  Ctrl+1", detail: "Rendered Markdown, full width." },
        { label: "Split  Ctrl+2", detail: "Editor and preview, scroll stays lined up." },
        { label: "Editor  Ctrl+3", detail: "Source only, when you want the raw file." }
      ]
    },
    {
      kicker: "Speed",
      title: "Jump, search, command.",
      lead: "Everything important is a shortcut. The palette is the fastest way to discover the rest.",
      points: [
        { label: "Ctrl+K", detail: "Command palette — open, export, theme, updates." },
        { label: "Ctrl+B", detail: "Outline — click a heading to jump." },
        { label: "Ctrl+F / Ctrl+H", detail: "Find, then replace one or all." }
      ]
    },
    {
      kicker: "Files",
      title: "It remembers where you were.",
      lead: "Open from the picker, recents, drag-and-drop, or double-click a file in Explorer.",
      points: [
        { label: "Auto-save", detail: "If the file is already on disk, it saves after you pause." },
        { label: "Images", detail: "Paste or drop. Stored as a short img/ link, not base64." },
        { label: "Last folders", detail: "Open, save, and export start where you left off." }
      ]
    },
    {
      kicker: "Ship it",
      title: "Export and stay current.",
      lead: "When you are done writing, get a clean file out. When we ship, the app can update itself.",
      points: [
        { label: "PDF  Ctrl+P", detail: "Print-ready from the live preview." },
        { label: "DOCX and TXT", detail: "Word document, or Markdown stripped to prose." },
        { label: "Update now", detail: "A bar appears when a newer GitHub release is out. Install in-app." }
      ]
    }
  ];

  let last = $derived(step === steps.length - 1);
  let current = $derived(steps[step]!);

  function go(next: number): void {
    if (next < 0) return;
    if (next >= steps.length) {
      onDone();
      return;
    }
    dir = next > step ? 1 : -1;
    step = next;
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onDone();
      return;
    }
    if (event.key === "ArrowRight" || event.key === "Enter") {
      event.preventDefault();
      go(step + 1);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(step - 1);
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="welcome" style="--dir: {dir}" role="dialog" aria-modal="true" aria-label="Welcome to readmd">
  <div class="welcome-progress" aria-hidden="true">
    <span style="width: {((step + 1) / steps.length) * 100}%"></span>
  </div>

  <div class="welcome-frame">
    {#key step}
      <section class="welcome-stage">
        <p class="welcome-kicker">{current.kicker}</p>
        <h1>{current.title}</h1>
        <p class="welcome-lead">{current.lead}</p>
        <ul>
          {#each current.points as point, index (point.label)}
            <li style="--i: {index}">
              <strong>{point.label}</strong>
              <span>{point.detail}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/key}

    <footer class="welcome-nav">
      <button type="button" class="welcome-skip" onclick={onDone}>Skip</button>
      <div class="welcome-dots" aria-hidden="true">
        {#each steps as _, index}
          <button type="button" class:on={index === step} onclick={() => go(index)} tabindex="-1"></button>
        {/each}
      </div>
      <button type="button" class="primary" onclick={() => go(step + 1)}>
        {last ? "Start writing" : "Continue"}
      </button>
    </footer>
  </div>
</div>

<style>
  .welcome {
    position: fixed;
    inset: 0;
    z-index: 80;
    display: grid;
    grid-template-rows: 3px 1fr;
    background: var(--bg);
    color: var(--text);
  }

  .welcome-progress {
    background: var(--border);
  }

  .welcome-progress span {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 320ms var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1));
  }

  .welcome-frame {
    display: grid;
    grid-template-rows: 1fr auto;
    width: min(640px, calc(100% - 48px));
    margin: 0 auto;
    min-height: 0;
  }

  .welcome-stage {
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 48px 0 24px;
    min-height: 0;
  }

  .welcome-kicker {
    margin: 0 0 12px;
    color: var(--muted);
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  h1 {
    margin: 0 0 14px;
    font-size: clamp(28px, 4vw, 40px);
    font-weight: 650;
    line-height: 1.15;
    letter-spacing: -0.03em;
  }

  .welcome-lead {
    margin: 0 0 28px;
    max-width: 38em;
    color: var(--muted);
    font-size: 16px;
    line-height: 1.55;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 10px;
  }

  li {
    display: grid;
    gap: 2px;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-raised);
  }

  li strong {
    font-size: 13px;
    font-weight: 650;
  }

  li span {
    color: var(--muted);
    font-size: 13px;
    line-height: 1.4;
  }

  .welcome-nav {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 0 36px;
  }

  .welcome-skip {
    color: var(--muted);
  }

  .welcome-dots {
    display: flex;
    flex: 1;
    justify-content: center;
    gap: 6px;
  }

  .welcome-dots button {
    width: 7px;
    height: 7px;
    min-width: 7px;
    padding: 0;
    border-radius: 99px;
    background: var(--border-strong);
  }

  .welcome-dots button.on {
    width: 18px;
    background: var(--text);
  }

  .welcome-nav .primary {
    min-width: 132px;
  }

  @media (prefers-reduced-motion: no-preference) {
    .welcome-stage {
      animation: welcome-in 420ms cubic-bezier(0.16, 1, 0.3, 1) both;
    }

    .welcome-kicker,
    h1,
    .welcome-lead,
    li {
      animation: welcome-rise 480ms cubic-bezier(0.16, 1, 0.3, 1) both;
    }

    h1 {
      animation-delay: 40ms;
    }

    .welcome-lead {
      animation-delay: 90ms;
    }

    li {
      animation-delay: calc(140ms + var(--i, 0) * 55ms);
    }

    .welcome-dots button {
      transition:
        width 200ms cubic-bezier(0.16, 1, 0.3, 1),
        background-color 200ms cubic-bezier(0.2, 0, 0, 1);
    }
  }

  @keyframes welcome-in {
    from {
      opacity: 0;
      transform: translate3d(calc(var(--dir, 1) * 32px), 0, 0);
    }
    to {
      opacity: 1;
      transform: translate3d(0, 0, 0);
    }
  }

  @keyframes welcome-rise {
    from {
      opacity: 0;
      transform: translate3d(0, 10px, 0);
    }
    to {
      opacity: 1;
      transform: translate3d(0, 0, 0);
    }
  }
</style>
