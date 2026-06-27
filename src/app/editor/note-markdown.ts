/**
 * The lightweight markdown a line note may contain — `**bold**`, `*italic*` and
 * `- ` bullet lists — rendered to safe HTML. User text is escaped first, so only
 * our own tags ever reach the DOM.
 */

/** Escape HTML so user note text can never inject markup. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Inline marks on already-escaped text: `**bold**`, then `*italic*`. */
function inlineMarks(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

/** Render a note's markdown to safe HTML (bold, italic and bullet lists). */
export function renderNoteHtml(text: string): string {
  const out: string[] = [];
  let inList = false;
  for (const line of text.split('\n')) {
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inlineMarks(escapeHtml(bullet[1]))}</li>`);
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      if (line.trim()) out.push(`<p>${inlineMarks(escapeHtml(line))}</p>`);
    }
  }
  if (inList) out.push('</ul>');
  return out.join('');
}
