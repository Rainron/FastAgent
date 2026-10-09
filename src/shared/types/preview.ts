/** 页面预览：模型生成的 HTML 样稿或本机 dev server，在右侧面板渲染、也可交给系统浏览器。 */

/** 右侧面板要打开的预览目标。 */
export interface PreviewTarget {
  /** 可直接载入 iframe 的地址：工作区文件是 fa-preview://，dev server 是 http(s)://localhost。 */
  url: string
  title: string
  /** 工作区内文件的相对路径（用于源码视图与改动后自动刷新）；dev server 为 null。 */
  path: string | null
}

/** preview_show 一次离屏检查的结论，落进工具结果供对话卡片展示。 */
export interface PreviewToolDetails {
  target: PreviewTarget
  /** 加载结论：ok 正常、timeout 超时（仍可能有截图）、failed 页面没加载起来。 */
  status: 'ok' | 'timeout' | 'failed'
  /** 主文档的 HTTP 状态；工作区文件恒为 200，拿不到时为 null。 */
  httpStatus: number | null
  errorCount: number
  warningCount: number
  failedRequestCount: number
  /** 截图落在应用数据目录的绝对路径；截图失败时为 null。 */
  screenshotPath: string | null
}

/** 工具执行完主进程广播给界面：设置允许时自动在右栏打开。 */
export interface PreviewReadyEvent {
  conversationId: string
  toolCallId: string
  target: PreviewTarget
}

/** 右栏打开 dev server 前的连通性探测。 */
export interface PreviewProbeResult {
  ok: boolean
  error?: string
}
