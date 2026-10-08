import { describe, expect, it } from 'vitest'
import { createShellCommandLifecycle } from '../../conversation/shell-command-lifecycle'
import { truncateShellOutput } from '../../../shared/shell-command'

describe('shell command lifecycle guards', () => {
  it('drops a late result from a previous conversation generation', () => {
    const lifecycle = createShellCommandLifecycle()
    const scope = lifecycle.begin('x', 'A')
    expect(lifecycle.current('x', scope, 'A')).toBe(true)
    lifecycle.dispose(() => undefined)
    expect(lifecycle.current('x', scope, 'A')).toBe(false)
  })

  it('keeps rendered output within 64K while retaining the tail', () => {
    const result = truncateShellOutput('head\n' + 'x'.repeat(70_000))
    expect(result.truncated).toBe(true)
    expect(result.text.length).toBe(64 * 1024)
    expect(result.text.endsWith('x')).toBe(true)
  })
})
