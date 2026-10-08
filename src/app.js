import { discoverFromIds, objectUrl, searchUrl, toggleBan } from './discovery.js';

const THEMES = ['garden', 'portrait', 'flower', 'bird', 'mountain', 'river', 'vessel', 'music', 'sea', 'night', 'tree', 'city'];
const SEARCH_LIMIT = 24;
const MAX_SEARCHES = 3;
const STORAGE_KEY = 'open-gallery-session-v1';

const elements = {
  discover: document.querySelector('#discover-button'),
  status: document.querySelector('#status'),
  empty: document.querySelector('#empty-state'),
  artwork: document.querySelector('#current-artwork'),
  image: document.querySelector('#art-image'),
  artist: document.querySelector('#art-artist'),
  title: document.querySelector('#art-title'),
  date: document.querySelector('#art-date'),
  department: document.querySelector('#art-department'),
  medium: document.querySelector('#art-medium'),
  source: document.querySelector('#art-link'),
  bans: document.querySelector('#ban-list'),
  banCount: document.querySelector('#ban-count'),
  history: document.querySelector('#history-list'),
};

function restoreSession() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}');
    return {
      bans: Array.isArray(saved.bans) ? saved.bans : [],
      history: Array.isArray(saved.history) ? saved.history : [],
      recentIds: Array.isArray(saved.recentIds) ? saved.recentIds : [],
    };
  } catch {
    return { bans: [], history: [], recentIds: [] };
  }
}

const state = { ...restoreSession(), current: null, busy: false };

function saveSession() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      bans: state.bans,
      history: state.history,
      recentIds: state.recentIds,
    }));
  } catch {
    // The app still works when storage is blocked.
  }
}

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle('status-error', isError);
}

function setBusy(busy) {
  state.busy = busy;
  elements.discover.disabled = busy;
  elements.discover.classList.toggle('is-loading', busy);
  elements.discover.innerHTML = busy
    ? '<span class="spinner" aria-hidden="true"></span> Looking for a work…'
    : '<span aria-hidden="true">✳</span> Discover a work <span class="button-arrow" aria-hidden="true">↗</span>';
}

function renderBans() {
  elements.banCount.textContent = String(state.bans.length);
  elements.bans.replaceChildren();
  if (!state.bans.length) {
    const empty = document.createElement('p');
    empty.className = 'side-empty';
    empty.textContent = 'No bans yet. Your gallery is wide open.';
    elements.bans.append(empty);
  } else {
    for (const ban of state.bans) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ban-pill';
      button.dataset.field = ban.field;
      button.dataset.value = ban.value;
      button.setAttribute('aria-label', `Remove ${ban.value} from ban list`);
      const field = document.createElement('span');
      field.className = 'ban-field';
      field.textContent = ban.field;
      const value = document.createElement('span');
      value.textContent = ban.value;
      const remove = document.createElement('span');
      remove.className = 'ban-remove';
      remove.setAttribute('aria-hidden', 'true');
      remove.textContent = '×';
      button.append(field, value, remove);
      elements.bans.append(button);
    }
  }
  renderCurrentBanState();
}

function renderCurrentBanState() {
  if (!state.current) return;
  for (const [field, button] of [['department', elements.department], ['medium', elements.medium]]) {
    const value = state.current[field];
    const banned = state.bans.some((ban) => ban.field === field && ban.value === value);
    button.classList.toggle('is-banned', banned);
    button.setAttribute('aria-pressed', String(banned));
    button.setAttribute('aria-label', `${banned ? 'Unban' : 'Ban'} ${field} ${value}`);
  }
}

function renderHistory() {
  elements.history.replaceChildren();
  if (!state.history.length) {
    const empty = document.createElement('p');
    empty.className = 'side-empty';
    empty.textContent = 'Your trail begins with the next discovery.';
    elements.history.append(empty);
    return;
  }
  for (const work of state.history.slice(0, 8)) {
    const item = document.createElement('a');
    item.className = 'history-item';
    item.href = work.museumUrl;
    item.target = '_blank';
    item.rel = 'noopener noreferrer';
    const image = document.createElement('img');
    image.src = work.image;
    image.alt = '';
    const words = document.createElement('span');
    words.className = 'history-words';
    const title = document.createElement('strong');
    title.textContent = work.title;
    const detail = document.createElement('small');
    detail.textContent = work.date;
    words.append(title, detail);
    item.append(image, words);
    elements.history.append(item);
  }
}

function renderArtwork(work) {
  elements.empty.hidden = true;
  elements.artwork.hidden = false;
  elements.image.src = work.image;
  elements.image.alt = `${work.title}, from The Met collection`;
  elements.artist.textContent = work.artist || 'Artist not listed';
  elements.title.textContent = work.title;
  elements.date.textContent = work.date;
  elements.department.textContent = work.department;
  elements.medium.textContent = work.medium;
  elements.source.href = work.museumUrl;
  state.current = work;
  renderCurrentBanState();
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Request failed with ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function imageReady(url) {
  return new Promise((resolve) => {
    const image = new Image();
    const timeout = setTimeout(() => finish(false), 10000);
    let settled = false;
    function finish(ok) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(ok);
    }
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = url;
  });
}

function shuffled(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function searchIds(theme) {
  const first = await fetchJson(searchUrl(theme, 0, SEARCH_LIMIT));
  if (!Array.isArray(first.objectIDs) || !first.objectIDs.length) return [];
  const total = Number(first.total) || first.objectIDs.length;
  if (total <= SEARCH_LIMIT) return first.objectIDs;
  const maxOffset = Math.min(total - SEARCH_LIMIT, 10000 - SEARCH_LIMIT);
  const offset = Math.floor(Math.random() * (maxOffset + 1));
  const page = await fetchJson(searchUrl(theme, offset, SEARCH_LIMIT));
  return Array.isArray(page.objectIDs) && page.objectIDs.length ? page.objectIDs : first.objectIDs;
}

async function discover() {
  if (state.busy) return;
  setBusy(true);
  setStatus('Looking through the collection…');
  let lastError = null;
  try {
    for (const theme of shuffled(THEMES).slice(0, MAX_SEARCHES)) {
      let ids;
      try {
        ids = await searchIds(theme);
      } catch (error) {
        lastError = error;
        continue;
      }
      const work = await discoverFromIds(shuffled(ids), {
        fetchRecord: (id) => fetchJson(objectUrl(id)),
        imageReady,
        getBans: () => state.bans,
        recentIds: state.recentIds,
      });
      if (!work) continue;
      if (state.current) state.history = [state.current, ...state.history].slice(0, 20);
      state.recentIds = [work.id, ...state.recentIds.filter((id) => id !== work.id)].slice(0, 50);
      renderArtwork(work);
      renderHistory();
      saveSession();
      setStatus('A new work from The Met collection.');
      return;
    }
    if (lastError) {
      setStatus('The collection could not be reached. Check your connection and try again.', true);
    } else {
      setStatus('No work matched this search and your ban list. Remove a ban or try again.', true);
    }
  } finally {
    setBusy(false);
  }
}

function changeBan(field, value) {
  state.bans = toggleBan(state.bans, field, value);
  renderBans();
  saveSession();
}

elements.discover.addEventListener('click', discover);
elements.department.addEventListener('click', () => {
  if (state.current) changeBan('department', state.current.department);
});
elements.medium.addEventListener('click', () => {
  if (state.current) changeBan('medium', state.current.medium);
});
elements.bans.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-field]');
  if (button) changeBan(button.dataset.field, button.dataset.value);
});

renderBans();
renderHistory();
