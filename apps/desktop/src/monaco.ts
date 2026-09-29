import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import { PM_TYPES } from './lib/snippets';
import { buildSchema, type GraphQLSchema } from 'graphql';
import { getAutocompleteSuggestions, getDiagnostics, Position } from 'graphql-language-service';

/** Bundle Monaco locally (no CDN) so the editor works offline and under a strict CSP. */
self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'json') return new JsonWorker();
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    return new EditorWorker();
  },
};
loader.config({ monaco });

// Script editor IntelliSense for the Postman-compatible pm API. Scripts run as a function body,
// so a top-level `return` is allowed (TS 1108).
monaco.typescript.javascriptDefaults.addExtraLib(PM_TYPES, 'file:///testpion/pm.d.ts');
monaco.typescript.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false, diagnosticCodesToIgnore: [1108] });
monaco.typescript.javascriptDefaults.setCompilerOptions({ target: monaco.typescript.ScriptTarget.ES2020, allowNonTsExtensions: true, checkJs: false, lib: ['es2020'] });

// match the app's zinc/indigo tokens (styles.css) so editors blend into the panels
monaco.editor.defineTheme('aps-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'string', foreground: '9ee6b8' },
    { token: 'string.key.json', foreground: 'a5b4fc' },
    { token: 'number', foreground: 'fbbf77' },
    { token: 'keyword', foreground: 'c4a5fd' },
    { token: 'comment', foreground: '6b6b76', fontStyle: 'italic' },
  ],
  colors: {
    'editor.background': '#111114',
    'editorGutter.background': '#111114',
    'editor.lineHighlightBackground': '#1a1a1f',
    'editor.lineHighlightBorder': '#00000000',
    'editorLineNumber.foreground': '#4a4a54',
    'editorLineNumber.activeForeground': '#9b9ba7',
    'editor.selectionBackground': '#6d6ff540',
    'editor.inactiveSelectionBackground': '#6d6ff522',
    'editorCursor.foreground': '#a5b4fc',
    'editorIndentGuide.background1': '#26262d',
    'editorWidget.background': '#17171b',
    'editorWidget.border': '#2a2a31',
    'editorSuggestWidget.background': '#17171b',
    'editorSuggestWidget.border': '#2a2a31',
    'editorSuggestWidget.selectedBackground': '#26262d',
    'scrollbarSlider.background': '#3a3a4366',
    'scrollbarSlider.hoverBackground': '#3a3a43aa',
  },
});
monaco.editor.defineTheme('aps-light', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'string', foreground: '15803d' },
    { token: 'string.key.json', foreground: '4338ca' },
    { token: 'number', foreground: 'c2410c' },
    { token: 'keyword', foreground: '7c3aed' },
    { token: 'comment', foreground: '8a8a95', fontStyle: 'italic' },
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.lineHighlightBackground': '#f6f6f9',
    'editor.lineHighlightBorder': '#00000000',
    'editorLineNumber.foreground': '#b4b4bd',
    'editorLineNumber.activeForeground': '#6b6b76',
    'editor.selectionBackground': '#4f46e52e',
    'editorCursor.foreground': '#4f46e5',
    'editorIndentGuide.background1': '#ececf0',
    'editorWidget.border': '#e4e4e9',
    'editorSuggestWidget.selectedBackground': '#eef0ff',
  },
});

/* ------------------------------------------------------------------ GraphQL language */

