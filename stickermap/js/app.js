// Конфигурация Firebase (авторизация, профили и крю)
const firebaseConfig = {
  apiKey: "AIzaSyBSzDos2Hc3M6XnkobN_AQ43m9h9h6WX24",
  authDomain: "stickermap-df14d.firebaseapp.com",
  projectId: "stickermap-df14d",
  storageBucket: "stickermap-df14d.firebasestorage.app",
  messagingSenderId: "223349698177",
  appId: "1:223349698177:web:4a4c4271002834c76da780",
  measurementId: "G-ZC0XLNKH8D"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
db.settings({
  experimentalForceLongPolling: true,
  experimentalAutoDetectLongPolling: false,
  merge: true
});

// Конфигурация Supabase (основная база для спотов, Storage и уведомлений)
const SUPABASE_URL = 'https://akoecseeheeafmgmrshv.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_-gyzP9Yt9YYwAdH7PQZi6g_Zk4I3VW2';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Проверка прав Владельца, Модераторов и Premium-пользователей
const urlParams = new URLSearchParams(window.location.search);
const hasAdminKey = urlParams.get('key') === 'maker77';

const OWNER_EMAILS = [
  'klimkosinov2000@gmail.com'
];

const MODERATOR_EMAILS = [];
let dynamicModerators = new Set();
let dynamicPremiumUsers = new Set();
let moderatorNumberByEmail = {};

function rebuildModeratorNumbers() {
  const allMods = Array.from(new Set([
    ...MODERATOR_EMAILS.map(e => e.trim().toLowerCase()),
    ...Array.from(dynamicModerators)
  ])).sort();
  const map = {};
  allMods.forEach((em, idx) => {
    map[em] = idx + 1;
  });
  moderatorNumberByEmail = map;
}

function getModeratorLabelByEmail(email) {
  const clean = (email || '').trim().toLowerCase();
  if (!clean) return 'Модератор';
  if (OWNER_EMAILS.includes(clean)) return 'Владелец';
  const num = moderatorNumberByEmail[clean];
  return num ? `Модер #${num}` : 'Модератор';
}

function isOwnerUser() {
  if (hasAdminKey) return true;
  const email = (currentUser && currentUser.email) ? currentUser.email.trim().toLowerCase() : '';
  return Boolean(email && OWNER_EMAILS.includes(email));
}

function isModeratorUser() {
  if (isOwnerUser()) return true;
  const email = (currentUser && currentUser.email) ? currentUser.email.trim().toLowerCase() : '';
  return Boolean(email && (MODERATOR_EMAILS.includes(email) || dynamicModerators.has(email)));
}

function isPremiumUser() {
  if (isOwnerUser()) return true;
  const email = (currentUser && currentUser.email) ? currentUser.email.trim().toLowerCase() : '';
  return Boolean(email && dynamicPremiumUsers.has(email));
}

function isSpotAuthorPremium(spot) {
  if (!spot) return false;
  if (spot.isPremium === true) return true;
  if (currentUser && spot.authorUid === currentUser.uid && isPremiumUser()) return true;
  return false;
}

// Безопасный base64 SVG-аватар
const DEFAULT_AVATAR = "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><rect width="80" height="80" fill="#222"/><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="#ffcc00" font-family="sans-serif" font-size="36" font-weight="bold">S</text></svg>');

let currentUser = null;
let userProfile = null;
let authChecked = false;
let pendingAvatarBase64 = '';
let territoryScoreByKey = {};
let staffStatusFilter = 'all'; // 'all' | 'approved' | 'pending'
let bulkSelectMode = false;
const selectedSpotIds = new Set();
let isSubmittingSpot = false;
let deepLinkHandled = false;
let refreshPatrolBadgeFn = () => {};
let renderOwnerPanelFn = () => {};
let sharedUserLocationMarker = null;

// Кэш полигонов территорий Turf.js
let cachedZonesSignature = '';
let cachedZoneGroups = {};
let cachedLeaderboardStats = [];

// Карта Leaflet
const map = L.map('map', {
  center: [55.751244, 37.618423],
  zoom: 13,
  zoomControl: false
});

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap'
}).addTo(map);

L.control.zoom({ position: 'bottomright' }).addTo(map);

let spots = [];
let markersMap = {};
let territoryLayers = [];
var markersClusterGroup = null;
let currentPhotos = [];

// DOM-элементы
const userPanel = document.getElementById('user-panel');
const authModal = document.getElementById('auth-modal');
const emailAuthForm = document.getElementById('email-auth-form');
const emailSubmitBtn = document.getElementById('btn-email-submit');

const leaderboardList = document.getElementById('leaderboard-list');
const feedList = document.getElementById('feed-list');
const filterSearchInput = document.getElementById('filter-search');
const filterTypeSelect = document.getElementById('filter-type');
const filterOnlyCrewCheck = document.getElementById('filter-only-crew');
const filterHideGoneCheck = document.getElementById('filter-hide-gone');

const profileModal = document.getElementById('profile-modal');
const profileForm = document.getElementById('profile-form');
const nicknameInput = document.getElementById('profile-nickname');
const avatarInput = document.getElementById('profile-avatar-input');
const avatarPreview = document.getElementById('profile-avatar-preview');
const colorInput = document.getElementById('profile-color');
const crewNameGroup = document.getElementById('crew-name-group');
const crewNameInput = document.getElementById('profile-crew-name');
const crewCodeInput = document.getElementById('profile-crew-code');
const saveProfileBtn = document.getElementById('btn-save-profile');

const modal = document.getElementById('spot-modal');
const modalTitle = document.getElementById('modal-title');
const spotForm = document.getElementById('spot-form');
const spotIdInput = document.getElementById('spot-id');
const hotspotAdminGroup = document.getElementById('hotspot-admin-group');
const isHotspotInput = document.getElementById('input-is-hotspot');
const titleInput = document.getElementById('input-title');
const noteInput = document.getElementById('input-note');
const statusSelect = document.getElementById('select-status');
const latInput = document.getElementById('spot-lat');
const lngInput = document.getElementById('spot-lng');
const photosInput = document.getElementById('input-photos');
const photosPreviewGrid = document.getElementById('photos-preview-grid');
const cancelBtn = document.getElementById('btn-cancel-modal');
const saveBtn = document.getElementById('btn-save-spot');

const lightbox = document.getElementById('lightbox-modal');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxClose = document.getElementById('lightbox-close');

// ==========================================
// УТИЛИТЫ: XSS-ЗАЩИТА, ДЕДУПЛИКАЦИЯ, КЛЮЧИ, РАДИУСЫ, РАНГИ
// ==========================================
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeJsString(str) {
  if (str == null) return '';
  return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function setUserGpsPosition(lat, lng) {
  if (typeof map === 'undefined') return;
  const gpsIcon = L.divIcon({
    className: '',
    html: '<div class="user-gps-dot"></div>',
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });

  if (!sharedUserLocationMarker) {
    sharedUserLocationMarker = L.marker([lat, lng], {
      icon: gpsIcon,
      zIndexOffset: 1000
    }).addTo(map);
  } else {
    sharedUserLocationMarker.setLatLng([lat, lng]);
  }
}

function deduplicateSpots(list) {
  if (!Array.isArray(list)) return [];
  const mapById = new Map();

  for (const item of list) {
    if (!item || item.id == null) continue;
    const key = String(item.id);
    const prev = mapById.get(key);
    if (prev && Array.isArray(prev.photos) && prev.photos.length > 0 && (!Array.isArray(item.photos) || item.photos.length === 0)) {
      item.photos = prev.photos;
      item.photosLoaded = true;
    }
    mapById.set(key, item);
  }

  const mapByFingerprint = new Map();
  for (const item of mapById.values()) {
    const authorKey = (item.authorUid && item.authorUid !== 'admin')
      ? String(item.authorUid).trim().toLowerCase()
      : String(item.authorName || 'anon').trim().toLowerCase();
    const titleKey = String(item.title || '').trim().toLowerCase();
    const latKey = Number(item.lat || 0).toFixed(4);
    const lngKey = Number(item.lng || 0).toFixed(4);
    const fp = `${authorKey}|${titleKey}|${latKey}|${lngKey}`;

    const existing = mapByFingerprint.get(fp);
    if (!existing) {
      mapByFingerprint.set(fp, item);
      continue;
    }

    const existingScore = (existing.approved !== false ? 2 : 0) + (getSpotPhotoUrls(existing).length > 0 ? 1 : 0);
    const currentScore = (item.approved !== false ? 2 : 0) + (getSpotPhotoUrls(item).length > 0 ? 1 : 0);

    if (currentScore > existingScore) {
      mapByFingerprint.set(fp, item);
    }
  }

  return Array.from(mapByFingerprint.values());
}

function getSpotPhotoUrls(spot) {
  if (!spot) return [];
  let rawPhotos = spot.photos;
  if (typeof rawPhotos === 'string') {
    try { rawPhotos = JSON.parse(rawPhotos); } catch (e) { rawPhotos = [rawPhotos]; }
  }
  const rawList = Array.isArray(rawPhotos) && rawPhotos.length > 0
    ? rawPhotos
    : (spot.photo ? [spot.photo] : []);
  return rawList
    .filter(p => typeof p === 'string' && p.trim().length > 10 && !p.includes('icon-512.png'))
    .map(p => p.trim());
}

function hasValidSpotPhoto(spot) {
  if (!spot) return false;
  if (spot.hasPhoto === false) return false;
  if (spot.hasPhoto === true) return true;
  if (!spot.photosLoaded) return true;
  return getSpotPhotoUrls(spot).length > 0;
}

function generateSpotId() {
  return 'sp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function getTerritoryKey(spot) {
  const hasCrew = Boolean(spot.authorCrew && spot.authorCrew.trim());
  const isCrewSpot = hasCrew && (spot.publishAs === 'crew' || spot.publishAs === undefined);

  if (isCrewSpot) {
    return 'crew_' + spot.authorCrew.trim().toLowerCase();
  }
  return 'user_' + (spot.authorUid || spot.authorName || 'unknown');
}

function getSpotRadiusKm(spot) {
  if (spot.isHotspot) {
    return (spot.status === 'damaged' ? 180 : 350) / 1000;
  }
  if (spot.spotType === 'graffiti') {
    return (spot.status === 'damaged' ? 120 : 250) / 1000;
  }
  if (spot.spotType === 'tag') {
    return (spot.status === 'damaged' ? 50 : 100) / 1000;
  }
  return (spot.status === 'damaged' ? 70 : 135) / 1000;
}

function calculateStreetRank(areaSqMeters) {
  const km2 = areaSqMeters / 1_000_000;

  if (km2 >= 2.0) {
    return {
      title: 'King of the Wall',
      nextHint: 'Максимальный уличный ранг достигнут'
    };
  }
  if (km2 >= 0.75) {
    return {
      title: 'Bomber',
      nextHint: `До King of the Wall: ${(2.0 - km2).toFixed(3)} км²`
    };
  }
  if (km2 >= 0.25) {
    return {
      title: 'Tagger',
      nextHint: `До Bomber: ${(0.75 - km2).toFixed(3)} км²`
    };
  }
  return {
    title: 'Toy',
    nextHint: `До Tagger: ${(0.25 - km2).toFixed(3)} км²`
  };
}

function getUserMetrics() {
  if (!currentUser) return { areaSqMeters: 0, totalLikes: 0 };

  const myKey = (userProfile && userProfile.crewType === 'crew' && userProfile.crewName)
    ? 'crew_' + userProfile.crewName.trim().toLowerCase()
    : 'user_' + currentUser.uid;

  const areaSqMeters = territoryScoreByKey[myKey] || 0;

  let totalLikes = 0;
  spots.forEach(s => {
    if (s.authorUid === currentUser.uid && Array.isArray(s.likes)) {
      totalLikes += s.likes.length;
    }
  });

  return { areaSqMeters, totalLikes };
}

function getTerritoryColor(spot) {
  if (spot.status === 'gone') return '#e74c3c';

  const hasCrew = Boolean(spot.authorCrew && spot.authorCrew.trim());
  const isCrewSpot = hasCrew && (spot.publishAs === 'crew' || spot.publishAs === undefined);

  if (isCrewSpot) {
    if (spot.crewColor && /^#[0-9A-Fa-f]{6}$/.test(spot.crewColor)) {
      return spot.crewColor;
    }
    const seed = spot.authorCrew.trim().toLowerCase();
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = seed.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 82%, 52%)`;
  }

  if (spot.authorColor && /^#[0-9A-Fa-f]{6}$/.test(spot.authorColor)) {
    return spot.authorColor;
  }
  return '#2ecc71';
}

function formatArea(sqMeters) {
  return (sqMeters / 1_000_000).toFixed(3) + ' км²';
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return 'недавно';
  const diffMin = Math.floor((Date.now() - timestamp) / 60000);
  if (diffMin < 1) return 'только что';
  if (diffMin < 60) return `${diffMin} мин. назад`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs} ч. назад`;
  return `${Math.floor(diffHrs / 24)} дн. назад`;
}

// ==========================================
// 1. УПРАВЛЕНИЕ ВИДЖЕТАМИ HUD И ФИЛЬТРАМИ
// ==========================================
function bindHudToggle(btnId, bodyId, arrowId) {
  document.getElementById(btnId)?.addEventListener('click', () => {
    document.getElementById(bodyId)?.classList.toggle('hidden');
    document.getElementById(arrowId)?.classList.toggle('open');
  });
}

bindHudToggle('btn-toggle-leaderboard', 'leaderboard-body', 'leaderboard-arrow');
bindHudToggle('btn-toggle-feed', 'feed-body', 'feed-arrow');
bindHudToggle('btn-toggle-filters', 'filters-body', 'filters-arrow');

const searchSuggestionsBox = document.getElementById('search-suggestions');
let searchDebounceTimer = null;
let placeSearchAbortCtrl = null;

filterSearchInput?.addEventListener('input', () => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(async () => {
    renderMarkers();
    await updateSearchSuggestions();
  }, 300);
});

filterSearchInput?.addEventListener('focus', () => {
  if (filterSearchInput.value.trim().length >= 2) {
    updateSearchSuggestions();
  }
});

document.addEventListener('click', (e) => {
  if (searchSuggestionsBox && !searchSuggestionsBox.contains(e.target) && e.target !== filterSearchInput) {
    searchSuggestionsBox.classList.add('hidden');
  }
});

