import { useEffect, useRef, useState } from 'react'
import type { SettingsCategory } from '../settings-navigation'

export function useSettingsNavigation(requestedCategory: SettingsCategory, categoryRequest: number) {
  const [category, setCategory] = useState(requestedCategory)
  const contentRef = useRef<HTMLDivElement>(null)
  useEffect(() => { setCategory(requestedCategory) }, [requestedCategory, categoryRequest])
  useEffect(() => { contentRef.current?.scrollTo(0, 0) }, [category])
  return { category, setCategory, contentRef }
}
