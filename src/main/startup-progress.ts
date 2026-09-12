/**
 * 启动进度的判定逻辑：阶段文案、信息密度分档、主窗口显示时机。
 *
 * 全部做成纯函数 / 可注入定时器，是因为这些规则一旦错了只会表现为「启动偶尔卡一下」，
 * 靠手动重启很难复现，必须能在测试里把时间线摆出来验。
 */
import type { SplashUpdate, SplashVerbosity, StartupPhase } from '../shared/types'

/**
 * 阶段文案只允许对应真实发生的初始化工作。
 * 特别地不设「正在初始化 Agent」：pi runtime 由 createLazyModuleLoader 懒加载，
 * 启动期根本不跑，写上去就是编给用户看的假状态。
 */
export const STARTUP_PHASE_LABELS: Record<StartupPhase, string> = {
  config: '正在加载配置',
  abilities: '正在准备能力',
  interface: '正在准备界面',
  workspace: '正在恢复工作区',
  ready: 'Ready'
}

/** 低于这个耗时说明启动够快，露出阶段文字只会变成一闪而过的噪声。 */
export const SPLASH_STATUS_DELAY_MS = 1200

/** 超过这个耗时要让用户看出程序在干活而不是假死。 */
export const SPLASH_SLOW_DELAY_MS = 5000

export function splashVerbosity(elapsedMs: number): SplashVerbosity {
  if (elapsedMs >= SPLASH_SLOW_DELAY_MS) return 'slow'
  if (elapsedMs >= SPLASH_STATUS_DELAY_MS) return 'status'
  return 'minimal'
}

export function splashUpdate(phase: StartupPhase, elapsedMs: number): SplashUpdate {
  return { phase, label: STARTUP_PHASE_LABELS[phase], verbosity: splashVerbosity(elapsedMs) }
}

export type RevealReason = 'ready' | 'cap' | 'fallback'

export interface RevealCoordinatorOptions {
  /** 首帧出现后最多再等多久首屏数据；到点就先显示，宁可让列表后填也不让用户干等。 */
  capMs: number
  onReveal: (reason: RevealReason) => void
  setTimer?: (handler: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export interface RevealCoordinator {
  /** 窗口 ready-to-show：渲染进程已经有首帧，从此刻起算 cap。 */
  markWindowReady(): void
  /** 渲染进程报告首屏数据就绪。 */
  markRendererReady(): void
  /** 兜底通道：加载失败、超时等异常路径直接放行。 */
  forceReveal(reason: RevealReason): void
  dispose(): void
}

/**
 * 显示时机的三条来源（首屏就绪 / cap 到点 / 异常兜底）收口到一处，
 * 保证 onReveal 只会发生一次——重复 show() 会把已经收进托盘的窗口重新弹出来。
 */
export function createRevealCoordinator(options: RevealCoordinatorOptions): RevealCoordinator {
  const setTimer = options.setTimer ?? ((handler, ms) => setTimeout(handler, ms))
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))

  let revealed = false
  let windowReady = false
  let rendererReady = false
  let capHandle: unknown = null

  const clearCap = () => {
    if (capHandle === null) return
    clearTimer(capHandle)
    capHandle = null
  }

  const reveal = (reason: RevealReason) => {
    if (revealed) return
    revealed = true
    clearCap()
    options.onReveal(reason)
  }

  return {
    markWindowReady() {
      if (revealed || windowReady) return
      windowReady = true
      // 首屏数据可能比首帧更早备齐（例如登录页），此时无需再等 cap。
      if (rendererReady) {
        reveal('ready')
        return
      }
      capHandle = setTimer(() => { capHandle = null; reveal('cap') }, options.capMs)
    },
    markRendererReady() {
      if (revealed || rendererReady) return
      rendererReady = true
      // 没有首帧就 show() 只会得到一块空白窗口，必须等 ready-to-show。
      if (windowReady) reveal('ready')
    },
    forceReveal(reason: RevealReason) {
      reveal(reason)
    },
    dispose() {
      clearCap()
    }
  }
}
