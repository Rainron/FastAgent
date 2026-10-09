/** 吸顶条的高度；判定「过程头已被挡住」时要把它让出来，否则头部滑到条下面的那一段两边都看不到。 */
export const STICKY_HEAD_HEIGHT = 34

/**
 * 过程头是否已经往上滚出（或滑进吸顶条下面）：只有往上滚走才吸顶，
 * 还没滚到（在视口下方）时也不相交，但那时不该出条。
 */
export function headScrolledPast(targetBottom: number, visibleTop: number): boolean {
  return targetBottom <= visibleTop + 0.5
}
