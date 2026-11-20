(() => {
  'use strict';

  const DEFAULT_STATE = {
    enabled: true,
    hideR18: false,
    dimInsteadOfHide: false,
    showCardButton: true,
    hiddenComics: {},
    blockedTags: [],
    blockedKeywords: []
  };

  const COMIC_PATH_RE = /^\/truyen-tranh\/([^/?#]+)\/?$/;
  const R18_BADGE_RE = /^(R\.?18|18\+)$/i;
  const STOP_TAGS = new Set(['MAIN', 'SECTION', 'BODY', 'HEADER', 'NAV', 'FOOTER', 'UL', 'OL']);
  const SKIP_ANCESTOR_SELECTOR = 'header, nav, footer';

  const COMIC_TAGS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const MAX_COMIC_TAGS_CACHE = 1500;
  const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
  const MAX_TAG_FETCH_CONCURRENCY = 3;

  const EYE_OFF_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/>' +
    '<path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/>' +
    '<path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/>' +
    '<path d="m2 2 20 20"/>' +
    '</svg>';

  const EYE_ON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/>' +
    '<circle cx="12" cy="12" r="3"/>' +
    '</svg>';

  let state = { ...DEFAULT_STATE };
  let tagCatalogItems = [];
  let blockedTagMatchers = new Map();

  // comicId -> { tags: string[], normSet: Set<string>, isAdult: boolean, ts: number }
  const comicTagsMap = new Map();
  const parsedSSRScripts = new WeakSet();
  const pendingTagQueue = [];
  const inFlightTagFetches = new Set();
  const failedTagFetches = new Set();
  let activeTagFetchCount = 0;
  let persistCacheTimer = null;
  let catalogFetchInFlight = null;

  let lastHiddenCount = -1;
  let lastTotalCards = 0;
  let scanScheduled = false;
  let toastContainer = null;
  let activeToastTimer = null;

  /**
   * Normalize a tag or category label for accent-insensitive, exact comparison.
   * Keeps '+' so "18+" remains distinct, while collapsing punctuation/hyphens.
   */
  function normalizeTagKey(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .trim()
      .toLowerCase()
      .replace(/đ/g, 'd')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9+]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function rebuildBlockedTagMatchers() {
    const next = new Map();
    const blocked = Array.isArray(state.blockedTags) ? state.blockedTags : [];

    for (const raw of blocked) {
      if (typeof raw !== 'string') continue;
      const display = raw.trim();
      const key = normalizeTagKey(display);
      if (!key) continue;

      if (!next.has(key)) next.set(key, display);

      for (const item of tagCatalogItems) {
        const nameKey = normalizeTagKey(item.name);
        const slugKey = normalizeTagKey(item.slug);
        if (nameKey === key || slugKey === key) {
          if (nameKey && !next.has(nameKey)) next.set(nameKey, display);
          if (slugKey && !next.has(slugKey)) next.set(slugKey, display);
        }
      }
    }

    blockedTagMatchers = next;
  }

  function extractTagStrings(list, outSet) {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (typeof item === 'string') {
        const val = item.trim();
        if (val) outSet.add(val);
      } else if (item && typeof item === 'object') {
        if (typeof item.name === 'string' && item.name.trim()) {
          outSet.add(item.name.trim());
        }
        if (typeof item.slug === 'string' && item.slug.trim()) {
          outSet.add(item.slug.trim());
        }
      }
    }
  }

  function schedulePersistComicTagsCache() {
    if (persistCacheTimer) clearTimeout(persistCacheTimer);
    persistCacheTimer = setTimeout(() => {
      persistCacheTimer = null;
      const now = Date.now();
      const entries = [];
      for (const [id, info] of comicTagsMap.entries()) {
        if (now - info.ts < COMIC_TAGS_TTL_MS && info.tags.length > 0) {
          entries.push([id, info]);
        }
      }
      entries.sort((a, b) => b[1].ts - a[1].ts);
      const bounded = entries.slice(0, MAX_COMIC_TAGS_CACHE);

      const payload = {};
      for (const [id, info] of bounded) {
        payload[id] = {
          tags: info.tags,
          isAdult: info.isAdult,
          ts: info.ts
        };
      }
      try {
        chrome.storage.local.set({ comicTagsCache: payload });
      } catch {
        // Ignore transient storage errors.
      }
    }, 1500);
  }

  /**
   * Merge extracted comic tag metadata into the in-memory map.
   * Returns true if any new comic or tag was learned.
   */
  function upsertComicTags(items, persist = true) {
    if (!items || typeof items !== 'object') return false;
    const now = Date.now();
    let anyChanged = false;

    for (const [rawId, entry] of Object.entries(items)) {
      if (!entry || typeof entry !== 'object') continue;
      const id = String(rawId).trim();
      if (!id) continue;

      const existing = comicTagsMap.get(id);
      const mergedSet = new Set(existing?.tags || []);
      const incomingTags = Array.isArray(entry.tags) ? entry.tags : [];
      for (const t of incomingTags) {
        if (typeof t === 'string' && t.trim()) {
          mergedSet.add(t.trim());
        }
      }

      const nextIsAdult = Boolean(existing?.isAdult || entry.isAdult);
      const nextTags = Array.from(mergedSet);
      const sizeChanged = !existing || nextTags.length !== existing.tags.length || nextIsAdult !== existing.isAdult;

      if (sizeChanged || !existing) {
        const normSet = new Set();
        for (const t of nextTags) {
          const nk = normalizeTagKey(t);
          if (nk) normSet.add(nk);
        }
        comicTagsMap.set(id, {
          tags: nextTags,
          normSet,
          isAdult: nextIsAdult,
          ts: Number(entry.ts) || now
        });
        anyChanged = true;
      }
    }

    if (anyChanged && persist) {
      schedulePersistComicTagsCache();
    }
    return anyChanged;
  }

  /**
   * Parse Next.js App Router SSR scripts (`self.__next_f.push(...)`) to extract
   * embedded book tags/genres/categories for SSR-rendered cards.
   */
  function extractTagsFromSSRScripts() {
    const scripts = document.querySelectorAll('script:not([src])');
    const found = {};

    for (const script of scripts) {
      if (parsedSSRScripts.has(script)) continue;
      parsedSSRScripts.add(script);

      const rawText = script.textContent;
      if (!rawText || !rawText.includes('self.__next_f.push')) continue;
      if (!rawText.includes('tags') && !rawText.includes('genre') && !rawText.includes('categories')) {
        continue;
      }

      const unescaped = rawText.replace(/\\"/g, '"');
      const parts = unescaped.split('{"id":');

      for (let i = 1; i < parts.length; i++) {
        const segment = parts[i].slice(0, 4000);
        const idMatch = segment.match(/^(\d+),/);
        if (!idMatch) continue;

        const id = idMatch[1];
        const header = segment.slice(0, 350);
        if (!/"(?:slug|title|name)"\s*:/.test(header)) continue;
        if (/"book_count"\s*:/.test(header)) continue;

        const tagSet = new Set();
        for (const field of ['tags', 'genre', 'categories']) {
          const arrRe = new RegExp(`"${field}"\\s*:\\s*(\\[[^\\]]*\\])`);
          const arrMatch = segment.match(arrRe);
          if (arrMatch) {
            try {
              const parsedArr = JSON.parse(arrMatch[1]);
              extractTagStrings(parsedArr, tagSet);
            } catch {
              // Ignore malformed partial slices.
            }
          }
        }

        if (tagSet.size === 0) continue;

        const adultMatch = segment.match(/"(?:isAdult|is_adult)"\s*:\s*(true|false)/);
        const isAdult = adultMatch ? adultMatch[1] === 'true' : false;

        found[id] = {
          tags: Array.from(tagSet),
          isAdult
        };
      }
    }

    if (Object.keys(found).length > 0) {
      upsertComicTags(found, false);
    }
  }

  function processTagFetchQueue() {
    while (activeTagFetchCount < MAX_TAG_FETCH_CONCURRENCY && pendingTagQueue.length > 0) {
      const comicId = pendingTagQueue.shift();
      if (!comicId || comicTagsMap.has(comicId) || inFlightTagFetches.has(comicId)) {
        continue;
      }

      inFlightTagFetches.add(comicId);
      activeTagFetchCount += 1;

      fetch(`${location.origin}/api/manga/${encodeURIComponent(comicId)}`, {
        credentials: 'same-origin'
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          const data = json?.data;
          if (!data || typeof data !== 'object') {
            failedTagFetches.add(comicId);
            return;
          }
          const tagSet = new Set();
          extractTagStrings(data.tags, tagSet);
          extractTagStrings(data.categories, tagSet);
          extractTagStrings(data.genre, tagSet);

          upsertComicTags(
            {
              [comicId]: {
                tags: Array.from(tagSet),
                isAdult: Boolean(data.is_adult || data.isAdult)
              }
            },
            true
          );
          scheduleScan();
        })
        .catch(() => {
          failedTagFetches.add(comicId);
        })
        .finally(() => {
          inFlightTagFetches.delete(comicId);
          activeTagFetchCount -= 1;
          processTagFetchQueue();
        });
    }
  }

  function queueMissingTagFetch(comicId) {
    if (!/^\d+$/.test(comicId)) return;
    if (comicTagsMap.has(comicId)) return;
    if (inFlightTagFetches.has(comicId) || failedTagFetches.has(comicId)) return;
    if (pendingTagQueue.includes(comicId)) return;

    pendingTagQueue.push(comicId);
    processTagFetchQueue();
  }

  function ensureTagCatalog(force = false) {
    if (catalogFetchInFlight) return catalogFetchInFlight;

    catalogFetchInFlight = new Promise((resolve) => {
      chrome.storage.local.get(['tagCatalogCache'], (data) => {
        const cache = data?.tagCatalogCache;
        const isFresh =
          cache &&
          Array.isArray(cache.items) &&
          cache.items.length > 0 &&
          typeof cache.updatedAt === 'number' &&
          Date.now() - cache.updatedAt < CATALOG_TTL_MS;

        if (!force && isFresh) {
          tagCatalogItems = cache.items;
          rebuildBlockedTagMatchers();
          resolve(cache.items);
          catalogFetchInFlight = null;
          return;
        }

        fetch(`${location.origin}/api/search/filters`, { credentials: 'same-origin' })
          .then((res) => (res.ok ? res.json() : null))
          .then((json) => {
            const payload = json?.data;
            if (!payload || typeof payload !== 'object') {
              resolve(tagCatalogItems);
              return;
            }

            const items = [];
            const seenKeys = new Set();

            const addGroup = (arr, group) => {
              if (!Array.isArray(arr)) return;
              for (const entry of arr) {
                if (!entry || typeof entry.name !== 'string') continue;
                const name = entry.name.trim();
                const slug = typeof entry.slug === 'string' ? entry.slug.trim() : '';
                const dedupKey = `${group}:${normalizeTagKey(name)}`;
                if (!name || seenKeys.has(dedupKey)) continue;
                seenKeys.add(dedupKey);
                items.push({
                  name,
                  slug,
                  group,
                  count: Number(entry.book_count) || 0
                });
              }
            };

            addGroup(payload.categories, 'category');
            addGroup(payload.tags, 'tag');
            items.sort((a, b) => b.count - a.count);

            tagCatalogItems = items;
            rebuildBlockedTagMatchers();

            chrome.storage.local.set(
              { tagCatalogCache: { updatedAt: Date.now(), items } },
              () => {
                scheduleScan();
                resolve(items);
              }
            );
          })
          .catch(() => {
            resolve(tagCatalogItems);
          })
          .finally(() => {
            catalogFetchInFlight = null;
          });
      });
    });

    return catalogFetchInFlight;
  }

  /**
   * Parse a comic href into canonical id, slug, and clean URL.
   * Only matches root comic pages (/truyen-tranh/<slug>), ignoring chapter URLs.
   */
  function parseComicLink(href) {
    if (!href) return null;
    try {
      const url = new URL(href, location.origin);
      if (url.origin !== location.origin) return null;
      const match = url.pathname.match(COMIC_PATH_RE);
      if (!match) return null;

      const slug = decodeURIComponent(match[1]);
      const idMatch = slug.match(/-(\d+)$/);
      const id = idMatch ? idMatch[1] : slug;

      return {
        id,
        slug,
        url: `${url.origin}/truyen-tranh/${encodeURIComponent(slug)}`
      };
    } catch {
      return null;
    }
  }

  /**
   * Collect all unique canonical comic IDs referenced inside an element.
   */
  function getUniqueComicIds(el) {
    const ids = new Set();
    if (el.tagName === 'A') {
      const parsed = parseComicLink(el.getAttribute('href'));
      if (parsed) ids.add(parsed.id);
    }
    const anchors = el.querySelectorAll('a[href*="/truyen-tranh/"]');
    for (const a of anchors) {
      const parsed = parseComicLink(a.getAttribute('href'));
      if (parsed) ids.add(parsed.id);
    }
    return ids;
  }

  function isLayoutBoundary(el) {
    if (!el || STOP_TAGS.has(el.tagName)) return true;
    return el.classList.contains('grid') || el.classList.contains('swiper-wrapper');
  }

  /**
   * Walk up from a comic anchor to find its single-card container without ever
   * climbing into a multi-card grid or layout wrapper.
   */
  function findCardContainer(anchor, comicId) {
    if (anchor.closest(SKIP_ANCESTOR_SELECTOR)) return null;

    let current = anchor;
    for (let depth = 0; depth < 4; depth++) {
      if (
        current.classList.contains('group') ||
        current.tagName === 'ARTICLE' ||
        current.tagName === 'LI'
      ) {
        break;
      }

      const parent = current.parentElement;
      if (!parent || isLayoutBoundary(parent)) break;

      const idsInParent = getUniqueComicIds(parent);
      if (idsInParent.size > 1 || (idsInParent.size === 1 && !idsInParent.has(comicId))) {
        break;
      }

      current = parent;
    }

    if (!current || current.classList.contains('animate-pulse')) {
      return null;
    }

    const looksLikeCard =
      current.classList.contains('group') || current.querySelector('img') !== null;

    return looksLikeCard ? current : null;
  }

  function prettifySlug(slug) {
    return slug
      .replace(/-\d+$/, '')
      .replace(/-/g, ' ')
      .trim();
  }

  /**
   * Extract live title, cover, R18 flag, and bookmark presence directly from card DOM.
   */
  function extractCardMeta(card, parsed) {
    const titleLink = card.querySelector('a[title]');
    const img = card.querySelector('img');
    const heading = card.querySelector('h3 .truncate, h3 span:last-child, h3, h4, h2');

    const title =
      titleLink?.getAttribute('title')?.trim() ||
      img?.getAttribute('alt')?.trim() ||
      heading?.textContent?.trim() ||
      prettifySlug(parsed.slug);

    const cover = img?.currentSrc || img?.getAttribute('src') || '';

    let isR18 = false;
    const spans = card.querySelectorAll('span');
    for (const span of spans) {
      const text = span.textContent?.trim();
      if (text && R18_BADGE_RE.test(text)) {
        isR18 = true;
        break;
      }
    }

    const hasBookmark = Boolean(
      card.querySelector('button[title*="Theo dõi"], button[aria-label*="Theo dõi"]')
    );

    return {
      id: parsed.id,
      slug: parsed.slug,
      url: parsed.url,
      title,
      cover,
      isR18,
      hasBookmark
    };
  }

  function isManuallyHidden(meta) {
    if (state.hiddenComics && state.hiddenComics[meta.id]) {
      return true;
    }
    if (!state.hiddenComics) return false;
    return Object.values(state.hiddenComics).some((entry) => entry && entry.slug === meta.slug);
  }

  function findMatchingTagLabel(comicId) {
    if (blockedTagMatchers.size === 0) return null;
    const cached = comicTagsMap.get(comicId);
    if (!cached || !cached.normSet || cached.normSet.size === 0) return null;

    for (const normTag of cached.normSet) {
      if (blockedTagMatchers.has(normTag)) {
        return blockedTagMatchers.get(normTag);
      }
    }
    return null;
  }

  function findMatchingKeyword(title) {
    if (!Array.isArray(state.blockedKeywords) || state.blockedKeywords.length === 0) {
      return null;
    }
    const lowerTitle = (title || '').toLowerCase();
    for (const kw of state.blockedKeywords) {
      const trimmed = typeof kw === 'string' ? kw.trim().toLowerCase() : '';
      if (trimmed && lowerTitle.includes(trimmed)) {
        return kw.trim();
      }
    }
    return null;
  }

  function evaluateHideReason(meta) {
    if (!state.enabled) return null;

    if (isManuallyHidden(meta)) {
      return { type: 'manual', label: 'Truyện nằm trong danh sách ẩn' };
    }

    const cached = comicTagsMap.get(meta.id);
    if (state.hideR18 && (meta.isR18 || cached?.isAdult)) {
      return { type: 'r18', label: 'Đang ẩn bởi bộ lọc 18+ (R.18)' };
    }

    const matchedTag = findMatchingTagLabel(meta.id);
    if (matchedTag) {
      return { type: 'tag', label: `Đang ẩn bởi tag "${matchedTag}"` };
    }

    const matchedKw = findMatchingKeyword(meta.title);
    if (matchedKw) {
      return { type: 'keyword', label: `Đang ẩn bởi từ khóa "${matchedKw}"` };
    }

    return null;
  }

  function getDirectHideButton(card) {
    for (const child of card.children) {
      if (child.classList && child.classList.contains('dmd-hide-btn')) {
        return child;
      }
    }
    return null;
  }

  function ensureCardPositioning(card) {
    card.classList.add('dmd-card-tracked');
    if (getComputedStyle(card).position === 'static') {
      card.classList.add('dmd-pos-relative');
    }
  }

  function stopCardNavigation(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  function syncCardButton(card, meta, hideReason) {
    const isDimmed = Boolean(hideReason) && state.dimInsteadOfHide;
    const shouldShowBtn = state.showCardButton || isDimmed;
    let btn = getDirectHideButton(card);

    if (!shouldShowBtn) {
      if (btn) btn.remove();
      return;
    }

    ensureCardPositioning(card);
    card.classList.toggle('dmd-has-bookmark', meta.hasBookmark);

    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dmd-hide-btn';
      btn.addEventListener('pointerdown', stopCardNavigation);
      btn.addEventListener('mousedown', stopCardNavigation);
      btn.addEventListener('click', (e) => {
        stopCardNavigation(e);
        const currentMeta = card._dmdMeta;
        if (!currentMeta) return;
        handleCardButtonClick(currentMeta);
      });
      card.appendChild(btn);
    }

    const manuallyHidden = isManuallyHidden(meta);
    btn.classList.toggle('dmd-is-unhide', manuallyHidden && isDimmed);
    btn.classList.toggle('dmd-is-filter-dimmed', !manuallyHidden && isDimmed);

    if (manuallyHidden && isDimmed) {
      btn.innerHTML = EYE_ON_SVG;
      btn.title = 'Hiện lại truyện này';
      btn.setAttribute('aria-label', 'Hiện lại truyện này');
    } else if (isDimmed && hideReason) {
      btn.innerHTML = EYE_OFF_SVG;
      btn.title = `${hideReason.label}. Bấm để thêm vào danh sách ẩn cố định`;
      btn.setAttribute('aria-label', btn.title);
    } else {
      btn.innerHTML = EYE_OFF_SVG;
      btn.title = 'Ẩn truyện này';
      btn.setAttribute('aria-label', 'Ẩn truyện này');
    }
  }

  function removeHiddenEntry(meta, callback) {
    chrome.storage.local.get(['hiddenComics'], (data) => {
      const hiddenComics = { ...(data.hiddenComics || {}) };
      delete hiddenComics[meta.id];
      for (const [key, entry] of Object.entries(hiddenComics)) {
        if (entry && entry.slug === meta.slug) {
          delete hiddenComics[key];
        }
      }
      chrome.storage.local.set({ hiddenComics }, () => {
        if (typeof callback === 'function') callback();
      });
    });
  }

  function addHiddenEntry(meta, callback) {
    chrome.storage.local.get(['hiddenComics'], (data) => {
      const hiddenComics = { ...(data.hiddenComics || {}) };
      hiddenComics[meta.id] = {
        id: meta.id,
        slug: meta.slug,
        title: meta.title,
        url: meta.url,
        cover: meta.cover,
        hiddenAt: Date.now()
      };
      chrome.storage.local.set({ hiddenComics }, () => {
        if (typeof callback === 'function') callback();
      });
    });
  }

  function handleCardButtonClick(meta) {
    if (isManuallyHidden(meta)) {
      removeHiddenEntry(meta, () => {
        showToast(`Đã bỏ ẩn "${meta.title}"`);
      });
      return;
    }

    addHiddenEntry(meta, () => {
      showToast(`Đã ẩn "${meta.title}"`, () => {
        removeHiddenEntry(meta);
      });
    });
  }

  function ensureToastContainer() {
    if (toastContainer && document.body.contains(toastContainer)) {
      return toastContainer;
    }
    toastContainer = document.createElement('div');
    toastContainer.className = 'dmd-toast-container';
    document.body.appendChild(toastContainer);
    return toastContainer;
  }

  function showToast(message, onUndo) {
    if (!document.body) return;
    const container = ensureToastContainer();
    container.textContent = '';

    if (activeToastTimer) {
      clearTimeout(activeToastTimer);
      activeToastTimer = null;
    }

    const toast = document.createElement('div');
    toast.className = 'dmd-toast';

    const textSpan = document.createElement('span');
    textSpan.className = 'dmd-toast-text';
    textSpan.textContent = message;
    toast.appendChild(textSpan);

    if (typeof onUndo === 'function') {
      const undoBtn = document.createElement('button');
      undoBtn.type = 'button';
      undoBtn.className = 'dmd-toast-undo';
      undoBtn.textContent = 'Hoàn tác';
      undoBtn.addEventListener('click', () => {
        if (activeToastTimer) clearTimeout(activeToastTimer);
        toast.remove();
        onUndo();
      });
      toast.appendChild(undoBtn);
    }

    container.appendChild(toast);

    activeToastTimer = setTimeout(() => {
      toast.remove();
      activeToastTimer = null;
    }, 5000);
  }

  function reportBadgeCount(count) {
    if (count === lastHiddenCount) return;
    lastHiddenCount = count;
    try {
      chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', count }, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      // Ignore transient errors if extension context reloaded.
    }
  }

  /**
   * Scan all comic cards on the page, re-reading fresh DOM metadata every pass
   * to stay compatible with React SPA reuse and pagination.
   */
  function scanPage() {
    scanScheduled = false;
    if (!document.body) return;

    extractTagsFromSSRScripts();

    const shouldFetchMissingTags = state.enabled && blockedTagMatchers.size > 0;
    const processedCards = new Set();
    let hiddenCount = 0;

    const anchors = document.querySelectorAll('a[href*="/truyen-tranh/"]');
    for (const anchor of anchors) {
      const parsed = parseComicLink(anchor.getAttribute('href'));
      if (!parsed) continue;

      const card = findCardContainer(anchor, parsed.id);
      if (!card || processedCards.has(card)) continue;

      processedCards.add(card);

      const meta = extractCardMeta(card, parsed);
      card._dmdMeta = meta;

      if (shouldFetchMissingTags && !comicTagsMap.has(meta.id)) {
        queueMissingTagFetch(meta.id);
      }

      const hideReason = evaluateHideReason(meta);
      if (hideReason) {
        card.setAttribute('data-dmd-hidden', state.dimInsteadOfHide ? 'dim' : 'hide');
        hiddenCount += 1;
      } else {
        card.removeAttribute('data-dmd-hidden');
      }

      syncCardButton(card, meta, hideReason);
    }

    // Clean up stale attributes if React replaced a card's contents with non-card markup.
    const previouslyHidden = document.querySelectorAll('[data-dmd-hidden]');
    for (const el of previouslyHidden) {
      if (!processedCards.has(el)) {
        el.removeAttribute('data-dmd-hidden');
        delete el._dmdMeta;
        const staleBtn = getDirectHideButton(el);
        if (staleBtn) staleBtn.remove();
      }
    }

    lastTotalCards = processedCards.size;
    reportBadgeCount(hiddenCount);
  }

  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(scanPage);
  }

  function isExtensionNode(node) {
    if (!(node instanceof Element)) return false;
    return (
      node.classList.contains('dmd-hide-btn') ||
      node.classList.contains('dmd-toast-container') ||
      Boolean(node.closest('.dmd-toast-container'))
    );
  }

  function handleMutations(mutations) {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        if (mutation.attributeName && mutation.attributeName.startsWith('data-dmd-')) {
          continue;
        }
        scheduleScan();
        return;
      }

      const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
      if (changedNodes.some((node) => !isExtensionNode(node))) {
        scheduleScan();
        return;
      }
    }
  }

  function loadStateAndScan() {
    const keys = [...Object.keys(DEFAULT_STATE), 'comicTagsCache', 'tagCatalogCache'];
    chrome.storage.local.get(keys, (data) => {
      state = {
        ...DEFAULT_STATE,
        ...data,
        hiddenComics: data.hiddenComics || {},
        blockedTags: Array.isArray(data.blockedTags) ? data.blockedTags : [],
        blockedKeywords: Array.isArray(data.blockedKeywords) ? data.blockedKeywords : []
      };

      if (data.tagCatalogCache && Array.isArray(data.tagCatalogCache.items)) {
        tagCatalogItems = data.tagCatalogCache.items;
      }

      if (data.comicTagsCache && typeof data.comicTagsCache === 'object') {
        const now = Date.now();
        const validCache = {};
        for (const [id, entry] of Object.entries(data.comicTagsCache)) {
          if (entry && now - (Number(entry.ts) || 0) < COMIC_TAGS_TTL_MS) {
            validCache[id] = entry;
          }
        }
        upsertComicTags(validCache, false);
      }

      rebuildBlockedTagMatchers();
      scanPage();
      ensureTagCatalog(false);
    });
  }

  function init() {
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      const msg = event.data;
      if (!msg || msg.source !== 'dmd-hider-hook' || msg.type !== 'COMIC_TAGS_BATCH') {
        return;
      }
      if (upsertComicTags(msg.items, true)) {
        scheduleScan();
      }
    });

    try {
      window.postMessage(
        { source: 'dmd-hider-content', type: 'REQUEST_CAPTURED_TAGS' },
        window.location.origin
      );
    } catch {
      // Ignore postMessage errors.
    }

    loadStateAndScan();

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      let shouldRescan = false;

      for (const [key, change] of Object.entries(changes)) {
        if (key in DEFAULT_STATE) {
          state[key] = change.newValue !== undefined ? change.newValue : DEFAULT_STATE[key];
          shouldRescan = true;
        } else if (key === 'tagCatalogCache') {
          tagCatalogItems = Array.isArray(change.newValue?.items) ? change.newValue.items : [];
          shouldRescan = true;
        }
      }

      if (shouldRescan) {
        rebuildBlockedTagMatchers();
        scheduleScan();
      }
    });

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === 'GET_PAGE_STATS') {
        sendResponse({
          hiddenCount: Math.max(0, lastHiddenCount),
          totalCards: lastTotalCards
        });
        return;
      }

      if (msg?.type === 'REFRESH_TAG_CATALOG') {
        ensureTagCatalog(true).then((items) => {
          sendResponse({ ok: true, count: items.length });
        });
        return true;
      }
    });

    const observer = new MutationObserver(handleMutations);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href']
    });
  }

  init();
})();
