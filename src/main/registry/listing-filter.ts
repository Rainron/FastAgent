import type { HubQuery } from '../../shared/types'
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
