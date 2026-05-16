const state = {
  records: [],
  groups: [],
  filteredGroups: [],
  artistMasters: [],
  artistQuery: "",
  sourceFilter: "all",
  query: "",
  sort: "title-asc",
  bpmTarget: null,
  bpmToleranceRatio: 0.03,
};

const BPM_TARGETS = [
  { label: "Tango", shortLabel: "T", bpm: 128 },
  { label: "Foxtrot", shortLabel: "F", bpm: 118 },
  { label: "Quick", shortLabel: "Q", bpm: 200 },
  { label: "Cha Cha", shortLabel: "C", bpm: 124 },
  { label: "Samba", shortLabel: "S", bpm: 200 },
  { label: "Rumba", shortLabel: "R", bpm: 96 },
  { label: "Jive", shortLabel: "J", bpm: 172 },
];

const $ = (selector) => document.querySelector(selector);

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function parseSourceMetadata(record) {
  if (record.sourceMetadata && typeof record.sourceMetadata === "object") {
    return record.sourceMetadata;
  }
  if (!record.sourceMetadataJson) return {};
  try {
    return JSON.parse(record.sourceMetadataJson);
  } catch (error) {
    console.warn("sourceMetadataJson parse failed", record.title, error);
    return {};
  }
}

function prepareRecord(record) {
  const sourceMetadata = parseSourceMetadata(record);
  return {
    ...record,
    sourceMetadata,
    album: record.album || record.sourceAlbumTitle || sourceMetadata.album || "",
    contextTitle:
      record.contextTitle ||
      record.spotifyContextTitle ||
      sourceMetadata.spotifyContextTitle ||
      sourceMetadata.contextTitle ||
      "",
    contextUri:
      record.contextUri ||
      record.spotifyContextUri ||
      sourceMetadata.spotifyContextUri ||
      sourceMetadata.contextUri ||
      "",
    spotifyUri:
      record.spotifyUri ||
      record.mediaId ||
      sourceMetadata.mediaId ||
      sourceMetadata.spotifyUri ||
      "",
  };
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function sourceName(record) {
  if (record.sourceApp) return record.sourceApp;
  const pkg = record.packageName || record.sourcePackage || "";
  if (pkg.includes("spotify")) return "Spotify";
  if (pkg.includes("youtube")) return "YouTube Music";
  if (pkg.includes("amazon")) return "Amazon Music";
  return "Manual";
}

function spotifyUri(record) {
  const candidates = [
    record.spotifyUri,
    record.sourceMetadata?.spotifyUri,
    record.sourceMetadata?.contextUri,
    record.sourceMetadata?.uri,
    record.mediaId,
  ].filter(Boolean);

  return candidates.find((uri) =>
    String(uri).startsWith("spotify:") ||
    String(uri).includes("open.spotify.com")
  ) || "";
}

function contextTitle(record) {
  return (
    record.contextTitle ||
    record.sourceMetadata?.contextTitle ||
    record.sourceMetadata?.playlistTitle ||
    ""
  );
}

function albumTitle(record) {
  return record.album || record.sourceMetadata?.album || "";
}

function groupRecords(records) {
  const map = new Map();

  for (const record of records) {
    const title = record.title || "Unknown Title";
    const artist = record.artist || "Unknown Artist";
    const key = `${normalizeText(title)}|${normalizeText(artist)}`;

    if (!map.has(key)) {
      map.set(key, {
        key,
        title,
        artist,
        normalizedTitle: normalizeText(title),
        normalizedArtist: normalizeText(artist),
        records: [],
      });
    }
    map.get(key).records.push(record);
  }

  return Array.from(map.values()).map((group) => {
    const validBpms = group.records
      .map((record) => Number(record.bpm))
      .filter((bpm) => Number.isFinite(bpm) && bpm > 0);

    const avgBpm = validBpms.length
      ? validBpms.reduce((sum, bpm) => sum + bpm, 0) / validBpms.length
      : null;

    const latest = [...group.records].sort((a, b) => {
      return new Date(b.savedAt || b.createdAt || 0) - new Date(a.savedAt || a.createdAt || 0);
    })[0];

    const sources = Array.from(new Set(group.records.map(sourceName))).sort();

    return {
      ...group,
      avgBpm,
      minBpm: validBpms.length ? Math.min(...validBpms) : null,
      maxBpm: validBpms.length ? Math.max(...validBpms) : null,
      latestSavedAt: latest?.savedAt || latest?.createdAt || "",
      latest,
      sources,
      note: latest?.note || group.records.find((record) => record.note)?.note || "",
      album: albumTitle(latest) || group.records.map(albumTitle).find(Boolean) || "",
      spotifyUri: group.records.map(spotifyUri).find(Boolean) || "",
      contextTitle: group.records.map(contextTitle).find(Boolean) || "",
    };
  });
}

function updateStats() {
  $("#statSongs").textContent = String(state.groups.length);
  $("#statRecords").textContent = String(state.records.length);
  const sources = new Set(state.records.map(sourceName));
  $("#statSources").textContent = String(sources.size);
}

function populateSourceFilter() {
  const select = $("#sourceFilter");
  const sources = Array.from(new Set(state.records.map(sourceName))).sort();
  for (const source of sources) {
    const option = document.createElement("option");
    option.value = source;
    option.textContent = source;
    select.appendChild(option);
  }
}

function bpmMatches(group) {
  if (!state.bpmTarget) return true;
  if (!Number.isFinite(group.avgBpm)) return false;

  const targets = [
    state.bpmTarget,
    state.bpmTarget / 2,
  ];

  return targets.some((target) => {
    const min = target * (1 - state.bpmToleranceRatio);
    const max = target * (1 + state.bpmToleranceRatio);
    return group.avgBpm >= min && group.avgBpm <= max;
  });
}

function updateBpmFilterStatus() {
  const status = $("#bpmFilterStatus");
  if (!status) return;

  if (!state.bpmTarget) {
    status.textContent = "BPM指定なし";
    return;
  }

  const percent = Math.round(state.bpmToleranceRatio * 100);
  status.textContent =
    `${state.bpmTarget} BPM / ${Math.round(state.bpmTarget / 2)} BPM ±${percent}%`;
}

function renderBpmTargetButtons() {
  const wrapper = $("#bpmTargetButtons");
  if (!wrapper) return;

  wrapper.innerHTML = BPM_TARGETS.map((target) => `
    <button
      type="button"
      class="bpm-target-button"
      data-bpm="${target.bpm}"
      data-label="${escapeAttr(target.label)}"
      title="${escapeAttr(target.label)} ${target.bpm} BPM"
    >
      <strong>${escapeHtml(target.shortLabel)}</strong>
      <span>${target.bpm}</span>
    </button>
  `).join("");

  wrapper.querySelectorAll("[data-bpm]").forEach((button) => {
    button.addEventListener("click", () => {
      const bpm = Number(button.dataset.bpm);

      if (state.bpmTarget === bpm && button.classList.contains("active")) {
        state.bpmTarget = null;
      } else {
        state.bpmTarget = bpm;
      }

      updateBpmTargetButtons();
      updateBpmFilterStatus();
      applyFilters();
      updateUrlFromState("push");
    });
  });

  updateBpmTargetButtons();
}

function updateBpmTargetButtons() {
  document.querySelectorAll("[data-bpm]").forEach((button) => {
    const bpm = Number(button.dataset.bpm);
    button.classList.toggle("active", state.bpmTarget === bpm);
  });
}

function setupBpmFilterControls() {
  renderBpmTargetButtons();

  const toleranceInput = $("#bpmToleranceInput");
  if (toleranceInput) {
    toleranceInput.addEventListener("input", (event) => {
      const value = Number(event.target.value);
state.bpmToleranceRatio = Number.isFinite(value)
  ? Math.max(0, value) / 100
  : 0;
updateBpmFilterStatus();
applyFilters();
updateUrlFromState("push");
    });
  }

  const clearButton = $("#clearBpmFilter");
  if (clearButton) {
    clearButton.addEventListener("click", () => {
      state.bpmTarget = null;
state.bpmToleranceRatio = 0.03;
if (toleranceInput) toleranceInput.value = "3";

updateBpmTargetButtons();
updateBpmFilterStatus();
applyFilters();
updateUrlFromState("push");
    });
  }

  updateBpmFilterStatus();
}

function applyFilters() {
  const query = normalizeText(state.query);
  let groups = [...state.groups];

  if (state.sourceFilter !== "all") {
    groups = groups.filter((group) => group.sources.includes(state.sourceFilter));
  }

  if (query) {
    groups = groups.filter((group) => {
      const haystack = normalizeText([
        group.title,
        group.artist,
        group.note,
        group.album,
        group.contextTitle,
        ...group.sources,
      ].join(" "));
      return haystack.includes(query);
    });
  }

  if (state.bpmTarget) {
    groups = groups.filter(bpmMatches);
  }

  const [sortKey, direction] = state.sort.split("-");
  groups.sort((a, b) => {
    let valueA;
    let valueB;

    if (sortKey === "title") {
      valueA = normalizeText(a.title);
      valueB = normalizeText(b.title);
    } else if (sortKey === "artist") {
      valueA = normalizeText(a.artist);
      valueB = normalizeText(b.artist);
    } else if (sortKey === "bpm") {
      valueA = a.avgBpm ?? -1;
      valueB = b.avgBpm ?? -1;
    } else if (sortKey === "date") {
      valueA = new Date(a.latestSavedAt || 0).getTime();
      valueB = new Date(b.latestSavedAt || 0).getTime();
    } else if (sortKey === "logs") {
      valueA = a.records.length;
      valueB = b.records.length;
    } else if (sortKey === "source") {
      valueA = normalizeText(a.sources.join(" / "));
      valueB = normalizeText(b.sources.join(" / "));
    }

    if (valueA < valueB) return direction === "asc" ? -1 : 1;
    if (valueA > valueB) return direction === "asc" ? 1 : -1;
    return 0;
  });

  state.filteredGroups = groups;
  updateSortHeaders();
  renderTable();
}

function renderSourceTags(group) {
  return group.sources
    .map((source) => `<span class="source-tag">${escapeHtml(source)}</span>`)
    .join("");
}

function renderTable() {
  const tbody = $("#songTableBody");

  if (!state.filteredGroups.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty">該当する保存曲がありません</td></tr>`;
    return;
  }

  tbody.innerHTML = state.filteredGroups
    .map((group) => {
      const bpmText = group.avgBpm ? Math.round(group.avgBpm) : "-";
      const bpmRange =
        group.minBpm && group.maxBpm && group.minBpm !== group.maxBpm
          ? `${Math.round(group.minBpm)}-${Math.round(group.maxBpm)}`
          : "";
      const openLink = group.spotifyUri
        ? `<a class="action-link" href="${escapeAttr(toSpotifyUrl(group.spotifyUri))}" target="_blank" rel="noopener" title="Spotifyで開く">▶</a>`
        : `<span class="action-link" aria-label="リンクなし">-</span>`;

        const searchLinkHtml = searchLinks(group);

      const titleSubText = group.album || "";

      return `
        <tr data-key="${escapeAttr(group.key)}">
          <td class="title-cell">
  <strong>${escapeHtml(group.title)}</strong>
  ${titleSubText ? `<small>${escapeHtml(titleSubText)}</small>` : ""}
</td>
          <td class="artist-cell" title="${escapeAttr(group.artist)}">
            <span class="artist-line">${escapeHtml(group.artist)}</span>
          </td>
          <td>
  <span class="bpm-pill">${escapeHtml(bpmText)}<small>BPM</small></span>
  ${bpmRange ? `<small class="bpm-range">${escapeHtml(bpmRange)}</small>` : ""}
</td>
<td>${searchLinkHtml}</td>
<td>${openLink}</td>
<td><div class="source-tags">${renderSourceTags(group)}</div></td>
<td>
  <button class="log-button" data-log-key="${escapeAttr(group.key)}">${group.records.length} logs</button>
</td>
        </tr>
      `;
    })
    .join("");

  tbody.querySelectorAll("tr[data-key]").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (event.target.closest("a,button")) return;
      const group = state.groups.find((item) => item.key === row.dataset.key);
      openDetail(group);
    });
  });

  tbody.querySelectorAll("[data-log-key]").forEach((button) => {
    button.addEventListener("click", (event) => {
      const group = state.groups.find((item) => item.key === event.currentTarget.dataset.logKey);
      openDetail(group);
    });
  });
}

