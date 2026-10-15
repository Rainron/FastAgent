import type { AppSettings, NetworkFailure, NetworkProxySource } from '../../shared/types'
import { useNetworkSettings } from './hooks/use-network-settings'

const sources: Record<NetworkProxySource, string> = { environment: '环境变量', system: '系统代理', manual: '手动代理', direct: '直连', bypass: '绕过代理' }
const failures: Record<NetworkFailure, string> = { dns: 'DNS 解析失败', tls: 'TLS 证书或握手失败', timeout: '请求超时', auth: '已收到认证或访问限制响应', proxy_auth: '代理认证失败', proxy: '代理连接失败', upstream: '上游服务失败' }

export function NetworkSettings({ settings }: { settings: AppSettings }) {
  const { draft, state, results, error, busy, change, run } = useNetworkSettings(settings.networkProxy)
  return <section className="settings-panel network-settings" aria-labelledby="settings-network">
    <div className="settings-section-heading"><div><h2 id="settings-network">网络代理</h2><p>用于模型请求和账号授权。自动模式优先使用环境变量，再按目标地址读取系统代理。</p></div></div>
    <div className="reasoning-segmented settings-segmented" role="group" aria-label="代理模式">{(['auto', 'manual', 'direct'] as const).map((mode) => <button key={mode} disabled={busy === 'save'} aria-pressed={draft.mode === mode} className={draft.mode === mode ? 'active' : ''} onClick={() => change({ ...draft, mode })}>{{ auto: '自动', manual: '手动', direct: '直连' }[mode]}</button>)}</div>
    {draft.mode === 'manual' && <label className="network-proxy-input">HTTP / HTTPS 代理地址<input aria-label="代理地址" value={draft.proxyUrl} disabled={busy === 'save'} placeholder="http://127.0.0.1:7890" onChange={(event) => change({ ...draft, proxyUrl: event.target.value })} /></label>}
    <p>支持 HTTP / HTTPS 代理；SOCKS 请使用代理软件的 HTTP 端口。暂不支持代理认证。所有模式绕过本地服务；自动模式还遵循 NO_PROXY。</p>
    <div className="network-proxy-actions"><button className="small-control" disabled={!!busy} onClick={() => void run('test')}>{busy === 'test' ? '测试中…' : '测试连接'}</button><button className="primary-button" disabled={!!busy} onClick={() => void run('save')}>{busy === 'save' ? '应用中…' : '保存并应用'}</button></div>
    <p>测试使用当前草稿，分别访问 OpenAI 授权与 API 端点，不携带账号令牌。HTTP 401 / 403 表示已收到服务响应，不能证明账号授权成功。</p>
    {error && <p role="alert" className="auth-error">{error}</p>}
    {state && <div aria-label="已保存代理状态"><h3>已保存配置</h3><p>{{ auto: '自动', manual: '手动', direct: '直连' }[state.settings.mode]}</p>{state.routes.map((route) => <p key={route.target}>{new URL(route.target).hostname} · {sources[route.source]} · {route.error ?? route.proxyUrl ?? '直连'}</p>)}</div>}
    {results && <div aria-live="polite"><h3>连接测试结果</h3>{results.map((result) => <p key={result.target}>{new URL(result.target).hostname} · {sources[result.source]} · {result.proxyUrl ?? '直连'} · {result.elapsedMs} ms · {result.status !== null ? `HTTP ${result.status}` : '未收到响应'} · {result.failure ? failures[result.failure] : '已连通'}</p>)}</div>}
  </section>
}
