export function formatBytes(n: number | undefined): string {
  if (n === undefined) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function formatMs(ms: number | undefined): string {
  if (ms === undefined || ms === null || Number.isNaN(ms)) return '–';
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function formatCost(c: number | undefined): string {
  if (c === undefined || c === null) return '–';
  if (c === 0) return '$0';
  return c < 0.01 ? `$${c.toFixed(6)}` : `$${c.toFixed(4)}`;
}

export function timeAgo(iso: string | number): string {
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(t).toLocaleDateString();
}

/** Postman-style day heading for history: "Today", "Yesterday", a weekday within the last week, else the date. */
export function dayLabel(iso: string | number, now: Date = new Date()): string {
  const d = new Date(typeof iso === 'number' ? iso : Date.parse(iso));
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric', month: 'long', day: 'numeric' });
}

/** Interleave day headings with items (sorted newest first), for grouped lists. */
export function groupByDay<T>(items: T[], time: (item: T) => string | number, now: Date = new Date()): Array<{ header: string } | { item: T }> {
  const out: Array<{ header: string } | { item: T }> = [];
  let last: string | undefined;
  for (const item of items) {
    const label = dayLabel(time(item), now);
    if (label !== last) out.push({ header: label });
    last = label;
    out.push({ item });
  }
  return out;
}

export function uid(prefix = ''): string {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export function templateVars(s: string): string[] {
  const out = new Set<string>();
  for (const m of s.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
    const n = m[1]!.trim();
    if (!n.startsWith('$')) out.add(n.split('.')[0]!);
  }
  return [...out];
}

export function download(name: string, content: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
