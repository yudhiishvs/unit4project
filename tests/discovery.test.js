import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeArtwork,
  toggleBan,
  isAllowed,
  discoverFromIds,
  prioritizeUnseen,
  searchUrl,
} from '../src/discovery.js';

const first = {
  objectID: 101,
  title: 'Evening Garden',
  objectDate: '1889',
  department: 'European Paintings',
  medium: 'Oil on canvas',
  artistDisplayName: 'Ada Artist',
  primaryImageSmall: 'https://images.example/101.jpg',
  objectURL: 'https://museum.example/101',
};
const second = {
  ...first,
  objectID: 202,
  title: 'Blue River',
  department: 'American Paintings',
  primaryImageSmall: 'https://images.example/202.jpg',
};

test('normalizes one API record and rejects a record without a usable image', () => {
  assert.deepEqual(normalizeArtwork(first), {
    id: 101,
    title: 'Evening Garden',
    date: '1889',
    department: 'European Paintings',
    medium: 'Oil on canvas',
    artist: 'Ada Artist',
    image: 'https://images.example/101.jpg',
    museumUrl: 'https://museum.example/101',
  });
  assert.equal(normalizeArtwork({ ...first, primaryImageSmall: '' }), null);
});

test('clicking a value adds and then removes its ban', () => {
  const added = toggleBan([], 'department', 'European Paintings');
  assert.deepEqual(added, [{ field: 'department', value: 'European Paintings' }]);
  assert.equal(isAllowed(normalizeArtwork(first), added), false);
  assert.deepEqual(toggleBan(added, 'department', 'European Paintings'), []);
});

test('a banned result is skipped while another record remains available', async () => {
  const records = new Map([[101, first], [202, second]]);
  const bans = [{ field: 'department', value: 'European Paintings' }];
  const found = await discoverFromIds([101, 202], {
    fetchRecord: async (id) => records.get(id),
    imageReady: async () => true,
    getBans: () => bans,
    recentIds: [],
  });
  assert.equal(found.id, 202);
  assert.equal(found.title, 'Blue River');
  assert.equal(found.image, 'https://images.example/202.jpg');
});

test('a ban added while an image loads prevents that result from displaying', async () => {
  let bans = [];
  const found = await discoverFromIds([101, 202], {
    fetchRecord: async (id) => id === 101 ? first : second,
    imageReady: async (url) => {
      if (url.includes('101')) bans = [{ field: 'department', value: 'European Paintings' }];
      return true;
    },
    getBans: () => bans,
    recentIds: [],
  });
  assert.equal(found.id, 202);
});

test('unseen IDs are tried before recent repeats', () => {
  assert.deepEqual(prioritizeUnseen([101, 202, 303], [101, 303]), [202, 101, 303]);
});

test('searches the current paginated image API', () => {
  const url = new URL(searchUrl('flowers', 75, 24));
  assert.equal(url.pathname, '/public/collection/v1.1/search');
  assert.equal(url.searchParams.get('hasImages'), 'true');
  assert.equal(url.searchParams.get('isPublicDomain'), 'true');
  assert.equal(url.searchParams.get('q'), 'flowers');
  assert.equal(url.searchParams.get('offset'), '75');
  assert.equal(url.searchParams.get('limit'), '24');
});
