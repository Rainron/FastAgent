import { describe, expect, it } from 'vitest'
import { alwaysAllowPatterns, GLOBAL_DENY_RULES, planModeAction, presetRuleSet, PRIVATE_KEY_RULES, stricterAction, TOOL_KEY_MAP } from './permission-rules'
import { resolvePermission } from '../main/agent/permission/permission-engine'

describe('preset rule sets', () => {
  it('ask: 只读放行，写与 shell 默认询问，外部目录拒绝', () => {
    const rules = presetRuleSet('ask')
    expect(rules.read).toEqual([{ pattern: '*', action: 'allow' }])
    expect(rules.search).toEqual([{ pattern: '*', action: 'allow' }])
    expect(rules.edit).toEqual([{ pattern: '*', action: 'ask' }])
    expect(rules.external_directory).toEqual([{ pattern: '*', action: 'deny' }])
    expect(rules.question).toEqual([{ pattern: '*', action: 'allow' }])
    expect(rules.todowrite).toEqual([{ pattern: '*', action: 'allow' }])
    expect(rules.shell.map((rule) => rule.action)).toEqual(['allow', 'allow', 'allow', 'deny', 'deny', 'deny', 'deny', 'ask'])
  })

  it('workspace: edit 放行，常用命令宽泛放行，不可逆动作收窄为询问，默认放行', () => {
    const rules = presetRuleSet('workspace')
    expect(rules.edit).toEqual([{ pattern: '*', action: 'allow' }])
    expect(rules.external_directory).toEqual([{ pattern: '*', action: 'ask' }])
    // last-match-wins：ask 在宽泛 allow 之后压住它，deny 再压住 ask。
    expect(resolvePermission('shell', 'npm install', rules)).toBe('allow')
    expect(resolvePermission('shell', 'npm run build', rules)).toBe('allow')
    expect(resolvePermission('shell', 'git commit -m x', rules)).toBe('allow')
    expect(resolvePermission('shell', 'mkdir build', rules)).toBe('allow')
    expect(resolvePermission('shell', 'node script.js', rules)).toBe('allow')
    expect(resolvePermission('shell', 'some-unknown-cli --flag', rules)).toBe('allow')
    expect(resolvePermission('shell', 'git push origin main', rules)).toBe('ask')
    expect(resolvePermission('shell', 'git reset --hard HEAD~1', rules)).toBe('ask')
    expect(resolvePermission('shell', 'git clean -fd', rules)).toBe('ask')
    expect(resolvePermission('shell', 'rm build.log', rules)).toBe('ask')
    expect(resolvePermission('shell', 'Remove-Item build.log', rules)).toBe('ask')
    expect(resolvePermission('shell', 'curl https://example.com', rules)).toBe('ask')
    expect(resolvePermission('shell', 'ssh host', rules)).toBe('ask')
    expect(resolvePermission('shell', 'git push --force origin main', rules)).toBe('deny')
    expect(resolvePermission('shell', 'rm -rf node_modules', rules)).toBe('deny')
    expect(resolvePermission('shell', 'shutdown now', rules)).toBe('deny')
  })

  it('full: shell 默认放行，但显式 deny 不失效', () => {
    const rules = presetRuleSet('full')
    expect(rules.shell).toEqual([...GLOBAL_DENY_RULES, { pattern: '*', action: 'allow' }])
    expect(rules.external_directory).toEqual([{ pattern: '*', action: 'allow' }])
  })

  it('MCP 工具默认放行，不再询问（读写由服务器注解区分但均不拦）', () => {
    for (const preset of ['ask', 'workspace', 'full'] as const) {
      const rules = presetRuleSet(preset)
      expect(rules.mcp_read).toEqual([{ pattern: '*', action: 'allow' }])
      expect(rules.mcp_write).toEqual([{ pattern: '*', action: 'allow' }])
    }
  })

  it('secret_file 私钥三档都 deny，其余密钥 ask/workspace 询问、full 放行', () => {
    for (const preset of ['ask', 'workspace', 'full'] as const) {
      const rules = presetRuleSet(preset)
      expect(rules.secret_file.filter((rule) => rule.pattern !== '*')).toEqual(PRIVATE_KEY_RULES)
      expect(rules.secret_file.at(-1)).toEqual({ pattern: '*', action: preset === 'full' ? 'allow' : 'ask' })
    }
    expect(resolvePermission('secret_file', '.env', presetRuleSet('full'))).toBe('allow')
    expect(resolvePermission('secret_file', '.env', presetRuleSet('workspace'))).toBe('ask')
  })

  it('全局 deny 规则在三个预设中都存在', () => {
    for (const preset of ['ask', 'workspace', 'full'] as const) {
      const denies = presetRuleSet(preset).shell.filter((rule) => rule.action === 'deny')
      expect(denies).toEqual(GLOBAL_DENY_RULES)
    }
  })
})

