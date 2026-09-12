import { describe, expect, it } from 'vitest'
import type { PermissionRuleSet } from '../../../shared/permission-rules'
import { resolvePermission } from './permission-engine'

describe('permission engine', () => {
  it('last-match-wins：后命中的规则覆盖先命中的', () => {
    const rules: PermissionRuleSet = {
      shell: [
        { pattern: 'git push*', action: 'allow' },
        { pattern: 'git push --force*', action: 'deny' }
      ]
    }
    expect(resolvePermission('shell', 'git push origin main', rules)).toBe('allow')
    expect(resolvePermission('shell', 'git push --force origin main', rules)).toBe('deny')
  })

  it('无命中回落到该工具的 * 规则', () => {
    const rules: PermissionRuleSet = {
      shell: [
        { pattern: 'git status*', action: 'allow' },
        { pattern: '*', action: 'ask' }
      ]
    }
    expect(resolvePermission('shell', 'npm install', rules)).toBe('ask')
  })

  it('该工具没有 * 规则时回落到全局 * 键', () => {
    const rules: PermissionRuleSet = {
      read: [{ pattern: '*.ts', action: 'allow' }],
      '*': [
        { pattern: '*.env*', action: 'deny' },
        { pattern: '*', action: 'ask' }
      ]
    }
    // read 键无 * 规则 → 全局 * 的具体规则命中
    expect(resolvePermission('read', 'config/.env.local', rules)).toBe('deny')
    // 全局 * 的兜底
    expect(resolvePermission('read', 'notes.md', rules)).toBe('ask')
    // 未知工具键同样落到全局
    expect(resolvePermission('unknown_tool', 'whatever', rules)).toBe('ask')
  })

  it('完全无规则时 fail-closed 拒绝', () => {
    expect(resolvePermission('shell', 'echo hi', {})).toBe('deny')
  })

  it('deny 不被档位放宽覆盖（显式 deny 优先于 allow）', () => {
    const rules = presetWithAllowDefault()
    expect(resolvePermission('shell', 'rm -rf node_modules', rules)).toBe('deny')
    expect(resolvePermission('shell', 'git push --force origin main', rules)).toBe('deny')
    expect(resolvePermission('shell', 'shutdown /s', rules)).toBe('deny')
    expect(resolvePermission('shell', 'format d:', rules)).toBe('deny')
    // 常规命令仍走 allow 默认
    expect(resolvePermission('shell', 'npm install', rules)).toBe('allow')
  })

  it('空 subject 只匹配 * 规则', () => {
    const rules: PermissionRuleSet = { question: [{ pattern: '*', action: 'allow' }] }
    expect(resolvePermission('question', '', rules)).toBe('allow')
  })

  it('用户规则追加在后时优先级更高（可覆盖预设 deny）', () => {
    const rules = presetWithAllowDefault()
    rules.shell.push({ pattern: 'git push --force origin dev', action: 'allow' })
    expect(resolvePermission('shell', 'git push --force origin dev', rules)).toBe('allow')
    expect(resolvePermission('shell', 'git push --force origin main', rules)).toBe('deny')
  })
})

function presetWithAllowDefault(): PermissionRuleSet {
  return {
    shell: [
      { pattern: 'rm -rf *', action: 'deny' },
      { pattern: 'git push --force*', action: 'deny' },
      { pattern: 'shutdown*', action: 'deny' },
      { pattern: 'format *', action: 'deny' },
      { pattern: '*', action: 'allow' }
    ]
  }
}