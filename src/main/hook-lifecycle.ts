/**
 * uiohook-napi 只暴露单例，且原生 start/stop 没有重入保护。
 * 连按 Ctrl 钩子与全局鼠标快捷键共用同一线程，这里用引用计数管理：
 * 第一个使用者负责 start，最后一个释放者负责 stop，避免一方关闭拖死另一方。
 */

type UiohookInstance = (typeof import('uiohook-napi'))['uIOhook']

let refCount = 0
let instancePromise: Promise<UiohookInstance> | null = null

export async function acquireUiohook(): Promise<UiohookInstance> {
  refCount++
  if (!instancePromise) {
    instancePromise = (async () => {
      const { uIOhook } = await import('uiohook-napi')
      uIOhook.start()
      return uIOhook as UiohookInstance
    })().catch((error) => {
      // 启动失败要清掉挂起状态，否则后续 acquire 拿到的永远是同一个失败结果
      instancePromise = null
      refCount = 0
      throw error
    })
  }
  return instancePromise
}

export function releaseUiohook(): void {
  refCount = Math.max(0, refCount - 1)
  if (refCount === 0 && instancePromise) {
    const instance = instancePromise
    instancePromise = null
    void instance.then((hook) => { try { hook.stop() } catch { /* 钩子可能已停止，忽略 */ } })
  }
}
