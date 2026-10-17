#!/usr/bin/env node
/**
 * Serve web/dist with the production Content-Security-Policy and proxy /api/*
 * to the local Axum API (path rewrite /api → ""), matching CloudFront.
 *
 * Also serves /csp-probe-external.html — a page that loads an external script
 * so the browser CSP check can demonstrate failure.
 *
 * Env:
 *   PORT          listen port (default 3850)
 *   API_ORIGIN    local API origin (default http://127.0.0.1:3848)
 *   DIST_DIR      static root (default web/dist)
 */
import http from 'node:http'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const port = Number(process.env.PORT || 3850)
const apiOrigin = (process.env.API_ORIGIN || 'http://127.0.0.1:3848').replace(/\/$/, '')
const distDir = path.resolve(process.env.DIST_DIR || path.join(root, 'web/dist'))
const headersSpec = JSON.parse(
  readFileSync(path.join(root, 'scripts/cloudfront-security-headers.json'), 'utf8'),
)
const csp = headersSpec.contentSecurityPolicy

const probeHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>CSP external script probe</title>
  </head>
  <body>
    <p>This page intentionally loads an external script to trip CSP.</p>
    <script src="https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js"></script>
  </body>
</html>
`

function contentType(filePath) {
  switch (path.extname(filePath)) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    case '.json':
      return 'application/json'
    case '.woff2':
      return 'font/woff2'
    default:
      return 'application/octet-stream'
  }
}

function securityHeaders(extra = {}) {
  return {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': headersSpec.contentTypeOptions,
    'X-Frame-Options': headersSpec.frameOptions,
    'Cache-Control': 'no-store',
    ...extra,
  }
}

function send(res, status, body, type) {
  res.writeHead(status, securityHeaders({ 'Content-Type': type }))
  res.end(body)
}

function proxyApi(req, res) {
  const incoming = new URL(req.url || '/', 'http://127.0.0.1')
  // CloudFront api viewer: strip the /api prefix before Axum.
  const stripped = incoming.pathname.replace(/^\/api/, '') || '/'
  const target = new URL(stripped + incoming.search, apiOrigin)
  const headers = { ...req.headers, host: target.host }
  delete headers['accept-encoding']
  const upstream = http.request(
    target,
    { method: req.method, headers },
    (up) => {
      res.writeHead(up.statusCode || 502, {
        ...up.headers,
        ...securityHeaders(),
      })
      up.pipe(res)
    },
  )
  upstream.on('error', (err) => {
    send(res, 502, JSON.stringify({ error: String(err) }), 'application/json')
  })
  req.pipe(upstream)
}

function resolveStatic(urlPath) {
  const rel = decodeURIComponent(urlPath.split('?')[0])
  if (rel.includes('..')) return null
  const candidate = path.join(distDir, rel === '/' ? 'index.html' : rel)
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  // SPA fallback for extensionless routes (matches CloudFront viewer).
  if (!path.extname(rel)) {
    const index = path.join(distDir, 'index.html')
    if (existsSync(index)) return index
  }
  return null
}

if (!existsSync(path.join(distDir, 'index.html'))) {
  console.error(`missing ${distDir}/index.html — run npm run build:web:deploy first`)
  process.exit(1)
}

const server = http.createServer((req, res) => {
  const url = req.url || '/'
  if (url.split('?')[0] === '/csp-probe-external.html') {
    send(res, 200, probeHtml, 'text/html; charset=utf-8')
    return
  }
  if (url === '/api' || url.startsWith('/api/') || url.startsWith('/api?')) {
    proxyApi(req, res)
    return
  }
  const filePath = resolveStatic(url)
  if (!filePath) {
    send(res, 404, 'not found', 'text/plain; charset=utf-8')
    return
  }
  res.writeHead(200, securityHeaders({ 'Content-Type': contentType(filePath) }))
  createReadStream(filePath).pipe(res)
})

server.listen(port, '127.0.0.1', () => {
  console.log(`serve-csp-local: http://127.0.0.1:${port}`)
  console.log(`serve-csp-local: probe http://127.0.0.1:${port}/csp-probe-external.html`)
  console.log('serve-csp-local: CSP from scripts/cloudfront-security-headers.json')
  console.log(`serve-csp-local: proxy /api → ${apiOrigin}`)
})
