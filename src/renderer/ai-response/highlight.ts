import type { Highlighter } from 'shiki/bundle/full'

/** 双主题输出成 CSS 变量，主题切换只靠 CSS，不用重新高亮。 */
const THEMES = { light: 'github-light', dark: 'github-dark' } as const

export const MAX_HIGHLIGHT_CODE_LENGTH = 200_000

// 语言判断必须保持同步，否则仅为判断能力就会提前加载 Shiki 主包。
// 用 full 包：web 包只有前端语言，Go / Rust / TOML / Dockerfile 这类常见工程文件全都退回纯文本。
// 语法按语言懒加载，多列的语言不打开就不会下载。表里每个 id 都由测试对照 full 包校验。
export const BUNDLED_LANGUAGE_IDS = new Set([
  // 前端与脚本
  ...'angular-html angular-ts astro bash blade c c++ cjs coffee coffeescript cpp css csv cts glsl gql graphql haml handlebars hbs html html-derivative http hurl imba jade java javascript jinja jison jl js json json5 jsonc jsonl jsx julia less lit markdown marko md mdc mdx mjs mts php postcss pug py python r regex regexp sass scss sh shell shellscript smithy sql styl stylus svelte ts ts-tags tsx typescript vue vue-html vue-vine wasm wgsl wit xml yaml yml zsh'.split(' '),
  // 后端与系统语言
  ...'go rust kotlin ruby csharp fsharp vb swift dart scala groovy lua perl objective-c objective-cpp elixir erlang haskell ocaml clojure zig nim crystal d solidity asm cmake'.split(' '),
  // 配置、构建与运维
  ...'toml ini properties dotenv dockerfile makefile nginx apache hcl terraform proto prisma nix powershell bat fish nushell awk diff log latex tex ssh-config systemd'.split(' ')
])

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

/** 扩展名与 shiki 语言 id 对不上的那些；对得上的（ts/json/css/go/toml…）直接用扩展名。 */
const EXTENSION_ALIASES: Record<string, string> = {
  mjs: 'js', cjs: 'js', mts: 'ts', cts: 'ts',
  md: 'markdown', yml: 'yaml',
  sh: 'shell', bash: 'shell', zsh: 'shell', ps1: 'powershell', psm1: 'powershell', psd1: 'powershell', cmd: 'bat',
  py: 'python', pyi: 'python', pyw: 'python', rs: 'rust', kt: 'kotlin', kts: 'kotlin', rb: 'ruby', cs: 'csharp', fs: 'fsharp', fsx: 'fsharp',
  h: 'c', hpp: 'cpp', hh: 'cpp', hxx: 'cpp', cxx: 'cpp', cc: 'cpp', m: 'objective-c', mm: 'objective-cpp',
  htm: 'html', xhtml: 'html',
  // 各类 XML 方言：工程文件、清单、资源都按 XML 着色
  svg: 'xml', xsd: 'xml', xsl: 'xml', xslt: 'xml', plist: 'xml', csproj: 'xml', vbproj: 'xml', fsproj: 'xml', props: 'xml', targets: 'xml', resx: 'xml', xaml: 'xml', wsdl: 'xml',
  cfg: 'ini', conf: 'ini', editorconfig: 'ini', gitconfig: 'ini', npmrc: 'ini',
  env: 'dotenv', gradle: 'groovy', tf: 'terraform', tfvars: 'terraform', mk: 'makefile',
  patch: 'diff', pl: 'perl', pm: 'perl', ex: 'elixir', exs: 'elixir', erl: 'erlang', hrl: 'erlang', hs: 'haskell', ml: 'ocaml', mli: 'ocaml',
  clj: 'clojure', cljs: 'clojure', edn: 'clojure', sol: 'solidity', s: 'asm', vbs: 'vb', bas: 'vb', sc: 'scala'
}

/** 没有扩展名、靠文件名认的常见工程文件（全小写比较）。 */
const FILENAME_LANGUAGES: Record<string, string> = {
  dockerfile: 'dockerfile', containerfile: 'dockerfile',
  makefile: 'makefile', gnumakefile: 'makefile', 'cmakelists.txt': 'cmake',
  jenkinsfile: 'groovy', gemfile: 'ruby', rakefile: 'ruby', podfile: 'ruby', vagrantfile: 'ruby', brewfile: 'ruby',
  '.bashrc': 'shell', '.bash_profile': 'shell', '.zshrc': 'shell', '.profile': 'shell',
  '.env': 'dotenv', '.editorconfig': 'ini', '.gitconfig': 'ini', '.npmrc': 'ini', '.gitattributes': 'ini',
  'nginx.conf': 'nginx', '.htaccess': 'apache'
}

/** 允许写注释的 JSON 配置：按 json 高亮会把注释全标成错误。 */
const JSONC_NAMES = /^(tsconfig(\..+)?|jsconfig(\..+)?|\.eslintrc|\.babelrc|devcontainer|settings|launch|tasks|extensions)\.json$/

/** 从文件路径猜语言，猜不到（或 shiki 没有这个语言）返回 null，调用方退回纯文本。 */
export function languageFromPath(path: string | null): string | null {
  if (!path) return null
  const name = (path.split(/[\\/]/).at(-1) ?? '').toLowerCase()
  if (!name) return null
  const byName = FILENAME_LANGUAGES[name]
  if (byName) return resolveLanguage(byName)
  if (JSONC_NAMES.test(name)) return resolveLanguage('jsonc')
  // Dockerfile.dev、.env.local 这类「文件名 + 变体后缀」
  if (/^(dockerfile|containerfile)\./.test(name)) return resolveLanguage('dockerfile')
  if (/^\.env\./.test(name)) return resolveLanguage('dotenv')
  const dot = name.lastIndexOf('.')
  // 只有前导点的隐藏文件（.gitignore）没有扩展名可认，不在文件名表里就按纯文本
  if (dot <= 0) return null
  const extension = name.slice(dot + 1)
  return resolveLanguage(EXTENSION_ALIASES[extension] ?? extension)
}

async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki/bundle/full')
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
