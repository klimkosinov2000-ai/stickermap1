// Конфигурация Firebase
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

auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch((err) => {
  console.warn('Ошибка установки persistence:', err);
});

// Проверка админ-режима по ключу
const urlParams = new URLSearchParams(window.location.search);
const isAdmin = urlParams.get('key') === 'maker77';

// Безопасный base64 SVG-аватар
const DEFAULT_AVATAR = "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><rect width="80" height="80" fill="#222"/><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="#ffcc00" font-family="sans-serif" font-size="36" font-weight="bold">S</text></svg>');

let currentUser = null;
let userProfile = null;
let authChecked = false;
let pendingAvatarBase64 = '';
let territoryScoreByKey = {};

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
let gpsMarker = null;
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
// УТИЛИТЫ: КЛЮЧИ, РАДИУСЫ, РАНГИ И ФОРМАТЫ
// ==========================================
function getTerritoryKey(spot) {
  if (spot.authorCrew && spot.authorCrew.trim()) {
    return 'crew_' + spot.authorCrew.trim().toLowerCase();
  }
  return 'solo_' + (spot.authorUid || 'admin');
}

function getSpotRadiusKm(spot) {
  if (spot.isHotspot) {
    return (spot.status === 'damaged' ? 180 : 350) / 1000;
  }
  if (spot.spotType === 'graffiti') {
    return (spot.status === 'damaged' ? 120 : 250) / 1000;
  }
  return (spot.status === 'damaged' ? 70 : 135) / 1000;
}

