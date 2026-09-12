/** 面板展示用的字节数：<1KB 显示 B，否则 K/M/G 保留一位小数。主进程与渲染层共用。 */
export function humanizeFileSize(bytes: number | undefined): string {
  if (bytes === undefined || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(1)} ${units[unit]}`
}