monaco.languages.register({ id: 'graphql', extensions: ['.graphql', '.gql'] });
monaco.languages.setLanguageConfiguration('graphql', {
  comments: { lineComment: '#' },
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['(', ')'],
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"' },
  ],
});
monaco.languages.setMonarchTokensProvider('graphql', {
  keywords: ['query', 'mutation', 'subscription', 'fragment', 'on', 'type', 'interface', 'union', 'enum', 'input', 'scalar', 'schema', 'extend', 'directive', 'implements', 'true', 'false', 'null'],
  tokenizer: {
    root: [
      [/#.*$/, 'comment'],
      [/"""/, 'string', '@block'],
      [/"([^"\\]|\\.)*"/, 'string'],
      [/\$[A-Za-z_]\w*/, 'variable'],
      [/@[A-Za-z_]\w*/, 'annotation'],
      [/[A-Za-z_]\w*/, { cases: { '@keywords': 'keyword', '[A-Z]\\w*': 'type', '@default': 'identifier' } }],
      [/-?\d+(\.\d+)?([eE][+-]?\d+)?/, 'number'],
      [/[{}()[\]]/, '@brackets'],
      [/[!:=|&.]+/, 'delimiter'],
    ],
    block: [
      [/"""/, 'string', '@pop'],
      [/./, 'string'],
    ],
  },
});

let currentSchema: GraphQLSchema | undefined;

export function setGraphQLSchema(sdl: string | undefined): void {
  try {
    currentSchema = sdl ? buildSchema(sdl) : undefined;
  } catch {
    currentSchema = undefined;
  }
  for (const m of monaco.editor.getModels()) if (m.getLanguageId() === 'graphql') validateGraphQLModel(m);
}

const kindMap: Record<number, monaco.languages.CompletionItemKind> = {
  1: monaco.languages.CompletionItemKind.Text,
  2: monaco.languages.CompletionItemKind.Method,
  3: monaco.languages.CompletionItemKind.Function,
  5: monaco.languages.CompletionItemKind.Field,
  6: monaco.languages.CompletionItemKind.Variable,
  7: monaco.languages.CompletionItemKind.Class,
  10: monaco.languages.CompletionItemKind.Property,
  13: monaco.languages.CompletionItemKind.Enum,
  14: monaco.languages.CompletionItemKind.Keyword,
  20: monaco.languages.CompletionItemKind.EnumMember,
  22: monaco.languages.CompletionItemKind.Struct,
};

monaco.languages.registerCompletionItemProvider('graphql', {
  triggerCharacters: ['{', '(', ':', '@', '$', ' ', '\n'],
  provideCompletionItems(model, position) {
    const word = model.getWordUntilPosition(position);
    const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
    if (!currentSchema) return { suggestions: [] };
    const items = getAutocompleteSuggestions(currentSchema, model.getValue(), new Position(position.lineNumber - 1, position.column - 1));
    return {
      suggestions: items.map((i) => ({
        label: i.label,
        kind: kindMap[i.kind ?? 5] ?? monaco.languages.CompletionItemKind.Field,
        detail: i.detail ?? (i.type ? String(i.type) : undefined),
        documentation: i.documentation ?? undefined,
        insertText: i.label,
        range,
      })),
    };
  },
});

monaco.languages.registerHoverProvider('graphql', {
  provideHover(model, position) {
    if (!currentSchema) return null;
    const word = model.getWordAtPosition(position);
    if (!word) return null;
    const t = currentSchema.getType(word.word);
    if (t) return { contents: [{ value: `**${t.name}**${t.description ? `\n\n${t.description}` : ''}` }] };
    return null;
  },
});

export function validateGraphQLModel(model: monaco.editor.ITextModel): void {
  const text = model.getValue();
  const diags = text.trim() ? getDiagnostics(text, currentSchema) : [];
  monaco.editor.setModelMarkers(
    model,
    'graphql',
    diags.map((d) => ({
      severity: d.severity === 1 ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
      message: typeof d.message === 'string' ? d.message : d.message.value,
      startLineNumber: d.range.start.line + 1,
      startColumn: d.range.start.character + 1,
      endLineNumber: d.range.end.line + 1,
      endColumn: d.range.end.character + 1,
    })),
  );
}

monaco.editor.onDidCreateModel((m) => {
  if (m.getLanguageId() !== 'graphql') return;
  let t: ReturnType<typeof setTimeout> | undefined;
  m.onDidChangeContent(() => {
    clearTimeout(t);
    t = setTimeout(() => validateGraphQLModel(m), 250);
  });
  validateGraphQLModel(m);
});

export { monaco };
