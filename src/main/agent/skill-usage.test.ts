import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { skillIdForPaths } from './skill-usage'

const skillsRoot = join('C:', 'Users', 'dev', '.fa', 'skills')
const manifests = [join(skillsRoot, 'code-review', 'SKILL.md'), join(skillsRoot, 'release-notes', 'SKILL.md')]

describe('skillIdForPaths', () => {
  it('读 SKILL.md 本身算用到该 Skill', () => {
    expect(skillIdForPaths([join(skillsRoot, 'code-review', 'SKILL.md')], manifests)).toBe('code-review')
  })

  it('读 Skill 目录下的附属文件同样算用到', () => {
    expect(skillIdForPaths([join(skillsRoot, 'release-notes', 'references', 'template.md')], manifests)).toBe('release-notes')
  })

  it('工作区里的普通文件不算', () => {
    expect(skillIdForPaths([join('K:', 'repo', 'src', 'index.ts')], manifests)).toBeNull()
  })

  it('同名前缀目录不误判', () => {
    expect(skillIdForPaths([join(skillsRoot, 'code-review-extra', 'SKILL.md')], manifests)).toBeNull()
  })

  it('空输入返回 null', () => {
    expect(skillIdForPaths([], manifests)).toBeNull()
    expect(skillIdForPaths([join(skillsRoot, 'code-review', 'SKILL.md')], [])).toBeNull()
  })
})
