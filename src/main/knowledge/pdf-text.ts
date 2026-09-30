/**
 * PDF 正文抽取。只取可提取文本的 PDF：扫描件没有文本层，抽出来是空的，
 * 这时如实返回 0 页正文，由调用方报「无可提取文本」，不做 OCR。
 *
 * pdfjs 是 ESM 且体量不小，用动态 import 按需加载：没人导入 PDF 时不该为它付启动开销。
 */

export interface PdfPage {
  /** 1 起算。 */
  page: number
  text: string
}

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs')

let modulePromise: Promise<PdfjsModule> | null = null

function loadPdfjs(): Promise<PdfjsModule> {
  modulePromise ??= import('pdfjs-dist/legacy/build/pdf.mjs')
  return modulePromise
}

/** 同一行的文本项之间补空格，跨行补换行；不做这一步，整页会连成一条没有词边界的长串。 */
export function joinTextItems(items: ReadonlyArray<{ str: string; transform?: number[]; hasEOL?: boolean }>): string {
  const lines: string[] = []
  let current = ''
  let lastY: number | null = null
  for (const item of items) {
    const y = item.transform?.[5] ?? null
    if (lastY !== null && y !== null && Math.abs(y - lastY) > 1) {
      lines.push(current)
      current = ''
    }
    current += item.str
    if (item.hasEOL) {
      lines.push(current)
      current = ''
      lastY = null
      continue
    }
    lastY = y
  }
  if (current) lines.push(current)
  return lines.join('\n').replace(/[ \t]+\n/g, '\n').trim()
}

export async function extractPdfPages(data: Uint8Array): Promise<PdfPage[]> {
  const pdfjs = await loadPdfjs()
  // 主进程没有 worker 环境；关掉 worker 走同线程解析，PDF 体量在导入场景下可接受。
  const task = pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: false, disableFontFace: true })
  const document = await task.promise
  try {
    const pages: PdfPage[] = []
    for (let page = 1; page <= document.numPages; page += 1) {
      const loaded = await document.getPage(page)
      const content = await loaded.getTextContent()
      const text = joinTextItems(content.items.filter((item): item is Extract<typeof item, { str: string }> => 'str' in item))
      if (text) pages.push({ page, text })
    }
    return pages
  } finally {
    await document.destroy()
  }
}
