(() => {
  'use strict';

  if (window.__dmdHiderHooked) return;
  window.__dmdHiderHooked = true;

  const MAX_DEPTH = 6;
  const capturedMap = new Map();

  function extractTagValues(list, outSet) {
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

  function isComicCandidate(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
    if (obj.book_count !== undefined) return false;

    const validId =
      (typeof obj.id === 'number' && Number.isFinite(obj.id)) ||
      (typeof obj.id === 'string' && /^\d+$/.test(obj.id));
    if (!validId) return false;

    const hasTagArray =
      Array.isArray(obj.tags) ||
      Array.isArray(obj.categories) ||
      Array.isArray(obj.genre);
    if (!hasTagArray) return false;

    return Boolean(obj.title || obj.name || obj.slug || obj.url);
  }

  function extractComicsFromPayload(payload) {
    const results = {};
    const seen = new WeakSet();

    function walk(node, depth) {
      if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return;
      if (seen.has(node)) return;
      seen.add(node);

      if (Array.isArray(node)) {
        for (const item of node) {
          walk(item, depth + 1);
        }
        return;
      }

      if (isComicCandidate(node)) {
        const id = String(node.id);
        const tagSet = new Set(results[id]?.tags || []);
        extractTagValues(node.tags, tagSet);
        extractTagValues(node.categories, tagSet);
        extractTagValues(node.genre, tagSet);

        const isAdult = Boolean(results[id]?.isAdult || node.is_adult || node.isAdult);
        results[id] = {
          tags: Array.from(tagSet),
          isAdult
        };
      }

      for (const value of Object.values(node)) {
        if (value && typeof value === 'object') {
          walk(value, depth + 1);
        }
      }
    }

    walk(payload, 0);
    return results;
  }

  function mergeAndPublish(items) {
    const keys = Object.keys(items);
    if (keys.length === 0) return;

    const batch = {};
    for (const id of keys) {
      const incoming = items[id];
      const existing = capturedMap.get(id);
      const mergedTags = Array.from(
        new Set([...(existing?.tags || []), ...(incoming.tags || [])])
      );
      const merged = {
        tags: mergedTags,
        isAdult: Boolean(existing?.isAdult || incoming.isAdult)
      };
      capturedMap.set(id, merged);
      batch[id] = merged;
    }

    try {
      window.postMessage(
        { source: 'dmd-hider-hook', type: 'COMIC_TAGS_BATCH', items: batch },
        window.location.origin
      );
    } catch {
      // Ignore postMessage errors on restricted contexts.
    }
  }

  function getApiPathname(input) {
    try {
      const rawUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input && typeof input.url === 'string'
              ? input.url
              : '';
      if (!rawUrl) return null;
      const parsed = new URL(rawUrl, window.location.origin);
      if (parsed.origin !== window.location.origin) return null;
      if (!parsed.pathname.startsWith('/api/')) return null;
      return parsed.pathname;
    } catch {
      return null;
    }
  }

  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = function wrappedFetch(...args) {
      const fetchPromise = originalFetch.apply(this, args);
      const apiPath = getApiPathname(args[0]);

      if (apiPath) {
        fetchPromise.then(
          (res) => {
            try {
              if (!res || !res.ok) return;
              const ct = (res.headers?.get('content-type') || '').toLowerCase();
              if (!ct.includes('application/json')) return;

              res
                .clone()
                .json()
                .then((payload) => {
                  const extracted = extractComicsFromPayload(payload);
                  mergeAndPublish(extracted);
                })
                .catch(() => {});
            } catch {
              // Never interfere with the page's own fetch resolution.
            }
          },
          () => {}
        );
      }

      return fetchPromise;
    };
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (
      !data ||
      data.source !== 'dmd-hider-content' ||
      data.type !== 'REQUEST_CAPTURED_TAGS'
    ) {
      return;
    }

    if (capturedMap.size === 0) return;
    const items = {};
    for (const [id, entry] of capturedMap.entries()) {
      items[id] = entry;
    }
    try {
      window.postMessage(
        { source: 'dmd-hider-hook', type: 'COMIC_TAGS_BATCH', items },
        window.location.origin
      );
    } catch {
      // Ignore postMessage errors.
    }
  });
})();
