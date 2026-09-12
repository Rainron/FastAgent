import { ShieldAlert } from 'lucide-react'
import { isUnknownSource, permissionNotices, type CatalogItem } from '../plugin-view'

/** 安装前的来源与权限提示：作者、仓库、需要的环境变量、可能执行的命令。 */
export function PluginPermissionNotice({ plugin }: { plugin: CatalogItem }) {
  const notices = permissionNotices(plugin)
  const unknown = isUnknownSource(plugin)

  return <div className={`plugin-permissions ${unknown ? 'unknown' : ''}`}>
    <div className="plugin-permissions-head"><ShieldAlert size={15} /><strong>来源与权限</strong></div>
    <dl className="ability-meta-list">
      <div><dt>作者</dt><dd>{plugin.author ?? '未标注'}</dd></div>
      <div><dt>版本</dt><dd>{plugin.version}</dd></div>
      <div><dt>主页</dt><dd className="mono">{plugin.homepage ?? '无'}</dd></div>
      <div><dt>Repository</dt><dd className="mono">{plugin.repository ?? '无'}</dd></div>
    </dl>
    {notices.length ? <ul className="plugin-permission-list">
      {notices.map((notice) => <li key={notice}>{notice}</li>)}
    </ul> : <p className="settings-hint">该插件只提供文本指令，不执行本地代码、不访问网络。</p>}
    {unknown && <p className="plugin-unknown-source">未知来源：没有可核对的仓库或主页地址。该插件可能运行本地代码或访问外部服务，安装前请确认你信任它。</p>}
  </div>
}
