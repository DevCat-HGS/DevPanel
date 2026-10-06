// Small markdown subset for Claude's answers, parsed into blocks so the UI builds DOM nodes and never touches innerHTML.
export type MdBlock =
  | { type: 'code'; lang: string; text: string }
  | { type: 'h'; text: string }
  | { type: 'li'; text: string }
  | { type: 'p'; text: string };

export interface Span {
  t: 'txt' | 'code' | 'b';
  text: string;
}

export function parseMarkdown(src: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++; // closing fence (an unterminated one just runs to the end)
      blocks.push({ type: 'code', lang: fence[1], text: body.join('\n') });
      continue;
    }
    const head = line.match(/^#{1,6}\s+(.*)$/);
    const item = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.*)$/);
    if (head) blocks.push({ type: 'h', text: head[1].trim() });
    else if (item) blocks.push({ type: 'li', text: item[1] });
    else if (line.trim()) {
      const prev = blocks[blocks.length - 1];
      if (prev?.type === 'p' && lines[i - 1]?.trim()) prev.text += ` ${line.trim()}`; // soft-wrapped paragraph
      else blocks.push({ type: 'p', text: line.trim() });
    }
    i++;
  }
  return blocks;
}

export function parseInline(text: string): Span[] {
  const out: Span[] = [];
  const re = /`([^`\n]+)`|\*\*([^*\n]+)\*\*/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ t: 'txt', text: text.slice(last, m.index) });
    out.push(m[1] !== undefined ? { t: 'code', text: m[1] } : { t: 'b', text: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: 'txt', text: text.slice(last) });
  return out;
}