async function updateSearchSuggestions() {
  if (!searchSuggestionsBox || !filterSearchInput) return;
  const rawQuery = filterSearchInput.value.trim();
  const q = rawQuery.toLowerCase();

  if (q.length < 2) {
    searchSuggestionsBox.classList.add('hidden');
    searchSuggestionsBox.innerHTML = '';
    return;
  }

  let html = '';

  // 1. Поиск по никам авторов и крю
  const authorsMap = new Map();
  spots.forEach(s => {
    if (s.approved === false && !isModeratorUser()) return;
    const name = (s.authorName || '').trim();
    if (!name) return;
    if (name.toLowerCase().includes(q) || (s.authorCrew || '').toLowerCase().includes(q)) {
      const key = name.toLowerCase();
      if (!authorsMap.has(key)) {
        authorsMap.set(key, { name, crew: s.authorCrew || '', count: 1 });
      } else {
        authorsMap.get(key).count += 1;
      }
    }
  });

  const matchedAuthors = Array.from(authorsMap.values()).slice(0, 4);
  if (matchedAuthors.length > 0) {
    html += `<div class="search-sug-group">Авторы и крю</div>`;
    html += matchedAuthors.map(a => `
      <div class="search-sug-item" data-sug-type="author" data-author="${escapeHtml(a.name)}">
        <div><b>${escapeHtml(a.name)}</b> ${a.crew ? `<span style="color:#ffcc00;">[${escapeHtml(a.crew)}]</span>` : ''}</div>
        <div class="search-sug-sub">Открыть профиль • Работ: ${a.count}</div>
      </div>
    `).join('');
  }

  // 2. Поиск по названиям работ на карте
  const matchedSpots = spots
    .filter(s => (s.approved !== false || isModeratorUser()) && (s.title || '').toLowerCase().includes(q))
    .slice(0, 4);

  if (matchedSpots.length > 0) {
    html += `<div class="search-sug-group">Точки на карте</div>`;
    html += matchedSpots.map(s => `
      <div class="search-sug-item" data-sug-type="spot" data-id="${escapeHtml(s.id)}" data-lat="${s.lat}" data-lng="${s.lng}">
        <div><b>${escapeHtml(s.title)}</b></div>
        <div class="search-sug-sub">Автор: ${escapeHtml(s.authorName || 'Автор')}</div>
      </div>
    `).join('');
  }

  // 3. Поиск по месту / адресу / метро (OpenStreetMap Nominatim)
  if (rawQuery.length >= 3) {
    try {
      if (placeSearchAbortCtrl) placeSearchAbortCtrl.abort();
      placeSearchAbortCtrl = new AbortController();

      const resp = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=4&accept-language=ru&q=${encodeURIComponent(rawQuery)}`,
        { signal: placeSearchAbortCtrl.signal }
      );
      if (resp.ok) {
        const places = await resp.json();
        if (Array.isArray(places) && places.length > 0) {
          html += `<div class="search-sug-group">Места и адреса</div>`;
          html += places.map(p => {
            const parts = (p.display_name || '').split(',');
            const shortTitle = parts.slice(0, 2).join(',').trim();
            const subAddr = parts.slice(2, 4).join(',').trim();
            return `
              <div class="search-sug-item" data-sug-type="place" data-lat="${p.lat}" data-lng="${p.lon}">
                <div><b>${escapeHtml(shortTitle)}</b></div>
                <div class="search-sug-sub">${escapeHtml(subAddr || p.display_name)}</div>
              </div>
            `;
          }).join('');
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') console.warn('Ошибка геокодинга:', err);
    }
  }

  if (!html) {
    searchSuggestionsBox.innerHTML = `<div class="search-sug-item" style="color:#94a3b8; cursor:default;">Ничего не найдено</div>`;
  } else {
    searchSuggestionsBox.innerHTML = html;
  }
  searchSuggestionsBox.classList.remove('hidden');
}

searchSuggestionsBox?.addEventListener('click', (e) => {
  const item = e.target.closest('.search-sug-item');
  if (!item || !item.dataset.sugType) return;

  const type = item.dataset.sugType;
  searchSuggestionsBox.classList.add('hidden');

  if (type === 'author') {
    window.openAuthorCard(item.dataset.author);
  } else if (type === 'spot') {
    filterSearchInput.value = '';
    renderMarkers();
    window.flyToSpot(item.dataset.id, parseFloat(item.dataset.lat), parseFloat(item.dataset.lng));
  } else if (type === 'place') {
    filterSearchInput.value = '';
    renderMarkers();
    map.flyTo([parseFloat(item.dataset.lat), parseFloat(item.dataset.lng)], 16, { duration: 1.1 });
  }
});
filterTypeSelect?.addEventListener('change', renderMarkers);
filterOnlyCrewCheck?.addEventListener('change', renderMarkers);
filterHideGoneCheck?.addEventListener('change', renderMarkers);

// ==========================================
// 2. АВТОРИЗАЦИЯ И ПРОФИЛЬ
// ==========================================
document.getElementById('toggle-password')?.addEventListener('click', () => {
  const passInput = document.getElementById('auth-password');
  if (!passInput) return;
  passInput.type = passInput.type === 'password' ? 'text' : 'password';
});

emailAuthForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  sessionStorage.removeItem('guest_mode_chosen');

  emailSubmitBtn.disabled = true;
  emailSubmitBtn.textContent = 'Вход...';

  try {
    await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    await auth.signInWithEmailAndPassword(email, password);
    authModal.classList.add('hidden');
  } catch (err) {
    if (
      err.code === 'auth/user-not-found' ||
      err.code === 'auth/invalid-credential' ||
      err.code === 'auth/invalid-login-credentials'
    ) {
      const wantRegister = confirm(
        `Аккаунт для ${email} не найден или пароль неверный.\n\nНажми ОК, чтобы создать НОВЫЙ аккаунт с этой почтой, или Отмена, чтобы проверить почту/пароль.`
      );
      if (!wantRegister) return;

      try {
        await auth.createUserWithEmailAndPassword(email, password);
        authModal.classList.add('hidden');
      } catch (regErr) {
        if (regErr.code === 'auth/email-already-in-use') {
          alert('Аккаунт с этой почтой уже существует, но введён неверный пароль!');
        } else if (regErr.code === 'auth/weak-password') {
          alert('Пароль должен содержать минимум 6 символов.');
        } else {
          alert(`Ошибка регистрации: ${regErr.message}`);
        }
      }
    } else if (err.code === 'auth/wrong-password') {
      alert('Неверный пароль.');
    } else if (err.code === 'auth/invalid-email') {
      alert('Введи корректный адрес электронной почты.');
    } else {
      alert(`Ошибка входа: ${err.message}`);
    }
  } finally {
    emailSubmitBtn.disabled = false;
    emailSubmitBtn.textContent = 'Войти / Зарегистрироваться';
  }
});

document.getElementById('btn-guest-mode').addEventListener('click', () => {
  sessionStorage.setItem('guest_mode_chosen', 'true');
  authModal.classList.add('hidden');
});

auth.onAuthStateChanged((fbUser) => {
  if (fbUser) {
    authModal.classList.add('hidden');
    const nameFromEmail = fbUser.email ? fbUser.email.split('@')[0] : 'Автор';
    handleUserSignedIn({
      uid: fbUser.uid,
      email: fbUser.email,
      defaultName: nameFromEmail
    });
  } else {
    currentUser = null;
    userProfile = null;
    renderUserPanel();
    renderMarkers();

    if (!authChecked && !isOwnerUser() && !sessionStorage.getItem('guest_mode_chosen')) {
      authModal.classList.remove('hidden');
    }
  }
  authChecked = true;
});

async function handleUserSignedIn(userObj) {
  currentUser = userObj;

  // Гарантированно дожидаемся загрузки ролей (модераторов и Premium) из Supabase
  await loadStaffRoles();

  const localRaw = localStorage.getItem(`sm_profile_${userObj.uid}`);
  if (localRaw) {
    try {
      userProfile = JSON.parse(localRaw);
      renderUserPanel();
    } catch (e) {}
  }

  if (isOwnerUser() && !userProfile) {
    userProfile = {
      uid: userObj.uid,
      email: userObj.email || '',
      nickname: userObj.defaultName || 'Owner',
      nicknameLower: (userObj.defaultName || 'owner').toLowerCase(),
      avatarUrl: '',
      zoneColor: '#ffd60a',
      crewType: 'solo',
      crewName: '',
      crewCode: '',
      role: 'owner',
      updatedAt: Date.now()
    };
    localStorage.setItem(`sm_profile_${userObj.uid}`, JSON.stringify(userProfile));
    renderUserPanel();
  }

  checkUserNotifications(userObj.uid);

  try {
    const doc = await db.collection('users').doc(userObj.uid).get();
    if (doc.exists) {
      const cloudData = doc.data();
      if (!userProfile || (cloudData.updatedAt || 0) >= (userProfile.updatedAt || 0)) {
        userProfile = cloudData;
        localStorage.setItem(`sm_profile_${userObj.uid}`, JSON.stringify(userProfile));
      }
      renderUserPanel();
      await claimLegacySpots();
      renderMarkers();
    } else if (!userProfile) {
      openProfileModal();
    } else {
      await claimLegacySpots();
      renderMarkers();
    }
  } catch (err) {
    console.warn('Firestore недоступен или квота исчерпана, используем локальный профиль:', err);
    if (!userProfile) {
      openProfileModal();
    } else {
      await claimLegacySpots();
      renderMarkers();
    }
  }
}

async function checkUserNotifications(uid) {
  if (!uid) return;
  try {
    const { data, error } = await supabaseClient
      .from('notifications')
      .select('*')
      .eq('user_uid', uid)
      .eq('is_read', false)
      .order('created_at', { ascending: false });

    if (error || !data || data.length === 0) return;

    document.getElementById('sm-rejection-banner')?.remove();

    const banner = document.createElement('div');
    banner.id = 'sm-rejection-banner';
    banner.style.cssText = `
      position: fixed; bottom: 86px; left: 50%; transform: translateX(-50%);
      width: calc(100% - 28px); max-width: 400px; z-index: 9500;
      background: #18181b; color: #fff; border: 1px solid #ef4444;
      border-radius: 14px; padding: 14px 16px; box-shadow: 0 12px 30px rgba(0,0,0,0.65);
    `;

    const listHtml = data.map(n => `
      <div style="padding: 6px 0; border-top: 1px solid rgba(255,255,255,0.08); font-size: 13px;">
        <div style="font-weight: 700; color: #fca5a5;">Спот «${escapeHtml(n.spot_title || 'Без названия')}» не прошёл проверку</div>
        <div style="color: #e4e4e7; margin-top: 2px;">Причина: <b>${escapeHtml(n.reason || 'Не соответствует правилам')}</b></div>
      </div>
    `).join('');

    banner.innerHTML = `
      <div style="font-size: 12px; font-weight: 800; text-transform: uppercase; color: #ef4444; margin-bottom: 6px;">
        Уведомление модерации (${data.length})
      </div>
      ${listHtml}
      <button type="button" id="btn-dismiss-notifs" style="margin-top: 10px; width: 100%; padding: 8px; border: none; border-radius: 8px; background: #ef4444; color: #fff; font-weight: 700; font-size: 13px; cursor: pointer;">
        Понятно
      </button>
    `;

    document.body.appendChild(banner);

    document.getElementById('btn-dismiss-notifs').onclick = async () => {
      banner.remove();
      const ids = data.map(item => item.id);
      await supabaseClient.from('notifications').update({ is_read: true }).in('id', ids);
    };
  } catch (e) {
    console.warn('Ошибка загрузки уведомлений:', e);
  }
}

function renderUserPanel() {
  refreshPatrolBadgeFn();
  renderOwnerPanelFn();

  const staffFilterBlock = document.getElementById('staff-map-filter-block');
  const bulkSelectBtn = document.getElementById('btn-toggle-bulk-select');
  if (staffFilterBlock) {
    if (isModeratorUser()) {
      staffFilterBlock.classList.remove('hidden');
      if (bulkSelectBtn) {
        bulkSelectBtn.classList.toggle('hidden', !isOwnerUser());
      }
    } else {
      staffFilterBlock.classList.add('hidden');
      staffStatusFilter = 'all';
    }
  }

  if (!currentUser) {
    userPanel.innerHTML = `<button id="btn-open-auth" class="btn-auth-trigger">Войти / Регистрация</button>`;
    document.getElementById('btn-open-auth').addEventListener('click', () => {
      authModal.classList.remove('hidden');
    });
    return;
  }

  const nick = userProfile ? userProfile.nickname : currentUser.defaultName;
  const safeNick = escapeHtml(nick);
  const avatarSrc = (userProfile && userProfile.avatarUrl) ? escapeHtml(userProfile.avatarUrl) : DEFAULT_AVATAR;
  const borderCol = isPremiumUser()
    ? '#ffd60a'
    : ((userProfile && userProfile.zoneColor) ? escapeHtml(userProfile.zoneColor) : '#ffcc00');

  const { areaSqMeters, totalLikes } = getUserMetrics();
  const rankInfo = calculateStreetRank(areaSqMeters, totalLikes);

  let staffBadge = '';
  if (isOwnerUser()) {
    staffBadge = `<span style="background:linear-gradient(135deg,#ffd60a,#f59e0b); color:#111; font-size:10px; padding:2px 6px; border-radius:5px; font-weight:800; letter-spacing:0.03em; text-transform:uppercase;">Владелец</span>`;
  } else if (isModeratorUser()) {
    staffBadge = `<span style="background:#3b82f6; color:#fff; font-size:10px; padding:2px 6px; border-radius:5px; font-weight:800; letter-spacing:0.03em; text-transform:uppercase;">Модератор</span>`;
  }

  const premiumBadge = (!isOwnerUser() && isPremiumUser())
    ? `<span class="premium-badge-pill">PREMIUM</span>`
    : '';

  const crewBadge = (userProfile && userProfile.crewType === 'crew' && userProfile.crewName)
    ? `<span class="user-crew-tag" style="background:${borderCol}; color:#111;">[${escapeHtml(userProfile.crewName)}]</span>`
    : `<span style="font-size:10px; color:#a1a1aa;">(Solo)</span>`;

  userPanel.innerHTML = `
    <div class="user-badge" id="btn-edit-profile" title="Ранг: ${escapeHtml(rankInfo.title)} • Настройки профиля">
      <img class="user-badge-avatar" src="${avatarSrc}" style="border-color:${borderCol};">
      <span>${safeNick}</span>
      ${staffBadge}
      ${premiumBadge}
      <span class="user-rank-mini">${escapeHtml(rankInfo.title)}</span>
      ${crewBadge}
    </div>
  `;

  document.getElementById('btn-edit-profile').addEventListener('click', openProfileModal);
}

document.querySelectorAll('.swatch-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    colorInput.value = btn.dataset.color;
  });
});

avatarInput?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    pendingAvatarBase64 = await uploadPhotoToStorage(file, 'avatars', 180);
    if (avatarPreview) avatarPreview.src = pendingAvatarBase64;
  } catch (err) {
    alert('Ошибка загрузки аватарки: ' + err.message);
  }
});

function openProfileModal() {
  const { areaSqMeters, totalLikes } = getUserMetrics();
  const rankInfo = calculateStreetRank(areaSqMeters, totalLikes);

  const rankBadgeEl = document.getElementById('profile-rank-badge');
  const rankStatsEl = document.getElementById('profile-rank-stats');
  const rankNextEl = document.getElementById('profile-rank-next');
  if (rankBadgeEl) rankBadgeEl.textContent = isPremiumUser() ? `${rankInfo.title} • PREMIUM` : rankInfo.title;
  if (rankStatsEl) rankStatsEl.textContent = `${formatArea(areaSqMeters)} • ${totalLikes} респектов`;
  if (rankNextEl) rankNextEl.textContent = rankInfo.nextHint;

  nicknameInput.value = userProfile ? userProfile.nickname : (currentUser ? currentUser.defaultName : '');
  if (colorInput) colorInput.value = (userProfile && userProfile.zoneColor) ? userProfile.zoneColor : '#2ecc71';
  pendingAvatarBase64 = (userProfile && userProfile.avatarUrl) ? userProfile.avatarUrl : '';
  if (avatarPreview) avatarPreview.src = pendingAvatarBase64 || DEFAULT_AVATAR;

  const type = userProfile ? userProfile.crewType : 'solo';
  document.querySelector(`input[name="crewType"][value="${type}"]`).checked = true;

  if (type === 'crew') {
    crewNameGroup.classList.remove('hidden');
    crewNameInput.value = userProfile ? (userProfile.crewName || '') : '';
    if (crewCodeInput) crewCodeInput.value = userProfile ? (userProfile.crewCode || '') : '';
  } else {
    crewNameGroup.classList.add('hidden');
    crewNameInput.value = '';
    if (crewCodeInput) crewCodeInput.value = '';
  }

  profileModal.classList.remove('hidden');
}

document.querySelectorAll('input[name="crewType"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    if (e.target.value === 'crew') {
      crewNameGroup.classList.remove('hidden');
      crewNameInput.required = true;
      if (crewCodeInput) crewCodeInput.required = true;
    } else {
      crewNameGroup.classList.add('hidden');
      crewNameInput.required = false;
      if (crewCodeInput) crewCodeInput.required = false;
    }
  });
});

profileForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser) return;

  const rawNick = nicknameInput.value.trim() || currentUser.defaultName;
  const nickLower = rawNick.toLowerCase();
  const chosenColor = colorInput ? colorInput.value : '#2ecc71';
  const crewType = document.querySelector('input[name="crewType"]:checked').value;
  const rawCrewName = crewNameInput.value.trim();
  const rawCrewCode = crewCodeInput ? crewCodeInput.value.trim() : '';

  if (crewType === 'crew' && (!rawCrewName || !rawCrewCode)) {
    alert('Укажи название крю и секретный инвайт-код!');
    return;
  }

  saveProfileBtn.disabled = true;
  saveProfileBtn.textContent = 'Проверка...';

  try {
    let finalZoneColor = chosenColor;

    const nickConflictInSpots = spots.some(
      s => s.authorUid && s.authorUid !== currentUser.uid &&
      s.authorName && s.authorName.trim().toLowerCase() === nickLower
    );
    const isSameAsCurrentNick = userProfile &&
      userProfile.nickname &&
      userProfile.nickname.trim().toLowerCase() === nickLower;

    if (nickConflictInSpots && !isSameAsCurrentNick && !isOwnerUser()) {
      alert(`Ник «${rawNick}» уже занят другим игроком! Придумай другой.`);
      return;
    }

    let crewRef = null;
    let crewDocExists = false;
    let crewOwnerUid = currentUser.uid;

    if (crewType === 'crew') {
      try {
        const crewId = rawCrewName.toLowerCase();
        crewRef = db.collection('crews').doc(crewId);
        const crewDoc = await crewRef.get();

        if (crewDoc.exists) {
          crewDocExists = true;
          const crewData = crewDoc.data();
          if (crewData.inviteCode !== rawCrewCode && !isOwnerUser()) {
            alert(`Неверный инвайт-код для крю «${rawCrewName}»! Спроси код у основателя команды.`);
            return;
          }
          crewOwnerUid = crewData.ownerUid || '';
          if (crewOwnerUid !== currentUser.uid && crewData.color) {
            finalZoneColor = crewData.color;
          }
        }
      } catch (crewCheckErr) {
        console.warn('Не удалось проверить крю в Firestore:', crewCheckErr);
      }
    }

    saveProfileBtn.textContent = 'Сохранение...';

    const profileData = {
      uid: currentUser.uid,
      email: currentUser.email || '',
      nickname: rawNick,
      nicknameLower: nickLower,
      avatarUrl: pendingAvatarBase64 || '',
      zoneColor: finalZoneColor,
      crewType: crewType,
      crewName: crewType === 'crew' ? rawCrewName : '',
      crewCode: crewType === 'crew' ? rawCrewCode : '',
      updatedAt: Date.now()
    };

    userProfile = profileData;
    localStorage.setItem(`sm_profile_${currentUser.uid}`, JSON.stringify(profileData));
    profileModal.classList.add('hidden');
    renderUserPanel();

    await syncUserSpotsMetadata();
    await claimLegacySpots();
    renderMarkers();

    try {
      if (crewType === 'crew' && crewRef) {
        if (crewDocExists) {
          if (crewOwnerUid === currentUser.uid) {
            await crewRef.update({ color: chosenColor });
          }
        } else {
          await crewRef.set({
            name: rawCrewName,
            inviteCode: rawCrewCode,
            color: chosenColor,
            ownerUid: currentUser.uid,
            createdAt: Date.now()
          });
        }
      }
      await db.collection('users').doc(currentUser.uid).set(userProfile);
    } catch (fsErr) {
      console.warn('Firestore не принял запись (лимит квоты), профиль сохранён локально и в Supabase:', fsErr);
    }
  } finally {
    saveProfileBtn.disabled = false;
    saveProfileBtn.textContent = 'Сохранить';
  }
});

async function claimLegacySpots() {
  if (!currentUser || !userProfile || !Array.isArray(spots) || spots.length === 0) return;

  const myNickLower = userProfile.nickname.trim().toLowerCase();
  const legacySpots = spots.filter(s =>
    !s.authorUid ||
    s.authorUid === 'admin' ||
    (s.authorUid !== currentUser.uid && s.authorName && s.authorName.trim().toLowerCase() === myNickLower)
  );
  if (legacySpots.length === 0) return;

  const updates = {
    authorUid: currentUser.uid,
    authorName: userProfile.nickname,
    authorAvatar: userProfile.avatarUrl || '',
    authorColor: userProfile.zoneColor || '#2ecc71',
    authorCrew: userProfile.crewType === 'crew' ? userProfile.crewName : '',
    isPremium: isPremiumUser()
  };

  try {
    const ids = legacySpots.map(s => s.id);
    const { error: claimErr } = await supabaseClient.from('stickers').update(updates).in('id', ids);
    if (claimErr && String(claimErr.message || '').includes('isPremium')) {
      const updNoPrem = { ...updates };
      delete updNoPrem.isPremium;
      await supabaseClient.from('stickers').update(updNoPrem).in('id', ids);
    }
    legacySpots.forEach(spot => Object.assign(spot, updates));
    syncLocalSpotsCache();
  } catch (err) {
    console.error('Ошибка привязки старых точек в Supabase:', err);
  }
}

async function syncUserSpotsMetadata() {
  if (!currentUser || !userProfile) return;

  const newCrew = userProfile.crewType === 'crew' ? userProfile.crewName : '';
  const newColor = userProfile.zoneColor || '#2ecc71';
  const newAvatar = userProfile.avatarUrl || '';
  const newPremium = isPremiumUser();

  const myOutdatedSpots = spots.filter(
    s => s.authorUid === currentUser.uid && (
      s.authorName !== userProfile.nickname ||
      (s.authorCrew || '') !== newCrew ||
      (s.authorColor || '') !== newColor ||
      (s.authorAvatar || '') !== newAvatar ||
      Boolean(s.isPremium) !== newPremium
    )
  );

  if (myOutdatedSpots.length === 0) return;

  const updates = {
    authorName: userProfile.nickname,
    authorCrew: newCrew,
    authorColor: newColor,
    authorAvatar: newAvatar,
    isPremium: newPremium
  };

  try {
    const { error: syncErr } = await supabaseClient.from('stickers').update(updates).eq('authorUid', currentUser.uid);
    if (syncErr && String(syncErr.message || '').includes('isPremium')) {
      const updNoPrem = { ...updates };
      delete updNoPrem.isPremium;
      await supabaseClient.from('stickers').update(updNoPrem).eq('authorUid', currentUser.uid);
    }
    myOutdatedSpots.forEach(spot => Object.assign(spot, updates));
    syncLocalSpotsCache();
  } catch (err) {
    console.error('Ошибка обновления метаданных точек в Supabase:', err);
  }
}

document.getElementById('btn-logout').addEventListener('click', async () => {
  await auth.signOut();
  currentUser = null;
  userProfile = null;
  profileModal.classList.add('hidden');
  renderUserPanel();
  renderMarkers();
});

// ==========================================
// 3. ОТРИСОВКА КАРТЫ, ТЕРРИТОРИЙ, ТОПА И ЛЕНТЫ
// ==========================================
function createPin(spot, color) {
  const pendingClass = spot.approved === false ? 'pin-pending' : '';
  const isHotspot = Boolean(spot.isHotspot);
  const isGraffiti = spot.spotType === 'graffiti';
  const isPrem = isSpotAuthorPremium(spot);
const isBulkSelected = bulkSelectMode && selectedSpotIds.has(String(spot.id));
  let extraClass = '';
  if (isHotspot) {
    extraClass = 'pin-hotspot';
  } else if (isGraffiti) {
    extraClass = 'pin-graffiti';
  }
  if (isPrem) {
    extraClass += ' pin-premium';
  }
  if (bulkSelectMode && selectedSpotIds.has(String(spot.id))) {
    extraClass += ' pin-bulk-selected';
  }

  const bgColor = spot.status === 'gone' ? '#e74c3c' : color;
  const authorNick = escapeHtml(spot.authorName || 'Автор');
  const crewTag = spot.authorCrew ? ` [${escapeHtml(spot.authorCrew)}]` : '';

  const photos = getSpotPhotoUrls(spot);
  const photoUrl = photos.length > 0 ? escapeHtml(photos[0]) : '';
  const bgStyle = photoUrl
    ? `background-image: url('${photoUrl}'); background-size: cover; background-position: center;`
    : `background-color: ${bgColor};`;

  const pinBorder = isPrem ? '#ffd60a' : bgColor;

  return L.divIcon({
    className: 'custom-pin-container',
    html: `
      <div class="pin-wrapper">
        <div class="custom-pin ${extraClass} ${pendingClass}" style="border: 3px solid ${pinBorder}; background-color: ${bgColor}; ${bgStyle}"></div>
        <div class="pin-author-label">${isHotspot ? '[TOP] ' : ''}${authorNick}${crewTag}</div>
      </div>
    `,
    iconSize: [0, 0],
    iconAnchor: [0, 0]
  });
}

function getStatusText(status) {
  if (status === 'ok') return 'Цел (Территория активна)';
  if (status === 'damaged') return 'Потрёпан / Выцвел (Ослаблен)';
  return 'Сорван / Закрашен';
}

const visibleSpotTypes = new Set(['sticker', 'graffiti', 'tag']);

function buildSpotPopupDom(spot) {
  const isMod = isModeratorUser();
  const isApproved = spot.approved !== false;
  const isAuthor = currentUser && spot.authorUid === currentUser.uid;
  const spotType = ['graffiti', 'tag'].includes(spot.spotType) ? spot.spotType : 'sticker';
  const isHotspot = Boolean(spot.isHotspot);
  const isPrem = isSpotAuthorPremium(spot);
  const photoValid = hasValidSpotPhoto(spot);
  const zoneColor = getTerritoryColor(spot);
  const dateStr = spot.createdAt
    ? new Date(spot.createdAt).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '';

  const container = document.createElement('div');
  container.style.cssText = 'font-size:13px; line-height:1.4; min-width:205px;';

  const moderationBadge = !isApproved
    ? `<div style="background:#fff3cd; color:#856404; font-size:11px; padding:3px 6px; border-radius:4px; margin-bottom:5px; font-weight:700;">На проверке модерации</div>`
    : '';

  const photoList = getSpotPhotoUrls(spot);
  let galleryHtml = '';
  if (photoList.length > 0) {
    galleryHtml = `<div class="popup-gallery" style="margin-bottom:6px;">` +
      photoList.map(src => `<img class="popup-thumb popup-gallery-img" src="${escapeHtml(src)}" onclick="openLightbox('${escapeJsString(src)}')" style="width:100%; max-height:185px; object-fit:cover; border-radius:6px; margin-bottom:6px; display:block; cursor:pointer;">`).join('') +
      `</div>`;
  } else if (!photoValid) {
    galleryHtml = `<div style="background:rgba(239,68,68,0.14); color:#fca5a5; border:1px dashed #ef4444; font-size:11px; padding:6px; border-radius:6px; margin-bottom:6px; text-align:center;">Пост без фото</div>`;
  } else {
    galleryHtml = `<div class="popup-gallery" style="margin-bottom:6px; font-size:11px; color:#888; text-align:center; padding:8px; background:#f4f4f6; border-radius:6px;">Загрузка фото...</div>`;
  }

  const hotspotBadgeHtml = isHotspot
    ? `<span class="popup-type-badge hotspot">Горячая точка (x2)</span>`
    : '';

  const typeBadgeHtml = spotType === 'graffiti'
    ? `<span class="popup-type-badge graffiti">Граффити (${isHotspot ? '350' : '250'} м)</span>`
    : spotType === 'tag'
      ? `<span class="popup-type-badge tag">Тег (${isHotspot ? '350' : '100'} м)</span>`
      : `<span class="popup-type-badge sticker">Стикер (${isHotspot ? '350' : '135'} м)</span>`;

  const authorName = escapeHtml(spot.authorName || 'Автор');
  const authorAvatar = escapeHtml(spot.authorAvatar || DEFAULT_AVATAR);
  const premTag = isPrem ? `<span class="premium-badge-pill">PREMIUM</span>` : '';
  const crewLabel = spot.authorCrew
    ? ` <strong style="color:${zoneColor};">[${escapeHtml(spot.authorCrew)}]</strong>`
    : ` <span style="color:#888;">(Solo)</span>`;

  const likesArr = Array.isArray(spot.likes) ? spot.likes : [];
  const hasLiked = currentUser && likesArr.includes(currentUser.uid);
  const safeSpotIdJs = escapeJsString(spot.id);

  let actionButtons = '';
  if (isApproved) {
    actionButtons += `
      <button type="button" class="popup-btn btn-respect-popup ${hasLiked ? 'liked' : ''}" onclick="toggleRespect('${safeSpotIdJs}', this)">
        Респект (${likesArr.length})
      </button>
    `;
  }
  if (isMod && !isApproved) {
    actionButtons += `<button type="button" class="popup-btn btn-approve-popup" onclick="approveSpot('${safeSpotIdJs}')">Одобрить на карту</button>`;
  }
  if (isMod || isAuthor) {
    actionButtons += `
      <button type="button" class="popup-btn btn-edit-popup" onclick="openEditModal('${safeSpotIdJs}')">Редактировать</button>
      <button type="button" class="popup-btn btn-delete-popup" onclick="deleteSpot('${safeSpotIdJs}')">Удалить</button>
    `;
  } else if (currentUser) {
    const alreadyReported = Array.isArray(spot.reportedBy) && spot.reportedBy.includes(currentUser.uid);
    actionButtons += alreadyReported
      ? `<div style="font-size:11px; color:#999; margin-top:6px;">Жалоба отправлена</div>`
      : `<button type="button" class="popup-btn btn-report-popup" onclick="reportSpot('${safeSpotIdJs}')">Пожаловаться</button>`;
  }

  container.innerHTML = `
    ${moderationBadge}
    ${galleryHtml}
    <div>${hotspotBadgeHtml}${typeBadgeHtml}</div>
    <strong style="font-size:14px; display:block;">${escapeHtml(spot.title)}</strong>
    <div class="popup-author-row">
      <img class="popup-author-avatar" src="${authorAvatar}">
      <span>${authorName} ${premTag}${crewLabel}</span>
    </div>
    ${spot.approvedByLabel ? `<div style="font-size:11px; color:#64748b; margin:2px 0 4px;">Принял: <b>${escapeHtml(spot.approvedByLabel)}</b></div>` : ''}
    ${dateStr ? `<div style="font-size:11px; color:#64748b; margin:2px 0 4px;">Добавлено: ${dateStr}</div>` : ''}
    <p style="color:#444; margin:4px 0;">${escapeHtml(spot.note || 'Без описания')}</p>
    <span style="font-size:11px; padding:2px 6px; border-radius:4px; font-weight:600; ${
      spot.status === 'ok' ? 'background:#eafaf1; color:#27ae60;' :
      spot.status === 'damaged' ? 'background:#fef8e7; color:#f39c12;' :
      'background:#fbeeed; color:#e74c3c;'
    }">${getStatusText(spot.status)}</span>
    ${actionButtons}
  `;

  // Социальная панель (На месте / Нет на месте / Поделиться / Профиль)
  const rawAuthor = spot.authorName || spot.author || spot.username;
  const bar = document.createElement('div');
  bar.className = 'spot-social-bar';
  const aliveCount = spot.aliveVotes || 0;
  const buffCount = spot.buffVotes || 0;
  const votedKey = `voted_${spot.id}`;
  const previousVote = localStorage.getItem(votedKey);

  bar.innerHTML = `
    <button type="button" class="spot-social-btn ${previousVote === 'alive' ? 'voted-active' : previousVote ? 'voted-disabled' : ''}" data-action="alive">
      На месте (${aliveCount})
    </button>
    <button type="button" class="spot-social-btn ${previousVote === 'buff' ? 'voted-buff' : previousVote ? 'voted-disabled' : ''}" data-action="buff">
      Нет на месте (${buffCount})
    </button>
    <button type="button" class="spot-social-btn" data-action="share">Поделиться ссылкой</button>
    ${rawAuthor ? `<button type="button" class="spot-social-btn" data-action="profile" style="grid-column: 1 / -1; background: #1e293b !important; color: #f8fafc !important;">Профиль: ${escapeHtml(rawAuthor)}</button>` : ''}
  `;

  const aliveBtn = bar.querySelector('[data-action="alive"]');
  const buffBtn = bar.querySelector('[data-action="buff"]');

  bar.addEventListener('click', async (btnEvent) => {
    const btn = btnEvent.target.closest('button');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'profile' && rawAuthor) {
      window.openAuthorCard(rawAuthor);
      return;
    }

    if (action === 'share') {
      const shareUrl = `${window.location.origin}${window.location.pathname}?spot=${encodeURIComponent(spot.id)}`;
      if (navigator.share) {
        try {
          await navigator.share({ title: spot.title || 'StickerMap', url: shareUrl });
          return;
        } catch (err) {
          if (err && err.name === 'AbortError') return;
        }
      }
      let copied = false;
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(shareUrl);
          copied = true;
        }
      } catch (err) {}
      if (!copied) {
        const tempInput = document.createElement('input');
        tempInput.value = shareUrl;
        document.body.appendChild(tempInput);
        tempInput.select();
        tempInput.setSelectionRange(0, 99999);
        try { copied = document.execCommand('copy'); } catch (err) {}
        tempInput.remove();
      }
      if (copied) {
        btn.textContent = 'Ссылка скопирована';
        setTimeout(() => (btn.textContent = 'Поделиться ссылкой'), 2000);
      } else {
        prompt('Скопируй ссылку на спот:', shareUrl);
      }
      return;
    }

    if (localStorage.getItem(votedKey)) return;

    if (action === 'alive') {
      const nextAlive = aliveCount + 1;
      await supabaseClient.from('stickers').update({ aliveVotes: nextAlive, status: 'ok' }).eq('id', spot.id);
      spot.aliveVotes = nextAlive;
      spot.status = 'ok';
      localStorage.setItem(votedKey, 'alive');
      aliveBtn.textContent = `На месте (${nextAlive})`;
      aliveBtn.classList.add('voted-active');
      buffBtn.classList.add('voted-disabled');
      syncLocalSpotsCache();
    }

    if (action === 'buff') {
      const nextBuff = buffCount + 1;
      const updates = { buffVotes: nextBuff };
      if (nextBuff >= 3) updates.status = 'gone';
      await supabaseClient.from('stickers').update(updates).eq('id', spot.id);
      Object.assign(spot, updates);
      localStorage.setItem(votedKey, 'buff');
      buffBtn.textContent = `Нет на месте (${nextBuff})`;
      buffBtn.classList.add('voted-buff');
      aliveBtn.classList.add('voted-disabled');
      syncLocalSpotsCache();
    }
  });

  container.appendChild(bar);

  // Асинхронная подгрузка фото прямо в этот DOM-элемент, если они ещё не в памяти
  if (photoList.length === 0 && !spot.photosLoaded) {
    supabaseClient
      .from('stickers')
      .select('photos')
      .eq('id', spot.id)
      .single()
      .then(({ data }) => {
        const galEl = container.querySelector('.popup-gallery');
        if (!data || !data.photos) {
          if (galEl) galEl.remove();
          return;
        }
        let parsed = data.photos;
        if (typeof parsed === 'string') {
          try { parsed = JSON.parse(parsed); } catch (e) { parsed = [parsed]; }
        }
        if (Array.isArray(parsed) && parsed.length > 0) {
          spot.photos = parsed;
          spot.photosLoaded = true;
          spot.hasPhoto = getSpotPhotoUrls(spot).length > 0;
          const freshUrls = getSpotPhotoUrls(spot);
          if (galEl && freshUrls.length > 0) {
            galEl.style.cssText = 'margin-bottom:6px;';
            galEl.innerHTML = freshUrls.map(src =>
              `<img class="popup-thumb popup-gallery-img" src="${escapeHtml(src)}" onclick="openLightbox('${escapeJsString(src)}')" style="width:100%; max-height:185px; object-fit:cover; border-radius:6px; margin-bottom:6px; display:block; cursor:pointer;">`
            ).join('');
            const m = markersMap[spot.id];
            if (m && m.getPopup()) m.getPopup().update();
          } else if (galEl) {
            galEl.remove();
          }
        } else if (galEl) {
          galEl.remove();
        }
      })
      .catch(() => {
        const galEl = container.querySelector('.popup-gallery');
        if (galEl) galEl.remove();
      });
  }

  return container;
}

function computeTerritoryZones(sortedSpots) {
  const sigParts = [];
  for (const s of sortedSpots) {
    if (s.spotType === 'camera') continue;
    const isApproved = s.approved !== false;
    const photoValid = hasValidSpotPhoto(s);
    if (isApproved && photoValid && s.status !== 'gone') {
      sigParts.push(`${s.id}:${s.status}:${s.spotType}:${s.isHotspot ? 1 : 0}:${s.isPremium ? 1 : 0}:${s.authorCrew || ''}:${s.publishAs || ''}:${s.authorColor || ''}:${s.crewColor || ''}`);
    }
  }
  const signature = sigParts.join('|');
  if (signature === cachedZonesSignature && cachedLeaderboardStats.length > 0) {
    return { zoneGroups: cachedZoneGroups, leaderboardStats: cachedLeaderboardStats };
  }

  const zoneGroups = {};
  territoryScoreByKey = {};

  sortedSpots.forEach(spot => {
    if (spot.spotType === 'camera') return;
    const isApproved = spot.approved !== false;
    const photoValid = hasValidSpotPhoto(spot);
    if (!isApproved || !photoValid || spot.status === 'gone' || typeof turf === 'undefined') return;

    const spotType = ['graffiti', 'tag'].includes(spot.spotType) ? spot.spotType : 'sticker';
    const isHotspot = Boolean(spot.isHotspot);
    const isPrem = isSpotAuthorPremium(spot);
    const zoneColor = getTerritoryColor(spot);
    const key = getTerritoryKey(spot);
    const radiusKm = getSpotRadiusKm({ ...spot, spotType });
    const currentCrew = (spot.authorCrew || '').trim().toLowerCase();
    const isCrewSpot = Boolean(currentCrew) && (spot.publishAs === 'crew' || spot.publishAs === undefined);
    const displayLabel = isCrewSpot ? `[${spot.authorCrew.trim()}]` : (spot.authorName || 'Автор');

    const circleGeoJson = turf.circle([spot.lng, spot.lat], radiusKm, {
      steps: 8,
      units: 'kilometers'
    });

    // Наложение территорий: зоны разных игроков и крю не вырезаются друг из друга, а красиво смешиваются при пересечении

    if (!zoneGroups[key]) {
      zoneGroups[key] = {
        key: key,
        mergedPoly: circleGeoJson,
        color: zoneColor,
        label: displayLabel,
        spotsCount: 1,
        hasHotspot: isHotspot,
        isPremium: isPrem,
        avatar: spot.authorAvatar || '',
        isCrew: isCrewSpot,
        crewTag: currentCrew
      };
    } else {
      zoneGroups[key].spotsCount += 1;
      zoneGroups[key].color = zoneColor;
      if (isHotspot) zoneGroups[key].hasHotspot = true;
      if (isPrem) zoneGroups[key].isPremium = true;
      if (spot.authorAvatar) zoneGroups[key].avatar = spot.authorAvatar;
      try {
        zoneGroups[key].mergedPoly = zoneGroups[key].mergedPoly
          ? turf.union(zoneGroups[key].mergedPoly, circleGeoJson)
          : circleGeoJson;
      } catch (e) {
        console.warn('Ошибка turf.union:', e);
      }
    }
  });

  const leaderboardStats = [];
  Object.values(zoneGroups).forEach(group => {
    if (!group.mergedPoly) return;

    const rawAreaSqMeters = typeof turf !== 'undefined' ? turf.area(group.mergedPoly) : 0;
    if (rawAreaSqMeters <= 0) return;

    const scoredAreaSqMeters = group.hasHotspot ? rawAreaSqMeters * 2 : rawAreaSqMeters;
    territoryScoreByKey[group.key] = scoredAreaSqMeters;

    let centerCoords = null;
    try {
      const centerFeature = turf.centerOfMass(group.mergedPoly);
      if (centerFeature && centerFeature.geometry && Array.isArray(centerFeature.geometry.coordinates)) {
        centerCoords = [centerFeature.geometry.coordinates[1], centerFeature.geometry.coordinates[0]];
      }
    } catch (e) {
      try {
        const fallbackCenter = turf.centroid(group.mergedPoly);
        centerCoords = [fallbackCenter.geometry.coordinates[1], fallbackCenter.geometry.coordinates[0]];
      } catch (err) {}
    }

    const rankObj = calculateStreetRank(scoredAreaSqMeters);
    leaderboardStats.push({
      label: group.label,
      isCrew: group.isCrew,
      color: group.color,
      avatar: group.avatar,
      spotsCount: group.spotsCount,
      hasHotspot: group.hasHotspot,
      isPremium: group.isPremium,
      rankTitle: rankObj.title,
      area: scoredAreaSqMeters,
      center: centerCoords
    });
  });

  cachedZonesSignature = signature;
  cachedZoneGroups = zoneGroups;
  cachedLeaderboardStats = leaderboardStats;
  return { zoneGroups, leaderboardStats };
}

function renderMarkers() {
  spots = deduplicateSpots(spots);

  if (markersClusterGroup) {
    markersClusterGroup.clearLayers();
  } else if (typeof L.markerClusterGroup === 'function') {
    markersClusterGroup = L.markerClusterGroup({
      chunkedLoading: true,
      chunkInterval: 100,
      chunkDelay: 25,
      maxClusterRadius: 48,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      disableClusteringAtZoom: 17,
      iconCreateFunction: function (cluster) {
        const count = cluster.getChildCount();
        let sizeClass = 'sm-cluster-small';
        if (count >= 10 && count < 50) sizeClass = 'sm-cluster-medium';
        else if (count >= 50) sizeClass = 'sm-cluster-large';

        return L.divIcon({
          html: `<div class="sm-cluster-inner"><span>${count}</span></div>`,
          className: `sm-cluster ${sizeClass}`,
          iconSize: L.point(40, 40)
        });
      }
    });
    map.addLayer(markersClusterGroup);
  } else {
    Object.values(markersMap).forEach(m => map.removeLayer(m));
  }

  territoryLayers.forEach(layer => map.removeLayer(layer));
  markersMap = {};
  territoryLayers = [];

  const searchQuery = (filterSearchInput?.value || '').trim().toLowerCase();
  const typeFilter = filterTypeSelect?.value || 'all';
  const onlyMyCrew = filterOnlyCrewCheck?.checked || false;
  const hideGone = filterHideGoneCheck?.checked || false;
  const isMod = isModeratorUser();

  const sortedSpots = [...spots].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const { zoneGroups, leaderboardStats } = computeTerritoryZones(sortedSpots);

  const recentFeedSpots = [];

  sortedSpots.forEach(spot => {
    if (spot.spotType === 'camera') return;

    const isApproved = spot.approved !== false;
    if (spot.rejected === true && !isMod) return;

    const isAuthor = currentUser && spot.authorUid === currentUser.uid;
    const reportsCount = Array.isArray(spot.reportedBy) ? spot.reportedBy.length : 0;
    const spotType = ['graffiti', 'tag'].includes(spot.spotType) ? spot.spotType : 'sticker';
    const isHotspot = Boolean(spot.isHotspot);
    const isPrem = isSpotAuthorPremium(spot);
    const photoValid = hasValidSpotPhoto(spot);

    if (!isMod && !isAuthor) {
      if (!isApproved || reportsCount >= 3 || !photoValid) return;
    }

    if (isMod) {
      if (staffStatusFilter === 'approved' && !isApproved) return;
      if (staffStatusFilter === 'pending' && isApproved) return;
    }

    if (isApproved && photoValid) {
      recentFeedSpots.push(spot);
    }

    if (typeFilter === 'hotspot' && !isHotspot) return;
    if (visibleSpotTypes && !visibleSpotTypes.has(spotType)) return;
    if (['sticker', 'graffiti', 'tag'].includes(typeFilter) && spotType !== typeFilter) return;
    if (hideGone && spot.status === 'gone') return;
    if (onlyMyCrew && userProfile && userProfile.crewName) {
      if ((spot.authorCrew || '').toLowerCase() !== userProfile.crewName.toLowerCase()) return;
    }
    if (searchQuery) {
      const haystack = `${spot.title || ''} ${spot.authorName || ''} ${spot.authorCrew || ''} ${spot.note || ''}`.toLowerCase();
      if (!haystack.includes(searchQuery)) return;
    }

    const zoneColor = getTerritoryColor(spot);
    const marker = L.marker([spot.lat, spot.lng], { icon: createPin(spot, zoneColor) });
    marker.spotId = spot.id;
    marker.on('click', (e) => {
      if (bulkSelectMode && isModeratorUser()) {
        L.DomEvent.stopPropagation(e);
        marker.closePopup();

        const sid = String(spot.id);
        if (selectedSpotIds.has(sid)) {
          selectedSpotIds.delete(sid);
        } else {
          selectedSpotIds.add(sid);
        }

        const pinEl = marker.getElement()?.querySelector('.custom-pin');
        if (pinEl) pinEl.classList.toggle('pin-bulk-selected', selectedSpotIds.has(sid));
        updateBulkDeleteBar();
        return;
      }
    });
    marker.bindPopup(() => buildSpotPopupDom(spot));

    if (markersClusterGroup) {
      markersClusterGroup.addLayer(marker);
    } else {
      marker.addTo(map);
    }
    markersMap[spot.id] = marker;
  });

  Object.values(zoneGroups).forEach(group => {
    if (!group.mergedPoly) return;
    const geoLayer = L.geoJSON(group.mergedPoly, {
      style: {
        color: group.hasHotspot ? '#ffd60a' : group.color,
        fillColor: group.color,
        fillOpacity: group.hasHotspot ? 0.34 : 0.28,
        weight: group.hasHotspot ? 3 : 2,
        dashArray: group.hasHotspot ? '6, 4' : null,
        lineJoin: 'round'
      },
      interactive: false
    }).addTo(map);

    territoryLayers.push(geoLayer);
  });

  renderLeaderboard(leaderboardStats);
  renderActivityFeed(recentFeedSpots);
  renderUserPanel();
}

function renderLeaderboard(stats) {
  if (!leaderboardList) return;
  if (!stats.length) {
    leaderboardList.innerHTML = `<div class="hud-empty">Пока нет захваченных территорий</div>`;
    return;
  }

  const sortedStats = [...stats].sort((a, b) => b.area - a.area);

  leaderboardList.innerHTML = sortedStats.map((item, idx) => {
    const rankLabel = `#${idx + 1}`;
    const typeText = item.isCrew ? 'Крю' : escapeHtml(item.rankTitle);
    const bonusBadge = item.hasHotspot ? `<span class="lb-bonus-tag">x2</span>` : '';
    const premBadge = item.isPremium ? `<span class="premium-badge-pill" style="margin-left:4px; font-size:8px; padding:1px 4px;">PREMIUM</span>` : '';
    const flyAttrs = item.center ? `onclick="flyToCoords(${item.center[0]}, ${item.center[1]})"` : '';
    return `
      <div class="leaderboard-item" ${flyAttrs}>
        <div class="lb-left">
          <span class="lb-rank">${rankLabel}</span>
          <img class="lb-avatar" src="${escapeHtml(item.avatar || DEFAULT_AVATAR)}" style="border-color:${escapeHtml(item.color)};">
          <div style="min-width:0;">
            <div class="lb-name">${escapeHtml(item.label)}${bonusBadge}${premBadge}</div>
            <div class="lb-sub">${typeText} • ${item.spotsCount} шт.</div>
          </div>
        </div>
        <div class="lb-area">${formatArea(item.area)}</div>
      </div>
    `;
  }).join('');
}

