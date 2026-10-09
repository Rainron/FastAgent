import { useEffect, useState } from 'react'
import { Bot, Code2, Info, Wrench } from 'lucide-react'
import type { AppRuntimeInfo } from '../../shared/types'

const INTRODUCTION = 'FastAgent Desktop 是面向开发者和需要本地自动化能力的知识工作者的 AI 工作区。你可以在一个桌面应用中进行普通对话，也可以把项目目录交给 Agent，让它读取和修改文件、执行命令、调用 MCP、使用 Skill、分派 Sub-agent，并在授权后控制桌面应用。'

export function AboutSettings({ onNotice }: { onNotice: (notice: string) => void }) {
  const [info, setInfo] = useState<AppRuntimeInfo | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    void window.fastAgent.app.info()
      .then((value) => { if (active) setInfo(value) })
      .catch(() => {
        if (!active) return
        setFailed(true)
        onNotice('应用版本加载失败')
      })
    return () => { active = false }
  }, [onNotice])

  return <section className="settings-panel about-panel" aria-labelledby="settings-about">
    <div className="about-hero">
      <div className="about-mark" aria-hidden="true">FA</div>
      <div>
        <span className="about-eyebrow">AI WORKSPACE</span>
        <h2 id="settings-about">FastAgent</h2>
        <p>{INTRODUCTION}</p>
      </div>
    </div>
    <dl className="about-meta">
      <div><dt><Info size={14} />版本</dt><dd>{info ? `v${info.version}` : failed ? '暂时无法获取' : '加载中…'}</dd></div>
      <div><dt><Bot size={14} />作者</dt><dd>lake</dd></div>
    </dl>
    <div className="about-capabilities" aria-label="主要能力">
      <span><Bot size={13} />智能对话与任务执行</span>
      <span><Code2 size={13} />项目代码与本地自动化</span>
      <span><Wrench size={13} />MCP、Skill 与 Sub-agent</span>
    </div>
  </section>
}
