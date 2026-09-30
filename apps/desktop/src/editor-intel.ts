import type * as Monaco from 'monaco-editor';
import { call } from './api';
import { useApp } from './store';

/**
 * Editor intelligence for every code editor (Monaco): {{variable}} completion, hover and highlighting in
 * all languages, pm / tp script snippets, and JSON Schema completion + validation for JSON editors
 * (MCP tool arguments, gRPC messages …). Installed once, when Monaco loads.
 */

export interface VarInfo {
  name: string;
  scope?: string;
  value?: string;
  secret?: boolean;
}

const DYNAMIC: VarInfo[] = [
  { name: '$uuid', scope: 'dynamic', value: 'random UUID' },
  { name: '$guid', scope: 'dynamic', value: 'random UUID' },
  { name: '$timestampMs', scope: 'dynamic', value: 'Unix time (ms)' },
  { name: '$timestamp', scope: 'dynamic', value: 'Unix time (s)' },
  { name: '$isoTimestamp', scope: 'dynamic', value: 'ISO-8601 time' },
  { name: '$randomInt', scope: 'dynamic', value: '0–1000' },
  { name: '$randomEmail', scope: 'dynamic', value: 'user…@example.test' },
];

/* ------------------------------------------------------------------ variables (cached per environment) */

let cache: { key: string; at: number; vars: VarInfo[] } | undefined;
let pending: Promise<VarInfo[]> | undefined;

/** Variables of the active environment (plus collection, workspace and global ones), refreshed every few seconds. */
export function editorVariables(): Promise<VarInfo[]> {
  const env = useApp.getState().environment ?? '';
  if (cache && cache.key === env && Date.now() - cache.at < 5000) return Promise.resolve(cache.vars);
  pending ??= call<VarInfo[]>('vars.inspect', { environment: env || undefined })
    .then((list) => {
      const vars = [...list.filter((v) => v.name !== 'workspaceDir'), ...DYNAMIC];
      cache = { key: env, at: Date.now(), vars };
      return vars;
    })
    .catch(() => cache?.vars ?? DYNAMIC)
    .finally(() => (pending = undefined));
  return pending;
}

/** Defined somewhere, or resolved at run time (dynamic values, {{$env.NAME}}, secret references). */
export function isKnownVariable(name: string, known: Set<string>): boolean {
  return known.has(name) || /^\$(env\.|secret)/.test(name);
}

/** The variable reference around a position: `{{name}}` or an unfinished `{{nam`. */
function varAt(line: string, column: number): { name: string; start: number; end: number; open: boolean } | undefined {
  const before = line.slice(0, column - 1);
  const open = /\{\{\s*([\w.$-]*)$/.exec(before);
  if (open) {
    const rest = /^([\w.$-]*)\s*(\}\})?/.exec(line.slice(column - 1))!;
    // the typed part of the name ends at the cursor: the replaced range starts there (not at the braces)
    return { name: open[1]! + rest[1]!, start: column - open[1]!.length, end: column + rest[1]!.length, open: !rest[2] };
  }
  return undefined;
}

const LANGUAGES = ['json', 'javascript', 'typescript', 'plaintext', 'yaml', 'xml', 'html', 'graphql', 'markdown', 'proto', 'shell'];

/* ------------------------------------------------------------------ pm / tp snippets */

