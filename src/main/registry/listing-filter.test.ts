import { describe, expect, it } from 'vitest'
import { filterByInstallState } from './listing-filter'

const listings = [
  { id: 'a', installed: false },
  { id: 'b', installed: true },
  { id: 'c', installed: true, updateAvailable: true }
]

describe('filterByInstallState', () => {
  it('未指定或 all 时原样返回', () => {
    expect(filterByInstallState(listings, undefined)).toBe(listings)
    expect(filterByInstallState(listings, 'all')).toBe(listings)
  })

  it('按已安装筛选包含有更新的条目', () => {
    expect(filterByInstallState(listings, 'installed').map((item) => item.id)).toEqual(['b', 'c'])
  })

  it('按未安装筛选', () => {
    expect(filterByInstallState(listings, 'not_installed').map((item) => item.id)).toEqual(['a'])
  })

  it('按有更新筛选只留 updateAvailable', () => {
    expect(filterByInstallState(listings, 'update_available').map((item) => item.id)).toEqual(['c'])
  })
})