function toSpotifyUrl(uri) {
  if (!uri) return "#";
  if (uri.startsWith("http")) return uri;
  if (uri.startsWith("spotify:track:")) {
    return `https://open.spotify.com/track/${uri.replace("spotify:track:", "")}`;
  }
  if (uri.startsWith("spotify:playlist:")) {
    return `https://open.spotify.com/playlist/${uri.replace("spotify:playlist:", "")}`;
  }
  return uri;
}

function buildSearchQuery(group) {
  return encodeURIComponent(`${group.title} ${group.artist}`);
}

function searchLinks(group) {
  const q = buildSearchQuery(group);

  return `
    <div class="search-links">
      <a href="https://www.google.com/search?q=${q}" target="_blank" rel="noopener" title="Googleで検索">G</a>
      <a href="https://www.youtube.com/results?search_query=${q}" target="_blank" rel="noopener" title="YouTubeで検索">Y</a>
      <a href="https://open.spotify.com/search/${q}" target="_blank" rel="noopener" title="Spotifyで検索">S</a>
    </div>
  `;
}

function openDetail(group) {
  if (!group) return;
  const panel = $("#detailPanel");
  const content = $("#detailContent");

  const bpmText = group.avgBpm ? `${Math.round(group.avgBpm)} BPM` : "-";
  const spotify = group.spotifyUri
    ? `<a class="action-link" href="${escapeAttr(toSpotifyUrl(group.spotifyUri))}" target="_blank" rel="noopener">▶ Spotify</a>`
    : "";

  content.innerHTML = `
    <div class="detail-title">
      <p class="eyebrow">Song detail</p>
      <h2>${escapeHtml(group.title)}</h2>
      <p>${escapeHtml(group.artist)}</p>
      ${spotify}
    </div>

    <div class="detail-meta">
      <div><span>Average</span><strong>${escapeHtml(bpmText)}</strong></div>
      <div><span>Logs</span><strong>${group.records.length}</strong></div>
      <div><span>Latest</span><strong>${escapeHtml(formatDate(group.latestSavedAt))}</strong></div>
      <div><span>Source</span><strong>${escapeHtml(group.sources.join(" / "))}</strong></div>
    </div>

    ${group.contextTitle ? `<p><strong>Playlist:</strong> ${escapeHtml(group.contextTitle)}</p>` : ""}
    ${group.album ? `<p><strong>Album:</strong> ${escapeHtml(group.album)}</p>` : ""}
    ${group.note ? `<p><strong>Note:</strong> ${escapeHtml(group.note)}</p>` : ""}

    <h3>保存ログ</h3>
    <div class="log-list">
      ${group.records
        .slice()
        .sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0))
        .map((record) => `
          <div class="log-item">
            <strong>${escapeHtml(record.bpm || "-")} BPM</strong>
            <span>${escapeHtml(sourceName(record))}</span>
            <small>${escapeHtml(formatDate(record.savedAt || record.createdAt))}${record.note ? ` / ${escapeHtml(record.note)}` : ""}</small>
          </div>
        `)
        .join("")}
    </div>
  `;

  panel.classList.add("open");
  panel.setAttribute("aria-hidden", "false");
}

