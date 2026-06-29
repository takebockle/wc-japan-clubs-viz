const YEARS = [1998, 2002, 2006, 2010, 2014, 2018, 2022, 2026];
const BAR_WIDTH = 5;
const MAX_BAR_HEIGHT = 140;
const MIN_SEGMENT_HEIGHT = 3;

const ZOOM_THRESHOLD = 3;
const COUNTRY_CENTROIDS = {
  Japan: [36.5, 137],
  England: [52.5, -1.5],
  Germany: [50.5, 10],
  Italy: [43, 12],
  Spain: [40, -3.5],
  France: [47, 2.5],
  Netherlands: [52, 5],
  Belgium: [51, 4.5],
  Portugal: [39, -8.5],
  Scotland: [56, -4],
  Denmark: [55.7, 12],
  Switzerland: [47.4, 8.5],
  Austria: [48, 14],
  Turkey: [41, 29],
  Russia: [55.7, 37.5],
  Croatia: [43.5, 16.5],
  Serbia: [44.8, 20.5],
  Mexico: [20, -99],
  Qatar: [25.3, 51.4],
  Monaco: [43.7, 7.4],
};
const FLAGS = {
  Japan:'🇯🇵',England:'🏴󠁧󠁢󠁥󠁮󠁧󠁿',Germany:'🇩🇪',Italy:'🇮🇹',Spain:'🇪🇸',France:'🇫🇷',
  Netherlands:'🇳🇱',Belgium:'🇧🇪',Portugal:'🇵🇹',Scotland:'🏴󠁧󠁢󠁳󠁣󠁴󠁿',Turkey:'🇹🇷',
  Russia:'🇷🇺',Denmark:'🇩🇰',Switzerland:'🇨🇭',Austria:'🇦🇹',Croatia:'🇭🇷',
  Serbia:'🇷🇸',Mexico:'🇲🇽',Qatar:'🇶🇦',Monaco:'🇲🇨',
};
const POS_ORDER = ['GK', 'DF', 'MF', 'FW'];
const POS_PALETTES = {
  GK: ['#8e44ad', '#9b59b6', '#af7ac5'],
  DF: ['#1a5276', '#2471a3', '#2e86c1', '#3498db', '#5dade2', '#85c1e9', '#1b7a6e', '#2ab5a0', '#5ccebe'],
  MF: ['#1e8449', '#239b56', '#27ae60', '#2ecc71', '#58d68d', '#82e0aa', '#d4ac0d', '#f1c40f'],
  FW: ['#922b21', '#cb4335', '#e74c3c', '#ec7063', '#f1948a', '#f5b7b1'],
};

let allData = [];
let map;
let markerLayer;
let pathLayer;
let state = {
  yearIndex: 7,
  selectedPlayer: null,
  playerColors: {},
};

// ===== Mobile detection =====
function isMobile() {
  return window.matchMedia('(max-width: 767px)').matches;
}

async function loadData() {
  const files = YEARS.map(y => `data/squad_appearances_${y}.csv`);
  const datasets = await Promise.all(files.map(f => d3.csv(f, d => ({
    tournament_year: +d.tournament_year,
    player_name: d.player_name,
    player_name_en: d.player_name_en,
    position: d.position,
    season: +d.season,
    club: d.club,
    league: d.league,
    country: d.country,
    lat: +d.club_lat,
    lng: +d.club_lng,
    appearances: +d.appearances,
  }))));
  allData = datasets.flat();
}

function getYearData(year) {
  return allData.filter(d => d.tournament_year === year);
}

function assignColors(yearData) {
  const colors = {};
  const byPos = d3.group(yearData, d => d.position);
  for (const pos of POS_ORDER) {
    const players = [...new Set((byPos.get(pos) || []).map(d => d.player_name))];
    const palette = POS_PALETTES[pos];
    players.forEach((name, i) => {
      colors[name] = palette[i % palette.length];
    });
  }
  return colors;
}

