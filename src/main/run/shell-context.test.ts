import { describe, expect, it } from 'vitest'
import { collectShellContext } from './shell-context'

const turn = (text: string, output = `out:${text}`) => ({ userMessage: { text }, assistantMessage: { text: output } })

describe('collectShellContext', () => {
  it('只收集单 ! 前缀且有助手输出的回合，并保留最近八条', () => {
    const turns = [turn('普通'), turn('!!escaped'), ...Array.from({ length: 9 }, (_, index) => turn(`!cmd${index}`)), turn('!失败', '')]
    const result = collectShellContext(turns)
    expect(result).toContain('!cmd1')
    expect(result).toContain('!cmd8')
    expect(result).not.toContain('!cmd0')
    expect(result).not.toContain('escaped')
    expect(result).not.toContain('!失败')
  })

  it('总输出限制为 32KiB，并带有明确的上下文标记', () => {
    const result = collectShellContext([turn('!big', 'x'.repeat(40_000))])
    expect(result.startsWith('[以下是之前直接执行命令的结果，仅供参考]')).toBe(true)
    expect(result.length).toBeLessThanOrEqual(32 * 1024)
  })

  it('没有可注入内容时返回空字符串', () => {
    expect(collectShellContext([turn('普通'), turn('!!x', 'out')])).toBe('')
  })
})
