import assert from 'node:assert/strict'
import test from 'node:test'

import { staticPath } from '../src/lib/static-path.js'

/**
 * The one function both halves of the static build depend on. If the prerender
 * and the browser disagree about a single filename, the failure is a 404 at
 * runtime rather than an error at build time — which is exactly how this
 * project once shipped three broken tabs.
 */

test('a request without parameters becomes an index file', () => {
  assert.equal(staticPath('/api/stations'), 'api/stations/index.json')
})

test('parameters are sorted, so two spellings of one request are one file', () => {
  const a = staticPath('/api/weather/monthly?stationId=01691&year=2026&month=7')
  const b = staticPath('/api/weather/monthly?month=7&year=2026&stationId=01691')
  assert.equal(a, b)
  assert.equal(a, 'api/weather/monthly/month-7__stationId-01691__year-2026.json')
})

test('single underscores inside values survive; pairs are split by two', () => {
  const path = staticPath('/api/weather/extremes?category=temp_max&stationId=01691')
  assert.equal(path, 'api/weather/extremes/category-temp_max__stationId-01691.json')
  const [, name] = path.split('extremes/')
  assert.equal(name.split('__').length, 2, 'der Wert temp_max darf nicht getrennt werden')
})

test('anything that would be illegal in a filename is replaced', () => {
  const path = staticPath('/api/weather/newsroom?datum=2026-07-31&stationId=01691')
  assert.equal(path, 'api/weather/newsroom/datum-2026-07-31__stationId-01691.json')
  assert.ok(!staticPath('/api/x?a=b/c').includes('b/c'), 'ein Schrägstrich im Wert wäre ein Verzeichnis')
  assert.equal(staticPath('/api/x?a=b/c'), 'api/x/a-b-c.json')
})

test('leading and trailing slashes do not create empty path segments', () => {
  assert.equal(staticPath('/api/dashboard/'), 'api/dashboard/index.json')
  assert.equal(staticPath('api/dashboard'), 'api/dashboard/index.json')
})
