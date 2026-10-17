#!/usr/bin/env node
/**
 * Headless Chromium check for CSP violations on a deployed (or CSP-served) site.
 *
 * Default (SPA): open `/` and one article detail; require zero
 * `securitypolicyviolation` events and console CSP errors; require the feed to
 * render and `/api` calls to succeed.
 *
 * `--page-only`: visit SITE_URL once and only assert CSP (for the external-script probe).
 *
 * Env:
 *   SITE_URL            base URL (required), e.g. https://xxxx.cloudfront.net
 *   CSP_ARTIFACT_DIR    directory for failure screenshots + report (default: csp-browser-artifacts)
 */
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const require = createRequire(path.join(root, 'e2e/package.json'))
const { chromium } = require('playwright')

const pageOnly = process.argv.includes('--page-only')
const site = process.env.SITE_URL
if (!site) {
  console.error('SITE_URL is required')
  process.exit(2)
}

const artifactDir = path.resolve(process.env.CSP_ARTIFACT_DIR || 'csp-browser-artifacts')
const base = site.replace(/\/$/, '')

function isCspConsoleMessage(text) {
  return /content security policy|refused to (apply|load|connect|execute|frame)|csp/i.test(
    text,
  )
}

function summarizeViolation(v) {
  return {
    violatedDirective: v.violatedDirective,
    effectiveDirective: v.effectiveDirective,
    blockedURI: v.blockedURI,
    sourceFile: v.sourceFile,
    lineNumber: v.lineNumber,
    columnNumber: v.columnNumber,
    disposition: v.disposition,
  }
}

async function attachCspCollectors(page, bucket) {
  await page.addInitScript(() => {
    window.__yohakuCspViolations = []
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__yohakuCspViolations.push({
        violatedDirective: event.violatedDirective,
        effectiveDirective: event.effectiveDirective,
        blockedURI: event.blockedURI,
        sourceFile: event.sourceFile,
        lineNumber: event.lineNumber,
        columnNumber: event.columnNumber,
        disposition: event.disposition,
        originalPolicy: event.originalPolicy,
      })
    })
  })

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    if (isCspConsoleMessage(text)) {
      bucket.consoleErrors.push(text)
    }
  })

  page.on('pageerror', (err) => {
    const text = String(err?.message || err)
    if (isCspConsoleMessage(text)) {
      bucket.consoleErrors.push(text)
    }
  })
}

async function readViolations(page) {
  return page.evaluate(() => window.__yohakuCspViolations || [])
}

async function writeArtifacts(label, page, report) {
  await mkdir(artifactDir, { recursive: true })
  const safe = label.replace(/[^a-zA-Z0-9._-]+/g, '_')
  const shot = path.join(artifactDir, `${safe}.png`)
  const json = path.join(artifactDir, `${safe}.json`)
  try {
    await page.screenshot({ path: shot, fullPage: true })
  } catch {
    // page may already be closed
  }
  await writeFile(json, `${JSON.stringify(report, null, 2)}\n`)
  console.error(`csp-browser-check: wrote ${shot} and ${json}`)
}

async function checkPage(page, bucket, label, url, assertSpa) {
  const apiOk = { articles: false, article: false }
  const onResponse = (res) => {
    let pathname
    try {
      pathname = new URL(res.url()).pathname
    } catch {
      return
    }
    if (!res.ok()) return
    if (pathname === '/api/articles' || pathname === '/api/articles/') {
      apiOk.articles = true
    } else if (pathname.startsWith('/api/articles/')) {
      apiOk.article = true
    }
  }
  page.on('response', onResponse)

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  // Fonts / late CSP reports can arrive after the first paint
  await new Promise((r) => setTimeout(r, 2000))

  const violations = (await readViolations(page)).map(summarizeViolation)
  bucket.violations.push(...violations)

  const report = {
    label,
    url,
    violations,
    consoleErrors: [...bucket.consoleErrors],
    apiOk,
  }

  if (assertSpa === 'home') {
    const heading = page.getByRole('heading', { level: 1, name: '余白' })
    await heading.waitFor({ state: 'visible', timeout: 20_000 })
    const links = page.locator('a[href^="/articles/"]')
    await links.first().waitFor({ state: 'visible', timeout: 20_000 })
    const count = await links.count()
    if (count < 1) {
      report.error = 'feed rendered zero article links'
      await writeArtifacts(label, page, report)
      throw new Error(report.error)
    }
    if (!apiOk.articles) {
      report.error = 'GET /api/articles did not succeed'
      await writeArtifacts(label, page, report)
      throw new Error(report.error)
    }
    const href = await links.first().getAttribute('href')
    report.articleHref = href
    if (!href) {
      report.error = 'first article link has no href'
      await writeArtifacts(label, page, report)
      throw new Error(report.error)
    }
  }

  if (assertSpa === 'article') {
    const heading = page.locator('main h1')
    await heading.waitFor({ state: 'visible', timeout: 20_000 })
    if (!apiOk.article) {
      report.error = 'GET /api/articles/:slug did not succeed'
      await writeArtifacts(label, page, report)
      throw new Error(report.error)
    }
  }

  if (violations.length > 0 || bucket.consoleErrors.length > 0) {
    report.error = `CSP violations=${violations.length} console=${bucket.consoleErrors.length}`
    await writeArtifacts(label, page, report)
    throw new Error(report.error)
  }

  page.off('response', onResponse)
  console.log(`csp-browser-check: ok ${label} ${url}`)
  return report
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  const page = await context.newPage()
  const bucket = { violations: [], consoleErrors: [] }
  await attachCspCollectors(page, bucket)

  try {
    if (pageOnly) {
      await checkPage(page, bucket, 'page', base, null)
    } else {
      const home = await checkPage(page, bucket, 'home', `${base}/`, 'home')
      bucket.consoleErrors = []
      const articlePath = home.articleHref.startsWith('http')
        ? home.articleHref
        : `${base}${home.articleHref.startsWith('/') ? '' : '/'}${home.articleHref}`
      await checkPage(page, bucket, 'article', articlePath, 'article')
    }
    console.log('csp-browser-check: passed')
  } catch (err) {
    console.error(`csp-browser-check: FAILED ${err.message || err}`)
    process.exitCode = 1
  } finally {
    await browser.close()
  }
}

main()
