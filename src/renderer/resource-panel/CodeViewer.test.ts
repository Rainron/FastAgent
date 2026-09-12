import { describe, expect, it } from 'vitest'
import { stripShikiWrapper } from './CodeViewer'

describe('stripShikiWrapper', () => {
  it('剥掉 pre/code 包装，保留行结构与行内 token', () => {
    const html = '<pre class="shiki github-light" style="background-color:#fff" tabindex="0"><code><span class="line"><span style="color:#D73A49">const</span></span>\n<span class="line"><span style="color:#005CC5"> x</span></span></code></pre>'
    const stripped = stripShikiWrapper(html)
    expect(stripped).not.toContain('<pre')
    expect(stripped).not.toContain('</code>')
    expect(stripped.match(/<span class="line">/g)).toHaveLength(2)
    expect(stripped).toContain('<span style="color:#D73A49">const</span>')
  })

  it('代码内容里的标签文本已被 shiki 转义，不会被误当包装剥离', () => {
    const html = '<pre class="shiki" tabindex="0"><code><span class="line">&lt;pre class=&quot;shiki&quot;&gt;&lt;code&gt;</span>\n<span class="line">&lt;/code&gt;&lt;/pre&gt;</span></code></pre>'
    const stripped = stripShikiWrapper(html)
    expect(stripped).not.toContain('<pre class')
    expect(stripped.match(/<span class="line">/g)).toHaveLength(2)
    // 转义后的内容原样保留
    expect(stripped).toContain('&lt;/code&gt;&lt;/pre&gt;')
  })

  it('空行（空 .line）在剥壳后仍然保留，行号才能对齐', () => {
    const html = '<pre class="shiki" tabindex="0"><code><span class="line">a</span>\n<span class="line"></span>\n<span class="line">b</span></code></pre>'
    const stripped = stripShikiWrapper(html)
    expect(stripped.split('\n')).toEqual(['<span class="line">a</span>', '<span class="line"></span>', '<span class="line">b</span>'])
  })
})
