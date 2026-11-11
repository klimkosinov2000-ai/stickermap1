// Конфигурация Firebase с твоими ключами
const firebaseConfig = {
  apiKey: "AIzaSyBSzDos2Hc3M6XnkobN_AQ43m9h9h6WX24",
  authDomain: "stickermap-df14d.firebaseapp.com",
  projectId: "stickermap-df14d",
  storageBucket: "stickermap-df14d.firebasestorage.app",
  messagingSenderId: "223349698177",
  appId: "1:223349698177:web:4a4c4271002834c76da780",
  measurementId: "G-ZC0XLNKH8D"
};

// Запуск Firebase и базы Firestore
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Проверка: автор (разраб) или зритель
const ADMIN_SECRET = 'maker77';
const urlParams = new URLSearchParams(window.location.search);
const isAdmin = urlParams.get('key') === ADMIN_SECRET;

if (isAdmin) {
  document.body.classList.add('admin-mode');
} else {
  document.body.classList.add('viewer-mode');
}

// Границы Москвы
const MOSCOW_BOUNDS = [
  [55.4800, 37.3000],
  [55.9800, 37.9500]
];

// Слои карт (бесплатные, без ошибок API)
const TILE_LAYERS = {
  light: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap',
    maxZoom: 19
  }),
  dark: L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; Stadia Maps',
    maxZoom: 19
  }),
  satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: '&copy; Esri',
    maxZoom: 19
  })
};

let currentLayerName = 'light';
let spots = [];
let markersMap = {};
let activeFilter = 'all';
let searchQuery = '';
let currentPhotoBase64 = null;

// Инициализация карты
const map = L.map('map', {
  center: [55.751244, 37.618423],
  zoom: 13,
  minZoom: 10,
  maxBounds: MOSCOW_BOUNDS,
  maxBoundsViscosity: 0.9,
  layers: [TILE_LAYERS.light],
  zoomControl: false
});

L.control.zoom({ position: 'bottomright' }).addTo(map);

// Элементы страницы
const sidebar = document.getElementById('sidebar');
const spotsListEl = document.getElementById('spots-list');
const countBadge = document.getElementById('spots-count-badge');
const modal = document.getElementById('spot-modal');
const spotForm = document.getElementById('spot-form');
const photoInput = document.getElementById('input-photo');
const photoPreviewBox = document.getElementById('photo-preview');

// Переключение слоёв
document.querySelectorAll('.layer-pill').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.layer-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const nextLayer = btn.dataset.layer;
    if (nextLayer !== currentLayerName) {
      map.removeLayer(TILE_LAYERS[currentLayerName]);
      map.addLayer(TILE_LAYERS[nextLayer]);
      currentLayerName = nextLayer;
    }
  });
});