function closeDetail() {
  const panel = $("#detailPanel");
  panel.classList.remove("open");
  panel.setAttribute("aria-hidden", "true");
}

function splitArtistNames(artistText) {
  return String(artistText || "")
    .split(" / ")
    .map((name) => name.trim())
    .filter(Boolean);
}

function buildArtistRows() {
  const artistMap = new Map();

  for (const artist of state.artistMasters) {
    if (!artist?.name) continue;
    artistMap.set(artist.name, {
      name: artist.name,
      records: [],
    });
  }

  for (const record of state.records) {
    for (const name of splitArtistNames(record.artist)) {
      if (!artistMap.has(name)) {
        artistMap.set(name, {
          name,
          records: [],
        });
      }
      artistMap.get(name).records.push(record);
    }
  }

  return Array.from(artistMap.values())
    .map((artist) => {
      const songCount = new Set(
        artist.records.map((record) =>
          `${normalizeText(record.title)}|${normalizeText(record.artist)}`
        )
      ).size;

      return {
        ...artist,
        songCount,
        recordCount: artist.records.length,
      };
    })
    .sort((a, b) => normalizeText(a.name).localeCompare(normalizeText(b.name), "ja"));
}

function renderArtists() {
  const wrapper = $("#artistCards");
  if (!wrapper) return;

  const query = normalizeText(state.artistQuery);
  let artists = buildArtistRows();

  if (query) {
    artists = artists.filter((artist) => {
      return normalizeText(artist.name).includes(query);
    });
  }

  if (!artists.length) {
    wrapper.innerHTML = `<div class="artist-card"><p>該当するアーティストはありません。</p></div>`;
    return;
  }

  wrapper.innerHTML = artists.map((artist) => {
  return `
    <article class="artist-card" data-artist="${escapeAttr(artist.name)}">
      <div class="artist-card-main">
        <h3>${escapeHtml(artist.name)}</h3>
      </div>

      <div class="artist-card-meta">
        <span>${artist.songCount} songs</span>
        <span>${artist.recordCount} logs</span>
      </div>
    </article>
  `;
}).join("");

  wrapper.querySelectorAll("[data-artist]").forEach((card) => {
  card.addEventListener("click", () => {
    const artistName = card.dataset.artist;
    state.query = artistName;

    const searchInput = $("#searchInput");
    if (searchInput) searchInput.value = artistName;

    document.querySelectorAll(".pill").forEach((item) => item.classList.remove("active"));
    document.querySelector('[data-section="library"]')?.classList.add("active");

    document.querySelectorAll(".section-block").forEach((section) => {
      section.classList.remove("active-section");
    });
    $("#section-library")?.classList.add("active-section");

    applyFilters();
    updateUrlFromState("push");
  });
});
}

