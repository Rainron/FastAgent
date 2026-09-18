import type { HubInstallState, HubQuery } from '../../shared/types'
import type { HubListingDraft } from './types'

/** 关键词只在条目自带的文本字段里找；跨源统一实现，避免各 provider 各写一套匹配。 */
function matchesKeyword(listing: HubListingDraft, keyword: string) {
  return [listing.name, listing.displayName, listing.description, listing.author ?? '', ...listing.tags, ...listing.categories]
    .join(' ')
    .toLowerCase()
    .includes(keyword)
}

export function matchesHubQuery(listing: HubListingDraft, query: HubQuery = {}): boolean {
  const keyword = query.keyword?.trim().toLowerCase()
  if (query.abilityType && listing.abilityType !== query.abilityType) return false
  if (query.category && !listing.categories.includes(query.category)) return false
  if (keyword && !matchesKeyword(listing, keyword)) return false
  return true
}

/**
 * 安装态过滤。只能作用在 decorateListings 之后的条目上：
 * installed / updateAvailable 都是拿本地能力库现算的，源本身不带这两个字段。
 */
export function filterByInstallState<T extends { installed: boolean; updateAvailable?: boolean }>(listings: T[], state: HubInstallState | undefined): T[] {
  if (!state || state === 'all') return listings
  if (state === 'installed') return listings.filter((listing) => listing.installed)
  if (state === 'update_available') return listings.filter((listing) => Boolean(listing.updateAvailable))
  return listings.filter((listing) => !listing.installed)
}

export function sortListings<T extends HubListingDraft>(listings: T[], sort: HubQuery['sort']): T[] {
  const byName = (a: HubListingDraft, b: HubListingDraft) => a.displayName.localeCompare(b.displayName)
  const copy = [...listings]
  switch (sort) {
    case 'trending':
      return copy.sort((a, b) => (b.trending ?? 0) - (a.trending ?? 0) || byName(a, b))
    case 'latest':
      return copy.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '') || byName(a, b))
    case 'name':
      return copy.sort(byName)
    default:
      return copy.sort((a, b) =>
        Number(Boolean(b.featured)) - Number(Boolean(a.featured))
        || (b.downloadCount ?? 0) - (a.downloadCount ?? 0)
        || byName(a, b))
  }
}
