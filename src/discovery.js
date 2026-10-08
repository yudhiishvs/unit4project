const API_ROOT = 'https://collectionapi.metmuseum.org/public/collection';
const BAN_FIELDS = new Set(['department', 'medium']);

export function normalizeArtwork(record) {
  if (!record || !Number.isInteger(record.objectID)) return null;

  const title = String(record.title ?? '').trim();
  const date = String(record.objectDate ?? '').trim();
  const department = String(record.department ?? '').trim();
  const medium = String(record.medium ?? '').trim();
  const image = String(record.primaryImageSmall || record.primaryImage || '').trim();

  if (!title || !date || !department || !medium || !image) return null;

  return {
    id: record.objectID,
    title,
    date,
    department,
    medium,
    artist: String(record.artistDisplayName ?? '').trim(),
    image,
    museumUrl: record.objectURL || `https://www.metmuseum.org/art/collection/search/${record.objectID}`,
  };
}

export function toggleBan(bans, field, value) {
  if (!BAN_FIELDS.has(field) || !value) return bans;
  const exists = bans.some((ban) => ban.field === field && ban.value === value);
  return exists
    ? bans.filter((ban) => !(ban.field === field && ban.value === value))
    : [...bans, { field, value }];
}

export function isAllowed(artwork, bans) {
  return Boolean(artwork) && !bans.some((ban) => artwork[ban.field] === ban.value);
}

export function prioritizeUnseen(ids, recentIds) {
  const recent = new Set(recentIds);
  return [
    ...ids.filter((id) => !recent.has(id)),
    ...ids.filter((id) => recent.has(id)),
  ];
}

export function searchUrl(query, offset = 0, limit = 24) {
  const url = new URL(`${API_ROOT}/v1.1/search`);
  url.searchParams.set('q', query);
  url.searchParams.set('hasImages', 'true');
  url.searchParams.set('isPublicDomain', 'true');
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('limit', String(limit));
  return url.toString();
}

export function objectUrl(id) {
  return `${API_ROOT}/v1/objects/${id}`;
}

export async function discoverFromIds(ids, { fetchRecord, imageReady, getBans, recentIds = [] }) {
  for (const id of prioritizeUnseen(ids, recentIds)) {
    try {
      const artwork = normalizeArtwork(await fetchRecord(id));
      if (!isAllowed(artwork, getBans())) continue;
      if (!await imageReady(artwork.image)) continue;
      if (!isAllowed(artwork, getBans())) continue;
      return artwork;
    } catch {
      // A missing object or broken image should not stop the rest of the page.
    }
  }
  return null;
}
