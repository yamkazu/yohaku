// `.verify/summary.json` を生成する。
// 各ステップの成否、失敗時の `failedStep` と `logTail` を出力する。`verify.sh` から呼ばれる。
//
// 使い方:
//   node scripts/verify-summary.mjs <verify-dir> <exit-code>
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Names shared with scripts/verify.sh EVIDENCE_SHOTS and the e2e spec.
const evidenceNames = ['article-list.png', 'article-detail.png', 'not-found.png']

const verifyDir = process.argv[2]
const exitCode = Number(process.argv[3] ?? '1')
if (!verifyDir) {
  console.error('usage: verify-summary.mjs <verify-dir> <exit-code>')
  process.exit(2)
}

const root = dirname(verifyDir)
const stepsPath = join(verifyDir, 'steps.jsonl')
const raw = existsSync(stepsPath) ? readFileSync(stepsPath, 'utf8').trim() : ''
const steps = raw
  ? raw.split('\n').filter(Boolean).map((line) => JSON.parse(line))
  : []

function tail(rel, lines = 80) {
  if (!rel) return null
  const path = rel.startsWith('/') ? rel : join(root, rel)
  if (!existsSync(path)) return null
  const text = readFileSync(path).toString('utf8')
  const parts = text.split(/\r?\n/)
  if (parts.length && parts[parts.length - 1] === '') parts.pop()
  const out = parts.slice(-lines).join('\n')
  return out.length ? out : null
}

const failed = steps.find((step) => step.status === 'failed') ?? null
const ok = exitCode === 0 && !failed
const anySkipped = steps.some((step) => step.status === 'skipped')
const playwrightDir = join(verifyDir, 'playwright')
const playwright = existsSync(playwrightDir) ? '.verify/playwright' : null
const screenshotsDir = join(verifyDir, 'screenshots')
const screenshots = evidenceNames
  .filter((name) => existsSync(join(screenshotsDir, name)))
  .map((name) => `.verify/screenshots/${name}`)
const evidenceErrorPath = join(verifyDir, 'evidence-error.txt')
const evidenceError = existsSync(evidenceErrorPath)
  ? readFileSync(evidenceErrorPath, 'utf8').trim()
  : ''
const serverLogs = {}
if (existsSync(join(verifyDir, 'dynamodb-server.log'))) {
  serverLogs.dynamodb = '.verify/dynamodb-server.log'
}
if (existsSync(join(verifyDir, 'api-server.log'))) {
  serverLogs.api = '.verify/api-server.log'
}

let message
if (ok) {
  message = anySkipped ? 'selected steps passed' : 'all steps passed'
} else if (failed) {
  message = `${failed.name} failed (exit ${failed.exitCode}). See ${failed.log}`
  if (failed.name === 'e2e' && playwright) {
    message += ` and ${playwright}`
  }
} else if (evidenceError) {
  message = evidenceError
} else {
  message = `verify failed (exit ${exitCode})`
}

const includeApiTail =
  failed && (failed.name === 'e2e' || failed.name === 'api-start')

const summary = {
  ok,
  exitCode,
  message,
  failedStep: failed ? failed.name : null,
  failedLog: failed ? failed.log : null,
  playwright,
  screenshots: screenshots.length ? screenshots : null,
  serverLogs,
  logTail: failed ? tail(failed.log) : null,
  apiLogTail: includeApiTail ? tail('.verify/api-server.log', 40) : null,
  steps,
}

writeFileSync(join(verifyDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
