/**
 * dsh 插件生态用到的 npm semver 子集：`||`、`^`、`~`、比较符、x-range、连字符区间与预发布版本。
 *
 * 不引 semver 依赖（与 plugins/semver.ts 同一取舍），但 dsh 全是 0.x 预发布版，
 * 旧的「主版本一致 + 不低于下限」判法会把 `^0.1.7` 当成接受 0.1.5，`a || b` 更是整段解析失败，
 * 所以这里按 npm 的规则实现，只覆盖 package.json 里实际会出现的写法。
 */

interface Version {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

export function parseVersion(value: string): Version | null {
  const match = VERSION_PATTERN.exec(value.trim())
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] ? match[4].split('.') : [] }
}

function compareIdentifiers(a: string, b: string): number {
  const numericA = /^\d+$/.test(a)
  const numericB = /^\d+$/.test(b)
  if (numericA && numericB) return Math.sign(Number(a) - Number(b))
  // 数字标识符永远低于字母标识符（semver §11）
  if (numericA) return -1
  if (numericB) return 1
  return a === b ? 0 : a < b ? -1 : 1
}

export function compareVersion(a: Version, b: Version): number {
  const core = Math.sign(a.major - b.major) || Math.sign(a.minor - b.minor) || Math.sign(a.patch - b.patch)
  if (core) return core
  if (!a.prerelease.length || !b.prerelease.length) return Math.sign(b.prerelease.length - a.prerelease.length)
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    if (a.prerelease[index] === undefined) return -1
    if (b.prerelease[index] === undefined) return 1
    const diff = compareIdentifiers(a.prerelease[index], b.prerelease[index])
    if (diff) return diff
  }
  return 0
}

type Operator = '>=' | '>' | '<=' | '<' | '='
interface Comparator { operator: Operator; version: Version }

/** 1、1.2、1.x、1.2.* 这类不完整版本：缺的段记为 null。 */
function parsePartial(value: string): { major: number | null; minor: number | null; patch: number | null; prerelease: string[] } | null {
  const match = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim())
  if (!match) return null
  const part = (raw: string | undefined) => raw === undefined || /^[xX*]$/.test(raw) ? null : Number(raw)
  const major = part(match[1])
  const minor = major === null ? null : part(match[2])
  const patch = minor === null ? null : part(match[3])
  return { major, minor, patch, prerelease: patch !== null && match[4] ? match[4].split('.') : [] }
}

const version = (major: number, minor: number, patch: number, prerelease: string[] = []): Version => ({ major, minor, patch, prerelease })

/** 把一个带前缀的写法展开成最多两个基本比较符；无法解析时返回 null。 */
function desugar(token: string): Comparator[] | null {
  const match = /^(\^|~>?|>=|<=|>|<|=)?\s*(.+)$/.exec(token)
  if (!match) return null
  const prefix = match[1] ?? ''
  const partial = parsePartial(match[2])
  if (!partial) return null
  const { major, minor, patch, prerelease } = partial
  if (major === null) return prefix === '<' || prefix === '>' ? [{ operator: '<', version: version(0, 0, 0, ['0']) }] : []
  const low = version(major, minor ?? 0, patch ?? 0, prerelease)

  if (prefix === '^') {
    const high = major > 0 || minor === null ? version(major + 1, 0, 0)
      : minor > 0 || patch === null ? version(0, minor + 1, 0)
        : version(0, 0, patch + 1)
    return [{ operator: '>=', version: low }, { operator: '<', version: high }]
  }
  if (prefix.startsWith('~')) {
    const high = minor === null ? version(major + 1, 0, 0) : version(major, minor + 1, 0)
    return [{ operator: '>=', version: low }, { operator: '<', version: high }]
  }
  // 不完整版本配比较符：>1.2 等于 >=1.3.0，<=1.2 等于 <1.3.0
  const nextUp = minor === null ? version(major + 1, 0, 0) : patch === null ? version(major, minor + 1, 0) : null
  if (prefix === '' || prefix === '=') {
    return nextUp ? [{ operator: '>=', version: low }, { operator: '<', version: nextUp }] : [{ operator: '=', version: low }]
  }
  if (prefix === '>' && nextUp) return [{ operator: '>=', version: nextUp }]
  if (prefix === '<=' && nextUp) return [{ operator: '<', version: nextUp }]
  return [{ operator: prefix as Operator, version: low }]
}

function parseComparatorSet(set: string): Comparator[] | null {
  const trimmed = set.trim()
  const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(trimmed)
  if (hyphen) {
    const from = desugar(`>=${hyphen[1]}`)
    const to = desugar(`<=${hyphen[2]}`)
    return from && to ? [...from, ...to] : null
  }
  // `>= 1.2.3` 这种比较符与版本之间带空格的写法先并拢
  const tokens = trimmed.replace(/(\^|~>?|>=|<=|>|<|=)\s+/g, '$1').split(/\s+/).filter(Boolean)
  const comparators: Comparator[] = []
  for (const token of tokens) {
    const parsed = desugar(token)
    if (!parsed) return null
    comparators.push(...parsed)
  }
  return comparators
}

function test(comparator: Comparator, target: Version): boolean {
  const diff = compareVersion(target, comparator.version)
  switch (comparator.operator) {
    case '>=': return diff >= 0
    case '>': return diff > 0
    case '<=': return diff <= 0
    case '<': return diff < 0
    default: return diff === 0
  }
}

function satisfiesSet(comparators: Comparator[], target: Version, includePrerelease: boolean): boolean {
  if (!comparators.every((comparator) => test(comparator, target))) return false
  if (!target.prerelease.length || includePrerelease) return true
  // 预发布版只在区间里某个比较符点名了同一 [major, minor, patch] 的预发布时才算满足（npm 规则），
  // 否则 ^1.0.0 会意外接受 2.0.0-alpha 之类还不稳定的版本
  return comparators.some(({ version: bound }) => bound.prerelease.length > 0
    && bound.major === target.major && bound.minor === target.minor && bound.patch === target.patch)
}

/**
 * 区间写法无法解析时返回 null，调用方据此区分「不满足」和「看不懂」。
 * includePrerelease 对应 npm 的同名选项：挑版本时不该挑中预发布版，但判断「宿主已有的这个预发布版
 * 在不在区间里」时只该看大小——dsh 运行时本身全是 rc，按挑版本的规则会把 0.1.5-rc.2 判成不满足 ^0.1.0-rc.8。
 */
export function satisfiesRange(range: string, value: string, options: { includePrerelease?: boolean } = {}): boolean | null {
  const target = parseVersion(value)
  if (!target) return null
  let understood = false
  for (const set of range.split('||')) {
    const comparators = parseComparatorSet(set)
    if (!comparators) continue
    understood = true
    if (satisfiesSet(comparators, target, options.includePrerelease ?? false)) return true
  }
  return understood ? false : null
}
