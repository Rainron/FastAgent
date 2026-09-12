export const MIN_COMPOSER_HEIGHT = 112

export function clampComposerHeight(height: number, viewportHeight = window.innerHeight) {
  return Math.min(Math.max(Math.round(height), MIN_COMPOSER_HEIGHT), Math.round(viewportHeight * 0.6))
}
