// Fails when evidence screenshot names are re-defined instead of reading the
// single source at scripts/evidence-shots.json (lesson from #42 / issue #19).
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EVIDENCE_SHOTS_JSON, loadEvidenceBasenames, loadEvidenceShots } from './evidence-shots.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const errors = []

function fail(msg) {
  errors.push(msg)
}

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8')
}

function listTsFiles(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, ent.name)
    if (ent.isDirectory()) out.push(...listTsFiles(path))
    else if (ent.name.endsWith('.ts')) out.push(path)
  }
  return out
}

const shots = loadEvidenceShots()
const basenames = loadEvidenceBasenames()
const basenameSet = new Set(basenames)

const verifySh = read('scripts/verify.sh')
if (!verifySh.includes('evidence-shots.mjs') && !verifySh.includes('evidence-shots.json')) {
  fail('scripts/verify.sh must load screenshot names from scripts/evidence-shots.{mjs,json}')
}
if (/EVIDENCE_SHOTS=\(\s*article-list\.png/.test(verifySh)) {
  fail(
    'scripts/verify.sh hardcodes EVIDENCE_SHOTS; read scripts/evidence-shots.json via evidence-shots.mjs instead',
  )
}

const summary = read('scripts/verify-summary.mjs')
if (!summary.includes('evidence-shots')) {
  fail('scripts/verify-summary.mjs must import screenshot names from scripts/evidence-shots.mjs')
}
if (/evidenceNames\s*=\s*\[\s*['"]article-list\.png['"]/.test(summary)) {
  fail(
    'scripts/verify-summary.mjs hardcodes evidenceNames; import loadEvidenceShots() from evidence-shots.mjs instead',
  )
}

const saveEvidenceCalls = new Set()
const saveEvidenceRe = /saveEvidence\s*\(\s*[^,]+,\s*['"]([a-z0-9-]+)['"]\s*\)/g
for (const file of listTsFiles(join(ROOT, 'e2e'))) {
  if (file.includes(`${join('e2e', 'node_modules')}`)) continue
  const text = readFileSync(file, 'utf8')
  let match
  while ((match = saveEvidenceRe.exec(text)) !== null) {
    saveEvidenceCalls.add(match[1])
  }
}

if (saveEvidenceCalls.size === 0) {
  fail('no saveEvidence(page, \"name\") calls found under e2e/; expected basenames from evidence-shots.json')
}

for (const name of saveEvidenceCalls) {
  if (!basenameSet.has(name)) {
    fail(
      `e2e saveEvidence uses \"${name}\" which is not in ${EVIDENCE_SHOTS_JSON} (${shots.join(', ')}). Add it to the JSON (single source) or fix the call.`,
    )
  }
}

for (const name of basenames) {
  if (!saveEvidenceCalls.has(name)) {
    fail(
      `${EVIDENCE_SHOTS_JSON} lists \"${name}.png\" but no e2e saveEvidence(..., \"${name}\") call writes it`,
    )
  }
}

if (errors.length) {
  console.error('evidence-shots check failed:')
  for (const msg of errors) {
    console.error(`  - ${msg}`)
  }
  console.error(
    'Fix: keep one list in scripts/evidence-shots.json; have verify.sh, verify-summary.mjs, and e2e read it. Do not copy the names with a \"shared with …\" comment.',
  )
  process.exit(1)
}

console.log(`evidence-shots ok (${shots.length} names from scripts/evidence-shots.json)`)
