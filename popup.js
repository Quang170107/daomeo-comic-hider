const DEFAULT_STATE = {
  enabled: true,
  hideR18: false,
  dimInsteadOfHide: false,
  showCardButton: true,
  hiddenComics: {},
  blockedTags: [],
  blockedKeywords: []
};

const FALLBACK_TAG_CATALOG = [
  { name: "Boys' Love", slug: 'boylove', group: 'category' },
  { name: "Girl's Love", slug: 'girllove', group: 'category' },
  { name: 'Ngôn Tình', slug: 'ngon-tinh', group: 'tag' },
  { name: 'Smut', slug: 'smut', group: 'tag' },
  { name: 'Adult', slug: 'adult', group: 'tag' },
  { name: 'Hentai', slug: 'hentai', group: 'category' },
  { name: 'Ecchi', slug: 'ecchi', group: 'category' },
  { name: 'Đam Mỹ', slug: 'dam-my', group: 'tag' },
  { name: '18+', slug: '18', group: 'tag' },
  { name: 'Tình Cảm', slug: 'tinh-cam', group: 'tag' },
  { name: 'Lãng mạn', slug: 'lang-man', group: 'tag' },
  { name: 'Hài Hước', slug: 'hai-huoc', group: 'tag' },
  { name: 'Harem', slug: 'harem', group: 'tag' },
  { name: 'NTR', slug: 'ntr', group: 'tag' },
  { name: 'Manhua', slug: 'manhua', group: 'category' },
  { name: 'Manhwa', slug: 'manhwa', group: 'category' },
  { name: 'Manga', slug: 'manga', group: 'category' },
  { name: 'Trung Quốc', slug: 'trung-quoc', group: 'tag' },
  { name: 'Hàn Quốc', slug: 'han-quoc', group: 'tag' },
  { name: 'Nhật Bản', slug: 'nhat-ban', group: 'tag' },
  { name: 'Xuyên Không', slug: 'xuyen-khong', group: 'tag' },
  { name: 'Trọng Sinh', slug: 'trong-sinh', group: 'tag' },
  { name: 'Cổ Đại', slug: 'co-dai', group: 'tag' },
  { name: 'Isekai', slug: 'isekai', group: 'category' },
  { name: 'Horror', slug: 'horror', group: 'category' }
];

let state = { ...DEFAULT_STATE };
let tagCatalogItems = [];
let catalogIsOfficial = false;
let catalogRequestedThisSession = false;
let pageStats = null;
let clearConfirmTimer = null;
let isConfirmingClear = false;
let feedbackTimer = null;

const el = {
  toggleEnabled: document.getElementById('toggle-enabled'),
  toggleR18: document.getElementById('toggle-r18'),
  toggleDim: document.getElementById('toggle-dim'),
  toggleBtn: document.getElementById('toggle-btn'),
  statusPill: document.getElementById('status-pill'),
  comicsCount: document.getElementById('comics-count'),
  tagsCount: document.getElementById('tags-count'),
  keywordsCount: document.getElementById('keywords-count'),
  tabs: document.querySelectorAll('.tab'),
  panelComics: document.getElementById('panel-comics'),
  panelTags: document.getElementById('panel-tags'),
  panelKeywords: document.getElementById('panel-keywords'),
  searchComics: document.getElementById('search-comics'),
  comicsList: document.getElementById('comics-list'),
  tagForm: document.getElementById('tag-form'),
  tagInput: document.getElementById('tag-input'),
  blockedTagsList: document.getElementById('blocked-tags-list'),
  tagSuggestionsList: document.getElementById('tag-suggestions-list'),
  tagCatalogSource: document.getElementById('tag-catalog-source'),
  keywordForm: document.getElementById('keyword-form'),
  keywordInput: document.getElementById('keyword-input'),
  keywordsList: document.getElementById('keywords-list'),
  btnExport: document.getElementById('btn-export'),
  btnImport: document.getElementById('btn-import'),
  importFile: document.getElementById('import-file'),
  btnClearAll: document.getElementById('btn-clear-all'),
  feedbackBar: document.getElementById('feedback-bar')
};

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

