import { Brain, FileCode2, LibraryBig } from 'lucide-react'
import type { SettingsCategory } from './settings-navigation'

/**
 * 三类上下文来源的分工说明，记忆页与知识库页共用。
 * 三者都会进 prompt，用户最常见的困惑是「这条该放哪」，所以按「何时生效 + 放什么」对比着讲。
 */
export function ContextSourcesGuide({ active, onNavigate, onNotice }: {
  active: 'memory' | 'knowledge'
  onNavigate: (category: SettingsCategory) => void
  onNotice: (notice: string) => void
}) {
  // 规则文件在项目根目录，这里只负责打开；没有就指给 /init，不在设置页里另造一个编辑器
  async function openRules() {
    try {
      for (const name of ['AGENTS.md', 'CLAUDE.md']) {
        if (!await window.fastAgent.workspace.exists(name)) continue
        const error = await window.fastAgent.workspace.openExternal(name)
        if (error) onNotice(error)
        return
      }
      onNotice('当前项目还没有 AGENTS.md，可在对话中输入 /init 生成')
    } catch { onNotice('规则文件打开失败') }
  }
  return <div className="context-guide" role="list" aria-label="上下文来源分工">
    <div className="context-guide-card" role="listitem">
      <div className="context-guide-title"><FileCode2 size={14} /><strong>规则文件</strong><span className="settings-badge muted">每轮始终生效</span></div>
      <p>项目根目录的 AGENTS.md / CLAUDE.md。放必须遵守的约定：命令、代码风格、禁止事项。</p>
      <button className="context-guide-link" onClick={() => void openRules()}>打开当前项目的规则文件</button>
    </div>
    <div className={`context-guide-card${active === 'knowledge' ? ' current' : ''}`} role="listitem" aria-current={active === 'knowledge' ? 'page' : undefined}>
      <div className="context-guide-title"><LibraryBig size={14} /><strong>项目知识库</strong><span className="settings-badge muted">与提问相关时注入</span></div>
      <p>按需检索的参考资料：架构说明、接口文档、流程手册。篇幅长、不必每轮都带。</p>
      {active !== 'knowledge' && <button className="context-guide-link" onClick={() => onNavigate('knowledge')}>管理知识库</button>}
    </div>
    <div className={`context-guide-card${active === 'memory' ? ' current' : ''}`} role="listitem" aria-current={active === 'memory' ? 'page' : undefined}>
      <div className="context-guide-title"><Brain size={14} /><strong>记忆</strong><span className="settings-badge muted">与提问相关时注入</span></div>
      <p>对话中沉淀的偏好、事实与决定，一两句话一条，跨会话复用；可自动提取也可手动添加。</p>
      {active !== 'memory' && <button className="context-guide-link" onClick={() => onNavigate('memory')}>管理记忆</button>}
    </div>
  </div>
}