function renderPlaylists() {
  const wrapper = $("#playlistCards");
  const map = new Map();

  for (const group of state.groups) {
    for (const record of group.records) {
      const title = contextTitle(record);
      if (!title) continue;
      const key = normalizeText(title);
      if (!map.has(key)) {
        map.set(key, {
          title,
          uri: record.sourceMetadata?.contextUri || record.contextUri || "",
          songs: new Map(),
        });
      }
      map.get(key).songs.set(group.key, group);
    }
  }

  const playlists = Array.from(map.values());

  if (!playlists.length) {
    wrapper.innerHTML = `<div class="playlist-card"><p>プレイリスト文脈を持つ保存曲はまだありません。</p></div>`;
    return;
  }

  wrapper.innerHTML = playlists
    .map((playlist) => {
      const songs = Array.from(playlist.songs.values());
      const link = playlist.uri
        ? `<a class="action-link" href="${escapeAttr(toSpotifyUrl(playlist.uri))}" target="_blank" rel="noopener">▶</a>`
        : "";
      return `
        <article class="playlist-card">
          <h3>${escapeHtml(playlist.title)} ${link}</h3>
          <p>${songs.length} saved songs</p>
          <div class="playlist-song-list">
            ${songs.slice(0, 8).map((song) => `<span>${escapeHtml(song.title)} / ${escapeHtml(song.artist)} / ${Math.round(song.avgBpm || 0)} BPM</span>`).join("")}
          </div>
        </article>
      `;
    })
    .join("");
}