function renderActivityFeed(approvedSpots) {
  if (!feedList) return;
  const latestFive = [...approvedSpots]
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 5);

  if (!latestFive.length) {
    feedList.innerHTML = `<div class="hud-empty">Пока нет точек</div>`;
    return;
  }

  feedList.innerHTML = latestFive.map(s => {
    const crewStr = s.authorCrew ? ` [${escapeHtml(s.authorCrew)}]` : '';
    const typeTag = s.isHotspot ? '[TOP]' : (s.spotType === 'graffiti' ? '[Граффити]' : (s.spotType === 'tag' ? '[Тег]' : '[Стикер]'));
    return `
      <div class="feed-item" onclick="flyToSpot('${escapeJsString(s.id)}', ${s.lat}, ${s.lng})">
        <div class="feed-title">${typeTag} ${escapeHtml(s.title)}</div>
        <div class="feed-meta">${escapeHtml(s.authorName || 'Автор')}${crewStr} • ${formatTimeAgo(s.createdAt)}</div>
      </div>
    `;
  }).join('');
}

window.flyToCoords = function(lat, lng) {
  map.flyTo([lat, lng], 15, { duration: 1.1 });
};

window.flyToSpot = function(id, lat, lng) {
  const targetId = String(id);
  const spot = spots.find(s => String(s.id) === targetId);
  if (spot) {
    const st = ['graffiti', 'tag'].includes(spot.spotType) ? spot.spotType : 'sticker';
    visibleSpotTypes.add(st);
    document.querySelectorAll('.spot-type-layer-check').forEach(cb => {
      if (cb.value === st) cb.checked = true;
    });
    if (filterTypeSelect && filterTypeSelect.value !== 'all' && filterTypeSelect.value !== st) {
      filterTypeSelect.value = 'all';
    }
    if (filterHideGoneCheck && spot.status === 'gone') {
      filterHideGoneCheck.checked = false;
    }
    if (filterOnlyCrewCheck) {
      filterOnlyCrewCheck.checked = false;
    }
    if (filterSearchInput && filterSearchInput.value) {
      filterSearchInput.value = '';
    }
    renderMarkers();
  }

  const finalLat = spot ? spot.lat : lat;
  const finalLng = spot ? spot.lng : lng;

  map.stop();
  map.setView([finalLat, finalLng], 18, { animate: false });

  const openTargetMarker = (attempt = 0) => {
    const marker = markersMap[targetId];
    if (!marker) {
      if (attempt < 10) setTimeout(() => openTargetMarker(attempt + 1), 200);
      return;
    }

    if (markersClusterGroup && typeof markersClusterGroup.zoomToShowLayer === 'function') {
      markersClusterGroup.zoomToShowLayer(marker, () => {
        marker.openPopup();
      });
    } else {
      marker.openPopup();
    }
  };

  setTimeout(() => openTargetMarker(0), 150);
};