const SNIPPETS: Array<{ label: string; detail: string; body: string }> = [
  { label: 'pm.test', detail: 'Test with an assertion', body: "pm.test('${1:status is 200}', () => {\n\tpm.response.to.have.status(${2:200});\n});" },
  { label: 'pm.test status code', detail: 'Status code is …', body: "pm.test('Status code is ${1:200}', () => {\n\tpm.response.to.have.status(${1:200});\n});" },
  { label: 'pm.test response time', detail: 'Response time below …', body: "pm.test('Response time is below ${1:500} ms', () => {\n\tpm.expect(pm.response.responseTime).to.be.below(${1:500});\n});" },
  { label: 'pm.test json field', detail: 'JSON field equals …', body: "pm.test('${1:field} is ${2:value}', () => {\n\tconst json = pm.response.json();\n\tpm.expect(json.${1:field}).to.eql(${3:'${2:value}'});\n});" },
  { label: 'pm.test json type', detail: 'JSON field has type …', body: "pm.test('${1:id} is a ${2:number}', () => {\n\tpm.expect(pm.response.json().${1:id}).to.be.a('${2:number}');\n});" },
  { label: 'pm.test header', detail: 'Header is present', body: "pm.test('Has ${1:Content-Type}', () => {\n\tpm.response.to.have.header('${1:Content-Type}');\n});" },
  { label: 'pm.test body contains', detail: 'Body contains text', body: "pm.test('Body contains ${1:text}', () => {\n\tpm.expect(pm.response.text()).to.include('${1:text}');\n});" },
  { label: 'pm.test json schema', detail: 'Response matches a JSON Schema', body: "const schema = {\n\ttype: 'object',\n\trequired: [${1:'id'}],\n};\npm.test('Matches the schema', () => {\n\tpm.response.to.have.jsonSchema(schema);\n});" },
  { label: 'pm.environment.set', detail: 'Save a value for the next requests', body: "pm.environment.set('${1:token}', pm.response.json().${2:access_token});" },
  { label: 'pm.collectionVariables.set', detail: 'Save a collection variable', body: "pm.collectionVariables.set('${1:name}', ${2:value});" },
  { label: 'pm.environment.get', detail: 'Read an environment variable', body: "const ${1:value} = pm.environment.get('${2:name}');" },
  { label: 'pm.sendRequest', detail: 'Send another request from a script', body: "pm.sendRequest('${1:https://example.com}', (err, res) => {\n\tif (err) return console.log(err);\n\t${2:console.log(res.json());}\n});" },
  { label: 'pm.execution.setNextRequest', detail: 'Choose the next request of a run', body: "pm.execution.setNextRequest('${1:Request name}');" },
  { label: 'pm.visualizer.set', detail: 'Show the response as HTML', body: "pm.visualizer.set(`\n\t<table>{{#each items}}<tr><td>{{name}}</td></tr>{{/each}}</table>\n`, { items: pm.response.json()${1:} });" },
  { label: 'pm.request.headers.upsert', detail: 'Set a request header (pre-request)', body: "pm.request.headers.upsert({ key: '${1:X-Request-Id}', value: ${2:pm.variables.replaceIn('{{\\$uuid}}')} });" },
];

/* ------------------------------------------------------------------ JSON schemas per editor model */

const schemas = new Map<string, unknown>();
let monacoRef: typeof Monaco | undefined;

/** Give the JSON editor with this `path` (see CodeEditor) a JSON Schema: completion, hover and validation. */
export function setEditorJsonSchema(path: string, schema: unknown | undefined): void {
  if (schema) schemas.set(path, schema);
  else schemas.delete(path);
  if (!monacoRef) return;
  monacoRef.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    allowComments: false,
    enableSchemaRequest: false,
    schemas: [...schemas].map(([p, s]) => ({ uri: `inmemory://schema/${encodeURIComponent(p)}`, fileMatch: [p, `*${p}`], schema: s as never })),
  });
}

/* ------------------------------------------------------------------ install */

