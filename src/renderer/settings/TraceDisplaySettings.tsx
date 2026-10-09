import { MAX_TRACE_EXCERPT_LINES, MIN_TRACE_EXCERPT_LINES, normalizeTraceDisplay } from '../../shared/trace-display'
import type { AppSettings, TraceDisplaySettings as TraceSettings, TraceLabelStyle, TraceTimerPlacement } from '../../shared/types'

/** 执行轨迹的展示偏好：只影响对话区怎么画轨迹，不改变 Agent 的执行与记录。 */
export function TraceDisplaySettings({ settings, onChange }: {
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
}) {
  const trace = normalizeTraceDisplay(settings.traceDisplay)

  function patch(next: Partial<TraceSettings>) {
    onChange({ traceDisplay: normalizeTraceDisplay({ ...trace, ...next }) })
  }

  return <section className="settings-panel" aria-labelledby="settings-trace-display">
    <div className="settings-section-heading"><div><h2 id="settings-trace-display">执行轨迹</h2><p>Agent 回合里动作摘要、用时与工具详情的展示方式。</p></div></div>
    <div className="settings-row">
      <div><strong>用时与 token 位置</strong><span>默认放在轨迹底部一行（用时 · token · 当前动作）。选顶部则回到状态行形态，两处都要会重复显示用时。</span></div>
      <select value={trace.timerPlacement} onChange={(event) => patch({ timerPlacement: event.target.value as TraceTimerPlacement })} aria-label="用时与 token 位置">
        <option value="bottom">底部一行</option>
        <option value="top">顶部状态行</option>
        <option value="both">顶部与底部都显示</option>
      </select>
    </div>
    <div className="settings-row">
      <div><strong>文案风格</strong><span>动作摘要与工具行的措辞。自然语句更好读，紧凑计数式信息密度更高。</span></div>
      <select value={trace.labelStyle} onChange={(event) => patch({ labelStyle: event.target.value as TraceLabelStyle })} aria-label="文案风格">
        <option value="zh">中文自然语句（读取 2 个文件，运行 3 条命令）</option>
        <option value="en">英文自然语句（Read 2 files, ran 3 commands）</option>
        <option value="compact">紧凑计数式（Read ×2 · Command ×3）</option>
      </select>
    </div>
    <div className="settings-row">
      <div><strong>显示 token 用量</strong><span>在用时旁边给出本回合累计的输入输出 token。</span></div>
      <label className="switch-row">
        <input type="checkbox" checked={trace.showTokens} onChange={(event) => patch({ showTokens: event.target.checked })} aria-label="显示 token 用量" />
        <span className="switch-visual" />
      </label>
    </div>
    <div className="settings-row">
      <div><strong>显示增删行数</strong><span>动作摘要与工具行带上 +N -N。统计来自实际写盘的改动，没改文件的调用不显示。</span></div>
      <label className="switch-row">
        <input type="checkbox" checked={trace.showDiffStats} onChange={(event) => patch({ showDiffStats: event.target.checked })} aria-label="显示增删行数" />
        <span className="switch-visual" />
      </label>
    </div>
    <div className="settings-row">
      <div><strong>入参直接平铺</strong><span>展开工具卡即列出入参。关闭后回到二级折叠，要多点一次「入参 N 项」。</span></div>
      <label className="switch-row">
        <input type="checkbox" checked={trace.flatToolArgs} onChange={(event) => patch({ flatToolArgs: event.target.checked })} aria-label="入参直接平铺" />
        <span className="switch-visual" />
      </label>
    </div>
    <div className="settings-row">
      <div><strong>读图片时内联缩略图</strong><span>展开读取图片的工具卡时直接出图，点击看大图。</span></div>
      <label className="switch-row">
        <input type="checkbox" checked={trace.inlineImagePreview} onChange={(event) => patch({ inlineImagePreview: event.target.checked })} aria-label="读图片时内联缩略图" />
        <span className="switch-visual" />
      </label>
    </div>
    <div className="settings-row">
      <div><strong>读文件时显示内容节选</strong><span>展开读取文本文件的工具卡时给出开头若干行，而不是只有一条路径。</span></div>
      <label className="switch-row">
        <input type="checkbox" checked={trace.textExcerpt} onChange={(event) => patch({ textExcerpt: event.target.checked })} aria-label="读文件时显示内容节选" />
        <span className="switch-visual" />
      </label>
    </div>
    <div className="settings-row">
      <div><strong>节选行数</strong><span>默认 20 行，最少 {MIN_TRACE_EXCERPT_LINES} 行、最多 {MAX_TRACE_EXCERPT_LINES} 行。超出部分在末尾说明还剩多少。</span></div>
      <input className="settings-number-input" type="number" min={MIN_TRACE_EXCERPT_LINES} max={MAX_TRACE_EXCERPT_LINES} step={1} value={trace.textExcerptLines} disabled={!trace.textExcerpt} onChange={(event) => patch({ textExcerptLines: event.target.valueAsNumber })} aria-label="节选行数" />
    </div>
    <div className="settings-row">
      <div><strong>轨迹里的文件可点开</strong><span>在读取预览上给一个「打开」入口，点了在右侧资源面板预览该文件。默认关闭，避免顶掉正在看的内容。</span></div>
      <label className="switch-row">
        <input type="checkbox" checked={trace.openFileFromTrace} onChange={(event) => patch({ openFileFromTrace: event.target.checked })} aria-label="轨迹里的文件可点开" />
        <span className="switch-visual" />
      </label>
    </div>
  </section>
}
