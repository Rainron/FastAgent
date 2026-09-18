import { useEffect, useMemo, useRef, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AppSettings, AppTheme, AuthSnapshot } from '../shared/types'
import { BootScreen, LoginScreen } from './auth/LoginScreen'
import { WorkspaceShell } from './workspace/WorkspaceShell'
import { shouldShowLoginScreen } from './startup-access'

function App() {
  // react-query 只有主窗口的功能在用，provider 随 App chunk 加载，快速小窗入口不背这个包
  const queryClient = useMemo(() => new QueryClient(), [])
  // 初始按 restoring 起步：首帧还没拿到 snapshot，此时画登录界面就会在恢复成功后闪一下再跳走。
  const [auth, setAuth] = useState<AuthSnapshot>({ state: 'restoring', user: null, backendUrl: null })
  // 起步值取主进程在建窗时定下的那个：写死 'system' 的话，设置为显式深色而系统是浅色时，
  // 下面那个 effect 会把 preload 写好的 data-theme 覆盖回浅色，等设置到位再翻回来，闪一下。
  const [theme, setTheme] = useState<AppTheme>(window.fastAgent.initialTheme)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [modelCount, setModelCount] = useState(0)
  const [firstModelId, setFirstModelId] = useState<number | null>(null)
  const [accessLoaded, setAccessLoaded] = useState(false)
  const workspaceEntryRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    void window.fastAgent.auth.snapshot().then(setAuth).catch(() => undefined)
    const unsubscribe = window.fastAgent.onAuthState(setAuth)
    void Promise.all([
      window.fastAgent.modelConnections.list().then((connections) => connections.flatMap((connection) => connection.models.map((model) => model.id))).catch(() => []),
      window.fastAgent.models.localList().then((models) => models.map((model) => model.id)).catch(() => [])
    ]).then(([connectionModelIds, localModelIds]) => {
      if (!cancelled) {
        const modelIds = [...connectionModelIds, ...localModelIds]
        setModelCount(modelIds.length)
        setFirstModelId(modelIds[0] ?? null)
        setAccessLoaded(true)
      }
    })
    return () => { cancelled = true; unsubscribe() }
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

  useEffect(() => {
    const root = document.documentElement
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => {
      const preference = settings?.motionPreference ?? 'system'
      root.dataset.motion = preference
      root.dataset.reducedMotion = query.matches ? 'true' : 'false'
    }
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [settings?.motionPreference])

  // 登录界面没有首屏数据要等，画出来就算就绪；不报的话主窗口要一直等到 2.5 秒上限。
  useEffect(() => {
    if (!accessLoaded || auth.state === 'restoring' || auth.state === 'ready' || modelCount === 0 || workspaceEntryRef.current) return
    workspaceEntryRef.current = true
    void window.fastAgent.auth.enterWorkspace(firstModelId ?? undefined).catch(() => { workspaceEntryRef.current = false })
  }, [accessLoaded, auth.state, firstModelId, modelCount])

  useEffect(() => {
    if (!accessLoaded || auth.state === 'restoring' || auth.state === 'ready') return
    // 双 rAF：等这一帧真的绘制完再报，否则主窗口显示出来的仍是上一帧。
    let inner = 0
    const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(() => { void window.fastAgent.startup.ready() }) })
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner) }
  }, [accessLoaded, auth.state])

  if (auth.state === 'restoring' || !accessLoaded) return <BootScreen />
  if (shouldShowLoginScreen(auth.state, modelCount)) return <LoginScreen />
  // 有模型但账号尚未进入工作区时，先等待主进程完成工作区初始化，避免子组件抢先调用 requireNamespace。
  if (auth.state !== 'ready') return <BootScreen />
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