// Расчёт ранга по площади (Toy: 0–0.25 км², Tagger: 0.25–0.75 км², Bomber: 0.75–2.0 км², King: 2.0+ км²)
function calculateStreetRank(areaSqMeters, totalLikes = 0) {
  const km2 = areaSqMeters / 1_000_000;

  if (km2 >= 2.0) {
    return {
      title: 'King of the Wall',
      nextHint: 'Максимальный уличный ранг достигнут! 👑'
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
    : 'solo_' + currentUser.uid;

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
  if (spot.authorColor && /^#[0-9A-Fa-f]{6}$/.test(spot.authorColor)) {
    return spot.authorColor;
  }
  if (!spot.authorCrew || !spot.authorCrew.trim()) {
    return '#2ecc71';
  }
  const seed = spot.authorCrew.trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 82%, 52%)`;
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

filterSearchInput?.addEventListener('input', renderMarkers);
filterTypeSelect?.addEventListener('change', renderMarkers);
filterOnlyCrewCheck?.addEventListener('change', renderMarkers);
filterHideGoneCheck?.addEventListener('change', renderMarkers);

// ==========================================
// 2. АВТОРИЗАЦИЯ И ПРОФИЛЬ (РАНГ, АВАТАР, ЦВЕТ, КОД КРЮ)
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
      try {
        await auth.createUserWithEmailAndPassword(email, password);
        authModal.classList.add('hidden');
      } catch (regErr) {
        if (regErr.code === 'auth/email-already-in-use') {
          alert('Неверный пароль для этой почты.');
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

    if (!authChecked && !isAdmin && !sessionStorage.getItem('guest_mode_chosen')) {
      authModal.classList.remove('hidden');
    }
  }
  authChecked = true;
});

async function handleUserSignedIn(userObj) {
  currentUser = userObj;
  try {
    const doc = await db.collection('users').doc(userObj.uid).get();
    if (doc.exists) {
      userProfile = doc.data();
      renderUserPanel();
      await claimLegacySpots();
      renderMarkers();
    } else {
      openProfileModal();
    }
  } catch (err) {
    console.error('Ошибка загрузки профиля:', err);
  }
}

function renderUserPanel() {
  if (!currentUser) {
    userPanel.innerHTML = `<button id="btn-open-auth" class="btn-auth-trigger">Войти / Регистрация</button>`;
    document.getElementById('btn-open-auth').addEventListener('click', () => {
      authModal.classList.remove('hidden');
    });
    return;
  }

  const nick = userProfile ? userProfile.nickname : currentUser.defaultName;
  const avatarSrc = (userProfile && userProfile.avatarUrl) ? userProfile.avatarUrl : DEFAULT_AVATAR;
  const borderCol = (userProfile && userProfile.zoneColor) ? userProfile.zoneColor : '#ffcc00';

  const { areaSqMeters, totalLikes } = getUserMetrics();
  const rankInfo = calculateStreetRank(areaSqMeters, totalLikes);

  const crewBadge = (userProfile && userProfile.crewType === 'crew' && userProfile.crewName)
    ? `<span class="user-crew-tag" style="background:${borderCol}; color:#111;">[${userProfile.crewName}]</span>`
    : `<span style="font-size:10px; color:#a1a1aa;">(Solo)</span>`;

  userPanel.innerHTML = `
    <div class="user-badge" id="btn-edit-profile" title="Ранг: ${rankInfo.title} • Настройки профиля">
      <img class="user-badge-avatar" src="${avatarSrc}" style="border-color:${borderCol};">
      <span>${nick}</span>
      <span class="user-rank-mini">${rankInfo.title}</span>
      ${crewBadge}
    </div>
  `;

  document.getElementById('btn-edit-profile').addEventListener('click', openProfileModal);
}

// Пресеты цвета
document.querySelectorAll('.swatch-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    colorInput.value = btn.dataset.color;
  });
});

// Загрузка и сжатие аватарки
avatarInput?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  pendingAvatarBase64 = await resizeImage(file, 140, 0.75);
  if (avatarPreview) avatarPreview.src = pendingAvatarBase64;
});

function openProfileModal() {
  const { areaSqMeters, totalLikes } = getUserMetrics();
  const rankInfo = calculateStreetRank(areaSqMeters, totalLikes);

  const rankBadgeEl = document.getElementById('profile-rank-badge');
  const rankStatsEl = document.getElementById('profile-rank-stats');
  const rankNextEl = document.getElementById('profile-rank-next');
  if (rankBadgeEl) rankBadgeEl.textContent = rankInfo.title;
  if (rankStatsEl) rankStatsEl.textContent = `${formatArea(areaSqMeters)} • ${totalLikes} 🔥`;
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

// Сохранение профиля (с защитой от блокировки собственного ника)
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
    const allUsersSnap = await db.collection('users').get();
    let isTaken = false;
    const duplicateRefs = [];

    allUsersSnap.forEach(doc => {
      const data = doc.data();
      const docNickLower = (data.nicknameLower || data.nickname || '').trim().toLowerCase();
      if (doc.id !== currentUser.uid && docNickLower === nickLower) {
        isTaken = true;
        duplicateRefs.push(doc.ref);
      }
    });

    const isSameAsCurrentNick = userProfile &&
      userProfile.nickname &&
      userProfile.nickname.trim().toLowerCase() === nickLower;

    if (isTaken) {
      if (isSameAsCurrentNick || isAdmin) {
        for (const ref of duplicateRefs) {
          await ref.delete();
        }
      } else {
        alert(`Ник «${rawNick}» уже занят другим игроком! Придумай другой.`);
        return;
      }
    }

    let finalZoneColor = chosenColor;
    if (crewType === 'crew') {
      const crewId = rawCrewName.toLowerCase();
      const crewRef = db.collection('crews').doc(crewId);
      const crewDoc = await crewRef.get();

      if (crewDoc.exists) {
        const crewData = crewDoc.data();
        if (crewData.inviteCode !== rawCrewCode) {
          alert(`Неверный инвайт-код для крю «${rawCrewName}»! Спроси код у основателя команды.`);
          return;
        }
        if (crewData.ownerUid === currentUser.uid) {
          await crewRef.update({ color: chosenColor });
        } else {
          finalZoneColor = crewData.color || chosenColor;
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

    await db.collection('users').doc(currentUser.uid).set(profileData);
    userProfile = profileData;
    profileModal.classList.add('hidden');
    renderUserPanel();
    await syncUserSpotsMetadata();
    await claimLegacySpots();
    renderMarkers();
  } catch (err) {
    console.error('Ошибка сохранения профиля:', err);
    alert('Не удалось сохранить профиль: ' + err.message);
  } finally {
    saveProfileBtn.disabled = false;
    saveProfileBtn.textContent = 'Сохранить';
  }
});

// Привязка старых бесхозных точек
async function claimLegacySpots() {
  if (!currentUser || !userProfile) return;

  const myNickLower = userProfile.nickname.trim().toLowerCase();
  const legacySpots = spots.filter(s =>
    !s.authorUid ||
    s.authorUid === 'admin' ||
    (s.authorUid !== currentUser.uid && s.authorName && s.authorName.trim().toLowerCase() === myNickLower)
  );
  if (legacySpots.length === 0) return;

  const batch = db.batch();
  legacySpots.forEach(spot => {
    const ref = db.collection('stickers').doc(spot.id);
    batch.update(ref, {
      authorUid: currentUser.uid,
      authorName: userProfile.nickname,
      authorAvatar: userProfile.avatarUrl || '',
      authorColor: userProfile.zoneColor || '#2ecc71',
      authorCrew: userProfile.crewType === 'crew' ? userProfile.crewName : ''
    });
  });

  try {
    await batch.commit();
  } catch (err) {
    console.error('Ошибка привязки старых точек:', err);
  }
}

// Синхронизация ника, цвета, аватарки и крю на всех своих точках
async function syncUserSpotsMetadata() {
  if (!currentUser || !userProfile) return;

  const newCrew = userProfile.crewType === 'crew' ? userProfile.crewName : '';
  const newColor = userProfile.zoneColor || '#2ecc71';
  const newAvatar = userProfile.avatarUrl || '';

  const myOutdatedSpots = spots.filter(
    s => s.authorUid === currentUser.uid && (
      s.authorName !== userProfile.nickname ||
      (s.authorCrew || '') !== newCrew ||
      (s.authorColor || '') !== newColor ||
      (s.authorAvatar || '') !== newAvatar
    )
  );

  if (myOutdatedSpots.length === 0) return;

  const batch = db.batch();
  myOutdatedSpots.forEach(spot => {
    const ref = db.collection('stickers').doc(spot.id);
    batch.update(ref, {
      authorName: userProfile.nickname,
      authorCrew: newCrew,
      authorColor: newColor,
      authorAvatar: newAvatar
    });
  });

  try {
    await batch.commit();
  } catch (err) {
    console.error('Ошибка обновления метаданных точек:', err);
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
// 3. ОТРИСОВКА (СТИКЕРЫ, ГРАФФИТИ, HOTSPOTS), ТОП, РАНГИ И ЛЕНТА
// ==========================================
function createPin(spot, color) {
  const pendingClass = spot.approved === false ? 'pin-pending' : '';
  const isHotspot = Boolean(spot.isHotspot);
  const isGraffiti = spot.spotType === 'graffiti';

  let extraClass = '';
  if (isHotspot) {
    extraClass = 'pin-hotspot';
  } else if (isGraffiti) {
    extraClass = 'pin-graffiti';
  }

  const bgColor = spot.status === 'gone' ? '#e74c3c' : color;
  const authorNick = spot.authorName || 'Автор';
  const crewTag = spot.authorCrew ? ` [${spot.authorCrew}]` : '';
  const innerSymbol = isHotspot
    ? '👑'
    : (isGraffiti ? '🎨' : (spot.title ? spot.title[0].toUpperCase() : 'S'));

  return L.divIcon({
    className: 'custom-pin-container',
    html: `
      <div class="pin-wrapper">
        <div class="custom-pin ${extraClass} ${pendingClass}" style="background:${bgColor};">
          ${innerSymbol}
        </div>
        <div class="pin-author-label">${isHotspot ? '👑 ' : ''}${authorNick}${crewTag}</div>
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

function renderMarkers() {
  Object.values(markersMap).forEach(m => map.removeLayer(m));
  territoryLayers.forEach(layer => map.removeLayer(layer));
  markersMap = {};
  territoryLayers = [];
  territoryScoreByKey = {};

  const searchQuery = (filterSearchInput?.value || '').trim().toLowerCase();
  const typeFilter = filterTypeSelect?.value || 'all';
  const onlyMyCrew = filterOnlyCrewCheck?.checked || false;
  const hideGone = filterHideGoneCheck?.checked || false;

  const sortedSpots = [...spots].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  const zoneGroups = {};
  const recentFeedSpots = [];

  sortedSpots.forEach(spot => {
    if (spot.spotType === 'camera') return;

    const isApproved = spot.approved !== false;
    const isAuthor = currentUser && spot.authorUid === currentUser.uid;
    const reportsCount = Array.isArray(spot.reportedBy) ? spot.reportedBy.length : 0;
    const spotType = spot.spotType === 'graffiti' ? 'graffiti' : 'sticker';
    const isHotspot = Boolean(spot.isHotspot);

    if (!isAdmin && !isAuthor) {
      if (!isApproved || reportsCount >= 3) return;
    }

    if (isApproved) {
      recentFeedSpots.push(spot);
    }

    if (typeFilter === 'hotspot' && !isHotspot) return;
    if ((typeFilter === 'sticker' || typeFilter === 'graffiti') && spotType !== typeFilter) return;
    if (hideGone && spot.status === 'gone') return;
    if (onlyMyCrew && userProfile && userProfile.crewName) {
      if ((spot.authorCrew || '').toLowerCase() !== userProfile.crewName.toLowerCase()) return;
    }
    if (searchQuery) {
      const haystack = `${spot.title || ''} ${spot.authorName || ''} ${spot.authorCrew || ''} ${spot.note || ''}`.toLowerCase();
      if (!haystack.includes(searchQuery)) return;
    }

    const zoneColor = getTerritoryColor(spot);
    const key = getTerritoryKey(spot);

    if (isApproved && spot.status !== 'gone' && typeof turf !== 'undefined') {
      const radiusKm = getSpotRadiusKm(spot);
      const isCrew = Boolean(spot.authorCrew && spot.authorCrew.trim());
      const displayLabel = isCrew ? `[${spot.authorCrew.trim()}]` : (spot.authorName || 'Автор');

      const circleGeoJson = turf.circle([spot.lng, spot.lat], radiusKm, {
        steps: 48,
        units: 'kilometers'
      });

      Object.keys(zoneGroups).forEach(otherKey => {
        if (otherKey !== key && zoneGroups[otherKey].mergedPoly) {
          try {
            zoneGroups[otherKey].mergedPoly = turf.difference(zoneGroups[otherKey].mergedPoly, circleGeoJson);
          } catch (e) {
            console.warn('Ошибка turf.difference:', e);
          }
        }
      });

      if (!zoneGroups[key]) {
        zoneGroups[key] = {
          key: key,
          label: displayLabel,
          isCrew: isCrew,
          color: zoneColor,
          avatar: spot.authorAvatar || DEFAULT_AVATAR,
          mergedPoly: circleGeoJson,
          spotsCount: 1,
          hasHotspot: isHotspot
        };
      } else {
        zoneGroups[key].spotsCount += 1;
        zoneGroups[key].color = zoneColor;
        if (isHotspot) zoneGroups[key].hasHotspot = true;
        if (spot.authorAvatar) zoneGroups[key].avatar = spot.authorAvatar;
        try {
          zoneGroups[key].mergedPoly = zoneGroups[key].mergedPoly
            ? turf.union(zoneGroups[key].mergedPoly, circleGeoJson)
            : circleGeoJson;
        } catch (e) {
          console.warn('Ошибка turf.union:', e);
        }
      }
    }

    const marker = L.marker([spot.lat, spot.lng], { icon: createPin(spot, zoneColor) });

    let photoList = Array.isArray(spot.photos) ? spot.photos : (spot.photo ? [spot.photo] : []);
    let galleryHtml = photoList.length > 0
      ? `<div class="popup-gallery">` + photoList.map(src => `<img class="popup-thumb" src="${src}" onclick="openLightbox('${src}')">`).join('') + `</div>`
      : '';

    const hotspotBadgeHtml = isHotspot
      ? `<span class="popup-type-badge hotspot">👑 Горячая точка (x2)</span>`
      : '';

    const typeBadgeHtml = spotType === 'graffiti'
      ? `<span class="popup-type-badge graffiti">🎨 Граффити (${isHotspot ? '350' : '250'} м)</span>`
      : `<span class="popup-type-badge sticker">🏷️ Стикер (${isHotspot ? '350' : '135'} м)</span>`;

    const authorName = spot.authorName || 'Автор';
    const authorAvatar = spot.authorAvatar || DEFAULT_AVATAR;
    const crewLabel = spot.authorCrew
      ? ` <strong style="color:${zoneColor};">[${spot.authorCrew}]</strong>`
      : ` <span style="color:#888;">(Solo)</span>`;

    const likesArr = Array.isArray(spot.likes) ? spot.likes : [];
    const hasLiked = currentUser && likesArr.includes(currentUser.uid);

    const moderationBadge = !isApproved
      ? `<div style="background:#fff3cd; color:#856404; font-size:11px; padding:3px 6px; border-radius:4px; margin-bottom:5px; font-weight:700;">⏳ На проверке модератора</div>`
      : '';

    let actionButtons = '';
    if (isApproved) {
      actionButtons += `
        <button class="popup-btn btn-respect-popup ${hasLiked ? 'liked' : ''}" onclick="toggleRespect('${spot.id}')">
          🔥 Респект (${likesArr.length})
        </button>
      `;
    }
    if (isAdmin && !isApproved) {
      actionButtons += `<button class="popup-btn btn-approve-popup" onclick="approveSpot('${spot.id}')">✓ Одобрить на карту</button>`;
    }
    if (isAdmin || isAuthor) {
      actionButtons += `
        <button class="popup-btn btn-edit-popup" onclick="openEditModal('${spot.id}')">Редактировать</button>
        <button class="popup-btn btn-delete-popup" onclick="deleteSpot('${spot.id}')">Удалить</button>
      `;
    } else if (currentUser) {
      const alreadyReported = Array.isArray(spot.reportedBy) && spot.reportedBy.includes(currentUser.uid);
      actionButtons += alreadyReported
        ? `<div style="font-size:11px; color:#999; margin-top:6px;">Жалоба отправлена</div>`
        : `<button class="popup-btn btn-report-popup" onclick="reportSpot('${spot.id}')">🚩 Пожаловаться</button>`;
    }

    const popupHtml = `
      <div style="font-size:13px; line-height:1.4; min-width:195px;">
        ${moderationBadge}
        ${galleryHtml}
        <div>${hotspotBadgeHtml}${typeBadgeHtml}</div>
        <strong style="font-size:14px; display:block;">${spot.title}</strong>
        <div class="popup-author-row">
          <img class="popup-author-avatar" src="${authorAvatar}">
          <span>${authorName}${crewLabel}</span>
        </div>
        <p style="color:#444; margin:4px 0;">${spot.note || 'Без описания'}</p>
        <span style="font-size:11px; padding:2px 6px; border-radius:4px; font-weight:600; ${
          spot.status === 'ok' ? 'background:#eafaf1; color:#27ae60;' :
          spot.status === 'damaged' ? 'background:#fef8e7; color:#f39c12;' :
          'background:#fbeeed; color:#e74c3c;'
        }">${getStatusText(spot.status)}</span>
        ${actionButtons}
      </div>
    `;

    marker.bindPopup(popupHtml);
    marker.addTo(map);
    markersMap[spot.id] = marker;
  });

  const leaderboardStats = [];

  Object.values(zoneGroups).forEach(group => {
    if (!group.mergedPoly) return;

    const rawAreaSqMeters = typeof turf !== 'undefined' ? turf.area(group.mergedPoly) : 0;
    if (rawAreaSqMeters <= 0) return;

    // Если игрок/крю удерживает горячую точку, очки площади удваиваются (x2)
    const scoredAreaSqMeters = group.hasHotspot ? rawAreaSqMeters * 2 : rawAreaSqMeters;
    territoryScoreByKey[group.key] = scoredAreaSqMeters;

    let centerCoords = null;
    try {
      const centerFeature = turf.centerOfMass(group.mergedPoly);
      centerCoords = [centerFeature.geometry.coordinates[1], centerFeature.geometry.coordinates[0]];
    } catch (e) {}

    const rankObj = calculateStreetRank(scoredAreaSqMeters, 0);

    leaderboardStats.push({
      label: group.label,
      isCrew: group.isCrew,
      color: group.color,
      avatar: group.avatar,
      spotsCount: group.spotsCount,
      hasHotspot: group.hasHotspot,
      rankTitle: rankObj.title,
      area: scoredAreaSqMeters,
      center: centerCoords
    });

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

  stats.sort((a, b) => b.area - a.area);
  const medals = ['🥇', '🥈', '🥉'];

  leaderboardList.innerHTML = stats.map((item, idx) => {
    const rankIcon = medals[idx] || `${idx + 1}.`;
    const typeText = item.isCrew ? 'Крю' : item.rankTitle;
    const bonusBadge = item.hasHotspot ? `<span class="lb-bonus-tag">x2 👑</span>` : '';
    const flyAttrs = item.center ? `onclick="flyToCoords(${item.center[0]}, ${item.center[1]})"` : '';
    return `
      <div class="leaderboard-item" ${flyAttrs}>
        <div class="lb-left">
          <span class="lb-rank">${rankIcon}</span>
          <img class="lb-avatar" src="${item.avatar}" style="border-color:${item.color};">
          <div style="min-width:0;">
            <div class="lb-name">${item.label}${bonusBadge}</div>
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
    const crewStr = s.authorCrew ? ` [${s.authorCrew}]` : '';
    const icon = s.isHotspot ? '👑' : (s.spotType === 'graffiti' ? '🎨' : '🏷️');
    return `
      <div class="feed-item" onclick="flyToSpot('${s.id}', ${s.lat}, ${s.lng})">
        <div class="feed-title">${icon} ${s.title}</div>
        <div class="feed-meta">${s.authorName || 'Автор'}${crewStr} • ${formatTimeAgo(s.createdAt)}</div>
      </div>
    `;
  }).join('');
}

window.flyToCoords = function(lat, lng) {
  map.flyTo([lat, lng], 15, { duration: 1.1 });
};

window.flyToSpot = function(id, lat, lng) {
  map.flyTo([lat, lng], 16, { duration: 1.1 });
  setTimeout(() => {
    markersMap[id]?.openPopup();
  }, 1150);
};

window.toggleRespect = async function(id) {
  if (!currentUser) {
    authModal.classList.remove('hidden');
    return;
  }
  const spot = spots.find(s => s.id === id);
  if (!spot) return;

  const likes = Array.isArray(spot.likes) ? spot.likes : [];
  const alreadyLiked = likes.includes(currentUser.uid);

  try {
    await db.collection('stickers').doc(id).update({
      likes: alreadyLiked
        ? firebase.firestore.FieldValue.arrayRemove(currentUser.uid)
        : firebase.firestore.FieldValue.arrayUnion(currentUser.uid)
    });
  } catch (err) {
    console.error('Ошибка респекта:', err);
  }
};

// ==========================================
// 4. ДОБАВЛЕНИЕ (КЛИК, ЦЕНТР, GPS), РЕДАКТИРОВАНИЕ
// ==========================================
function canUserAddSpot() {
  if (!currentUser && !isAdmin) {
    authModal.classList.remove('hidden');
    return false;
  }
  if (currentUser && !userProfile && !isAdmin) {
    openProfileModal();
    return false;
  }
  if (!isAdmin) {
    const lastTime = parseInt(localStorage.getItem('last_spot_time') || '0', 10);
    const diff = Date.now() - lastTime;
    if (diff < 60000) {
      const secLeft = Math.ceil((60000 - diff) / 1000);
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

document.getElementById('btn-gps-spot')?.addEventListener('click', () => {
  if (!canUserAddSpot()) return;
  if (!navigator.geolocation) {
    alert('Геолокация не поддерживается твоим браузером.');
    return;
  }

  const gpsBtn = document.getElementById('btn-gps-spot');
  gpsBtn.textContent = '⏳';

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      gpsBtn.textContent = '📍';
      const { latitude, longitude } = pos.coords;
      map.flyTo([latitude, longitude], 16, { duration: 0.9 });

      if (gpsMarker) map.removeLayer(gpsMarker);
      gpsMarker = L.circleMarker([latitude, longitude], {
        radius: 8,
        color: '#ffffff',
        fillColor: '#2962ff',
        fillOpacity: 1,
        weight: 2
      }).addTo(map);

      openAddModal(latitude, longitude);
    },
    () => {
      gpsBtn.textContent = '📍';
      alert('Не удалось определить GPS-координаты. Проверь разрешение на геолокацию.');
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

function openAddModal(lat, lng) {
  spotForm.reset();
  spotIdInput.value = '';
  latInput.value = lat;
  lngInput.value = lng;
  const defaultType = document.querySelector('input[name="spotType"][value="sticker"]');
  if (defaultType) defaultType.checked = true;

  if (hotspotAdminGroup) {
    if (isAdmin) {
      hotspotAdminGroup.classList.remove('hidden');
      if (isHotspotInput) isHotspotInput.checked = false;
    } else {
      hotspotAdminGroup.classList.add('hidden');
    }
  }

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
  const typeVal = spot.spotType === 'graffiti' ? 'graffiti' : 'sticker';
  const typeRadio = document.querySelector(`input[name="spotType"][value="${typeVal}"]`);
  if (typeRadio) typeRadio.checked = true;

  if (hotspotAdminGroup) {
    if (isAdmin) {
      hotspotAdminGroup.classList.remove('hidden');
      if (isHotspotInput) isHotspotInput.checked = Boolean(spot.isHotspot);
    } else {
      hotspotAdminGroup.classList.add('hidden');
    }
  }

  titleInput.value = spot.title || '';
  noteInput.value = spot.note || '';
  statusSelect.value = spot.status || 'ok';

  currentPhotos = Array.isArray(spot.photos) ? [...spot.photos] : (spot.photo ? [spot.photo] : []);
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
      <img src="${src}">
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

  for (const file of files) {
    const base64 = await resizeImage(file, 800, 0.7);
    currentPhotos.push(base64);
  }
  renderPhotosPreview();
  photosInput.value = '';
});

function resizeImage(file, maxDim = 800, quality = 0.7) {
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
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// Сохранение спота
spotForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  saveBtn.disabled = true;
  saveBtn.textContent = 'Сохранение...';

  const id = spotIdInput.value;
  const chosenSpotType = document.querySelector('input[name="spotType"]:checked')?.value || 'sticker';

  const spotData = {
    spotType: chosenSpotType,
    title: titleInput.value.trim() || 'Без названия',
    status: statusSelect.value,
    note: noteInput.value.trim() || '',
    lat: parseFloat(latInput.value),
    lng: parseFloat(lngInput.value),
    photos: currentPhotos
  };

  if (isAdmin && isHotspotInput) {
    spotData.isHotspot = isHotspotInput.checked;
  }

  try {
    if (id) {
      await db.collection('stickers').doc(id).update(spotData);
    } else {
      spotData.createdAt = Date.now();
      spotData.approved = isAdmin ? true : false;
      spotData.reportedBy = [];
      spotData.likes = [];
      spotData.authorUid = currentUser ? currentUser.uid : 'admin';
      spotData.authorName = userProfile ? userProfile.nickname : (currentUser ? currentUser.defaultName : 'Админ');
      spotData.authorAvatar = (userProfile && userProfile.avatarUrl) ? userProfile.avatarUrl : '';
      spotData.authorColor = (userProfile && userProfile.zoneColor) ? userProfile.zoneColor : '#2ecc71';
      spotData.authorCrew = (userProfile && userProfile.crewType === 'crew') ? userProfile.crewName : '';

      await db.collection('stickers').add(spotData);
      if (!isAdmin) {
        localStorage.setItem('last_spot_time', Date.now().toString());
        alert('Точка отправлена! Она появится на карте после проверки модератором.');
      }
    }
    closeModal();
  } catch (err) {
    console.error('Ошибка сохранения:', err);
    alert('Не удалось сохранить точку!');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Сохранить';
  }
});

window.approveSpot = async function(id) {
  try {
    await db.collection('stickers').doc(id).update({ approved: true, reportedBy: [] });
  } catch (err) {
    console.error('Ошибка одобрения:', err);
  }
};

window.reportSpot = async function(id) {
  if (!currentUser) return;
  if (!confirm('Отправить жалобу, что работы нет или это спам?')) return;
  try {
    await db.collection('stickers').doc(id).update({
      reportedBy: firebase.firestore.FieldValue.arrayUnion(currentUser.uid)
    });
    alert('Жалоба учтена!');
  } catch (err) {
    console.error('Ошибка отправки жалобы:', err);
  }
};

window.deleteSpot = async function(id) {
  if (!confirm('Точно удалить эту точку? Территория будет пересчитана.')) return;
  try {
    await db.collection('stickers').doc(id).delete();
  } catch (err) {
    console.error('Ошибка удаления:', err);
  }
};

// Lightbox
window.openLightbox = function(src) {
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

// Реалтайм-синхронизация с Firestore
db.collection('stickers').onSnapshot((snapshot) => {
  spots = [];
  snapshot.forEach(doc => {
    spots.push({ id: doc.id, ...doc.data() });
  });
  renderMarkers();
  claimLegacySpots();
});
// =========================================================================
// ЧИСТЫЙ ЭКРАН: ЕДИНАЯ КНОПКА МЕНЮ + ОДНОРАЗОВОЕ ПРЕДЛОЖЕНИЕ УСТАНОВКИ PWA
// =========================================================================
(function initCleanUIAndPWA() {
  const hudStack = document.querySelector('.hud-left-stack');
  if (hudStack && !document.getElementById('btn-toggle-hud-menu')) {
    hudStack.classList.add('menu-closed');

    const menuBtn = document.createElement('button');
    menuBtn.id = 'btn-toggle-hud-menu';
    menuBtn.type = 'button';
    menuBtn.className = 'btn-hud-menu';
    menuBtn.innerHTML = '☰ Меню';
    document.body.appendChild(menuBtn);

    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isClosed = hudStack.classList.toggle('menu-closed');
      menuBtn.innerHTML = isClosed ? '☰ Меню' : '✕ Закрыть';
    });

    document.addEventListener('click', (e) => {
      if (!hudStack.contains(e.target) && e.target !== menuBtn) {
        hudStack.classList.add('menu-closed');
        menuBtn.innerHTML = '☰ Меню';
      }
    });
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
        <div style="font-weight:700;font-size:15px;margin-bottom:4px;">📲 Установить StickerMap</div>
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
          desc.innerHTML = 'Нажми <b>«Поделиться»</b> (квадрат со стрелкой внизу) → <b>«На экран „Домой“»</b>.';
        } else {
          desc.innerHTML = 'Нажми <b>⋮</b> справа вверху браузера → <b>«Добавить на главный экран»</b> или <b>«Установить приложение»</b>.';
        }
      };
    }, 1500);
  }
})();

// =========================================================================
// ПОСТОЯННЫЙ ПРИЦЕЛ ПО ЦЕНТРУ КАРТЫ + МГНОВЕННОЕ ДОБАВЛЕНИЕ ПО КНОПКЕ "+"
// =========================================================================
(function initPermanentCrosshair() {
  const oldOverlay = document.getElementById('crosshair-overlay');
  if (oldOverlay) {
    oldOverlay.remove();
  }

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
        const latInput = document.getElementById('spot-lat');
        const lngInput = document.getElementById('spot-lng');
        if (latInput) latInput.value = c.lat;
        if (lngInput) lngInput.value = c.lng;
      }
    }, true);
  }
})();

// =========================================================================
// МОДУЛЬ УЛУЧШЕНИЙ: GPS-РАДАР, СЖАТИЕ ФОТО, СТАТУСЫ И DEEP LINKS
// =========================================================================
(function initStickerMapUpgrades() {
  // 1. GPS-РАДАР («ГДЕ Я») БЕЗ СОЗДАНИЯ ТОЧКИ ПО КЛИКУ НА 📍
  const gpsBtn = document.getElementById('btn-gps-spot');
  let userLocationMarker = null;
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

            const gpsIcon = L.divIcon({
              className: '',
              html: '<div class="user-gps-dot"></div>',
              iconSize: [18, 18],
              iconAnchor: [9, 9]
            });

            if (!userLocationMarker) {
              userLocationMarker = L.marker([latitude, longitude], {
                icon: gpsIcon,
                zIndexOffset: 1000
              }).addTo(map);
            } else {
              userLocationMarker.setLatLng([latitude, longitude]);
            }
          }

          if (!gpsWatchId) {
            gpsWatchId = navigator.geolocation.watchPosition(
              (livePos) => {
                if (userLocationMarker) {
                  userLocationMarker.setLatLng([livePos.coords.latitude, livePos.coords.longitude]);
                }
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

  // 2. АВТОМАТИЧЕСКОЕ СЖАТИЕ ФОТОГРАФИЙ ПЕРЕД ЗАГРУЗКОЙ В БАЗУ
  const photoInput = document.getElementById('input-photos');

  function compressImageFile(file, maxWidth = 900, quality = 0.72) {
    return new Promise((resolve) => {
      if (!file.type.startsWith('image/')) return resolve(file);
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          let width = img.width;
          let height = img.height;
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          canvas.toBlob(
            (blob) => {
              if (!blob) return resolve(file);
              const compressedFile = new File([blob], file.name.replace(/\.\w+$/, '.jpg'), {
                type: 'image/jpeg',
                lastModified: Date.now()
              });
              resolve(compressedFile);
            },
            'image/jpeg',
            quality
          );
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  if (photoInput) {
    photoInput.addEventListener('change', async (e) => {
      if (photoInput.dataset.compressed === 'true') {
        delete photoInput.dataset.compressed;
        return;
      }
      const files = Array.from(photoInput.files || []);
      if (!files.length) return;

      e.stopImmediatePropagation();
      const dt = new DataTransfer();
      for (const f of files) {
        const small = await compressImageFile(f);
        dt.items.add(small);
      }
      photoInput.files = dt.files;
      photoInput.dataset.compressed = 'true';
      photoInput.dispatchEvent(new Event('change', { bubbles: true }));
    }, true);
  }

  // 3. КНОПКИ «НА МЕСТЕ», «НЕТ НА МЕСТЕ» И «🔗 ССЫЛКА» В ПОПАПЕ
  if (typeof map !== 'undefined') {
    map.on('popupopen', (e) => {
      const popupEl = e.popup.getElement();
      if (!popupEl || popupEl.querySelector('.spot-social-bar')) return;

      const latlng = e.popup.getLatLng();
      if (!latlng || typeof spots === 'undefined') return;

      const currentSpot = spots.find(
        (s) => Math.abs(s.lat - latlng.lat) < 0.00005 && Math.abs(s.lng - latlng.lng) < 0.00005
      );
      if (!currentSpot) return;

      const contentContainer = popupEl.querySelector('.leaflet-popup-content');
      if (!contentContainer) return;

      const bar = document.createElement('div');
      bar.className = 'spot-social-bar';
      const aliveCount = currentSpot.aliveVotes || 0;
      const buffCount = currentSpot.buffVotes || 0;
      const votedKey = `voted_${currentSpot.id}`;
      const previousVote = localStorage.getItem(votedKey);

      bar.innerHTML = `
        <button type="button" class="spot-social-btn ${previousVote === 'alive' ? 'voted-active' : previousVote ? 'voted-disabled' : ''}" data-action="alive">
          ${previousVote === 'alive' ? '✅ ' : ''}На месте (${aliveCount})
        </button>
        <button type="button" class="spot-social-btn ${previousVote === 'buff' ? 'voted-buff' : previousVote ? 'voted-disabled' : ''}" data-action="buff">
          ${previousVote === 'buff' ? '✅ ' : ''}Нет на месте (${buffCount})
        </button>
        <button type="button" class="spot-social-btn" data-action="share">🔗 Поделиться ссылкой</button>
      `;

      const aliveBtn = bar.querySelector('[data-action="alive"]');
      const buffBtn = bar.querySelector('[data-action="buff"]');

      bar.addEventListener('click', async (btnEvent) => {
        const btn = btnEvent.target.closest('button');
        if (!btn) return;
        const action = btn.dataset.action;

        if (action === 'share') {
          const shareUrl = `${window.location.origin}/?spot=${currentSpot.id}`;
          if (navigator.share) {
            navigator.share({ title: currentSpot.title || 'StickerMap спот', url: shareUrl }).catch(() => {});
          } else {
            await navigator.clipboard.writeText(shareUrl);
            btn.textContent = '✅ Ссылка скопирована';
            setTimeout(() => (btn.textContent = '🔗 Поделиться ссылкой'), 2000);
          }
          return;
        }

        if (typeof db === 'undefined' || localStorage.getItem(votedKey)) return;

        if (action === 'alive') {
          const nextAlive = aliveCount + 1;
          await db.collection('stickers').doc(currentSpot.id).update({
            aliveVotes: nextAlive,
            status: 'ok'
          });
          localStorage.setItem(votedKey, 'alive');
          aliveBtn.textContent = `✅ На месте (${nextAlive})`;
          aliveBtn.classList.add('voted-active');
          buffBtn.classList.add('voted-disabled');
        }

        if (action === 'buff') {
          const nextBuff = buffCount + 1;
          const updates = { buffVotes: nextBuff };
          if (nextBuff >= 3) {
            updates.status = 'gone';
          }
          await db.collection('stickers').doc(currentSpot.id).update(updates);
          localStorage.setItem(votedKey, 'buff');
          buffBtn.textContent = `✅ Нет на месте (${nextBuff})`;
          buffBtn.classList.add('voted-buff');
          aliveBtn.classList.add('voted-disabled');
        }
      });

      contentContainer.appendChild(bar);
    });
  }

  // 4. ПЕРЕЛЁТ К СПОТУ ПО ССЫЛКЕ (?spot=ID) ПРИ ОТКРЫТИИ САЙТА
  const urlParams = new URLSearchParams(window.location.search);
  const targetSpotId = urlParams.get('spot');
  if (targetSpotId) {
    let attempts = 0;
    const checkSpotInterval = setInterval(() => {
      attempts++;
      if (typeof spots !== 'undefined' && Array.isArray(spots) && spots.length > 0) {
        const found = spots.find((s) => String(s.id) === String(targetSpotId));
        if (found && typeof map !== 'undefined') {
          map.flyTo([found.lat, found.lng], 17, { duration: 1.0 });
          clearInterval(checkSpotInterval);
        }
      }
      if (attempts > 25) clearInterval(checkSpotInterval);
    }, 400);
  }
})();

// =========================================================================
// =========================================================================
// МОДУЛЬ ВИЗИТКИ АВТОРА / КРЮ (?author=НИК + КЛИК ПО АВТОРУ В ПОПАПЕ)
// =========================================================================
(function initAuthorProfileCard() {
  function getRankTitle(aliveCount) {
    if (aliveCount >= 25) return '👑 Легенда района';
    if (aliveCount >= 12) return '🔥 Хозяин квартала';
    if (aliveCount >= 5) return '⚡ Уличный игрок';
    return '🎯 Новичок';
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
    const crewName = rawCrew ? `Крю: ${rawCrew}` : 'Solo';
    const rankTitle = getRankTitle(aliveSpots.length);
    const firstLetter = cleanName.charAt(0).toUpperCase();

    document.getElementById('author-card-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'author-card-overlay';
    overlay.className = 'author-card-overlay';

    const spotsHtml = authorSpots.length
      ? authorSpots
          .map((sp) => {
            const thumb =
              (Array.isArray(sp.photos) && sp.photos[0]) ||
              sp.photo ||
              'icon-512.png';
            const isGone = sp.status === 'gone';
            return `
              <div class="author-spot-item" data-lat="${sp.lat}" data-lng="${sp.lng}">
                <img src="${thumb}" class="author-spot-thumb" alt="">
                <div class="author-spot-info">
                  <div class="author-spot-name">${sp.title || 'Без названия'}</div>
                  <div class="author-spot-meta">
                    ${isGone ? '❌ Пропал' : '🟢 На месте'} · 🔥 ${(sp.respects || 0) + (sp.aliveVotes || 0)}
                  </div>
                </div>
                <span style="font-size:14px;color:#94a3b8;">➔</span>
              </div>
            `;
          })
          .join('')
      : '<div style="text-align:center;color:#94a3b8;font-size:13px;padding:20px 0;">Пока нет активных спотов на карте</div>';

    overlay.innerHTML = `
      <div class="author-card-modal">
        <div class="author-card-banner" style="background: linear-gradient(135deg, ${accentColor}33, rgba(20,23,31,0.95));">
          <button type="button" class="author-card-close" id="close-author-card">✕</button>
          <div class="author-card-header">
            <div class="author-avatar-circle" style="background: ${accentColor};">${firstLetter}</div>
            <div class="author-title-wrap">
              <h2>${cleanName}</h2>
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
          <button type="button" class="author-share-btn" id="share-author-profile">🔗 Поделиться профилем автора</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('close-author-card').onclick = () => overlay.remove();
    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.remove();
    };

    overlay.querySelectorAll('.author-spot-item').forEach((item) => {
      item.addEventListener('click', () => {
        const lat = parseFloat(item.dataset.lat);
        const lng = parseFloat(item.dataset.lng);
        overlay.remove();
        if (typeof map !== 'undefined' && !isNaN(lat) && !isNaN(lng)) {
          map.flyTo([lat, lng], 17, { duration: 0.9 });
        }
      });
    });

    document.getElementById('share-author-profile').onclick = async (e) => {
      const btn = e.target;
      const profileUrl = `${window.location.origin}/?author=${encodeURIComponent(cleanName)}`;
      if (navigator.share) {
        navigator.share({ title: `${cleanName} в StickerMap`, url: profileUrl }).catch(() => {});
      } else {
        await navigator.clipboard.writeText(profileUrl);
        btn.textContent = '✅ Ссылка на профиль скопирована';
        setTimeout(() => (btn.textContent = '🔗 Поделиться профилем автора'), 2000);
      }
    };
  };

  if (typeof map !== 'undefined') {
    map.on('popupopen', (e) => {
      const popupEl = e.popup.getElement();
      const latlng = e.popup.getLatLng();
      if (!popupEl || !latlng || typeof spots === 'undefined') return;

      const currentSpot = spots.find(
        (s) => Math.abs(s.lat - latlng.lat) < 0.00005 && Math.abs(s.lng - latlng.lng) < 0.00005
      );
      const authorName = currentSpot?.authorName || currentSpot?.author || currentSpot?.username;
      if (!authorName) return;

      const socialBar = popupEl.querySelector('.spot-social-bar');
      if (socialBar && !socialBar.querySelector('[data-action="profile"]')) {
        const profBtn = document.createElement('button');
        profBtn.type = 'button';
        profBtn.className = 'spot-social-btn';
        profBtn.dataset.action = 'profile';
        profBtn.style.cssText = 'grid-column: 1 / -1; background: #1e293b !important; color: #f8fafc !important;';
        profBtn.textContent = `👤 Профиль: ${authorName}`;
        profBtn.onclick = () => window.openAuthorCard(authorName);
        socialBar.appendChild(profBtn);
      }
    });
  }

  const urlParams = new URLSearchParams(window.location.search);
  const targetAuthor = urlParams.get('author');
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