describe('tool key mapping', () => {
  it('把 pi 工具名映射到逻辑工具名', () => {
    expect(TOOL_KEY_MAP.read).toBe('read')
    expect(TOOL_KEY_MAP.grep).toBe('search')
    expect(TOOL_KEY_MAP.find).toBe('search')
    expect(TOOL_KEY_MAP.ls).toBe('search')
    expect(TOOL_KEY_MAP.edit).toBe('edit')
    expect(TOOL_KEY_MAP.write).toBe('edit')
    expect(TOOL_KEY_MAP.patch).toBe('edit')
    expect(TOOL_KEY_MAP.bash).toBe('shell')
    expect(TOOL_KEY_MAP.powershell).toBe('shell')
    expect(TOOL_KEY_MAP.question).toBe('question')
    expect(TOOL_KEY_MAP.todowrite).toBe('todowrite')
  })
})

describe('stricterAction', () => {
  it('deny 最严，ask 次之', () => {
    expect(stricterAction(['allow'])).toBe('allow')
    expect(stricterAction(['allow', 'ask'])).toBe('ask')
    expect(stricterAction(['allow', 'deny'])).toBe('deny')
    expect(stricterAction(['ask', 'deny'])).toBe('deny')
    expect(stricterAction([])).toBe('allow')
  })
})
describe('alwaysAllowPatterns', () => {
  it('shell 命令按可执行名泛化，裸命令与带参数各一条', () => {
    expect(alwaysAllowPatterns('shell', 'mvn clean install')).toEqual(['mvn', 'mvn *'])
    expect(alwaysAllowPatterns('shell', 'ls')).toEqual(['ls', 'ls *'])
  })

  it('复合命令不泛化：否则一条 allow 会顺带放行拼在后面的东西', () => {
    expect(alwaysAllowPatterns('shell', 'mvn -v && rm -rf x')).toEqual(['mvn -v && rm -rf x'])
    expect(alwaysAllowPatterns('shell', 'echo $(whoami)')).toEqual(['echo $(whoami)'])
    expect(alwaysAllowPatterns('shell', 'cat a | tee b')).toEqual(['cat a | tee b'])
  })

  it('全局禁止清单里的可执行名不泛化', () => {
    expect(alwaysAllowPatterns('shell', 'git remote -v')).toEqual(['git remote -v'])
    expect(alwaysAllowPatterns('shell', 'rm build.log')).toEqual(['rm build.log'])
  })

  it('非 shell 工具保持精确匹配，空 subject 落到 *', () => {
    expect(alwaysAllowPatterns('edit', 'src/App.tsx')).toEqual(['src/App.tsx'])
    expect(alwaysAllowPatterns('shell', '   ')).toEqual(['*'])
  })
})

describe('planModeAction', () => {
  it('写入类逻辑工具无条件拒绝', () => {
    expect(planModeAction('edit', 'src/App.tsx')).toBe('deny')
    expect(planModeAction('mcp_write', 'mcp__x__create')).toBe('deny')
    expect(planModeAction('external_directory', 'C:/other/a.ts')).toBe('deny')
  })

  it('shell 只放行查看类命令，其余拒绝', () => {
    expect(planModeAction('shell', 'git status')).toBeNull()
    expect(planModeAction('shell', 'git diff --stat')).toBeNull()
    expect(planModeAction('shell', 'git log -n 3')).toBeNull()
    expect(planModeAction('shell', 'npm run build')).toBe('deny')
    expect(planModeAction('shell', 'rm -rf x')).toBe('deny')
    expect(planModeAction('shell', 'git push')).toBe('deny')
  })

  it('只读工具交回常规权限解析', () => {
    expect(planModeAction('read', 'src/App.tsx')).toBeNull()
    expect(planModeAction('search', 'todo')).toBeNull()
    expect(planModeAction('todowrite', '')).toBeNull()
  })
})
