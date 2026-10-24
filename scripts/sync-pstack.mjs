// Vendors pstack (https://github.com/cursor/plugins, MIT) into .claude/ so Claude Code
// loads it as project skills and agents instead of a plugin. Copies upstream's generated
// Claude Code tree (harness/pstack/claude-code) and applies the patches below.
//
// usage: node scripts/sync-pstack.mjs [path to a cursor/plugins checkout]
// With no path it shallow-clones cursor/plugins main into a temp dir.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLAUDE = join(ROOT, '.claude')
const REPO = 'https://github.com/cursor/plugins'

const clone = !process.argv[2]
const src = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'cursor-plugins-'))
if (clone) process.on('exit', () => rmSync(src, { recursive: true, force: true }))
if (clone) execFileSync('git', ['clone', '--depth', '1', `${REPO}.git`, src], { stdio: 'inherit' })
const TREE = join(src, 'harness', 'pstack', 'claude-code')
if (!existsSync(TREE)) throw new Error(`${TREE} not found`)
const commit = execFileSync('git', ['-C', src, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const { version } = JSON.parse(readFileSync(join(TREE, 'plugin.json'), 'utf8'))

// Replace only what pstack owns, so this repository's own skills and agents in .claude/ survive a sync.
const MANIFEST = join(CLAUDE, 'pstack', 'manifest.json')
const entries = ['skills', 'agents', 'docs'].flatMap((dir) => readdirSync(join(TREE, dir)).map((name) => `${dir}/${name}`))
const previous = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : []
for (const entry of new Set([...previous, ...entries])) rmSync(join(CLAUDE, entry), { recursive: true, force: true })
rmSync(join(CLAUDE, 'pstack'), { recursive: true, force: true })
for (const entry of entries) cpSync(join(TREE, entry), join(CLAUDE, entry), { recursive: true })
cpSync(join(TREE, 'README.md'), join(CLAUDE, 'pstack', 'README.md'))
cpSync(join(TREE, 'LICENSE'), join(CLAUDE, 'pstack', 'LICENSE'))
writeFileSync(MANIFEST, `${JSON.stringify(entries.sort(), null, 2)}\n`)

const VENDORED =
  'In this repository pstack is vendored into `.claude/` by `scripts/sync-pstack.mjs`, not installed as a plugin. ' +
  '`<pstack>` is `.claude/` at the repository root: skills are in `.claude/skills/`, agents in `.claude/agents/`, and the README in `.claude/pstack/README.md`. ' +
  'Commands and agents have no `pstack:` prefix, so `/poteto-mode`, `poteto-agent`, and `comment-sicko` keep their Cursor names.'

// Each patch must match exactly once, so an upstream rewrite fails loudly instead of silently dropping it.
const PATCHES = {
  'docs/harness/claude-code.md': [
    [/^(# pstack in Claude Code\n\n.*\n)/, `$1\n${VENDORED}\n`],
    [
      'Claude Code loads every `.md` file in `~/.claude/rules/` into each new session, so `setup-pstack` writes its rule there.',
      'Claude Code loads every `.md` file in `.claude/rules/` at the repository root into each new session, so `setup-pstack` writes its rule there.',
    ],
    ['When you tell the user to type it, write `/pstack:<name>`.', 'When you tell the user to type it, write `/<name>`.'],
    ['| `pstack:poteto-agent`, `pstack:comment-sicko` |', '| `poteto-agent`, `comment-sicko`, from `.claude/agents/` |'],
    [
      '| `~/.claude/rules/pstack-models.md`. Claude Code loads it',
      '| `.claude/rules/pstack-models.md` at the repository root. Claude Code loads it',
    ],
    [
      '- Write. Write `~/.claude/rules/pstack-models.md` with no frontmatter,',
      '- Write. Write `.claude/rules/pstack-models.md` at the repository root, not `~/.claude/rules/`, because a cloud session\'s home folder does not persist. Write it with no frontmatter,',
    ],
  ],
  'agents/poteto-agent.md': [
    [
      'With no path, before any other work, search `~/.cursor/plugins/`',
      'With no path, before any other work, use `.claude/skills/poteto-mode/SKILL.md` at the repository root. If it does not exist, search `~/.cursor/plugins/`',
    ],
  ],
  'skills/poteto-help/SKILL.md': [
    ['](../../README.md)', '](../../pstack/README.md)'],
    [
      'it also installs in Claude Code with `/plugin marketplace add cursor/plugins`, then `/plugin install pstack@cursor-plugins`. There, each command takes a `pstack:` prefix, such as `/pstack:poteto-mode`.',
      'this repository vendors its Claude Code copy into `.claude/` ([source](../../pstack/SOURCE.md)). Commands have no prefix, such as `/poteto-mode`.',
    ],
  ],
  'docs/guide/01-setup.md': [
    [
      'In Claude Code, run `/plugin marketplace add cursor/plugins`, then `/plugin install pstack@cursor-plugins`. Claude Code prefixes plugin commands, so each command in this guide takes a `pstack:` prefix there, such as `/pstack:setup-pstack`, which writes its model rule to `~/.claude/rules/pstack-models.md`.',
      'In this repository Claude Code loads pstack from `.claude/`, so each command in this guide keeps its name, such as `/setup-pstack`, which writes its model rule to `.claude/rules/pstack-models.md`.',
    ],
  ],
  'pstack/README.md': [
    [/\]\(\.\//g, '](../'],
    [/^(# pstack\n)/, `$1\n> ${VENDORED} The plugin install steps below do not apply here. See [SOURCE.md](SOURCE.md).\n`],
    [
      'claude code prefixes plugin commands and agents, so `/poteto-mode` is `/pstack:poteto-mode`.',
      'in this repository commands and agents keep their names, such as `/poteto-mode`.',
    ],
    [
      'in claude code, `/pstack:setup-pstack` writes your model choices to `~/.claude/rules/pstack-models.md`,',
      'in claude code, `/setup-pstack` writes your model choices to `.claude/rules/pstack-models.md`,',
    ],
  ],
}

for (const [rel, patches] of Object.entries(PATCHES)) {
  const path = join(CLAUDE, rel)
  let text = readFileSync(path, 'utf8')
  for (const [from, to] of patches) {
    const count = typeof from === 'string' ? text.split(from).length - 1 : (text.match(from) ?? []).length
    if (count === 0 || (typeof from === 'string' && count > 1)) throw new Error(`${rel}: patch matched ${count} times: ${from}`)
    text = text.replace(from, to)
  }
  writeFileSync(path, text)
}

writeFileSync(
  join(CLAUDE, 'pstack', 'SOURCE.md'),
  `# pstack (vendored)

\`.claude/skills\`, \`.claude/agents\`, \`.claude/docs\`, and this folder are copied from [cursor/plugins](${REPO}) \`harness/pstack/claude-code\` at [\`${commit.slice(0, 12)}\`](${REPO}/tree/${commit}/harness/pstack/claude-code) (pstack ${version}), under the [MIT license](LICENSE). Do not edit them by hand. Run \`node scripts/sync-pstack.mjs\` to update, which re-applies the local patches in that script.

[\`manifest.json\`](manifest.json) lists what pstack owns. The sync replaces only those entries, so this repository's own skills and agents in \`.claude/\` and \`.claude/rules/pstack-models.md\`, its own model choice, are left alone.
`,
)

// Every relative link in the vendored tree must resolve inside the repository.
const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]))
const dangling = []
for (const path of walk(CLAUDE).filter((p) => p.endsWith('.md'))) {
  for (const [, href] of readFileSync(path, 'utf8').matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = href.replace(/[#?].*/, '')
    if (!/[./]/.test(target) || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue
    if (!existsSync(join(dirname(path), target))) dangling.push(`${relative(ROOT, path)} -> ${href}`)
  }
}
if (dangling.length > 0) throw new Error(`dangling links:\n${dangling.join('\n')}`)
console.log(`pstack ${version} (${commit.slice(0, 12)}) synced into .claude/`)
