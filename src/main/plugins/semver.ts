/** 极简版本比较：只比较数字主干，预发布标签一律视为低于同主干的正式版。不引第三方依赖。 */
function parseVersion(value: string) {
  const trimmed = value.trim().replace(/^v/i, '')
  const [core, prerelease] = trimmed.split('-', 2)
  const numbers = core.split('.').map((part) => {
    const parsed = Number.parseInt(part, 10)
    return Number.isFinite(parsed) ? parsed : 0
  })
  while (numbers.length < 3) numbers.push(0)
  return { numbers, prerelease: prerelease ?? '' }
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  const length = Math.max(left.numbers.length, right.numbers.length)
  for (let index = 0; index < length; index += 1) {
    const diff = (left.numbers[index] ?? 0) - (right.numbers[index] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  if (left.prerelease === right.prerelease) return 0
  if (!left.prerelease) return 1
  if (!right.prerelease) return -1
  return left.prerelease > right.prerelease ? 1 : -1
}

/** candidate 是否比 current 新；任一缺失都判为「没有更新」，避免误报红点。 */
export function isNewerVersion(candidate: string | undefined, current: string | undefined) {
  if (!candidate || !current) return false
  return compareVersions(candidate, current) > 0
}
