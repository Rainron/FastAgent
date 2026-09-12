import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { LocalSkillRegistry, type SkillStateStore } from './skill-registry'

const roots: string[] = []

function setup() {
  const skillsDir = mkdtempSync(join(tmpdir(), 'fastagent-skills-'))
  roots.push(skillsDir)
  const enabled = new Map<string, boolean>()
  const store: SkillStateStore = {
    isSkillEnabled: (name) => enabled.get(name) ?? false,
    setSkillEnabled: (name, value) => { enabled.set(name, value) },
    removeSkillState: (name) => { enabled.delete(name) }
  }
  return new LocalSkillRegistry(skillsDir, store)
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true })
})

describe('local skill registry', () => {
  it('创建、编辑、启停并返回显式启用的 Skill 路径', () => {
    const registry = setup()
    const created = registry.create({ name: 'code-review', description: '审查代码。用于代码评审。', instructions: '# Code Review\n\n逐项检查。' })

    expect(created.enabled).toBe(false)
    expect(readFileSync(created.filePath, 'utf8')).toContain('name: code-review')
    registry.setEnabled('code-review', true)
    expect(registry.enabledSkillPaths()).toEqual([created.filePath])

    const updated = registry.update('code-review', { description: '审查代码与安全问题。', instructions: '# Review\n\n检查安全边界。' })
    expect(updated.description).toContain('安全')
    expect(readFileSync(updated.filePath, 'utf8')).toContain('检查安全边界')
  })

  it('拒绝非法名称、缺失描述和目录逃逸', () => {
    const registry = setup()
    expect(() => registry.create({ name: '../escape', description: 'bad', instructions: 'bad' })).toThrow('Skill 名称')
    expect(() => registry.create({ name: 'valid', description: '', instructions: 'body' })).toThrow('描述')
  })

  it('删除 Skill 内容和启用状态', () => {
    const registry = setup()
    registry.create({ name: 'temporary', description: '临时技能。', instructions: 'content' })
    registry.setEnabled('temporary', true)
    registry.remove('temporary')
    expect(registry.list()).toEqual([])
    expect(registry.enabledSkillPaths()).toEqual([])
  })

  it('read 返回指令正文供编辑回填', () => {
    const registry = setup()
    registry.create({ name: 'review', description: '审代码。', instructions: '# 步骤\n\n1. 读文件' })
    expect(registry.read('review').instructions).toContain('1. 读文件')
  })

  it('importFromPath 从目录导入并默认停用，重复导入报错', () => {
    const registry = setup()
    const sourceDir = mkdtempSync(join(tmpdir(), 'fastagent-source-'))
    roots.push(sourceDir)
    mkdirSync(join(sourceDir, 'src'), { recursive: true })
    writeFileSync(join(sourceDir, 'SKILL.md'), '---\nname: imported-skill\ndescription: 导入的技能。\n---\n\n正文内容', 'utf8')
    writeFileSync(join(sourceDir, 'src', 'helper.js'), '// helper', 'utf8')

    const imported = registry.importFromPath(sourceDir)
    expect(imported.name).toBe('imported-skill')
    expect(imported.enabled).toBe(false)
    expect(registry.enabledSkillPaths()).toEqual([])
    // 目录连同附属文件一起复制
    expect(readFileSync(join(registry.read('imported-skill').filePath, '..', 'src', 'helper.js'), 'utf8')).toContain('helper')
    expect(() => registry.importFromPath(sourceDir)).toThrow('已存在')

    // 直接给 SKILL.md 文件路径也可导入
    const fileSkill = mkdtempSync(join(tmpdir(), 'fastagent-source-file-'))
    roots.push(fileSkill)
    writeFileSync(join(fileSkill, 'SKILL.md'), '---\nname: file-skill\ndescription: 文件导入。\n---\n\n正文', 'utf8')
    expect(registry.importFromPath(join(fileSkill, 'SKILL.md')).name).toBe('file-skill')
  })

  it('importFromPath 拒绝缺少 SKILL.md 或前言不完整的目录', () => {
    const registry = setup()
    const badDir = mkdtempSync(join(tmpdir(), 'fastagent-bad-'))
    roots.push(badDir)
    writeFileSync(join(badDir, 'readme.txt'), 'nope', 'utf8')
    expect(() => registry.importFromPath(badDir)).toThrow('缺少 SKILL.md')

    const partialDir = mkdtempSync(join(tmpdir(), 'fastagent-partial-'))
    roots.push(partialDir)
    writeFileSync(join(partialDir, 'SKILL.md'), 'no frontmatter', 'utf8')
    expect(() => registry.importFromPath(partialDir)).toThrow('前言')
  })

  it('解析 frontmatter 的 version 与 author', () => {
    const registry = setup()
    registry.installFiles({ 'SKILL.md': '---\nname: meta-skill\ndescription: 带元数据。\nversion: 2.1.0\nauthor: FastAgent\n---\n\n正文' })
    expect(registry.list()[0]).toMatchObject({ name: 'meta-skill', version: '2.1.0', author: 'FastAgent' })
  })

  it('解析带引号的 frontmatter 字段', () => {
    const registry = setup()
    registry.installFiles({ 'SKILL.md': '---\nname: "quoted-skill"\ndescription: "带引号的描述。"\nversion: \'1.2.3\'\nauthor: "FastAgent"\n---\n\n正文' })
    expect(registry.list()[0]).toMatchObject({
      name: 'quoted-skill',
      description: '带引号的描述。',
      version: '1.2.3',
      author: 'FastAgent'
    })
  })

  it('installFiles 拒绝绝对路径、盘符与 .. 逃逸，且不留半成品', () => {
    const registry = setup()
    const manifest = '---\nname: safe-skill\ndescription: 安全校验。\n---\n\n正文'
    for (const bad of ['../evil.txt', '/etc/passwd', 'C:/windows/system32/evil.txt', 'a/../../evil.txt']) {
      expect(() => registry.installFiles({ 'SKILL.md': manifest, [bad]: 'x' })).toThrow(/Skill 文件路径/)
    }
    expect(registry.list()).toEqual([])
  })

  it('installFiles 写入嵌套文件并保持停用', () => {
    const registry = setup()
    const record = registry.installFiles({
      'SKILL.md': '---\nname: nested-skill\ndescription: 嵌套文件。\n---\n\n正文',
      'assets/note.md': '# note'
    })
    expect(record.enabled).toBe(false)
    expect(readFileSync(join(record.filePath, '..', 'assets', 'note.md'), 'utf8')).toBe('# note')
    expect(registry.files('nested-skill').map((file) => file.path).sort()).toEqual(['SKILL.md', 'assets/note.md'])
  })

  it('冲突策略：默认报错，overwrite 覆盖，save-as 换名并同步 frontmatter', () => {
    const registry = setup()
    const files = (body: string) => ({ 'SKILL.md': `---\nname: dup-skill\ndescription: 冲突。\n---\n\n${body}` })
    registry.installFiles(files('第一版'))
    expect(() => registry.installFiles(files('第二版'))).toThrow('已存在')

    registry.installFiles(files('第二版'), { onConflict: 'overwrite' })
    expect(readFileSync(registry.read('dup-skill').filePath, 'utf8')).toContain('第二版')

    const saved = registry.installFiles(files('第三版'), { onConflict: 'save-as' })
    expect(saved.name).toBe('dup-skill-2')
    expect(readFileSync(saved.filePath, 'utf8')).toContain('name: dup-skill-2')
    expect(registry.list().map((item) => item.name)).toEqual(['dup-skill', 'dup-skill-2'])
  })

  it('从 ZIP 导入并剥掉顶层目录', () => {
    const registry = setup()
    const zipDir = mkdtempSync(join(tmpdir(), 'fastagent-zip-'))
    roots.push(zipDir)
    const encoder = new TextEncoder()
    const archive = zipSync({
      'zipped-skill/SKILL.md': encoder.encode('---\nname: zipped-skill\ndescription: 压缩包导入。\n---\n\n正文'),
      'zipped-skill/docs/usage.md': encoder.encode('用法')
    })
    const zipPath = join(zipDir, 'skill.zip')
    writeFileSync(zipPath, archive)

    const record = registry.importFromPath(zipPath)
    expect(record.name).toBe('zipped-skill')
    expect(record.enabled).toBe(false)
    expect(readFileSync(join(record.filePath, '..', 'docs', 'usage.md'), 'utf8')).toBe('用法')
  })
})
