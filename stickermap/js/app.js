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

// Проверка админ-режима по ключу
const urlParams = new URLSearchParams(window.location.search);
const isAdmin = urlParams.get('key') === 'maker77';

let currentUser = null; // { uid, email, defaultName }
let userProfile = null; // { nickname, crewType, crewName }
let authChecked = false;

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
let currentPhotos = [];

// DOM-элементы
const userPanel = document.getElementById('user-panel');
const authModal = document.getElementById('auth-modal');
const emailAuthForm = document.getElementById('email-auth-form');
const emailSubmitBtn = document.getElementById('btn-email-submit');

const profileModal = document.getElementById('profile-modal');
const profileForm = document.getElementById('profile-form');
const nicknameInput = document.getElementById('profile-nickname');
const crewNameGroup = document.getElementById('crew-name-group');
const crewNameInput = document.getElementById('profile-crew-name');

const modal = document.getElementById('spot-modal');
const modalTitle = document.getElementById('modal-title');
const spotForm = document.getElementById('spot-form');
const spotIdInput = document.getElementById('spot-id');
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
// ЦВЕТ ТЕРРИТОРИИ И ГРУППИРОВКА ПО КРЮ/АВТОРУ
// ==========================================
function getTerritoryKey(spot) {
  if (spot.authorCrew && spot.authorCrew.trim()) {
    return 'crew_' + spot.authorCrew.trim().toLowerCase();
  }
  return 'solo_' + (spot.authorUid || 'admin');
}

function getTerritoryColor(spot) {
  if (spot.status === 'gone') return '#e74c3c';
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

// ==========================================
// 1. АВТОРИЗАЦИЯ (EMAIL + ПАРОЛЬ) И ПРОФИЛЬ
// ==========================================

emailAuthForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  sessionStorage.removeItem('guest_mode_chosen');

  emailSubmitBtn.disabled = true;
  emailSubmitBtn.textContent = 'Вход...';

  try {
    // Пробуем войти в существующий аккаунт
    await auth.signInWithEmailAndPassword(email, password);
    authModal.classList.add('hidden');
  } catch (err) {
    // Если аккаунта ещё нет — автоматически регистрируем новый
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

// Продолжить как гость
document.getElementById('btn-guest-mode').addEventListener('click', () => {
  sessionStorage.setItem('guest_mode_chosen', 'true');
  authModal.classList.add('hidden');
});

// Отслеживание состояния входа
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
      renderMarkers();
      claimLegacySpots();
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
  const crewBadge = (userProfile && userProfile.crewType === 'crew' && userProfile.crewName)
    ? `<span class="user-crew-tag">[${userProfile.crewName}]</span>`
    : `<span style="font-size:11px; color:#777;">(Solo)</span>`;

  userPanel.innerHTML = `
    <div class="user-badge" id="btn-edit-profile" title="Изменить ник или крю">
      <span>${nick}</span>
      ${crewBadge}
    </div>
  `;

  document.getElementById('btn-edit-profile').addEventListener('click', () => {
    openProfileModal();
  });
}

function openProfileModal() {
  nicknameInput.value = userProfile ? userProfile.nickname : (currentUser ? currentUser.defaultName : '');
  const type = userProfile ? userProfile.crewType : 'solo';
  document.querySelector(`input[name="crewType"][value="${type}"]`).checked = true;

  if (type === 'crew') {
    crewNameGroup.classList.remove('hidden');
    crewNameInput.value = userProfile ? (userProfile.crewName || '') : '';
  } else {
    crewNameGroup.classList.add('hidden');
    crewNameInput.value = '';
  }

  profileModal.classList.remove('hidden');
}

document.querySelectorAll('input[name="crewType"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    if (e.target.value === 'crew') {
      crewNameGroup.classList.remove('hidden');
      crewNameInput.required = true;
    } else {
      crewNameGroup.classList.add('hidden');
      crewNameInput.required = false;
    }
  });
});

// Сохранение профиля и обновление ника/крю на всех стикерах пользователя
profileForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser) return;

  const crewType = document.querySelector('input[name="crewType"]:checked').value;
  const profileData = {
    uid: currentUser.uid,
    email: currentUser.email || '',
    nickname: nicknameInput.value.trim() || currentUser.defaultName,
    crewType: crewType,
    crewName: crewType === 'crew' ? crewNameInput.value.trim() : '',
    updatedAt: Date.now()
  };

  try {
    await db.collection('users').doc(currentUser.uid).set(profileData);
    userProfile = profileData;
    profileModal.classList.add('hidden');
    renderUserPanel();
    await syncUserSpotsMetadata();
    await claimLegacySpots();
    renderMarkers();
  } catch (err) {
    console.error('Ошибка сохранения профиля:', err);
    alert('Не удалось сохранить профиль');
  }
});