function aggregateClubs(yearData) {
  const clubMap = new Map();
  for (const d of yearData) {
    const key = `${d.lat.toFixed(4)},${d.lng.toFixed(4)}`;
    if (!clubMap.has(key)) {
      clubMap.set(key, {
        club: d.club,
        league: d.league,
        country: d.country,
        lat: d.lat,
        lng: d.lng,
        players: new Map(),
      });
    }
    const club = clubMap.get(key);
    if (!club.players.has(d.player_name)) {
      club.players.set(d.player_name, {
        name: d.player_name,
        name_en: d.player_name_en,
        position: d.position,
        appearances: 0,
        seasons: [],
      });
    }
    const p = club.players.get(d.player_name);
    p.appearances += d.appearances;
    p.seasons.push({ season: d.season, appearances: d.appearances });
  }
  return [...clubMap.values()].map(c => ({
    ...c,
    players: [...c.players.values()].sort((a, b) =>
      POS_ORDER.indexOf(a.position) - POS_ORDER.indexOf(b.position)
    ),
    total: [...c.players.values()].reduce((s, p) => s + p.appearances, 0),
  }));
}

function aggregateByCountry(yearData) {
  const countryMap = new Map();
  for (const d of yearData) {
    const country = d.country;
    if (!countryMap.has(country)) {
      const centroid = COUNTRY_CENTROIDS[country] || [d.lat, d.lng];
      countryMap.set(country, {
        club: country,
        league: '',
        country: country,
        lat: centroid[0],
        lng: centroid[1],
        leagues: new Set(),
        players: new Map(),
      });
    }
    const c = countryMap.get(country);
    c.leagues.add(d.league);
    if (!c.players.has(d.player_name)) {
      c.players.set(d.player_name, {
        name: d.player_name,
        name_en: d.player_name_en,
        position: d.position,
        appearances: 0,
        seasons: [],
        clubs: new Set(),
      });
    }
    const p = c.players.get(d.player_name);
    p.appearances += d.appearances;
    p.seasons.push({ season: d.season, appearances: d.appearances });
    p.clubs.add(d.club);
  }
  return [...countryMap.values()].map(c => ({
    ...c,
    league: [...c.leagues].join(', '),
    players: [...c.players.values()].map(p => ({
      ...p,
      clubLabel: [...p.clubs].join(' / '),
    })).sort((a, b) =>
      POS_ORDER.indexOf(a.position) - POS_ORDER.indexOf(b.position)
    ),
    total: [...c.players.values()].reduce((s, p) => s + p.appearances, 0),
  }));
}

function initMap() {
  const mobile = isMobile();
  map = L.map('map', {
    center: [40, 70],
    zoom: 2,
    minZoom: 2,
    maxZoom: 10,
    zoomControl: !mobile,
    worldCopyJump: true,
    tap: true,
  });

  if (mobile) {
    map.fitBounds(VIEWS.world.mobileBounds, { animate: false });
  }

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20,
  }).addTo(map);

  // Add zoom control to top-left on mobile
  if (mobile) {
    L.control.zoom({ position: 'topright' }).addTo(map);
  }

  markerLayer = L.layerGroup().addTo(map);
  pathLayer = L.layerGroup().addTo(map);
  map.on('zoomend', () => renderBars());

  // Tap on map to dismiss tooltip on mobile
  if (mobile) {
    map.on('click', () => {
      hideTooltip();
    });
  }
}

