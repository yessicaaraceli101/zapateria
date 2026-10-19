/* =================================================================
   Panel de administración (sitio estático)
   - El acceso (usuario + contraseña) protege el permiso de guardado,
     cifrado con AES-GCM. Sin la contraseña correcta no se puede usar.
   - La activación la hace el instalador una sola vez desde conectar.html.
   - Cada cambio se guarda como un commit en el repositorio.
   ================================================================= */
(function () {
  'use strict';

  var esc = Z.esc, money = Z.money, lower = Z.lower, num = Z.num;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var API = 'https://api.github.com';
  var SESSION_KEY = 'zapateria_admin';
  var DATA_PATH = 'data/catalogo.json';
  var AUTH_PATH = 'data/acceso.json';
  var NOTE = 'El catálogo público se actualiza en 1 o 2 minutos.';
  var USER_RE = /^[A-Za-z0-9._@-]{3,40}$/;
  var enc = new TextEncoder(), dec = new TextDecoder();

  var S = { repo: null, token: '', user: '', auth: null, authSha: null, data: null, sha: null, busy: false };

  /* ---------------- base64 ---------------- */
  function b64(buf) {
    var bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf), s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(s) {
    var bin = atob(String(s).replace(/\s/g, '')), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function rid() {
    var a = crypto.getRandomValues(new Uint8Array(6));
    return Array.prototype.map.call(a, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }

  /* ---------------- cifrado del token ---------------- */
  async function deriveKey(user, pass, salt, iterations) {
    var base = await crypto.subtle.importKey('raw', enc.encode(lower(user.trim()) + '\n' + pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function sealToken(user, pass, token) {
    var salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    var iterations = 310000;
    var key = await deriveKey(user, pass, salt, iterations);
    var ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(JSON.stringify({ token: token || '' })));
    return { salt: b64(salt), iv: b64(iv), ct: b64(ct), iterations: iterations };
  }
  async function openToken(user, pass, auth) {
    var key = await deriveKey(user, pass, unb64(auth.salt), auth.iterations || 310000);
    var pt = dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(auth.iv) }, key, unb64(auth.ct)));
    try { var o = JSON.parse(pt); if (o && typeof o.token === 'string') return o.token; } catch (e) { /* formato anterior */ }
    return pt;
  }

  /* ---------------- API de GitHub ---------------- */
  function ghError(status, message) {
    if (status === 401) return 'El sistema necesita ser reactivado. Avisá a quien lo instaló.';
    if (status === 403) return 'No hay permiso para guardar. Avisá a quien instaló el sistema.';
    if (status === 404) return 'No se encontró dónde guardar los datos. Avisá a quien instaló el sistema.';
    if (status === 409) return 'Hubo otro cambio al mismo tiempo. Se recargaron los datos; volvé a intentarlo.';
    if (status === 422) return 'No se pudo guardar el cambio (' + message + ').';
    return 'No se pudo guardar (error ' + status + '). Probá de nuevo en un momento.';
  }
  async function gh(path, opts, token) {
    opts = opts || {};
    var headers = {
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + (token || S.token),
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (opts.body) headers['Content-Type'] = 'application/json';
    var r;
    try {
      r = await fetch(API + path, { method: opts.method || 'GET', headers: headers, body: opts.body, cache: 'no-store' });
    } catch (e) {
      throw new Error('No hay conexión a internet. Revisá tu conexión y probá de nuevo.');
    }
    if (!r.ok) {
      var m = '';
      try { m = (await r.json()).message || ''; } catch (e) { /* sin detalle */ }
      var err = new Error(ghError(r.status, m));
      err.status = r.status;
      throw err;
    }
    return r.status === 204 ? null : r.json();
  }
  function contentsPath(path, repo) {
    repo = repo || S.repo;
    return '/repos/' + encodeURIComponent(repo.owner) + '/' + encodeURIComponent(repo.repo) + '/contents/' +
      path.split('/').map(encodeURIComponent).join('/');
  }
  async function getFile(path, token) {
    if (!(token || S.token)) return null;
    try {
      return await gh(contentsPath(path) + '?ref=' + encodeURIComponent(S.repo.branch), null, token);
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }
  var NEED_CONN = 'El panel todavía no está activado para guardar cambios. Avisá a quien instaló el sistema.';
  function connected() { return !!S.token; }
  async function putFile(path, base64, message, sha, token) {
    if (!(token || S.token)) throw new Error(NEED_CONN);
    var body = { message: message, content: base64, branch: S.repo.branch };
    if (sha) body.sha = sha;
    var j = await gh(contentsPath(path), { method: 'PUT', body: JSON.stringify(body) }, token);
    return j.content.sha;
  }
  async function deleteFile(path, message) {
    if (!/^img\/(productos|marcas|tienda)\/[A-Za-z0-9._-]+$/.test(path || '')) return;
    try {
      var f = await getFile(path);
      if (f) await gh(contentsPath(path), { method: 'DELETE', body: JSON.stringify({ message: message, sha: f.sha, branch: S.repo.branch }) });
    } catch (e) { /* si no se puede borrar, queda el archivo y no pasa nada */ }
  }
  function decodeJsonFile(f) { return JSON.parse(dec.decode(unb64(f.content))); }
  function jsonB64(obj) { return b64(enc.encode(JSON.stringify(obj, null, 2) + '\n')); }

  /* Las imágenes recién subidas se ven en el panel desde GitHub directamente */
  function imgUrl(path) {
    if (!path) return '';
    if (/^(https?:|data:|blob:)/.test(path)) return path;
    if (!connected() || !S.repo || !S.repo.owner) return path;
    return 'https://raw.githubusercontent.com/' + S.repo.owner + '/' + S.repo.repo + '/' + S.repo.branch + '/' + path;
  }

  /* ---------------- imágenes ---------------- */
  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('No se pudo leer la imagen. Probá con un JPG o PNG.')); };
      img.src = url;
    });
  }
  async function uploadImage(file, folder, prefix, maxSide, keepPng) {
    if (!/^image\//.test(file.type)) throw new Error('El archivo elegido no es una imagen.');
    if (file.size > 15 * 1024 * 1024) throw new Error('La imagen pesa demasiado (máximo 15 MB).');
    var img = await loadImage(file);
    var scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    var w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d');
    if (!keepPng) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(img, 0, 0, w, h);
    var type = keepPng ? 'image/png' : 'image/jpeg';
    var blob = await new Promise(function (res) { canvas.toBlob(res, type, 0.85); });
    if (!blob) throw new Error('No se pudo procesar la imagen.');
    var path = folder + '/' + prefix + '-' + Date.now().toString(36) + rid() + (keepPng ? '.png' : '.jpg');
    await putFile(path, b64(await blob.arrayBuffer()), 'Subir imagen ' + path);
    return path;
  }

  /* ---------------- mensajes y estados ---------------- */
  function showMsg(type, text, where) {
    var box = $(where || '#msgs');
    var el = document.createElement('div');
    el.className = 'alert alert-' + (type === 'ok' ? 'ok' : type === 'warn' ? 'warn' : 'error');
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.textContent = text;
    box.innerHTML = '';
    box.appendChild(el);
    if (type === 'ok') setTimeout(function () { if (el.parentNode) el.remove(); }, 7000);
    if (!where) window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function run(btn, label, fn) {
    if (S.busy) return;
    S.busy = true;
    var old = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = label; }
    try {
      await fn();
    } catch (e) {
      console.error(e);
      var where = !$('#gate').hidden ? '#gateMsgs' : ($('#productDialog').open ? '#dlgMsgs' : null);
      showMsg('error', e.message || String(e), where);
    } finally {
      S.busy = false;
      if (btn) { btn.disabled = false; btn.textContent = old; }
    }
  }

  /* ---------------- ventana de confirmación ---------------- */
  var ICON_TRASH = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>';
  var ICON_EXIT = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>';
  function ask(o) {
    return new Promise(function (resolve) {
      var d = $('#confirmDlg'), yes = $('#cYes'), no = $('#cNo');
      $('#cTitle').textContent = o.title;
      $('#cText').textContent = o.text;
      $('#cIco').innerHTML = o.danger ? ICON_TRASH : ICON_EXIT;
      $('#cIco').className = 'confirm-ico' + (o.danger ? ' is-danger' : '');
      yes.textContent = o.ok;
      yes.className = 'btn ' + (o.danger ? 'btn-danger' : 'btn-primary');
      function done(v) {
        yes.onclick = no.onclick = d.onclick = d.oncancel = null;
        if (d.open) d.close();
        resolve(v);
      }
      yes.onclick = function () { done(true); };
      no.onclick = function () { done(false); };
      d.onclick = function (e) { if (e.target === d) done(false); };
      d.oncancel = function (e) { e.preventDefault(); done(false); };
      d.showModal();
      no.focus();
    });
  }

  /* ---------------- datos ---------------- */
  function normalize(d) {
    d = d || {};
    d.store = Object.assign({ store_name: 'Mi Zapatería', tagline: '', whatsapp: '', address: '', logo: '' }, d.store || {});
    d.brands = Array.isArray(d.brands) ? d.brands : [];
    d.products = Array.isArray(d.products) ? d.products : [];
    return d;
  }
  async function loadAll() {
    var res = await Promise.all([getFile(DATA_PATH), getFile(AUTH_PATH)]);
    S.data = normalize(res[0] ? decodeJsonFile(res[0]) : null);
    S.sha = res[0] ? res[0].sha : null;
    if (res[1]) { S.auth = decodeJsonFile(res[1]); S.authSha = res[1].sha; }
  }
  /* Aplica un cambio sobre una copia y la guarda como commit */
  async function commit(message, mutate) {
    var draft = JSON.parse(JSON.stringify(S.data));
    var after = await mutate(draft);
    try {
      S.sha = await putFile(DATA_PATH, jsonB64(draft), message, S.sha);
    } catch (e) {
      if (e.status === 409 || e.status === 422) { await loadAll(); renderAll(); }
      throw e;
    }
    S.data = draft;
    renderAll();
    if (typeof after === 'function') await after();
  }
  async function saveAuth(auth, token, message) {
    var current = await getFile(AUTH_PATH, token);
    S.authSha = await putFile(AUTH_PATH, jsonB64(auth), message, current ? current.sha : null, token);
    S.auth = auth;
  }
  function remember() {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: S.token, user: S.user, repo: S.repo }));
  }

  /* =================================================================
     Ingreso
     ================================================================= */
  function gateView(name, sub) {
    ['#loginForm'].forEach(function (id) { $(id).hidden = id !== '#' + name; });
    $('#gateSub').textContent = sub || 'Panel de administración';
    $('#gate').hidden = false;
    $('#panel').hidden = true;
  }
  function guessRepo() {
    var m = location.hostname.match(/^([^.]+)\.github\.io$/i);
    if (!m) return { owner: '', repo: '' };
    var first = location.pathname.split('/').filter(Boolean)[0] || '';
    var repo = first && !/\.html?$/i.test(first) ? first : m[1] + '.github.io';
    return { owner: m[1], repo: repo };
  }

  async function fetchPublic(path) {
    var r = await fetch(path + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    return r.json();
  }
  async function loadLocal() {
    S.data = normalize(await fetchPublic(DATA_PATH));
    S.sha = null;
  }
  async function brandGate() {
    try {
      var d = normalize(await fetchPublic(DATA_PATH)), st = d.store;
      var parts = String(st.store_name).trim().split(/\s+/);
      $('#gateName').innerHTML = esc(parts[0]) + (parts.length > 1 ? ' <span class="name-2">' + esc(parts.slice(1).join(' ')) + '</span>' : '');
      document.title = st.store_name + ' · Panel de administración';
      if (st.logo) $('#gateLogo').outerHTML = '<img id="gateLogo" class="logo" src="' + esc(st.logo) + '" alt="">';
    } catch (e) { /* se queda con el nombre por defecto */ }
  }

  async function init() {
    $('#gateLogo').innerHTML = Z.shoe(26);
    if (!window.crypto || !crypto.subtle) {
      gateView('none', 'El panel necesita abrirse desde una dirección segura (https).');
      return;
    }
    brandGate();
    var saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { saved = null; }
    if (saved && saved.user && saved.repo) {
      S.token = saved.token || ''; S.user = saved.user; S.repo = saved.repo;
      try { await enterPanel(); return; } catch (e) {
        sessionStorage.removeItem(SESSION_KEY);
        S.token = '';
        if (e.status === 401) showMsg('warn', 'Tu sesión venció. Ingresá de nuevo.', '#gateMsgs');
      }
    }
    try {
      S.auth = await fetchPublic(AUTH_PATH);
    } catch (e) {
      gateView('none', e.status === 404
        ? 'Falta el archivo data/acceso.json. Volvé a subirlo desde el zip.'
        : 'No se pudo conectar. Revisá tu internet y recargá la página.');
      return;
    }
    gateView('loginForm');
    $('#lUser').focus();
  }

  $('#loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var user = $('#lUser').value.trim(), pass = $('#lPass').value;
    run($('#loginForm button'), 'Verificando…', async function () {
      var token;
      try { token = await openToken(user, pass, S.auth); } catch (err) {
        showMsg('error', 'Usuario o contraseña incorrectos.', '#gateMsgs');
        $('#lPass').value = ''; $('#lPass').focus();
        return;
      }
      S.token = token; S.user = user;
      S.repo = S.auth.owner ? { owner: S.auth.owner, repo: S.auth.repo, branch: S.auth.branch || 'main' }
                            : Object.assign(guessRepo(), { branch: 'main' });
      try {
        await enterPanel();
      } catch (err) {
        if (err.status === 401) {
          S.token = '';
          showMsg('error', 'El sistema necesita ser reactivado. Avisá a quien lo instaló.', '#gateMsgs');
          return;
        }
        throw err;
      }
    });
  });

  async function enterPanel() {
    if (connected()) {
      await loadAll();
    } else {
      if (!S.auth) S.auth = await fetchPublic(AUTH_PATH);
      await loadLocal();
    }
    remember();
    $('#gate').hidden = true;
    $('#panel').hidden = false;
    renderAll();
    showTab((location.hash || '#productos').slice(1));
  }

  $('#logoutBtn').addEventListener('click', async function () {
    var ok = await ask({ title: '¿Cerrar sesión?', text: 'Vas a salir del panel de administración. Para volver a entrar necesitás tu usuario y contraseña.', ok: 'Sí, salir' });
    if (!ok) return;
    sessionStorage.removeItem(SESSION_KEY);
    location.href = 'admin.html';
  });

  /* =================================================================
     Panel
     ================================================================= */
  function showTab(name) {
    if (['productos', 'marcas', 'config'].indexOf(name) === -1) name = 'productos';
    $$('[data-tab]').forEach(function (a) { a.classList.toggle('active', a.dataset.tab === name); });
    $$('[data-pane]').forEach(function (p) { p.hidden = p.dataset.pane !== name; });
  }
  $$('[data-tab]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      history.replaceState(null, '', '#' + a.dataset.tab);
      showTab(a.dataset.tab);
    });
  });

  $('#banners').addEventListener('click', function (e) {
    var a = e.target.closest('[data-goto]');
    if (!a) return;
    e.preventDefault();
    history.replaceState(null, '', '#' + a.dataset.goto);
    showTab(a.dataset.goto);
  });

  function renderAll() {
    var st = S.data.store;
    $('#admName').textContent = st.store_name;
    var logo = $('#admLogo');
    if (st.logo) {
      logo.outerHTML = '<img id="admLogo" class="logo" src="' + esc(imgUrl(st.logo)) + '" alt="">';
    } else {
      logo.outerHTML = '<span id="admLogo" class="logo logo-ph" aria-hidden="true">' + Z.initial(st.store_name) + '</span>';
    }
    document.title = st.store_name + ' · Panel';
    var ban = '';
    if (S.auth && S.auth.is_default) {
      ban += '<div class="alert alert-warn">Estás usando el usuario y la contraseña de fábrica (admin / admin123). <a href="#config" data-goto="config">Cambialos</a> para que nadie más pueda entrar.</div>';
    }
    $('#banners').innerHTML = ban;
    renderProducts();
    renderBrandAdmin();
    renderConfig();
  }

  /* ---------------- Productos ---------------- */
  function renderProducts() {
    var list = S.data.products.slice().sort(function (a, b) { return (b.created_at || 0) - (a.created_at || 0); });
    if (!list.length) {
      $('#prodRows').innerHTML = '<tr><td colspan="9" class="tbl-empty">Todavía no cargaste productos. Tocá <strong>+ Nuevo producto</strong> para empezar.</td></tr>';
    } else {
      $('#prodRows').innerHTML = list.map(function (p) {
        var stock = Z.stockOf(p);
        var sub = [p.category, p.gender, p.brand].filter(Boolean).join(' · ');
        var sizes = (p.sizes || []).map(function (s) { return String(s.size); });
        var sizeText = sizes.length ? (sizes.length > 1 ? sizes[0] + ' al ' + sizes[sizes.length - 1] : sizes[0]) : '—';
        var search = lower([p.name, p.sku, p.code, p.brand, p.category].join(' '));
        return '<tr data-search="' + esc(search) + '">' +
          '<td>' + (p.image ? '<img class="thumb" src="' + esc(imgUrl(p.image)) + '" alt="">' : '<span class="thumb thumb-ph">' + Z.shoe(24) + '</span>') + '</td>' +
          '<td><strong class="t-name">' + esc(p.name) + '</strong><span class="t-sub">' + esc(sub) + '</span></td>' +
          '<td>' + esc(p.sku) + '</td><td>' + esc(p.code) + '</td>' +
          '<td class="nowrap">' + money(p.price) + '</td>' +
          '<td class="nowrap" title="' + esc(sizes.join(', ')) + '">' + esc(sizeText) + '</td>' +
          '<td class="' + (stock <= 0 ? 't-out' : '') + '">' + stock + '</td>' +
          '<td><button type="button" class="pill ' + (p.visible ? 'pill-on' : 'pill-off') + '" data-toggle="' + esc(p.id) + '" title="Tocá para ' + (p.visible ? 'ocultar' : 'mostrar') + '">' + (p.visible ? 'Visible' : 'Oculto') + '</button></td>' +
          '<td class="actions">' +
            '<button type="button" class="icon-btn" data-edit="' + esc(p.id) + '" aria-label="Editar ' + esc(p.name) + '" title="Editar"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg></button>' +
            '<button type="button" class="icon-btn icon-danger" data-del="' + esc(p.id) + '" aria-label="Eliminar ' + esc(p.name) + '" title="Eliminar">' + TRASH + '</button>' +
          '</td></tr>';
      }).join('');
    }
    filterTable();

    // Listas del formulario
    var cats = ['Zapatillas', 'Zapatos', 'Sandalias', 'Botas', 'Ojotas', 'Escolares', 'Deportivos', 'Accesorios'];
    S.data.products.forEach(function (p) { if (p.category && cats.indexOf(p.category) === -1) cats.push(p.category); });
    $('#catList').innerHTML = cats.sort(Z.natCmp).map(function (c) { return '<option value="' + esc(c) + '">'; }).join('');
    $('#f_brand').innerHTML = '<option value="">Sin marca</option>' + S.data.brands.map(function (b) {
      return '<option value="' + esc(b.name) + '">' + esc(b.name) + '</option>';
    }).join('');
  }
  var TRASH = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>';

  function filterTable() {
    var q = lower($('#tableSearch').value.trim());
    $$('#prodRows tr[data-search]').forEach(function (tr) { tr.hidden = !!q && tr.dataset.search.indexOf(q) === -1; });
  }
  $('#tableSearch').addEventListener('input', filterTable);

  function findProduct(id) { return S.data.products.filter(function (p) { return p.id === id; })[0]; }

  $('#prodRows').addEventListener('click', function (e) {
    var b;
    if ((b = e.target.closest('[data-edit]'))) { openProduct(findProduct(b.dataset.edit)); return; }
    if ((b = e.target.closest('[data-toggle]'))) {
      var id = b.dataset.toggle;
      run(b, '…', async function () {
        var p = findProduct(id);
        await commit((p.visible ? 'Ocultar' : 'Mostrar') + ' producto: ' + p.name, function (d) {
          d.products.forEach(function (x) { if (x.id === id) x.visible = !x.visible; });
        });
        showMsg('ok', 'Listo. ' + NOTE);
      });
      return;
    }
    if ((b = e.target.closest('[data-del]'))) {
      var p = findProduct(b.dataset.del);
      if (!p) return;
      var btnDel = b;
      ask({ title: '¿Eliminar producto?', text: 'Se va a eliminar «' + p.name + '» del catálogo. Esta acción no se puede deshacer.', ok: 'Sí, eliminar', danger: true })
        .then(function (ok) { if (ok) delProduct(p, btnDel); });
      return;
    }
  });
  function delProduct(p, b) {
      run(b, '…', async function () {
        await commit('Eliminar producto: ' + p.name, function (d) {
          d.products = d.products.filter(function (x) { return x.id !== p.id; });
          return function () { return deleteFile(p.image, 'Borrar foto de ' + p.name); };
        });
        showMsg('ok', 'Producto eliminado. ' + NOTE);
      });
  }

  /* ---------------- Formulario de producto ---------------- */
  var dlg = $('#productDialog'), form = $('#productForm');
  var sizeRows = $('#sizeRows'), instRows = $('#instRows'), stockIn = $('#f_stock'), priceIn = $('#f_price');
  var preview = $('#f_preview'), fileIn = $('#f_image');
  var dlgMsgs = document.createElement('div');
  dlgMsgs.id = 'dlgMsgs';
  $('.dlg-body').prepend(dlgMsgs);

  function row(html) {
    var d = document.createElement('div');
    d.className = 'row';
    d.innerHTML = html + '<button type="button" class="row-x" aria-label="Quitar">×</button>';
    return d;
  }
  function sizeRow(size, st) {
    var d = row('<input class="sz" placeholder="Talle" maxlength="10" aria-label="Talle">' +
                '<input class="st" placeholder="Stock" inputmode="numeric" aria-label="Stock del talle">');
    d.querySelector('.sz').value = size == null ? '' : size;
    d.querySelector('.st').value = st == null ? '' : st;
    sizeRows.appendChild(d);
    return d;
  }
  function instRow(n, amount) {
    var d = row('<input class="in" placeholder="Cuotas" inputmode="numeric" aria-label="Cantidad de cuotas">' +
                '<span class="x">x Gs.</span>' +
                '<input class="ia" placeholder="Monto de cada cuota" inputmode="numeric" aria-label="Monto de cada cuota">');
    var info = document.createElement('span');
    info.className = 'inst-info';
    d.appendChild(info);
    d.querySelector('.in').value = n == null ? '' : n;
    d.querySelector('.ia').value = amount == null ? '' : amount;
    instRows.appendChild(d);
    return d;
  }
  function recalc() {
    var rows = $$('.row', sizeRows).filter(function (r) { return r.querySelector('.sz').value.trim() !== ''; });
    if (rows.length) {
      stockIn.readOnly = true;
      stockIn.value = rows.reduce(function (t, r) { return t + num(r.querySelector('.st').value); }, 0);
      $('#stockHint').textContent = 'Suma de todos los talles';
    } else {
      stockIn.readOnly = false;
      $('#stockHint').textContent = '';
    }
  }
  function instInfo() {
    var p = num(priceIn.value);
    $$('.row', instRows).forEach(function (r) {
      var n = num(r.querySelector('.in').value), a = num(r.querySelector('.ia').value), out = r.querySelector('.inst-info');
      if (!n || !a) { out.textContent = ''; out.className = 'inst-info'; return; }
      var tot = n * a, txt = 'Total ' + money(tot);
      if (p) txt += tot <= p ? ' · sin interés' : ' · ' + ((tot - p) / p * 100).toFixed(1) + '% interés';
      out.textContent = txt;
      out.className = 'inst-info' + (p && tot <= p ? ' ok' : '');
    });
  }
  sizeRows.addEventListener('input', recalc);
  instRows.addEventListener('input', instInfo);
  priceIn.addEventListener('input', instInfo);

  dlg.addEventListener('click', function (e) {
    var x = e.target.closest('.row-x');
    if (x) { x.closest('.row').remove(); recalc(); instInfo(); return; }
    if ((e.target.closest('[data-close]') || e.target === dlg) && !S.busy) dlg.close();
  });
  dlg.addEventListener('cancel', function (e) { if (S.busy) e.preventDefault(); });
  $('#addSize').addEventListener('click', function () { sizeRow().querySelector('.sz').focus(); });
  $('#addInst').addEventListener('click', function () { instRow().querySelector('.in').focus(); });

  $$('[data-range]', dlg).forEach(function (b) {
    b.addEventListener('click', function () {
      var r = b.dataset.range.split('-').map(Number);
      $$('.row', sizeRows).forEach(function (rw) { if (!rw.querySelector('.sz').value.trim()) rw.remove(); });
      var have = {};
      $$('.sz', sizeRows).forEach(function (i) { have[i.value.trim()] = 1; });
      for (var s = r[0]; s <= r[1]; s++) if (!have[String(s)]) sizeRow(String(s), '0');
      $$('.row', sizeRows).sort(function (a, c) {
        return Z.natCmp(a.querySelector('.sz').value, c.querySelector('.sz').value);
      }).forEach(function (rw) { sizeRows.appendChild(rw); });
      recalc();
      var first = $('.st', sizeRows);
      if (first) first.focus();
    });
  });

  fileIn.addEventListener('change', function () {
    var f = fileIn.files[0];
    if (f) { preview.src = URL.createObjectURL(f); preview.hidden = false; }
  });

  function setVal(sel, v) {
    var el = $(sel), val = v == null ? '' : String(v);
    if (el.tagName === 'SELECT' && val !== '' && !$$('option', el).some(function (o) { return o.value === val; })) {
      el.add(new Option(val, val));
    }
    el.value = val;
  }

  function openProduct(p) {
    form.reset();
    dlgMsgs.innerHTML = '';
    sizeRows.innerHTML = '';
    instRows.innerHTML = '';
    $('#f_id').value = p ? p.id : '';
    $('#dlgTitle').textContent = p ? 'Editar producto' : 'Nuevo producto';
    if (p) {
      setVal('#f_name', p.name); setVal('#f_category', p.category); setVal('#f_gender', p.gender);
      setVal('#f_brand', p.brand); setVal('#f_colors', p.colors); setVal('#f_sku', p.sku); setVal('#f_code', p.code);
      setVal('#f_price', p.price); setVal('#f_stock', p.stock); setVal('#f_desc', p.description);
      (p.sizes || []).forEach(function (s) { sizeRow(s.size, s.stock); });
      (p.installments || []).forEach(function (i) { instRow(i.n, i.amount); });
      $('#f_visible').checked = !!p.visible;
    } else {
      $('#f_visible').checked = true;
    }
    if (p && p.image) { preview.src = imgUrl(p.image); preview.hidden = false; $('#removeWrap').hidden = false; }
    else { preview.removeAttribute('src'); preview.hidden = true; $('#removeWrap').hidden = true; }
    recalc(); instInfo();
    dlg.showModal();
    $('#f_name').focus();
  }
  $('#btnNew').addEventListener('click', function () { openProduct(null); });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var id = $('#f_id').value;
    var name = $('#f_name').value.trim(), category = $('#f_category').value.trim(), price = num(priceIn.value);
    if (!name || !category) return showMsg('error', 'Completá el nombre y la categoría.', '#dlgMsgs');
    if (price <= 0) return showMsg('error', 'Ingresá un precio mayor a cero.', '#dlgMsgs');

    var sizes = [], seen = {};
    $$('.row', sizeRows).forEach(function (r) {
      var sz = r.querySelector('.sz').value.trim().slice(0, 10);
      if (!sz || seen[sz]) return;
      seen[sz] = 1;
      sizes.push({ size: sz, stock: num(r.querySelector('.st').value) });
    });
    sizes.sort(function (a, b) { return Z.natCmp(a.size, b.size); });

    var inst = [], bad = false, byN = {};
    $$('.row', instRows).forEach(function (r) {
      var n = num(r.querySelector('.in').value), a = num(r.querySelector('.ia').value);
      if (!n && !a) return;
      if (n < 1 || n > 60 || a < 1) { bad = true; return; }
      byN[n] = { n: n, amount: a };
    });
    if (bad) return showMsg('error', 'Revisá las cuotas: cada una necesita cantidad (1 a 60) y monto.', '#dlgMsgs');
    Object.keys(byN).map(Number).sort(function (a, b) { return a - b; }).forEach(function (k) { inst.push(byN[k]); });

    var file = fileIn.files[0], remove = $('#f_remove').checked;
    var fields = {
      name: name, category: category, gender: $('#f_gender').value, brand: $('#f_brand').value,
      sku: $('#f_sku').value.trim(), code: $('#f_code').value.trim(), price: price,
      stock: sizes.length ? sizes.reduce(function (t, s) { return t + s.stock; }, 0) : num(stockIn.value),
      sizes: sizes, colors: $('#f_colors').value.trim(), description: $('#f_desc').value.trim(),
      installments: inst, visible: $('#f_visible').checked
    };

    run($('#saveBtn'), 'Guardando…', async function () {
      var newImg = file ? await uploadImage(file, 'img/productos', 'prod', 1000, false) : null;
      await commit((id ? 'Editar' : 'Agregar') + ' producto: ' + name, function (d) {
        var idx = -1;
        d.products.forEach(function (x, i) { if (x.id === id) idx = i; });
        if (id && idx < 0) throw new Error('Ese producto ya no existe. Recargá la página.');
        var old = idx >= 0 ? d.products[idx] : {};
        var image = old.image || '', oldImg = '';
        if (newImg) { oldImg = image; image = newImg; }
        else if (remove && image) { oldImg = image; image = ''; }
        var p = Object.assign({ id: old.id || rid() }, fields, {
          image: image,
          created_at: old.created_at || Math.floor(Date.now() / 1000),
          updated_at: Math.floor(Date.now() / 1000)
        });
        if (idx < 0) d.products.push(p); else d.products[idx] = p;
        return oldImg ? function () { return deleteFile(oldImg, 'Borrar foto anterior de ' + name); } : null;
      });
      dlg.close();
      showMsg('ok', (id ? 'Producto actualizado. ' : 'Producto agregado. ') + NOTE);
    });
  });

  /* ---------------- Marcas ---------------- */
  function renderBrandAdmin() {
    var counts = {};
    S.data.products.forEach(function (p) { var k = lower(p.brand); if (k) counts[k] = (counts[k] || 0) + 1; });
    var h = '<section class="panel brand-new"><h2>Agregar marca</h2>' +
      '<form class="stack" data-brand-form="">' +
      '<label class="fld"><span>Nombre</span><input name="name" required maxlength="60" placeholder="Ej: Vizzano"></label>' +
      '<label class="fld"><span>Logo (cuadrado se ve mejor)</span><input type="file" name="logo" accept="image/jpeg,image/png,image/webp,image/gif"></label>' +
      '<div><button class="btn btn-accent" type="submit">Agregar marca</button></div></form></section>';
    S.data.brands.forEach(function (b) {
      var n = counts[lower(b.name)] || 0;
      h += '<section class="panel brand-item"><form class="stack" data-brand-form="' + esc(b.id) + '">' +
        '<div class="brand-item-top">' +
        (b.logo ? '<img class="brand-logo-lg" src="' + esc(imgUrl(b.logo)) + '" alt="Logo de ' + esc(b.name) + '">'
                : '<span class="brand-logo-lg brand-logo-ph" aria-hidden="true">' + Z.initial(b.name) + '</span>') +
        '<div class="brand-item-info"><label class="fld"><span>Nombre</span><input name="name" value="' + esc(b.name) + '" required maxlength="60"></label>' +
        '<span class="hint">' + n + (n === 1 ? ' producto' : ' productos') + '</span></div></div>' +
        '<label class="fld"><span>Cambiar logo</span><input type="file" name="logo" accept="image/jpeg,image/png,image/webp,image/gif"></label>' +
        (b.logo ? '<label class="check"><input type="checkbox" name="remove_logo"> Quitar el logo</label>' : '') +
        '<div class="brand-item-actions"><button class="btn btn-secondary" type="submit">Guardar</button></div></form>' +
        '<div class="brand-del"><button type="button" class="icon-btn icon-danger" data-brand-del="' + esc(b.id) + '" aria-label="Eliminar marca ' + esc(b.name) + '" title="Eliminar marca">' + TRASH + '</button></div>' +
        '</section>';
    });
    $('#brandAdmin').innerHTML = h;
  }

  $('#brandAdmin').addEventListener('submit', function (e) {
    var f = e.target.closest('[data-brand-form]');
    if (!f) return;
    e.preventDefault();
    var id = f.dataset.brandForm, name = f.elements.name.value.trim();
    var file = f.elements.logo.files[0], remove = f.elements.remove_logo && f.elements.remove_logo.checked;
    if (!name) return showMsg('error', 'Escribí el nombre de la marca.');
    var dup = S.data.brands.some(function (b) { return b.id !== id && lower(b.name) === lower(name); });
    if (dup) return showMsg('error', 'Ya existe una marca llamada «' + name + '».');
    run(f.querySelector('button[type=submit]'), 'Guardando…', async function () {
      var newLogo = file ? await uploadImage(file, 'img/marcas', 'marca', 400, true) : null;
      await commit((id ? 'Editar' : 'Agregar') + ' marca: ' + name, function (d) {
        var b = id ? d.brands.filter(function (x) { return x.id === id; })[0] : null;
        if (id && !b) throw new Error('Esa marca ya no existe. Recargá la página.');
        var oldLogo = '';
        if (!b) { b = { id: rid(), name: name, logo: '' }; d.brands.push(b); }
        else if (b.name !== name) {
          d.products.forEach(function (p) { if (lower(p.brand) === lower(b.name)) p.brand = name; });
        }
        b.name = name;
        if (newLogo) { oldLogo = b.logo; b.logo = newLogo; }
        else if (remove && b.logo) { oldLogo = b.logo; b.logo = ''; }
        return oldLogo ? function () { return deleteFile(oldLogo, 'Borrar logo anterior de ' + name); } : null;
      });
      showMsg('ok', (id ? 'Marca actualizada. ' : 'Marca agregada. ') + NOTE);
    });
  });

  $('#brandAdmin').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-brand-del]');
    if (!btn) return;
    var b = S.data.brands.filter(function (x) { return x.id === btn.dataset.brandDel; })[0];
    if (!b) return;
    ask({ title: '¿Eliminar marca?', text: 'Se va a eliminar la marca «' + b.name + '». Los productos no se borran; solo deja de aparecer el logo.', ok: 'Sí, eliminar', danger: true })
      .then(function (ok) { if (ok) delBrand(b, btn); });
  });
  function delBrand(b, btn) {
    run(btn, '…', async function () {
      await commit('Eliminar marca: ' + b.name, function (d) {
        d.brands = d.brands.filter(function (x) { return x.id !== b.id; });
        return function () { return deleteFile(b.logo, 'Borrar logo de ' + b.name); };
      });
      showMsg('ok', 'Marca eliminada. ' + NOTE);
    });
  }

  /* ---------------- Configuración ---------------- */
  function renderConfig() {
    var st = S.data.store;
    $('#cName').value = st.store_name; $('#cTag').value = st.tagline;
    $('#cAddr').value = st.address; $('#cWa').value = st.whatsapp;
    $('#logoInput').value = ''; $('#logoRemove').checked = false;
    if (st.logo) { $('#logoPreview').src = imgUrl(st.logo); $('#logoPreview').hidden = false; $('#logoRemoveWrap').hidden = false; }
    else { $('#logoPreview').removeAttribute('src'); $('#logoPreview').hidden = true; $('#logoRemoveWrap').hidden = true; }
    $('#kUser').value = S.user;
  }
  $('#logoInput').addEventListener('change', function () {
    var f = this.files[0];
    if (f) { $('#logoPreview').src = URL.createObjectURL(f); $('#logoPreview').hidden = false; }
  });

  $('#storeForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('#cName').value.trim(), wa = $('#cWa').value.replace(/\D/g, '');
    if (!name) return showMsg('error', 'El nombre de la tienda no puede quedar vacío.');
    if (wa && (wa.length < 8 || wa.length > 15)) return showMsg('error', 'El número de WhatsApp no parece válido. Escribilo con código de país, ej: 595981234567.');
    var file = $('#logoInput').files[0], remove = $('#logoRemove').checked;
    run($('#storeForm button'), 'Guardando…', async function () {
      var newLogo = file ? await uploadImage(file, 'img/tienda', 'logo', 400, true) : null;
      await commit('Actualizar datos de la tienda', function (d) {
        var s = d.store, oldLogo = '';
        s.store_name = name; s.tagline = $('#cTag').value.trim(); s.address = $('#cAddr').value.trim(); s.whatsapp = wa;
        if (newLogo) { oldLogo = s.logo; s.logo = newLogo; }
        else if (remove && s.logo) { oldLogo = s.logo; s.logo = ''; }
        return oldLogo ? function () { return deleteFile(oldLogo, 'Borrar logo anterior'); } : null;
      });
      showMsg('ok', 'Datos de la tienda guardados. ' + NOTE);
    });
  });

  async function checkCurrent(pass) {
    try { await openToken(S.user, pass, S.auth); return true; } catch (e) { return false; }
  }

  $('#credForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var user = $('#kUser').value.trim(), pass = $('#kPass').value, pass2 = $('#kPass2').value, cur = $('#kCur').value;
    if (!USER_RE.test(user)) return showMsg('error', 'El usuario debe tener entre 3 y 40 caracteres: letras, números, punto, guion, guion bajo o @ (sin espacios).');
    if (pass && pass.length < 8) return showMsg('error', 'La nueva contraseña debe tener al menos 8 caracteres.');
    if (pass !== pass2) return showMsg('error', 'Las contraseñas nuevas no coinciden.');
    if (!pass && user === S.user) return showMsg('error', 'No hay cambios: escribí un usuario nuevo o una contraseña nueva.');
    if (!connected()) return showMsg('error', NEED_CONN);
    run($('#credForm button'), 'Guardando…', async function () {
      if (!(await checkCurrent(cur))) throw new Error('La contraseña actual no es correcta.');
      var auth = Object.assign({}, S.auth, await sealToken(user, pass || cur, S.token), { is_default: false });
      await saveAuth(auth, null, 'Cambiar usuario o contraseña del panel');
      S.user = user;
      remember();
      $('#credForm').reset();
      $('#kUser').value = user;
      renderAll();
      showMsg('ok', 'Usuario y contraseña actualizados. Empiezan a valer en 1 o 2 minutos; hasta entonces puede seguir funcionando la contraseña anterior.');
    });
  });

  init();
})();