function handleDeepLinkSpot() {
  if (deepLinkHandled) return;
  const targetSpotId = new URLSearchParams(window.location.search).get('spot');
  if (!targetSpotId) return;

  const found = spots.find(s => String(s.id) === String(targetSpotId));
  if (!found) return;

  deepLinkHandled = true;
  if (isModeratorUser() && found.approved === false) {
    staffStatusFilter = 'all';
    const allRadio = document.querySelector('input[name="staffStatusFilter"][value="all"]');
    if (allRadio) allRadio.checked = true;
  }

  window.flyToSpot(found.id, found.lat, found.lng);

  setTimeout(() => {
    try {
      const cleanUrl = window.location.origin + window.location.pathname;
      window.history.replaceState({}, '', cleanUrl);
    } catch (e) {}
  }, 1500);
}

window.toggleRespect = async function(id, btnEl) {
  if (!currentUser) {
    authModal.classList.remove('hidden');
    return;
  }
  const spot = spots.find(s => String(s.id) === String(id));
  if (!spot) return;

  const likes = Array.isArray(spot.likes) ? [...spot.likes] : [];
  const alreadyLiked = likes.includes(currentUser.uid);
  const nextLikes = alreadyLiked
    ? likes.filter(uid => uid !== currentUser.uid)
    : [...likes, currentUser.uid];

  try {
    const { error } = await supabaseClient
      .from('stickers')
      .update({ likes: nextLikes })
      .eq('id', id);

    if (error) throw error;
    spot.likes = nextLikes;

    if (btnEl) {
      btnEl.textContent = `Респект (${nextLikes.length})`;
      btnEl.classList.toggle('liked', !alreadyLiked);
    }
    syncLocalSpotsCache(false);
  } catch (err) {
    console.error('Ошибка респекта:', err);
  }
};

// ==========================================
// 4. ДОБАВЛЕНИЕ, РЕДАКТИРОВАНИЕ И УДАЛЕНИЕ
// ==========================================
function canUserAddSpot() {
  if (bulkSelectMode) return false;
  if (!currentUser && !isOwnerUser()) {
    authModal.classList.remove('hidden');
    return false;
  }
  if (currentUser && !userProfile && !isOwnerUser()) {
    openProfileModal();
    return false;
  }
  if (!isModeratorUser()) {
    const lastTime = parseInt(localStorage.getItem('last_spot_time') || '0', 10);
    const diff = Date.now() - lastTime;
    if (diff < 15000) {
      const secLeft = Math.ceil((15000 - diff) / 1000);
      alert(`Подожди ещё ${secLeft} сек. перед добавлением следующей точки.`);
      return false;
    }
  }
  return true;
}

map.on('click', (e) => {
  if (!canUserAddSpot()) return;
  openAddModal(e.latlng.lat, e.latlng.lng);
});

document.getElementById('btn-add-spot').addEventListener('click', () => {
  if (!canUserAddSpot()) return;
  const center = map.getCenter();
  openAddModal(center.lat, center.lng);
});

