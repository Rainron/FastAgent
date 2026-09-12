import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { containsPath, deleteWorkspaceEntry, listWorkspaceDirectory, matchesFuzzy, normalizeWorkspaceRelative, readWorkspaceFile, readWorkspaceImage, resolveWorkspaceDirectory, resolveWorkspaceFile, searchWorkspaceFiles } from './workspace-files'

describe('containsPath', () => {
  it('工作区内的路径判为包含', () => {
    expect(containsPath('K:/app', 'K:/app/src/main.ts')).toBe(true)
    expect(containsPath('K:/app', 'K:/app')).toBe(true)
  })

  it('工作区外的路径判为不包含', () => {
    expect(containsPath('K:/app', 'K:/other/file.ts')).toBe(false)
    expect(containsPath('K:/app', 'K:/app/../secret.ts')).toBe(false)
  })

  it('前缀相同但不是子目录的不算包含', () => {
    expect(containsPath('K:/app', 'K:/app-backup/x.ts')).toBe(false)
  })
})

describe('resolveWorkspaceFile', () => {
  it('未打开工作区时抛错', () => {
    expect(() => resolveWorkspaceFile(null, 'src/main.ts')).toThrow('尚未打开工作区')
  })

  it('拒绝 .. 穿越', () => {
    expect(() => resolveWorkspaceFile('K:/app', '../secret.ts')).toThrow('只能打开工作区内的文件')
    expect(() => resolveWorkspaceFile('K:/app', 'src/../../secret.ts')).toThrow('只能打开工作区内的文件')
  })

  it('拒绝绝对路径与盘符', () => {
    expect(() => resolveWorkspaceFile('K:/app', '/etc/passwd')).toThrow('只能打开工作区内的文件')
    expect(() => resolveWorkspaceFile('K:/app', 'C:\\Windows\\win.ini')).toThrow('只能打开工作区内的文件')
  })

  it('拒绝含 NUL 的路径', () => {
    expect(() => resolveWorkspaceFile('K:/app', 'src/main\0.ts')).toThrow('文件路径无效')
  })

  it('反斜杠与 ./ 前缀归一后仍指向同一个文件', () => {
    const expected = resolveWorkspaceFile('K:/app', 'src/main.ts')
    expect(resolveWorkspaceFile('K:/app', 'src\\main.ts')).toBe(expected)
    expect(resolveWorkspaceFile('K:/app', './src/main.ts')).toBe(expected)
    expect(resolveWorkspaceFile('K:/app', 'src//main.ts')).toBe(expected)
  })
})

describe('resolveWorkspaceDirectory', () => {
  it('空串解析到根目录自身', () => {
    expect(resolveWorkspaceDirectory('K:/app', '')).toBe(resolve('K:/app', ''))
  })

  it('相对路径解析到工作区内绝对路径', () => {
    expect(resolveWorkspaceDirectory('K:/app', 'src')).toBe(resolve('K:/app', 'src'))
  })

  it('拒绝绝对路径与 .. 穿越', () => {
    expect(() => resolveWorkspaceDirectory('K:/app', 'C:\\Windows')).toThrow('只能打开工作区内的文件')
    expect(() => resolveWorkspaceDirectory('K:/app', '../secret')).toThrow('只能打开工作区内的文件')
  })
})

describe('readWorkspaceFile', () => {
  let root = ''
  let outside = ''

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'fastagent-ws-'))
    outside = await mkdtemp(join(tmpdir(), 'fastagent-out-'))
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src', 'main.ts'), 'const a = 1\nconst b = 2\n', 'utf8')
    await writeFile(join(root, 'bin.dat'), Buffer.from([0x00, 0x01, 0x02, 0x03]))
    await writeFile(join(outside, 'secret.txt'), 'secret', 'utf8')
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  it('读取工作区内的文本文件', async () => {
    const file = await readWorkspaceFile(root, 'src/main.ts')
    expect(file.content).toBe('const a = 1\nconst b = 2\n')
    expect(file.lineCount).toBe(3)
    expect(file.truncated).toBe(false)
  })

  it('工作区外的文件读不到', async () => {
    await expect(readWorkspaceFile(root, join('..', '..', 'etc', 'passwd'))).rejects.toThrow('只能打开工作区内的文件')
  })

  it('二进制文件拒绝预览', async () => {
    await expect(readWorkspaceFile(root, 'bin.dat')).rejects.toThrow('不支持预览二进制文件')
  })

  it('目录不是文件', async () => {
    await expect(readWorkspaceFile(root, 'src')).rejects.toThrow('目标不是文件')
  })

  it('文件不存在时给中文提示而不是 ENOENT', async () => {
    await expect(readWorkspaceFile(root, 'main.py')).rejects.toThrow('文件或目录不存在：main.py')
  })

  it('ENOENT 时同名文件在子目录里则自动回退读取', async () => {
    // abc/test.txt 存在但只给了 test.txt——典型「AI 输出省略了子目录前缀」场景。
    await mkdir(join(root, 'abc'), { recursive: true })
    await writeFile(join(root, 'abc', 'test.txt'), 'hi', 'utf8')
    const file = await readWorkspaceFile(root, 'test.txt')
    expect(file.path).toBe('abc/test.txt')
    expect(file.content).toBe('hi')
  })

  it('有多个同名候选时取最浅层的那个', async () => {
    await mkdir(join(root, 'abc', 'deep'), { recursive: true })
    await writeFile(join(root, 'abc', 'deep', 'test.txt'), 'deep', 'utf8')
    const file = await readWorkspaceFile(root, 'test.txt')
    expect(file.path).toBe('abc/test.txt')
    expect(file.content).toBe('hi')
  })

  it('ENOENT 时根目录找不到就不带候选项', async () => {
    await expect(readWorkspaceFile(root, 'totally-missing.txt')).rejects.toThrow(/^文件或目录不存在：totally-missing\.txt/)
  })
})

