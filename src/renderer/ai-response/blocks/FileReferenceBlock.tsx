import { FileCode2 } from 'lucide-react'
import type { FileReferenceBlock as FileReferenceBlockData } from '../blocks'
import { formatFileReference, type FileReference } from '../file-reference'
import { useResponseActions } from '../response-context'

/** 行内文件引用：`src/main.ts:42` 这类写法点开后在产物面板定位到行。 */
export function FileReferenceChip({ reference }: { reference: FileReference }) {
  const actions = useResponseActions()
  const label = formatFileReference(reference)
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
