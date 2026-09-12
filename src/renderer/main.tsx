import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import { QuickChat } from './quick/QuickChat'
import { RootErrorBoundary, showFatalError } from './root-error'
import './styles.css'

// 快速对话小窗与主窗口共用入口：App 只在主窗口渲染时才拉取对应 chunk，
// 小窗定位是秒开，不能背着主窗口全量代码（设置页 / ai-response / shiki 链路）启动。
const App = lazy(() => import('./App'))

const container = document.getElementById('root')

// 渲染阶段抛错时 React 会卸载整棵树，页面只剩空白；这里把原因显式画出来。
window.addEventListener('error', (event) => showFatalError(event.error ?? event.message))
window.addEventListener('unhandledrejection', (event) => showFatalError(event.reason))

// 主回答区在滚动容器内、输入框在容器外，两者要对齐就得知道滚动条占了多宽。
// 必须赶在首帧之前量：放进 effect 里量的话第一帧的正文列宽是错的，量完会整体横向跳一下。
{
  const probe = document.createElement('div')
  probe.style.cssText = 'position:absolute;top:-9999px;width:100px;height:100px;overflow-y:scroll'
  document.body.appendChild(probe)
  document.documentElement.style.setProperty('--scrollbar-size', `${probe.offsetWidth - probe.clientWidth}px`)
  probe.remove()
}

// 快速对话小窗与主窗口共用同一个入口 HTML，用查询参数分流到轻量界面
const isQuickWindow = new URLSearchParams(window.location.search).get('window') === 'quick'

if (container) {
  const enter = () => {
    if (!container.classList.contains('app-enter-pending')) return
    container.classList.remove('app-enter-pending')
    container.classList.add('app-enter')
  }
  // 小窗是「问完就走」，没有启动页也没有 reveal 消息，透明等待对它没有任何意义。
  if (isQuickWindow) container.classList.remove('app-enter-pending')
  else {
    // 淡入的触发权在主进程手里；消息丢了也不能让界面永久透明，留一道兜底。
    window.fastAgent?.startup.onReveal(enter)
    window.setTimeout(enter, 3000)
  }
}

try {
  if (!container) throw new Error('缺少 #root 挂载节点')
  ReactDOM.createRoot(container).render(
    <React.StrictMode>
      <RootErrorBoundary>
        {isQuickWindow
          ? <QuickChat />
          : (
            <Suspense fallback={null}>
              <App />
            </Suspense>
            )}
      </RootErrorBoundary>
    </React.StrictMode>
  )
} catch (error) {
  showFatalError(error)
}