function showFeedback(message, isError = false) {
  if (feedbackTimer) clearTimeout(feedbackTimer);
  el.feedbackBar.textContent = message;
  el.feedbackBar.classList.toggle('is-error', isError);
  el.feedbackBar.classList.remove('hidden');

  feedbackTimer = setTimeout(() => {
    el.feedbackBar.classList.add('hidden');
  }, 3200);
}

function isSafeHttpUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function formatRelativeDate(ts) {
  if (!ts) return '';
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('vi-VN');
}

function renderHeaderAndToggles() {
  el.toggleEnabled.checked = Boolean(state.enabled);
  el.toggleR18.checked = Boolean(state.hideR18);
  el.toggleDim.checked = Boolean(state.dimInsteadOfHide);
  el.toggleBtn.checked = Boolean(state.showCardButton);

  const totalSaved = Object.keys(state.hiddenComics || {}).length;
  el.comicsCount.textContent = String(totalSaved);
  el.tagsCount.textContent = String((state.blockedTags || []).length);
  el.keywordsCount.textContent = String((state.blockedKeywords || []).length);

  if (!state.enabled) {
    el.statusPill.textContent = 'Đang tạm tắt bộ lọc';
    el.statusPill.classList.add('is-disabled');
  } else if (pageStats && typeof pageStats.hiddenCount === 'number') {
    el.statusPill.textContent = `Đang ẩn ${pageStats.hiddenCount} truyện trên trang này`;
    el.statusPill.classList.remove('is-disabled');
  } else {
    el.statusPill.textContent = `Tổng cộng ${totalSaved} truyện đã ẩn`;
    el.statusPill.classList.remove('is-disabled');
  }

  el.btnClearAll.disabled = totalSaved === 0;
  if (totalSaved === 0) {
    resetClearConfirm();
  }
}

function createComicCover(entry) {
  if (isSafeHttpUrl(entry.cover)) {
    const img = document.createElement('img');
    img.className = 'comic-cover';
    img.src = entry.cover;
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => {
      const fallback = document.createElement('div');
      fallback.className = 'comic-cover-fallback';
      fallback.textContent = 'N/A';
      img.replaceWith(fallback);
    });
    return img;
  }

  const fallback = document.createElement('div');
  fallback.className = 'comic-cover-fallback';
  fallback.textContent = 'N/A';
  return fallback;
}

function renderComicsList() {
  const query = el.searchComics.value.trim().toLowerCase();
  const entries = Object.values(state.hiddenComics || {})
    .filter(Boolean)
    .sort((a, b) => (b.hiddenAt || 0) - (a.hiddenAt || 0));

  const filtered = query
    ? entries.filter((item) => (item.title || '').toLowerCase().includes(query))
    : entries;

  el.comicsList.textContent = '';

  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const strong = document.createElement('strong');
    strong.textContent = 'Chưa có truyện nào bị ẩn thủ công.';
    empty.appendChild(strong);
    empty.appendChild(document.createElement('br'));
    empty.appendChild(
      document.createTextNode(
        'Di chuột lên ô truyện bất kỳ trên daomeoden.net và bấm biểu tượng con mắt ở góc trên để ẩn.'
      )
    );
    el.comicsList.appendChild(empty);
    return;
  }

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Không tìm thấy truyện khớp với từ khóa tìm kiếm.';
    el.comicsList.appendChild(empty);
    return;
  }

  for (const entry of filtered) {
    const row = document.createElement('div');
    row.className = 'comic-item';

    row.appendChild(createComicCover(entry));

    const info = document.createElement('div');
    info.className = 'comic-info';

    const titleText = entry.title || entry.slug || entry.id;
    if (isSafeHttpUrl(entry.url)) {
      const link = document.createElement('a');
      link.className = 'comic-title';
      link.href = entry.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.title = titleText;
      link.textContent = titleText;
      info.appendChild(link);
    } else {
      const span = document.createElement('span');
      span.className = 'comic-title';
      span.title = titleText;
      span.textContent = titleText;
      info.appendChild(span);
    }

    const meta = document.createElement('div');
    meta.className = 'comic-meta';
    const dateStr = formatRelativeDate(entry.hiddenAt);
    meta.textContent = dateStr ? `Đã ẩn ngày ${dateStr}` : 'Đã ẩn';
    info.appendChild(meta);

    row.appendChild(info);

    const unhideBtn = document.createElement('button');
    unhideBtn.type = 'button';
    unhideBtn.className = 'btn-unhide';
    unhideBtn.textContent = 'Bỏ ẩn';
    unhideBtn.addEventListener('click', () => removeComic(entry.id));
    row.appendChild(unhideBtn);

    el.comicsList.appendChild(row);
  }
}

