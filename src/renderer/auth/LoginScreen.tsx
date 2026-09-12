import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowRight, Check, ChevronDown, CircleAlert, ListChecks, LoaderCircle, LockKeyhole,
  MessagesSquare, RotateCw, ServerCog, Sparkles, Terminal, Trash2, Workflow, Wrench
} from 'lucide-react'
import { captchaAngleFromRatio, normalizeCaptchaAngle } from '../captcha'
import { ModelConnections } from '../model-connections/ModelConnections'
import { normalizeServerUrl, readRecentServers, removeRecentServer, serverStatusLabel, upsertRecentServer, type ServerStatus } from '../servers'

/**
 * 恢复登录态期间的启动屏：只有画布底色，不给任何会被立刻替换掉的内容。
 * 转圈延迟淡入（见 .app-boot-spinner），续期够快时用户一眼都看不到它。
 */
export function BootScreen() {
  return <div className="app-boot" role="status" aria-label="正在恢复登录状态">
    <LoaderCircle size={18} className="app-boot-spinner" />
  </div>
}

export function LoginScreen() {
  const [entry, setEntry] = useState<'models' | 'fastagent'>('models')
  const [backendUrl, setBackendUrl] = useState('http://localhost:10001')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [captchaId, setCaptchaId] = useState('')
  const [captchaAngle, setCaptchaAngle] = useState(0)
  const [captchaImage, setCaptchaImage] = useState<string | null>(null)
  const [captchaSettled, setCaptchaSettled] = useState(false)
  const [serverStatus, setServerStatus] = useState<ServerStatus>('idle')
  const [recentServers, setRecentServers] = useState<string[]>([])
  const [serverMenuOpen, setServerMenuOpen] = useState(false)
  const [serverManaging, setServerManaging] = useState(false)
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const serverFieldRef = useRef<HTMLDivElement | null>(null)
  /** 地址可能连续变化，只承认最后一次探测的结果。 */
  const probeRef = useRef(0)
  const prefilledRef = useRef(false)

  useEffect(() => {
    void window.fastAgent.preferences.get().then((stored) => {
      const legacy = readRecentServers()
      const recentServers = stored.recentServers.length ? stored.recentServers : legacy
      setRecentServers(recentServers)
      // 只在首次加载时预填最近使用的地址（设置页切换后端会把新地址置顶），之后不覆盖用户输入。
      if (!prefilledRef.current && recentServers[0]) {
        prefilledRef.current = true
        setBackendUrl(recentServers[0])
      }
      if (!stored.recentServers.length && legacy.length) void window.fastAgent.preferences.update({ recentServers })
      window.localStorage.removeItem('fastagent.recent-servers')
    }).catch(() => setRecentServers(readRecentServers()))
  }, [])

  const loadCaptcha = useCallback(async (url: string) => {
    const probeId = ++probeRef.current
    setServerStatus('checking')
    try {
      const result = await window.fastAgent.auth.captcha(url)
      if (probeRef.current !== probeId) return
      setCaptchaId(result.captcha_id)
      setCaptchaImage(result.image.startsWith('data:') ? result.image : `data:image/png;base64,${result.image}`)
      setCaptchaAngle(0)
      setCaptchaSettled(false)
      setServerStatus('online')
    } catch {
      if (probeRef.current !== probeId) return
      setCaptchaId('')
      setCaptchaImage(null)
      setCaptchaSettled(false)
      setServerStatus('offline')
    }
  }, [])

  useEffect(() => {
    if (entry !== 'fastagent') return
    const url = normalizeServerUrl(backendUrl)
    if (!url) {
      probeRef.current += 1
      setCaptchaImage(null)
      setCaptchaId('')
      setServerStatus('idle')
      return
    }
    setServerStatus('checking')
    const timer = setTimeout(() => { void loadCaptcha(url) }, 500)
    return () => clearTimeout(timer)
  }, [backendUrl, loadCaptcha, entry])

  useEffect(() => {
    if (!serverMenuOpen) return
    function onPointerDown(event: PointerEvent) {
      if (!serverFieldRef.current?.contains(event.target as Node)) {
        setServerMenuOpen(false)
        setServerManaging(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [serverMenuOpen])

  function forgetServer(url: string) {
    const next = removeRecentServer(recentServers, url)
    setRecentServers(next)
    void window.fastAgent.preferences.update({ recentServers: next })
    if (!next.length) setServerManaging(false)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const url = normalizeServerUrl(backendUrl)
    if (!captchaId) {
      setError(serverStatus === 'offline' ? '无法连接该服务器，请检查地址' : '验证码尚未就绪，请稍候')
      return
    }
    setLoading(true)
    setError('')
    try {
      await window.fastAgent.auth.login({ backendUrl: url, username, password, captchaId, captchaAngle, remember })
      const next = upsertRecentServer(recentServers, url)
      setRecentServers(next)
      void window.fastAgent.preferences.update({ recentServers: next })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登录失败')
      void loadCaptcha(url)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-glow" aria-hidden="true" />
      <section className="auth-card" aria-labelledby="login-title">
        <aside className="auth-brand">
          <div className="auth-logo"><span className="auth-logo-mark"><Sparkles size={15} strokeWidth={2} /></span>FastAgent</div>
          <div className="auth-pitch">
            <h1>你的 AI 桌面工作空间</h1>
            <p>对话、执行与代码协作，都在 FastAgent。</p>
          </div>
          <ul className="auth-features">
            <li>
              <span className="auth-feature-icon"><MessagesSquare size={16} strokeWidth={1.7} /></span>
              <span><strong>AI 对话</strong><small>多模型会话、上下文与历史记录</small></span>
            </li>
            <li>
              <span className="auth-feature-icon"><Workflow size={16} strokeWidth={1.7} /></span>
              <span><strong>Agent</strong><small>执行任务、操作代码与调用工具</small></span>
            </li>
          </ul>
          <div className="auth-flow" aria-hidden="true">
            <span className="flow-chip">Prompt</span>
            <span className="flow-line" />
            <span className="flow-chip brand">Agent</span>
            <span className="flow-line" />
            <div className="flow-leaves">
              <span className="flow-chip soft"><Wrench size={11} strokeWidth={1.8} />Tool</span>
              <span className="flow-chip soft"><Terminal size={11} strokeWidth={1.8} />Code</span>
              <span className="flow-chip soft"><ListChecks size={11} strokeWidth={1.8} />Task</span>
            </div>
          </div>
        </aside>
        <div className="auth-form auth-model-services">
          <div className="auth-entry-tabs" aria-label="工作区登录方式">
            <button type="button" aria-pressed={entry === 'models'} onClick={() => setEntry('models')}>模型服务</button>
            <button type="button" aria-pressed={entry === 'fastagent'} onClick={() => setEntry('fastagent')}>FastAgent 账号</button>
          </div>
          {entry === 'models' ? <><h2 id="login-title">进入工作区</h2><ModelConnections entering /></> : <form onSubmit={submit}>
          <div className="auth-form-head">
            <h2 id="login-title">登录工作空间</h2>
            <p>连接 FastAgent Server 继续你的工作。</p>
          </div>
          <div className="auth-field">
            <div className="auth-field-head">
              <label htmlFor="workspace-server">Workspace Server</label>
              <span className={`server-status ${serverStatus}`}><i />{serverStatusLabel[serverStatus]}</span>
            </div>
            <div className="server-input" ref={serverFieldRef}>
              <input
                id="workspace-server"
                value={backendUrl}
                onChange={(event) => setBackendUrl(event.target.value)}
                type="url"
                required
                spellCheck={false}
                placeholder="http://localhost:10001"
              />
              <button
                type="button"
                className="server-menu-trigger"
                aria-label="最近连接的服务器"
                aria-expanded={serverMenuOpen}
                onClick={() => { setServerMenuOpen((open) => !open); setServerManaging(false) }}
              >
                <ChevronDown size={14} />
              </button>
              {serverMenuOpen && (
                <div className="server-menu">
                  <div className="server-menu-label">最近连接</div>
                  {recentServers.length ? recentServers.map((url) => (
                    <div className="server-menu-item" key={url}>
                      <button type="button" onClick={() => { setBackendUrl(url); setServerMenuOpen(false); setServerManaging(false) }}>{url}</button>
                      {serverManaging && <button type="button" className="server-menu-remove" aria-label={`移除 ${url}`} onClick={() => forgetServer(url)}><Trash2 size={13} /></button>}
                    </div>
                  )) : <div className="server-menu-empty">还没有记录</div>}
                  <button type="button" className="server-menu-manage" onClick={() => setServerManaging((managing) => !managing)}>
                    <ServerCog size={13} />{serverManaging ? '完成管理' : '管理服务器'}
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="auth-field-grid">
            <div className="auth-field">
              <label htmlFor="login-username">用户名</label>
              <input id="login-username" value={username} onChange={(event) => setUsername(event.target.value)} required autoComplete="username" />
            </div>
            <div className="auth-field">
              <label htmlFor="login-password">密码</label>
              <input id="login-password" value={password} onChange={(event) => setPassword(event.target.value)} required type="password" autoComplete="current-password" />
            </div>
          </div>
          {captchaSettled ? (
            <div className="captcha-settled">
              <Check size={14} /><span>已完成拖动验证 · {Math.round(captchaAngle)}°</span>
              <button type="button" onClick={() => setCaptchaSettled(false)}>重新验证</button>
            </div>
          ) : (
            <div className="captcha-box">
              <div className="captcha-thumb">
                {captchaImage
                  ? <img src={captchaImage} alt="旋转验证码" style={{ transform: `rotate(${captchaAngle}deg)` }} />
                  : <span>{serverStatus === 'offline' ? '不可用' : '加载中'}</span>}
              </div>
              <div className="captcha-control">
                <div className="captcha-control-head"><strong>安全验证</strong><output>{Math.round(captchaAngle)}°</output></div>
                <span className="captcha-hint">拖动滑块完成验证</span>
                <CaptchaSlider
                  value={captchaAngle}
                  disabled={!captchaImage}
                  onChange={setCaptchaAngle}
                  onSettle={() => { if (captchaImage) setCaptchaSettled(true) }}
                />
              </div>
              <button type="button" className="captcha-refresh" onClick={() => void loadCaptcha(normalizeServerUrl(backendUrl))} aria-label="刷新验证码" title="换一张验证码"><RotateCw size={13} /></button>
            </div>
          )}
          <div className="auth-remember">
            <label><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />保持登录</label>
            <span>本地安全保存</span>
          </div>
          {error && <p className="auth-error" role="alert"><CircleAlert size={14} />{error}</p>}
          <button className="auth-submit" type="submit" disabled={loading}>
            {loading ? <><LoaderCircle size={16} className="spin" />正在进入工作空间…</> : <>登录工作空间<ArrowRight size={16} /></>}
          </button>
          <p className="auth-note"><LockKeyhole size={12} />凭据经系统加密后仅保存在本机</p>
        </form>}
        </div>
      </section>
    </main>
  )
}

/** 只有这几个键会改角度；其余键（例如 Tab）不能触发「已完成验证」。 */
const CAPTCHA_ADJUST_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'])

/**
 * 原来用的是原生 input[type=range]：触屏下手指落点会先被当成页面滚动手势，滑块跟不上。
 * 这里改成自己接 pointer 事件 + setPointerCapture，鼠标、触屏、手写笔走同一条路径，
 * 轨道整条都可按下，不必精确点中那颗小圆点。
 */
function CaptchaSlider({ value, disabled, onChange, onSettle }: { value: number; disabled: boolean; onChange: (angle: number) => void; onSettle: () => void }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const percent = (value / 359) * 100

  function angleAt(clientX: number) {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return value
    return captchaAngleFromRatio((clientX - rect.left) / rect.width)
  }

  function handleDown(event: React.PointerEvent<HTMLDivElement>) {
    if (disabled) return
    // 不 preventDefault 的话 Chromium 会把这次触摸继续按滚动手势解释，move 事件收不全。
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragging.current = true
    trackRef.current?.focus()
    onChange(angleAt(event.clientX))
  }

  function handleMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return
    onChange(angleAt(event.clientX))
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>, settle: boolean) {
    if (!dragging.current) return
    dragging.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (settle) onSettle()
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (disabled || !CAPTCHA_ADJUST_KEYS.has(event.key)) return
    const step = event.key === 'PageUp' || event.key === 'PageDown' ? 10 : 1
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown' || event.key === 'PageDown') onChange(normalizeCaptchaAngle(value - step))
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'PageUp') onChange(normalizeCaptchaAngle(value + step))
    else if (event.key === 'Home') onChange(0)
    else onChange(359)
    event.preventDefault()
  }

  return <div
    ref={trackRef}
    className={`captcha-slider ${disabled ? 'disabled' : ''}`}
    role="slider"
    tabIndex={disabled ? -1 : 0}
    aria-label="验证码旋转角度"
    aria-valuemin={0}
    aria-valuemax={359}
    aria-valuenow={Math.round(value)}
    aria-valuetext={`${Math.round(value)} 度`}
    aria-disabled={disabled || undefined}
    onPointerDown={handleDown}
    onPointerMove={handleMove}
    onPointerUp={(event) => endDrag(event, true)}
    onPointerCancel={(event) => endDrag(event, false)}
    onKeyDown={handleKeyDown}
    onKeyUp={(event) => { if (!disabled && CAPTCHA_ADJUST_KEYS.has(event.key)) onSettle() }}
  >
    <span className="captcha-slider-rail" />
    <span className="captcha-slider-fill" style={{ width: `${percent}%` }} />
    <span className="captcha-slider-thumb" style={{ left: `${percent}%`, transform: `translate(-${percent}%, -50%)` }} />
  </div>
}