describe('normalizeWorkspaceRelative', () => {
  it('统一分隔符并去掉空段', () => {
    expect(normalizeWorkspaceRelative('src\\main.ts')).toBe('src/main.ts')
    expect(normalizeWorkspaceRelative('/src//app/')).toBe('src/app')
    expect(normalizeWorkspaceRelative('./src')).toBe('src')
    expect(normalizeWorkspaceRelative('')).toBe('')
  })
})

describe('listWorkspaceDirectory', () => {
  let root = ''

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'fastagent-list-'))
    await mkdir(join(root, 'src'), { recursive: true })
    await mkdir(join(root, 'node_modules'), { recursive: true })
    await writeFile(join(root, 'README.md'), '# hi\n', 'utf8')
    await writeFile(join(root, 'src', 'main.ts'), 'const a = 1\n', 'utf8')
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('空路径列根目录，目录排在文件前面', async () => {
    const listing = await listWorkspaceDirectory(root, '')
    expect(listing.path).toBe('')
    expect(listing.entries.map((entry) => entry.name)).toEqual(['src', 'README.md'])
    expect(listing.entries[0].kind).toBe('dir')
    expect(listing.truncated).toBe(false)
  })

  it('忽略 node_modules 这类噪音目录', async () => {
    const listing = await listWorkspaceDirectory(root, '')
    expect(listing.entries.some((entry) => entry.name === 'node_modules')).toBe(false)
  })

  it('子目录返回可直接用于读取的相对路径，并带大小与类型', async () => {
    const listing = await listWorkspaceDirectory(root, 'src')
    expect(listing.entries).toEqual([{ name: 'main.ts', path: 'src/main.ts', kind: 'file', fileType: 'ts', size: 12 }])
    const file = await readWorkspaceFile(root, listing.entries[0].path)
    expect(file.content).toBe('const a = 1\n')
  })

  it('根目录文件带 size 与 fileType', async () => {
    const listing = await listWorkspaceDirectory(root, '')
    const readme = listing.entries.find((entry) => entry.name === 'README.md')
    expect(readme).toMatchObject({ kind: 'file', fileType: 'md', size: 5 })
    // 目录不带 size / fileType
    const src = listing.entries.find((entry) => entry.name === 'src')
    expect(src).toMatchObject({ kind: 'dir' })
    expect(src?.size).toBeUndefined()
    expect(src?.fileType).toBeUndefined()
  })

  it('拒绝越界目录', async () => {
    await expect(listWorkspaceDirectory(root, '../..')).rejects.toThrow('只能打开工作区内的文件')
  })

  it('目录不存在时返回 missing 而不是抛错', async () => {
    // 展开态是持久化的，外部删目录 / 切分支后必然打到空处；
    // 那不是异常，抛出去只会在主进程刷一屏 Electron 报错。
    await expect(listWorkspaceDirectory(root, 'nope')).resolves.toEqual({ path: 'nope', entries: [], truncated: false, missing: true })
  })

  it('未打开工作区时抛错', async () => {
    await expect(listWorkspaceDirectory(null, '')).rejects.toThrow('尚未打开工作区')
  })
})

describe('matchesFuzzy', () => {
  it('按子序列匹配，大小写不敏感', () => {
    expect(matchesFuzzy('src/App.tsx', 'apptsx')).toBe(true)
    expect(matchesFuzzy('src/App.tsx', 'SRCAPP')).toBe(true)
    expect(matchesFuzzy('src/App.tsx', 'xsta')).toBe(false)
  })

  it('空查询匹配一切', () => {
    expect(matchesFuzzy('any/path.ts', '')).toBe(true)
  })
})

