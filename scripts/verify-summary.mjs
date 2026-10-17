// Summary JSON for a step run directory (`.verify/` locally, `.ci/` on GitHub Actions).
// Emits each step's status plus `failedStep` / `logTail` on failure.
// Called from `verify.sh` and `scripts/ci/step.sh`.
//
// Usage:
//   node scripts/verify-summary.mjs <summary-dir> <exit-code>
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { loadEvidenceShots } from './evidence-shots.mjs'

const evidenceNames = loadEvidenceShots()

const summaryDir = process.argv[2]
const exitCode = Number(process.argv[3] ?? '1')
if (!summaryDir) {
  console.error('usage: verify-summary.mjs <summary-dir> <exit-code>')
  process.exit(2)
}

const root = dirname(summaryDir)
const dirLabel = basename(summaryDir)
const stepsPath = join(summaryDir, 'steps.jsonl')
const raw = existsSync(stepsPath) ? readFileSync(stepsPath, 'utf8').trim() : ''
const steps = raw
  ? raw.split('\n').filter(Boolean).map((line) => JSON.parse(line))
  : []

function repoRel(absPath) {
  return relative(root, absPath).split('\\').join('/')
}

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
const playwrightDir = join(summaryDir, 'playwright')
const playwright = existsSync(playwrightDir) ? repoRel(playwrightDir) : null
const screenshotsDir = join(summaryDir, 'screenshots')
const screenshots = evidenceNames
  .filter((name) => existsSync(join(screenshotsDir, name)))
  .map((name) => repoRel(join(screenshotsDir, name)))
const evidenceErrorPath = join(summaryDir, 'evidence-error.txt')
const evidenceError = existsSync(evidenceErrorPath)
  ? readFileSync(evidenceErrorPath, 'utf8').trim()
  : ''
const serverLogs = {}
const dynamodbLog = join(summaryDir, 'dynamodb-server.log')
const apiLog = join(summaryDir, 'api-server.log')
if (existsSync(dynamodbLog)) {
  serverLogs.dynamodb = repoRel(dynamodbLog)
}
if (existsSync(apiLog)) {
  serverLogs.api = repoRel(apiLog)
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
  message = `${dirLabel} failed (exit ${exitCode})`
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
  apiLogTail: includeApiTail ? tail(repoRel(apiLog), 40) : null,
  steps,
}

writeFileSync(join(summaryDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