function getBlockedTagKeySet() {
  const keys = new Set();
  for (const tag of state.blockedTags || []) {
    const nk = normalizeTagKey(tag);
    if (nk) keys.add(nk);
  }
  return keys;
}

function isCatalogItemBlocked(item, blockedKeys) {
  const nameKey = normalizeTagKey(item.name);
  const slugKey = normalizeTagKey(item.slug);
  return (nameKey && blockedKeys.has(nameKey)) || (slugKey && blockedKeys.has(slugKey));
}

function renderTagsPanel() {
  const blocked = Array.isArray(state.blockedTags) ? state.blockedTags : [];
  el.blockedTagsList.textContent = '';

  if (blocked.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'tag-empty-inline';
    empty.textContent = 'Chưa chọn tag nào. Bấm các tag gợi ý bên dưới hoặc nhập ở trên.';
    el.blockedTagsList.appendChild(empty);
  } else {
    for (const tag of blocked) {
      const chip = document.createElement('span');
      chip.className = 'tag-chip-blocked';

      const label = document.createElement('span');
      label.textContent = tag;
      chip.appendChild(label);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'keyword-remove';
      removeBtn.textContent = '×';
      removeBtn.title = `Bỏ chặn tag "${tag}"`;
      removeBtn.setAttribute('aria-label', removeBtn.title);
      removeBtn.addEventListener('click', () => removeBlockedTag(tag));
      chip.appendChild(removeBtn);

      el.blockedTagsList.appendChild(chip);
    }
  }

  const sourceList = tagCatalogItems.length > 0 ? tagCatalogItems : FALLBACK_TAG_CATALOG;
  el.tagCatalogSource.textContent = catalogIsOfficial
    ? `${sourceList.length} tag`
    : 'Phổ biến';

  const queryKey = normalizeTagKey(el.tagInput.value);
  const filtered = queryKey
    ? sourceList.filter(
        (item) =>
          normalizeTagKey(item.name).includes(queryKey) ||
          normalizeTagKey(item.slug).includes(queryKey)
      )
    : sourceList;

  const visibleSuggestions = filtered.slice(0, 30);
  const blockedKeys = getBlockedTagKeySet();

  el.tagSuggestionsList.textContent = '';

  if (visibleSuggestions.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'tag-empty-inline';
    empty.textContent = 'Không có tag gợi ý khớp — bấm "Thêm" để chặn tag bạn vừa nhập.';
    el.tagSuggestionsList.appendChild(empty);
    return;
  }

  for (const item of visibleSuggestions) {
    const active = isCatalogItemBlocked(item, blockedKeys);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tag-suggestion-chip' + (active ? ' is-active' : '');
    btn.textContent = active ? `✓ ${item.name}` : `+ ${item.name}`;
    btn.title = active ? `Bỏ chặn tag "${item.name}"` : `Chặn tag "${item.name}"`;
    btn.addEventListener('click', () => toggleCatalogTag(item));
    el.tagSuggestionsList.appendChild(btn);
  }
}

