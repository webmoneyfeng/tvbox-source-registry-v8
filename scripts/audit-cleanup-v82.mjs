import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUDIT_DIR = path.join(ROOT, 'audit');
const TEXT_EXTENSIONS = new Set(['.mjs', '.js', '.json', '.md', '.toml', '.yml', '.yaml', '.txt']);
const SKIP_DIRS = new Set(['.git', 'node_modules', '.wrangler', 'audit']);
const PATTERNS = [
  { id: 'OLD_CATALOG_VERSION', re: /v7\.3/iu },
  { id: 'OLD_V81_LABEL', re: /v8\.1(?:\.4)?/iu },
  { id: 'OLD_SNAPSHOT_TERMS', re: /\b(?:pages|snapshot|catalogue|categories whitelist)\b/iu },
  { id: 'EXECUTABLE_SOURCE_FIELD', re: /\b(?:jar|spider|ext|script)\b/iu },
];

async function walk(directory, relative = '') {
  const rows = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    const rel = path.join(relative, entry.name);
    if (entry.isDirectory()) rows.push(...await walk(absolute, rel));
    else rows.push({ absolute, relative: rel.replaceAll(path.sep, '/') });
  }
  return rows;
}

const files = await walk(ROOT);
const matches = [];
for (const file of files) {
  const extension = path.extname(file.relative).toLowerCase();
  if (!TEXT_EXTENSIONS.has(extension)) continue;
  let content;
  try { content = await readFile(file.absolute, 'utf8'); } catch { continue; }
  const ids = PATTERNS.filter((pattern) => pattern.re.test(content)).map((pattern) => pattern.id);
  if (ids.length) matches.push({ file: file.relative, patterns: ids });
}

const workflows = files
  .filter((file) => file.relative.startsWith('.github/workflows/'))
  .map((file) => file.relative)
  .sort();
const sourceFiles = files
  .filter((file) => file.relative.startsWith('src/'))
  .map((file) => file.relative)
  .sort();

const report = {
  generatedAt: new Date().toISOString(),
  scope: 'v8.2 repository cleanup and stale-architecture reference audit',
  policy: 'Generate evidence before deletion. No production resource or source file is deleted by this audit.',
  protected: [
    'v8.1.4 formal Worker, KV and custom domains',
    'v8.2 canary Worker and canary KV',
    'current source registry and audit evidence',
  ],
  repository: {
    sourceFiles,
    workflows,
    workflowCount: workflows.length,
    sourceFileCount: sourceFiles.length,
  },
  references: matches,
  findings: {
    oldRuntimeCodeReferences: matches.filter((row) => row.file.startsWith('src/')),
    oldWorkflowCount: workflows.filter((file) => !file.endsWith('ci.yml')).length,
    destructiveCleanupRecommended: false,
  },
  decisions: {
    archiveOnly: [
      'historical v7.3 documentation references',
      'formal v8.1.4 audit evidence',
      'v8.2 canary audit evidence',
    ],
    retain: [
      'src/worker.mjs',
      'src/health.mjs',
      'src/registry.mjs',
      'src/deep-audit.mjs',
      'scripts/audit-*.mjs',
      'wrangler.canary.toml',
      'wrangler.toml',
    ],
    deleteNow: [],
  },
};

await mkdir(AUDIT_DIR, { recursive: true });
const target = path.join(AUDIT_DIR, 'cleanup-manifest-v82.json');
const temporary = `${target}.tmp-${process.pid}`;
await writeFile(temporary, JSON.stringify(report, null, 2) + '\n', 'utf8');
JSON.parse(await readFile(temporary, 'utf8'));
await rename(temporary, target);
console.log(JSON.stringify(report, null, 2));
