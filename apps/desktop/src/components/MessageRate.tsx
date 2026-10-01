import { useEffect, useState } from 'react';
import { formatBytes } from '../lib/format';

interface Msg {
  time: number;
  direction: 'sent' | 'received' | 'system';
  size: number;
}

const SECONDS = 60;

/**
 * A connection's traffic at a glance: messages and bytes sent and received, and a sparkline of messages per
 * second over the last minute (received at the base, sent above). Redraws every second while open.
 */
export function MessageRate({ messages }: { messages: Msg[] }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  let sent = 0;
  let received = 0;
  let sentBytes = 0;
  let receivedBytes = 0;
  const buckets = Array.from({ length: SECONDS }, () => ({ sent: 0, received: 0 }));
  for (const m of messages) {
    if (m.direction === 'system') continue;
    if (m.direction === 'sent') (sent++, (sentBytes += m.size));
    else (received++, (receivedBytes += m.size));
    const age = Math.floor((now - m.time) / 1000);
    if (age >= 0 && age < SECONDS) buckets[SECONDS - 1 - age]![m.direction]++;
  }
  const max = Math.max(1, ...buckets.map((b) => b.sent + b.received));
  const lastMinute = buckets.reduce((a, b) => a + b.sent + b.received, 0);
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted" title={`Sent ${sent} (${formatBytes(sentBytes)}), received ${received} (${formatBytes(receivedBytes)}); ${lastMinute} in the last minute`}>
      <span className="tabular-nums">
        <span className="text-accent">↑</span> {sent} · <span className="text-ok">↓</span> {received}
      </span>
      <span className="hidden md:inline tabular-nums">{formatBytes(sentBytes + receivedBytes)}</span>
      <span aria-hidden className="inline-flex items-end gap-px h-4 w-[120px]">
        {buckets.map((b, i) => (
          <span key={i} className="flex flex-col-reverse flex-1 h-full">
            {b.received > 0 && <span className="w-full rounded-[1px] bg-ok" style={{ height: `${(b.received / max) * 100}%` }} />}
            {b.sent > 0 && <span className="w-full rounded-[1px] bg-accent" style={{ height: `${(b.sent / max) * 100}%` }} />}
          </span>
        ))}
      </span>
    </span>
  );
}