// Кастомный маркер
function createCustomPin(spot) {
  let statusClass = '';
  if (spot.status === 'damaged') statusClass = 'pin-damaged';
  if (spot.status === 'gone') statusClass = 'pin-gone';

  return L.divIcon({
    className: 'custom-pin-container',
    html: `<div class="custom-pin ${statusClass}">${spot.title ? spot.title[0].toUpperCase() : 'S'}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });
}

function getStatusTitle(status) {
  if (status === 'ok') return 'Цел';
  if (status === 'damaged') return 'Потрёпан';
  return 'Сорван';
}

// Отрисовка маркеров на карте и карточек в меню
function renderMarkers() {
  Object.values(markersMap).forEach(m => map.removeLayer(m));
  markersMap = {};

  const filtered = filterSpotsData();

  filtered.forEach(spot => {
    const marker = L.marker([spot.lat, spot.lng], {
      icon: createCustomPin(spot)
    });

const deleteBtnHtml = isAdmin
  ? `<button onclick="deleteSpot('${spot.id}')" style="margin-top:8px; width:100%; padding:6px; background:#fff0f0; color:#e74c3c; border:1px solid #ffd0d0; border-radius:6px; cursor:pointer; font-size:12px; font-weight:600;">Удалить спот</button>`
  : '';

const popupHtml = `
  <div style="font-family:Inter,sans-serif; min-width: 170px;">
    ${spot.photo ? `<img src="${spot.photo}" style="width:100%;height:100px;object-fit:cover;border-radius:8px;margin-bottom:8px;">` : ''}
    <strong style="font-size:14px; display:block;">${spot.title}</strong>
    <p style="font-size:12px;color:#666;margin:4px 0;">${spot.note || 'Без описания'}</p>
    <span style="font-size:11px;font-weight:600;padding:2px 6px;border-radius:4px;display:inline-block;${
      spot.status === 'ok' ? 'background:#eafaf1;color:#27ae60;' :
      spot.status === 'damaged' ? 'background:#fef8e7;color:#f39c12;' :
      'background:#fbeeed;color:#e74c3c;'
    }">${getStatusTitle(spot.status)}</span>
    ${deleteBtnHtml}
  </div>
`;

marker.bindPopup(popupHtml);
    marker.addTo(map);
    markersMap[spot.id] = marker;
  });

  renderSidebarList(filtered);
}

function renderSidebarList(filteredList) {
  spotsListEl.innerHTML = '';
  countBadge.textContent = spots.length;

  if (filteredList.length === 0) {
    spotsListEl.innerHTML = `<div style="text-align:center;padding:40px 10px;color:#aaa;font-size:14px;">Споты не найдены</div>`;
    return;
  }

  filteredList.forEach(spot => {
    const card = document.createElement('div');
    card.className = 'spot-card';
    card.innerHTML = `
      ${spot.photo ? `<img class="spot-thumb" src="${spot.photo}">` : `<div class="spot-thumb"><i class="ph ph-sticker"></i></div>`}
      <div class="spot-meta">
        <div class="spot-title">${spot.title}</div>
        <div class="spot-sub">${spot.note || 'Координаты: ' + spot.lat.toFixed(4) + ', ' + spot.lng.toFixed(4)}</div>
        <span class="status-badge status-${spot.status}">${getStatusTitle(spot.status)}</span>
      </div>
    `;

    card.addEventListener('click', () => {
      map.flyTo([spot.lat, spot.lng], 16, { duration: 0.8 });
      if (markersMap[spot.id]) markersMap[spot.id].openPopup();
      if (window.innerWidth < 600) sidebar.classList.remove('open');
    });

    spotsListEl.appendChild(card);
  });
}

function filterSpotsData() {
  return spots.filter(spot => {
    const matchesFilter = (activeFilter === 'all') || (spot.status === activeFilter);
    const matchesSearch = spot.title.toLowerCase().includes(searchQuery) ||
                          (spot.note && spot.note.toLowerCase().includes(searchQuery));
    return matchesFilter && matchesSearch;
  });
}

// Поиск и фильтры
document.getElementById('search-input').addEventListener('input', (e) => {
  searchQuery = e.target.value.toLowerCase().trim();
  renderMarkers();
});

document.querySelectorAll('.chip').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    renderMarkers();
  });
});

// Открытие и закрытие бокового меню
document.getElementById('btn-toggle-sidebar').addEventListener('click', () => sidebar.classList.toggle('open'));
document.getElementById('btn-close-sidebar').addEventListener('click', () => sidebar.classList.remove('open'));

// Добавление точки (ТОЛЬКО ДЛЯ АВТОРА)
map.on('click', (e) => {
  if (!isAdmin) return;
  openAddModal(e.latlng.lat, e.latlng.lng);
});

const addBtn = document.getElementById('btn-add-spot');
if (addBtn) {
  addBtn.addEventListener('click', () => {
    if (!isAdmin) return;
    const center = map.getCenter();
    openAddModal(center.lat, center.lng);
  });
}

function openAddModal(lat, lng) {
  spotForm.reset();
  currentPhotoBase64 = null;
  photoPreviewBox.innerHTML = '<i class="ph ph-image"></i><span>Нет фото</span>';

  document.getElementById('spot-id').value = '';
  document.getElementById('spot-lat').value = lat;
  document.getElementById('spot-lng').value = lng;
  document.getElementById('coords-text').textContent = `Координаты: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;

  modal.classList.remove('hidden');
}

document.getElementById('btn-close-modal').addEventListener('click', () => modal.classList.add('hidden'));
document.getElementById('btn-cancel-modal').addEventListener('click', () => modal.classList.add('hidden'));

// Сжатие фото
photoInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(evt) {
    const img = new Image();
    img.onload = function() {
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

      currentPhotoBase64 = canvas.toDataURL('image/jpeg', 0.7);
      photoPreviewBox.innerHTML = `<img src="${currentPhotoBase64}">`;
    };
    img.src = evt.target.result;
  };
  reader.readAsDataURL(file);
});

// ОТПРАВКА СПОТА НАПРЯМУЮ В ОБЛАКО FIREBASE
spotForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const submitBtn = spotForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Сохранение...';

  const newSpot = {
    title: document.getElementById('input-title').value.trim(),
    status: document.getElementById('select-status').value,
    category: document.getElementById('select-category').value,
    note: document.getElementById('input-note').value.trim(),
    lat: parseFloat(document.getElementById('spot-lat').value),
    lng: parseFloat(document.getElementById('spot-lng').value),
    photo: currentPhotoBase64 || null,
    createdAt: Date.now()
  };

  try {
    await db.collection('stickers').add(newSpot);
    modal.classList.add('hidden');
    spotForm.reset();
  } catch (err) {
    console.error('Ошибка сохранения:', err);
    alert('Не удалось сохранить в облако! Проверьте правила доступа в Firestore.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Сохранить спот';
  }
});

// Экспорт резервной копии JSON
document.getElementById('btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(spots, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `stickers_backup_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
});

// Геолокация
document.getElementById('btn-locate').addEventListener('click', () => {
  if (!navigator.geolocation) return alert('Геолокация не поддерживается');
  navigator.geolocation.getCurrentPosition(
    pos => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      map.flyTo([lat, lng], 16);
      L.circleMarker([lat, lng], { radius: 8, fillColor: '#ffcc00', color: '#111', weight: 2, fillOpacity: 0.9 })
        .addTo(map).bindPopup('Вы здесь').openPopup();
    },
    () => alert('Не удалось определить геопозицию')
  );
});

// ПОСТОЯННОЕ СЛУШАНИЕ ОБНОВЛЕНИЙ ИЗ БАЗЫ В РЕАЛЬНОМ ВРЕМЕНИ
db.collection('stickers')
  .orderBy('createdAt', 'desc')
  .onSnapshot((snapshot) => {
    spots = [];
    snapshot.forEach((doc) => {
      spots.push({ id: doc.id, ...doc.data() });
    });
    renderMarkers();
  }, (err) => {
    console.error('Ошибка получения данных из Firebase:', err);
  });
window.deleteSpot = async function(spotId) {
  if (!isAdmin) return;

  const confirmed = confirm('Точно удалить этот спот?');
  if (!confirmed) return;

  try {
    await db.collection('stickers').doc(spotId).delete();
  } catch (err) {
    console.error('Ошибка при удалении:', err);
    alert('Не удалось удалить спот!');
  }
};