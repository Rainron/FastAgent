import { memo, useEffect, useState } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'

/** 自绘窗口控制按钮：主窗口关掉了系统 titleBarOverlay，最小化/最大化/关闭全部走 IPC。 */
export const WindowControls = memo(function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void window.fastAgent.window.isMaximized().then(setMaximized).catch(() => undefined)
    return window.fastAgent.window.onMaximizedChange(setMaximized)
  }, [])

  // 最大化时系统不再给窗口圆角，外沿描边也得跟着切成直角，否则四角会露出一截弧线
  useEffect(() => {
    document.documentElement.dataset.maximized = maximized ? 'true' : 'false'
  }, [maximized])

  return <div className="win no-drag">
    <button onClick={() => void window.fastAgent.window.minimize()} aria-label="最小化" title="最小化"><Minus size={15} /></button>
    <button onClick={() => void window.fastAgent.window.toggleMaximize()} aria-label={maximized ? '还原' : '最大化'} title={maximized ? '还原' : '最大化'}>{maximized ? <Copy size={13} /> : <Square size={12} />}</button>
    <button className="close" onClick={() => void window.fastAgent.window.close()} aria-label="关闭" title="关闭"><X size={15} /></button>
  </div>
})