function renderKeywordsList() {
  const keywords = Array.isArray(state.blockedKeywords) ? state.blockedKeywords : [];
  el.keywordsList.textContent = '';

  if (keywords.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Chưa có từ khóa nào. Thêm từ khóa ở ô phía trên để tự động lọc theo tên truyện.';
    el.keywordsList.appendChild(empty);
    return;
  }

  for (const kw of keywords) {
    const chip = document.createElement('span');
    chip.className = 'keyword-chip';

    const label = document.createElement('span');
    label.textContent = kw;
    chip.appendChild(label);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'keyword-remove';
    removeBtn.textContent = '×';
    removeBtn.title = `Xóa từ khóa "${kw}"`;
    removeBtn.setAttribute('aria-label', removeBtn.title);
    removeBtn.addEventListener('click', () => removeKeyword(kw));
    chip.appendChild(removeBtn);

    el.keywordsList.appendChild(chip);
  }
}

function renderAll() {
  renderHeaderAndToggles();
  renderComicsList();
  renderTagsPanel();
  renderKeywordsList();
}

function updateStorage(patch) {
  state = { ...state, ...patch };
  chrome.storage.local.set(patch, () => {
    refreshActiveTabStats();
  });
  renderAll();
}

function removeComic(comicId) {
  const updated = { ...(state.hiddenComics || {}) };
  delete updated[comicId];
  updateStorage({ hiddenComics: updated });
}

function resolveCanonicalTagName(rawInput) {
  const trimmed = rawInput.trim();
  const inputKey = normalizeTagKey(trimmed);
  if (!inputKey) return null;

  const catalog = tagCatalogItems.length > 0 ? tagCatalogItems : FALLBACK_TAG_CATALOG;
  for (const item of catalog) {
    if (normalizeTagKey(item.name) === inputKey || normalizeTagKey(item.slug) === inputKey) {
      return item.name;
    }
  }
  return trimmed;
}

function addBlockedTags(rawText) {
  const parts = rawText
    .split(',')
    .map((s) => resolveCanonicalTagName(s))
    .filter(Boolean);

  if (parts.length === 0) return;

  const existingKeys = getBlockedTagKeySet();
  const next = [...(state.blockedTags || [])];
  let addedCount = 0;

  for (const label of parts) {
    const key = normalizeTagKey(label);
    if (key && !existingKeys.has(key)) {
      existingKeys.add(key);
      next.push(label);
      addedCount += 1;
    }
  }

  if (addedCount > 0) {
    updateStorage({ blockedTags: next });
    showFeedback(`Đã chặn ${addedCount} tag.`);
  } else {
    showFeedback('Tag đã có trong danh sách chặn.', true);
  }
}

function removeBlockedTag(tagLabel) {
  const targetKey = normalizeTagKey(tagLabel);
  const next = (state.blockedTags || []).filter((t) => normalizeTagKey(t) !== targetKey);
  updateStorage({ blockedTags: next });
}

function toggleCatalogTag(item) {
  const nameKey = normalizeTagKey(item.name);
  const slugKey = normalizeTagKey(item.slug);
  const current = Array.isArray(state.blockedTags) ? state.blockedTags : [];
  const exists = current.some((t) => {
    const k = normalizeTagKey(t);
    return k === nameKey || (slugKey && k === slugKey);
  });

  if (exists) {
    const next = current.filter((t) => {
      const k = normalizeTagKey(t);
      return k !== nameKey && (!slugKey || k !== slugKey);
    });
    updateStorage({ blockedTags: next });
  } else {
    updateStorage({ blockedTags: [...current, item.name] });
  }
}

function addKeywords(rawText) {
  const parts = rawText
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (parts.length === 0) return;

  const existingSet = new Set((state.blockedKeywords || []).map((k) => k.toLowerCase()));
  const next = [...(state.blockedKeywords || [])];
  let addedCount = 0;

  for (const part of parts) {
    if (!existingSet.has(part)) {
      existingSet.add(part);
      next.push(part);
      addedCount += 1;
    }
  }

  if (addedCount > 0) {
    updateStorage({ blockedKeywords: next });
    showFeedback(`Đã thêm ${addedCount} từ khóa.`);
  } else {
    showFeedback('Từ khóa đã tồn tại.', true);
  }
}

function removeKeyword(keyword) {
  const next = (state.blockedKeywords || []).filter((k) => k !== keyword);
  updateStorage({ blockedKeywords: next });
}