function openAddModal(lat, lng) {
  spotForm.reset();
  spotIdInput.value = '';
  latInput.value = lat;
  lngInput.value = lng;
  const defaultType = document.querySelector('input[name="spotType"][value="sticker"]');
  if (defaultType) defaultType.checked = true;

  if (hotspotAdminGroup) {
    if (isOwnerUser()) {
      hotspotAdminGroup.classList.remove('hidden');
      if (isHotspotInput) isHotspotInput.checked = false;
    } else {
      hotspotAdminGroup.classList.add('hidden');
    }
  }

  syncPublishAsToggle();
  currentPhotos = [];
  renderPhotosPreview();
  modalTitle.textContent = 'Новая точка';
  modal.classList.remove('hidden');
}

window.openEditModal = function(id) {
  const spot = spots.find(s => s.id === id);
  if (!spot) return;

  spotIdInput.value = spot.id;
  latInput.value = spot.lat;
  lngInput.value = spot.lng;
  const typeVal = ['graffiti', 'tag'].includes(spot.spotType) ? spot.spotType : 'sticker';
  const typeRadio = document.querySelector(`input[name="spotType"][value="${typeVal}"]`);
  if (typeRadio) typeRadio.checked = true;

  if (hotspotAdminGroup) {
    if (isOwnerUser()) {
      hotspotAdminGroup.classList.remove('hidden');
      if (isHotspotInput) isHotspotInput.checked = Boolean(spot.isHotspot);
    } else {
      hotspotAdminGroup.classList.add('hidden');
    }
  }

  titleInput.value = spot.title || '';
  noteInput.value = spot.note || '';
  statusSelect.value = spot.status || 'ok';

  currentPhotos = getSpotPhotoUrls(spot);
  renderPhotosPreview();
  modalTitle.textContent = 'Редактировать точку';
  modal.classList.remove('hidden');
};

function closeModal() {
  modal.classList.add('hidden');
}
cancelBtn.addEventListener('click', closeModal);

function renderPhotosPreview() {
  photosPreviewGrid.innerHTML = '';
  currentPhotos.forEach((src, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'preview-thumb-wrap';
    wrap.innerHTML = `
      <img src="${escapeHtml(src)}">
      <button type="button" class="preview-remove-btn" onclick="removePhoto(${idx})">&times;</button>
    `;
    photosPreviewGrid.appendChild(wrap);
  });
}

window.removePhoto = function(index) {
  currentPhotos.splice(index, 1);
  renderPhotosPreview();
};

photosInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  if (!files.length) return;

  saveBtn.disabled = true;
  saveBtn.textContent = 'Загрузка фото...';
  try {
    for (const file of files) {
      const publicUrl = await uploadPhotoToStorage(file, 'spots', 960);
      currentPhotos.push(publicUrl);
    }
    renderPhotosPreview();
  } catch (err) {
    console.error('Ошибка загрузки фото в Storage:', err);
    alert('Не удалось загрузить фото: ' + (err.message || err));
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Сохранить';
    photosInput.value = '';
  }
});

const CLOUDINARY_CLOUD_NAME = 'akuq6jfv';
const CLOUDINARY_UPLOAD_PRESET = 'stickermap'; // если назвал пресет в Cloudinary по-другому — впиши своё имя

function compressToBlob(file, maxDim = 960, quality = 0.78) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => resolve(blob), 'image/webp', quality);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadPhotoToStorage(file, folder = 'spots', maxDim = 960) {
  const blob = await compressToBlob(file, maxDim, 0.78);
  if (!blob) throw new Error('Не удалось сжать изображение');

  const formData = new FormData();
  formData.append('file', blob, `${Date.now()}.webp`);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  formData.append('folder', `stickermap/${folder}`);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
    {
      method: 'POST',
      body: formData
    }
  );

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error?.message || `Ошибка Cloudinary (${response.status})`);
  }

  const data = await response.json();
  return data.secure_url.replace('/upload/', '/upload/f_auto,q_auto/');
}
async function deleteSpotFilesFromStorage(spot) {
  if (!spot) return;
  const urls = getSpotPhotoUrls(spot);
  const paths = [];
  for (const url of urls) {
    const marker = '/spot-photos/';
    const idx = url.indexOf(marker);
    if (idx !== -1) {
      paths.push(decodeURIComponent(url.slice(idx + marker.length)));
    }
  }
  if (paths.length > 0) {
    try {
      await supabaseClient.storage.from('spot-photos').remove(paths);
    } catch (e) {
      console.warn('Не удалось удалить файлы из Storage:', e);
    }
  }
}

async function hardDeleteSpotRecord(spot) {
  if (!spot) return;
  const { error } = await supabaseClient.from('stickers').delete().eq('id', spot.id);
  if (error) throw error;

  await deleteSpotFilesFromStorage(spot);

  try {
    await db.collection('stickers').doc(String(spot.id)).delete();
  } catch (e) {}

  spots = spots.filter(s => String(s.id) !== String(spot.id));
  syncLocalSpotsCache();
}

spotForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (isSubmittingSpot) return;

  const id = spotIdInput.value;
  const isStaff = isModeratorUser();
  const isAuthorPrem = isPremiumUser();

  if (!id && (!currentPhotos || currentPhotos.length === 0)) {
    alert('Прикрепи хотя бы одно фото стикера или граффити! Точки без фото не принимаются.');
    return;
  }

  if (!id && !isStaff) {
    const lastTime = parseInt(localStorage.getItem('last_spot_time') || '0', 10);
    const cooldownMs = 45 * 1000;
    if (Date.now() - lastTime < cooldownMs) {
      const secLeft = Math.ceil((cooldownMs - (Date.now() - lastTime)) / 1000);
      alert(`Не так быстро! Подожди ещё ${secLeft} сек. перед добавлением следующей точки.`);
      return;
    }

    const latVal = parseFloat(latInput.value);
    const lngVal = parseFloat(lngInput.value);
    const recentDuplicate = spots.some(s =>
      currentUser &&
      s.authorUid === currentUser.uid &&
      (Date.now() - (s.createdAt || 0) < 5 * 60 * 1000) &&
      Math.abs(s.lat - latVal) < 0.00015 &&
      Math.abs(s.lng - lngVal) < 0.00015
    );
    if (recentDuplicate) {
      alert('Ты уже добавил точку в этом месте. Не дублируй заявки.');
      return;
    }
  }

  isSubmittingSpot = true;
  saveBtn.disabled = true;
  saveBtn.textContent = 'Сохранение...';

  const chosenSpotType = document.querySelector('input[name="spotType"]:checked')?.value || 'sticker';
  const hasCrew = Boolean(userProfile && userProfile.crewName && userProfile.crewName.trim());
  const chosenPublishAs = (hasCrew && document.querySelector('input[name="publishAs"]:checked')?.value === 'crew')
    ? 'crew'
    : 'solo';

  const spotData = {
    spotType: chosenSpotType,
    publishAs: chosenPublishAs,
    title: titleInput.value.trim() || 'Без названия',
    status: statusSelect.value,
    note: noteInput.value.trim() || '',
    lat: parseFloat(latInput.value),
    lng: parseFloat(lngInput.value),
    photos: currentPhotos
  };

  if (isOwnerUser() && isHotspotInput) {
    spotData.isHotspot = isHotspotInput.checked;
  }

  try {
    if (id) {
      const { error } = await supabaseClient.from('stickers').update(spotData).eq('id', id);
      if (error) throw error;

      const target = spots.find(s => String(s.id) === String(id));
      if (target) {
        Object.assign(target, spotData);
        target.photosLoaded = true;
        target.hasPhoto = getSpotPhotoUrls(target).length > 0;
      }
      syncLocalSpotsCache();
    } else {
      if (currentUser) {
        const latVal = parseFloat(latInput.value);
        const lngVal = parseFloat(lngInput.value);
        const { data: existingDupes } = await supabaseClient
          .from('stickers')
          .select('id')
          .eq('authorUid', currentUser.uid)
          .gte('lat', latVal - 0.0001)
          .lte('lat', latVal + 0.0001)
          .gte('lng', lngVal - 0.0001)
          .lte('lng', lngVal + 0.0001)
          .limit(1);

        if (Array.isArray(existingDupes) && existingDupes.length > 0) {
          alert('Эта точка уже сохранена в базе!');
          closeModal();
          return;
        }
      }

      const newId = generateSpotId();
      const isAutoApproved = isStaff || isAuthorPrem;
      const newSpot = {
        id: newId,
        ...spotData,
        createdAt: Date.now(),
        approved: isAutoApproved,
        rejected: false,
        isPremium: isAuthorPrem,
        reportedBy: [],
        likes: [],
        aliveVotes: 0,
        buffVotes: 0,
        modApproves: [],
        modRejects: [],
        authorUid: currentUser ? currentUser.uid : 'admin',
        authorName: userProfile ? userProfile.nickname : (currentUser ? currentUser.defaultName : 'Админ'),
        authorAvatar: (userProfile && userProfile.avatarUrl) ? userProfile.avatarUrl : '',
        authorColor: (userProfile && userProfile.zoneColor) ? userProfile.zoneColor : '#2ecc71',
        authorCrew: (userProfile && userProfile.crewType === 'crew') ? userProfile.crewName : ''
      };

      let { error } = await supabaseClient.from('stickers').insert(newSpot);
      if (error && String(error.message || '').includes('isPremium')) {
        const spotWithoutPrem = { ...newSpot };
        delete spotWithoutPrem.isPremium;
        const retryIns = await supabaseClient.from('stickers').insert(spotWithoutPrem);
        error = retryIns.error;
      }
      if (error) throw error;

      newSpot.hasPhoto = getSpotPhotoUrls(newSpot).length > 0;
      newSpot.photosLoaded = true;
      spots.push(newSpot);
      syncLocalSpotsCache();

      if (!isStaff) {
        localStorage.setItem('last_spot_time', Date.now().toString());
        if (newSpot.isPremium) {
          notifyPremiumSpotToMods(newSpot);
          alert('Premium-точка опубликована мгновенно без ожидания модерации!');
        } else {
          alert('Точка отправлена! Она появится на карте после проверки модератором.');
        }
      }
    }
    closeModal();
  } catch (err) {
    console.error('Ошибка сохранения в Supabase:', err);
    alert('Не удалось сохранить точку: ' + (err.message || err));
  } finally {
    isSubmittingSpot = false;
    saveBtn.disabled = false;
    saveBtn.textContent = 'Сохранить';
  }
});

window.approveSpot = async function(id) {
  const modLabel = getModeratorLabelByEmail(currentUser?.email);
  try {
    let { error } = await supabaseClient
      .from('stickers')
      .update({ approved: true, rejected: false, reportedBy: [], approvedByLabel: modLabel })
      .eq('id', id);
    if (error && String(error.message || '').includes('approvedByLabel')) {
      const retry = await supabaseClient
        .from('stickers')
        .update({ approved: true, rejected: false, reportedBy: [] })
        .eq('id', id);
      error = retry.error;
    }
    if (error) throw error;

    const target = spots.find(s => String(s.id) === String(id));
    if (target) {
      target.approved = true;
      target.rejected = false;
      target.reportedBy = [];
      target.approvedByLabel = modLabel;
    }
    syncLocalSpotsCache();
  } catch (err) {
    console.error('Ошибка одобрения:', err);
  }
};

window.reportSpot = async function(id) {
  if (!currentUser) return;
  if (!confirm('Отправить жалобу, что работы нет или это спам?')) return;
  const target = spots.find(s => String(s.id) === String(id));
  if (!target) return;

  const nextReports = Array.isArray(target.reportedBy) ? [...target.reportedBy] : [];
  if (!nextReports.includes(currentUser.uid)) nextReports.push(currentUser.uid);

  try {
    const { error } = await supabaseClient
      .from('stickers')
      .update({ reportedBy: nextReports })
      .eq('id', id);
    if (error) throw error;

    target.reportedBy = nextReports;
    syncLocalSpotsCache();
    alert('Жалоба учтена!');
  } catch (err) {
    console.error('Ошибка отправки жалобы:', err);
  }
};

window.deleteSpot = async function(id) {
  if (!confirm('Точно удалить эту точку? Территория будет пересчитана.')) return;
  const target = spots.find(s => String(s.id) === String(id));
  if (!target) return;

  try {
    await hardDeleteSpotRecord(target);
  } catch (err) {
    console.error('Ошибка удаления:', err);
    alert('Ошибка удаления из базы: ' + (err.message || err));
  }
};

// Lightbox
window.openLightbox = function(src) {
  if (!src) return;
  lightboxImg.src = src;
  lightbox.classList.remove('hidden');
};

function closeLightbox() {
  lightbox.classList.add('hidden');
  lightboxImg.src = '';
}

lightboxClose.addEventListener('click', closeLightbox);
lightbox.addEventListener('click', (e) => {
  if (e.target === lightbox) closeLightbox();
});

// ==========================================
// 5. ЗАГРУЗКА ТОЧЕК И РОЛЕЙ ИЗ SUPABASE
// ==========================================
const SPOTS_CACHE_KEY = 'stickermap_supabase_cache_v3';
const SPOTS_CACHE_TTL = 2 * 60 * 1000;

function syncLocalSpotsCache(shouldRender = true) {
  spots = deduplicateSpots(spots);
  try {
    const lightCache = spots.map(s => {
      const urls = getSpotPhotoUrls(s);
      const safePreview = urls.length > 0 && !urls[0].startsWith('data:') ? [urls[0]] : [];
      return {
        ...s,
        photos: safePreview,
        hasPhoto: s.hasPhoto !== undefined ? s.hasPhoto : urls.length > 0
      };
    });

    localStorage.setItem(SPOTS_CACHE_KEY, JSON.stringify({
      ts: Date.now(),
      data: lightCache
    }));
  } catch (e) {
    try { localStorage.removeItem(SPOTS_CACHE_KEY); } catch (err) {}
  }
  if (shouldRender) {
    renderMarkers();
  }
}

async function loadStaffRoles() {
  try {
    const { data, error } = await supabaseClient.from('staff_roles').select('email, role');
    if (error) {
      console.warn('Не удалось прочитать staff_roles из Supabase (проверь RLS):', error.message);
      return;
    }
    if (!data) return;

    dynamicModerators = new Set(
      data
        .filter(r => r.role === 'moderator' && r.email)
        .map(r => r.email.trim().toLowerCase())
    );
    dynamicPremiumUsers = new Set(
      data
        .filter(r => r.role === 'premium' && r.email)
        .map(r => r.email.trim().toLowerCase())
    );
    rebuildModeratorNumbers();

    // Авто-одобряем зависшие Premium-заявки, если статус выдали после отправки точки
    if (dynamicPremiumUsers.size > 0 && Array.isArray(spots) && spots.length > 0) {
      const pendingPremIds = spots
        .filter(s => s.approved === false && s.rejected !== true && isSpotAuthorPremium(s))
        .map(s => s.id);
      if (pendingPremIds.length > 0) {
        await supabaseClient.from('stickers').update({ approved: true, rejected: false }).in('id', pendingPremIds);
        spots.forEach(s => {
          if (pendingPremIds.includes(s.id)) {
            s.approved = true;
            s.rejected = false;
          }
        });
      }
    }

    renderUserPanel();
    renderMarkers();
  } catch (e) {
    console.warn('Ошибка загрузки ролей:', e);
  }
}

async function loadSpots(forceRefresh = false) {
  try {
    const rawCache = localStorage.getItem(SPOTS_CACHE_KEY);
    if (rawCache) {
      const parsed = JSON.parse(rawCache);
      if (parsed && Array.isArray(parsed.data) && parsed.data.length > 0) {
        spots = deduplicateSpots(parsed.data);
        await claimLegacySpots();
        renderMarkers();
        handleDeepLinkSpot();
        loadVisiblePinPhotos();
        if (!forceRefresh && (Date.now() - parsed.ts < SPOTS_CACHE_TTL)) {
          return;
        }
      }
    }
  } catch (e) {}

  let lightColumns = 'id,spotType,publishAs,title,status,note,lat,lng,photos,isHotspot,isPremium,createdAt,approved,approvedByLabel,rejected,reportedBy,likes,aliveVotes,buffVotes,authorUid,authorName,authorAvatar,authorColor,authorCrew';
  const fallbackColumns = 'id,spotType,publishAs,title,status,note,lat,lng,photos,isHotspot,createdAt,approved,rejected,reportedBy,likes,aliveVotes,buffVotes,authorUid,authorName,authorAvatar,authorColor,authorCrew';

  try {
    let allRows = [];
    let from = 0;
    const step = 1000;

    while (true) {
      let { data, error } = await supabaseClient
        .from('stickers')
        .select(lightColumns)
        .range(from, from + step - 1);

      if (error && lightColumns !== fallbackColumns) {
        console.warn('Повторная загрузка без колонки isPremium:', error.message);
        lightColumns = fallbackColumns;
        const retryRes = await supabaseClient
          .from('stickers')
          .select(lightColumns)
          .range(from, from + step - 1);
        data = retryRes.data;
        error = retryRes.error;
      }

      if (error) {
        console.error('Supabase error:', error);
        alert('Ошибка загрузки: ' + error.message);
        throw error;
      }
      if (!data || data.length === 0) break;

      const existingPhotosMap = new Map();
      spots.forEach(oldSpot => {
        if (Array.isArray(oldSpot.photos) && oldSpot.photos.length > 0) {
          existingPhotosMap.set(String(oldSpot.id), oldSpot.photos);
        }
      });

      data.forEach(row => {
        if (row.photos) {
          const urls = getSpotPhotoUrls(row);
          row.photos = urls;
          row.photosLoaded = true;
          row.hasPhoto = urls.length > 0;
        } else if (existingPhotosMap.has(String(row.id))) {
          row.photos = existingPhotosMap.get(String(row.id));
          row.photosLoaded = true;
          row.hasPhoto = getSpotPhotoUrls(row).length > 0;
        }
      });

      allRows = allRows.concat(data);

      if (data.length < step) break;
      from += step;
    }

    spots = deduplicateSpots(allRows);
    await claimLegacySpots();
    syncLocalSpotsCache();
    handleDeepLinkSpot();
    loadVisiblePinPhotos();
  } catch (err) {
    console.error('Ошибка загрузки точек из Supabase:', err);
  }
}

