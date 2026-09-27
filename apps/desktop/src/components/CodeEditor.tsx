import Editor, { type OnMount } from '@monaco-editor/react';
import { useApp } from '../store';
import { Spinner } from './ui';

export function useEditorTheme(): string {
  const theme = useApp((s) => s.settings?.theme ?? 'system');
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  return dark ? 'aps-dark' : 'aps-light';
}

export function CodeEditor({
  value,
  onChange,
  language = 'json',
  readOnly,
  height = '100%',
  onMount,
  path,
  minimal,
  placeholder,
}: {
  value: string;
  onChange?(v: string): void;
  language?: string;
  readOnly?: boolean;
  height?: string | number;
  onMount?: OnMount;
  path?: string;
  minimal?: boolean;
  placeholder?: string;
}) {
  const theme = useEditorTheme();
  const fontSize = useApp((s) => s.settings?.fontSize ?? 14);
  return (
    <div className="h-full w-full min-h-0 relative">
      {!value && placeholder && <div className="absolute left-14 top-1 text-muted text-sm pointer-events-none z-10 mono">{placeholder}</div>}
      <Editor
        height={height}
        language={language}
        value={value}
        path={path}
        theme={theme}
        loading={<Spinner />}
        onChange={(v) => onChange?.(v ?? '')}
        onMount={onMount}
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize,
          fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          tabSize: 2,
          lineNumbers: minimal ? 'off' : 'on',
          glyphMargin: false,
          folding: !minimal,
          lineDecorationsWidth: minimal ? 4 : 8,
          renderLineHighlight: minimal ? 'none' : 'line',
          automaticLayout: true,
          fixedOverflowWidgets: true,
          quickSuggestions: language === 'graphql' ? { other: true, strings: false, comments: false } : undefined,
          scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
        }}
      />
    </div>
  );
}
