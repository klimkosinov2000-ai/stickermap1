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

// Проверка админ-ключа
const urlParams = new URLSearchParams(window.location.search);
const isAdmin = urlParams.get('key') === 'maker77';

if (isAdmin) {
  document.body.classList.add('admin-mode');
} else {
  document.body.classList.add('viewer-mode');
}

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
let currentPhotos = []; // Массив base64 строк фото

// Элементы
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

// Элементы лайтбокса
const lightbox = document.getElementById('lightbox-modal');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxClose = document.getElementById('lightbox-close');

// Маркер точки
function createPin(spot) {
  let cls = 'pin-ok';
  if (spot.status === 'damaged') cls = 'pin-damaged';
  if (spot.status === 'gone') cls = 'pin-gone';

  return L.divIcon({
    className: 'custom-pin-container',
    html: `<div class="custom-pin ${cls}">${spot.title ? spot.title[0].toUpperCase() : 'S'}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });
}

function getStatusText(status) {
  if (status === 'ok') return 'Цел';
  if (status === 'damaged') return 'Потрёпан';
  return 'Сорван';
}

// Отрисовка маркеров на карте
function renderMarkers() {
  Object.values(markersMap).forEach(m => map.removeLayer(m));
  markersMap = {};

  spots.forEach(spot => {
    const marker = L.marker([spot.lat, spot.lng], { icon: createPin(spot) });

    // Обратная совместимость: если старый spot.photo был один, превращаем в массив
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

    const adminButtons = isAdmin ? `
      <button class="popup-btn btn-edit-popup" onclick="openEditModal('${spot.id}')">Редактировать</button>
      <button class="popup-btn btn-delete-popup" onclick="deleteSpot('${spot.id}')">Удалить</button>
    ` : '';

    const popupHtml = `
      <div style="font-size:13px; line-height:1.4; min-width:180px;">
        ${galleryHtml}
        <strong style="font-size:14px;">${spot.title}</strong>
        <p style="color:#555;margin:3px 0;">${spot.note || 'Без описания'}</p>
        <span style="font-size:11px;padding:2px 6px;border-radius:4px;font-weight:600;${
          spot.status === 'ok' ? 'background:#eafaf1;color:#27ae60;' :
          spot.status === 'damaged' ? 'background:#fef8e7;color:#f39c12;' :
          'background:#fbeeed;color:#e74c3c;'
        }">${getStatusText(spot.status)}</span>
        ${adminButtons}
      </div>
    `;

    marker.bindPopup(popupHtml);
    marker.addTo(map);
    markersMap[spot.id] = marker;
  });
}

// Клик по карте для создания точки
map.on('click', (e) => {
  if (!isAdmin) return;
  openAddModal(e.latlng.lat, e.latlng.lng);
});

// Кнопка +
const btnAdd = document.getElementById('btn-add-spot');
if (btnAdd) {
  btnAdd.addEventListener('click', () => {
    if (!isAdmin) return;
    const center = map.getCenter();
    openAddModal(center.lat, center.lng);
  });
}

// Открытие модалки создания
function openAddModal(lat, lng) {
  spotForm.reset();
  spotIdInput.value = '';
  latInput.value = lat;
  lngInput.value = lng;
  currentPhotos = [];
  renderPhotosPreview();
  if (modalTitle) modalTitle.textContent = 'Новый спот';
  modal.classList.remove('hidden');
}

// Открытие модалки редактирования
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
  if (modalTitle) modalTitle.textContent = 'Редактировать спот';
  modal.classList.remove('hidden');
};

function closeModal() {
  modal.classList.add('hidden');
}
if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

// Отрисовка превью фото в форме
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

// Удаление фото из списка при редактировании
window.removePhoto = function(index) {
  currentPhotos.splice(index, 1);
  renderPhotosPreview();
};

// Сжатие и добавление нескольких картинок
if (photosInput) {
  photosInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    for (const file of files) {
      const base64 = await resizeImage(file);
      currentPhotos.push(base64);
    }
    renderPhotosPreview();
    photosInput.value = ''; // Сброс инпута
  });
}

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

// Сохранение (Создание / Обновление)
spotForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Сохранение...';
  }

  const id = spotIdInput.value;
  const spotData = {
    title: titleInput.value.trim() || 'Без названия',
    note: noteInput.value.trim() || '',
    status: statusSelect.value,
    lat: parseFloat(latInput.value),
    lng: parseFloat(lngInput.value),
    photos: currentPhotos
  };

  try {
    if (id) {
      await db.collection('stickers').doc(id).update(spotData);
    } else {
      spotData.createdAt = Date.now();
      await db.collection('stickers').add(spotData);
    }
    closeModal();
  } catch (err) {
    console.error('Ошибка сохранения:', err);
    alert('Не удалось сохранить спот!');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Сохранить';
    }
  }
});

// Удаление спота
window.deleteSpot = async function(id) {
  if (!confirm('Точно удалить этот спот?')) return;
  try {
    await db.collection('stickers').doc(id).delete();
  } catch (err) {
    console.error('Ошибка при удалении:', err);
  }
};

// Просмотр фото на весь экран (Lightbox)
window.openLightbox = function(src) {
  lightboxImg.src = src;
  lightbox.classList.remove('hidden');
};

function closeLightbox() {
  lightbox.classList.add('hidden');
  lightboxImg.src = '';
}

if (lightboxClose) lightboxClose.addEventListener('click', closeLightbox);
if (lightbox) {
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) closeLightbox();
  });
}

// Подписка на Firebase
db.collection('stickers').onSnapshot((snapshot) => {
  spots = [];
  snapshot.forEach(doc => {
    spots.push({ id: doc.id, ...doc.data() });
  });
  renderMarkers();
});