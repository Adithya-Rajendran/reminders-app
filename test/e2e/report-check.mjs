import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const reportPath = process.env.PLAYWRIGHT_JSON_REPORT || path.join(HERE, '.artifacts', 'playwright-results.json')

if (!fs.existsSync(reportPath)) {
  console.error(`Playwright JSON report not found: ${reportPath}`)
  process.exit(1)
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
const flakes = []

function walkSuite(suite, parents = []) {
  const nextParents = suite.title ? [...parents, suite.title] : parents
  for (const child of suite.suites || []) walkSuite(child, nextParents)
  for (const spec of suite.specs || []) {
    for (const test of spec.tests || []) {
      const results = test.results || []
      const final = results[results.length - 1]
      const title = [...nextParents, spec.title, test.projectName].filter(Boolean).join(' › ')
      const passedAfterRetry = results.length > 1 && final?.status === 'passed'
      if (test.status === 'flaky' || test.outcome === 'flaky' || passedAfterRetry) flakes.push(title)
    }
  }
}

for (const suite of report.suites || []) walkSuite(suite)

if (flakes.length) {
  console.error('Playwright reported flaky tests; retries are diagnostic only and must not hide regressions:')
  for (const title of flakes) console.error(`- ${title}`)
  process.exit(1)
}

console.log('Playwright report check passed: no flaky/retried tests.')