loadStaffRoles();
loadSpots(false);

async function loadVisiblePinPhotos() {
  if (!map || !Array.isArray(spots) || spots.length === 0) return;

  const bounds = map.getBounds();
  const visibleSpots = spots.filter(s =>
    !s.pinPhotoChecked &&
    !s.photosLoaded &&
    (!Array.isArray(s.photos) || s.photos.length === 0) &&
    bounds.contains([s.lat, s.lng])
  ).slice(0, 25);

  if (visibleSpots.length === 0) return;
  visibleSpots.forEach(s => { s.pinPhotoChecked = true; });

  try {
    const ids = visibleSpots.map(s => s.id);
    const { data, error } = await supabaseClient
      .from('stickers')
      .select('id, photos')
      .in('id', ids);

    if (error || !data) return;

    const isMod = isModeratorUser();

    data.forEach(row => {
      const spot = spots.find(s => String(s.id) === String(row.id));
      if (!spot) return;

      let rowPhotos = row.photos;
      if (typeof rowPhotos === 'string') {
        try { rowPhotos = JSON.parse(rowPhotos); } catch (e) { rowPhotos = [rowPhotos]; }
      }
      spot.photos = Array.isArray(rowPhotos) ? rowPhotos : [];
      spot.photosLoaded = true;
      const validUrls = getSpotPhotoUrls(spot);
      spot.hasPhoto = validUrls.length > 0;

      const marker = markersMap[spot.id];
      if (!marker) return;

      const isAuthor = currentUser && spot.authorUid === currentUser.uid;
      if (!spot.hasPhoto && !isMod && !isAuthor) {
        if (markersClusterGroup) {
          markersClusterGroup.removeLayer(marker);
        } else {
          map.removeLayer(marker);
        }
        delete markersMap[spot.id];
        return;
      }

      marker.setIcon(createPin(spot, getTerritoryColor(spot)));
      if (markersClusterGroup && typeof markersClusterGroup.refreshClusters === 'function') {
        markersClusterGroup.refreshClusters(marker);
      }
    });
  } catch (e) {
    console.warn('Не удалось догрузить превью для пинов:', e);
  }
}

let pinPhotosDebounceTimer = null;
map.on('moveend', () => {
  clearTimeout(pinPhotosDebounceTimer);
  pinPhotosDebounceTimer = setTimeout(loadVisiblePinPhotos, 350);
});

// =========================================================================
// ЧИСТЫЙ ЭКРАН: ЕДИНАЯ КНОПКА МЕНЮ + PWA + УПРАВЛЕНИЕ МОДЕРАТОРАМИ И PREMIUM
// =========================================================================
(function initCleanUIAndPWA() {
  const hudStack = document.querySelector('.hud-left-stack');
  if (hudStack && !document.getElementById('btn-toggle-hud-menu')) {
    hudStack.classList.add('menu-closed');

    const menuBtn = document.createElement('button');
    menuBtn.id = 'btn-toggle-hud-menu';
    menuBtn.type = 'button';
    menuBtn.className = 'btn-hud-menu';
    menuBtn.textContent = 'Меню';
    document.body.appendChild(menuBtn);

    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isClosed = hudStack.classList.toggle('menu-closed');
      menuBtn.textContent = isClosed ? 'Меню' : 'Закрыть';
    });

    document.addEventListener('click', (e) => {
      if (!hudStack.contains(e.target) && e.target !== menuBtn) {
        hudStack.classList.add('menu-closed');
        menuBtn.textContent = 'Меню';
      }
    });

    renderOwnerPanelFn = () => {
      const existing = document.getElementById('owner-staff-panel');
      if (!isOwnerUser()) {
        existing?.remove();
        return;
      }
      if (existing) return;

      const staffBox = document.createElement('div');
      staffBox.id = 'owner-staff-panel';
      staffBox.style.cssText = 'margin-top:8px;padding:10px;border-radius:12px;background:rgba(18,18,22,0.92);border:1px solid rgba(255,214,10,0.3);color:#fff;max-height:260px;overflow-y:auto;';
      staffBox.innerHTML = `
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:#ffd60a;margin-bottom:6px;">
          Управление модераторами
        </div>
        <div style="display:flex;gap:6px;">
          <input type="email" id="input-mod-email" placeholder="Email модератора" style="flex:1;min-width:0;padding:7px 9px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.4);color:#fff;font-size:12px;">
          <button type="button" id="btn-add-mod" style="padding:7px 10px;border:none;border-radius:8px;background:#3b82f6;color:#fff;font-weight:700;font-size:12px;cursor:pointer;">Выдать</button>
        </div>
        <div id="mod-list-box" style="margin-top:6px;margin-bottom:12px;font-size:11px;color:#94a3b8;"></div>

        <div style="padding-top:10px;border-top:1px solid rgba(255,255,255,0.12);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:#f59e0b;margin-bottom:6px;">
          Управление Premium 
        </div>
        <div style="display:flex;gap:6px;">
          <input type="email" id="input-prem-email" placeholder="Email покупателя" style="flex:1;min-width:0;padding:7px 9px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.4);color:#fff;font-size:12px;">
          <button type="button" id="btn-add-prem" style="padding:7px 10px;border:none;border-radius:8px;background:#ffd60a;color:#111;font-weight:800;font-size:12px;cursor:pointer;">Выдать</button>
        </div>
        <div id="prem-list-box" style="margin-top:6px;font-size:11px;color:#94a3b8;"></div>
      `;
      hudStack.appendChild(staffBox);

      const renderModList = () => {
        const listBox = document.getElementById('mod-list-box');
        if (!listBox) return;
        const allMods = [...new Set([...MODERATOR_EMAILS, ...dynamicModerators])];
        if (!allMods.length) {
          listBox.textContent = 'Модераторы пока не назначены';
          return;
        }
        listBox.innerHTML = allMods.map(em => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-top:1px solid rgba(255,255,255,0.06);">
            <span style="color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(em)}</span>
            <button type="button" data-remove-mod="${escapeHtml(em)}" style="background:none;border:none;color:#f87171;font-size:11px;cursor:pointer;">Снять</button>
          </div>
        `).join('');

        listBox.querySelectorAll('[data-remove-mod]').forEach(btn => {
          btn.onclick = async () => {
            const targetEmail = btn.dataset.removeMod;
            await supabaseClient.from('staff_roles').delete().eq('email', targetEmail).eq('role', 'moderator');
            dynamicModerators.delete(targetEmail);
            rebuildModeratorNumbers();
            renderModList();
          };
        });
      };

      const renderPremList = () => {
        const listBox = document.getElementById('prem-list-box');
        if (!listBox) return;
        const allPrems = [...dynamicPremiumUsers];
        if (!allPrems.length) {
          listBox.textContent = 'Premium пока никому не выдан';
          return;
        }
        listBox.innerHTML = allPrems.map(em => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-top:1px solid rgba(255,255,255,0.06);">
            <span style="color:#fde68a;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(em)}</span>
            <button type="button" data-remove-prem="${escapeHtml(em)}" style="background:none;border:none;color:#f87171;font-size:11px;cursor:pointer;">Снять</button>
          </div>
        `).join('');

        listBox.querySelectorAll('[data-remove-prem]').forEach(btn => {
          btn.onclick = async () => {
            const targetEmail = btn.dataset.removePrem;
            await supabaseClient.from('staff_roles').delete().eq('email', targetEmail).eq('role', 'premium');
            dynamicPremiumUsers.delete(targetEmail);
            renderPremList();
          };
        });
      };

      renderModList();
      renderPremList();

      document.getElementById('btn-add-mod').onclick = async () => {
        const inp = document.getElementById('input-mod-email');
        const email = (inp.value || '').trim().toLowerCase();
        if (!email || !email.includes('@')) {
          alert('Введи корректный email модератора.');
          return;
        }
        const { error } = await supabaseClient
          .from('staff_roles')
          .upsert({ email: email, role: 'moderator' }, { onConflict: 'email' });
        if (error) {
          alert('Не удалось сохранить в базу: ' + error.message);
          return;
        }
        dynamicModerators.add(email);
        rebuildModeratorNumbers();
        inp.value = '';
        renderModList();
      };

      document.getElementById('btn-add-prem').onclick = async () => {
        const inp = document.getElementById('input-prem-email');
        const email = (inp.value || '').trim().toLowerCase();
        if (!email || !email.includes('@')) {
          alert('Введи корректный email покупателя с Boosty.');
          return;
        }
        const { error } = await supabaseClient
          .from('staff_roles')
          .upsert({ email: email, role: 'premium' }, { onConflict: 'email' });
        if (error) {
          alert('Не удалось выдать Premium: ' + error.message);
          return;
        }
        dynamicPremiumUsers.add(email);
        inp.value = '';
        renderPremList();
      };
    };

    renderOwnerPanelFn();
  }

  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  if (isStandalone) return;

  let deferredPrompt = null;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });

  if (!sessionStorage.getItem('pwa_prompt_shown')) {
    setTimeout(() => {
      sessionStorage.setItem('pwa_prompt_shown', '1');

      const toast = document.createElement('div');
      toast.className = 'pwa-welcome-toast';
      toast.innerHTML = `
        <div style="font-weight:700;font-size:15px;margin-bottom:4px;">Установить StickerMap</div>
        <div id="pwa-toast-desc" style="font-size:13px;color:#cbd5e1;line-height:1.4;">
          Добавь карту на главный экран, чтобы открывать без рамок браузера.
        </div>
        <div class="pwa-welcome-actions">
          <button type="button" id="pwa-toast-dismiss" style="background:rgba(255,255,255,0.12);color:#fff;">Позже</button>
          <button type="button" id="pwa-toast-install" style="background:#ffcc00;color:#000;">Скачать</button>
        </div>
      `;
      document.body.appendChild(toast);

      document.getElementById('pwa-toast-dismiss').onclick = () => toast.remove();

      document.getElementById('pwa-toast-install').onclick = async () => {
        if (deferredPrompt) {
          deferredPrompt.prompt();
          await deferredPrompt.userChoice;
          deferredPrompt = null;
          toast.remove();
          return;
        }

        const desc = document.getElementById('pwa-toast-desc');
        const installBtn = document.getElementById('pwa-toast-install');
        installBtn.style.display = 'none';
        document.getElementById('pwa-toast-dismiss').textContent = 'Понятно';

        if (isIOS) {
          desc.innerHTML = 'Нажми <b>«Поделиться»</b> (квадрат со стрелкой внизу) — <b>«На экран „Домой“»</b>.';
        } else {
          desc.innerHTML = 'Нажми меню справа вверху браузера — <b>«Добавить на главный экран»</b> или <b>«Установить приложение»</b>.';
        }
      };
    }, 1500);
  }
})();

// =========================================================================
// ПОСТОЯННЫЙ ПРИЦЕЛ ПО ЦЕНТРУ КАРТЫ
// =========================================================================
(function initPermanentCrosshair() {
  let dot = document.getElementById('permanent-center-dot');
  if (!dot) {
    dot = document.createElement('div');
    dot.id = 'permanent-center-dot';
    document.body.appendChild(dot);
  }

  dot.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 12px;
    height: 12px;
    background: rgba(255, 71, 87, 0.95);
    border: 2px solid #ffffff;
    border-radius: 50%;
    box-shadow: 0 0 10px rgba(176, 0, 0, 0.9);
    z-index: 950;
    pointer-events: none;
  `;

  const addBtn = document.getElementById('btn-add-spot');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      if (typeof map !== 'undefined') {
        const c = map.getCenter();
        if (latInput) latInput.value = c.lat;
        if (lngInput) lngInput.value = c.lng;
      }
    }, true);
  }
})();

// =========================================================================
// GPS-РАДАР (ЕДИНЫЙ МАРКЕР ГЕОПОЗИЦИИ)
// =========================================================================
(function initGpsRadar() {
  const gpsBtn = document.getElementById('btn-gps-spot');
  let gpsWatchId = null;

  if (gpsBtn && 'geolocation' in navigator) {
    gpsBtn.addEventListener('click', (e) => {
      e.stopImmediatePropagation();
      e.preventDefault();

      gpsBtn.style.opacity = '0.6';

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          gpsBtn.style.opacity = '1';
          const { latitude, longitude } = pos.coords;

          if (typeof map !== 'undefined') {
            map.flyTo([latitude, longitude], 16, { duration: 0.8 });
            setUserGpsPosition(latitude, longitude);
          }

          if (!gpsWatchId) {
            gpsWatchId = navigator.geolocation.watchPosition(
              (livePos) => {
                setUserGpsPosition(livePos.coords.latitude, livePos.coords.longitude);
              },
              null,
              { enableHighAccuracy: true, maximumAge: 5000 }
            );
          }
        },
        (err) => {
          gpsBtn.style.opacity = '1';
          alert('Не удалось определить геопозицию. Проверь, включён ли GPS на телефоне.');
          console.warn('GPS error:', err);
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    }, true);
  }
})();

// =========================================================================
// МОДУЛЬ ВИЗИТКИ АВТОРА / КРЮ
// =========================================================================
(function initAuthorProfileCard() {
  function getRankTitle(aliveCount) {
    if (aliveCount >= 25) return 'Легенда района';
    if (aliveCount >= 12) return 'Хозяин квартала';
    if (aliveCount >= 5) return 'Уличный игрок';
    return 'Новичок';
  }

  window.openAuthorCard = function(authorName) {
    if (!authorName || typeof spots === 'undefined') return;

    const cleanName = authorName.trim();
    const authorSpots = spots.filter(
      (s) => (s.authorName || s.author || s.username || '').trim().toLowerCase() === cleanName.toLowerCase()
    );

    const aliveSpots = authorSpots.filter((s) => s.status !== 'gone');
    const totalRespects = authorSpots.reduce(
      (sum, s) => sum + (s.respects || 0) + (s.aliveVotes || 0),
      0
    );

    const sampleSpot = authorSpots[0] || {};
    const accentColor = sampleSpot.authorColor || sampleSpot.color || '#2ecc71';
    const rawCrew = sampleSpot.authorCrew || sampleSpot.crew;
    const crewName = rawCrew ? `Крю: ${escapeHtml(rawCrew)}` : 'Solo';
    const rankTitle = getRankTitle(aliveSpots.length);
    const firstLetter = escapeHtml(cleanName.charAt(0).toUpperCase());
    const hasPremium = authorSpots.some(s => isSpotAuthorPremium(s));

    document.getElementById('author-card-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'author-card-overlay';
    overlay.className = 'author-card-overlay';
    overlay.style.zIndex = '15000';

    const spotsHtml = authorSpots.length
      ? authorSpots
          .map((sp) => {
            const urls = getSpotPhotoUrls(sp);
            const thumb = urls.length > 0 ? escapeHtml(urls[0]) : 'icon-512.png';
            const isGone = sp.status === 'gone';
            return `
              <div class="author-spot-item" data-id="${escapeHtml(sp.id)}" data-lat="${sp.lat}" data-lng="${sp.lng}">
                <img src="${thumb}" class="author-spot-thumb" alt="">
                <div class="author-spot-info">
                  <div class="author-spot-name">${escapeHtml(sp.title || 'Без названия')}</div>
                  <div class="author-spot-meta">
                    ${isGone ? 'Пропал' : 'На месте'} • Респектов: ${(sp.respects || 0) + (sp.aliveVotes || 0)}
                  </div>
                </div>
                <span style="font-size:14px;color:#94a3b8;">&rarr;</span>
              </div>
            `;
          })
          .join('')
      : '<div style="text-align:center;color:#94a3b8;font-size:13px;padding:20px 0;">Пока нет активных спотов на карте</div>';

    const staffDeleteAllHtml = (isOwnerUser() && authorSpots.length > 0)
      ? `<button type="button" id="btn-delete-all-author-spots" style="width:100%; margin-top:8px; padding:10px; border:none; border-radius:10px; background:#dc2626; color:#fff; font-weight:700; font-size:13px; cursor:pointer;">Удалить все посты автора (${authorSpots.length})</button>`
      : '';

    overlay.innerHTML = `
      <div class="author-card-modal">
        <div class="author-card-banner" style="background: linear-gradient(135deg, ${accentColor}33, rgba(20,23,31,0.95));">
          <button type="button" class="author-card-close" id="close-author-card">&times;</button>
          <div class="author-card-header">
            <div class="author-avatar-circle" style="background: ${accentColor};">${firstLetter}</div>
            <div class="author-title-wrap">
              <h2>${escapeHtml(cleanName)} ${hasPremium ? '<span class="premium-badge-pill">PREMIUM</span>' : ''}</h2>
              <div class="author-badge-row">
                <span class="author-pill" style="background:${accentColor}33;color:#fff;border:1px solid ${accentColor}66;">${rankTitle}</span>
                <span class="author-pill">${crewName}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="author-stats-grid">
          <div class="author-stat-box">
            <div class="author-stat-val">${authorSpots.length}</div>
            <div class="author-stat-lbl">Всего спотов</div>
          </div>
          <div class="author-stat-box">
            <div class="author-stat-val" style="color:#4ade80;">${aliveSpots.length}</div>
            <div class="author-stat-lbl">Живых</div>
          </div>
          <div class="author-stat-box">
            <div class="author-stat-val" style="color:#facc15;">${totalRespects}</div>
            <div class="author-stat-lbl">Респектов</div>
          </div>
        </div>

        <div class="author-spots-list">
          <div style="font-size:12px;font-weight:700;color:#94a3b8;margin-bottom:2px;">СПОТЫ АВТОРА НА КАРТЕ:</div>
          ${spotsHtml}
        </div>

        <div class="author-card-footer">
          <button type="button" class="author-share-btn" id="share-author-profile">Поделиться профилем автора</button>
          ${staffDeleteAllHtml}
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('close-author-card').onclick = () => overlay.remove();
    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.remove();
    };

    const deleteAllBtn = document.getElementById('btn-delete-all-author-spots');
    if (deleteAllBtn) {
      deleteAllBtn.onclick = async () => {
        if (!confirm(`Удалить ВСЕ споты автора ${cleanName} (${authorSpots.length} шт.)? Это действие необратимо.`)) return;
        deleteAllBtn.disabled = true;
        deleteAllBtn.textContent = 'Удаление...';
        try {
          const ids = authorSpots.map(s => s.id);
          const { error } = await supabaseClient.from('stickers').delete().in('id', ids);
          if (error) throw error;

          for (const sp of authorSpots) {
            await deleteSpotFilesFromStorage(sp);
          }

          const idSet = new Set(ids.map(String));
          spots = spots.filter(s => !idSet.has(String(s.id)));
          syncLocalSpotsCache();
          overlay.remove();
          document.getElementById('patrol-modal-overlay')?.remove();
        } catch (err) {
          alert('Ошибка массового удаления: ' + (err.message || err));
          deleteAllBtn.disabled = false;
          deleteAllBtn.textContent = `Удалить все посты автора (${authorSpots.length})`;
        }
      };
    }

    overlay.querySelectorAll('.author-spot-item').forEach((item) => {
      item.addEventListener('click', () => {
        const spId = item.dataset.id;
        const lat = parseFloat(item.dataset.lat);
        const lng = parseFloat(item.dataset.lng);
        overlay.remove();
        document.getElementById('patrol-modal-overlay')?.remove();
        if (typeof map !== 'undefined' && !isNaN(lat) && !isNaN(lng)) {
          window.flyToSpot(spId, lat, lng);
        }
      });
    });

    document.getElementById('share-author-profile').onclick = async (e) => {
      const btn = e.target;
      const profileUrl = `${window.location.origin}${window.location.pathname}?author=${encodeURIComponent(cleanName)}`;
      if (navigator.share) {
        navigator.share({ title: `${cleanName} в StickerMap`, url: profileUrl }).catch(() => {});
      } else {
        await navigator.clipboard.writeText(profileUrl);
        btn.textContent = 'Ссылка на профиль скопирована';
        setTimeout(() => (btn.textContent = 'Поделиться профилем автора'), 2000);
      }
    };
  };

  const targetAuthor = new URLSearchParams(window.location.search).get('author');
  if (targetAuthor) {
    let tries = 0;
    const waitAuthorInterval = setInterval(() => {
      tries++;
      if (typeof spots !== 'undefined' && Array.isArray(spots) && spots.length > 0) {
        clearInterval(waitAuthorInterval);
        window.openAuthorCard(targetAuthor);
      }
      if (tries > 25) clearInterval(waitAuthorInterval);
    }, 400);
  }
})();

