import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyPatchToContent, applyPatchToWorkspace, parseUnifiedPatch, PatchApplyError } from './patch'

const roots: string[] = []

afterEach(() => {
  while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true })
})

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'fastagent-patch-'))
  roots.push(root)
  return root
}

const SIMPLE_PATCH = [
  '--- a/src/main.ts',
  '+++ b/src/main.ts',
  '@@ -1,3 +1,4 @@',
  ' import { a } from "./a"',
  ' const value = 1',
  '-console.log(value)',
  '+console.log("patched")',
  '+helper(value)'
].join('\n')

describe('patch tool - parse', () => {
  it('解析文件头与 hunk', () => {
    const files = parseUnifiedPatch(SIMPLE_PATCH)
    expect(files).toHaveLength(1)
    expect(files[0].path).toBe('src/main.ts')
    expect(files[0].hunks).toHaveLength(1)
    expect(files[0].hunks[0].oldStart).toBe(1)
    expect(files[0].hunks[0].lines).toHaveLength(5)
  })

  it('识别新建与删除', () => {
    const created = parseUnifiedPatch('--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1,2 @@\n+line1\n+line2')
    expect(created[0].creation).toBe(true)
    const deleted = parseUnifiedPatch('--- a/old.ts\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-line1\n-line2')
    expect(deleted[0].deletion).toBe(true)
  })

  it('忽略标准 Git 删除元数据', () => {
    const deleted = parseUnifiedPatch([
      'diff --git a/old.ts b/old.ts',
      'deleted file mode 100644',
      'index 9a271f2..0000000',
      '--- a/old.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-old'
    ].join('\n'))
    expect(deleted).toMatchObject([{ oldPath: 'old.ts', path: '/dev/null', deletion: true }])
  })
})

describe('patch tool - apply', () => {
  it('严格上下文匹配并生成 +n -m', () => {
    const applied = applyPatchToContent('import { a } from "./a"\nconst value = 1\nconsole.log(value)\n', parseUnifiedPatch(SIMPLE_PATCH)[0])
    expect(applied.content).toBe('import { a } from "./a"\nconst value = 1\nconsole.log("patched")\nhelper(value)\n')
    expect(applied.additions).toBe(2)
    expect(applied.deletions).toBe(1)
  })

  it('上下文不匹配时报错并给出定位，文件不变', () => {
    const root = makeRoot()
    const file = join(root, 'src', 'main.ts')
    mkdirSync(join(root, 'src'), { recursive: true })
    const original = 'import { a } from "./a"\nconst DIFFERENT = 999\nconsole.log(value)\n'
    writeFileSync(file, original)
    expect(() => applyPatchToWorkspace(SIMPLE_PATCH, root)).toThrow(PatchApplyError)
    expect(readFileSync(file, 'utf8')).toBe(original)
  })

  it('多 hunk 按原文件坐标应用', () => {
    const content = 'a\nb\nc\nd\ne\nf\n'
    const patch = parseUnifiedPatch([
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -1,2 +1,2 @@',
      ' a',
      '-b',
      '+B',
      '@@ -5,2 +5,2 @@',
      ' e',
      '-f',
      '+F'
    ].join('\n'))
    const applied = applyPatchToContent(content, patch[0])
    expect(applied.content).toBe('a\nB\nc\nd\ne\nF\n')
    expect(applied.additions).toBe(2)
    expect(applied.deletions).toBe(2)
  })

  it('新建文件', () => {
    const root = makeRoot()
    const patch = '--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1,2 @@\n+line1\n+line2'
    const plans = applyPatchToWorkspace(patch, root)
    expect(plans).toEqual([{ path: join(root, 'new.ts'), additions: 2, deletions: 0 }])
    expect(readFileSync(join(root, 'new.ts'), 'utf8')).toBe('line1\nline2\n')
  })

  it('删除文件', () => {
    const root = makeRoot()
    const file = join(root, 'old.ts')
    writeFileSync(file, 'line1\nline2\n')
    const patch = '--- a/old.ts\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-line1\n-line2'
    applyPatchToWorkspace(patch, root)
    expect(() => readFileSync(file, 'utf8')).toThrow()
  })

  it('删除子目录文件', () => {
    const root = makeRoot()
    const file = join(root, 'src', 'deep', 'old.ts')
    mkdirSync(join(root, 'src', 'deep'), { recursive: true })
    writeFileSync(file, 'old\n')
    const patch = '--- a/src/deep/old.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-old'
    applyPatchToWorkspace(patch, root)
    expect(() => readFileSync(file, 'utf8')).toThrow()
  })

  it.each([
    ['绝对路径', (root: string) => join(root, 'outside.ts')],
    ['盘符路径', () => 'C:\\outside.ts'],
    ['UNC 路径', () => '\\\\server\\share\\outside.ts'],
    ['工作区外路径', () => '../outside.ts']
  ])('拒绝%s删除', (_label, targetOf) => {
    const root = makeRoot()
    const target = targetOf(root)
    const patch = `--- ${target}\n+++ /dev/null\n@@ -1 +0,0 @@\n-old`
    expect(() => applyPatchToWorkspace(patch, root)).toThrow('只能修改工作区内的文件')
  })

  it('多文件：任一失败整体不落盘', () => {
    const root = makeRoot()
    const ok = join(root, 'ok.ts')
    writeFileSync(ok, 'const a = 1\n')
    const bad = join(root, 'bad.ts')
    writeFileSync(bad, 'const b = 2\n')
    const multi = [
      '--- a/ok.ts', '+++ b/ok.ts',
      '@@ -1 +1 @@', ' const a = 1', '+const a2 = 1',
      '--- a/bad.ts', '+++ b/bad.ts',
      '@@ -1 +1 @@', '-const b = 999' // 上下文不匹配
    ].join('\n')
    expect(() => applyPatchToWorkspace(multi, root)).toThrow()
    expect(readFileSync(ok, 'utf8')).toBe('const a = 1\n')
    expect(readFileSync(bad, 'utf8')).toBe('const b = 2\n')
  })

  it('CRLF 文件按行匹配', () => {
    const content = 'a\r\nb\r\nc\r\n'
    const patch = parseUnifiedPatch('--- a/f.txt\n+++ b/f.txt\n@@ -2,2 +2,2 @@\n b\n-c\n+C\n')[0]
    const applied = applyPatchToContent(content, patch)
    expect(applied.content).toBe('a\r\nb\r\nC\n')
  })
})
