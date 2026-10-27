/* =================================================================
   Ventas rápidas (punto de venta), historial, compras y facturación
   - Lector de código de barras USB/Bluetooth (funciona como teclado)
     y cámara del teléfono.
   - Ventas, compras y datos de facturación se guardan CIFRADOS.
   - Cada venta se guarda en segundo plano: se puede seguir vendiendo.
   ================================================================= */
(function () {
  'use strict';
  var A = window.ZA;
  if (!A) return;
  var S = A.S, $ = A.$, $$ = A.$$, esc = A.esc, money = A.money, num = A.num, lower = A.lower;

  var TRASH_ICON = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>';
  var AJ_PATH = 'data/privado/ajustes.json';
  var CAJA_PATH = 'data/privado/cajas.json';
  var PAY = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', qr: 'QR / billetera' };
  var P = { ajustes: null, months: {}, loading: null };
  var cart = [], payMethod = 'efectivo', docType = 'ticket';
  var client = { tipo: 'innominado', doc: '', dv: '', nombre: '', email: '', tel: '' };
  var failedPaths = {}, failedMsg = '';

  /* ---------------- utilidades ---------------- */
  function pad(n, len) { return String(n).padStart(len, '0'); }
  function monthKey(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2); }
  function monthPath(m) { return 'data/privado/mov-' + m + '.json'; }
  function todayISO() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2); }
  function fmtDate(iso, withTime) {
    var d = new Date(iso);
    var s = pad(d.getDate(), 2) + '/' + pad(d.getMonth() + 1, 2) + '/' + d.getFullYear();
    return withTime ? s + ' ' + pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2) : s;
  }
  function defaultAjustes() {
    return {
      fiscal: { ruc: '', razon: '', fantasia: '', direccion: '', telefono: '', actividad: '', timbrado: '', vigencia: '', est: '001', pto: '001' },
      next: 1,
      ticket: { auto: false, ancho: 80 },
      correo: { service: '', template: '', key: '', auto: true, tickets: false },
      factuflex: { activo: false, url: 'https://login.flexpdv.app:8444/FactuFlex/api', usuario: '', clave: '' }
    };
  }
  function products() { return S.data ? S.data.products : []; }
  function findP(id) { return products().filter(function (p) { return p.id === id; })[0]; }
  function hasSizes(p) { return !!(p.sizes && p.sizes.length); }
  function availFor(p, talle) {
    if (hasSizes(p)) {
      var s = p.sizes.filter(function (x) { return String(x.size) === String(talle); })[0];
      return s ? (+s.stock || 0) : 0;
    }
    return +p.stock || 0;
  }
  function inCart(pid, talle) {
    return cart.reduce(function (t, l) { return t + (l.pid === pid && l.talle === String(talle) ? l.qty : 0); }, 0);
  }
  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime || 'application/octet-stream' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* Separador de miles en campos .js-num de este módulo */
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (!el.classList || !el.classList.contains('js-num')) return;
    var digitsBefore = el.value.slice(0, el.selectionStart || 0).replace(/\D/g, '').length;
    var f = A.fmtNum(el.value);
    if (f === el.value) return;
    el.value = f;
    var i = 0, c = 0;
    while (i < f.length && c < digitsBefore) { if (/\d/.test(f.charAt(i))) c++; i++; }
    try { el.setSelectionRange(i, i); } catch (err) { /* nada */ }
  }, true);

  /* ---------------- datos privados (cifrados) ---------------- */
  A.fileSources[AJ_PATH] = async function () { return JSON.stringify(await A.encryptJSON(P.ajustes)) + '\n'; };
  A.fileSources[CAJA_PATH] = async function () { return JSON.stringify(await A.encryptJSON(P.caja)) + '\n'; };
  function ensureMonthSource(m) {
    var path = monthPath(m);
    if (!A.fileSources[path]) {
      A.fileSources[path] = async function () { return JSON.stringify(await A.encryptJSON(P.months[m])) + '\n'; };
    }
  }
  async function readPrivate(path) {
    var f = await A.getFile(path);
    if (!f) return null;
    var box;
    if (f.content && f.encoding === 'base64') {
      box = A.decodeJsonFile(f);
    } else {
      // archivo de más de 1 MB: se pide el contenido en crudo
      var r = await fetch('https://api.github.com/repos/' + encodeURIComponent(S.repo.owner) + '/' + encodeURIComponent(S.repo.repo) +
        '/contents/' + path + '?ref=' + encodeURIComponent(S.repo.branch),
        { headers: { 'Accept': 'application/vnd.github.raw+json', 'Authorization': 'Bearer ' + S.token }, cache: 'no-store' });
      if (!r.ok) throw new Error('No se pudo leer ' + path);
      box = await r.json();
    }
    try {
      return await A.decryptJSON(box);
    } catch (e) {
      throw new Error('No se pudieron abrir los datos privados. Cerrá sesión y volvé a entrar.');
    }
  }
  function loadPrivate() {
    if (!A.connected()) return Promise.reject(new Error(A.NEED_CONN));
    if (P.loading) return P.loading;
    var m = monthKey();
    P.loading = (async function () {
      var res = await Promise.all([readPrivate(AJ_PATH), readPrivate(monthPath(m)), readPrivate(CAJA_PATH)]);
      var d = defaultAjustes(), aj = res[0] || {};
      P.ajustes = Object.assign(d, aj, {
        fiscal: Object.assign(d.fiscal, aj.fiscal || {}),
        ticket: Object.assign(d.ticket, aj.ticket || {}),
        correo: Object.assign(d.correo, aj.correo || {}),
        factuflex: Object.assign(d.factuflex, aj.factuflex || {})
      });
      P.months[m] = res[1] || { ventas: [], compras: [] };
      P.caja = Object.assign({ abierta: null, cierres: [] }, res[2] || {});
      ensureMonthSource(m);
      if (A.V && A.V.hooks.cajaWarn) A.V.hooks.cajaWarn();
      fillFiscalForm();
      fillMailForm();
      fillFfForm();
      return true;
    })();
    P.loading.catch(function () { P.loading = null; });
    return P.loading;
  }
  async function loadMonth(m) {
    await loadPrivate();
    if (!P.months[m]) {
      P.months[m] = (await readPrivate(monthPath(m))) || { ventas: [], compras: [] };
      P.months[m].ventas = P.months[m].ventas || [];
      P.months[m].compras = P.months[m].compras || [];
      ensureMonthSource(m);
    }
    return P.months[m];
  }

  /* Guarda en segundo plano; si falla, queda para reintentar */
  function save(paths, message) {
    return A.writeFiles(paths, message).catch(function (e) {
      paths.forEach(function (p) { failedPaths[p] = 1; });
      failedMsg = e.message || String(e);
      renderSaveState();
    });
  }
  function retrySave() {
    var paths = Object.keys(failedPaths);
    if (!paths.length) return;
    failedPaths = {}; failedMsg = '';
    renderSaveState();
    save(paths, 'Reintentar guardado');
  }
  function renderSaveState() {
    var el = $('#saveState');
    if (!el) return;
    var n = A.pending();
    if (Object.keys(failedPaths).length) {
      el.className = 'save-state is-error';
      el.innerHTML = 'No se pudo guardar: ' + esc(failedMsg) + ' <button type="button" class="link-btn" id="retrySave">Reintentar</button>';
    } else if (n > 0) {
      el.className = 'save-state is-saving';
      el.innerHTML = '<span class="spin" aria-hidden="true"></span> Guardando…';
    } else {
      el.className = 'save-state is-ok';
      el.textContent = 'Todo guardado';
    }
  }
  A.on('saving', renderSaveState);
  document.addEventListener('click', function (e) { if (e.target.closest('#retrySave')) retrySave(); });
  window.addEventListener('beforeunload', function (e) {
    if (A.pending() > 0 || Object.keys(failedPaths).length) { e.preventDefault(); e.returnValue = ''; }
  });

  /* Mueve stock: sign -1 vende, +1 devuelve o compra */
  function applyStock(items, sign) {
    items.forEach(function (it) {
      var p = findP(it.product_id);
      if (!p) return;
      if (hasSizes(p) || (it.talle !== '' && sign > 0)) {
        p.sizes = p.sizes || [];
        var s = p.sizes.filter(function (x) { return String(x.size) === String(it.talle); })[0];
        if (!s) {
          if (sign < 0) return;
          s = { size: String(it.talle), stock: 0 };
          p.sizes.push(s);
          p.sizes.sort(function (a, b) { return Z.natCmp(a.size, b.size); });
        }
        s.stock = Math.max(0, (+s.stock || 0) + sign * it.cantidad);
        p.stock = p.sizes.reduce(function (t, x) { return t + (+x.stock || 0); }, 0);
      } else {
        p.stock = Math.max(0, (+p.stock || 0) + sign * it.cantidad);
      }
      p.updated_at = Math.floor(Date.now() / 1000);
    });
  }

  /* ---------------- búsqueda de productos ---------------- */
  function searchProducts(q, limit) {
    var words = lower(q).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return products().filter(function (p) {
      var hay = lower([p.name, p.brand, p.code, p.sku, p.category, p.colors].concat(p.codes || []).join(' '));
      return words.every(function (w) { return hay.indexOf(w) !== -1; });
    }).slice(0, limit || 8);
  }
  /* ---------- Lectura de códigos de barras ----------
     Compara sin espacios, guiones ni puntos, y tolera las diferencias típicas de los lectores:
     ceros adelante (UPC de 12 vs EAN de 13 dígitos) y códigos guardados sin el dígito verificador. */
  function normCode(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^0-9a-z]/g, ''); }
  function noZeros(s) { return s.replace(/^0+/, ''); }
  function validCheck(d) {
    if (!/^\d{8}$|^\d{12,14}$/.test(d)) return false;
    var sum = 0, n = d.length;
    for (var i = 0; i < n - 1; i++) sum += (+d.charAt(n - 2 - i)) * (i % 2 === 0 ? 3 : 1);
    return (10 - sum % 10) % 10 === +d.charAt(n - 1);
  }
  function codesOf(p) { return [p.code, p.sku].concat(p.codes || []).map(normCode).filter(Boolean); }
  function exactCode(q) {
    var k = normCode(q);
    if (!k) return null;
    var all = products(), digits = /^\d+$/.test(k);
    var pass = [
      function (c) { return c === k; },
      function (c) { return digits && /^\d+$/.test(c) && noZeros(c) === noZeros(k); },
      function (c) { return digits && validCheck(k) && /^\d+$/.test(c) && c.length >= 6 && noZeros(c) === noZeros(k.slice(0, -1)); }
    ];
    for (var i = 0; i < pass.length; i++) {
      var hit = all.filter(function (p) { return codesOf(p).some(pass[i]); });
      if (hit.length) return hit[0];
    }
    return null;
  }
  function thumb(p) {
    return p.image ? '<img class="pick-img" src="' + esc(A.imgUrl(p.image)) + '" alt="">'
                   : '<span class="pick-img pick-ph">' + Z.shoe(22) + '</span>';
  }
  function makePicker(input, box, onPick, onEmptyEnter, onNotFound) {
    var items = [], sel = 0;
    function render() {
      var q = input.value.trim();
      if (!items.length) {
        box.hidden = !q;
        box.innerHTML = q ? '<div class="pick-empty">Sin resultados para «' + esc(q) + '»</div>' : '';
        return;
      }
      box.hidden = false;
      box.innerHTML = items.map(function (p, i) {
        var st = Z.stockOf(p);
        return '<button type="button" class="pick' + (i === sel ? ' is-sel' : '') + '" data-i="' + i + '" tabindex="-1">' + thumb(p) +
          '<span class="pick-txt"><strong>' + esc(p.name) + '</strong><small>' +
          esc([p.brand, p.code ? 'Cód. ' + p.code : '', hasSizes(p) ? 'Talles ' + p.sizes.map(function (s) { return s.size; }).join(', ') : ''].filter(Boolean).join(' · ')) +
          '</small></span><span class="pick-right"><strong>' + money(p.price) + '</strong><small class="' + (st <= 0 ? 't-out' : '') + '">Stock ' + st + '</small></span></button>';
      }).join('');
    }
    function close() { items = []; box.hidden = true; box.innerHTML = ''; }
    function pick(p) { close(); input.value = ''; onPick(p); }
    input.addEventListener('input', function () { items = searchProducts(input.value); sel = 0; render(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' && items.length) { sel = (sel + 1) % items.length; render(); e.preventDefault(); }
      else if (e.key === 'ArrowUp' && items.length) { sel = (sel - 1 + items.length) % items.length; render(); e.preventDefault(); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        var q = input.value.trim();
        if (!q) { if (onEmptyEnter) onEmptyEnter(); return; }
        var ex = exactCode(q);
        if (ex) { pick(ex); return; }
        if (!items.length) items = searchProducts(q);
        if (items.length) { pick(items[sel] || items[0]); return; }
        if (onNotFound) onNotFound(q);
        input.select();
      } else if (e.key === 'Escape') { input.value = ''; close(); }
    });
    box.addEventListener('mousedown', function (e) {
      var b = e.target.closest('[data-i]');
      if (b) { e.preventDefault(); pick(items[+b.dataset.i]); }
    });
    input.addEventListener('blur', function () { setTimeout(function () { if (document.activeElement !== input) box.hidden = true; }, 150); });
    input.addEventListener('focus', function () { if (input.value.trim()) render(); });
    return {
      byCode: function (code) {
        var ex = exactCode(code);
        if (ex) { pick(ex); return true; }
        return false;
      }
    };
  }

  /* =================================================================
     VENDER
     ================================================================= */
  var posQ = $('#posQ'), paidIn = $('#posPaid');
  /* Devuelve el cursor al buscador (también después de cerrar ventanas) */
  function focusQ() { setTimeout(function () { posQ.blur(); posQ.focus(); }, 0); }
  var flashTimer;
  function flash(type, text) {
    var el = $('#posFlash');
    el.className = 'pos-flash is-' + type;
    el.textContent = text;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { el.textContent = ''; el.className = 'pos-flash'; }, type === 'error' ? 6000 : 2500);
    if (type === 'error') beep();
  }
  var audioCtx;
  function beep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      var o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = 220; g.gain.value = 0.08;
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + 0.18);
    } catch (e) { /* sin sonido */ }
  }

  var posPicker = makePicker(posQ, $('#posResults'), addToCart,
    function () { charge(); },
    function (q) {
      // se vacía el buscador para que el próximo escaneo no se pegue al anterior
      posQ.value = ''; $('#posResults').hidden = true;
      if (/^[0-9a-z\-.\s]{4,}$/i.test(q) && /\d{4,}/.test(q)) assignCode(q); else flash('error', 'No se encontró ningún producto con «' + q + '».');
    });

  /* Código escaneado que no existe: se elige el producto y el código queda guardado en él */
  function assignCode(code) {
    code = String(code).trim().replace(/\s+/g, '');
    var d = $('#codeDlg'), q = $('#codeQ'), list = $('#codeList');
    $('#codeVal').textContent = code;
    q.value = '';
    function render() {
      var items = q.value.trim() ? searchProducts(q.value, 8) : products().slice().sort(function (a, b) { return (b.updated_at || 0) - (a.updated_at || 0); }).slice(0, 6);
      list.innerHTML = items.length ? items.map(function (p) {
        return '<button type="button" class="pick" data-cp="' + esc(p.id) + '">' + thumb(p) + '<span class="pick-txt"><strong>' + esc(p.name) + '</strong><small>' +
          esc([p.brand, p.code ? 'Código actual: ' + p.code : 'Sin código'].filter(Boolean).join(' · ')) + '</small></span></button>';
      }).join('') : '<div class="pick-empty">Sin resultados</div>';
    }
    function done() { list.onclick = null; q.oninput = null; d.oncancel = null; $('#codeCancel').onclick = null; if (d.open) d.close(); focusQ(); }
    q.oninput = render;
    list.onclick = function (e) {
      var b = e.target.closest('[data-cp]');
      if (!b) return;
      var p = findP(b.dataset.cp);
      if (!p) return;
      if (!p.code) p.code = code;
      else if (codesOf(p).indexOf(normCode(code)) === -1) p.codes = (p.codes || []).concat(code);
      p.updated_at = Math.floor(Date.now() / 1000);
      A.renderAll();
      save([A.DATA_PATH], 'Código ' + code + ' asignado a ' + p.name);
      done();
      flash('ok', 'Listo: el código ' + code + ' ahora es de «' + p.name + '».');
      addToCart(p);
    };
    $('#codeCancel').onclick = done;
    d.oncancel = function (e) { e.preventDefault(); done(); };
    render();
    d.showModal();
    q.focus();
  }

  function addToCart(p) {
    if (hasSizes(p)) {
      chooseSize(p).then(function (t) { if (t != null) addLine(p, t); else focusQ(); });
    } else {
      addLine(p, '');
    }
  }
  function addLine(p, talle) {
    talle = String(talle);
    if (inCart(p.id, talle) + 1 > availFor(p, talle)) {
      flash('error', 'Sin stock' + (talle ? ' del talle ' + talle : '') + ' de «' + p.name + '». Cargalo en Compras.');
      focusQ();
      return;
    }
    var line = cart.filter(function (l) { return l.pid === p.id && l.talle === talle; })[0];
    if (line) {
      line.qty++;
      cart.splice(cart.indexOf(line), 1);
      cart.unshift(line);
    } else {
      cart.unshift({ pid: p.id, name: p.name, code: p.code || p.sku || '', talle: talle, qty: 1, price: +p.price || 0, iva: p.iva == null ? 10 : +p.iva });
    }
    flash('ok', 'Agregado: ' + p.name + (talle ? ' · talle ' + talle : ''));
    renderCart();
    focusQ();
  }

  function chooseSize(p) {
    return new Promise(function (resolve) {
      var d = $('#sizeDlg'), box = $('#sizePick');
      $('#sizeName').textContent = p.name + ' · ' + money(p.price);
      box.innerHTML = p.sizes.map(function (s) {
        var left = (+s.stock || 0) - inCart(p.id, String(s.size));
        return '<button type="button" class="size-opt" data-size="' + esc(s.size) + '"' + (left <= 0 ? ' disabled' : '') + '>' +
          '<strong>' + esc(s.size) + '</strong><small>' + (left > 0 ? left + ' disp.' : 'sin stock') + '</small></button>';
      }).join('');
      function done(v) {
        box.onclick = null; d.oncancel = null; $('#sizeCancel').onclick = null; box.onkeydown = null;
        if (d.open) d.close();
        resolve(v);
      }
      box.onclick = function (e) { var b = e.target.closest('[data-size]'); if (b && !b.disabled) done(b.dataset.size); };
      box.onkeydown = function (e) {
        var btns = $$('.size-opt:not([disabled])', box), i = btns.indexOf(document.activeElement);
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); (btns[i + 1] || btns[0]).focus(); }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); (btns[i - 1] || btns[btns.length - 1]).focus(); }
      };
      $('#sizeCancel').onclick = function () { done(null); };
      d.oncancel = function (e) { e.preventDefault(); done(null); };
      d.showModal();
      var first = $('.size-opt:not([disabled])', box);
      if (first) first.focus(); else $('#sizeCancel').focus();
    });
  }

  function totals(lines) {
    var t = { total: 0, gravada10: 0, gravada5: 0, exenta: 0 };
    lines.forEach(function (l) {
      var sub = (l.qty != null ? l.qty : l.cantidad) * (l.price != null ? l.price : l.precio);
      t.total += sub;
      if (+l.iva === 10) t.gravada10 += sub; else if (+l.iva === 5) t.gravada5 += sub; else t.exenta += sub;
    });
    t.iva10 = Math.round(t.gravada10 / 11);
    t.iva5 = Math.round(t.gravada5 / 21);
    return t;
  }

  function renderCart() {
    var rows = $('#cartRows');
    $('#cartEmpty').hidden = cart.length > 0;
    rows.innerHTML = cart.map(function (l, i) {
      return '<div class="cart-row" data-line="' + i + '">' +
        '<div class="cart-prod"><strong>' + esc(l.name) + '</strong><small>' +
        esc([l.talle ? 'Talle ' + l.talle : '', l.code ? 'Cód. ' + l.code : '', money(l.price) + ' c/u'].filter(Boolean).join(' · ')) + '</small></div>' +
        '<div class="qty"><button type="button" data-q="-1" aria-label="Uno menos">−</button>' +
        '<input value="' + l.qty + '" inputmode="numeric" aria-label="Cantidad" data-qin>' +
        '<button type="button" data-q="1" aria-label="Uno más">+</button></div>' +
        '<div class="cart-sub"><strong>' + money(l.qty * l.price) + '</strong>' +
        '<button type="button" class="row-x" data-rm aria-label="Quitar ' + esc(l.name) + '">×</button></div></div>';
    }).join('');
    updateTotals();
  }
  function setQty(i, q) {
    var l = cart[i];
    if (!l) return;
    var p = findP(l.pid);
    q = Math.max(0, Math.floor(q));
    if (q === 0) { cart.splice(i, 1); renderCart(); return; }
    var other = inCart(l.pid, l.talle) - l.qty;
    var max = p ? availFor(p, l.talle) - other : q;
    if (q > max) { flash('error', 'Solo hay ' + Math.max(0, max) + ' disponible(s) de «' + l.name + '»' + (l.talle ? ' talle ' + l.talle : '') + '.'); q = Math.max(1, max); }
    l.qty = q;
    renderCart();
  }
  $('#cartRows').addEventListener('click', function (e) {
    var row = e.target.closest('[data-line]');
    if (!row) return;
    var i = +row.dataset.line, b;
    if ((b = e.target.closest('[data-q]'))) setQty(i, cart[i].qty + Number(b.dataset.q));
    else if (e.target.closest('[data-rm]')) { cart.splice(i, 1); renderCart(); focusQ(); }
  });
  $('#cartRows').addEventListener('change', function (e) {
    if (e.target.matches('[data-qin]')) setQty(+e.target.closest('[data-line]').dataset.line, num(e.target.value));
  });

  function updateTotals() {
    var t = totals(cart);
    $('#posTotal').textContent = money(t.total);
    renderQuickCash(t.total);
    updateChange();
  }
  function renderQuickCash(total) {
    var opts = [];
    if (total > 0) {
      opts.push({ v: total, l: 'Exacto' });
      [10000, 50000, 100000].forEach(function (r) {
        var v = Math.ceil(total / r) * r;
        if (v > total && !opts.some(function (o) { return o.v === v; })) opts.push({ v: v, l: money(v) });
      });
      opts = opts.slice(0, 4);
    }
    $('#quickCash').innerHTML = opts.map(function (o) {
      return '<button type="button" data-cash="' + o.v + '">' + esc(o.l) + '</button>';
    }).join('');
  }
  function updateChange() {
    var total = totals(cart).total, paid = num(paidIn.value);
    var el = $('#posChange');
    if (!paid) { el.textContent = money(0); el.classList.remove('is-neg'); return; }
    var ch = paid - total;
    el.textContent = ch < 0 ? 'Faltan ' + money(-ch) : money(ch);
    el.classList.toggle('is-neg', ch < 0);
  }
  paidIn.addEventListener('input', updateChange);
  paidIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); charge(); } });
  $('#quickCash').addEventListener('click', function (e) {
    var b = e.target.closest('[data-cash]');
    if (!b) return;
    paidIn.value = A.fmtNum(b.dataset.cash);
    updateChange();
    $('#posCharge').focus();
  });

  $$('[data-pay]').forEach(function (b) {
    b.addEventListener('click', function () {
      payMethod = b.dataset.pay;
      $$('[data-pay]').forEach(function (x) { x.classList.toggle('on', x === b); });
      $('#cashBox').hidden = payMethod !== 'efectivo';
      $('#transferBox').hidden = payMethod !== 'transferencia';
      if (payMethod !== 'efectivo') paidIn.value = '';
      updateChange();
      if (payMethod === 'transferencia' && b.isConnected && document.activeElement === b) $('#tBank').focus();
    });
  });

  ['#tBank', '#tRef', '#tFrom'].forEach(function (id, i, all) {
    $(id).addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (i < all.length - 1) $(all[i + 1]).focus(); else charge();
    });
  });

  /* Dígito verificador del RUC paraguayo (módulo 11) */
  function rucDv(num) {
    var d = String(num).replace(/\D/g, ''), total = 0, k = 2;
    for (var i = d.length - 1; i >= 0; i--) { total += +d.charAt(i) * k; k = k < 11 ? k + 1 : 2; }
    var r = total % 11;
    return r > 1 ? 11 - r : 0;
  }

  /* Ticket o factura electrónica */
  function fiscalReady() { var f = P.ajustes && P.ajustes.fiscal; return ffReady() || !!(f && f.ruc && f.timbrado); }
  function setDoc(t) {
    docType = t;
    $$('[data-doc]').forEach(function (b) { b.classList.toggle('on', b.dataset.doc === t); });
    $('#posCharge').firstChild.textContent = t === 'factura' ? 'Cobrar y facturar ' : 'Cobrar ';
  }
  $$('[data-doc]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.dataset.doc === 'factura') {
        if (!fiscalReady()) { flash('error', 'Para emitir facturas cargá el RUC y el timbrado en Configuración → Datos para factura electrónica.'); focusQ(); return; }
        setDoc('factura');
        if (client.tipo === 'innominado') {
          client.tipo = 'ruc';
          $('#clientForm').hidden = false;
          renderClient();
          $('#cDoc').focus();
          flash('ok', 'Cargá el RUC o la cédula del cliente para la factura.');
        }
      } else {
        setDoc('ticket');
        focusQ();
      }
    });
  });

  /* Cliente */
  function renderClient() {
    var label = 'Consumidor final';
    if (client.tipo !== 'innominado' && client.doc) {
      label = (client.nombre || 'Cliente') + ' · ' + (client.tipo === 'ruc' ? 'RUC ' : 'CI ') + client.doc + (client.dv ? '-' + client.dv : '');
    }
    $('#clientBtn').textContent = label;
    $$('[data-ctype]').forEach(function (b) { b.classList.toggle('on', b.dataset.ctype === client.tipo); });
    $('#clientFields').hidden = client.tipo === 'innominado';
    $('#cDoc').placeholder = client.tipo === 'ruc' ? 'RUC con DV (80012345-6)' : 'Número de cédula';
  }
  $('#clientBtn').addEventListener('click', function () {
    $('#clientForm').hidden = !$('#clientForm').hidden;
    if (!$('#clientForm').hidden) renderClient();
  });
  $$('[data-ctype]').forEach(function (b) {
    b.addEventListener('click', function () {
      client.tipo = b.dataset.ctype;
      renderClient();
      if (client.tipo !== 'innominado') $('#cDoc').focus();
    });
  });
  function readClient() {
    if (client.tipo === 'innominado') { client.doc = client.dv = client.nombre = client.email = ''; client.tel = $('#cTel').value.trim(); return; }
    var raw = $('#cDoc').value.trim().replace(/[.\s]/g, '');
    var m = raw.match(/^(\d+)-?(\d)?$/);
    if (client.tipo === 'ruc' && m && m[2] != null) { client.doc = m[1]; client.dv = m[2]; }
    else { client.doc = raw.replace(/-/g, ''); client.dv = ''; }
    client.nombre = $('#cName').value.trim();
    client.email = $('#cMail').value.trim();
    client.tel = $('#cTel').value.trim();
  }
  $('#clientOk').addEventListener('click', function () {
    readClient();
    $('#clientForm').hidden = true;
    renderClient();
    focusQ();
  });
  ['#cDoc', '#cName', '#cMail', '#cTel'].forEach(function (id) {
    $(id).addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('#clientOk').click(); } });
  });

  function resetSale() {
    cart = [];
    paidIn.value = '';
    client = { tipo: 'innominado', doc: '', dv: '', nombre: '', email: '', tel: '' };
    $('#cDoc').value = ''; $('#cName').value = ''; $('#cMail').value = ''; $('#cTel').value = '';
    setDoc('ticket');
    $('#tBank').value = ''; $('#tRef').value = ''; $('#tFrom').value = '';
    $('#clientForm').hidden = true;
    renderClient();
    $$('[data-pay]')[0].click();
    renderCart();
  }

  /* Cobrar */
  var charging = false;
  async function charge() {
    if (charging) return;
    if (!cart.length) { flash('error', 'Agregá al menos un producto.'); focusQ(); return; }
    if (!A.connected()) { flash('error', A.NEED_CONN); return; }
    if (!$('#clientForm').hidden) readClient();
    if (client.tipo !== 'innominado' && !client.doc) { flash('error', 'Completá el documento del cliente o elegí "Sin nombre".'); $('#clientForm').hidden = false; $('#cDoc').focus(); return; }
    if (client.tipo === 'ruc' && !client.dv) { flash('error', 'Escribí el RUC con su dígito verificador (ej.: 80012345-6).'); $('#clientForm').hidden = false; $('#cDoc').focus(); return; }
    if (client.tipo === 'ruc' && rucDv(client.doc) !== +client.dv) {
      flash('error', 'El RUC ' + client.doc + '-' + client.dv + ' no es válido: el dígito verificador debería ser ' + rucDv(client.doc) + '. Revisalo.');
      $('#clientForm').hidden = false; $('#cDoc').focus(); return;
    }

    if (docType === 'factura') {
      if (!fiscalReady()) { flash('error', 'Faltan el RUC y el timbrado en Configuración → Datos para factura electrónica.'); return; }
      if (client.tipo === 'innominado') { flash('error', 'La factura necesita el RUC o la cédula del cliente.'); client.tipo = 'ruc'; $('#clientForm').hidden = false; renderClient(); $('#cDoc').focus(); return; }
    }
    var transfer = null;
    if (payMethod === 'transferencia') {
      transfer = { banco: $('#tBank').value.trim(), comprobante: $('#tRef').value.trim(), remitente: $('#tFrom').value.trim() };
      if (!transfer.banco) { flash('error', 'Escribí el banco de la transferencia.'); $('#tBank').focus(); return; }
      if (!transfer.comprobante) { flash('error', 'Escribí el número de comprobante.'); $('#tRef').focus(); return; }
      if (!transfer.remitente) { flash('error', 'Escribí el nombre de quien envió la transferencia.'); $('#tFrom').focus(); return; }
    }
    try { await loadPrivate(); } catch (e) { flash('error', e.message); return; }
    var cajaId = A.V.hooks.cajaFor ? A.V.hooks.cajaFor(payMethod) : null;
    if (!cajaId) {
      flash('error', 'La caja de ' + (payMethod === 'transferencia' ? 'transferencias' : 'efectivo') + ' está cerrada. Abrila en la pestaña Caja para poder cobrar.');
      if (A.V.hooks.cajaWarn) A.V.hooks.cajaWarn();
      return;
    }
    var t = totals(cart);
    var paid = payMethod === 'efectivo' ? (num(paidIn.value) || t.total) : t.total;
    if (paid < t.total) { flash('error', 'El monto recibido es menor al total.'); paidIn.focus(); return; }

    charging = true;
    var btn = $('#posCharge');
    btn.disabled = true;
    try {
      var m = monthKey();
      await loadMonth(m);

      // Control final de stock
      for (var i = 0; i < cart.length; i++) {
        var l = cart[i], p = findP(l.pid);
        if (!p) throw new Error('«' + l.name + '» ya no existe en productos.');
        if (inCart(l.pid, l.talle) > availFor(p, l.talle)) throw new Error('No alcanza el stock de «' + l.name + '»' + (l.talle ? ' talle ' + l.talle : '') + '.');
      }

      var aj = P.ajustes, f = aj.fiscal, n, numero;
      var fiscal = docType === 'factura';
      if (fiscal) {
        n = Math.max(1, +aj.next || 1); aj.next = n + 1;
        numero = pad(f.est || '1', 3) + '-' + pad(f.pto || '1', 3) + '-' + pad(n, 7);
      } else {
        n = Math.max(1, +aj.nextTicket || 1); aj.nextTicket = n + 1;
        numero = 'T-' + pad(n, 6);
      }
      var sale = {
        id: A.rid(), tipo: docType, numero: numero, nro: n, fecha: new Date().toISOString(),
        cliente: { tipo: client.tipo, doc: client.doc, dv: client.dv, nombre: client.nombre, email: client.email, tel: client.tel },
        items: cart.map(function (l) {
          return { product_id: l.pid, codigo: l.code, descripcion: l.name + (l.talle ? ' T. ' + l.talle : ''), talle: l.talle,
                   cantidad: l.qty, precio: l.price, iva: l.iva, subtotal: l.qty * l.price };
        }),
        totales: t, condicion: 'contado',
        pago: transfer ? { forma: payMethod, monto: t.total, banco: transfer.banco, comprobante: transfer.comprobante, remitente: transfer.remitente }
                       : { forma: payMethod, monto: t.total }, recibido: paid, vuelto: payMethod === 'efectivo' ? paid - t.total : 0,
        estado: 'emitida', usuario: S.user, caja: cajaId,
        fiscal: fiscal ? { timbrado: f.timbrado, est: pad(f.est || '1', 3), pto: pad(f.pto || '1', 3) } : null,
        sifen: fiscal ? { estado: 'pendiente', cdc: '' } : null
      };
      applyStock(sale.items, -1);
      P.months[m].ventas.push(sale);
      A.renderAll();
      resetSale();
      showDone(sale);
      save([A.DATA_PATH, AJ_PATH, monthPath(m)], 'Venta ' + numero + ' · ' + money(t.total));
      if (fiscal && ffReady()) sifenAfterSale(sale); else autoEmail(sale);
    } catch (e) {
      flash('error', e.message || String(e));
    } finally {
      charging = false;
      btn.disabled = false;
    }
  }
  $('#posCharge').addEventListener('click', charge);

  function showDone(sale) {
    var d = $('#doneDlg');
    $('#doneSifenState').hidden = true;
    $('#doneMailState').hidden = true;
    $('#doneNum').textContent = 'N° ' + sale.numero + ' · Total ' + money(sale.totales.total) + ' · ' + PAY[sale.pago.forma];
    $('#doneChangeBox').hidden = sale.pago.forma !== 'efectivo';
    $('#doneChange').textContent = money(sale.vuelto);
    $('#donePrint').onclick = function () { printTicket(sale); };
    $('#donePdf').onclick = function () { downloadPdf(sale).catch(function (e) { flash('error', e.message); }); };
    $('#doneWa').onclick = function () { sendWhatsApp(sale).catch(function (e) { flash('error', e.message); }); };
    $('#doneMail').onclick = function () { sendEmail(sale).catch(function (e) { flash('error', e.message); }); };
    $('#doneTitle').textContent = isFactura(sale) ? 'Factura generada' : 'Venta registrada';
    function close() { if (d.open) d.close(); focusQ(); }
    $('#doneNew').onclick = close;
    d.oncancel = function (e) { e.preventDefault(); close(); };
    // Si se escanea el siguiente producto con la ventana abierta, se pasa directo a la nueva venta
    d.onkeydown = function (e) {
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        close();
        posQ.value = e.key;
        posQ.dispatchEvent(new Event('input'));
      }
    };
    d.showModal();
    $('#doneNew').focus();
    if (P.ajustes && P.ajustes.ticket.auto) printTicket(sale);
  }

  /* Atajos de teclado en Vender */
  document.addEventListener('keydown', function (e) {
    if ($('[data-pane="vender"]').hidden || $('#panel').hidden) return;
    if (document.querySelector('dialog[open]')) return;
    if (e.key === 'F2') { e.preventDefault(); charge(); }
    else if (e.key === 'F4') { e.preventDefault(); if (payMethod !== 'efectivo') $$('[data-pay]')[0].click(); paidIn.focus(); paidIn.select(); }
    else if (e.key === 'F8') {
      e.preventDefault();
      if (!cart.length) return;
      A.ask({ title: '¿Vaciar la venta?', text: 'Se quitan todos los productos de la venta actual.', ok: 'Sí, vaciar', danger: true })
        .then(function (ok) { if (ok) resetSale(); focusQ(); });
    }
  });

  /* ---------------- Cámara ---------------- */
  var camLib = null, camScanner = null, camTarget = null;
  function loadCamLib() {
    if (window.Html5Qrcode) return Promise.resolve();
    if (camLib) return camLib;
    camLib = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js';
      s.onload = resolve;
      s.onerror = function () { camLib = null; reject(new Error('No se pudo cargar el lector de la cámara. Revisá tu internet.')); };
      document.head.appendChild(s);
    });
    return camLib;
  }
  async function stopCam() {
    if (camScanner) {
      try { await camScanner.stop(); } catch (e) { /* ya estaba detenida */ }
      try { camScanner.clear(); } catch (e) { /* nada */ }
      camScanner = null;
    }
  }
  async function openCam(onCode) {
    var d = $('#camDlg');
    camTarget = onCode;
    $('#camHint').textContent = 'Si te lo pide, permití el uso de la cámara.';
    d.showModal();
    try {
      await loadCamLib();
      var F = window.Html5QrcodeSupportedFormats;
      camScanner = new window.Html5Qrcode('camReader', {
        formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.ITF, F.QR_CODE],
        verbose: false
      });
      await camScanner.start({ facingMode: 'environment' }, { fps: 12, qrbox: { width: 260, height: 140 } }, function (text) {
        var cb = camTarget;
        camTarget = null;
        stopCam().then(function () { if (d.open) d.close(); if (cb) cb(text); });
      }, function () { /* sigue buscando */ });
    } catch (e) {
      $('#camHint').textContent = (e && e.message) ? e.message : 'No se pudo abrir la cámara.';
    }
  }
  $('#camClose').addEventListener('click', function () { stopCam(); $('#camDlg').close(); });
  $('#camDlg').addEventListener('cancel', function () { stopCam(); });
  $('#posCam').addEventListener('click', function () {
    openCam(function (code) {
      if (!posPicker.byCode(code)) flash('error', 'No hay ningún producto con el código ' + code + '.');
    });
  });

  /* ---------------- Ticket ---------------- */
  function ticketHTML(sale) {
    var aj = P.ajustes || defaultAjustes(), f = aj.fiscal, st = S.data.store;
    var w = +aj.ticket.ancho === 58 ? '54mm' : '72mm';
    var L = function (a, b) { return '<div class="l"><span>' + a + '</span><span>' + b + '</span></div>'; };
    var h = '<!doctype html><html><head><meta charset="utf-8"><title>Ticket ' + esc(sale.numero) + '</title><style>' +
      '@page{size:' + (+aj.ticket.ancho === 58 ? '58mm' : '80mm') + ' auto;margin:3mm}' +
      'body{font:12px/1.35 "Courier New",monospace;width:' + w + ';margin:0 auto;color:#000}' +
      'h1{font-size:14px;text-align:center;margin:0 0 2px}.c{text-align:center}.hr{border-top:1px dashed #000;margin:6px 0}' +
      '.l{display:flex;justify-content:space-between;gap:6px}.b{font-weight:bold}.it{margin:3px 0}.big{font-size:15px}' +
      '</style></head><body>';
    h += '<h1>' + esc(f.fantasia || st.store_name) + '</h1>';
    if (f.razon) h += '<div class="c">' + esc(f.razon) + '</div>';
    if (f.ruc) h += '<div class="c">RUC ' + esc(f.ruc) + '</div>';
    if (f.direccion || st.address) h += '<div class="c">' + esc(f.direccion || st.address) + '</div>';
    if (f.telefono) h += '<div class="c">Tel. ' + esc(f.telefono) + '</div>';
    if (sale.fiscal) h += '<div class="c">Timbrado N° ' + esc(sale.fiscal.timbrado) + (f.vigencia ? ' · desde ' + esc(fmtDate(f.vigencia + 'T12:00:00')) : '') + '</div>';
    h += '<div class="hr"></div>';
    h += '<div class="c b">' + (isFactura(sale) ? 'FACTURA ELECTRÓNICA' : 'TICKET') + '</div>';
    h += L('<span class="b">N°</span>', '<span class="b">' + esc(sale.numero) + '</span>');
    h += L('Fecha', esc(fmtDate(sale.fecha, true)));
    var c = sale.cliente;
    h += L('Cliente', c.tipo === 'innominado' ? 'Consumidor final' : esc((c.nombre || '') + ' ' + (c.tipo === 'ruc' ? 'RUC ' : 'CI ') + c.doc + (c.dv ? '-' + c.dv : '')));
    h += '<div class="hr"></div>';
    sale.items.forEach(function (it) {
      h += '<div class="it">' + esc(it.descripcion) +
        L(it.cantidad + ' x ' + money(it.precio).replace('Gs. ', ''), money(it.subtotal).replace('Gs. ', '')) + '</div>';
    });
    h += '<div class="hr"></div>';
    h += '<div class="big b">' + L('TOTAL', money(sale.totales.total)) + '</div>';
    h += '<div class="hr"></div>';
    h += L('Pago', esc(PAY[sale.pago.forma] || sale.pago.forma));
    if (sale.pago.banco) h += L('Banco', esc(sale.pago.banco));
    if (sale.pago.comprobante) h += L('Comprobante', esc(sale.pago.comprobante));
    if (sale.pago.remitente) h += L('Envió', esc(sale.pago.remitente));
    if (sale.pago.forma === 'efectivo') { h += L('Recibido', money(sale.recibido)); h += L('Vuelto', money(sale.vuelto)); }
    if (sale.estado === 'anulada') h += '<div class="hr"></div><div class="c b">*** ANULADA ***</div>';
    h += '<div class="hr"></div><div class="c">¡Gracias por tu compra!</div>';
    if (!isFactura(sale)) h += '<div class="c" style="font-size:10px;margin-top:4px">Comprobante interno, no válido como factura.</div>';
    else if (!(sale.sifen && sale.sifen.cdc)) h += '<div class="c" style="font-size:10px;margin-top:4px">Pendiente de aprobación en SIFEN.</div>';
    else h += '<div class="c" style="font-size:10px;margin-top:4px">CDC ' + esc(sale.sifen.cdc) + '</div>';
    return h + '</body></html>';
  }
  function isFactura(sale) { return sale.tipo ? sale.tipo === 'factura' : !!sale.fiscal; }
  function docName(sale) { return (isFactura(sale) ? 'factura-' : 'ticket-') + String(sale.numero).replace(/[^A-Za-z0-9-]/g, '') + '.pdf'; }

  /* ---------------- PDF ---------------- */
  var pdfLib = null;
  function loadPdfLib() {
    if (window.jspdf) return Promise.resolve(window.jspdf);
    if (pdfLib) return pdfLib;
    pdfLib = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s.onload = function () { resolve(window.jspdf); };
      s.onerror = function () { pdfLib = null; reject(new Error('No se pudo preparar el PDF. Revisá tu internet.')); };
      document.head.appendChild(s);
    });
    return pdfLib;
  }
  async function makePdf(sale) {
    var lib = await loadPdfLib();
    var aj = P.ajustes || defaultAjustes(), f = aj.fiscal, st = S.data.store;
    var W = +aj.ticket.ancho === 58 ? 58 : 80, M = 4, CW = W - M * 2;
    var rows = [];   // { t, r, align, bold, size, hr }
    var add = function (o) { rows.push(o); };
    var c = function (t, o) { add(Object.assign({ t: t, align: 'center' }, o || {})); };
    var lr = function (a, b, o) { add(Object.assign({ t: a, r: b }, o || {})); };
    var hr = function () { add({ hr: true }); };
    var plain = function (m) { return String(m).replace('Gs. ', ''); };
    c(f.fantasia || st.store_name, { bold: true, size: 11 });
    if (f.razon) c(f.razon);
    if (f.ruc) c('RUC ' + f.ruc);
    if (f.direccion || st.address) c(f.direccion || st.address);
    if (f.telefono) c('Tel. ' + f.telefono);
    if (sale.fiscal) c('Timbrado N° ' + sale.fiscal.timbrado + (f.vigencia ? ' · desde ' + fmtDate(f.vigencia + 'T12:00:00') : ''));
    hr();
    c(isFactura(sale) ? 'FACTURA ELECTRÓNICA' : 'TICKET', { bold: true });
    lr('N°', sale.numero, { bold: true });
    lr('Fecha', fmtDate(sale.fecha, true));
    var cl = sale.cliente;
    lr('Cliente', cl.tipo === 'innominado' ? 'Consumidor final' : (cl.nombre || ''));
    if (cl.tipo !== 'innominado') lr(cl.tipo === 'ruc' ? 'RUC' : 'CI', cl.doc + (cl.dv ? '-' + cl.dv : ''));
    hr();
    sale.items.forEach(function (it) {
      add({ t: it.descripcion });
      lr(it.cantidad + ' x ' + plain(money(it.precio)), plain(money(it.subtotal)));
    });
    hr();
    lr('TOTAL', money(sale.totales.total), { bold: true, size: 11 });
    hr();
    lr('Pago', PAY[sale.pago.forma] || sale.pago.forma);
    if (sale.pago.banco) lr('Banco', sale.pago.banco);
    if (sale.pago.comprobante) lr('Comprobante', sale.pago.comprobante);
    if (sale.pago.remitente) lr('Envió', sale.pago.remitente);
    if (sale.pago.forma === 'efectivo') { lr('Recibido', money(sale.recibido)); lr('Vuelto', money(sale.vuelto)); }
    if (sale.estado === 'anulada') { hr(); c('*** ANULADA ***', { bold: true }); }
    hr();
    c('¡Gracias por tu compra!');
    if (!isFactura(sale)) c('Comprobante interno, no válido como factura.', { size: 7 });
    else if (!(sale.sifen && sale.sifen.cdc)) c('Pendiente de aprobación en SIFEN.', { size: 7 });
    else c('CDC ' + sale.sifen.cdc, { size: 7 });

    // Alto de la hoja según el contenido
    var probe = new lib.jsPDF({ unit: 'mm', format: [W, 100], compress: true });
    var lines = rows.map(function (o) {
      if (o.hr) return { o: o, h: 3 };
      probe.setFontSize(o.size || 9);
      var avail = o.r != null ? CW * 0.55 : CW;
      var parts = probe.splitTextToSize(String(o.t), avail);
      return { o: o, parts: parts, h: parts.length * (o.size || 9) * 0.42 + 0.8 };
    });
    var H = M * 2 + lines.reduce(function (t, x) { return t + x.h; }, 0);
    var doc = new lib.jsPDF({ unit: 'mm', format: [W, Math.max(H, 40)], compress: true });
    var y = M;
    lines.forEach(function (x) {
      var o = x.o;
      if (o.hr) {
        doc.setLineDashPattern([0.8, 0.8], 0); doc.setLineWidth(0.2);
        doc.line(M, y + 1.5, W - M, y + 1.5); y += 3; return;
      }
      var size = o.size || 9;
      doc.setFont('helvetica', o.bold ? 'bold' : 'normal');
      doc.setFontSize(size);
      var lh = size * 0.42, yy = y + lh;
      x.parts.forEach(function (part, i) {
        if (o.align === 'center') doc.text(part, W / 2, yy + i * lh, { align: 'center' });
        else doc.text(part, M, yy + i * lh);
      });
      if (o.r != null) doc.text(String(o.r), W - M, yy, { align: 'right' });
      y += x.h;
    });
    return doc.output('blob');
  }
  async function downloadPdf(sale) {
    var blob = await docPdf(sale);
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = docName(sale);
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  /* ---------------- WhatsApp ---------------- */
  function waNumber(tel) {
    var d = String(tel || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.indexOf('595') === 0) return d;
    if (d.charAt(0) === '0') return '595' + d.slice(1);
    if (d.length === 9 && d.charAt(0) === '9') return '595' + d;
    return d;
  }
  function waText(sale) {
    var st = S.data.store;
    return '¡Hola' + (sale.cliente.nombre ? ' ' + sale.cliente.nombre : '') + '! Te enviamos tu ' +
      (isFactura(sale) ? 'factura electrónica' : 'ticket') + ' N° ' + sale.numero + ' de ' + st.store_name +
      '.\nTotal: ' + money(sale.totales.total) + '\n¡Gracias por tu compra!';
  }
  async function sendWhatsApp(sale) {
    var blob = await makePdf(sale);
    var file = new File([blob], docName(sale), { type: 'application/pdf' });
    var mobile = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    // En el teléfono se comparte el PDF directo (se elige WhatsApp en la lista)
    if (mobile && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], text: waText(sale) }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    // En la PC: se descarga el PDF y se abre WhatsApp con el mensaje para adjuntarlo
    await downloadPdf(sale);
    var n = waNumber(sale.cliente.tel);
    window.open('https://wa.me/' + n + '?text=' + encodeURIComponent(waText(sale) + '\n(Te adjunto el comprobante en PDF)'), '_blank', 'noopener');
    var note = 'Se descargó el PDF: adjuntalo en el chat de WhatsApp que se abrió.';
    if ($('[data-pane="vender"]').hidden) A.showMsg('ok', note); else flash('ok', note);
  }

  /* ---------------- Correo ---------------- */
  function notify(type, text) { if ($('[data-pane="vender"]').hidden) A.showMsg(type, text); else flash(type, text); }
  function mailCfg() {
    if (!P.ajustes) P.ajustes = defaultAjustes();
    P.ajustes.correo = Object.assign(defaultAjustes().correo, P.ajustes.correo || {});
    return P.ajustes.correo;
  }
  function mailReady() { var c = mailCfg(); return !!(c.service && c.template && c.key); }
  function mailContent(sale) {
    var st = S.data.store, fac = isFactura(sale);
    return {
      subject: (fac ? 'Factura electrónica' : 'Ticket') + ' N° ' + sale.numero + ' · ' + st.store_name,
      body: 'Hola' + (sale.cliente.nombre ? ' ' + sale.cliente.nombre : '') + ',\n\n' +
        'Te enviamos tu ' + (fac ? 'factura electrónica' : 'ticket') + ' N° ' + sale.numero + ' por un total de ' + money(sale.totales.total) + '.\n' +
        'El comprobante va adjunto en PDF.\n\n¡Gracias por tu compra!\n' + st.store_name
    };
  }
  function blobToDataURL(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(new Error('No se pudo preparar el PDF.')); };
      r.readAsDataURL(blob);
    });
  }
  async function emailjsSend(params) {
    var c = mailCfg(), r;
    try {
      r = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service_id: c.service, template_id: c.template, user_id: c.key, template_params: params })
      });
    } catch (e) { throw new Error('No se pudo enviar el correo: no hay conexión a internet.'); }
    if (!r.ok) {
      var t = ''; try { t = await r.text(); } catch (e) { /* sin detalle */ }
      throw new Error('No se pudo enviar el correo (' + (t || 'error ' + r.status) + ').');
    }
  }
  /* Envía el comprobante en PDF por EmailJS y lo deja anotado en la venta */
  async function emailSale(sale, to) {
    var mc = mailContent(sale);
    var pdf = await blobToDataURL(await docPdf(sale));
    await emailjsSend({ to_email: to, to_name: sale.cliente.nombre || 'Cliente', subject: mc.subject, message: mc.body,
                        store_name: S.data.store.store_name, pdf: pdf, pdf_name: docName(sale) });
    sale.correo = { enviado: new Date().toISOString(), a: to };
    var m = monthKey(new Date(sale.fecha));
    if (P.months[m]) { ensureMonthSource(m); save([monthPath(m)], 'Correo enviado · ' + sale.numero); }
    if (!$('[data-pane="ventas"]').hidden) renderVentas();
  }
  function autoEmail(sale) {
    var c = mailCfg(), box = $('#doneMailState');
    var wanted = c.auto && (isFactura(sale) || c.tickets);
    if (!wanted || !mailReady()) { box.hidden = true; return; }
    var to = sale.cliente.email;
    box.hidden = false;
    if (!to) { box.className = 'done-mail is-warn'; box.textContent = 'No se envió por correo: el cliente no tiene correo cargado.'; return; }
    box.className = 'done-mail'; box.textContent = 'Enviando por correo a ' + to + '…';
    emailSale(sale, to).then(function () {
      box.className = 'done-mail is-ok'; box.textContent = 'Enviada por correo a ' + to + '.';
      if (!$('#doneDlg').open) notify('ok', (isFactura(sale) ? 'Factura ' : 'Ticket ') + sale.numero + ' enviado por correo a ' + to + '.');
    }, function (e) {
      box.className = 'done-mail is-warn'; box.textContent = e.message + ' Podés reenviarla desde Ventas.';
      if (!$('#doneDlg').open) notify('error', e.message);
    });
  }
  async function sendEmail(sale) {
    if (mailReady()) {
      var to = sale.cliente.email || (window.prompt('Correo del cliente:', '') || '').trim();
      if (!to) return;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error('El correo «' + to + '» no es válido.');
      notify('ok', 'Enviando a ' + to + '…');
      await emailSale(sale, to);
      notify('ok', (isFactura(sale) ? 'Factura ' : 'Ticket ') + sale.numero + ' enviado por correo a ' + to + '.');
      return;
    }
    var mc = mailContent(sale), subject = mc.subject, body = mc.body;
    var blob = await makePdf(sale);
    var file = new File([blob], docName(sale), { type: 'application/pdf' });
    var mobile = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    // En el teléfono se comparte el PDF directo (se elige Gmail u otra app de correo)
    if (mobile && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: subject, text: body }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    // En la PC: se descarga el PDF y se abre Gmail con el correo escrito, listo para adjuntar
    await downloadPdf(sale);
    var to = sale.cliente.email || '';
    window.open('https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(to) +
      '&su=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body), '_blank', 'noopener');
    notify('ok', 'Se descargó el PDF: adjuntalo en el correo que se abrió (clip o arrastrar).' + (to ? '' : ' El cliente no tiene correo cargado: escribilo en "Para".'));
  }

  function printTicket(sale) {
    var ifr = document.createElement('iframe');
    ifr.setAttribute('aria-hidden', 'true');
    ifr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(ifr);
    var doc = ifr.contentWindow.document;
    doc.open(); doc.write(ticketHTML(sale)); doc.close();
    setTimeout(function () {
      ifr.contentWindow.focus();
      ifr.contentWindow.print();
      setTimeout(function () { ifr.remove(); }, 3000);
    }, 300);
  }

  /* =================================================================
     HISTORIAL DE VENTAS
     ================================================================= */
  var saleMonthIn = $('#saleMonth');
  saleMonthIn.value = monthKey();
  /* ---------------- paginación ---------------- */
  var PAGE_SIZE = 10, pages = { ventas: 1, compras: 1, caja: 1, diario: 1 };
  function paginate(list, key) {
    var max = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (pages[key] > max) pages[key] = max;
    if (pages[key] < 1) pages[key] = 1;
    var from = (pages[key] - 1) * PAGE_SIZE;
    return { items: list.slice(from, from + PAGE_SIZE), from: from, total: list.length, page: pages[key], max: max };
  }
  function renderPager(el, key, pg, rerender) {
    if (pg.total <= PAGE_SIZE) { el.innerHTML = pg.total ? '<span class="pager-info">' + pg.total + (pg.total === 1 ? ' registro' : ' registros') + '</span>' : ''; return; }
    var nums = '', start = Math.max(1, Math.min(pg.page - 2, pg.max - 4)), end = Math.min(pg.max, start + 4);
    for (var i = start; i <= end; i++) {
      nums += '<button type="button" class="pg-num' + (i === pg.page ? ' on' : '') + '" data-pg="' + i + '"' + (i === pg.page ? ' aria-current="page"' : '') + '>' + i + '</button>';
    }
    el.innerHTML = '<span class="pager-info">' + (pg.from + 1) + '–' + (pg.from + pg.items.length) + ' de ' + pg.total + '</span>' +
      '<div class="pager-btns">' +
      '<button type="button" class="pg-nav" data-pg="' + (pg.page - 1) + '"' + (pg.page === 1 ? ' disabled' : '') + ' aria-label="Página anterior">‹</button>' + nums +
      '<button type="button" class="pg-nav" data-pg="' + (pg.page + 1) + '"' + (pg.page === pg.max ? ' disabled' : '') + ' aria-label="Página siguiente">›</button></div>';
    el.onclick = function (e) {
      var b = e.target.closest('[data-pg]');
      if (!b || b.disabled) return;
      pages[key] = +b.dataset.pg;
      rerender();
    };
  }

  async function renderVentas() {
    var m = saleMonthIn.value || monthKey(), body = $('#saleRows');
    if (!A.connected()) { body.innerHTML = '<tr><td colspan="7" class="tbl-empty">' + esc(A.NEED_CONN) + '</td></tr>'; $('#saleKpis').innerHTML = ''; return; }
    if (!P.months[m]) body.innerHTML = '<tr><td colspan="7" class="tbl-empty">Cargando…</td></tr>';
    var data;
    try { data = await loadMonth(m); } catch (e) { body.innerHTML = '<tr><td colspan="7" class="tbl-empty">' + esc(e.message) + '</td></tr>'; return; }
    var showVoid = $('#saleShowVoid').checked;
    var ventas = data.ventas.slice().reverse().filter(function (v) { return showVoid || v.estado !== 'anulada'; });
    var ok = data.ventas.filter(function (v) { return v.estado !== 'anulada'; });
    var today = todayISO();
    var hoy = ok.filter(function (v) { return fmtISODate(v.fecha) === today; });
    var sum = function (arr) { return arr.reduce(function (t, v) { return t + v.totales.total; }, 0); };
    var byPay = {};
    ok.forEach(function (v) { byPay[v.pago.forma] = (byPay[v.pago.forma] || 0) + v.totales.total; });
    var k = '';
    if (m === monthKey()) k += kpi('Hoy', money(sum(hoy)), hoy.length + (hoy.length === 1 ? ' venta' : ' ventas'));
    k += kpi('Total del mes', money(sum(ok)), ok.length + (ok.length === 1 ? ' venta' : ' ventas'));
    Object.keys(byPay).forEach(function (f) { k += kpi(PAY[f] || f, money(byPay[f]), 'en el mes'); });
    $('#saleKpis').innerHTML = k;
    var pg = paginate(ventas, 'ventas');
    renderPager($('#salePager'), 'ventas', pg, renderVentas);
    if (!ventas.length) { body.innerHTML = '<tr><td colspan="7" class="tbl-empty">No hay ventas en este mes.</td></tr>'; return; }
    body.innerHTML = pg.items.map(function (v) {
      var c = v.cliente;
      var cli = c.tipo === 'innominado' ? 'Consumidor final' : (c.nombre || '') + ' · ' + (c.tipo === 'ruc' ? 'RUC ' : 'CI ') + c.doc + (c.dv ? '-' + c.dv : '');
      return '<tr class="' + (v.estado === 'anulada' ? 'is-void' : '') + '">' +
        '<td class="nowrap"><strong>' + esc(v.numero) + '</strong><span class="t-sub">' + (isFactura(v) ? 'Factura electrónica' : 'Ticket') + '</span>' +
          (isFactura(v) ? sifenBadge(v) : '') + '</td>' +
        '<td class="nowrap">' + esc(fmtDate(v.fecha, true)) + '</td>' +
        '<td>' + esc(cli) + '<span class="t-sub">' + v.items.length + (v.items.length === 1 ? ' producto' : ' productos') +
          (v.correo ? ' · enviado a ' + esc(v.correo.a) : '') + '</span></td>' +
        '<td>' + esc(PAY[v.pago.forma] || v.pago.forma) +
          (v.pago.banco ? '<span class="t-sub">' + esc(v.pago.banco + ' · N° ' + v.pago.comprobante + ' · ' + v.pago.remitente) + '</span>' : '') + '</td>' +
        '<td class="ta-r nowrap"><strong>' + money(v.totales.total) + '</strong></td>' +
        '<td>' + (v.estado === 'anulada' ? '<span class="pill pill-off">Anulada</span>' : '<span class="pill pill-on">Emitida</span>') + '</td>' +
        '<td class="actions"><button type="button" class="btn btn-print btn-sm" data-ticket="' + esc(v.id) + '">Imprimir</button>' +
        '<button type="button" class="btn btn-pdf btn-sm" data-pdf="' + esc(v.id) + '">PDF</button>' +
        '<button type="button" class="btn btn-wa-sm btn-sm" data-wa="' + esc(v.id) + '">WhatsApp</button>' +
        '<button type="button" class="btn btn-mail btn-sm" data-mail="' + esc(v.id) + '">Correo</button>' +
        (isFactura(v) && ffReady() && v.estado !== 'anulada' && !(v.sifen && v.sifen.cdc) ? '<button type="button" class="btn btn-accent btn-sm" data-sifen="' + esc(v.id) + '">Enviar al SIFEN</button>' : '') +
        (isFactura(v) && ffReady() && v.sifen && v.sifen.cdc ? '<button type="button" class="btn btn-secondary btn-sm" data-sstate="' + esc(v.id) + '">Estado</button>' : '') +
        (v.estado !== 'anulada' ? '<button type="button" class="icon-btn icon-danger icon-void" data-void="' + esc(v.id) + '" title="Anular venta" aria-label="Anular venta ' + esc(v.numero) + '">' + TRASH_ICON + '</button>' : '') + '</td></tr>';
    }).join('');
  }
  function fmtISODate(iso) { var d = new Date(iso); return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2); }
  function kpi(label, value, sub) {
    return '<div class="kpi"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong><small>' + esc(sub) + '</small></div>';
  }
  saleMonthIn.addEventListener('change', function () { pages.ventas = 1; renderVentas(); });
  $('#saleShowVoid').addEventListener('change', function () { pages.ventas = 1; renderVentas(); });

  $('#saleRows').addEventListener('click', function (e) {
    var m = saleMonthIn.value || monthKey(), list = (P.months[m] || { ventas: [] }).ventas, b;
    var find = function (id) { return list.filter(function (v) { return v.id === id; })[0]; };
    if ((b = e.target.closest('[data-ticket]'))) { printTicket(find(b.dataset.ticket)); return; }
    if ((b = e.target.closest('[data-pdf]'))) { downloadPdf(find(b.dataset.pdf)).catch(function (er) { A.showMsg('error', er.message); }); return; }
    if ((b = e.target.closest('[data-mail]'))) { sendEmail(find(b.dataset.mail)).catch(function (er) { A.showMsg('error', er.message); }); return; }
    if ((b = e.target.closest('[data-wa]'))) { sendWhatsApp(find(b.dataset.wa)).catch(function (er) { A.showMsg('error', er.message); }); return; }
    if ((b = e.target.closest('[data-sifen]'))) {
      var sv = find(b.dataset.sifen), sb = b;
      sb.disabled = true; sb.textContent = 'Enviando…';
      ffEmit(sv).then(function () {
        A.showMsg('ok', 'Factura ' + sv.numero + ' enviada al SIFEN. CDC ' + sv.sifen.cdc);
        if (sv.cliente.email && mailReady() && mailCfg().auto) emailSale(sv, sv.cliente.email).catch(function () {});
      }, function (er) { A.showMsg('error', er.message); }).then(function () { saveSale(sv, 'SIFEN · ' + sv.numero); renderVentas(); });
      return;
    }
    if ((b = e.target.closest('[data-sstate]'))) {
      var qv = find(b.dataset.sstate);
      b.disabled = true;
      ffStatus(qv).then(function () { A.showMsg('ok', 'Estado en el SIFEN: ' + qv.sifen.estado + '.'); saveSale(qv, 'Estado SIFEN · ' + qv.numero); },
                        function (er) { A.showMsg('error', er.message); }).then(renderVentas);
      return;
    }
    if ((b = e.target.closest('[data-void]'))) {
      var v = find(b.dataset.void);
      var cancelSifen = isFactura(v) && v.sifen && v.sifen.cdc && ffReady();
      A.ask({ title: '¿Anular la venta ' + v.numero + '?', text: 'Se devuelve el stock de los productos y la venta queda marcada como anulada. Total: ' + money(v.totales.total) + '.' +
              (cancelSifen ? ' También se cancela la factura en el SIFEN.' : ''), ok: 'Sí, anular', danger: true })
        .then(async function (ok) {
          if (!ok) return;
          if (cancelSifen) {
            try { await ffCancel(v, 'Anulación de la venta'); }
            catch (er) { A.showMsg('error', 'No se pudo cancelar en el SIFEN: ' + er.message + ' La venta no se anuló.'); return; }
          }
          v.estado = 'anulada';
          v.anulada_en = new Date().toISOString();
          v.anulada_por = S.user;
          applyStock(v.items, +1);
          A.renderAll();
          renderVentas();
          save([A.DATA_PATH, monthPath(m)], 'Anular venta ' + v.numero);
        });
    }
  });

  /* Listado de ventas del mes en PDF */
  $('#expCsv').addEventListener('click', async function () {
    var m = saleMonthIn.value || monthKey(), btn = this;
    if (!A.V.reportPdf) { A.showMsg('error', 'Falta assets/caja.js para armar el PDF.'); return; }
    btn.disabled = true;
    try {
      await loadMonth(m);
      var list = P.months[m].ventas.filter(function (v) { return v.estado !== 'anulada'; });
      var sum = function (arr) { return arr.reduce(function (t, v) { return t + v.totales.total; }, 0); };
      var ef = list.filter(function (v) { return v.pago.forma !== 'transferencia'; }), tr = list.filter(function (v) { return v.pago.forma === 'transferencia'; });
      var p2 = m.split('-');
      await A.V.reportPdf('ventas-' + m + '.pdf', [
        { t: 'title', v: S.data.store.store_name + ' · Ventas de ' + p2[1] + '/' + p2[0] },
        { t: 'sub', v: list.length + (list.length === 1 ? ' venta' : ' ventas') + ' (sin contar las anuladas)' },
        { t: 'kv', items: [{ k: 'Total del mes', v: money(sum(list)), main: true }, { k: 'Efectivo', v: money(sum(ef)) }, { k: 'Transferencias', v: money(sum(tr)) }] },
        { t: 'table', title: 'Detalle de ventas', head: ['N°', 'Fecha', 'Cliente', 'Pago', 'Total'], widths: [0.2, 0.2, 0.3, 0.13, 0.17],
          align: ['left', 'left', 'left', 'left', 'right'], boldFirst: true, empty: 'No hay ventas en este mes',
          rows: list.slice().reverse().map(function (v) {
            var c = v.cliente;
            return [v.numero, fmtDate(v.fecha, true), c.tipo === 'innominado' ? 'Consumidor final' : (c.nombre || '') + ' ' + c.doc + (c.dv ? '-' + c.dv : ''),
                    PAY[v.pago.forma] || v.pago.forma, money(v.totales.total)];
          }),
          foot: ['Total', '', '', '', money(sum(list))] }
      ]);
    } catch (e) {
      A.showMsg('error', e.message || String(e));
    } finally { btn.disabled = false; }
  });

  /* Archivo con la estructura de datos que pide el SIFEN (factura electrónica de Paraguay) */
  $('#expSifen').addEventListener('click', async function () {
    var m = saleMonthIn.value || monthKey();
    try { await loadMonth(m); } catch (e) { A.showMsg('error', e.message); return; }
    var f = P.ajustes.fiscal, rucParts = String(f.ruc || '').split('-');
    var docs = P.months[m].ventas.filter(function (v) { return v.estado !== 'anulada' && isFactura(v); }).map(function (v) {
      var c = v.cliente;
      return {
        tipoDocumento: 1, tipoDocumentoDescripcion: 'Factura electrónica',
        timbrado: f.timbrado, vigenciaDesde: f.vigencia,
        establecimiento: pad(f.est || '1', 3), puntoExpedicion: pad(f.pto || '1', 3), numeroDocumento: pad(v.nro, 7),
        numeroInterno: v.numero, fechaEmision: v.fecha, tipoEmision: 1, tipoTransaccion: 1, moneda: 'PYG',
        emisor: { ruc: rucParts[0] || '', dv: rucParts[1] || '', razonSocial: f.razon, nombreFantasia: f.fantasia,
                  direccion: f.direccion, telefono: f.telefono, actividadEconomica: f.actividad },
        receptor: c.tipo === 'ruc'
          ? { naturaleza: 1, contribuyente: true, ruc: c.doc, dv: c.dv, razonSocial: c.nombre, email: c.email }
          : c.tipo === 'ci'
            ? { naturaleza: 2, contribuyente: false, tipoDocumento: 1, documento: c.doc, nombre: c.nombre, email: c.email }
            : { naturaleza: 2, contribuyente: false, tipoDocumento: 5, documento: '0', nombre: 'Sin Nombre' },
        condicionVenta: 1, condicionVentaDescripcion: 'Contado',
        pagos: [Object.assign({ tipo: v.pago.forma, monto: v.pago.monto }, v.pago.banco ? { banco: v.pago.banco, comprobante: v.pago.comprobante, remitente: v.pago.remitente } : {})],
        items: v.items.map(function (it) {
          return { codigo: it.codigo, descripcion: it.descripcion, unidadMedida: 77, cantidad: it.cantidad,
                   precioUnitario: it.precio, total: it.subtotal,
                   afectacionIva: it.iva ? 1 : 3, tasaIva: it.iva, baseGravada: it.iva ? it.subtotal : 0,
                   liquidacionIva: it.iva === 10 ? Math.round(it.subtotal / 11) : it.iva === 5 ? Math.round(it.subtotal / 21) : 0 };
        }),
        totales: { subtotalExenta: v.totales.exenta, subtotalGravada5: v.totales.gravada5, subtotalGravada10: v.totales.gravada10,
                   liquidacionIva5: v.totales.iva5, liquidacionIva10: v.totales.iva10, totalGeneral: v.totales.total },
        sifen: v.sifen
      };
    });
    download('ventas-' + m + '-sifen.json', JSON.stringify({ generado: new Date().toISOString(), mes: m, documentos: docs }, null, 2), 'application/json');
  });

  /* =================================================================
     COMPRAS
     ================================================================= */
  var buyItems = [];
  $('#bDate').value = todayISO();
  var buyMonthIn = $('#buyMonth');
  buyMonthIn.value = monthKey();

  $('#bCond').addEventListener('change', function () { $('#bPagoW').hidden = this.value !== 'contado'; });

  makePicker($('#buyQ'), $('#buyResults'), function (p) {
    buyItems.push({ pid: p.id, name: p.name, sizes: hasSizes(p) ? p.sizes.map(function (s) { return String(s.size); }) : null, talle: '', qty: 1, cost: 0 });
    renderBuy();
    var rows = $$('#buyRows tr[data-b]');
    var last = rows[rows.length - 1];
    var first = last && (last.querySelector('[data-f="talle"]') || last.querySelector('[data-f="qty"]'));
    if (first) first.focus();
  }, null, function (q) { A.showMsg('error', 'No se encontró ningún producto con «' + q + '». Primero crealo en Productos.'); });

  function renderBuy() {
    var body = $('#buyRows');
    if (!buyItems.length) {
      body.innerHTML = '<tr><td colspan="6" class="tbl-empty">Agregá los productos que llegaron.</td></tr>';
    } else {
      body.innerHTML = buyItems.map(function (it, i) {
        var listId = 'bsz' + i;
        return '<tr data-b="' + i + '"><td class="b-name"><strong>' + esc(it.name) + '</strong></td>' +
          '<td data-label="Talle">' + (it.sizes ? '<input data-f="talle" list="' + listId + '" value="' + esc(it.talle) + '" class="in-sm" placeholder="Talle">' +
            '<datalist id="' + listId + '">' + it.sizes.map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') + '</datalist>' : '<span class="t-sub">—</span>') + '</td>' +
          '<td data-label="Cantidad"><input data-f="qty" class="in-sm js-num" inputmode="numeric" value="' + A.fmtNum(it.qty) + '"></td>' +
          '<td data-label="Costo unitario"><input data-f="cost" class="in-md js-num" inputmode="numeric" value="' + (it.cost ? A.fmtNum(it.cost) : '') + '" placeholder="0"></td>' +
          '<td class="ta-r nowrap b-sub" data-label="Subtotal" data-sub>' + money(it.qty * it.cost) + '</td>' +
          '<td class="b-x"><button type="button" class="row-x" data-brm aria-label="Quitar">×</button></td></tr>';
      }).join('');
    }
    buyTotal();
  }
  function buyTotal() {
    $('#buyTotal').textContent = money(buyItems.reduce(function (t, it) { return t + it.qty * it.cost; }, 0));
  }
  $('#buyRows').addEventListener('input', function (e) {
    var tr = e.target.closest('[data-b]');
    if (!tr) return;
    var it = buyItems[+tr.dataset.b], f = e.target.dataset.f;
    if (f === 'talle') it.talle = e.target.value.trim();
    if (f === 'qty') it.qty = num(e.target.value);
    if (f === 'cost') it.cost = num(e.target.value);
    tr.querySelector('[data-sub]').textContent = money(it.qty * it.cost);
    buyTotal();
  });
  $('#buyRows').addEventListener('click', function (e) {
    if (!e.target.closest('[data-brm]')) return;
    buyItems.splice(+e.target.closest('[data-b]').dataset.b, 1);
    renderBuy();
  });

  $('#buySave').addEventListener('click', async function () {
    var prov = $('#bProv').value.trim();
    if (!A.connected()) { A.showMsg('error', A.NEED_CONN); return; }
    if (!prov) { A.showMsg('error', 'Escribí el nombre del proveedor.'); $('#bProv').focus(); return; }
    if (!buyItems.length) { A.showMsg('error', 'Agregá al menos un producto a la compra.'); $('#buyQ').focus(); return; }
    for (var i = 0; i < buyItems.length; i++) {
      var it = buyItems[i];
      if (it.qty < 1) { A.showMsg('error', 'Revisá la cantidad de «' + it.name + '».'); return; }
      if (it.sizes && !it.talle) { A.showMsg('error', 'Elegí el talle de «' + it.name + '».'); return; }
    }
    var btn = $('#buySave');
    btn.disabled = true; btn.textContent = 'Registrando…';
    try {
      var date = $('#bDate').value || todayISO();
      var m = date.slice(0, 7);
      await loadMonth(m);
      var compra = {
        id: A.rid(), fecha: new Date(date + 'T12:00:00').toISOString(), registrada: new Date().toISOString(),
        proveedor: { nombre: prov, ruc: $('#bRuc').value.trim() }, factura: $('#bFac').value.trim(), condicion: $('#bCond').value,
        items: buyItems.map(function (it) {
          return { product_id: it.pid, descripcion: it.name + (it.talle ? ' T. ' + it.talle : ''), talle: it.talle || '',
                   cantidad: it.qty, costo: it.cost, subtotal: it.qty * it.cost };
        }),
        estado: 'registrada', usuario: S.user,
        pago: $('#bCond').value === 'contado' ? $('#bPago').value : null
      };
      compra.caja = compra.pago && A.V.hooks.cajaFor ? A.V.hooks.cajaFor(compra.pago) : null;
      compra.total = compra.items.reduce(function (t, x) { return t + x.subtotal; }, 0);
      applyStock(compra.items, +1);
      P.months[m].compras.push(compra);
      A.renderAll();
      buyItems = [];
      ['#bProv', '#bRuc', '#bFac'].forEach(function (id) { $(id).value = ''; });
      renderBuy();
      buyMonthIn.value = m;
      renderCompras();
      A.showMsg('ok', 'Compra registrada y stock actualizado. ' + A.NOTE);
      await save([A.DATA_PATH, monthPath(m)], 'Compra a ' + prov + ' · ' + money(compra.total));
    } catch (e) {
      A.showMsg('error', e.message || String(e));
    } finally {
      btn.disabled = false; btn.textContent = 'Registrar compra';
    }
  });

  async function renderCompras() {
    var m = buyMonthIn.value || monthKey(), body = $('#buyHist');
    if (!A.connected()) { body.innerHTML = '<tr><td colspan="7" class="tbl-empty">' + esc(A.NEED_CONN) + '</td></tr>'; return; }
    var data;
    try { data = await loadMonth(m); } catch (e) { body.innerHTML = '<tr><td colspan="7" class="tbl-empty">' + esc(e.message) + '</td></tr>'; return; }
    var showVoid = $('#buyShowVoid').checked;
    var list = data.compras.slice().reverse().filter(function (c) { return showVoid || c.estado !== 'anulada'; });
    var pg = paginate(list, 'compras');
    renderPager($('#buyPager'), 'compras', pg, renderCompras);
    if (!list.length) { body.innerHTML = '<tr><td colspan="7" class="tbl-empty">No hay compras en este mes.</td></tr>'; return; }
    body.innerHTML = pg.items.map(function (c) {
      var units = c.items.reduce(function (t, x) { return t + x.cantidad; }, 0);
      return '<tr class="' + (c.estado === 'anulada' ? 'is-void' : '') + '">' +
        '<td class="nowrap">' + esc(fmtDate(c.fecha)) + '</td>' +
        '<td>' + esc(c.proveedor.nombre) + (c.proveedor.ruc ? '<span class="t-sub">RUC ' + esc(c.proveedor.ruc) + '</span>' : '') + '</td>' +
        '<td>' + esc(c.factura || '—') + '<span class="t-sub">' + (c.pago ? 'Pagado con ' + (c.pago === 'transferencia' ? 'transferencia' : 'efectivo') : (c.condicion === 'credito' ? 'A crédito' : '')) + '</span></td>' +
        '<td>' + units + (units === 1 ? ' unidad' : ' unidades') + '<span class="t-sub">' + esc(c.items.map(function (x) { return x.descripcion; }).join(', ')) + '</span></td>' +
        '<td class="ta-r nowrap"><strong>' + money(c.total) + '</strong></td>' +
        '<td>' + (c.estado === 'anulada' ? '<span class="pill pill-off">Anulada</span>' : '<span class="pill pill-on">Registrada</span>') + '</td>' +
        '<td class="actions">' + (c.estado !== 'anulada' ? '<button type="button" class="icon-btn icon-danger icon-void" data-bvoid="' + esc(c.id) + '" title="Anular compra" aria-label="Anular compra a ' + esc(c.proveedor.nombre) + '">' + TRASH_ICON + '</button>' : '') + '</td></tr>';
    }).join('');
  }
  buyMonthIn.addEventListener('change', function () { pages.compras = 1; renderCompras(); });
  $('#buyShowVoid').addEventListener('change', function () { pages.compras = 1; renderCompras(); });
  $('#buyHist').addEventListener('click', function (e) {
    var b = e.target.closest('[data-bvoid]');
    if (!b) return;
    var m = buyMonthIn.value || monthKey();
    var c = P.months[m].compras.filter(function (x) { return x.id === b.dataset.bvoid; })[0];
    A.ask({ title: '¿Anular esta compra?', text: 'Se descuenta del stock lo que se había sumado con la compra a ' + c.proveedor.nombre + ' (' + money(c.total) + ').', ok: 'Sí, anular', danger: true })
      .then(function (ok) {
        if (!ok) return;
        c.estado = 'anulada';
        c.anulada_en = new Date().toISOString();
        applyStock(c.items, -1);
        A.renderAll();
        renderCompras();
        save([A.DATA_PATH, monthPath(m)], 'Anular compra a ' + c.proveedor.nombre);
      });
  });

  /* =================================================================
     DATOS DE FACTURACIÓN
     ================================================================= */
  function fillFiscalForm() {
    if (!P.ajustes) return;
    var f = P.ajustes.fiscal;
    $('#fRuc').value = f.ruc; $('#fTel').value = f.telefono; $('#fRazon').value = f.razon; $('#fFant').value = f.fantasia;
    $('#fDir').value = f.direccion; $('#fAct').value = f.actividad; $('#fTimb').value = f.timbrado; $('#fVig').value = f.vigencia;
    $('#fEst').value = f.est; $('#fPto').value = f.pto; $('#fNext').value = A.fmtNum(P.ajustes.next || 1);
    $('#fAncho').value = String(P.ajustes.ticket.ancho || 80); $('#fAuto').checked = !!P.ajustes.ticket.auto;
  }
  $('#fiscalForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!A.connected()) { A.showMsg('error', A.NEED_CONN); return; }
    var ruc = $('#fRuc').value.trim().replace(/[.\s]/g, '');
    if (ruc && !/^\d{3,10}-\d$/.test(ruc)) { A.showMsg('error', 'El RUC debe tener el dígito verificador, por ejemplo 80012345-6.'); return; }
    var btn = this.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await loadPrivate();
      Object.assign(P.ajustes.fiscal, {
        ruc: ruc, telefono: $('#fTel').value.trim(), razon: $('#fRazon').value.trim(), fantasia: $('#fFant').value.trim(),
        direccion: $('#fDir').value.trim(), actividad: $('#fAct').value.trim(), timbrado: $('#fTimb').value.replace(/\D/g, ''),
        vigencia: $('#fVig').value, est: pad($('#fEst').value.replace(/\D/g, '') || '1', 3), pto: pad($('#fPto').value.replace(/\D/g, '') || '1', 3)
      });
      P.ajustes.next = Math.max(1, num($('#fNext').value) || 1);
      P.ajustes.ticket = { ancho: +$('#fAncho').value, auto: $('#fAuto').checked };
      fillFiscalForm();
      await A.writeFiles([AJ_PATH], 'Actualizar datos de facturación');
      A.showMsg('ok', 'Datos de facturación guardados.');
    } catch (err) {
      A.showMsg('error', err.message || String(err));
    } finally {
      btn.disabled = false;
    }
  });

  /* =================================================================
     Factura electrónica con FactuFlex (proveedor SIFEN)
     ================================================================= */
  function ffCfg() {
    if (!P.ajustes) P.ajustes = defaultAjustes();
    P.ajustes.factuflex = Object.assign(defaultAjustes().factuflex, P.ajustes.factuflex || {});
    return P.ajustes.factuflex;
  }
  function ffReady() { if (!P.ajustes) return false; var c = ffCfg(); return !!(c.activo && c.url && c.usuario && c.clave); }
  /* Busca un dato dentro de la respuesta, sin importar dónde venga */
  function findKey(obj, names) {
    var want = names.map(function (n) { return n.toLowerCase(); }), queue = [obj], seen = 0;
    while (queue.length && seen++ < 500) {
      var o = queue.shift();
      if (!o || typeof o !== 'object') continue;
      var keys = Object.keys(o);
      for (var i = 0; i < want.length; i++) {
        for (var k = 0; k < keys.length; k++) {
          var v = o[keys[k]];
          if (keys[k].toLowerCase() === want[i] && v != null && v !== '' && typeof v !== 'object') return v;
        }
      }
      keys.forEach(function (k) { if (o[k] && typeof o[k] === 'object') queue.push(o[k]); });
    }
    return null;
  }
  /* Igual que findKey, pero devuelve una lista de textos (por ejemplo, los errores) */
  function findList(obj, names) {
    var want = names.map(function (n) { return n.toLowerCase(); }), queue = [obj], seen = 0;
    while (queue.length && seen++ < 500) {
      var o = queue.shift();
      if (!o || typeof o !== 'object') continue;
      var keys = Object.keys(o);
      for (var k = 0; k < keys.length; k++) {
        if (want.indexOf(keys[k].toLowerCase()) !== -1 && Array.isArray(o[keys[k]]) && o[keys[k]].length) {
          return o[keys[k]].map(function (x) { return typeof x === 'object' ? (findKey(x, ['mensaje', 'message', 'descripcion']) || JSON.stringify(x)) : String(x); });
        }
      }
      keys.forEach(function (k) { if (o[k] && typeof o[k] === 'object') queue.push(o[k]); });
    }
    return [];
  }
  var ffToken = '', ffTokenExp = 0;
  function jwtExp(t) {
    try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000; }
    catch (e) { return Date.now() + 20 * 60000; }
  }
  async function ffFetch(path, opts) {
    var url = ffCfg().url.replace(/\/+$/, '') + path;
    try { return await fetch(url, opts); }
    catch (e) {
      throw new Error('No se pudo conectar con FactuFlex. Si tu internet funciona, FactuFlex tiene que habilitar el acceso (CORS) para ' + location.origin + '.');
    }
  }
  async function ffLogin(force) {
    if (!force && ffToken && Date.now() < ffTokenExp - 60000) return ffToken;
    var c = ffCfg(), last = '';
    var paths = ['/auth/token', '/auth/authenticate'];
    for (var i = 0; i < paths.length; i++) {
      var r = await ffFetch(paths[i], { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: c.usuario, password: c.clave }) });
      var txt = await r.text();
      if (!r.ok) { last = 'error ' + r.status; continue; }
      var tok = null;
      try { var j = JSON.parse(txt); tok = typeof j === 'string' ? j : findKey(j, ['token', 'accessToken', 'access_token', 'jwt', 'id_token']); }
      catch (e) { tok = txt.trim(); }
      if (tok && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(String(tok))) { ffToken = String(tok); ffTokenExp = jwtExp(ffToken); return ffToken; }
      last = 'respuesta sin token';
    }
    throw new Error('FactuFlex no aceptó el usuario o la contraseña (' + last + ').');
  }
  async function ffApi(path, method, body) {
    for (var attempt = 0; attempt < 2; attempt++) {
      var tok = await ffLogin(attempt > 0);
      var h = { 'Authorization': 'Bearer ' + tok };
      if (body) h['Content-Type'] = 'application/json';
      var r = await ffFetch(path, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined });
      if ((r.status === 401 || r.status === 403) && attempt === 0) continue;
      return r;
    }
  }
  async function ffJson(r) {
    var t = await r.text(), j = null;
    try { j = JSON.parse(t); } catch (e) { /* texto plano */ }
    if (!r.ok) {
      var msg = j ? (findKey(j, ['mensaje', 'message', 'error', 'detalle', 'descripcion', 'msg']) || t) : t;
      throw new Error('FactuFlex: ' + String(msg || ('error ' + r.status)).slice(0, 300));
    }
    return j !== null ? j : t;
  }
  function ffBody(sale) {
    var c = sale.cliente, receptor = { nombre: c.nombre || 'Sin nombre' };
    if (c.tipo === 'ruc') receptor.ruc = c.doc + (c.dv ? '-' + c.dv : '');
    else if (c.tipo === 'ci') receptor.documento = c.doc;
    if (c.email) receptor.email = c.email;
    var monto = sale.totales.total, contado = {};
    if (sale.pago.forma === 'transferencia') contado.transferencia = { monto: monto, banco: sale.pago.banco, numero: sale.pago.comprobante };
    else contado.efectivo = { monto: monto };
    return {
      receptor: receptor, tipoDocumento: 'FACTURA', moneda: 'PYG', pago: { contado: contado },
      itens: sale.items.map(function (it) {
        return { codigo: String(it.codigo || it.product_id || '1'), descripcion: it.descripcion, cantidad: it.cantidad,
                 iva: it.iva == null ? 10 : +it.iva, precioUnitario: it.precio, unidadMedida: 'UNIDAD' };
      })
    };
  }
  function numFromCdc(cdc) {
    return /^\d{44}$/.test(cdc) ? cdc.substr(11, 3) + '-' + cdc.substr(14, 3) + '-' + cdc.substr(17, 7) : '';
  }
  async function ffEmit(sale) {
    var j = await ffJson(await ffApi('/factuflex/emitir', 'POST', ffBody(sale)));
    var cdc = String(findKey(j, ['cdc', 'codigoControl', 'id_cdc']) || '');
    var estado = findKey(j, ['estado', 'status', 'situacion', 'estadoSifen']);
    var errores = findList(j, ['errores', 'errors', 'observaciones']);
    sale.sifen = { estado: estado ? String(estado) : (cdc ? 'enviado' : 'pendiente'), cdc: cdc,
                   id: String(findKey(j, ['id', 'idDocumento', 'idDe']) || ''), mensaje: String(findKey(j, ['mensaje', 'message']) || ''),
                   enviado: new Date().toISOString() };
    if (!cdc) {
      var why = errores.length ? errores.join(' ') : JSON.stringify(j).slice(0, 200);
      sale.sifen.estado = 'rechazada';
      sale.sifen.mensaje = why;
      var err = new Error('La factura fue rechazada: ' + why);
      err.sifen = true;
      throw err;
    }
    var n = numFromCdc(cdc);
    if (n) { sale.numeroLocal = sale.numeroLocal || sale.numero; sale.numero = n; }
    return sale;
  }
  async function ffStatus(sale) {
    var j = await ffJson(await ffApi('/historico/consulta/cdc/' + encodeURIComponent(sale.sifen.cdc), 'GET'));
    var last = Array.isArray(j) ? j[j.length - 1] : j;
    var est = findKey(last, ['estado', 'status', 'situacion', 'estadoSifen', 'descripcion']);
    if (est) sale.sifen.estado = String(est);
    sale.sifen.consultado = new Date().toISOString();
    return sale;
  }
  async function ffCancel(sale, motivo) {
    await ffJson(await ffApi('/evento/emisor/cancelacion', 'POST', { motivo: motivo, cdc: sale.sifen.cdc }));
    sale.sifen.estado = 'cancelado';
  }
  async function ffKude(sale) {
    var r = await ffApi('/de/kude/cdc/' + encodeURIComponent(sale.sifen.cdc), 'GET');
    if (!r.ok) throw new Error('KuDE no disponible (' + r.status + ')');
    var ct = (r.headers.get('content-type') || '').toLowerCase();
    if (/pdf|octet-stream/.test(ct)) return new Blob([await r.arrayBuffer()], { type: 'application/pdf' });
    var j = JSON.parse(await r.text());
    var b = findKey(j, ['kude', 'pdf', 'base64', 'archivo', 'contenido', 'data']);
    if (!b) throw new Error('KuDE sin PDF');
    var bin = atob(String(b).replace(/^data:[^,]+,/, '').replace(/\s/g, '')), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: 'application/pdf' });
  }
  /* PDF del comprobante: el KuDE oficial si la factura ya tiene CDC, si no el propio */
  async function docPdf(sale) {
    if (isFactura(sale) && sale.sifen && sale.sifen.cdc && ffReady()) {
      try { return await ffKude(sale); } catch (e) { console.warn('KuDE:', e); }
    }
    return makePdf(sale);
  }
  function saveSale(sale, msg) {
    var m = monthKey(new Date(sale.fecha));
    if (P.months[m]) { ensureMonthSource(m); save([monthPath(m)], msg); }
  }
  function sifenBadge(v) {
    var s = v.sifen || {}, est = lower(s.estado || 'pendiente');
    var cls = /aprob/.test(est) ? 'ok' : /rechaz|error|cancel/.test(est) ? 'bad' : 'wait';
    var txt = s.cdc ? 'SIFEN: ' + (s.estado || 'enviado') : (s.estado === 'rechazada' ? 'SIFEN: rechazada' : s.estado === 'error' ? 'SIFEN: error' : 'SIFEN: sin enviar');
    if (!s.cdc && s.estado !== 'rechazada' && s.estado !== 'error') cls = 'wait';
    return '<span class="sifen-tag is-' + cls + '" title="' + esc(s.cdc ? 'CDC ' + s.cdc : (s.mensaje || '')) + '">' + esc(txt) + '</span>' +
      (!s.cdc && s.mensaje && (s.estado === 'rechazada' || s.estado === 'error') ? '<span class="sifen-why">' + esc(String(s.mensaje).slice(0, 120)) + '</span>' : '');
  }
  function sifenAfterSale(sale) {
    var box = $('#doneSifenState');
    box.hidden = false; box.className = 'done-mail'; box.textContent = 'Enviando la factura al SIFEN…';
    ffEmit(sale).then(function () {
      box.className = 'done-mail is-ok';
      box.textContent = 'Factura ' + sale.numero + ' en el SIFEN (' + sale.sifen.estado + ').';
      $('#doneNum').textContent = 'N° ' + sale.numero + ' · Total ' + money(sale.totales.total) + ' · ' + PAY[sale.pago.forma];
      saveSale(sale, 'SIFEN · ' + sale.numero);
      autoEmail(sale);
    }, function (e) {
      if (!e.sifen) sale.sifen = Object.assign(sale.sifen || {}, { estado: 'error', mensaje: e.message });
      saveSale(sale, 'SIFEN con error · ' + sale.numero);
      box.className = 'done-mail is-warn';
      box.textContent = (e.sifen ? e.message : 'No se pudo enviar al SIFEN: ' + e.message) + ' Corregilo y reintentá desde Ventas con «Enviar al SIFEN».';
      if (!$('#doneDlg').open) notify('error', 'Factura ' + sale.numero + ': ' + e.message);
    });
  }

  function fillFfForm() {
    if (!P.ajustes) return;
    var c = ffCfg();
    $('#ffUrl').value = c.url; $('#ffUser').value = c.usuario; $('#ffPass').value = c.clave; $('#ffOn').checked = !!c.activo;
  }
  function readFfForm() {
    return { url: $('#ffUrl').value.trim() || defaultAjustes().factuflex.url, usuario: $('#ffUser').value.trim(),
             clave: $('#ffPass').value, activo: $('#ffOn').checked };
  }
  $('#ffForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!A.connected()) { A.showMsg('error', A.NEED_CONN); return; }
    var btn = this.querySelector('button[type=submit]'), c = readFfForm();
    if (c.activo && (!c.usuario || !c.clave)) { A.showMsg('error', 'Completá el usuario y la contraseña de FactuFlex.'); return; }
    btn.disabled = true;
    try {
      await loadPrivate();
      P.ajustes.factuflex = c;
      ffToken = '';
      await A.writeFiles([AJ_PATH], 'Configurar FactuFlex');
      A.showMsg('ok', c.activo ? 'FactuFlex activado: las facturas se envían al SIFEN al cobrar.' : 'Datos de FactuFlex guardados (desactivado).');
    } catch (err) {
      A.showMsg('error', err.message || String(err));
    } finally { btn.disabled = false; }
  });
  $('#ffTest').addEventListener('click', async function () {
    var btn = this, saved = P.ajustes ? P.ajustes.factuflex : null;
    if (!P.ajustes) P.ajustes = defaultAjustes();
    P.ajustes.factuflex = Object.assign(readFfForm(), { activo: true });
    if (!P.ajustes.factuflex.usuario || !P.ajustes.factuflex.clave) { P.ajustes.factuflex = saved || P.ajustes.factuflex; A.showMsg('error', 'Completá el usuario y la contraseña de FactuFlex.'); return; }
    btn.disabled = true; btn.textContent = 'Probando…';
    try {
      ffToken = '';
      await ffLogin(true);
      var info = '';
      try {
        var cfg = await ffJson(await ffApi('/configuracion/cargar', 'GET'));
        var rs = findKey(cfg, ['razonSocial', 'nombreEmpresa', 'empresa', 'nombre']), ruc = findKey(cfg, ['ruc']);
        if (rs || ruc) info = ' Empresa: ' + [rs, ruc ? 'RUC ' + ruc : ''].filter(Boolean).join(' · ') + '.';
      } catch (er) { /* el ingreso ya funcionó */ }
      A.showMsg('ok', 'Conexión correcta con FactuFlex.' + info + ' Si está todo bien, marcá «Emitir facturas…» y tocá Guardar.');
    } catch (err) {
      A.showMsg('error', err.message || String(err));
    } finally {
      P.ajustes.factuflex = saved || P.ajustes.factuflex;
      btn.disabled = false; btn.textContent = 'Probar conexión';
    }
  });

  /* ---------------- envío automático por correo (EmailJS) ---------------- */
  function fillMailForm() {
    if (!P.ajustes) return;
    var c = mailCfg();
    $('#mService').value = c.service; $('#mTemplate').value = c.template; $('#mKey').value = c.key;
    $('#mAuto').checked = !!c.auto; $('#mTickets').checked = !!c.tickets;
  }
  function readMailForm() {
    return { service: $('#mService').value.trim(), template: $('#mTemplate').value.trim(), key: $('#mKey').value.trim(),
             auto: $('#mAuto').checked, tickets: $('#mTickets').checked };
  }
  $('#mailForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!A.connected()) { A.showMsg('error', A.NEED_CONN); return; }
    var btn = this.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await loadPrivate();
      P.ajustes.correo = readMailForm();
      await A.writeFiles([AJ_PATH], 'Configurar envío por correo');
      A.showMsg('ok', 'Envío por correo guardado.' + (mailReady() ? '' : ' Faltan datos de EmailJS: por ahora no se envía nada.'));
    } catch (err) {
      A.showMsg('error', err.message || String(err));
    } finally {
      btn.disabled = false;
    }
  });
  $('#mTestBtn').addEventListener('click', async function () {
    var to = $('#mTest').value.trim(), btn = this;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { A.showMsg('error', 'Escribí un correo válido para la prueba.'); $('#mTest').focus(); return; }
    var saved = P.ajustes ? P.ajustes.correo : null;
    if (!P.ajustes) P.ajustes = defaultAjustes();
    P.ajustes.correo = readMailForm();
    if (!mailReady()) { P.ajustes.correo = saved || P.ajustes.correo; A.showMsg('error', 'Completá Service ID, Template ID y Public Key.'); return; }
    btn.disabled = true; btn.textContent = 'Enviando…';
    try {
      var demo = { tipo: 'factura', numero: '001-001-0000000', fecha: new Date().toISOString(), estado: 'emitida',
        fiscal: { timbrado: (P.ajustes.fiscal.timbrado || '00000000') }, sifen: { estado: 'prueba', cdc: '' },
        cliente: { tipo: 'innominado', nombre: 'Prueba', doc: '', dv: '' },
        items: [{ descripcion: 'Producto de prueba', cantidad: 1, precio: 100000, subtotal: 100000 }],
        totales: { total: 100000 }, pago: { forma: 'efectivo' }, recibido: 100000, vuelto: 0 };
      var mc = mailContent(demo);
      await emailjsSend({ to_email: to, to_name: 'Prueba', subject: 'Prueba · ' + mc.subject, message: mc.body,
                          store_name: S.data.store.store_name, pdf: await blobToDataURL(await makePdf(demo)), pdf_name: 'prueba.pdf' });
      A.showMsg('ok', 'Correo de prueba enviado a ' + to + '. Revisá la bandeja de entrada (y la de spam). Si llegó bien, tocá Guardar.');
    } catch (err) {
      A.showMsg('error', err.message || String(err));
    } finally {
      P.ajustes.correo = saved || P.ajustes.correo;
      btn.disabled = false; btn.textContent = 'Enviar correo de prueba';
    }
  });


  /* ---------------- Borrar datos de prueba ---------------- */
  $('#rsBtn').addEventListener('click', async function () {
    if (!A.connected()) { A.showMsg('error', A.NEED_CONN); return; }
    if ($('#rsConfirm').value.trim().toUpperCase() !== 'BORRAR') { A.showMsg('error', 'Para confirmar escribí BORRAR en el campo.'); $('#rsConfirm').focus(); return; }
    var zeroStock = $('#rsStock').checked;
    var ok = await A.ask({ title: '¿Borrar los datos de prueba?', danger: true, ok: 'Sí, borrar todo',
      text: 'Se borran todas las ventas, compras y cajas, y la numeración vuelve a 1.' + (zeroStock ? ' El stock de todos los productos queda en 0.' : '') + ' No se puede deshacer.' });
    if (!ok) return;
    var btn = this;
    btn.disabled = true; btn.textContent = 'Borrando…';
    try {
      await loadPrivate();
      var list = await A.getFile('data/privado'), paths = [AJ_PATH, CAJA_PATH];
      (Array.isArray(list) ? list : []).forEach(function (f) {
        var mm = /^mov-(\d{4}-\d{2})\.json$/.exec(f.name);
        if (mm) { P.months[mm[1]] = { ventas: [], compras: [] }; ensureMonthSource(mm[1]); paths.push(monthPath(mm[1])); }
      });
      Object.keys(P.months).forEach(function (m) { P.months[m] = { ventas: [], compras: [] }; ensureMonthSource(m); if (paths.indexOf(monthPath(m)) === -1) paths.push(monthPath(m)); });
      P.caja = { abiertas: { efectivo: null, transferencia: null }, cierres: [] };
      P.ajustes.next = 1; P.ajustes.nextTicket = 1;
      if (zeroStock) {
        products().forEach(function (p) { p.stock = 0; (p.sizes || []).forEach(function (s) { s.stock = 0; }); });
        paths.push(A.DATA_PATH);
      }
      await A.writeFiles(paths, 'Borrar datos de prueba');
      fillFiscalForm();
      A.renderAll();
      if (A.V.hooks.cajaWarn) A.V.hooks.cajaWarn();
      $('#rsConfirm').value = ''; $('#rsStock').checked = false;
      A.showMsg('ok', 'Listo: se borraron los datos de prueba. Abrí la caja y empezá a vender con datos reales.');
    } catch (e) {
      A.showMsg('error', e.message || String(e));
    } finally {
      btn.disabled = false; btn.textContent = 'Borrar datos de prueba';
    }
  });

  /* Lo que usa assets/caja.js (Caja y Reportes) */
  A.V = { P: P, CAJA_PATH: CAJA_PATH, save: save, loadPrivate: loadPrivate, loadMonth: loadMonth, monthKey: monthKey,
          fmtDate: fmtDate, pad: pad, kpi: kpi, paginate: paginate, renderPager: renderPager, isFactura: isFactura,
          findP: findP, products: products, hasSizes: hasSizes, download: download, pages: pages, loadPdfLib: loadPdfLib, hooks: {} };

  /* ---------------- conexión con el panel ---------------- */
  A.on('ready', function () {
    renderCart();
    renderClient();
    renderSaveState();
    if (A.connected()) loadPrivate().catch(function (e) { A.showMsg('error', e.message); });
  });
  A.on('tab', function (name) {
    if (name === 'vender') setTimeout(function () { focusQ(); }, 30);
    if (name === 'ventas') renderVentas();
    if (name === 'compras') { renderCompras(); setTimeout(function () { $('#buyQ').focus(); }, 30); }
  });
})();