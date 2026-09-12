import type { Highlighter } from 'shiki/bundle/web'

/** 双主题输出成 CSS 变量，主题切换只靠 CSS，不用重新高亮。 */
const THEMES = { light: 'github-light', dark: 'github-dark' } as const

export const MAX_HIGHLIGHT_CODE_LENGTH = 200_000

// 语言判断必须保持同步，否则仅为判断能力就会提前加载 Shiki 主包。
const BUNDLED_LANGUAGE_IDS = new Set(`angular-html angular-ts astro bash blade c c++ cjs coffee coffeescript cpp css csv cts glsl gql graphql haml handlebars hbs html html-derivative http hurl imba jade java javascript jinja jison jl js json json5 jsonc jsonl jsx julia less lit markdown marko md mdc mdx mjs mts php postcss pug py python r regex regexp sass scss sh shell shellscript smithy sql styl stylus svelte ts ts-tags tsx typescript vue vue-html vue-vine wasm wgsl wit xml yaml yml zsh`.split(' '))

let highlighterPromise: Promise<Highlighter> | null = null
const loading = new Map<string, Promise<void>>()

/** bundledLanguages 里已经含别名（ts/js/py 之类），不在表内的语言直接放弃高亮。 */
function resolveLanguage(language: string | null): string | null {
  if (!language) return null
  const key = language.toLowerCase()
  return BUNDLED_LANGUAGE_IDS.has(key) ? key : null
}

export function isHighlightableLanguage(language: string | null): boolean {
  return resolveLanguage(language) !== null
}

export function shouldHighlightCode(code: string, language: string | null): boolean {
  return code.length <= MAX_HIGHLIGHT_CODE_LENGTH && isHighlightableLanguage(language)
}

/** 扩展名与 shiki 语言 id 对不上的那些；对得上的（ts/json/css…）直接用扩展名。 */
const EXTENSION_ALIASES: Record<string, string> = {
  mjs: 'js', cjs: 'js', mts: 'ts', cts: 'ts',
  md: 'markdown', yml: 'yaml',
  sh: 'shell', bash: 'shell', zsh: 'shell', ps1: 'powershell',
  py: 'python', rs: 'rust', kt: 'kotlin', rb: 'ruby', cs: 'csharp',
  h: 'c', hpp: 'cpp', cc: 'cpp', htm: 'html'
}

/** 从文件路径猜语言，猜不到（或 shiki 没有这个语言）返回 null，调用方退回纯文本。 */
export function languageFromPath(path: string | null): string | null {
  if (!path) return null
  const name = path.split(/[\\/]/).at(-1) ?? ''
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return null
  const extension = name.slice(dot + 1).toLowerCase()
  return resolveLanguage(EXTENSION_ALIASES[extension] ?? extension)
}

async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki/bundle/web')
      .then(({ createHighlighter }) => createHighlighter({ themes: [THEMES.light, THEMES.dark], langs: [] }))
  }
  return highlighterPromise
}

/**
 * 返回 shiki 渲染好的 HTML；语言不支持或加载失败时返回 null，由调用方退回纯文本。
 * shiki 自己会转义代码文本，输出的是它构造的 span 树，不含原文里的标签。
 */
export async function highlightCode(code: string, language: string | null): Promise<string | null> {
  if (!shouldHighlightCode(code, language)) return null
  const resolved = resolveLanguage(language)
  if (!resolved) return null
  try {
    const highlighter = await getHighlighter()
    if (!highlighter.getLoadedLanguages().includes(resolved)) {
      // 同一语言并发请求只加载一次。
      let pending = loading.get(resolved)
      if (!pending) {
        pending = highlighter.loadLanguage(resolved as never).then(() => undefined)
        loading.set(resolved, pending)
      }
      await pending
    }
    return highlighter.codeToHtml(code, { lang: resolved, themes: THEMES, defaultColor: false })
  } catch {
    return null
  }
}
