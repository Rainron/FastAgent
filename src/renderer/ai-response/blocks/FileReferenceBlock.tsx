import { useEffect, useState } from 'react'
import { FileCode2 } from 'lucide-react'
import type { FileReferenceBlock as FileReferenceBlockData } from '../blocks'
import { cachedFileExists, queryFileExists } from '../file-exists-cache'
import { formatFileReference, type FileReference } from '../file-reference'
import { useResponseActions } from '../response-context'

/**
 * 行内文件引用：`src/main.ts:42` 这类写法点开后在产物面板定位到行。
 *
 * 只有工作区里真的存在这个文件才渲染成可点芯片。模型经常把主机地址、命令片段、
 * 示例路径写成同样的形状，一律做成按钮的话点开只会弹「文件或目录不存在」。
 * 存在性未知时先按普通行内代码渲染——宁可少一个链接，也不要给一个点了报错的链接。
 */
export function FileReferenceChip({ reference }: { reference: FileReference }) {
  const actions = useResponseActions()
  const label = formatFileReference(reference)
  const [exists, setExists] = useState(() => cachedFileExists(reference.path) ?? false)

  useEffect(() => {
    const known = cachedFileExists(reference.path)
    if (known !== undefined) { setExists(known); return }
    setExists(false)
    return queryFileExists(reference.path, setExists)
  }, [reference.path])

  if (!exists) return <code>{label}</code>
  return (
    <button type="button" className="file-reference" onClick={() => actions.openFile(reference)} title="打开这个文件">
      <FileCode2 size={12} />
      <span>{label}</span>
    </button>
  )
}

export function FileReferenceBlockRenderer({ block }: { block: FileReferenceBlockData }) {
  return <div className="file-reference-block"><FileReferenceChip reference={{ path: block.path, line: block.line, endLine: block.endLine }} /></div>
}
