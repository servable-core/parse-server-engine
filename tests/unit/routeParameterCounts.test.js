import { jest } from '@jest/globals'
import { createRouteParametersReader } from '../../src/register/route/parameters/index.js'
import { routeParametersSummaryOf, recordDefinedRouteParameters, forgetDefinedRouteParameters } from '../../src/register/route/parameters/bootReport.js'
import { reportTheEngineOptions } from '../../src/options/report.js'

// Production proof 3.8 and 3.14 (.docs/technical/production-proof-instrumentation-2026-11-23.md): typed route parameters counted
// (refusals by route, reads by how each parameter was read, undeclared values read as text by route) through
// Servable.App.Metrics, never with a value a client sent; one summary line per boot, always; the engine options at boot.

const recordingMetrics = () => {
  const recorded = []
  return { recorded, counter: (name) => ({ add: (value, attributes) => recorded.push({ name, value, ...attributes }) }) }
}
let metrics
beforeEach(() => { metrics = recordingMetrics(); globalThis.Servable = { App: { Metrics: metrics } } })
afterEach(() => { delete globalThis.Servable; forgetDefinedRouteParameters() })
const named = (name) => metrics.recorded.filter((point) => point.name === name)

const readerOf = (queryStringDeclaration, { isQueryValueGuessingEnabled = false } = {}) => createRouteParametersReader({
  queryStringDeclaration, isQueryValueGuessingEnabled, areDeclaredRouteParametersTyped: true, routeName: 'GET /v1/explore', reportDeclarationProblem: () => {},
})

describe('route parameters, counted', () => {
  test('declared values and a wildcard read as guessed are counted by mode, no route on reads (the healthy path)', () => {
    readerOf({ page: 'integer', '*': 'guessed' }).readQueryOf({ url: '/v1/explore?page=2&tag=x' })
    expect(named('servable_route_parameter_reads_total').map(({ mode }) => mode).sort()).toEqual(['declared', 'wildcard_guessed'])
    expect(named('servable_route_parameter_reads_total').every((point) => !('route' in point))).toBe(true)
    expect(named('servable_route_parameter_refusals_total')).toEqual([])
  })

  test('a value the declaration refuses is counted by route, never with the value (the alarm path)', () => {
    expect(() => readerOf({ page: 'integer' }).readQueryOf({ url: '/v1/explore?page=secret-abc' })).toThrow()
    expect(named('servable_route_parameter_refusals_total')).toEqual([{ name: 'servable_route_parameter_refusals_total', value: 1, route: 'GET /v1/explore', source: 'query' }])
    expect(JSON.stringify(metrics.recorded)).not.toContain('secret-abc')
  })

  test('an undeclared value read as text with guessing off is counted by route; guessed when guessing is on', () => {
    readerOf({ page: 'integer' }).readQueryOf({ url: '/v1/explore?other=3' })
    readerOf({ page: 'integer' }, { isQueryValueGuessingEnabled: true }).readQueryOf({ url: '/v1/explore?other=3' })
    expect(named('servable_route_parameter_reads_total').map(({ mode }) => mode)).toEqual(['undeclared_text', 'undeclared_guessed'])
    expect(named('servable_route_parameter_undeclared_text_reads_total')).toEqual([{ name: 'servable_route_parameter_undeclared_text_reads_total', value: 1, route: 'GET /v1/explore' }])
  })

  test('without Servable.App.Metrics nothing is counted and the reader answers as before', () => {
    globalThis.Servable = { App: {} }
    expect(readerOf({ page: 'integer' }).readQueryOf({ url: '/v1/explore?page=2' })).toEqual({ page: 2 })
    expect(metrics.recorded).toEqual([])
  })
})

describe('the route parameters summary', () => {
  test('counts every route defined, declared or not, and the wildcards read as guessed', () => {
    recordDefinedRouteParameters({ isDeclared: true, isWildcardGuessed: false })
    recordDefinedRouteParameters({ isDeclared: true, isWildcardGuessed: true })
    recordDefinedRouteParameters({ isDeclared: false, doesSeemToReadParameters: true })
    expect(routeParametersSummaryOf({ isQueryValueGuessingEnabled: false, areDeclaredRouteParametersTyped: true })).toEqual({
      proof: 'route-parameters', routes: 3, declared: 2, undeclared: 1, undeclaredReading: 1, wildcardGuessed: 1,
      isQueryValueGuessingEnabled: false, areDeclaredRouteParametersTyped: true,
    })
  })
})

describe('the engine options at boot', () => {
  test('every option as resolved, the bypass secret only as set or not set', () => {
    const logger = { info: jest.fn() }
    const fields = reportTheEngineOptions({ engineOptions: { isFastObjectGetEnabled: false, areDeclaredIndexesEnsured: true }, routeCacheBypassSecret: 'a-secret-of-the-server-0123456', logger })
    expect(fields).toEqual({ proof: 'engine-options', isFastObjectGetEnabled: false, areDeclaredIndexesEnsured: true, routeCacheBypassSecret: 'set' })
    expect(logger.info).toHaveBeenCalledWith(fields, '[ENGINE] options')
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('a-secret')
    expect(reportTheEngineOptions({ engineOptions: {}, routeCacheBypassSecret: null, logger }).routeCacheBypassSecret).toBe('not set')
  })
})
