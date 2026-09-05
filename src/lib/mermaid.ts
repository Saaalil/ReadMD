export function mermaidFigureHtml(source: string, attrs = ""): string {
  return `<figure class="diagram diagram-mermaid"${attrs}><figcaption>Mermaid</figcaption><pre class="mermaid">${escapeHtml(source)}</pre></figure>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

let counter = 0;

export async function renderMermaid(root: HTMLElement, dark: boolean): Promise<void> {
  const nodes = [...root.querySelectorAll<HTMLElement>("figure.diagram-mermaid pre.mermaid")];
  if (nodes.length === 0) return;
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default" });
  for (const node of nodes) {
    const figure = node.closest("figure");
    if (!figure) continue;
    const source = node.textContent ?? "";
    if (!source.trim()) continue;
    const fresh =
      figure.querySelector(".mermaid-svg") == null ||
      figure.getAttribute("data-mermaid-source") !== source ||
      figure.getAttribute("data-mermaid-theme") !== String(dark);
    if (!fresh) continue;
    try {
      const { svg } = await mermaid.render(`readmd-mermaid-${(counter += 1)}`, source);
      let slot = figure.querySelector(".mermaid-svg");
      if (!slot) {
        slot = document.createElement("div");
        slot.className = "mermaid-svg";
        node.after(slot);
      }
      slot.innerHTML = svg;
      figure.setAttribute("data-mermaid-source", source);
      figure.setAttribute("data-mermaid-theme", String(dark));
      figure.classList.remove("mermaid-error");
      node.style.display = "none";
    } catch {
      figure.classList.add("mermaid-error");
      node.style.display = "";
    }
  }
}
