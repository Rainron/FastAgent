import { describe, expect, it } from 'vitest'
import { checkSkill } from './skill-check'
import { parseAllowedTools, parseReferencedFiles } from './skill-manifest'

const FRONTMATTER = ['---', 'name: code-review', 'description: 审查代码', 'allowed-tools: read, grep', '---', ''].join('\n')

function input(patch: Partial<Parameters<typeof checkSkill>[0]> = {}) {
  return {
    name: 'code-review',
    content: `${FRONTMATTER}\n先读改动，再逐条给结论。`,
    directoryName: 'code-review',
    files: ['SKILL.md'],
    availableTools: ['read', 'grep', 'shell'],
    ...patch
  }
}

describe('parseAllowedTools', () => {
  it('逗号写法', () => {
    expect(parseAllowedTools(FRONTMATTER)).toEqual(['read', 'grep'])
  })

  it('方括号写法与引号都能剥掉', () => {
    expect(parseAllowedTools('---\nallowed-tools: ["read", \'write\']\n---\n')).toEqual(['read', 'write'])
  })

  it('YAML 列表写法', () => {
    expect(parseAllowedTools('---\nallowed-tools:\n  - read\n  - bash\nname: x\n---\n')).toEqual(['read', 'bash'])
  })

  it('下划线别名同样识别；没有前言时为空', () => {
    expect(parseAllowedTools('---\nallowed_tools: read\n---\n')).toEqual(['read'])
    expect(parseAllowedTools('没有前言')).toEqual([])
  })
})

describe('parseReferencedFiles', () => {
  it('收 Markdown 链接与裸的附属目录路径', () => {
    const text = '---\nname: a\n---\n见 [清单](references/checklist.md) 与 scripts/run.py。'
    expect(parseReferencedFiles(text).sort()).toEqual(['references/checklist.md', 'scripts/run.py'])
  })

  it('外链、锚点与绝对路径不算附属文件', () => {
    const text = '---\nname: a\n---\n[站点](https://example.com) [锚](#x) [根](/etc/passwd) [上级](../a.md)'
    expect(parseReferencedFiles(text)).toEqual([])
  })
})

describe('checkSkill', () => {
  it('配置齐全且工具可用时通过', () => {
    const result = checkSkill(input())
    expect(result.ok).toBe(true)
    expect(result.requiredTools).toEqual(['read', 'grep'])
    expect(result.missingTools).toEqual([])
  })

  it('工具缺失是 error，并指出具体缺项', () => {
    const result = checkSkill(input({ availableTools: ['read'] }))
    expect(result.ok).toBe(false)
    expect(result.missingTools).toEqual(['grep'])
    expect(result.issues.some((item) => item.level === 'error' && item.message.includes('grep'))).toBe(true)
  })

  it('目录名与前言 name 不一致是 error', () => {
    const result = checkSkill(input({ directoryName: 'code-review-2' }))
    expect(result.ok).toBe(false)
    expect(result.issues.some((item) => item.message.includes('目录名'))).toBe(true)
  })

  it('缺前言是 error', () => {
    expect(checkSkill(input({ content: '直接正文' })).ok).toBe(false)
  })

  it('引用了不存在的文件是 warning，不阻塞', () => {
    const result = checkSkill(input({ content: `${FRONTMATTER}\n见 [清单](references/checklist.md)` }))
    expect(result.ok).toBe(true)
    expect(result.issues.some((item) => item.level === 'warning' && item.message.includes('references/checklist.md'))).toBe(true)
  })

  it('带脚本但没有 Shell 工具时给 warning，并说明权限仍走沙箱', () => {
    const result = checkSkill(input({ files: ['SKILL.md', 'scripts/run.py'], availableTools: ['read', 'grep'] }))
    const warning = result.issues.find((item) => item.message.includes('脚本文件'))
    expect(warning?.level).toBe('warning')
    expect(warning?.hint).toContain('不会因导入 Skill 获得额外权限')
  })

  it('没有声明 allowed-tools 时只给提示，不算失败', () => {
    const result = checkSkill(input({ content: '---\nname: code-review\ndescription: d\n---\n正文' }))
    expect(result.ok).toBe(true)
    expect(result.issues.some((item) => item.level === 'info')).toBe(true)
  })
})
