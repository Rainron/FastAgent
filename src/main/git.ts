/**
 * Git 能力门面：按域拆在 git/ 下，这里只做转发，调用方（IPC / index）统一从这里导入。
 * 新增能力先找对应的 git/*.ts，没有就新建一个域文件，再在这里补一行导出。
 */
export { execGit, failureReason, GIT_NETWORK_TIMEOUT_MS, GIT_TIMEOUT_MS, type GitExecResult } from './git/exec'
export { parseAheadBehind, parsePorcelain, resolveGitWorkspaceState, resolveSyncState, watchGitMetadata } from './git/state'
export {
  checkoutBranch, createBranch, createTrackingBranch, deleteBranch, listBranchInfos, listLocalBranches, listRemoteBranches,
  parseBranchInfos, parseTrack, renameBranch, setUpstream, validateBranchName, validateRemoteRef
} from './git/branches'
export { commitDetail, commitPatch, countCommits, listCommits, parseCommitRecords, parseNameStatus, parseNumstat } from './git/commits'
export {
  commitChanges, diffStat, discardFiles, fileDiff, listChanges, mergeNumstat, resetHead, sanitizePaths, splitStatus,
  stageFiles, unstageFiles, workingDiff
} from './git/changes'
export { addRemote, fetchRemote, listRemoteDetails, listRemotes, pullCurrent, pushCurrent, removeRemote, setRemoteUrl } from './git/remote'
export { listStashes, parseStashList, stashApply, stashDrop, stashPatch, stashPop, stashPush, validateStashRef } from './git/stash'
export { abortIntegration, integrationStatus, listConflicts, mergeBranch, rebaseOnto } from './git/integrate'
