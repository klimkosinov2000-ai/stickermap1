const crypto = require('crypto');

const FIREBASE_PROJECT_ID = 'stickermap-df14d';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://akoecseeheeafmgmrshv.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const CLOUDINARY_CLOUD_NAME = 'akuq6jfv';
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || '';
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || '';

const OWNER_EMAILS = (process.env.OWNER_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

let cachedCerts = null;
let certsExpireAt = 0;

async function getGoogleCerts() {
  if (cachedCerts && Date.now() < certsExpireAt) return cachedCerts;
  const res = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
  if (!res.ok) throw new Error('Не удалось получить сертификаты Firebase');
  const cacheControl = res.headers.get('cache-control') || '';
  const match = cacheControl.match(/max-age=(\d+)/);
  const maxAge = match ? parseInt(match[1], 10) : 3600;
  cachedCerts = await res.json();
  certsExpireAt = Date.now() + maxAge * 1000;
  return cachedCerts;
}

async function verifyFirebaseToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  const now = Math.floor(Date.now() / 1000);

  if (
    header.alg !== 'RS256' ||
    payload.aud !== FIREBASE_PROJECT_ID ||
    payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}` ||
    typeof payload.sub !== 'string' ||
    !payload.sub ||
    payload.exp <= now
  ) {
    return null;
  }

  const certs = await getGoogleCerts();
  const cert = certs[header.kid];
  if (!cert) return null;

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${parts[0]}.${parts[1]}`);
  const isValid = verifier.verify(cert, parts[2], 'base64url');
  if (!isValid) return null;

  return {
    uid: payload.sub,
    email: (payload.email || '').trim().toLowerCase(),
    token
  };
}

async function sbRequest(path, options = {}) {
  if (!SUPABASE_SERVICE_KEY) {
    throw new Error('На сервере не задан SUPABASE_SERVICE_ROLE_KEY');
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: options.method || 'GET',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.prefer ? { Prefer: options.prefer } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error((data && (data.message || data.error)) || `Supabase HTTP ${res.status}`);
  }
  return data;
}

async function getUserRoles(email) {
  const clean = (email || '').trim().toLowerCase();
  const isOwner = Boolean(clean && OWNER_EMAILS.includes(clean));
  if (!clean) return { isOwner: false, isMod: false, isPremium: false };

  let rows = [];
  try {
    rows = await sbRequest(`staff_roles?email=eq.${encodeURIComponent(clean)}&select=role`);
  } catch (e) {
    rows = [];
  }

  const rolesSet = new Set((rows || []).map(r => r.role));
  return {
    isOwner,
    isMod: isOwner || rolesSet.has('moderator'),
    isPremium: isOwner || rolesSet.has('premium')
  };
}

function sanitizePhotos(photos) {
  if (!Array.isArray(photos)) return [];
  return photos
    .filter(p => typeof p === 'string' && p.trim().startsWith(`https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/`))
    .map(p => p.trim())
    .slice(0, 5);
}

