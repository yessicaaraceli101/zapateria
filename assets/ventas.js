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

  var AJ_PATH = 'data/privado/ajustes.json';
  var PAY = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', qr: 'QR / billetera' };
  var P = { ajustes: null, months: {}, loading: null };
  var cart = [], payMethod = 'efectivo';
  var client = { tipo: 'innominado', doc: '', dv: '', nombre: '', email: '' };
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
      ticket: { auto: false, ancho: 80 }
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
      var res = await Promise.all([readPrivate(AJ_PATH), readPrivate(monthPath(m))]);
      var d = defaultAjustes(), aj = res[0] || {};
      P.ajustes = Object.assign(d, aj, {
        fiscal: Object.assign(d.fiscal, aj.fiscal || {}),
        ticket: Object.assign(d.ticket, aj.ticket || {})
      });
      P.months[m] = res[1] || { ventas: [], compras: [] };
      ensureMonthSource(m);
      fillFiscalForm();
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
      var hay = lower([p.name, p.brand, p.code, p.sku, p.category, p.colors].join(' '));
      return words.every(function (w) { return hay.indexOf(w) !== -1; });
    }).slice(0, limit || 8);
  }
  function exactCode(q) {
    var k = lower(String(q).trim());
    if (!k) return null;
    return products().filter(function (p) {
      return (p.code && lower(p.code) === k) || (p.sku && lower(p.sku) === k);
    })[0] || null;
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
    function (q) { flash('error', 'No se encontró ningún producto con «' + q + '».'); });

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
    var iva = [];
    if (t.iva10) iva.push('IVA 10 %: ' + money(t.iva10));
    if (t.iva5) iva.push('IVA 5 %: ' + money(t.iva5));
    if (t.exenta) iva.push('Exentas: ' + money(t.exenta));
    $('#posIva').textContent = iva.join(' · ');
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
      if (payMethod !== 'efectivo') paidIn.value = '';
      updateChange();
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
    if (client.tipo === 'innominado') { client.doc = client.dv = client.nombre = client.email = ''; return; }
    var raw = $('#cDoc').value.trim().replace(/[.\s]/g, '');
    var m = raw.match(/^(\d+)-?(\d)?$/);
    if (client.tipo === 'ruc' && m && m[2] != null) { client.doc = m[1]; client.dv = m[2]; }
    else { client.doc = raw.replace(/-/g, ''); client.dv = ''; }
    client.nombre = $('#cName').value.trim();
    client.email = $('#cMail').value.trim();
  }
  $('#clientOk').addEventListener('click', function () {
    readClient();
    $('#clientForm').hidden = true;
    renderClient();
    focusQ();
  });
  ['#cDoc', '#cName', '#cMail'].forEach(function (id) {
    $(id).addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('#clientOk').click(); } });
  });

  function resetSale() {
    cart = [];
    paidIn.value = '';
    client = { tipo: 'innominado', doc: '', dv: '', nombre: '', email: '' };
    $('#cDoc').value = ''; $('#cName').value = ''; $('#cMail').value = '';
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

      var aj = P.ajustes, f = aj.fiscal, n = Math.max(1, +aj.next || 1);
      aj.next = n + 1;
      var fiscal = !!(f.ruc && f.timbrado);
      var numero = fiscal ? pad(f.est || '1', 3) + '-' + pad(f.pto || '1', 3) + '-' + pad(n, 7) : 'V-' + pad(n, 6);
      var sale = {
        id: A.rid(), numero: numero, nro: n, fecha: new Date().toISOString(),
        cliente: { tipo: client.tipo, doc: client.doc, dv: client.dv, nombre: client.nombre, email: client.email },
        items: cart.map(function (l) {
          return { product_id: l.pid, codigo: l.code, descripcion: l.name + (l.talle ? ' T. ' + l.talle : ''), talle: l.talle,
                   cantidad: l.qty, precio: l.price, iva: l.iva, subtotal: l.qty * l.price };
        }),
        totales: t, condicion: 'contado',
        pago: { forma: payMethod, monto: t.total }, recibido: paid, vuelto: payMethod === 'efectivo' ? paid - t.total : 0,
        estado: 'emitida', usuario: S.user,
        fiscal: fiscal ? { timbrado: f.timbrado, est: pad(f.est || '1', 3), pto: pad(f.pto || '1', 3) } : null,
        sifen: { estado: 'pendiente', cdc: '' }
      };
      applyStock(sale.items, -1);
      P.months[m].ventas.push(sale);
      A.renderAll();
      resetSale();
      showDone(sale);
      save([A.DATA_PATH, AJ_PATH, monthPath(m)], 'Venta ' + numero + ' · ' + money(t.total));
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
    $('#doneNum').textContent = 'N° ' + sale.numero + ' · Total ' + money(sale.totales.total) + ' · ' + PAY[sale.pago.forma];
    $('#doneChangeBox').hidden = sale.pago.forma !== 'efectivo';
    $('#doneChange').textContent = money(sale.vuelto);
    $('#donePrint').onclick = function () { printTicket(sale); };
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
    h += L('<span class="b">' + (sale.fiscal ? 'Comprobante' : 'Ticket') + '</span>', '<span class="b">' + esc(sale.numero) + '</span>');
    h += L('Fecha', esc(fmtDate(sale.fecha, true)));
    var c = sale.cliente;
    h += L('Cliente', c.tipo === 'innominado' ? 'Consumidor final' : esc((c.nombre || '') + ' ' + (c.tipo === 'ruc' ? 'RUC ' : 'CI ') + c.doc + (c.dv ? '-' + c.dv : '')));
    h += '<div class="hr"></div>';
    sale.items.forEach(function (it) {
      h += '<div class="it">' + esc(it.descripcion) + (it.iva === 0 ? ' (Ex.)' : it.iva === 5 ? ' (5%)' : '') +
        L(it.cantidad + ' x ' + money(it.precio).replace('Gs. ', ''), money(it.subtotal).replace('Gs. ', '')) + '</div>';
    });
    h += '<div class="hr"></div>';
    h += '<div class="big b">' + L('TOTAL', money(sale.totales.total)) + '</div>';
    h += '<div class="hr"></div>';
    if (sale.totales.gravada10) h += L('Gravada 10%', money(sale.totales.gravada10).replace('Gs. ', ''));
    if (sale.totales.gravada5) h += L('Gravada 5%', money(sale.totales.gravada5).replace('Gs. ', ''));
    if (sale.totales.exenta) h += L('Exenta', money(sale.totales.exenta).replace('Gs. ', ''));
    h += L('Liq. IVA 10%', money(sale.totales.iva10).replace('Gs. ', ''));
    if (sale.totales.iva5) h += L('Liq. IVA 5%', money(sale.totales.iva5).replace('Gs. ', ''));
    h += '<div class="hr"></div>';
    h += L('Pago', esc(PAY[sale.pago.forma]));
    if (sale.pago.forma === 'efectivo') { h += L('Recibido', money(sale.recibido)); h += L('Vuelto', money(sale.vuelto)); }
    if (sale.estado === 'anulada') h += '<div class="hr"></div><div class="c b">*** ANULADA ***</div>';
    h += '<div class="hr"></div><div class="c">¡Gracias por tu compra!</div>';
    if (!(sale.sifen && sale.sifen.cdc)) h += '<div class="c" style="font-size:10px;margin-top:4px">Comprobante interno, no válido como factura.</div>';
    else h += '<div class="c" style="font-size:10px;margin-top:4px">CDC ' + esc(sale.sifen.cdc) + '</div>';
    return h + '</body></html>';
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
  async function renderVentas() {
    var m = saleMonthIn.value || monthKey(), body = $('#saleRows');
    if (!A.connected()) { body.innerHTML = '<tr><td colspan="7" class="tbl-empty">' + esc(A.NEED_CONN) + '</td></tr>'; $('#saleKpis').innerHTML = ''; return; }
    if (!P.months[m]) body.innerHTML = '<tr><td colspan="7" class="tbl-empty">Cargando…</td></tr>';
    var data;
    try { data = await loadMonth(m); } catch (e) { body.innerHTML = '<tr><td colspan="7" class="tbl-empty">' + esc(e.message) + '</td></tr>'; return; }
    var ventas = data.ventas.slice().reverse();
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
    if (!ventas.length) { body.innerHTML = '<tr><td colspan="7" class="tbl-empty">No hay ventas en este mes.</td></tr>'; return; }
    body.innerHTML = ventas.map(function (v) {
      var c = v.cliente;
      var cli = c.tipo === 'innominado' ? 'Consumidor final' : (c.nombre || '') + ' · ' + (c.tipo === 'ruc' ? 'RUC ' : 'CI ') + c.doc + (c.dv ? '-' + c.dv : '');
      return '<tr class="' + (v.estado === 'anulada' ? 'is-void' : '') + '">' +
        '<td class="nowrap"><strong>' + esc(v.numero) + '</strong></td>' +
        '<td class="nowrap">' + esc(fmtDate(v.fecha, true)) + '</td>' +
        '<td>' + esc(cli) + '<span class="t-sub">' + v.items.length + (v.items.length === 1 ? ' producto' : ' productos') + '</span></td>' +
        '<td>' + esc(PAY[v.pago.forma] || v.pago.forma) + '</td>' +
        '<td class="ta-r nowrap"><strong>' + money(v.totales.total) + '</strong></td>' +
        '<td>' + (v.estado === 'anulada' ? '<span class="pill pill-off">Anulada</span>' : '<span class="pill pill-on">Emitida</span>') + '</td>' +
        '<td class="actions"><button type="button" class="btn btn-secondary btn-sm" data-ticket="' + esc(v.id) + '">Ticket</button>' +
        (v.estado !== 'anulada' ? '<button type="button" class="btn btn-secondary btn-sm btn-void" data-void="' + esc(v.id) + '">Anular</button>' : '') + '</td></tr>';
    }).join('');
  }
  function fmtISODate(iso) { var d = new Date(iso); return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2); }
  function kpi(label, value, sub) {
    return '<div class="kpi"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong><small>' + esc(sub) + '</small></div>';
  }
  saleMonthIn.addEventListener('change', renderVentas);

  $('#saleRows').addEventListener('click', function (e) {
    var m = saleMonthIn.value || monthKey(), list = (P.months[m] || { ventas: [] }).ventas, b;
    var find = function (id) { return list.filter(function (v) { return v.id === id; })[0]; };
    if ((b = e.target.closest('[data-ticket]'))) { printTicket(find(b.dataset.ticket)); return; }
    if ((b = e.target.closest('[data-void]'))) {
      var v = find(b.dataset.void);
      A.ask({ title: '¿Anular la venta ' + v.numero + '?', text: 'Se devuelve el stock de los productos y la venta queda marcada como anulada. Total: ' + money(v.totales.total) + '.', ok: 'Sí, anular', danger: true })
        .then(function (ok) {
          if (!ok) return;
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

  $('#expCsv').addEventListener('click', async function () {
    var m = saleMonthIn.value || monthKey();
    try { await loadMonth(m); } catch (e) { A.showMsg('error', e.message); return; }
    var rows = [['Numero', 'Fecha', 'Cliente', 'Documento', 'Producto', 'Talle', 'Cantidad', 'Precio', 'Subtotal', 'IVA', 'Forma de pago', 'Estado']];
    P.months[m].ventas.forEach(function (v) {
      v.items.forEach(function (it) {
        rows.push([v.numero, fmtDate(v.fecha, true), v.cliente.tipo === 'innominado' ? 'Consumidor final' : v.cliente.nombre,
          v.cliente.doc ? v.cliente.doc + (v.cliente.dv ? '-' + v.cliente.dv : '') : '', it.descripcion, it.talle, it.cantidad, it.precio, it.subtotal,
          it.iva ? it.iva + '%' : 'Exenta', PAY[v.pago.forma] || v.pago.forma, v.estado]);
      });
    });
    var csv = rows.map(function (r) { return r.map(function (c) { c = String(c == null ? '' : c); return /[;"\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(';'); }).join('\r\n');
    download('ventas-' + m + '.csv', '\ufeff' + csv, 'text/csv;charset=utf-8');
  });

  /* Archivo con la estructura de datos que pide el SIFEN (factura electrónica de Paraguay) */
  $('#expSifen').addEventListener('click', async function () {
    var m = saleMonthIn.value || monthKey();
    try { await loadMonth(m); } catch (e) { A.showMsg('error', e.message); return; }
    var f = P.ajustes.fiscal, rucParts = String(f.ruc || '').split('-');
    var docs = P.months[m].ventas.filter(function (v) { return v.estado !== 'anulada'; }).map(function (v) {
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
        pagos: [{ tipo: v.pago.forma, monto: v.pago.monto }],
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
        return '<tr data-b="' + i + '"><td><strong>' + esc(it.name) + '</strong></td>' +
          '<td>' + (it.sizes ? '<input data-f="talle" list="' + listId + '" value="' + esc(it.talle) + '" class="in-sm" placeholder="Talle">' +
            '<datalist id="' + listId + '">' + it.sizes.map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') + '</datalist>' : '<span class="t-sub">—</span>') + '</td>' +
          '<td><input data-f="qty" class="in-sm js-num" inputmode="numeric" value="' + A.fmtNum(it.qty) + '"></td>' +
          '<td><input data-f="cost" class="in-md js-num" inputmode="numeric" value="' + (it.cost ? A.fmtNum(it.cost) : '') + '" placeholder="0"></td>' +
          '<td class="ta-r nowrap" data-sub>' + money(it.qty * it.cost) + '</td>' +
          '<td><button type="button" class="row-x" data-brm aria-label="Quitar">×</button></td></tr>';
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
        estado: 'registrada', usuario: S.user
      };
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
    var list = data.compras.slice().reverse();
    if (!list.length) { body.innerHTML = '<tr><td colspan="7" class="tbl-empty">No hay compras en este mes.</td></tr>'; return; }
    body.innerHTML = list.map(function (c) {
      var units = c.items.reduce(function (t, x) { return t + x.cantidad; }, 0);
      return '<tr class="' + (c.estado === 'anulada' ? 'is-void' : '') + '">' +
        '<td class="nowrap">' + esc(fmtDate(c.fecha)) + '</td>' +
        '<td>' + esc(c.proveedor.nombre) + (c.proveedor.ruc ? '<span class="t-sub">RUC ' + esc(c.proveedor.ruc) + '</span>' : '') + '</td>' +
        '<td>' + esc(c.factura || '—') + '</td>' +
        '<td>' + units + (units === 1 ? ' unidad' : ' unidades') + '<span class="t-sub">' + esc(c.items.map(function (x) { return x.descripcion; }).join(', ')) + '</span></td>' +
        '<td class="ta-r nowrap"><strong>' + money(c.total) + '</strong></td>' +
        '<td>' + (c.estado === 'anulada' ? '<span class="pill pill-off">Anulada</span>' : '<span class="pill pill-on">Registrada</span>') + '</td>' +
        '<td class="actions">' + (c.estado !== 'anulada' ? '<button type="button" class="btn btn-secondary btn-sm btn-void" data-bvoid="' + esc(c.id) + '">Anular</button>' : '') + '</td></tr>';
    }).join('');
  }
  buyMonthIn.addEventListener('change', renderCompras);
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