// =========================================================================
// АВТОЦЕНТРИРОВАНИЕ КАРТЫ ПО ГЕОЛОКАЦИИ ПРИ ЗАПУСКЕ САЙТА
// =========================================================================
(function initAutoCenterOnUser() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('spot') || params.has('author')) return;

  if ('geolocation' in navigator && typeof map !== 'undefined') {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        map.setView([latitude, longitude], 15);
        setUserGpsPosition(latitude, longitude);
      },
      (err) => {
        console.info('Автогеолокация отклонена или недоступна:', err.message);
      },
      {
        enableHighAccuracy: true,
        timeout: 6000,
        maximumAge: 30000
      }
    );
  }
})();

// ==========================================
// УВЕДОМЛЕНИЕ В TELEGRAM-ГРУППУ МОДЕРАТОРОВ О НОВОЙ PREMIUM-ТОЧКЕ
// ==========================================
async function notifyPremiumSpotToMods(spotData) {
  if (!spotData || !spotData.isPremium) return;

  const BOT_TOKEN = '9014809450:AAGxoBRdf7YlMNI_RFQXrp2psPvrPpuyAQ4';
  const MODS_GROUP_CHAT_ID = '-5470690642';

  const typeNames = { sticker: 'Стикер', tag: 'Тег', graffiti: 'Граффити' };
  const typeLabel = typeNames[spotData.spotType] || 'Спот';
  const link = `https://stickermap1-nupc.vercel.app/?spot=${encodeURIComponent(spotData.id)}`;

  const text =
    `<b>[PREMIUM] Автопубликация на карту!</b>\n` +
    `Тип: ${typeLabel}\n` +
    `Название: ${escapeHtml(spotData.title || 'Без названия')}\n` +
    `Автор: ${escapeHtml(spotData.authorName || 'Аноним')} ${spotData.authorCrew ? `[${escapeHtml(spotData.authorCrew)}]` : ''}\n` +
    `<a href="${link}">Проверить на карте</a>`;

  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: MODS_GROUP_CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
  } catch (e) {
    console.warn('Ошибка отправки Premium-уведомления в ТГ-группу:', e);
  }
}

// Авто-показ переключателя «В соло / От крю»
function syncPublishAsToggle() {
  const publishAsGroup = document.getElementById('publish-as-group');
  const publishAsCrewLabel = document.getElementById('publish-as-crew-label');
  if (!publishAsGroup) return;

  if (typeof userProfile !== 'undefined' && userProfile && userProfile.crewName && userProfile.crewName.trim()) {
    publishAsGroup.classList.remove('hidden');
    if (publishAsCrewLabel) {
      publishAsCrewLabel.textContent = `От крю [${userProfile.crewName.trim()}]`;
    }
  } else {
    publishAsGroup.classList.add('hidden');
  }
}

// syncPublishAsToggle вызывается при открытии окна добавления точки
syncPublishAsToggle();