function resetClearConfirm() {
  isConfirmingClear = false;
  if (clearConfirmTimer) {
    clearTimeout(clearConfirmTimer);
    clearConfirmTimer = null;
  }
  el.btnClearAll.textContent = 'Xóa hết truyện đã ẩn';
  el.btnClearAll.classList.remove('is-confirming');
}

function handleClearAllClick() {
  if (!isConfirmingClear) {
    isConfirmingClear = true;
    el.btnClearAll.textContent = 'Bấm lại để xác nhận';
    el.btnClearAll.classList.add('is-confirming');
    clearConfirmTimer = setTimeout(resetClearConfirm, 3500);
    return;
  }

  resetClearConfirm();
  updateStorage({ hiddenComics: {} });
  showFeedback('Đã xóa toàn bộ danh sách truyện đã ẩn.');
}

function exportBackup() {
  const payload = {
    version: 2,
    exportedAt: new Date().toISOString(),
    hiddenComics: state.hiddenComics || {},
    blockedTags: state.blockedTags || [],
    blockedKeywords: state.blockedKeywords || []
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'daomeo-hidden-backup.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showFeedback('Đã xuất file sao lưu JSON.');
}

function importBackup(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result || '{}'));
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid JSON object');
      }

      const incomingComics =
        parsed.hiddenComics && typeof parsed.hiddenComics === 'object' && !Array.isArray(parsed.hiddenComics)
          ? parsed.hiddenComics
          : null;
      const incomingTags = Array.isArray(parsed.blockedTags) ? parsed.blockedTags : null;
      const incomingKeywords = Array.isArray(parsed.blockedKeywords) ? parsed.blockedKeywords : null;

      if (!incomingComics && !incomingTags && !incomingKeywords) {
        throw new Error('Missing hiddenComics, blockedTags, or blockedKeywords');
      }

      const mergedComics = { ...(state.hiddenComics || {}) };
      let addedComics = 0;
      if (incomingComics) {
        for (const [id, entry] of Object.entries(incomingComics)) {
          if (!entry || typeof entry !== 'object') continue;
          const key = String(entry.id || id).trim();
          if (!key) continue;
          if (!mergedComics[key]) addedComics += 1;
          mergedComics[key] = {
            id: key,
            slug: String(entry.slug || key),
            title: String(entry.title || entry.slug || key),
            url: isSafeHttpUrl(entry.url) ? entry.url : '',
            cover: isSafeHttpUrl(entry.cover) ? entry.cover : '',
            hiddenAt: Number(entry.hiddenAt) || Date.now()
          };
        }
      }

      const tagKeys = getBlockedTagKeySet();
      const mergedTags = [...(state.blockedTags || [])];
      let addedTags = 0;
      if (incomingTags) {
        for (const rawTag of incomingTags) {
          if (typeof rawTag !== 'string') continue;
          const label = resolveCanonicalTagName(rawTag);
          const key = normalizeTagKey(label);
          if (label && key && !tagKeys.has(key)) {
            tagKeys.add(key);
            mergedTags.push(label);
            addedTags += 1;
          }
        }
      }

      const kwSet = new Set((state.blockedKeywords || []).map((k) => String(k).toLowerCase()));
      const mergedKeywords = [...(state.blockedKeywords || [])];
      let addedKeywords = 0;
      if (incomingKeywords) {
        for (const rawKw of incomingKeywords) {
          const kw = typeof rawKw === 'string' ? rawKw.trim().toLowerCase() : '';
          if (kw && !kwSet.has(kw)) {
            kwSet.add(kw);
            mergedKeywords.push(kw);
            addedKeywords += 1;
          }
        }
      }

      updateStorage({
        hiddenComics: mergedComics,
        blockedTags: mergedTags,
        blockedKeywords: mergedKeywords
      });
      showFeedback(`Đã nhập +${addedComics} truyện, +${addedTags} tag, +${addedKeywords} từ khóa.`);
    } catch {
      showFeedback('File JSON không hợp lệ.', true);
    } finally {
      el.importFile.value = '';
    }
  };
  reader.readAsText(file);
}