async function deleteCloudinaryImages(urls) {
  if (!CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET || !Array.isArray(urls) || urls.length === 0) return;

  for (const url of urls) {
    const match = String(url).match(/\/upload\/(?:[^/]+\/)*v\d+\/(.+)\.[a-zA-Z0-9]+$/);
    if (!match) continue;
    const publicId = decodeURIComponent(match[1]);
    const timestamp = Math.floor(Date.now() / 1000);
    const sigStr = `public_id=${publicId}&timestamp=${timestamp}${CLOUDINARY_API_SECRET}`;
    const signature = crypto.createHash('sha1').update(sigStr).digest('hex');

    const form = new URLSearchParams();
    form.append('public_id', publicId);
    form.append('timestamp', String(timestamp));
    form.append('api_key', CLOUDINARY_API_KEY);
    form.append('signature', signature);

    await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/destroy`, {
      method: 'POST',
      body: form
    }).catch(() => {});
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { action, payload = {} } = req.body || {};
    if (!action || typeof action !== 'string') {
      return res.status(400).json({ error: 'Не указано действие (action)' });
    }

    const user = await verifyFirebaseToken(req.headers.authorization);
    if (!user) {
      return res.status(401).json({ error: 'Требуется авторизация' });
    }

    const roles = await getUserRoles(user.email);

    // 1. Получение ролей
    if (action === 'get_my_roles') {
      return res.status(200).json(roles);
    }

    // 2. Управление модераторами и Premium (только владелец)
    if (action === 'manage_staff') {
      if (!roles.isOwner) return res.status(403).json({ error: 'Доступ запрещён' });
      const targetEmail = String(payload.email || '').trim().toLowerCase();
      const role = payload.role === 'premium' ? 'premium' : 'moderator';
      if (!targetEmail || !targetEmail.includes('@')) {
        return res.status(400).json({ error: 'Некорректный email' });
      }

      if (payload.mode === 'add') {
        await sbRequest('staff_roles', {
          method: 'POST',
          prefer: 'resolution=merge-duplicates',
          body: { email: targetEmail, role }
        });
      } else {
        await sbRequest(
          `staff_roles?email=eq.${encodeURIComponent(targetEmail)}&role=eq.${encodeURIComponent(role)}`,
          { method: 'DELETE' }
        );
      }
      return res.status(200).json({ ok: true });
    }

    // 3. Подпись загрузки в Cloudinary
    if (action === 'get_upload_signature') {
      if (!CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
        return res.status(200).json({ unsigned: true });
      }
      const folder = String(payload.folder || 'stickermap/spots').replace(/[^a-zA-Z0-9/_-]/g, '');
      const timestamp = Math.floor(Date.now() / 1000);
      const toSign = `folder=${folder}&timestamp=${timestamp}&upload_preset=stickermap${CLOUDINARY_API_SECRET}`;
      const signature = crypto.createHash('sha1').update(toSign).digest('hex');
      return res.status(200).json({
        signature,
        timestamp,
        apiKey: CLOUDINARY_API_KEY,
        uploadPreset: 'stickermap'
      });
    }

    // 4. Проверка/создание крю в Firestore
    if (action === 'save_crew') {
      const crewName = String(payload.crewName || '').trim().slice(0, 32);
      const inviteCode = String(payload.inviteCode || '').trim().slice(0, 32);
      const chosenColor = /^#[0-9A-Fa-f]{6}$/.test(payload.color || '') ? payload.color : '#2ecc71';
      if (!crewName || !inviteCode) {
        return res.status(400).json({ error: 'Укажи название крю и инвайт-код' });
      }

      const crewId = crewName.toLowerCase();
      const docUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/crews/${encodeURIComponent(crewId)}`;
      const getRes = await fetch(docUrl, {
        headers: { Authorization: `Bearer ${user.token}` }
      });

      if (getRes.ok) {
        const docJson = await getRes.json();
        const fields = docJson.fields || {};
        const savedCode = fields.inviteCode?.stringValue || '';
        const ownerUid = fields.ownerUid?.stringValue || '';
        const savedColor = fields.color?.stringValue || chosenColor;

        if (savedCode !== inviteCode && !roles.isOwner) {
          return res.status(403).json({ error: `Неверный инвайт-код для крю «${crewName}»` });
        }

        if (ownerUid === user.uid) {
          await fetch(`${docUrl}?updateMask.fieldPaths=color`, {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${user.token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fields: { color: { stringValue: chosenColor } } })
          });
          return res.status(200).json({ color: chosenColor });
        }
        return res.status(200).json({ color: savedColor });
      }

      await fetch(docUrl, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${user.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fields: {
            name: { stringValue: crewName },
            inviteCode: { stringValue: inviteCode },
            color: { stringValue: chosenColor },
            ownerUid: { stringValue: user.uid },
            createdAt: { integerValue: String(Date.now()) }
          }
        })
      });
      return res.status(200).json({ color: chosenColor });
    }

    // 5. Создание точки
    if (action === 'create_spot' || action === 'create_privileged_spot') {
      const raw = payload.spot || {};
      const photos = sanitizePhotos(raw.photos);
      if (photos.length === 0) {
        return res.status(400).json({ error: 'Нужно прикрепить хотя бы одно фото' });
      }

      const lat = Number(raw.lat);
      const lng = Number(raw.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return res.status(400).json({ error: 'Некорректные координаты' });
      }

      const isAutoApproved = roles.isMod || roles.isPremium;
      const spotRecord = {
        id: String(raw.id || `sp_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`),
        spotType: ['sticker', 'graffiti', 'tag'].includes(raw.spotType) ? raw.spotType : 'sticker',
        publishAs: raw.publishAs === 'crew' ? 'crew' : 'solo',
        title: String(raw.title || 'Без названия').trim().slice(0, 80),
        status: ['ok', 'damaged', 'gone'].includes(raw.status) ? raw.status : 'ok',
        note: String(raw.note || '').trim().slice(0, 400),
        lat,
        lng,
        photos,
        isHotspot: roles.isOwner ? Boolean(raw.isHotspot) : false,
        isPremium: roles.isPremium,
        createdAt: Date.now(),
        approved: isAutoApproved,
        rejected: false,
        reportedBy: [],
        likes: [],
        aliveVotes: 0,
        buffVotes: 0,
        authorUid: user.uid,
        authorName: String(raw.authorName || 'Автор').trim().slice(0, 32),
        authorAvatar: typeof raw.authorAvatar === 'string' && raw.authorAvatar.startsWith(`https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/`) ? raw.authorAvatar : '',
        authorColor: /^#[0-9A-Fa-f]{6}$/.test(raw.authorColor || '') ? raw.authorColor : '#2ecc71',
        authorCrew: String(raw.authorCrew || '').trim().slice(0, 32)
      };

      const inserted = await sbRequest('stickers', {
        method: 'POST',
        prefer: 'return=representation',
        body: spotRecord
      });

      return res.status(200).json({ spot: Array.isArray(inserted) ? inserted[0] : spotRecord });
    }

    // 6. Редактирование точки
    if (action === 'edit_spot') {
      const spotId = String(payload.spotId || '').trim();
      const existingRows = await sbRequest(`stickers?id=eq.${encodeURIComponent(spotId)}&select=*`);
      const existing = existingRows && existingRows[0];
      if (!existing) return res.status(404).json({ error: 'Точка не найдена' });
      if (!roles.isMod && existing.authorUid !== user.uid) {
        return res.status(403).json({ error: 'Нет прав на редактирование' });
      }

      const u = payload.updates || {};
      const patch = {};
      if (u.title !== undefined) patch.title = String(u.title).trim().slice(0, 80) || 'Без названия';
      if (u.note !== undefined) patch.note = String(u.note).trim().slice(0, 400);
      if (['ok', 'damaged', 'gone'].includes(u.status)) patch.status = u.status;
      if (['sticker', 'graffiti', 'tag'].includes(u.spotType)) patch.spotType = u.spotType;
      if (['solo', 'crew'].includes(u.publishAs)) patch.publishAs = u.publishAs;
      if (Array.isArray(u.photos)) {
        const cleanPhotos = sanitizePhotos(u.photos);
        if (cleanPhotos.length > 0) patch.photos = cleanPhotos;
      }
      if (roles.isOwner && typeof u.isHotspot === 'boolean') {
        patch.isHotspot = u.isHotspot;
      }

      await sbRequest(`stickers?id=eq.${encodeURIComponent(spotId)}`, {
        method: 'PATCH',
        body: patch
      });
      return res.status(200).json({ ok: true });
    }

    // 7. Удаление одной точки
    if (action === 'delete_spot') {
      const spotId = String(payload.spotId || '').trim();
      const rows = await sbRequest(`stickers?id=eq.${encodeURIComponent(spotId)}&select=id,authorUid,photos`);
      const target = rows && rows[0];
      if (!target) return res.status(200).json({ ok: true });
      if (!roles.isMod && target.authorUid !== user.uid) {
        return res.status(403).json({ error: 'Нет прав на удаление' });
      }

      await deleteCloudinaryImages(target.photos);
      await sbRequest(`stickers?id=eq.${encodeURIComponent(spotId)}`, { method: 'DELETE' });
      return res.status(200).json({ ok: true });
    }

    // 8. Массовое удаление своих работ (в профиле)
    if (action === 'bulk_delete_own') {
      const ids = Array.from(new Set((payload.spotIds || []).map(String).filter(Boolean))).slice(0, 50);
      if (ids.length === 0) return res.status(200).json({ ok: true });

      const inFilter = ids.map(id => `"${id.replace(/"/g, '')}"`).join(',');
      const ownedRows = await sbRequest(
        `stickers?id=in.(${encodeURIComponent(inFilter)})&authorUid=eq.${encodeURIComponent(user.uid)}&select=id,photos`
      );
      if (!ownedRows || ownedRows.length === 0) return res.status(200).json({ ok: true });

      for (const row of ownedRows) {
        await deleteCloudinaryImages(row.photos);
      }

      const ownedFilter = ownedRows.map(r => `"${String(r.id).replace(/"/g, '')}"`).join(',');
      await sbRequest(
        `stickers?id=in.(${encodeURIComponent(ownedFilter)})&authorUid=eq.${encodeURIComponent(user.uid)}`,
        { method: 'DELETE' }
      );
      return res.status(200).json({ ok: true, deleted: ownedRows.length });
    }

    // 9. Массовое удаление на карте / снос постов спамера (только владелец)
    if (action === 'bulk_delete') {
      if (!roles.isOwner) return res.status(403).json({ error: 'Доступно только владельцу' });
      const ids = Array.from(new Set((payload.spotIds || []).map(String).filter(Boolean))).slice(0, 50);
      if (ids.length === 0) return res.status(200).json({ ok: true });

      const inFilter = ids.map(id => `"${id.replace(/"/g, '')}"`).join(',');
      const targetRows = await sbRequest(`stickers?id=in.(${encodeURIComponent(inFilter)})&select=id,photos`);
      for (const row of targetRows || []) {
        await deleteCloudinaryImages(row.photos);
      }

      await sbRequest(`stickers?id=in.(${encodeURIComponent(inFilter)})`, { method: 'DELETE' });
      return res.status(200).json({ ok: true });
    }

    // 10. Модерация: одобрение, снятие жалоб, отклонение
    if (action === 'approve_spot') {
      if (!roles.isMod) return res.status(403).json({ error: 'Нужны права модератора' });
      const spotId = String(payload.spotId || '').trim();
      const modLabel = String(payload.modLabel || 'Модератор').slice(0, 32);
      await sbRequest(`stickers?id=eq.${encodeURIComponent(spotId)}`, {
        method: 'PATCH',
        body: { approved: true, rejected: false, reportedBy: [], approvedByLabel: modLabel }
      });
      return res.status(200).json({ ok: true, approvedByLabel: modLabel });
    }

    if (action === 'clear_reports') {
      if (!roles.isMod) return res.status(403).json({ error: 'Нужны права модератора' });
      const spotId = String(payload.spotId || '').trim();
      await sbRequest(`stickers?id=eq.${encodeURIComponent(spotId)}`, {
        method: 'PATCH',
        body: { approved: true, rejected: false, reportedBy: [] }
      });
      return res.status(200).json({ ok: true });
    }

    if (action === 'reject_spot') {
      if (!roles.isMod) return res.status(403).json({ error: 'Нужны права модератора' });
      const spotId = String(payload.spotId || '').trim();
      const reason = String(payload.reason || 'Не соответствует правилам').slice(0, 200);
      const rows = await sbRequest(`stickers?id=eq.${encodeURIComponent(spotId)}&select=id,title,authorUid,photos`);
      const target = rows && rows[0];

      if (target) {
        if (target.authorUid && target.authorUid !== 'admin') {
          await sbRequest('notifications', {
            method: 'POST',
            body: {
              user_uid: target.authorUid,
              spot_title: target.title || 'Без названия',
              reason,
              is_read: false
            }
          }).catch(() => {});
        }
        await deleteCloudinaryImages(target.photos);
        await sbRequest(`stickers?id=eq.${encodeURIComponent(spotId)}`, { method: 'DELETE' });
      }
      return res.status(200).json({ ok: true });
    }

    // 11. Респекты, жалобы и голосование «На месте / Нет на месте»
    if (action === 'toggle_respect') {
      const spotId = String(payload.spotId || '').trim();
      const rows = await sbRequest(`stickers?id=eq.${encodeURIComponent(spotId)}&select=likes`);
      const target = rows && rows[0];
      if (!target) return res.status(404).json({ error: 'Точка не найдена' });

      const likesSet = new Set(Array.isArray(target.likes) ? target.likes : []);
      if (likesSet.has(user.uid)) likesSet.delete(user.uid);
      else likesSet.add(user.uid);

      const likes = Array.from(likesSet);
      await sbRequest(`stickers?id=eq.${encodeURIComponent(spotId)}`, {
        method: 'PATCH',
        body: { likes }
      });
      return res.status(200).json({ likes });
    }

    if (action === 'report_spot') {
      const spotId = String(payload.spotId || '').trim();
      const rows = await sbRequest(`stickers?id=eq.${encodeURIComponent(spotId)}&select=reportedBy`);
      const target = rows && rows[0];
      if (!target) return res.status(404).json({ error: 'Точка не найдена' });

      const repSet = new Set(Array.isArray(target.reportedBy) ? target.reportedBy : []);
      repSet.add(user.uid);
      const reportedBy = Array.from(repSet);

      await sbRequest(`stickers?id=eq.${encodeURIComponent(spotId)}`, {
        method: 'PATCH',
        body: { reportedBy }
      });
      return res.status(200).json({ reportedBy });
    }

    if (action === 'vote_status') {
      const spotId = String(payload.spotId || '').trim();
      const vote = payload.vote === 'buff' ? 'buff' : 'alive';
      const rows = await sbRequest(`stickers?id=eq.${encodeURIComponent(spotId)}&select=aliveVotes,buffVotes,status`);
      const target = rows && rows[0];
      if (!target) return res.status(404).json({ error: 'Точка не найдена' });

      const aliveVotes = Number(target.aliveVotes || 0) + (vote === 'alive' ? 1 : 0);
      const buffVotes = Number(target.buffVotes || 0) + (vote === 'buff' ? 1 : 0);
      const status = vote === 'alive' ? 'ok' : (buffVotes >= 3 ? 'gone' : target.status);

      await sbRequest(`stickers?id=eq.${encodeURIComponent(spotId)}`, {
        method: 'PATCH',
        body: { aliveVotes, buffVotes, status }
      });
      return res.status(200).json({ spot: { aliveVotes, buffVotes, status } });
    }

    // 12. Синхронизация профиля на точках и скрытие уведомлений
    if (action === 'sync_profile_spots') {
      const u = payload.updates || {};
      const patch = {
        authorName: String(u.authorName || 'Автор').trim().slice(0, 32),
        authorCrew: String(u.authorCrew || '').trim().slice(0, 32),
        authorColor: /^#[0-9A-Fa-f]{6}$/.test(u.authorColor || '') ? u.authorColor : '#2ecc71',
        authorAvatar: typeof u.authorAvatar === 'string' && u.authorAvatar.startsWith(`https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/`) ? u.authorAvatar : '',
        isPremium: roles.isPremium
      };
      await sbRequest(`stickers?authorUid=eq.${encodeURIComponent(user.uid)}`, {
        method: 'PATCH',
        body: patch
      });
      return res.status(200).json({ ok: true });
    }

    if (action === 'dismiss_notifications') {
      const ids = Array.from(new Set((payload.ids || []).map(String).filter(Boolean))).slice(0, 50);
      if (ids.length === 0) return res.status(200).json({ ok: true });
      const inFilter = ids.map(id => `"${id.replace(/"/g, '')}"`).join(',');
      await sbRequest(
        `notifications?id=in.(${encodeURIComponent(inFilter)})&user_uid=eq.${encodeURIComponent(user.uid)}`,
        { method: 'PATCH', body: { is_read: true } }
      );
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: `Неизвестное действие: ${action}` });
  } catch (err) {
    console.error('API Error:', err);
    return res.status(500).json({ error: err.message || 'Внутренняя ошибка сервера' });
  }
};