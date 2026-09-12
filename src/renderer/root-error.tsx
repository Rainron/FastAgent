import { Component, type ErrorInfo, type ReactNode } from 'react'

function describe(error: unknown) {
  if (error instanceof Error) return `${error.message}\n\n${error.stack ?? ''}`.trim()
  return String(error)
}

/** 界面异常在此之前只进 DevTools，用户遇到的白屏事后完全无从查起；这里补一条磁盘记录。 */
function reportToMain(error: unknown, options: { afterPaint: boolean; componentStack?: string | null }) {
  try {
    window.fastAgent?.diagnostics.reportRendererError({
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack ?? null : null,
      componentStack: options.componentStack ?? null,
      afterPaint: options.afterPaint
    })?.catch(() => undefined)
  } catch {
    // 上报失败不能再抛，否则会盖掉真正的错误。
  }
}

/** 直接操作 DOM：此时 React 树可能已经不可用，不能再依赖组件渲染。 */
export function showFatalError(error: unknown) {
  const container = document.getElementById('root')
  if (!container || container.dataset.fatal === '1') return
  // 界面已经画出来了：此后任何一次无关的 Promise 拒绝都会把整棵树换成错误面板，
  // 表现出来就是「点了重载界面之后白屏」。这类错误交给 RootErrorBoundary 和控制台。
  if (container.firstElementChild) {
    console.error('[renderer] 未捕获的运行时错误', error)
    // 这条分支界面上看不出任何异常，恰恰是最难复现的一类，必须落盘。
    reportToMain(error, { afterPaint: true })
    return
  }
  reportToMain(error, { afterPaint: false })
  container.dataset.fatal = '1'
  container.innerHTML = ''
  const panel = document.createElement('div')
  panel.className = 'fatal-error'
  const title = document.createElement('strong')
  title.textContent = '界面加载失败'
  const hint = document.createElement('span')
  hint.textContent = '可在托盘菜单退出后重新启动；若持续出现请附上下方信息。'
  const detail = document.createElement('pre')
  detail.textContent = describe(error)
  panel.append(title, hint, detail)
  container.append(panel)
}

interface State { error: unknown }

export class RootErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[renderer] 未捕获的渲染错误', error, info.componentStack)
    reportToMain(error, { afterPaint: true, componentStack: info.componentStack })
  }

  render() {
    if (!this.state.error) return this.props.children
    return <div className="fatal-error">
      <strong>界面渲染出错</strong>
      <span>可在托盘菜单退出后重新启动；若持续出现请附上下方信息。</span>
      <pre>{describe(this.state.error)}</pre>
    </div>
  }
}