function requestTagCatalogIfNeeded() {
  if (catalogIsOfficial || catalogRequestedThisSession) return;
  catalogRequestedThisSession = true;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs && tabs[0];
    if (!activeTab?.id) return;
    try {
      chrome.tabs.sendMessage(activeTab.id, { type: 'REFRESH_TAG_CATALOG' }, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      // Active tab is not a DaoMeo page.
    }
  });
}

function refreshActiveTabStats() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs && tabs[0];
    if (!activeTab?.id) return;

    setTimeout(() => {
      try {
        chrome.tabs.sendMessage(activeTab.id, { type: 'GET_PAGE_STATS' }, (response) => {
          if (chrome.runtime.lastError || !response) {
            pageStats = null;
          } else {
            pageStats = response;
          }
          renderHeaderAndToggles();
        });
      } catch {
        pageStats = null;
      }
    }, 80);
  });
}

function bindEvents() {
  el.toggleEnabled.addEventListener('change', () =>
    updateStorage({ enabled: el.toggleEnabled.checked })
  );
  el.toggleR18.addEventListener('change', () =>
    updateStorage({ hideR18: el.toggleR18.checked })
  );
  el.toggleDim.addEventListener('change', () =>
    updateStorage({ dimInsteadOfHide: el.toggleDim.checked })
  );
  el.toggleBtn.addEventListener('change', () =>
    updateStorage({ showCardButton: el.toggleBtn.checked })
  );

  for (const tabBtn of el.tabs) {
    tabBtn.addEventListener('click', () => {
      const target = tabBtn.dataset.tab;
      for (const btn of el.tabs) {
        const active = btn.dataset.tab === target;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', String(active));
      }
      el.panelComics.classList.toggle('active', target === 'comics');
      el.panelTags.classList.toggle('active', target === 'tags');
      el.panelKeywords.classList.toggle('active', target === 'keywords');

      if (target === 'tags') {
        requestTagCatalogIfNeeded();
      }
    });
  }

  el.searchComics.addEventListener('input', renderComicsList);

  el.tagInput.addEventListener('input', renderTagsPanel);
  el.tagForm.addEventListener('submit', (e) => {
    e.preventDefault();
    addBlockedTags(el.tagInput.value);
    el.tagInput.value = '';
    renderTagsPanel();
  });

  el.keywordForm.addEventListener('submit', (e) => {
    e.preventDefault();
    addKeywords(el.keywordInput.value);
    el.keywordInput.value = '';
  });

  el.btnExport.addEventListener('click', exportBackup);
  el.btnImport.addEventListener('click', () => el.importFile.click());
  el.importFile.addEventListener('change', () => {
    importBackup(el.importFile.files?.[0]);
  });
  el.btnClearAll.addEventListener('click', handleClearAllClick);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    let changed = false;
    for (const [key, change] of Object.entries(changes)) {
      if (key in DEFAULT_STATE) {
        state[key] = change.newValue !== undefined ? change.newValue : DEFAULT_STATE[key];
        changed = true;
      } else if (key === 'tagCatalogCache') {
        const items = change.newValue?.items;
        if (Array.isArray(items) && items.length > 0) {
          tagCatalogItems = items;
          catalogIsOfficial = true;
          changed = true;
        }
      }
    }
    if (changed) {
      renderAll();
      refreshActiveTabStats();
    }
  });
}

function init() {
  bindEvents();
  const keys = [...Object.keys(DEFAULT_STATE), 'tagCatalogCache'];
  chrome.storage.local.get(keys, (data) => {
    state = {
      ...DEFAULT_STATE,
      ...data,
      hiddenComics: data.hiddenComics || {},
      blockedTags: Array.isArray(data.blockedTags) ? data.blockedTags : [],
      blockedKeywords: Array.isArray(data.blockedKeywords) ? data.blockedKeywords : []
    };

    const cachedItems = data.tagCatalogCache?.items;
    if (Array.isArray(cachedItems) && cachedItems.length > 0) {
      tagCatalogItems = cachedItems;
      catalogIsOfficial = true;
    }

    renderAll();
    refreshActiveTabStats();
    requestTagCatalogIfNeeded();
  });
}

init();
