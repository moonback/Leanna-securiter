const Leanna_THEME_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');

  :root {
    --r-background-color: #080c14;
    --r-main-font: 'Inter', 'Segoe UI', system-ui, sans-serif;
    --r-main-font-size: 36px;
    --r-main-color: #cbd5e1;
    --r-block-margin: 16px;
    --r-heading-margin: 0 0 16px 0;
    --r-heading-font: 'Inter', 'Segoe UI', system-ui, sans-serif;
    --r-heading-color: #f1f5f9;
    --r-heading-line-height: 1.15;
    --r-heading-letter-spacing: -0.03em;
    --r-heading-text-transform: none;
    --r-heading-text-shadow: none;
    --r-heading-font-weight: 800;
    --r-h1-size: 1.9em;
    --r-h2-size: 1.3em;
    --r-h3-size: 1.0em;
    --r-link-color: #60a5fa;
    --r-link-color-hover: #93c5fd;
    --r-selection-background-color: rgba(99,102,241,0.35);
    --r-selection-color: #fff;
    --blue: #3b82f6;
    --purple: #8b5cf6;
    --cyan: #06b6d4;
    --glow: rgba(59,130,246,0.18);
  }

  .reveal-viewport {
    background: #080c14;
    background-image:
      radial-gradient(ellipse 80% 50% at 20% -10%, rgba(59,130,246,0.12) 0%, transparent 60%),
      radial-gradient(ellipse 60% 40% at 80% 110%, rgba(139,92,246,0.10) 0%, transparent 55%);
  }
  .reveal { background: transparent; }

  .reveal .slides section::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image: radial-gradient(circle, rgba(148,163,184,0.06) 1px, transparent 1px);
    background-size: 28px 28px;
    pointer-events: none;
    z-index: 0;
  }
  .reveal .slides section > * { position: relative; z-index: 1; }

  .reveal .slides section {
    text-align: left;
    padding: 28px 44px;
    box-sizing: border-box;
    overflow: visible;
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  .reveal .slides section.title-slide {
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 60px;
  }

  .reveal h1 {
    font-size: var(--r-h1-size);
    font-weight: 800;
    letter-spacing: -0.04em;
    background: linear-gradient(135deg, #60a5fa 0%, #a78bfa 50%, #67e8f9 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    line-height: 1.1;
    margin-bottom: 0;
  }
  .reveal h2 {
    font-size: var(--r-h2-size);
    font-weight: 700;
    color: #f1f5f9;
    letter-spacing: -0.03em;
    margin-bottom: 0;
  }
  .reveal h3 { font-size: var(--r-h3-size); font-weight: 600; color: #94a3b8; letter-spacing: -0.01em; margin-bottom: 8px; text-transform: uppercase; font-size: 0.6em; letter-spacing: 0.12em; }
  .reveal p { color: #94a3b8; font-size: 0.82em; line-height: 1.65; margin-bottom: 0.6em; }

  .reveal ul, .reveal ol { margin-left: 0; padding-left: 0; list-style: none; }
  .reveal ul li, .reveal ol li {
    color: #cbd5e1;
    font-size: 0.82em;
    line-height: 1.45;
    margin-bottom: 0.38em;
    padding-left: 1.4em;
    position: relative;
  }
  .reveal ul li::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0.6em;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--blue), var(--purple));
  }
  .reveal ol { counter-reset: ol-counter; }
  .reveal ol li::before {
    content: counter(ol-counter);
    counter-increment: ol-counter;
    position: absolute;
    left: 0;
    top: 0.05em;
    width: 1.1em;
    height: 1.1em;
    border-radius: 50%;
    background: rgba(59,130,246,0.15);
    border: 1px solid rgba(59,130,246,0.35);
    color: #60a5fa;
    font-size: 0.72em;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
  }

  .reveal strong { color: #93c5fd; font-weight: 600; }
  .reveal em { color: #a78bfa; font-style: italic; }
  .reveal code {
    background: rgba(99,102,241,0.12);
    border: 1px solid rgba(99,102,241,0.28);
    border-radius: 5px;
    padding: 1px 7px;
    color: #c4b5fd;
    font-size: 0.82em;
    font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  }
  .reveal pre {
    background: #0d1117;
    border: 1px solid #21262d;
    border-radius: 12px;
    padding: 20px 24px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04);
    margin: 12px 0;
  }
  .reveal pre code {
    background: transparent;
    border: none;
    padding: 0;
    color: #c9d1d9;
    font-size: 0.78em;
    display: block;
    line-height: 1.6;
  }

  .reveal blockquote {
    background: linear-gradient(135deg, rgba(59,130,246,0.07), rgba(139,92,246,0.05));
    border: 1px solid rgba(59,130,246,0.2);
    border-left: 3px solid var(--blue);
    border-radius: 0 10px 10px 0;
    padding: 14px 20px;
    color: #94a3b8;
    font-style: normal;
    font-size: 0.8em;
    margin: 12px 0;
    box-shadow: 0 2px 12px rgba(59,130,246,0.06);
  }
  .reveal blockquote::before {
    content: '"';
    display: block;
    font-size: 2em;
    line-height: 0.5;
    color: rgba(59,130,246,0.3);
    margin-bottom: 8px;
    font-family: Georgia, serif;
  }

  .reveal .progress { background: rgba(255,255,255,0.05); height: 3px; }
  .reveal .progress span { background: linear-gradient(90deg, var(--blue), var(--purple)); transition: width 0.4s ease; }
  .reveal .controls button { color: rgba(99,130,190,0.7) !important; }
  .reveal .controls button:hover { color: var(--blue) !important; }
  .reveal .slide-number { color: rgba(148,163,184,0.4) !important; font-size: 11px !important; font-family: var(--r-main-font) !important; letter-spacing: 0.05em; }

  .accent-bar {
    width: 48px;
    height: 3px;
    background: linear-gradient(90deg, var(--blue), var(--purple));
    border-radius: 2px;
    margin: 10px 0 20px 0;
    box-shadow: 0 0 12px rgba(59,130,246,0.5);
  }
  .title-slide .accent-bar { margin: 10px auto 20px; }

  .tag {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: rgba(59,130,246,0.1);
    border: 1px solid rgba(59,130,246,0.25);
    color: #60a5fa;
    border-radius: 100px;
    padding: 4px 14px;
    font-size: 0.32em;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    margin-bottom: 20px;
  }
  .tag::before { content: '●'; font-size: 0.8em; color: #3b82f6; }

  .slide-meta {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 20px;
    margin-top: 36px;
    font-size: 0.32em;
    color: rgba(148,163,184,0.45);
    letter-spacing: 0.06em;
  }
  .slide-meta span { display: flex; align-items: center; gap: 5px; }

  .section-num {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: linear-gradient(135deg, rgba(59,130,246,0.2), rgba(139,92,246,0.15));
    border: 1px solid rgba(59,130,246,0.3);
    color: #60a5fa;
    font-size: 0.5em;
    font-weight: 700;
    margin-bottom: 12px;
    flex-shrink: 0;
  }
  .slide-header { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 4px; }
  .slide-header-text { flex: 1; }

  .reveal .slides section { will-change: transform, opacity; }
`;

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function processInlineTitle(str: string): string {
  return escapeHtml(str)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function mdToHtml(text: string): string {
  const lines = text.split("\n");
  const html: string[] = [];
  let inList = false;
  let inOl = false;
  let inCode = false;
  let codeLines: string[] = [];
  let codeLang = "";

  const closeList = () => {
    if (inList) { html.push("</ul>"); inList = false; }
    if (inOl) { html.push("</ol>"); inOl = false; }
  };

  const processInline = (s: string): string =>
    s.replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.startsWith("```")) {
      if (!inCode) {
        closeList();
        inCode = true;
        codeLang = line.slice(3).trim();
        codeLines = [];
      } else {
        inCode = false;
        html.push(`<pre><code class="language-${escapeHtml(codeLang)}">${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
      }
      continue;
    }
    if (inCode) { codeLines.push(rawLine); continue; }

    if (line.startsWith("### ")) { closeList(); html.push(`<h3>${processInline(line.slice(4))}</h3>`); continue; }
    if (line.startsWith("#### ")) { closeList(); html.push(`<h4>${processInline(line.slice(5))}</h4>`); continue; }

    if (line.startsWith("> ")) { closeList(); html.push(`<blockquote>${processInline(line.slice(2))}</blockquote>`); continue; }

    if (/^---+$/.test(line.trim())) { closeList(); continue; }

    if (/^[\-\*] /.test(line)) {
      if (inOl) { html.push("</ol>"); inOl = false; }
      if (!inList) { html.push("<ul>"); inList = true; }
      html.push(`<li>${processInline(line.slice(2))}</li>`);
      continue;
    }

    if (/^\d+\. /.test(line)) {
      if (inList) { html.push("</ul>"); inList = false; }
      if (!inOl) { html.push("<ol>"); inOl = true; }
      html.push(`<li>${processInline(line.replace(/^\d+\. /, ""))}</li>`);
      continue;
    }

    if (!line.trim()) { closeList(); html.push(""); continue; }

    closeList();
    html.push(`<p>${processInline(line)}</p>`);
  }
  closeList();
  return html.join("\n");
}

function parseMarkdownToSlides(
  markdown: string,
  docTitle: string,
  density: "compact" | "normal" | "detailed" = "normal"
): Array<{ title: string; body: string; isTitle: boolean; subtitle?: string }> {
  const slides: Array<{ title: string; body: string; isTitle: boolean; subtitle?: string }> = [];

  const lines = markdown.split("\n");
  let currentTitle = "";
  let currentLines: string[] = [];
  let titleSlideSubtitle = "";
  let seenFirstHeading = false;

  const preambleLines: string[] = [];
  let i = 0;
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith("#")) break;
    if (/^---/.test(l.trim())) break;
    preambleLines.push(l);
  }
  titleSlideSubtitle = preambleLines.join(" ").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
  if (titleSlideSubtitle.length > 120) {
    titleSlideSubtitle = titleSlideSubtitle.slice(0, 117) + "…";
  }

  slides.push({ title: docTitle, body: "", isTitle: true, subtitle: titleSlideSubtitle });

  const flush = () => {
    const body = currentLines.join("\n").trim();
    if (currentTitle || body) {
      const chunks = splitBodyIntoSlideChunks(body, density);
      chunks.forEach((chunk, idx) => {
        const partSuffix = chunks.length > 1 ? ` (${idx + 1}/${chunks.length})` : "";
        slides.push({
          title: currentTitle ? `${currentTitle}${partSuffix}` : (partSuffix.trim() || docTitle),
          body: chunk,
          isTitle: false,
        });
      });
    }
    currentTitle = "";
    currentLines = [];
  };

  for (; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim() === "---") {
      flush();
      continue;
    }

    if (line.startsWith("# ") && !line.startsWith("## ")) {
      flush();
      seenFirstHeading = true;
      currentTitle = line.slice(2).trim();
      continue;
    }

    if (line.startsWith("## ")) {
      flush();
      seenFirstHeading = true;
      currentTitle = line.slice(3).trim();
      continue;
    }

    if (line.startsWith("### ") && !line.startsWith("#### ")) {
      flush();
      seenFirstHeading = true;
      currentTitle = line.slice(4).trim();
      continue;
    }

    const faqMatch = line.match(/^(?:\*\*(.+?)\*\*|(?:Q(?:uestion)?)\s*[:：]\s*(.+))$/i);
    if (faqMatch) {
      flush();
      seenFirstHeading = true;
      currentTitle = (faqMatch[1] || faqMatch[2] || "").replace(/\*\*/g, "").trim();
      continue;
    }

    if (!seenFirstHeading && preambleLines.includes(line)) continue;

    currentLines.push(line);
  }
  flush();

  return slides;
}

function getSlideLimits(density: "compact" | "normal" | "detailed") {
  return {
    compact:  { bullets: 3, paras: 1, code: 1, h3: 1, paraChars: 110 },
    normal:   { bullets: 4, paras: 1, code: 1, h3: 2, paraChars: 150 },
    detailed: { bullets: 5, paras: 2, code: 1, h3: 2, paraChars: 200 },
  }[density];
}

type BodyBlock =
  | { kind: "bullet"; text: string }
  | { kind: "ordered"; text: string }
  | { kind: "para"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "h4"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "code"; lang: string; lines: string[] }
  | { kind: "blank" };

function parseBodyBlocks(body: string): BodyBlock[] {
  const blocks: BodyBlock[] = [];
  const lines = body.split("\n");
  let inCode = false;
  let codeLang = "";
  let codeLines: string[] = [];

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith("```")) {
      if (!inCode) {
        inCode = true;
        codeLang = line.slice(3).trim();
        codeLines = [];
      } else {
        blocks.push({ kind: "code", lang: codeLang, lines: codeLines });
        inCode = false;
      }
      continue;
    }
    if (inCode) { codeLines.push(raw); continue; }
    if (!line.trim()) { blocks.push({ kind: "blank" }); continue; }
    if (line.startsWith("### ")) { blocks.push({ kind: "h3", text: line }); continue; }
    if (line.startsWith("#### ")) { blocks.push({ kind: "h4", text: line }); continue; }
    if (line.startsWith("> ")) { blocks.push({ kind: "quote", text: line }); continue; }
    if (/^[\-\*] /.test(line)) { blocks.push({ kind: "bullet", text: line }); continue; }
    if (/^\d+\. /.test(line)) { blocks.push({ kind: "ordered", text: line }); continue; }
    blocks.push({ kind: "para", text: line });
  }
  if (inCode) blocks.push({ kind: "code", lang: codeLang, lines: codeLines });
  return blocks;
}

function blockToMarkdown(block: BodyBlock): string {
  switch (block.kind) {
    case "bullet":
    case "ordered":
    case "h3":
    case "h4":
    case "quote":
    case "para":
      return block.text;
    case "code":
      return "```" + block.lang + "\n" + block.lines.join("\n") + "\n```";
    case "blank":
      return "";
  }
}

function splitBodyIntoSlideChunks(body: string, density: "compact" | "normal" | "detailed" = "normal"): string[] {
  if (!body.trim()) return [""];

  const limits = getSlideLimits(density);
  const blocks = parseBodyBlocks(body);
  const chunks: string[] = [];
  let currentBlocks: BodyBlock[] = [];
  let counts = { bullets: 0, paras: 0, code: 0, h3: 0 };

  const resetCounts = () => { counts = { bullets: 0, paras: 0, code: 0, h3: 0 }; };

  const flush = () => {
    const md = currentBlocks.map(blockToMarkdown).filter(Boolean).join("\n").trim();
    if (md) chunks.push(md);
    currentBlocks = [];
    resetCounts();
  };

  const canAdd = (block: BodyBlock): boolean => {
    if (block.kind === "blank") return true;
    if (block.kind === "bullet" || block.kind === "ordered") return counts.bullets < limits.bullets;
    if (block.kind === "para") {
      const text = block.text.replace(/^#+\s*/, "").trim();
      if (text.length > limits.paraChars) return false;
      return counts.paras < limits.paras;
    }
    if (block.kind === "h3" || block.kind === "h4") return counts.h3 < limits.h3;
    if (block.kind === "quote") return counts.paras < limits.paras;
    if (block.kind === "code") return counts.code < limits.code;
    return true;
  };

  const addBlock = (block: BodyBlock) => {
    if (block.kind === "bullet" || block.kind === "ordered") counts.bullets++;
    else if (block.kind === "para" || block.kind === "quote") counts.paras++;
    else if (block.kind === "h3" || block.kind === "h4") counts.h3++;
    else if (block.kind === "code") counts.code++;
    currentBlocks.push(block);
  };

  for (const block of blocks) {
    if (block.kind === "blank") {
      if (currentBlocks.length) currentBlocks.push(block);
      continue;
    }

    if (block.kind === "para") {
      const text = block.text.replace(/^#+\s*/, "").trim();
      if (text.length > limits.paraChars) {
        flush();
        const sentences = text
          .split(/(?<=[.!?])\s+/)
          .map(s => s.trim())
          .filter(s => s.length > 8);
        for (const sent of sentences) {
          const bulletBlock: BodyBlock = { kind: "bullet", text: `- ${sent}` };
          if (!canAdd(bulletBlock)) flush();
          addBlock(bulletBlock);
        }
        continue;
      }
    }

    if (!canAdd(block)) flush();
    addBlock(block);
  }
  flush();
  return chunks.length ? chunks : [""];
}

export function countSlides(markdown: string, density: "compact" | "normal" | "detailed" = "normal"): number {
  return parseMarkdownToSlides(markdown, "", density).length;
}

export function buildRevealPresentation(
  title: string,
  markdown: string,
  opts: { theme: string; transition: string; ratio: string; density?: string }
): string {
  const { theme, transition, ratio, density = "normal" } = opts;
  const isLeannaTheme = theme === "Leanna";

  const [rw, rh] = ratio === "4:3" ? [960, 720] : [1280, 720];

  const themeLink = isLeannaTheme
    ? `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/theme/black.css">`
    : `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/theme/${theme}.css">`;

  const customStyle = isLeannaTheme ? `<style>${Leanna_THEME_CSS}</style>` : "";

  const densityLevel = (density === "compact" || density === "detailed") ? density : "normal";
  const slides = parseMarkdownToSlides(markdown, title, densityLevel);
  const totalSlides = slides.length;
  const dateStr = new Date().toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" });

  let sectionCounter = 0;

  const slidesHtml = slides.map((s, i) => {

    if (i === 0 && s.isTitle) {
      const rawSub = (s.subtitle || "").trim();
      const firstSentence = rawSub.split(/[.!?。]/)[0].trim();
      const subtitle = firstSentence && firstSentence.length <= 100 && firstSentence.length >= 10
        ? `<p class="title-subtitle">${escapeHtml(firstSentence)}.</p>`
        : "";
      return `    <section class="title-slide" data-transition="zoom-in fade-out">
      <div class="tag">Leanna &nbsp;&nbsp;·&nbsp;&nbsp;Notebook</div>
      <h1>${processInlineTitle(s.title)}</h1>
      <div class="accent-bar"></div>
      ${subtitle}
      <div class="slide-meta">
        <span>📅 ${dateStr}</span>
        <span>·</span>
        <span>📊 ${totalSlides} slides</span>
      </div>
    </section>`;
    }

    sectionCounter++;
    const numBadge = isLeannaTheme
      ? `<div class="section-num">${sectionCounter}</div>`
      : "";

    let heading = "";
    if (s.title) {
      if (isLeannaTheme) {
        heading = `<div class="slide-header">
        ${numBadge}
        <div class="slide-header-text">
          <h2>${processInlineTitle(s.title)}</h2>
          <div class="accent-bar"></div>
        </div>
      </div>`;
      } else {
        heading = `<h2>${processInlineTitle(s.title)}</h2><div class="accent-bar"></div>`;
      }
    }

    const body = s.body ? mdToHtml(s.body) : "";

    return `    <section data-transition="${transition}">
      ${heading}
      <div class="slide-content">${body}</div>
    </section>`;
  }).join("\n\n");

  const closingSlide = isLeannaTheme
    ? `    <section class="title-slide closing-slide" data-transition="fade">
      <div class="tag">Leanna &nbsp;&nbsp;·&nbsp;&nbsp;Notebook</div>
      <h2>Merci</h2>
      <div class="accent-bar"></div>
      <p class="title-subtitle">Questions &amp; discussion</p>
      <div class="slide-meta">
        <span>📅 ${dateStr}</span>
      </div>
    </section>`
    : `    <section class="title-slide closing-slide" data-transition="fade">
      <h2>Merci</h2>
      <p class="title-subtitle">Questions &amp; discussion</p>
    </section>`;

  const globalStyles = `
    .reveal .slides section {
      box-sizing: border-box;
      overflow: visible;
      height: 100%;
      display: flex;
      flex-direction: column;
    }
    .reveal .slides section .slide-content {
      flex: 1 1 auto;
      min-height: 0;
      overflow: visible;
    }
    .reveal .slides section .slide-content.slide-scrollable {
      overflow-y: auto;
      overflow-x: hidden;
      scrollbar-width: thin;
    }
    .reveal h1, .reveal h2 { letter-spacing: -0.02em; }
    .reveal h2 { margin-bottom: 0.15em; font-size: 1.05em; }
    .reveal ul, .reveal ol { font-size: 0.72em; line-height: 1.45; margin: 0; padding-left: 1.1em; }
    .reveal ul li, .reveal ol li { margin-bottom: 0.28em; }
    .reveal pre { font-size: 0.52em; border-radius: 10px; max-height: 280px; overflow: auto; }
    .reveal p { font-size: 0.72em; line-height: 1.45; margin-bottom: 0.35em; }
    .reveal blockquote { font-size: 0.68em; margin: 8px 0; padding: 10px 14px; }
    .reveal h3 { font-size: 0.62em; margin-bottom: 6px; }
    .accent-bar {
      width: 48px; height: 3px;
      background: currentColor;
      border-radius: 2px;
      margin: 6px 0 14px 0;
      opacity: 0.35;
    }
    .title-slide .accent-bar { margin: 8px auto 18px; }
    .reveal .tag {
      display: inline-block;
      border: 1px solid currentColor;
      border-radius: 100px;
      padding: 3px 14px;
      font-size: 0.32em;
      opacity: 0.55;
      margin-bottom: 18px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      font-weight: 600;
    }
    .title-subtitle {
      font-size: 0.46em !important;
      opacity: 0.65;
      max-width: 72%;
      margin: 0 auto;
      line-height: 1.5 !important;
    }
    .slide-meta {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 14px;
      margin-top: 28px;
      font-size: 0.3em;
      opacity: 0.4;
      letter-spacing: 0.05em;
    }
    .section-num {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px; height: 26px;
      border-radius: 7px;
      border: 1px solid currentColor;
      font-size: 0.48em;
      font-weight: 700;
      opacity: 0.45;
      flex-shrink: 0;
      margin-top: 4px;
    }
    .slide-header { display: flex; align-items: flex-start; gap: 12px; flex-shrink: 0; }
    .slide-header-text { flex: 1; }
    .closing-slide h2 {
      font-size: 1.6em;
      font-weight: 800;
      background: none;
      -webkit-text-fill-color: inherit;
      color: inherit;
    }
  `;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reset.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.css">
  ${themeLink}
  <style>${globalStyles}</style>
  ${customStyle}
</head>
<body>
  <div class="reveal">
    <div class="slides">
${slidesHtml}

${closingSlide}
    </div>
  </div>
  <script type="module">
    import Reveal from 'https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.esm.js';
    import Highlight from 'https://cdn.jsdelivr.net/npm/reveal.js@5/plugin/highlight/highlight.esm.js';
    import Notes from 'https://cdn.jsdelivr.net/npm/reveal.js@5/plugin/notes/notes.esm.js';

    function fitSlideContent(section) {
      if (!section || section.classList.contains('title-slide')) return;
      const content = section.querySelector('.slide-content');
      if (!content) return;

      content.classList.remove('slide-scrollable');
      content.style.fontSize = '';
      content.style.lineHeight = '';

      const header = section.querySelector('.slide-header, h2');
      const headerH = header ? header.getBoundingClientRect().height + 12 : 0;
      const maxH = Math.max(section.clientHeight - headerH - 36, 120);

      let scale = 1;
      while (content.scrollHeight > maxH && scale > 0.38) {
        scale -= 0.025;
        content.style.fontSize = (scale * 100) + '%';
        content.style.lineHeight = scale < 0.65 ? '1.3' : '1.42';
      }

      if (content.scrollHeight > maxH) {
        content.style.maxHeight = maxH + 'px';
        content.classList.add('slide-scrollable');
      } else {
        content.style.maxHeight = '';
      }
    }

    function fitAllSlides() {
      document.querySelectorAll('.reveal .slides section').forEach(fitSlideContent);
    }

    Reveal.initialize({
      hash: true,
      transition: '${transition}',
      transitionSpeed: 'default',
      backgroundTransition: 'fade',
      width: ${rw},
      height: ${rh},
      margin: 0.06,
      minScale: 0.2,
      maxScale: 2.0,
      slideNumber: 'c/t',
      showSlideNumber: 'all',
      center: false,
      touch: true,
      loop: false,
      fragments: false,
      autoPlayMedia: false,
      plugins: [Highlight, Notes],
      highlight: { highlightOnLoad: true },
    }).then(() => {
      fitAllSlides();
      Reveal.on('slidechanged', (event) => fitSlideContent(event.currentSlide));
      window.addEventListener('resize', () => fitAllSlides());
    });
  </script>
</body>
</html>`;
}