function setupNavigation() {
  document.querySelectorAll(".pill").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".pill").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");

      document.querySelectorAll(".section-block").forEach((section) => {
        section.classList.remove("active-section");
      });
      $(`#section-${button.dataset.section}`).classList.add("active-section");
      updateUrlFromState("push");
    });
  });
}

function updateSortHeaders() {
  const [activeKey, direction] = state.sort.split("-");

  document.querySelectorAll("[data-sort-key]").forEach((button) => {
    const key = button.dataset.sortKey;
    const mark = button.querySelector(".sort-mark");

    button.classList.toggle("active", key === activeKey);

    if (mark) {
      mark.textContent = key === activeKey
        ? direction === "asc" ? "▲" : "▼"
        : "";
    }
  });
}

function setupTableSortHeaders() {
  document.querySelectorAll("[data-sort-key]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.sortKey;
      const [currentKey, currentDirection] = state.sort.split("-");

      const nextDirection =
        currentKey === key && currentDirection === "asc"
          ? "desc"
          : "asc";

      state.sort = `${key}-${nextDirection}`;

      const sortSelect = $("#sortSelect");
      if (sortSelect) {
        const hasOption = Array.from(sortSelect.options).some(
          (option) => option.value === state.sort
        );
        if (hasOption) sortSelect.value = state.sort;
      }

      applyFilters();
      updateUrlFromState("push");
    });
  });
}

