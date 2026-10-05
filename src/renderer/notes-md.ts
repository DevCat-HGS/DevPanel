// Tiny, safe renderer for release notes: markdown subset (or the HTML electron-updater returns)
// turned into plain blocks, so the UI can build DOM nodes without ever using innerHTML.
export interface NoteBlock {
  type: 'h' | 'li' | 'p';
  text: string;
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

/** Converts the HTML release notes GitHub/electron-updater return into markdown-ish text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*li[^>]*>/gi, '\n- ')
    .replace(/<\s*h[1-6][^>]*>/gi, '\n## ')
    .replace(/<\/\s*(p|h[1-6]|ul|ol|div)\s*>|<\s*br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:amp|lt|gt|quot|nbsp|#39);/g, (m) => ENTITIES[m]);
}

export function parseNotes(source: string): NoteBlock[] {
  const text = /<\/?[a-z][\s\S]*>/i.test(source) ? htmlToText(source) : source;
  const blocks: NoteBlock[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const head = line.match(/^#{1,6}\s+(.*)$/);
    const item = line.match(/^[-*]\s+(.*)$/);
    if (head) blocks.push({ type: 'h', text: head[1] });
    else if (item) blocks.push({ type: 'li', text: item[1].replace(/\*\*(.+?)\*\*/g, '$1') });
    else blocks.push({ type: 'p', text: line.replace(/\*\*(.+?)\*\*/g, '$1') });
  }
  return blocks;
}
