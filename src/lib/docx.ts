import type { MarkdownBlock, ParsedMarkdown } from "./markdown";

interface ZipEntry {
  path: string;
  data: Uint8Array;
  crc: number;
  offset: number;
}

const encoder = new TextEncoder();

export function markdownToDocx(parsed: ParsedMarkdown): Blob {
  const entries = [
    file("[Content_Types].xml", contentTypesXml()),
    file("_rels/.rels", relsXml()),
    file("word/_rels/document.xml.rels", documentRelsXml()),
    file("word/styles.xml", stylesXml()),
    file("word/document.xml", documentXml(parsed))
  ];

  const bytes = zip(entries);
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);

  return new Blob([body], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  });
}

function documentXml(parsed: ParsedMarkdown): string {
  const body = parsed.blocks
    .filter((block) => block.type !== "frontmatter")
    .map(blockToOpenXml)
    .join("");

  return xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${body}
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`);
}

function blockToOpenXml(block: MarkdownBlock): string {
  switch (block.type) {
    case "heading":
      return paragraph(block.text, `Heading${block.depth}`);
    case "paragraph":
      return paragraph(block.lines.join(" "));
    case "quote":
      return paragraph(block.lines.join(" "), "Quote");
    case "code":
      return paragraph(block.lines.join("\n"), "Code");
    case "list":
      return block.items
        .map((item, index) => {
          const task = item.match(/^\[([ xX])\]\s*(.*)$/);
          if (task) {
            const done = task[1].toLowerCase() === "x";
            const text = stripInline(task[2] ?? "");
            return paragraph(done ? `${text} (done)` : text);
          }
          return paragraph(`${block.ordered ? `${index + 1}.` : "-"} ${stripInline(item)}`);
        })
        .join("");
    case "table":
      return block.rows.map((row) => paragraph(row.join("    "))).join("");
    case "html":
      return paragraph(block.lines.join(" "));
    case "rule":
      return paragraph("");
    case "frontmatter":
      return "";
  }
}

function paragraph(text: string, style?: string): string {
  const styleXml = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${styleXml}<w:r><w:t xml:space="preserve">${escapeXml(stripInline(text))}</w:t></w:r></w:p>`;
}

function contentTypesXml(): string {
  return xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`);
}

function relsXml(): string {
  return xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
}

function documentRelsXml(): string {
  return xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`);
}

function stylesXml(): string {
  return xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Segoe UI" w:hAnsi="Segoe UI"/><w:sz w:val="22"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360"/></w:pPr><w:rPr><w:i/><w:color w:val="555555"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="Cascadia Code" w:hAnsi="Cascadia Code"/><w:sz w:val="20"/></w:rPr></w:style>
</w:styles>`);
}

function zip(files: Array<{ path: string; data: Uint8Array }>): Uint8Array {
  const entries: ZipEntry[] = [];
  const localParts: Uint8Array[] = [];
  let offset = 0;

  for (const source of files) {
    const name = encoder.encode(source.path);
    const crc = crc32(source.data);
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(source.data.length),
      u32(source.data.length),
      u16(name.length),
      u16(0),
      name,
      source.data
    ]);
    entries.push({ ...source, crc, offset });
    localParts.push(local);
    offset += local.length;
  }

  const centralParts = entries.map((entry) => {
    const name = encoder.encode(entry.path);
    return concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(entry.crc),
      u32(entry.data.length),
      u32(entry.data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(entry.offset),
      name
    ]);
  });
  const central = concat(centralParts);
  const end = concat([u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(central.length), u32(offset), u16(0)]);

  return concat([...localParts, central, end]);
}

function file(path: string, content: string): { path: string; data: Uint8Array } {
  return { path, data: encoder.encode(content) };
}

function u16(value: number): Uint8Array {
  return new Uint8Array([value & 255, (value >> 8) & 255]);
}

function u32(value: number): Uint8Array {
  return new Uint8Array([value & 255, (value >> 8) & 255, (value >> 16) & 255, (value >> 24) & 255]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function xml(value: string): string {
  return value.replace(/>\s+</g, "><").trim();
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function stripInline(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim();
}
