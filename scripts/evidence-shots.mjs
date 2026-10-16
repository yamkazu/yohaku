// Canonical evidence screenshot filenames for verify + e2e.
// Do not re-list these names elsewhere; import or read this module / JSON.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const EVIDENCE_SHOTS_JSON = join(HERE, 'evidence-shots.json')

export function loadEvidenceShots() {
  const raw = JSON.parse(readFileSync(EVIDENCE_SHOTS_JSON, 'utf8'))
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`${EVIDENCE_SHOTS_JSON} must be a non-empty JSON array of filenames`)
  }
  for (const name of raw) {
    if (typeof name !== 'string' || !/^[a-z0-9-]+\.png$/.test(name)) {
      throw new Error(
        `${EVIDENCE_SHOTS_JSON}: invalid entry ${JSON.stringify(name)} (want kebab-case.png)`,
      )
    }
  }
  return raw
}

export function loadEvidenceBasenames() {
  return loadEvidenceShots().map((name) => name.replace(/\.png$/, ''))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const name of loadEvidenceShots()) {
    process.stdout.write(`${name}\n`)
  }
}
