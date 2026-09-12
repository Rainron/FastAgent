import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, Copy, PlugZap, ServerCog, Star, Trash2 } from 'lucide-react'
import type { AppRuntimeInfo, AuthSnapshot } from '../../shared/types'
import { normalizeServerUrl, removeRecentServer, serverStatusLabel, upsertRecentServer, type ServerStatus } from '../servers'
import { useDismiss } from '../use-dismiss'

export function ConnectionSettings({ auth, onNotice }: { auth: AuthSnapshot; onNotice: (notice: string) => void }) {
  const current = normalizeServerUrl(auth.backendUrl || '')
  const [url, setUrl] = useState(current)
  const [status, setStatus] = useState<ServerStatus>('idle')
  const [testing, setTesting] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [info, setInfo] = useState<AppRuntimeInfo | null>(null)
  const [savedServers, setSavedServers] = useState<string[]>([])
  const [menuOpen, setMenuOpen] = useState(false)
  const [managing, setManaging] = useState(false)
  const serverFieldRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    void window.fastAgent.app.info().then(setInfo).catch(() => onNotice('运行信息加载失败'))
    void window.fastAgent.preferences.get().then((preferences) => setSavedServers(preferences.recentServers)).catch(() => setSavedServers([]))
  }, [onNotice])

  // 关闭要连带退出管理态：菜单收起后再展开不该还停在编辑服务器列表的界面
  const closeServerMenu = useCallback(() => { setMenuOpen(false); setManaging(false) }, [])
  useDismiss(menuOpen, closeServerMenu, serverFieldRef)

  const target = normalizeServerUrl(url)
  const sameAsCurrent = target === current
  const canSwitch = status === 'online' && !sameAsCurrent && !switching
  const alreadySaved = Boolean(target) && savedServers.includes(target)

  async function persistServers(next: string[]) {
    setSavedServers(next)
    await window.fastAgent.preferences.update({ recentServers: next })
  }

  async function testConnection() {
    if (!target) return
    setTesting(true)
    setStatus('checking')
    try {
      await window.fastAgent.auth.captcha(target)
      setStatus('online')
    } catch {
      setStatus('offline')
    } finally {
      setTesting(false)
    }
  }

  async function saveServer() {
    if (!target) return
    try {
      await persistServers(upsertRecentServer(savedServers, target))
      onNotice('地址已保存到常用列表')
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '保存地址失败')
    }
  }

  async function forgetServer(value: string) {
    try {
      await persistServers(removeRecentServer(savedServers, value))
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '移除地址失败')
    }
  }

  async function switchServer() {
    setSwitching(true)
    try {
      // 先把新地址置顶，登录页会用最近服务器的首项预填，省得再输一遍。
      await persistServers(upsertRecentServer(savedServers, target))
      await window.fastAgent.auth.logout()
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '切换后端失败')
      setSwitching(false)
    }
  }

  function copyInfo() {
    if (!info) return
    const text = [
      `版本 ${info.version}`,
      `Electron ${info.electron}`,
      `Node ${info.node}`,
      `Chrome ${info.chrome}`,
      `平台 ${info.platform}`,
      `数据目录 ${info.dataRoot}`,
      `后端 ${info.backendUrl || '未连接'}`
    ].join('\n')
    void navigator.clipboard.writeText(text).then(() => onNotice('运行信息已复制')).catch(() => onNotice('复制失败'))
  }

  return <section className="settings-panel" aria-labelledby="settings-connection">
    <div className="settings-section-heading">
      <div><h2 id="settings-connection">FastAgent 服务器</h2><p>管理 FastAgent 账号的服务器地址。切换服务器后重新登录，共用本机工作区。</p></div>
    </div>

    <div className="settings-row settings-row-column">
      <div className="connection-current">
        <span className="connection-current-icon"><ServerCog size={16} /></span>
        <div>
          <strong>{auth.backendUrl || '未连接'}</strong>
          <span>当前登录：{auth.user?.display_name || auth.user?.username || '未知账户'}</span>
        </div>
      </div>
    </div>

    <div className="settings-row settings-row-column">
      <div className="connection-field-head">
        <label htmlFor="connection-server">新的 Workspace Server</label>
        <span className={`server-status ${status}`}><i />{serverStatusLabel[status]}</span>
      </div>
      <div className="connection-field">
        <div className="server-input" ref={serverFieldRef}>
          <input
            id="connection-server"
            value={url}
            onChange={(event) => { setUrl(event.target.value); setStatus('idle') }}
            type="url"
            spellCheck={false}
            placeholder="https://fastagent.example.com"
            aria-label="新的后端地址"
          />
          <button
            type="button"
            className="server-menu-trigger"
            aria-label="常用服务器"
            aria-expanded={menuOpen}
            onClick={() => { setMenuOpen((open) => !open); setManaging(false) }}
          >
            <ChevronDown size={14} />
          </button>
          {menuOpen && (
            <div className="server-menu">
              <div className="server-menu-label">常用服务器</div>
              {savedServers.length ? savedServers.map((item) => (
                <div className="server-menu-item" key={item}>
                  <button type="button" onClick={() => { setUrl(item); setStatus('idle'); setMenuOpen(false); setManaging(false) }}>{item}</button>
                  {managing && <button type="button" className="server-menu-remove" aria-label={`移除 ${item}`} onClick={() => void forgetServer(item)}><Trash2 size={13} /></button>}
                </div>
              )) : <div className="server-menu-empty">还没有记录</div>}
              <button type="button" className="server-menu-manage" onClick={() => setManaging((value) => !value)}>
                <ServerCog size={13} />{managing ? '完成管理' : '管理服务器'}
              </button>
            </div>
          )}
        </div>
        <button className="quick-secondary" onClick={() => void testConnection()} disabled={!target || testing}>
          <PlugZap size={14} />{testing ? '检测中…' : '测试连接'}
        </button>
        <button className="quick-secondary" onClick={() => void saveServer()} disabled={!target || alreadySaved} title={alreadySaved ? '已在常用列表中' : '保存到常用列表'}>
          <Star size={14} />{alreadySaved ? '已保存' : '保存地址'}
        </button>
      </div>
      <p className="connection-hint">
        {sameAsCurrent
          ? '与当前后端相同，换一个地址才能切换。'
          : status === 'online'
            ? '切换后会退出登录并清除本机保存的模型凭证，重新登录后自动重新下发。'
            : '先测试连接，确认能连上再切换。'}
      </p>
      <button className="primary-button" onClick={() => void switchServer()} disabled={!canSwitch}>
        {switching ? '正在切换…' : '切换并重新登录'}
      </button>
    </div>

    <div className="settings-section-heading">
      <div><h2>运行信息</h2><p>反馈问题时把这段一起贴上。</p></div>
    </div>
    {!info ? <div className="section-list-empty">运行信息加载中</div> : <div className="settings-row settings-row-column">
      <dl className="runtime-info">
        <div><dt>应用版本</dt><dd>{info.version}</dd></div>
        <div><dt>Electron</dt><dd>{info.electron}</dd></div>
        <div><dt>Node</dt><dd>{info.node}</dd></div>
        <div><dt>Chrome</dt><dd>{info.chrome}</dd></div>
        <div><dt>平台</dt><dd>{info.platform}</dd></div>
        <div><dt>数据目录</dt><dd>{info.dataRoot}</dd></div>
        <div><dt>后端地址</dt><dd>{info.backendUrl || '未连接'}</dd></div>
      </dl>
      <button className="quick-secondary" onClick={copyInfo}><Copy size={14} />复制运行信息</button>
    </div>}
  </section>
}
