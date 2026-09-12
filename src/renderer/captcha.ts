/** 拖动落点在轨道上的比例换算成角度；越界按端点收敛，避免手指滑出轨道后角度跳变。 */
export function captchaAngleFromRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0
  return Math.round(Math.min(1, Math.max(0, ratio)) * 359)
}

export function normalizeCaptchaAngle(value: number): number {
  if (!Number.isFinite(value)) return 0
  const normalized = value % 360
  return normalized < 0 ? normalized + 360 : normalized
}