export function installEditorIntel(monaco: typeof Monaco): void {
  monacoRef = monaco;
  setEditorJsonSchema('__none__', undefined);

  // {{variable}} completion in every language
  for (const lang of LANGUAGES)
    monaco.languages.registerCompletionItemProvider(lang, {
      triggerCharacters: ['{'],
      provideCompletionItems: async (model, position) => {
        const line = model.getLineContent(position.lineNumber);
        const at = varAt(line, position.column);
        if (!at) return { suggestions: [] };
        const vars = await editorVariables();
        const range = new monaco.Range(position.lineNumber, at.start, position.lineNumber, position.column);
        return {
          suggestions: vars.map((v, i) => ({
            label: { label: v.name, description: v.scope },
            kind: v.scope === 'dynamic' ? monaco.languages.CompletionItemKind.Function : monaco.languages.CompletionItemKind.Variable,
            detail: v.secret ? '•••••• (secret)' : v.value,
            documentation: { value: `**{{${v.name}}}** · ${v.scope ?? 'unknown scope'}${v.secret ? '\n\nSecret: the value is never shown.' : v.value ? `\n\n\`${v.value.slice(0, 200)}\`` : ''}` },
            insertText: at.open ? `${v.name}}}` : v.name,
            range,
            sortText: String(i).padStart(4, '0'),
          })),
        };
      },
    });

  // hover: what a {{variable}} resolves to, and where it comes from
  for (const lang of LANGUAGES)
    monaco.languages.registerHoverProvider(lang, {
      provideHover: async (model, position) => {
        const line = model.getLineContent(position.lineNumber);
        for (const m of line.matchAll(/\{\{\s*([\w.$-]+)\s*\}\}/g)) {
          const start = m.index! + 1;
          const end = start + m[0].length;
          if (position.column < start || position.column > end) continue;
          const v = (await editorVariables()).find((x) => x.name === m[1]) ?? (isKnownVariable(m[1]!, new Set()) ? { name: m[1]!, scope: 'resolved at run time', value: m[1]!.startsWith('$env.') ? `environment variable ${m[1]!.slice(5)}` : 'secret' } : undefined);
          return {
            range: new monaco.Range(position.lineNumber, start, position.lineNumber, end),
            contents: [
              v
                ? { value: `**{{${v.name}}}** · ${v.scope ?? ''}\n\n${v.secret ? '•••••• (secret)' : `\`${(v.value ?? '').slice(0, 300)}\``}` }
                : { value: `**{{${m[1]}}}** is not defined in the active environment, collection, workspace or globals.` },
            ],
          };
        }
        return null;
      },
    });

  // highlight {{variables}}: blue when defined, red when not
  monaco.editor.onDidCreateEditor((ed) => {
    const editor = ed as Monaco.editor.ICodeEditor;
    let ids: string[] = [];
    let t: ReturnType<typeof setTimeout> | undefined;
    const paint = async () => {
      const model = editor.getModel();
      if (!model) return;
      const text = model.getValue();
      if (!text.includes('{{')) {
        ids = editor.deltaDecorations(ids, []);
        return;
      }
      const known = new Set((await editorVariables()).map((v) => v.name));
      const decos: Monaco.editor.IModelDeltaDecoration[] = [];
      for (const m of text.matchAll(/\{\{\s*([\w.$-]+)\s*\}\}/g)) {
        const s = model.getPositionAt(m.index!);
        const e = model.getPositionAt(m.index! + m[0].length);
        decos.push({ range: new monaco.Range(s.lineNumber, s.column, e.lineNumber, e.column), options: { inlineClassName: isKnownVariable(m[1]!, known) ? 'editor-var' : 'editor-var-missing', hoverMessage: isKnownVariable(m[1]!, known) ? undefined : { value: `**{{${m[1]}}}** is not defined` } } });
        if (decos.length > 2000) break;
      }
      ids = editor.deltaDecorations(ids, decos);
    };
    const schedule = () => {
      clearTimeout(t);
      t = setTimeout(() => void paint(), 200);
    };
    editor.onDidChangeModelContent(schedule);
    editor.onDidChangeModel(schedule);
    schedule();
  });

  // pm / tp snippets in scripts
  monaco.languages.registerCompletionItemProvider('javascript', {
    // after "pm." only providers registered for '.' are asked
    triggerCharacters: ['.'],
    provideCompletionItems: (model, position) => {
      const lineBefore = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      // "pm.te" / "tp.environment.s": the snippet replaces the whole expression typed so far
      const expr = /(?:^|[^\w.$])((?:pm|tp)(?:\.\w*)*)$/.exec(lineBefore);
      if (!expr && /\.\s*\w*$/.test(lineBefore)) return { suggestions: [] }; // other member access: the type information handles it
      const word = model.getWordUntilPosition(position);
      const startColumn = expr ? position.column - expr[1]!.length : word.startColumn;
      const range = new monaco.Range(position.lineNumber, startColumn, position.lineNumber, position.column);
      return {
        suggestions: SNIPPETS.flatMap((s) => [s, { ...s, label: s.label.replace(/^pm\./, 'tp.'), body: s.body.replace(/\bpm\./g, 'tp.') }]).map((s) => ({
          label: s.label,
          kind: monaco.languages.CompletionItemKind.Snippet,
          detail: s.detail,
          documentation: { value: '```js\n' + s.body.replace(/\$\{\d+:([^}]*)\}/g, '$1').replace(/\$\{\d+\}/g, '') + '\n```' },
          insertText: s.body,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          filterText: s.label,
          sortText: `~${s.label}`,
          range,
        })),
      };
    },
  });
}
