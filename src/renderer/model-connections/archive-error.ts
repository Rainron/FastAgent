/**
 * 开发时渲染层会热更新、预加载脚本不会：新加的通道在旧 preload 上是 undefined，
 * 直接抛「不是一个函数」看着就像按钮没反应，这里换成能照做的提示。
 */
export function archiveErrorMessage(cause: unknown, fallback: string): string {
  const message = cause instanceof Error ? cause.message : ''
  if (/is not a function/.test(message)) return '当前窗口的预加载脚本还是旧版本，请重启应用后再试'
  return message || fallback
}
