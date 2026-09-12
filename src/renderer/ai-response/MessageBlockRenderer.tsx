import type { MessageBlock } from './blocks'
import { MarkdownBlockRenderer } from './blocks/MarkdownBlock'
import { CodeBlockRenderer } from './blocks/CodeBlock'
import { DiffBlockRenderer } from './blocks/DiffBlock'
import { FileReferenceBlockRenderer } from './blocks/FileReferenceBlock'
import { FileListBlockRenderer } from './blocks/FileListBlock'
import { ToolCallBlockRenderer } from './blocks/ToolCallBlock'
import { ToolResultBlockRenderer } from './blocks/ToolResultBlock'
import { TerminalBlockRenderer } from './blocks/TerminalBlock'
import { ErrorBlockRenderer } from './blocks/ErrorBlock'

/** 唯一分发点：新增内容类型只在这里加一个分支和一个 Renderer。 */
export function MessageBlockRenderer({ block }: { block: MessageBlock }) {
  switch (block.type) {
    case 'markdown': return <MarkdownBlockRenderer block={block} />
    case 'code': return <CodeBlockRenderer block={block} />
    case 'diff': return <DiffBlockRenderer block={block} />
    case 'fileReference': return <FileReferenceBlockRenderer block={block} />
    case 'fileList': return <FileListBlockRenderer block={block} />
    case 'toolCall': return <ToolCallBlockRenderer block={block} />
    case 'toolResult': return <ToolResultBlockRenderer block={block} />
    case 'terminal': return <TerminalBlockRenderer block={block} />
    case 'error': return <ErrorBlockRenderer block={block} />
  }
}