function createBarIcon(clubData, colors, maxTotal) {
  const mobile = isMobile();
  const barWidth = mobile ? 7 : BAR_WIDTH;
  const maxHeight = mobile ? 100 : MAX_BAR_HEIGHT;
  const scale = maxHeight / Math.max(maxTotal, 1);
  const segments = clubData.players.map(p => ({
    ...p,
    height: Math.max(p.appearances * scale, MIN_SEGMENT_HEIGHT),
    color: colors[p.name] || '#666',
  }));
  const totalHeight = segments.reduce((s, seg) => s + seg.height + 1, 0);
  const svgHeight = totalHeight + 8;
  const svgWidth = barWidth + 4;

  let y = svgHeight - 6;
  let rectsHtml = `<circle class="club-dot" cx="${svgWidth / 2}" cy="${svgHeight - 3}" r="${mobile ? 4 : 3}"/>`;

  for (const seg of segments) {
    y -= seg.height;
    const dimClass = state.selectedPlayer && state.selectedPlayer !== seg.name ? ' dimmed' : '';
    rectsHtml += `<rect class="bar-segment${dimClass}" data-player="${seg.name}" x="2" y="${y}" width="${barWidth}" height="${seg.height}" rx="1" fill="${seg.color}"/>`;
    y -= 1;
  }

  const offsetX = -(svgWidth / 2);
  const offsetY = -(svgHeight - 3);
  return L.divIcon({
    className: 'bar-marker',
    html: `<svg width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" style="position:absolute;left:${offsetX}px;top:${offsetY}px">${rectsHtml}</svg>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

function renderBars() {
  markerLayer.clearLayers();
  if (state._pathAnimation) {
    cancelAnimationFrame(state._pathAnimation);
    state._pathAnimation = null;
  }
  pathLayer.clearLayers();
  const year = YEARS[state.yearIndex];
  const yearData = getYearData(year);
  state.playerColors = assignColors(yearData);

  const zoom = map.getZoom();
  const clubs = zoom <= ZOOM_THRESHOLD
    ? aggregateByCountry(yearData)
    : aggregateClubs(yearData);
  const maxTotal = d3.max(clubs, c => c.total) || 1;
  const mobile = isMobile();

  for (const club of clubs) {
    const icon = createBarIcon(club, state.playerColors, maxTotal);
    const marker = L.marker([club.lat, club.lng], { icon, interactive: true });

    if (mobile) {
      // On mobile, use click/tap for tooltip
      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        showTooltip(e, club, zoom <= ZOOM_THRESHOLD);
      });
    } else {
      marker.on('mouseover', (e) => showTooltip(e, club, zoom <= ZOOM_THRESHOLD));
      marker.on('mouseout', hideTooltip);
      marker.on('mousemove', moveTooltip);
    }

    marker.addTo(markerLayer);
  }

  if (state.selectedPlayer) {
    drawPlayerPath(state.selectedPlayer, yearData);
    renderCareerPanel(state.selectedPlayer, yearData);
  } else {
    renderCareerPanel(null);
  }
}

function showTooltip(e, club, isCountryMode) {
  const tooltip = document.getElementById('tooltip');
  const mobile = isMobile();
  const playersHtml = club.players.map(p => {
    const color = state.playerColors[p.name] || '#666';
    const dimStyle = state.selectedPlayer && state.selectedPlayer !== p.name ? ' style="opacity:0.3"' : '';
    const clubInfo = isCountryMode && p.clubLabel ? ` — ${p.clubLabel}` : '';
    const tapAttr = mobile ? ` data-player="${p.name}" style="cursor:pointer;${dimStyle ? 'opacity:0.3;' : ''}"` : dimStyle;
    return `<div class="tooltip-player"${mobile ? tapAttr : dimStyle}>
      <span class="tooltip-player-color" style="background:${color}"></span>
      <span class="tooltip-player-name">${p.name} (${p.position})${clubInfo}</span>
      <span class="tooltip-player-apps">${p.appearances}</span>
    </div>`;
  }).join('');

  const subtitle = isCountryMode
    ? `<div class="tooltip-league">${club.league}</div>`
    : `<div class="tooltip-league">${club.league} / ${club.country}</div>`;

  tooltip.innerHTML = `
    <div class="tooltip-club">${club.club}</div>
    ${subtitle}
    <div class="tooltip-players">${playersHtml}</div>
    <div class="tooltip-total">Total: ${club.total} appearances</div>
  `;
  tooltip.classList.add('visible');

  if (!isMobile()) {
    positionTooltip(e.originalEvent);
  } else {
    tooltip.querySelectorAll('.tooltip-player[data-player]').forEach(el => {
      el.addEventListener('click', () => {
        selectPlayer(el.dataset.player);
      });
    });
  }
}

function moveTooltip(e) {
  if (!isMobile()) {
    positionTooltip(e.originalEvent);
  }
}

function positionTooltip(event) {
  const tooltip = document.getElementById('tooltip');
  const x = event.clientX + 16;
  const y = event.clientY - 10;
  const rect = tooltip.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 10;
  const maxY = window.innerHeight - rect.height - 10;
  tooltip.style.left = `${Math.min(x, maxX)}px`;
  tooltip.style.top = `${Math.max(10, Math.min(y, maxY))}px`;
}

function hideTooltip() {
  document.getElementById('tooltip').classList.remove('visible');
}

function calculateArc(start, end, numPoints) {
  const dx = end[1] - start[1];
  const dy = end[0] - start[0];
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.001) return [start, end];
  const offset = dist * 0.25;
  const perpX = -dy / dist * offset;
  const perpY = dx / dist * offset;
  const cpLat = (start[0] + end[0]) / 2 + perpY;
  const cpLng = (start[1] + end[1]) / 2 + perpX;

  const points = [];
  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    const lat = (1 - t) * (1 - t) * start[0] + 2 * (1 - t) * t * cpLat + t * t * end[0];
    const lng = (1 - t) * (1 - t) * start[1] + 2 * (1 - t) * t * cpLng + t * t * end[1];
    points.push([lat, lng]);
  }
  return points;
}

function drawPlayerPath(playerName, yearData) {
  if (state._pathAnimation) {
    cancelAnimationFrame(state._pathAnimation);
    state._pathAnimation = null;
  }

  const records = yearData
    .filter(d => d.player_name === playerName)
    .sort((a, b) => a.season - b.season);

  const locations = [];
  for (const d of records) {
    const last = locations[locations.length - 1];
    if (!last || last.lat !== d.lat || last.lng !== d.lng) {
      locations.push([d.lat, d.lng]);
    }
  }

  if (locations.length < 2) return;

  const fullPath = [];
  for (let i = 1; i < locations.length; i++) {
    const arcPoints = calculateArc(locations[i - 1], locations[i], 50);
    if (i > 1) arcPoints.shift();
    fullPath.push(...arcPoints);
  }

  const distances = [0];
  for (let i = 1; i < fullPath.length; i++) {
    const dlat = fullPath[i][0] - fullPath[i - 1][0];
    const dlng = fullPath[i][1] - fullPath[i - 1][1];
    distances.push(distances[i - 1] + Math.sqrt(dlat * dlat + dlng * dlng));
  }
  const totalDist = distances[distances.length - 1];
  if (totalDist < 0.001) return;

  L.polyline(fullPath, {
    color: '#e94560', weight: 1.5, opacity: 0.15, smoothFactor: 1,
  }).addTo(pathLayer);

  function indexAtDist(d) {
    for (let i = 1; i < distances.length; i++) {
      if (distances[i] >= d) return i - 1;
    }
    return distances.length - 2;
  }

  function pointAtDist(d) {
    const i = indexAtDist(d);
    const segLen = distances[i + 1] - distances[i];
    const t = segLen > 0 ? (d - distances[i]) / segLen : 0;
    return [
      fullPath[i][0] + t * (fullPath[i + 1][0] - fullPath[i][0]),
      fullPath[i][1] + t * (fullPath[i + 1][1] - fullPath[i][1]),
    ];
  }

  function slicePath(startDist, endDist) {
    const pts = [pointAtDist(startDist)];
    const si = indexAtDist(startDist) + 1;
    const ei = indexAtDist(endDist);
    for (let i = si; i <= ei; i++) pts.push(fullPath[i]);
    pts.push(pointAtDist(endDist));
    return pts;
  }

  const trailLen = totalDist * 0.12;
  const layers = [
    { line: L.polyline([], { color: '#ff8fa3', weight: 3,   opacity: 0.7,  smoothFactor: 1 }).addTo(pathLayer), ratio: 0.3 },
    { line: L.polyline([], { color: '#ff6b8a', weight: 2.5, opacity: 0.55, smoothFactor: 1 }).addTo(pathLayer), ratio: 0.6 },
    { line: L.polyline([], { color: '#e94560', weight: 2,   opacity: 0.35, smoothFactor: 1 }).addTo(pathLayer), ratio: 1.0 },
  ];

  const headIcon = L.divIcon({ className: 'path-pulse', iconSize: [0, 0], iconAnchor: [0, 0] });
  const headMarker = L.marker(fullPath[0], { icon: headIcon, interactive: false }).addTo(pathLayer);

  let headDist = 0;
  const speed = totalDist / 300;

  function animate() {
    headDist += speed;
    if (headDist >= totalDist) {
      headDist = totalDist;
      headMarker.setLatLng(pointAtDist(headDist));
      for (const layer of layers) {
        const tailDist = Math.max(0, headDist - trailLen * layer.ratio);
        layer.line.setLatLngs(slicePath(tailDist, headDist));
      }
      return;
    }

    headMarker.setLatLng(pointAtDist(headDist));

    for (const layer of layers) {
      const tailDist = Math.max(0, headDist - trailLen * layer.ratio);
      layer.line.setLatLngs(slicePath(tailDist, headDist));
    }

    state._pathAnimation = requestAnimationFrame(animate);
  }
  animate();
}

function fitToPlayerClubs(playerName, yearData) {
  const records = yearData.filter(d => d.player_name === playerName);
  if (records.length === 0) return;
  const lats = records.map(d => d.lat);
  const lngs = records.map(d => d.lng);
  const bounds = L.latLngBounds(
    [Math.min(...lats) - 2, Math.min(...lngs) - 5],
    [Math.max(...lats) + 2, Math.max(...lngs) + 5]
  );
  map.fitBounds(bounds, { duration: 1, maxZoom: 8, padding: [30, 30] });
}

function renderCareerPanel(playerName, yearData) {
  const panel = document.getElementById('career-panel');
  if (!playerName) {
    panel.classList.remove('visible');
    return;
  }

  const records = yearData
    .filter(d => d.player_name === playerName)
    .sort((a, b) => a.season - b.season);

  if (records.length === 0) {
    panel.classList.remove('visible');
    return;
  }

  const first = records[0];
  const rowsHtml = records.map((d, i) => {
    const prevClub = i > 0 ? records[i - 1].club : null;
    const isNewClub = d.club !== prevClub;
    return `<div class="career-row${isNewClub && i > 0 ? ' new-club' : ''}">
      <span class="career-season">${d.season}</span>
      <span class="career-club">${d.club}</span>
      <span class="career-country">${FLAGS[d.country] || '🏳'}</span>
      <span class="career-apps">${d.appearances}</span>
    </div>`;
  }).join('');

  panel.innerHTML = `
    <div class="career-header">
      <span class="career-player-name">${first.player_name}</span>
      <span class="career-player-name-en">${first.player_name_en}</span>
    </div>
    <div class="career-list">${rowsHtml}</div>
  `;
  panel.classList.add('visible');
}

function selectPlayer(name) {
  state.selectedPlayer = state.selectedPlayer === name ? null : name;
  renderBars();
  renderSidebar();
  if (state.selectedPlayer) {
    const year = YEARS[state.yearIndex];
    const yearData = getYearData(year);
    fitToPlayerClubs(state.selectedPlayer, yearData);
    if (isMobile()) {
      setSheetState('collapsed');
      hideTooltip();
    }
  }
}

function renderSidebar() {
  const year = YEARS[state.yearIndex];
  const yearData = getYearData(year);
  const byPos = d3.group(yearData, d => d.position);
  const container = document.getElementById('player-list');

  let html = '';
  for (const pos of POS_ORDER) {
    const entries = byPos.get(pos) || [];
    const players = [...new Map(entries.map(d => [d.player_name, d])).values()];
    html += `<div class="position-group">
      <div class="position-group-label">${pos}</div>`;
    for (const p of players) {
      const color = state.playerColors[p.player_name] || '#666';
      const activeClass = state.selectedPlayer === p.player_name ? ' active' : '';
      const dimClass = state.selectedPlayer && state.selectedPlayer !== p.player_name ? ' dimmed' : '';
      html += `<div class="player-item${activeClass}${dimClass}" data-player="${p.player_name}">
        <span class="player-color" style="background:${color}"></span>
        <span class="player-name-ja">${p.player_name}</span>
        <span class="player-name-en">${p.player_name_en}</span>
      </div>`;
    }
    html += '</div>';
  }
  container.innerHTML = html;

  container.querySelectorAll('.player-item').forEach(el => {
    el.addEventListener('click', () => {
      selectPlayer(el.dataset.player);
    });
  });
}

function initYearControl() {
  const labelsEl = document.getElementById('year-labels');
  labelsEl.innerHTML = YEARS.map((y, i) =>
    `<span class="year-tick${i === state.yearIndex ? ' active' : ''}" data-index="${i}">${y}</span>`
  ).join('');

  labelsEl.querySelectorAll('.year-tick').forEach(el => {
    el.addEventListener('click', () => {
      state.yearIndex = +el.dataset.index;
      state.selectedPlayer = null;
      updateYear();
    });
  });

  const slider = document.getElementById('year-slider');
  slider.value = state.yearIndex;
  slider.addEventListener('input', () => {
    state.yearIndex = +slider.value;
    state.selectedPlayer = null;
    updateYear();
  });
}

function updateYear() {
  document.getElementById('year-slider').value = state.yearIndex;
  document.querySelectorAll('.year-tick').forEach((el, i) => {
    el.classList.toggle('active', i === state.yearIndex);
  });
  renderBars();
  renderSidebar();
}

const VIEWS = {
  world: { center: [35, 70], zoom: 2, mobileBounds: [[10, -14], [62, 152]] },
  japan: { center: [36.5, 137], zoom: 6 },
  europe: { center: [51, 7], zoom: 5 },
};

function applyView(viewName, animate) {
  const view = VIEWS[viewName];
  const mobile = isMobile();
  document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
  const activeBtn = document.querySelector(`.view-btn[data-view="${viewName}"]`);
  if (activeBtn) activeBtn.classList.add('active');
  if (mobile && view.mobileBounds) {
    map.fitBounds(view.mobileBounds, { animate: animate !== false, duration: 1 });
  } else {
    map.flyTo(view.center, view.zoom, { duration: animate !== false ? 1 : 0 });
  }
  if (mobile) {
    setSheetState('collapsed');
  }
}

function initViewButtons() {
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      applyView(btn.dataset.view);
    });
  });
}

// ===== Bottom Sheet Logic (Mobile) =====
function setSheetState(state) {
  const sidebar = document.getElementById('sidebar');
  sidebar.setAttribute('data-sheet', state);
}

function initBottomSheet() {
  const sidebar = document.getElementById('sidebar');
  const handle = document.getElementById('sheet-handle');

  if (!isMobile()) return;

  // Start collapsed
  setSheetState('collapsed');

  let startY = 0;
  let startTranslateY = 0;
  let isDragging = false;

  function getTranslateY(el) {
    const style = window.getComputedStyle(el);
    const matrix = new DOMMatrix(style.transform);
    return matrix.m42;
  }

  function onStart(e) {
    const touch = e.touches ? e.touches[0] : e;
    startY = touch.clientY;
    startTranslateY = getTranslateY(sidebar);
    isDragging = true;
    sidebar.style.transition = 'none';
  }

  function onMove(e) {
    if (!isDragging) return;
    const touch = e.touches ? e.touches[0] : e;
    const dy = touch.clientY - startY;
    const newY = Math.max(0, startTranslateY + dy);
    sidebar.style.transform = `translateY(${newY}px)`;
  }

  function onEnd(e) {
    if (!isDragging) return;
    isDragging = false;
    sidebar.style.transition = '';

    const currentY = getTranslateY(sidebar);
    const sidebarHeight = sidebar.offsetHeight;
    const collapsedY = sidebarHeight - 140;

    // If dragged past midpoint, collapse; otherwise expand
    if (currentY > collapsedY * 0.5) {
      setSheetState('collapsed');
    } else {
      setSheetState('expanded');
    }
    sidebar.style.transform = '';
  }

  handle.addEventListener('touchstart', onStart, { passive: true });
  handle.addEventListener('touchmove', onMove, { passive: true });
  handle.addEventListener('touchend', onEnd);

  // Also allow tapping handle to toggle
  handle.addEventListener('click', () => {
    const current = sidebar.getAttribute('data-sheet');
    setSheetState(current === 'collapsed' ? 'expanded' : 'collapsed');
  });
}

// ===== Handle resize =====
function handleResize() {
  if (map) {
    map.invalidateSize();
  }
}

async function init() {
  initMap();
  await loadData();
  initYearControl();
  initViewButtons();
  initBottomSheet();
  applyView('world', false);
  renderBars();
  renderSidebar();

  window.addEventListener('resize', handleResize);
}

init();