// Привязка старых бесхозных стикеров к текущему пользователю
async function claimLegacySpots() {
  if (!currentUser || !userProfile) return;

  const legacySpots = spots.filter(s => !s.authorUid || s.authorUid === 'admin');
  if (legacySpots.length === 0) return;

  const batch = db.batch();
  legacySpots.forEach(spot => {
    const ref = db.collection('stickers').doc(spot.id);
    batch.update(ref, {
      authorUid: currentUser.uid,
      authorName: userProfile.nickname,
      authorCrew: userProfile.crewType === 'crew' ? userProfile.crewName : ''
    });
  });

  try {
    await batch.commit();
    console.log(`Привязано прошлых стикеров: ${legacySpots.length}`);
  } catch (err) {
    console.error('Ошибка привязки старых стикеров:', err);
  }
}

// Обновление ника и названия крю на всех уже созданных стикерах пользователя
async function syncUserSpotsMetadata() {
  if (!currentUser || !userProfile) return;

  const newCrew = userProfile.crewType === 'crew' ? userProfile.crewName : '';
  const myOutdatedSpots = spots.filter(
    s => s.authorUid === currentUser.uid &&
    (s.authorName !== userProfile.nickname || (s.authorCrew || '') !== newCrew)
  );

  if (myOutdatedSpots.length === 0) return;

  const batch = db.batch();
  myOutdatedSpots.forEach(spot => {
    const ref = db.collection('stickers').doc(spot.id);
    batch.update(ref, {
      authorName: userProfile.nickname,
      authorCrew: newCrew
    });
  });

  try {
    await batch.commit();
  } catch (err) {
    console.error('Ошибка обновления ника на стикерах:', err);
  }
}

// Выход из аккаунта
document.getElementById('btn-logout').addEventListener('click', async () => {
  await auth.signOut();
  currentUser = null;
  userProfile = null;
  profileModal.classList.add('hidden');
  renderUserPanel();
  renderMarkers();
});

// ==========================================
// 2. ОТРИСОВКА МАРКЕРОВ И СЛИЯНИЕ КРУГОВ (UNION)
// ==========================================

function createPin(spot, color) {
  const pendingClass = spot.approved === false ? 'pin-pending' : '';
  const bgColor = spot.status === 'gone' ? '#e74c3c' : color;

  const authorNick = spot.authorName || (userProfile ? userProfile.nickname : 'Админ');
  const crewTag = spot.authorCrew ? ` [${spot.authorCrew}]` : '';

  return L.divIcon({
    className: 'custom-pin-container',
    html: `
      <div class="pin-wrapper">
        <div class="custom-pin ${pendingClass}" style="background:${bgColor};">
          ${spot.title ? spot.title[0].toUpperCase() : 'S'}
        </div>
        <div class="pin-author-label">${authorNick}${crewTag}</div>
      </div>
    `,
    iconSize: [0, 0],
    iconAnchor: [0, 0]
  });
}

function getStatusText(status) {
  if (status === 'ok') return 'Цел (Территория активна)';
  if (status === 'damaged') return 'Потрёпан (Ослаблен)';
  return 'Сорван';
}

