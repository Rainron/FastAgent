/**
 * 把用户输入转成 FTS5 查询计划。
 *
 * memories_fts 用 trigram 分词器：命中要求查询词至少 3 个字符，且中文没有词边界，
 * 整句直接 MATCH 几乎不可能命中。这里对中文按 3 字滑窗切分（每个窗口正好是一个 trigram
 * token），英文按词切分；不足 3 字符的词（uv、go）trigram 索引不到，退回 LIKE 兜底。
 */

/** 单个查询计划；两条路径在 SQL 里是 OR 关系。 */
export interface MemoryQueryPlan {
  /** FTS5 MATCH 表达式，无可用词元时为 null。 */
  match: string | null
  /** 需要走 content LIKE '%term%' 的短词。 */
  likeTerms: string[]
}

export interface MemoryQueryOptions {
  /** MATCH 词元上限，防止长输入把查询撑爆。 */
  maxTerms?: number
  maxLikeTerms?: number
}

const CJK = /[㐀-䶿一-鿿぀-ヿ가-힯]/

// 只挡最常见的功能词：停用词表越长越容易误伤专有名词。
const ASCII_STOP_WORDS = new Set([
  'the', 'and', 'for', 'you', 'can', 'how', 'what', 'why', 'this', 'that', 'with', 'use', 'using',
  'should', 'would', 'could', 'please', 'help', 'about', 'from', 'into', 'our', 'your', 'are', 'was',
  // 两字符功能词同样要挡：它们走 LIKE 兜底，比 MATCH 更贵且几乎全是噪声。
  'we', 'or', 'is', 'it', 'in', 'on', 'at', 'to', 'of', 'be', 'do', 'my', 'me', 'an', 'as', 'if', 'so', 'by', 'up'
])

const CJK_STOP_CHARS = new Set(['的', '了', '吗', '吧', '呢', '是', '在', '和', '与', '这', '那', '个', '我', '你', '他', '它', '们', '一', '下', '就', '也', '还', '要', '把', '被', '给', '请', '帮', '看', '说', '啊', '呀', '么', '什', '怎', '样', '有', '没'])

function isStopWindow(window: string): boolean {
  return [...window].every((char) => CJK_STOP_CHARS.has(char))
}

/** 中文按 3 字滑窗：窗口本身就是一个 trigram token，不构成 phrase 查询，detail 设置无关。 */
function cjkWindows(run: string): string[] {
  if (run.length < 3) return []
  const windows: string[] = []
  for (let index = 0; index + 3 <= run.length; index += 1) {
    const window = run.slice(index, index + 3)
    if (!isStopWindow(window)) windows.push(window)
  }
  return windows
}

function quote(term: string): string {
  return `"${term.replace(/"/g, '""')}"`
}

export function buildMemoryQueryPlan(text: string, options: MemoryQueryOptions = {}): MemoryQueryPlan {
  const maxTerms = Math.max(1, options.maxTerms ?? 16)
  const maxLikeTerms = Math.max(0, options.maxLikeTerms ?? 4)
  const normalized = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')
  const matchTerms: string[] = []
  const likeTerms: string[] = []
  const seenMatch = new Set<string>()
  const seenLike = new Set<string>()
  for (const run of normalized.split(' ')) {
    if (!run) continue
    if (CJK.test(run)) {
      for (const window of cjkWindows(run)) {
        if (seenMatch.has(window)) continue
        seenMatch.add(window)
        matchTerms.push(window)
      }
      continue
    }
    if (/^\d+$/.test(run) || ASCII_STOP_WORDS.has(run)) continue
    if (run.length >= 3) {
      if (seenMatch.has(run)) continue
      seenMatch.add(run)
      matchTerms.push(run)
      continue
    }
    // 1 个字符的词噪声太大（a、i、的确切分后的残片），只保留 2 字符短词。
    if (run.length === 2 && !seenLike.has(run)) {
      seenLike.add(run)
      likeTerms.push(run)
    }
  }
  const bounded = matchTerms.slice(0, maxTerms)
  return {
    match: bounded.length ? bounded.map(quote).join(' OR ') : null,
    likeTerms: likeTerms.slice(0, maxLikeTerms)
  }
}

export function isEmptyQueryPlan(plan: MemoryQueryPlan): boolean {
  return !plan.match && plan.likeTerms.length === 0
}
