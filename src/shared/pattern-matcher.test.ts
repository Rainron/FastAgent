import { describe, expect, it } from 'vitest'
import { matchPattern, patternToRegex } from './pattern-matcher'

describe('pattern matcher', () => {
  it('支持 * 与 ?', () => {
    expect(matchPattern('*', 'anything')).toBe(true)
    expect(matchPattern('*', '')).toBe(true)
    expect(matchPattern('git status*', 'git status --short')).toBe(true)
    expect(matchPattern('git status*', 'git status')).toBe(true)
    expect(matchPattern('*.pem', 'config/cert.pem')).toBe(true)
    expect(matchPattern('id_rsa?', 'id_rsa1')).toBe(true)
  })

  it('锚定全串匹配，不允许部分命中', () => {
    expect(matchPattern('git status*', 'run git status')).toBe(false)
    expect(matchPattern('git status', 'git status --short')).toBe(false)
    expect(matchPattern('git status*', 'git stash')).toBe(false)
    expect(matchPattern('rm -rf *', 'rm -rf node_modules')).toBe(true)
    expect(matchPattern('rm -rf *', 'rm -rf')).toBe(false)
  })

  it('转义其余正则元字符', () => {
    expect(matchPattern('a.b', 'axb')).toBe(false)
    expect(matchPattern('a.b', 'a.b')).toBe(true)
    expect(matchPattern('a+b', 'aaab')).toBe(false)
    expect(matchPattern('a+b', 'a+b')).toBe(true)
    expect(matchPattern('(x)', '(x)')).toBe(true)
    expect(matchPattern('(x)', 'x')).toBe(false)
  })

  it('? 只匹配单个字符', () => {
    expect(matchPattern('a?c', 'abc')).toBe(true)
    expect(matchPattern('a?c', 'ac')).toBe(false)
    expect(matchPattern('a?c', 'abdc')).toBe(false)
  })

  it('生成的正则带锚点', () => {
    const regex = patternToRegex('npm run *')
    expect(regex.source.startsWith('^')).toBe(true)
    expect(regex.source.endsWith('$')).toBe(true)
  })
})