import { memo } from 'react'
import { AppWindow, LoaderCircle } from 'lucide-react'
import { useOpenLocalFile } from './use-open-local-file'

export const OpenLocalFileButton = memo(function OpenLocalFileButton({ path, workspaceRoot, onNotice }: { path: string; workspaceRoot: string | null; onNotice: (notice: string) => void }) {
  const { opening, open, disabled } = useOpenLocalFile(path, workspaceRoot, onNotice)
  return <button type="button" className="icon-button" disabled={disabled} onClick={() => void open()} aria-label="用本地应用打开" title="用本地应用打开">
    {opening ? <LoaderCircle size={14} className="spin" /> : <AppWindow size={14} />}
  </button>
})
