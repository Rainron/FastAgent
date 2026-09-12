import { useEffect, useMemo, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AppSettings, AppTheme, AuthSnapshot } from '../shared/types'
import { BootScreen, LoginScreen } from './auth/LoginScreen'
import { WorkspaceShell } from './workspace/WorkspaceShell'

function App() {
  // react-query 只有主窗口的功能在用，provider 随 App chunk 加载，快速小窗入口不背这个包
  const queryClient = useMemo(() => new QueryClient(), [])
  // 初始按 restoring 起步：首帧还没拿到 snapshot，此时画登录界面就会在恢复成功后闪一下再跳走。
  const [auth, setAuth] = useState<AuthSnapshot>({ state: 'restoring', user: null, backendUrl: null })
  // 起步值取主进程在建窗时定下的那个：写死 'system' 的话，设置为显式深色而系统是浅色时，
  // 下面那个 effect 会把 preload 写好的 data-theme 覆盖回浅色，等设置到位再翻回来，闪一下。
  const [theme, setTheme] = useState<AppTheme>(window.fastAgent.initialTheme)
  const [settings, setSettings] = useState<AppSettings | null>(null)

  useEffect(() => {
    void window.fastAgent.auth.snapshot().then(setAuth).catch(() => undefined)
    return window.fastAgent.onAuthState(setAuth)
  }, [])

  useEffect(() => {
    void window.fastAgent.settings.get().then((next) => { setSettings(next); setTheme(next.theme) }).catch(() => undefined)
    return window.fastAgent.settings.onChange((next) => { setSettings(next); setTheme(next.theme) })
  }, [])

  useEffect(() => {
    const root = document.documentElement
    const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    root.dataset.theme = dark ? 'dark' : 'light'
  }, [theme])

  // 登录界面没有首屏数据要等，画出来就算就绪；不报的话主窗口要一直等到 2.5 秒上限。
  useEffect(() => {
    if (auth.state === 'restoring' || auth.state === 'ready') return
    // 双 rAF：等这一帧真的绘制完再报，否则主窗口显示出来的仍是上一帧。
    let inner = 0
    const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(() => { void window.fastAgent.startup.ready() }) })
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner) }
  }, [auth.state])

  if (auth.state === 'restoring') return <BootScreen />
  if (auth.state !== 'ready') return <LoginScreen />
  return <QueryClientProvider client={queryClient}>
    <WorkspaceShell
    auth={auth}
    theme={theme}
    onThemeChange={(next) => { setTheme(next); void window.fastAgent.settings.update({ theme: next }) }}
    settings={settings}
    onSettingsChange={(patch) => { setSettings((current) => current ? { ...current, ...patch } : current); void window.fastAgent.settings.update(patch) }}
    />
  </QueryClientProvider>
}

export default App