function readStateFromUrl() {
  const params = new URLSearchParams(window.location.search);

  const q = params.get("q") || "";
  const source = params.get("source") || "all";
  const bpm = params.get("bpm");
  const range = params.get("range");
  const sort = params.get("sort") || "title-asc";
  const section = params.get("section") || "library";

  state.query = q;
  state.sourceFilter = source;
  state.bpmTarget = bpm && Number.isFinite(Number(bpm)) ? Number(bpm) : null;
  state.bpmToleranceRatio =
    range && Number.isFinite(Number(range))
      ? Math.max(0, Number(range)) / 100
      : 0.03;
  state.sort = sort;

  document.querySelectorAll(".pill").forEach((item) => item.classList.remove("active"));
  document.querySelector(`[data-section="${CSS.escape(section)}"]`)?.classList.add("active");

  document.querySelectorAll(".section-block").forEach((item) => {
    item.classList.remove("active-section");
  });
  $(`#section-${section}`)?.classList.add("active-section");
}

function syncControlsFromState() {
  const searchInput = $("#searchInput");
  if (searchInput) searchInput.value = state.query;

  const sourceFilter = $("#sourceFilter");
  if (sourceFilter) sourceFilter.value = state.sourceFilter;

  const toleranceInput = $("#bpmToleranceInput");
  if (toleranceInput) {
    toleranceInput.value = String(Math.round(state.bpmToleranceRatio * 100));
  }

  updateBpmTargetButtons();
  updateBpmFilterStatus();
  updateSortHeaders();
}

function updateUrlFromState(mode = "replace") {
  const params = new URLSearchParams();

  const activeSection =
    document.querySelector(".pill.active")?.dataset.section || "library";

  if (activeSection !== "library") params.set("section", activeSection);
  if (state.query) params.set("q", state.query);
  if (state.sourceFilter !== "all") params.set("source", state.sourceFilter);
  if (state.bpmTarget) params.set("bpm", String(state.bpmTarget));

  const range = Math.round(state.bpmToleranceRatio * 100);
  if (range !== 3) params.set("range", String(range));

  if (state.sort !== "title-asc") params.set("sort", state.sort);

  const queryString = params.toString();
  const nextUrl = queryString
    ? `${window.location.pathname}?${queryString}`
    : window.location.pathname;

  if (nextUrl === `${window.location.pathname}${window.location.search}`) {
    return;
  }

  if (mode === "push") {
    window.history.pushState(null, "", nextUrl);
  } else {
    window.history.replaceState(null, "", nextUrl);
  }
}

function applyStateFromUrl() {
  readStateFromUrl();
  syncControlsFromState();
  renderArtists();
  applyFilters();
}

window.addEventListener("popstate", () => {
  applyStateFromUrl();
});

function setupControls() {
  $("#searchInput").addEventListener("input", (event) => {
    state.query = event.target.value;
    applyFilters();
    updateUrlFromState();
  });

  $("#sourceFilter").addEventListener("change", (event) => {
    state.sourceFilter = event.target.value;
    applyFilters();
    updateUrlFromState("push");
  });

  const sortSelect = $("#sortSelect");
  if (sortSelect) {
    sortSelect.addEventListener("change", (event) => {
      state.sort = event.target.value;
      applyFilters();
      updateUrlFromState("push");
    });
  }

  $("#closeDetail").addEventListener("click", closeDetail);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDetail();
  });

  const artistSearchInput = $("#artistSearchInput");
if (artistSearchInput) {
  artistSearchInput.addEventListener("input", (event) => {
    state.artistQuery = event.target.value;
    renderArtists();
  });
}
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

async function init() {
  setupNavigation();
  setupControls();
  setupTableSortHeaders();
  setupBpmFilterControls();

  try {
  const response = await fetch("./songs.json", { cache: "no-store" });
  const data = await response.json();

  const rawRecords = Array.isArray(data.tapRecords)
    ? data.tapRecords
    : Array.isArray(data.records)
      ? data.records
      : Array.isArray(data)
        ? data
        : [];

  state.records = rawRecords.map(prepareRecord);
state.artistMasters = Array.isArray(data.artistMasters) ? data.artistMasters : [];
state.groups = groupRecords(state.records);

readStateFromUrl();
updateStats();
populateSourceFilter();
renderArtists?.();
renderPlaylists();
syncControlsFromState();
applyFilters();

} catch (error) {
  console.error(error);
  $("#songTableBody").innerHTML = `<tr><td colspan="7" class="empty">songs.json の読み込みに失敗しました</td></tr>`;
}
}

init();
