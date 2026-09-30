import { asError } from '../api';
import { useApp } from '../store';

/** An AI action failed: when the assistant isn't set up yet, the message offers to open its settings. */
export function toastAiError(e: unknown): void {
  const message = asError(e).message;
  const notSetUp = /AI assistant is off|No Claude API key|No AI provider/.test(message);
  useApp.getState().toast(message, 'error', notSetUp ? { label: 'Set up', onClick: () => useApp.getState().openIntent('settings', { tab: 'assistant' }) } : undefined);
}
