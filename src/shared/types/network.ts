export interface NetworkProxySettings { mode: 'auto' | 'manual' | 'direct'; proxyUrl: string }
export type NetworkProxySource = 'environment' | 'system' | 'manual' | 'direct' | 'bypass'
export interface NetworkProxyRoute { source: NetworkProxySource; proxyUrl: string | null }
export interface NetworkProxyState { settings: NetworkProxySettings; routes: Array<NetworkProxyRoute & { target: string; error?: string }> }
export type NetworkFailure = 'dns' | 'tls' | 'timeout' | 'auth' | 'proxy_auth' | 'proxy' | 'upstream'
export interface NetworkProxyTestResult extends NetworkProxyRoute {
  target: string
  elapsedMs: number
  status: number | null
  failure: NetworkFailure | null
}