function renderMarkers() {
  Object.values(markersMap).forEach(m => map.removeLayer(m));
  territoryLayers.forEach(layer => map.removeLayer(layer));
  markersMap = {};
  territoryLayers = [];

  const zoneGroups = {};

  spots.forEach(spot => {
    const isApproved = spot.approved !== false;
    const isAuthor = currentUser && spot.authorUid === currentUser.uid;
    const reportsCount = Array.isArray(spot.reportedBy) ? spot.reportedBy.length : 0;

    if (!isAdmin && !isAuthor) {
      if (!isApproved || reportsCount >= 3) return;
    }

    const zoneColor = getTerritoryColor(spot);

    // 1. Генерируем круг Turf.js для активного одобренного спота
    if (isApproved && spot.status !== 'gone' && typeof turf !== 'undefined') {
      const radiusKm = (spot.status === 'damaged' ? 70 : 135) / 1000;
      const key = getTerritoryKey(spot);

      if (!zoneGroups[key]) {
        zoneGroups[key] = { color: zoneColor, circles: [] };
      }

      const circleGeoJson = turf.circle([spot.lng, spot.lat], radiusKm, {
        steps: 48,
        units: 'kilometers'
      });
      zoneGroups[key].circles.push(circleGeoJson);
    }

    // 2. Маркер самого стикера
    const marker = L.marker([spot.lat, spot.lng], { icon: createPin(spot, zoneColor) });

    let photoList = [];
    if (Array.isArray(spot.photos)) {
      photoList = spot.photos;
    } else if (spot.photo) {
      photoList = [spot.photo];
    }

    let galleryHtml = '';
    if (photoList.length > 0) {
      galleryHtml = `<div class="popup-gallery">` +
        photoList.map(src => `<img class="popup-thumb" src="${src}" onclick="openLightbox('${src}')">`).join('') +
      `</div>`;
    }

    const authorName = spot.authorName || (userProfile ? userProfile.nickname : 'Админ');
    const crewLabel = spot.authorCrew
      ? ` <strong style="color:${zoneColor};">[${spot.authorCrew}]</strong>`
      : ` <span style="color:#888;">(Solo)</span>`;

    const moderationBadge = !isApproved
      ? `<div style="background:#fff3cd; color:#856404; font-size:11px; padding:3px 6px; border-radius:4px; margin-bottom:5px; font-weight:700;">⏳ На проверке модератора</div>`
      : '';

    let actionButtons = '';
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
        : `<button class="popup-btn btn-report-popup" onclick="reportSpot('${spot.id}')">🚩 Пожаловаться (Спам / Нет стикера)</button>`;
    }

    const popupHtml = `
      <div style="font-size:13px; line-height:1.4; min-width:185px;">
        ${moderationBadge}
        ${galleryHtml}
        <strong style="font-size:14px; display:block;">${spot.title}</strong>
        <div style="font-size:11px; color:#555; margin:2px 0;">
          Автор: ${authorName}${crewLabel}
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

  // 3. Сливаем все пересекающиеся круги одной группы в единую фигуру
  Object.values(zoneGroups).forEach(group => {
    if (!group.circles.length) return;

    let merged = group.circles[0];
    for (let i = 1; i < group.circles.length; i++) {
      try {
        merged = turf.union(merged, group.circles[i]);
      } catch (e) {
        console.warn('Ошибка объединения полигонов:', e);
      }
    }

    const geoLayer = L.geoJSON(merged, {
      style: {
        color: group.color,
        fillColor: group.color,
        fillOpacity: 0.28,
        weight: 2,
        lineJoin: 'round'
      },
      interactive: false
    }).addTo(map);

    territoryLayers.push(geoLayer);
  });
}

// ==========================================
// 3. ДОБАВЛЕНИЕ, ЛИМИТ 1 МИНУТА, РЕДАКТИРОВАНИЕ
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
      alert(`Подожди ещё ${secLeft} сек. перед добавлением следующего стикера.`);
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
  currentPhotos = [];
  renderPhotosPreview();
  modalTitle.textContent = 'Новый стикер';
  modal.classList.remove('hidden');
}

window.openEditModal = function(id) {
  const spot = spots.find(s => s.id === id);
  if (!spot) return;

  spotIdInput.value = spot.id;
  latInput.value = spot.lat;
  lngInput.value = spot.lng;
  titleInput.value = spot.title || '';
  noteInput.value = spot.note || '';
  statusSelect.value = spot.status || 'ok';

  if (Array.isArray(spot.photos)) {
    currentPhotos = [...spot.photos];
  } else if (spot.photo) {
    currentPhotos = [spot.photo];
  } else {
    currentPhotos = [];
  }

  renderPhotosPreview();
  modalTitle.textContent = 'Редактировать стикер';
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
    const base64 = await resizeImage(file);
    currentPhotos.push(base64);
  }
  renderPhotosPreview();
  photosInput.value = '';
});

function resizeImage(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 800;
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
        resolve(canvas.toDataURL('image/jpeg', 0.7));
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
  const spotData = {
    title: titleInput.value.trim() || 'Без названия',
    status: statusSelect.value,
    note: noteInput.value.trim() || '',
    lat: parseFloat(latInput.value),
    lng: parseFloat(lngInput.value),
    photos: currentPhotos
  };

  try {
    if (id) {
      await db.collection('stickers').doc(id).update(spotData);
    } else {
      spotData.createdAt = Date.now();
      spotData.approved = isAdmin ? true : false;
      spotData.reportedBy = [];
      spotData.authorUid = currentUser ? currentUser.uid : 'admin';
      spotData.authorName = userProfile ? userProfile.nickname : (currentUser ? currentUser.defaultName : 'Админ');
      spotData.authorCrew = (userProfile && userProfile.crewType === 'crew') ? userProfile.crewName : '';

      await db.collection('stickers').add(spotData);
      if (!isAdmin) {
        localStorage.setItem('last_spot_time', Date.now().toString());
        alert('Стикер отправлен! Он появится на общей карте и соединит территорию после проверки модератором.');
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

// Одобрение точки админом
window.approveSpot = async function(id) {
  try {
    await db.collection('stickers').doc(id).update({
      approved: true,
      reportedBy: []
    });
  } catch (err) {
    console.error('Ошибка одобрения:', err);
  }
};

// Жалоба на спот от пользователя
window.reportSpot = async function(id) {
  if (!currentUser) return;
  if (!confirm('Отправить жалобу, что стикера нет или это спам?')) return;

  try {
    await db.collection('stickers').doc(id).update({
      reportedBy: firebase.firestore.FieldValue.arrayUnion(currentUser.uid)
    });
    alert('Жалоба учтена!');
  } catch (err) {
    console.error('Ошибка отправки жалобы:', err);
  }
};

// Удаление
window.deleteSpot = async function(id) {
  if (!confirm('Точно удалить этот стикер? Территория будет пересчитана.')) return;
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