// =========================================================================
// ПАТРУЛЬ / МОДЕРАЦИЯ (ЕДИНОЕ ОКНО С ВКЛАДКАМИ «НОВЫЕ ЗАЯВКИ» И «ЖАЛОБЫ»)
// =========================================================================
(function initStaffModeration() {
  const skippedInSession = new Set();
  let isProcessingDecision = false;
  let pendingPhotosHydrated = false;
  let activePatrolTab = 'pending'; // 'pending' | 'reports'

  function parseSpotPhotosField(rawPhotos) {
    if (!rawPhotos) return [];
    let parsed = rawPhotos;
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed); } catch (e) { parsed = [parsed]; }
    }
    return Array.isArray(parsed) ? parsed : [];
  }

  async function hydratePendingQueuePhotos() {
    if (!isModeratorUser() || pendingPhotosHydrated) return;
    const targetIds = deduplicateSpots(spots)
      .filter(s => ((s.approved === false && s.rejected !== true) || (Array.isArray(s.reportedBy) && s.reportedBy.length > 0)) && !s.photosLoaded)
      .map(s => s.id)
      .slice(0, 60);

    if (targetIds.length === 0) {
      pendingPhotosHydrated = true;
      return;
    }

    try {
      const { data, error } = await supabaseClient
        .from('stickers')
        .select('id, photos')
        .in('id', targetIds);

      if (!error && Array.isArray(data)) {
        const photosById = new Map(data.map(r => [String(r.id), parseSpotPhotosField(r.photos)]));
        spots.forEach(s => {
          if (photosById.has(String(s.id))) {
            s.photos = photosById.get(String(s.id));
            s.photosLoaded = true;
            s.hasPhoto = getSpotPhotoUrls(s).length > 0;
          }
        });
        pendingPhotosHydrated = true;
        updatePatrolButton();
      }
    } catch (e) {
      console.warn('Ошибка предзагрузки фото для патруля:', e);
    }
  }

  function getPendingQueue() {
    if (!isModeratorUser()) return [];
    const uniqueSpots = deduplicateSpots(spots);
    return uniqueSpots
      .filter(s => {
        if (s.approved !== false || s.rejected === true) return false;
        if (skippedInSession.has('p_' + String(s.id))) return false;
        if (s.photosLoaded && !hasValidSpotPhoto(s)) return false;
        return true;
      })
      .sort((a, b) => {
        const aPrem = isSpotAuthorPremium(a) ? 1 : 0;
        const bPrem = isSpotAuthorPremium(b) ? 1 : 0;
        if (bPrem !== aPrem) return bPrem - aPrem;
        return (a.createdAt || 0) - (b.createdAt || 0);
      });
  }

  function getReportsQueue() {
    if (!isModeratorUser()) return [];
    const uniqueSpots = deduplicateSpots(spots);
    return uniqueSpots
      .filter(s => {
        if (s.rejected === true) return false;
        const repCount = Array.isArray(s.reportedBy) ? s.reportedBy.length : 0;
        if (repCount <= 0) return false;
        if (skippedInSession.has('r_' + String(s.id))) return false;
        return true;
      })
      .sort((a, b) => (b.reportedBy?.length || 0) - (a.reportedBy?.length || 0));
  }

  function updatePatrolButton() {
    const btnRegular = document.getElementById('btn-open-patrol');
    const countRegularEl = document.getElementById('patrol-pending-count');

    if (!isModeratorUser()) {
      btnRegular?.classList.add('hidden');
      return;
    }

    if (!pendingPhotosHydrated && spots.some(s => (s.approved === false || (Array.isArray(s.reportedBy) && s.reportedBy.length > 0)) && !s.photosLoaded)) {
      hydratePendingQueuePhotos();
    }

    const totalCount = getPendingQueue().length + getReportsQueue().length;

    if (btnRegular) {
      btnRegular.classList.remove('hidden');
      if (countRegularEl) countRegularEl.textContent = totalCount;
    }
  }

  refreshPatrolBadgeFn = updatePatrolButton;
  updatePatrolButton();

  document.getElementById('btn-open-patrol')?.addEventListener('click', async () => {
    skippedInSession.clear();
    isProcessingDecision = false;
    pendingPhotosHydrated = false;
    await hydratePendingQueuePhotos();
    const pendingLen = getPendingQueue().length;
    const reportsLen = getReportsQueue().length;
    activePatrolTab = (pendingLen === 0 && reportsLen > 0) ? 'reports' : 'pending';
    await openPatrolModal(activePatrolTab);
  });

  const preloadedUrls = new Set();
  function preloadUpcomingPatrolImages(queue) {
    if (!Array.isArray(queue) || queue.length <= 1) return;
    queue.slice(1, 5).forEach((nextSpot) => {
      const urls = getSpotPhotoUrls(nextSpot);
      urls.forEach((url) => {
        if (url && /^https?:\/\//i.test(url) && !preloadedUrls.has(url)) {
          preloadedUrls.add(url);
          const img = new Image();
          img.decoding = 'async';
          img.src = url;
        }
      });
    });
  }

  async function ensureSpotPhotosLoaded(spot) {
    if (!spot) return [];
    const existing = getSpotPhotoUrls(spot);
    if (existing.length > 0 && spot.photosLoaded) return existing;

    try {
      const { data, error } = await supabaseClient
        .from('stickers')
        .select('photos')
        .eq('id', spot.id)
        .single();
      if (!error && data) {
        spot.photos = parseSpotPhotosField(data.photos);
        spot.photosLoaded = true;
        spot.hasPhoto = getSpotPhotoUrls(spot).length > 0;
        return getSpotPhotoUrls(spot);
      }
    } catch (e) {}
    return existing;
  }

  async function removeBrokenEmptySpot(spot) {
    spot.hasPhoto = false;
    spot.rejected = true;
    skippedInSession.add('p_' + String(spot.id));

    const { data, error } = await supabaseClient
      .from('stickers')
      .delete()
      .eq('id', spot.id)
      .select('id');

    if (error || !data || data.length === 0) {
      await supabaseClient
        .from('stickers')
        .update({ rejected: true, approved: false })
        .eq('id', spot.id);
    }

    spots = spots.filter(s => String(s.id) !== String(spot.id));
    syncLocalSpotsCache();
    updatePatrolButton();
  }

  async function openPatrolModal(tab = activePatrolTab) {
    if (!isModeratorUser()) return;
    activePatrolTab = tab;
    isProcessingDecision = false;
    document.getElementById('patrol-modal-overlay')?.remove();

    const pendingQueue = getPendingQueue();
    const reportsQueue = getReportsQueue();
    const isReportsTab = tab === 'reports';
    const currentQueue = isReportsTab ? reportsQueue : pendingQueue;

    const overlay = document.createElement('div');
    overlay.id = 'patrol-modal-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.82);
      display: flex; align-items: center; justify-content: center;
      z-index: 10000; padding: 14px; backdrop-filter: blur(4px);
    `;

    const tabsHeaderHtml = `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 16px; border-bottom:1px solid rgba(255,255,255,0.08);">
        <div style="display:flex; gap:6px;">
          <button type="button" id="patrol-tab-pending" style="padding:6px 10px; border:none; border-radius:8px; font-size:12px; font-weight:700; cursor:pointer; background:${!isReportsTab ? '#ffcc00' : 'rgba(255,255,255,0.08)'}; color:${!isReportsTab ? '#111' : '#cbd5e1'};">
            Новые заявки (${pendingQueue.length})
          </button>
          <button type="button" id="patrol-tab-reports" style="padding:6px 10px; border:none; border-radius:8px; font-size:12px; font-weight:700; cursor:pointer; background:${isReportsTab ? '#ef4444' : 'rgba(255,255,255,0.08)'}; color:${isReportsTab ? '#fff' : '#cbd5e1'};">
            Жалобы (${reportsQueue.length})
          </button>
        </div>
        <button type="button" id="close-patrol-modal" style="background:none; border:none; color:#94a3b8; font-size:22px; cursor:pointer; line-height:1;">&times;</button>
      </div>
    `;

    if (!currentQueue.length) {
      overlay.innerHTML = `
        <div style="background:#161922; color:#fff; border:1px solid rgba(255,255,255,0.12); border-radius:16px; max-width:410px; width:100%; overflow:hidden;">
          ${tabsHeaderHtml}
          <div style="padding:24px 18px; text-align:center;">
            <h3 style="margin:0 0 6px;">${isReportsTab ? 'Жалоб пока нет' : 'Очередь заявок пуста'}</h3>
            <p style="font-size:13px; color:#94a3b8; margin:0 0 16px;">Все публикации в этом разделе проверены.</p>
            <button type="button" id="close-patrol-empty" style="width:100%; padding:10px; border:none; border-radius:10px; background:#ffcc00; color:#000; font-weight:700; cursor:pointer;">Закрыть</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      document.getElementById('close-patrol-modal').onclick = () => overlay.remove();
      document.getElementById('close-patrol-empty').onclick = () => overlay.remove();
      document.getElementById('patrol-tab-pending').onclick = () => openPatrolModal('pending');
      document.getElementById('patrol-tab-reports').onclick = () => openPatrolModal('reports');
      overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
      return;
    }

    const spot = currentQueue[0];
    const photos = await ensureSpotPhotosLoaded(spot);
    preloadUpcomingPatrolImages(currentQueue);

    if (!isReportsTab && (!photos.length || !/^https?:\/\//i.test(photos[0]))) {
      await removeBrokenEmptySpot(spot);
      await openPatrolModal(tab);
      return;
    }

    const mainPhoto = photos.length > 0 ? photos[0] : 'icon-512.png';
    const typeText = spot.spotType === 'graffiti' ? 'Граффити' : (spot.spotType === 'tag' ? 'Тег' : 'Стикер');
    const authorDisplay = spot.authorName || 'Игрок';
    const isSpotPrem = isSpotAuthorPremium(spot);
    const reportsCount = Array.isArray(spot.reportedBy) ? spot.reportedBy.length : 0;

    let topBannerHtml = '';
    if (isReportsTab) {
      topBannerHtml = `<div style="background:#ef4444; color:#fff; font-size:11px; font-weight:900; text-align:center; padding:5px 10px; letter-spacing:0.05em; text-transform:uppercase;">
        ПОСТУПИЛИ ЖАЛОБЫ ОТ ИГРОКОВ: ${reportsCount} ШТ.
      </div>`;
    } else if (isSpotPrem) {
      topBannerHtml = `<div style="background:linear-gradient(90deg,#ffd60a,#f59e0b); color:#111; font-size:11px; font-weight:900; text-align:center; padding:5px 10px; letter-spacing:0.05em; text-transform:uppercase;">
        PREMIUM ЗАЯВКА — ПРИОРИТЕТНАЯ ПРОВЕРКА
      </div>`;
    }

    const actionsHtml = isReportsTab
      ? `
        <div id="patrol-main-actions" style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <button type="button" id="patrol-clear-reports" style="padding:11px; border:none; border-radius:10px; background:#22c55e; color:#052e16; font-weight:700; font-size:14px; cursor:pointer;">
            Оставить (снять жалобы)
          </button>
          <button type="button" id="patrol-show-reject-reasons" style="padding:11px; border:none; border-radius:10px; background:#ef4444; color:#fff; font-weight:700; font-size:14px; cursor:pointer;">
            Удалить работу
          </button>
        </div>
      `
      : `
        <div id="patrol-main-actions" style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <button type="button" id="patrol-show-reject-reasons" style="padding:11px; border:none; border-radius:10px; background:#ef4444; color:#fff; font-weight:700; font-size:14px; cursor:pointer;">
            Отклонить
          </button>
          <button type="button" id="patrol-vote-approve" style="padding:11px; border:none; border-radius:10px; background:#22c55e; color:#052e16; font-weight:700; font-size:14px; cursor:pointer;">
            Выложить
          </button>
        </div>
      `;

    overlay.innerHTML = `
      <div style="background:#161922; color:#fff; border:1px solid ${isReportsTab ? '#ef4444' : (isSpotPrem ? '#ffd60a' : 'rgba(255,255,255,0.12)')}; border-radius:16px; max-width:410px; width:100%; max-height:92vh; overflow-y:auto; box-shadow:0 20px 45px rgba(0,0,0,0.6);">
        ${topBannerHtml}
        ${tabsHeaderHtml}

        <div style="padding:14px 16px;">
          <div id="patrol-photo-box" style="position:relative; border-radius:12px; overflow:hidden; background:#0d0f14; margin-bottom:12px; cursor:zoom-in;">
            <img id="patrol-main-img" src="${escapeHtml(mainPhoto)}" style="width:100%; max-height:260px; object-fit:cover; display:block;">
            <span style="position:absolute; top:8px; left:8px; background:rgba(0,0,0,0.78); padding:4px 8px; border-radius:8px; font-size:12px; font-weight:600;">${typeText}</span>
            <span style="position:absolute; bottom:8px; right:8px; background:rgba(0,0,0,0.78); padding:3px 8px; border-radius:6px; font-size:11px; color:#e2e8f0;">Открыть фото</span>
          </div>

          <div style="font-size:16px; font-weight:700; margin-bottom:4px;">${escapeHtml(spot.title || 'Без названия')}</div>
          <div style="font-size:12px; color:#94a3b8; margin-bottom:8px; display:flex; align-items:center; justify-content:space-between; gap:8px;">
            <div>
              Автор:
              <button type="button" id="patrol-open-author" style="background:none; border:none; padding:0; color:#60a5fa; font-weight:700; font-size:12px; text-decoration:underline; cursor:pointer;">
                ${escapeHtml(authorDisplay)}
              </button>
              ${isSpotPrem ? '<span class="premium-badge-pill" style="margin-left:4px;">PREMIUM</span>' : ''}
              ${spot.authorCrew ? `<span style="color:#cbd5e1;">[${escapeHtml(spot.authorCrew)}]</span>` : ''}
            </div>
            <button type="button" id="patrol-skip-spot" style="background:rgba(255,255,255,0.08); border:none; border-radius:6px; color:#94a3b8; font-size:11px; padding:3px 8px; cursor:pointer;">Пропустить</button>
          </div>

          <div style="font-size:13px; color:#cbd5e1; background:rgba(255,255,255,0.04); padding:8px 10px; border-radius:8px; margin-bottom:12px;">
            ${escapeHtml(spot.note || 'Без описания')}
          </div>

          ${actionsHtml}

          <div id="patrol-reject-panel" style="display:none; margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.1);">
            <div style="font-size:12px; font-weight:700; color:#fca5a5; margin-bottom:6px;">Причина отклонения:</div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:6px;">
              <button type="button" class="patrol-reason-btn" data-reason="Размытое фото" style="padding:7px 6px; border:1px solid rgba(239,68,68,0.4); border-radius:8px; background:rgba(239,68,68,0.15); color:#fff; font-size:12px; font-weight:600; cursor:pointer;">Размытое фото</button>
              <button type="button" class="patrol-reason-btn" data-reason="Спам" style="padding:7px 6px; border:1px solid rgba(239,68,68,0.4); border-radius:8px; background:rgba(239,68,68,0.15); color:#fff; font-size:12px; font-weight:600; cursor:pointer;">Спам</button>
              <button type="button" class="patrol-reason-btn" data-reason="В помещении" style="padding:7px 6px; border:1px solid rgba(239,68,68,0.4); border-radius:8px; background:rgba(239,68,68,0.15); color:#fff; font-size:12px; font-weight:600; cursor:pointer;">В помещении</button>
              <button type="button" class="patrol-reason-btn" data-reason="На транспорте" style="padding:7px 6px; border:1px solid rgba(239,68,68,0.4); border-radius:8px; background:rgba(239,68,68,0.15); color:#fff; font-size:12px; font-weight:600; cursor:pointer;">На транспорте</button>
              <button type="button" class="patrol-reason-btn" data-reason="Дубликат" style="padding:7px 6px; border:1px solid rgba(239,68,68,0.4); border-radius:8px; background:rgba(239,68,68,0.15); color:#fff; font-size:12px; font-weight:600; cursor:pointer;">Дубликат</button>
              <button type="button" class="patrol-reason-btn" data-reason="Работы уже нет на месте" style="padding:7px 6px; border:1px solid rgba(239,68,68,0.4); border-radius:8px; background:rgba(239,68,68,0.15); color:#fff; font-size:12px; font-weight:600; cursor:pointer;">Нет на месте</button>
              <button type="button" class="patrol-reason-btn" data-reason="Не видно работу" style="padding:7px 6px; border:1px solid rgba(239,68,68,0.4); border-radius:8px; background:rgba(239,68,68,0.15); color:#fff; font-size:12px; font-weight:600; cursor:pointer;">Не видно работу</button>
              <button type="button" class="patrol-reason-btn" data-reason="Низкое качество исполнения" style="padding:7px 6px; border:1px solid rgba(239,68,68,0.4); border-radius:8px; background:rgba(239,68,68,0.15); color:#fff; font-size:12px; font-weight:600; cursor:pointer;">Низкое качество</button>
            </div>
            <div style="display:flex; gap:6px; margin-bottom:6px;">
              <input type="text" id="patrol-custom-reason" placeholder="Своя причина..." style="flex:1; padding:7px 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.15); background:rgba(0,0,0,0.4); color:#fff; font-size:12px;">
              <button type="button" id="patrol-submit-custom-reason" style="padding:7px 12px; border:none; border-radius:8px; background:#ef4444; color:#fff; font-weight:700; font-size:12px; cursor:pointer;">Отправить</button>
            </div>
            <button type="button" id="patrol-cancel-reject" style="width:100%; padding:7px; border:none; border-radius:8px; background:rgba(255,255,255,0.08); color:#94a3b8; font-size:12px; cursor:pointer;">Назад</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('patrol-tab-pending').onclick = () => openPatrolModal('pending');
    document.getElementById('patrol-tab-reports').onclick = () => openPatrolModal('reports');

    const photoBox = document.getElementById('patrol-photo-box');
    const mainImg = document.getElementById('patrol-main-img');
    if (photoBox && mainPhoto && mainPhoto !== 'icon-512.png') {
      photoBox.onclick = () => window.openLightbox(mainPhoto);
    }
    if (mainImg && !isReportsTab) {
      mainImg.onerror = async () => {
        await removeBrokenEmptySpot(spot);
        await openPatrolModal(tab);
      };
    }

    document.getElementById('patrol-open-author')?.addEventListener('click', () => {
      window.openAuthorCard(authorDisplay);
    });

    document.getElementById('patrol-skip-spot')?.addEventListener('click', async () => {
      skippedInSession.add((isReportsTab ? 'r_' : 'p_') + String(spot.id));
      updatePatrolButton();
      await openPatrolModal(tab);
    });

    document.getElementById('close-patrol-modal').onclick = () => overlay.remove();

    const approveBtn = document.getElementById('patrol-vote-approve');
    if (approveBtn) {
      approveBtn.onclick = () => decideSpot(spot, 'approve', '');
    }

    const clearReportsBtn = document.getElementById('patrol-clear-reports');
    if (clearReportsBtn) {
      clearReportsBtn.onclick = () => decideSpot(spot, 'clear_reports', '');
    }

    const mainActions = document.getElementById('patrol-main-actions');
    const rejectPanel = document.getElementById('patrol-reject-panel');

    document.getElementById('patrol-show-reject-reasons').onclick = () => {
      mainActions.style.display = 'none';
      rejectPanel.style.display = 'block';
      if (mainImg) mainImg.style.maxHeight = '125px';
    };

    document.getElementById('patrol-cancel-reject').onclick = () => {
      rejectPanel.style.display = 'none';
      mainActions.style.display = 'grid';
      if (mainImg) mainImg.style.maxHeight = '260px';
    };

    overlay.querySelectorAll('.patrol-reason-btn').forEach(btn => {
      btn.onclick = () => decideSpot(spot, 'reject', btn.dataset.reason);
    });

    document.getElementById('patrol-submit-custom-reason').onclick = () => {
      const val = (document.getElementById('patrol-custom-reason').value || '').trim();
      if (!val) {
        alert('Впиши причину.');
        return;
      }
      decideSpot(spot, 'reject', val);
    };
  }

  async function decideSpot(spot, action, rejectReason) {
    if (!isModeratorUser() || isProcessingDecision) return;
    isProcessingDecision = true;

    const overlay = document.getElementById('patrol-modal-overlay');
    overlay?.querySelectorAll('button').forEach(b => { b.disabled = true; });
    const modLabel = getModeratorLabelByEmail(currentUser?.email);

    try {
      if (action === 'approve') {
        let { data, error } = await supabaseClient
          .from('stickers')
          .update({ approved: true, rejected: false, approvedByLabel: modLabel })
          .eq('id', spot.id)
          .select('id');

        if (error && String(error.message || '').includes('approvedByLabel')) {
          const retry = await supabaseClient
            .from('stickers')
            .update({ approved: true, rejected: false })
            .eq('id', spot.id)
            .select('id');
          data = retry.data;
          error = retry.error;
        }

        if (error) throw error;
        if (!data || data.length === 0) {
          throw new Error('Supabase не обновил запись (проверь RLS-политику UPDATE для stickers).');
        }

        spot.approved = true;
        spot.rejected = false;
        spot.approvedByLabel = modLabel;
      } else if (action === 'clear_reports') {
        const { data, error } = await supabaseClient
          .from('stickers')
          .update({ approved: true, rejected: false, reportedBy: [] })
          .eq('id', spot.id)
          .select('id');

        if (error) throw error;
        if (!data || data.length === 0) {
          throw new Error('Supabase не обновил запись (проверь RLS-политику UPDATE для stickers).');
        }

        spot.approved = true;
        spot.rejected = false;
        spot.reportedBy = [];
      } else {
        if (spot.authorUid && spot.authorUid !== 'admin') {
          try {
            await supabaseClient.from('notifications').insert({
              id: 'ntf_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
              user_uid: spot.authorUid,
              spot_title: spot.title || 'Без названия',
              reason: rejectReason || 'Не соответствует правилам',
              is_read: false,
              created_at: Date.now()
            });
          } catch (notifErr) {
            console.warn('Не удалось создать уведомление:', notifErr);
          }
        }

        const { data: deletedRows, error: delError } = await supabaseClient
          .from('stickers')
          .delete()
          .eq('id', spot.id)
          .select('id');

        if (delError) throw delError;

        if (!deletedRows || deletedRows.length === 0) {
          const { data: updRows, error: updErr } = await supabaseClient
            .from('stickers')
            .update({ rejected: true, approved: false })
            .eq('id', spot.id)
            .select('id');

          if (updErr || !updRows || updRows.length === 0) {
            throw new Error('База заблокировала удаление и скрытие записи (проверь RLS-политики в Supabase).');
          }
        }

        await deleteSpotFilesFromStorage(spot);
        spots = spots.filter(s => String(s.id) !== String(spot.id));
      }

      syncLocalSpotsCache();
      updatePatrolButton();
      isProcessingDecision = false;
      await openPatrolModal(activePatrolTab);
    } catch (err) {
      isProcessingDecision = false;
      console.error('Ошибка модерации:', err);
      alert('Ошибка базы при обработке заявки: ' + (err.message || err));
      overlay?.querySelectorAll('button').forEach(b => { b.disabled = false; });
    }
  }
})();

// =========================================================================
// БЫСТРЫЙ ФИЛЬТР СЛОЁВ НА КАРТЕ (3 ТОЧКИ) + РЕЖИМ СТАТУСОВ ДЛЯ СТАФФА
// =========================================================================
(function initMapFilterWidget() {
  const btnMapFilter = document.getElementById('btn-map-filter');
  const mapFilterPopover = document.getElementById('map-filter-popover');
  if (!btnMapFilter || !mapFilterPopover) return;

  btnMapFilter.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = mapFilterPopover.classList.toggle('hidden');
    btnMapFilter.classList.toggle('active', !isHidden);
  });

  mapFilterPopover.addEventListener('click', (e) => e.stopPropagation());

  document.addEventListener('click', () => {
    mapFilterPopover.classList.add('hidden');
    btnMapFilter.classList.remove('active');
  });

  document.querySelectorAll('.spot-type-layer-check').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        visibleSpotTypes.add(checkbox.value);
      } else {
        visibleSpotTypes.delete(checkbox.value);
      }
      renderMarkers();
    });
  });

  document.querySelectorAll('input[name="staffStatusFilter"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      staffStatusFilter = e.target.value;
      renderMarkers();
    });
  });
})();

// =========================================================================
// МАССОВОЕ ВЫДЕЛЕНИЕ И УДАЛЕНИЕ РАБОТ ДЛЯ СТАФФА
// =========================================================================
function updateBulkDeleteBar() {
  let bar = document.getElementById('bulk-delete-bar');
  if (!bulkSelectMode || !isOwnerUser()) {
    bar?.remove();
    return;
  }

  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'bulk-delete-bar';
    bar.className = 'bulk-delete-bar';
    document.body.appendChild(bar);
  }

  const count = selectedSpotIds.size;
  bar.innerHTML = `
    <div style="font-size:13px; font-weight:700;">
      Выбрано: <span style="color:#fca5a5;">${count}</span>
    </div>
    <div style="display:flex; gap:6px;">
      <button type="button" id="btn-bulk-cancel" style="padding:7px 11px; border:none; border-radius:8px; background:rgba(255,255,255,0.12); color:#fff; font-size:12px; font-weight:700; cursor:pointer;">
        Отмена
      </button>
      <button type="button" id="btn-bulk-confirm-delete" ${count === 0 ? 'disabled' : ''} style="padding:7px 12px; border:none; border-radius:8px; background:${count === 0 ? '#555' : '#ef4444'}; color:#fff; font-size:12px; font-weight:700; cursor:${count === 0 ? 'default' : 'pointer'};">
        Удалить (${count})
      </button>
    </div>
  `;

  document.getElementById('btn-bulk-cancel').onclick = () => {
    bulkSelectMode = false;
    selectedSpotIds.clear();
    updateBulkDeleteBar();
    renderMarkers();
  };

  document.getElementById('btn-bulk-confirm-delete').onclick = async () => {
    if (selectedSpotIds.size === 0 || !isOwnerUser()) return;
    if (!confirm(`Точно удалить выбранные работы (${selectedSpotIds.size} шт.)? Это действие необратимо.`)) return;

    const btn = document.getElementById('btn-bulk-confirm-delete');
    btn.disabled = true;
    btn.textContent = 'Удаление...';

    try {
      const idsToDelete = Array.from(selectedSpotIds);
      const targets = spots.filter(s => selectedSpotIds.has(String(s.id)));

      const { error } = await supabaseClient.from('stickers').delete().in('id', idsToDelete);
      if (error) throw error;

      for (const sp of targets) {
        await deleteSpotFilesFromStorage(sp);
      }

      spots = spots.filter(s => !selectedSpotIds.has(String(s.id)));
      selectedSpotIds.clear();
      bulkSelectMode = false;

      syncLocalSpotsCache();
      updateBulkDeleteBar();
    } catch (err) {
      alert('Ошибка массового удаления: ' + (err.message || err));
      btn.disabled = false;
      btn.textContent = `Удалить (${selectedSpotIds.size})`;
    }
  };
}

document.getElementById('btn-toggle-bulk-select')?.addEventListener('click', () => {
  if (!isOwnerUser()) return;
  bulkSelectMode = !bulkSelectMode;
  selectedSpotIds.clear();
  document.getElementById('map-filter-popover')?.classList.add('hidden');
  document.getElementById('btn-map-filter')?.classList.remove('active');
  updateBulkDeleteBar();
  renderMarkers();
});
