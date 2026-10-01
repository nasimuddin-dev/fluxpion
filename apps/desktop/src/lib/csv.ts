/**
 * CSV text as records of cells (RFC 4180): quoted fields may hold the delimiter, doubled quotes and
 * line breaks; blank lines are skipped. The same rules as datasets in the engine (csvRecords in core).
 */
export function csvRecords(text: string, delim = ','): string[][] {
  const out: string[][] = [];
  let pending = '';
  for (const l of text.split(/\r?\n/)) {
    pending = pending ? `${pending}\n${l}` : l;
    if ((pending.match(/"/g)?.length ?? 0) % 2 === 1) continue;
    if (pending.trim()) out.push(csvLine(pending, delim));
    pending = '';
  }
  if (pending.trim()) out.push(csvLine(pending, delim));
  return out;
}

function csvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}