describe('searchWorkspaceFiles', () => {
  let root = ''

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'fastagent-search-'))
    await mkdir(join(root, 'src', 'deep'), { recursive: true })
    await mkdir(join(root, 'node_modules'), { recursive: true })
    await mkdir(join(root, '.git'), { recursive: true })
    await writeFile(join(root, 'App.tsx'), '', 'utf8')
    await writeFile(join(root, 'src', 'App.tsx'), 'x', 'utf8')
    await writeFile(join(root, 'src', 'deep', 'App.tsx'), '', 'utf8')
    await writeFile(join(root, 'node_modules', 'App.tsx'), '', 'utf8')
    await writeFile(join(root, '.git', 'App.tsx'), '', 'utf8')
    await writeFile(join(root, '.env'), '', 'utf8')
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('跳过忽略目录与点开头的条目', async () => {
    const matches = await searchWorkspaceFiles(root, 'App')
    expect(matches.map((match) => match.path)).toEqual(['App.tsx', 'src/App.tsx', 'src/deep/App.tsx'])
  })

  it('返回绝对路径与大小，供附件通道直接使用', async () => {
    // 子序列匹配下 src/deep/App.tsx 也命中，浅层优先所以 src/App.tsx 排第一。
    const matches = await searchWorkspaceFiles(root, 'src/App')
    expect(matches.map((match) => match.path)).toEqual(['src/App.tsx', 'src/deep/App.tsx'])
    expect(matches[0]).toMatchObject({ name: 'App.tsx', path: 'src/App.tsx', size: 1 })
    expect(matches[0].absolutePath.endsWith(`${sep}src${sep}App.tsx`)).toBe(true)
  })

  it('limit 生效', async () => {
    expect(await searchWorkspaceFiles(root, 'App', 2)).toHaveLength(2)
  })

  it('目录也作为候选返回并标记 isDirectory', async () => {
    const matches = await searchWorkspaceFiles(root, 'deep')
    // 浅层优先：目录 src/deep 排在文件 src/deep/App.tsx 之前。
    expect(matches.map((match) => match.path)).toEqual(['src/deep', 'src/deep/App.tsx'])
    expect(matches[0]).toMatchObject({ name: 'deep', isDirectory: true, size: 0 })
    expect(matches[1]?.isDirectory).toBe(false)
  })

  it('未打开工作区时抛错', async () => {
    await expect(searchWorkspaceFiles(null, 'a')).rejects.toThrow('尚未打开工作区')
  })
})

describe('deleteWorkspaceEntry', () => {
  let root = ''

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'fastagent-delete-'))
    await mkdir(join(root, 'src', 'nested'), { recursive: true })
    await writeFile(join(root, 'src', 'a.ts'), 'x', 'utf8')
    await writeFile(join(root, 'src', 'nested', 'b.md'), '', 'utf8')
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('删除单个文件', async () => {
    const result = await deleteWorkspaceEntry(root, 'src/a.ts')
    expect(result.ok).toBe(true)
    await expect(readWorkspaceFile(root, 'src/a.ts')).rejects.toThrow('文件或目录不存在')
  })

  it('递归删除目录', async () => {
    const result = await deleteWorkspaceEntry(root, 'src')
    expect(result.ok).toBe(true)
    await expect(listWorkspaceDirectory(root, 'src')).resolves.toMatchObject({ missing: true, entries: [] })
  })

  it('越界路径拒绝删除', async () => {
    const result = await deleteWorkspaceEntry(root, '../outside')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/只能打开工作区内的文件/)
  })

  it('不存在的目标返回错误', async () => {
    const result = await deleteWorkspaceEntry(root, 'missing.txt')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/文件或目录不存在/)
  })

  it('未打开工作区返回错误', async () => {
    const result = await deleteWorkspaceEntry(null, 'a.ts')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('尚未打开工作区')
  })
})

describe('readWorkspaceImage', () => {
  let root = ''

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'fastagent-image-'))
    // 1x1 透明 PNG
    await writeFile(join(root, 'pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'))
    await writeFile(join(root, 'notes.txt'), 'hello', 'utf8')
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('返回图片的 base64 data URL', async () => {
    const result = await readWorkspaceImage(root, 'pixel.png')
    expect(result.path).toBe('pixel.png')
    expect(result.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('非图片扩展名拒绝', async () => {
    await expect(readWorkspaceImage(root, 'notes.txt')).rejects.toThrow('不是可预览的图片格式')
  })

  it('越界路径拒绝', async () => {
    await expect(readWorkspaceImage(root, '../outside.png')).rejects.toThrow('只能打开工作区内的文件')
  })
})
