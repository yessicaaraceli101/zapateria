/* =================================================================
   Caja (apertura, ingresos y retiros, cierre) y Reportes
   Usa los datos y funciones que comparte assets/ventas.js (A.V).
   Los cierres de caja se guardan CIFRADOS en data/privado/cajas.json.
   ================================================================= */
(function () {
  'use strict';
  var A = window.ZA;
  if (!A || !A.V) return;
  var V = A.V, P = V.P, CAJA_PATH = V.CAJA_PATH;
  var S = A.S, $ = A.$, $$ = A.$$, esc = A.esc, money = A.money, num = A.num;
  var save = V.save, loadPrivate = V.loadPrivate, loadMonth = V.loadMonth, monthKey = V.monthKey, fmtDate = V.fmtDate,
      pad = V.pad, kpi = V.kpi, paginate = V.paginate, renderPager = V.renderPager, isFactura = V.isFactura,
      findP = V.findP, products = V.products, hasSizes = V.hasSizes, download = V.download, pages = V.pages, loadPdfLib = V.loadPdfLib;

  /* Carga el contenido de Caja y Reportes (caja.html) dentro del panel y después lo activa */
  fetch('caja.html', { cache: 'no-store' }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  }).then(function (html) {
    $('#cajaMount').outerHTML = html;
    try { start(); } catch (e) { console.error(e); A.showMsg('error', 'Error en Caja: ' + (e.message || e)); return; }
    var tab = (location.hash || '').slice(1);
    if (tab === 'caja' || tab === 'reportes') {
      $$('[data-tab]').forEach(function (a) { if (a.dataset.tab === tab) a.click(); });
    }
  }).catch(function () {
    A.showMsg('error', 'No se pudo cargar caja.html. Revisá que el archivo esté en la carpeta principal.');
  });

  function start() {
    /* =================================================================
       CAJA: dos cajas (efectivo y transferencias), recaudado y reporte diario
       ================================================================= */
    var TIPOS = { efectivo: 'Efectivo', transferencia: 'Transferencia' };
    var ICON_CASH = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 10v4M18 10v4"/></svg>';
    var ICON_TRANSFER = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3l4 4-4 4"/><path d="M3 7h18"/><path d="M7 21l-4-4 4-4"/><path d="M21 17H3"/></svg>';
    var ICON_OPEN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>';
    var ICON_LOCK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
    var ui = { efectivo: null, transferencia: null };

    function isoDay(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2); }
    function dayOf(iso) { return isoDay(new Date(iso)); }
    function todayKey() { return isoDay(new Date()); }

    /* Pasa los datos viejos (una sola caja) al formato de dos cajas */
    function norm() {
      if (!P.caja) return null;
      var c = P.caja;
      if (!c.abiertas) c.abiertas = { efectivo: c.abierta ? Object.assign({ tipo: 'efectivo' }, c.abierta) : null, transferencia: null };
      delete c.abierta;
      c.cierres = c.cierres || [];
      c.cierres.forEach(function (x) { if (!x.tipo) x.tipo = 'efectivo'; });
      ['efectivo', 'transferencia'].forEach(function (k) { if (c.abiertas[k] === undefined) c.abiertas[k] = null; });
      return c;
    }
    function cajaFor(method) {
      var c = norm();
      if (!c) return null;
      var k = method === 'transferencia' ? 'transferencia' : 'efectivo';
      return c.abiertas[k] ? c.abiertas[k].id : null;
    }
    function renderCajaWarn() {
      var el = $('#cajaWarn');
      if (!el) return;
      var c = norm();
      if (!c) { el.innerHTML = ''; return; }
      var cerradas = ['efectivo', 'transferencia'].filter(function (k) { return !c.abiertas[k]; });
      if (!cerradas.length) { el.innerHTML = ''; return; }
      var txt = cerradas.length === 2 ? '<strong>Las cajas están cerradas.</strong> Abrilas para empezar a vender.'
        : cerradas[0] === 'efectivo' ? '<strong>La caja de efectivo está cerrada.</strong> Solo se puede cobrar por transferencia.'
        : '<strong>La caja de transferencias está cerrada.</strong> Solo se puede cobrar en efectivo.';
      el.innerHTML = '<div class="caja-warn"><span>' + txt + '</span><button type="button" class="btn btn-accent" data-goto-caja>Ir a Caja</button></div>';
    }
    document.addEventListener('click', function (e) {
      if (!e.target.closest('[data-goto-caja]')) return;
      history.replaceState(null, '', '#caja');
      $$('[data-tab]').forEach(function (a) { if (a.dataset.tab === 'caja') a.click(); });
    });
    function monthsBetween(fromISO, toISO) {
      var a = new Date(fromISO), b = new Date(toISO), out = [];
      var d = new Date(a.getFullYear(), a.getMonth(), 1);
      while (d <= b) { out.push(monthKey(d)); d = new Date(d.getFullYear(), d.getMonth() + 1, 1); }
      return out;
    }
    /* Todos los movimientos manuales (de cajas abiertas y cerradas) */
    function allMovs() {
      var c = norm(), out = [];
      var take = function (cj) {
        (cj.movimientos || []).forEach(function (mv) {
          out.push({ caja: cj.tipo || 'efectivo', tipo: mv.tipo === 'ingreso' ? 'ingreso' : 'egreso', monto: +mv.monto || 0, motivo: mv.motivo, fecha: mv.fecha });
        });
      };
      ['efectivo', 'transferencia'].forEach(function (k) { if (c.abiertas[k]) take(c.abiertas[k]); });
      c.cierres.forEach(take);
      return out;
    }
    /* Suma ingresos y egresos por caja para las fechas que cumplen el filtro */
    function sumUp(ventas, movs, test, compras) {
      var r = { efectivo: { ing: 0, egr: 0, ventas: 0, compras: 0 }, transferencia: { ing: 0, egr: 0, ventas: 0, compras: 0 } };
      ventas.forEach(function (v) {
        if (v.estado === 'anulada' || !test(v.fecha)) return;
        var k = v.pago.forma === 'transferencia' ? 'transferencia' : 'efectivo';
        r[k].ing += v.totales.total; r[k].ventas++;
      });
      (compras || []).forEach(function (c) {
        if (c.estado === 'anulada' || !compraPaga(c) || !test(c.registrada || c.fecha)) return;
        var k = compraPaga(c);
        r[k].egr += c.total; r[k].compras++;
      });
      movs.forEach(function (mv) { if (test(mv.fecha)) r[mv.caja][mv.tipo === 'ingreso' ? 'ing' : 'egr'] += mv.monto; });
      ['efectivo', 'transferencia'].forEach(function (k) { r[k].saldo = r[k].ing - r[k].egr; });
      r.total = r.efectivo.saldo + r.transferencia.saldo;
      return r;
    }
    /* Caja de la que salió el pago de una compra (las viejas de contado se toman como efectivo) */
    function compraPaga(c) {
      if (c.pago) return c.pago;
      return c.condicion === 'credito' ? null : 'efectivo';
    }
    /* Resumen de una caja abierta: ventas cobradas con esa caja y sus movimientos */
    async function sessionSummary(cj) {
      var ms = monthsBetween(cj.abierta, new Date().toISOString()), cant = 0, ventas = 0, ing = 0, egr = 0;
      for (var i = 0; i < ms.length; i++) {
        var d = await loadMonth(ms[i]);
        d.ventas.forEach(function (v) { if (v.caja === cj.id && v.estado !== 'anulada') { cant++; ventas += v.totales.total; } });
        (d.compras || []).forEach(function (c) { if (c.caja === cj.id && c.estado !== 'anulada') egr += c.total; });
      }
      (cj.movimientos || []).forEach(function (mv) { if (mv.tipo === 'ingreso') ing += +mv.monto || 0; else egr += +mv.monto || 0; });
      return { cant: cant, total: ventas, ingresos: ing, egresos: egr, esperado: (+cj.inicial || 0) + ventas + ing - egr };
    }
    function saveCaja(msg) { return save([CAJA_PATH], msg); }

    function resumenBox(title, tag, r) {
      var col = function (k, icon) {
        var x = r[k];
        return '<div class="rc-col"><div class="rc-head">' + icon + ' ' + TIPOS[k].toUpperCase() + '</div>' +
          '<div class="rc-row"><span>Ingreso</span><strong class="is-in">' + money(x.ing) + '</strong></div>' +
          '<div class="rc-row"><span>Egreso</span><strong class="is-out">' + money(x.egr) + '</strong></div>' +
          '<div class="rc-row"><span>Saldo</span><strong class="is-bal">' + money(x.saldo) + '</strong></div></div>';
      };
      return '<section class="panel rc-card"><div class="rc-title"><h2>' + esc(title) + '</h2><span class="rc-tag">' + esc(tag) + '</span></div>' +
        '<div class="rc-cols">' + col('efectivo', ICON_CASH) + col('transferencia', ICON_TRANSFER) + '</div>' +
        '<div class="rc-total"><span>Total sobrante ' + (tag === 'HOY' ? 'del día' : 'del mes') + '</span><strong>' + money(r.total) + '</strong></div></section>';
    }

    async function cajaCard(tipo) {
      var c = norm(), cj = c.abiertas[tipo], mode = ui[tipo];
      var h = '<section class="panel cj-card"><div class="cj-head"><span class="cj-ico">' + (tipo === 'efectivo' ? ICON_CASH : ICON_TRANSFER) + '</span>' +
        '<div><h2>Caja ' + TIPOS[tipo] + '</h2><p class="hint">' + (tipo === 'efectivo' ? 'Control de efectivo' : 'Control de transferencias') + '</p></div></div>';
      h += '<label class="fld cj-date"><span>Fecha</span><input type="date" data-cdate="' + tipo + '" value="' + esc(cj ? (cj.fecha || dayOf(cj.abierta)) : todayKey()) + '"' + (cj ? ' disabled' : '') + '></label>';
      h += '<div class="cj-btns"><button type="button" class="btn btn-open" data-copen="' + tipo + '"' + (cj ? ' disabled' : '') + '>' + ICON_OPEN + ' Abrir Caja</button>' +
        '<button type="button" class="btn btn-close" data-cclose="' + tipo + '"' + (cj ? '' : ' disabled') + '>' + ICON_LOCK + ' Cerrar Caja</button></div>';
      if (!cj) {
        h += '<p class="cj-state">Caja <strong>CERRADA</strong></p>';
        if (mode === 'open') {
          h += '<form class="cj-inline" data-fopen="' + tipo + '">' +
            (tipo === 'efectivo' ? '<label class="fld"><span>Fondo inicial (cambio)</span><input class="js-num" inputmode="numeric" data-inicial placeholder="0" autocomplete="off"></label>' : '<p class="hint">Se abre para registrar los cobros por transferencia.</p>') +
            '<div class="btn-row"><button class="btn btn-open" type="submit">Confirmar apertura</button><button class="btn btn-secondary" type="button" data-ccancel="' + tipo + '">Cancelar</button></div></form>';
        }
      } else {
        var s = await sessionSummary(cj);
        h += '<p class="cj-state is-open">Caja <strong>ABIERTA</strong> desde ' + esc(fmtDate(cj.abierta, true)) + ' · ' + esc(cj.usuario || '') + '</p>' +
          '<div class="cj-mini">' +
            (tipo === 'efectivo' ? '<span>Fondo <strong>' + money(cj.inicial) + '</strong></span>' : '') +
            '<span>Cobrado <strong>' + money(s.total) + '</strong> (' + s.cant + ')</span>' +
            '<span>Compras pagadas <strong>' + money(s.egresos) + '</strong></span>' +
            '<span class="cj-exp">' + (tipo === 'efectivo' ? 'Debería haber' : 'Total en la cuenta') + ' <strong>' + money(s.esperado) + '</strong></span>' +
          '</div>';
        if (mode === 'close') {
          h += '<form class="cj-inline" data-fclose="' + tipo + '" data-esperado="' + s.esperado + '">' +
            '<div class="cj-saldo"><span>Saldo actual</span><strong>' + money(s.esperado) + '</strong></div>' +
            '<p class="hint cj-calc">' + (tipo === 'efectivo' ? 'Fondo ' + money(cj.inicial) + ' + ' : '') + 'ventas ' + money(s.total) + ' − egresos ' + money(s.egresos) +
              (s.ingresos ? ' + ingresos ' + money(s.ingresos) : '') + ' = <strong>' + money(s.esperado) + '</strong></p>' +
            '<label class="fld"><span>Nota (opcional)</span><input data-nota maxlength="160" autocomplete="off"></label>' +
            '<div class="btn-row"><button class="btn btn-close" type="submit">Confirmar cierre</button><button class="btn btn-secondary" type="button" data-ccancel="' + tipo + '">Cancelar</button></div></form>';
        }
      }
      return h + '</section>';
    }

    var renderingCaja = false;
    async function renderCaja() {
      var box = $('#cajaBox');
      if (!A.connected()) { box.innerHTML = '<div class="alert alert-error">' + esc(A.NEED_CONN) + '</div>'; return; }
      if (renderingCaja) return;
      renderingCaja = true;
      try {
        await loadPrivate();
        norm();
        var now = new Date(), mk = monthKey(now), month = await loadMonth(mk), movs = allMovs(), today = todayKey();
        var rDia = sumUp(month.ventas, movs, function (iso) { return dayOf(iso) === today; }, month.compras);
        var rMes = sumUp(month.ventas, movs, function (iso) { return dayOf(iso).slice(0, 7) === mk; }, month.compras);
        var c = norm();
        box.innerHTML =
          '<div class="cj-two">' + (await cajaCard('efectivo')) + (await cajaCard('transferencia')) + '</div>' +
          '<div class="cj-two">' + resumenBox('Recaudado del día', 'HOY', rDia) + resumenBox('Recaudado del mes', 'MES', rMes) + '</div>';
        renderCajaHist();
        renderDiario();
      } catch (e) {
        box.innerHTML = '<div class="alert alert-error">' + esc(e.message || String(e)) + '</div>';
      } finally { renderingCaja = false; }
    }
    /* Botones y formularios de las cajas */
    $('#cajaBox').addEventListener('click', async function (e) {
      var b;
      if ((b = e.target.closest('[data-copen]'))) { ui[b.dataset.copen] = 'open'; await renderCaja(); var i = $('[data-fopen="' + b.dataset.copen + '"] input'); if (i) i.focus(); return; }
      if ((b = e.target.closest('[data-cclose]'))) { ui[b.dataset.cclose] = 'close'; await renderCaja(); var j = $('[data-fclose="' + b.dataset.cclose + '"] [data-nota]'); if (j) j.focus(); return; }
      if ((b = e.target.closest('[data-ccancel]'))) { ui[b.dataset.ccancel] = null; renderCaja(); return; }

    });
    $('#cajaBox').addEventListener('input', function (e) {
      var f = e.target.closest('[data-fclose]');
      if (!f || !e.target.matches('[data-contado]')) return;
      var el = f.querySelector('[data-diff]'), v = e.target.value, esperado = +f.dataset.esperado;
      if (!v) { el.textContent = ''; el.className = 'caja-diff'; return; }
      var d = num(v) - esperado;
      el.className = 'caja-diff ' + (d === 0 ? 'is-ok' : d > 0 ? 'is-plus' : 'is-minus');
      el.textContent = d === 0 ? 'Cuadra justo con lo esperado.' : (d > 0 ? 'Sobran ' : 'Faltan ') + money(Math.abs(d)) + '.';
    });
    $('#cajaBox').addEventListener('submit', async function (e) {
      e.preventDefault();
      var f = e.target, c = norm();
      if (!A.connected()) { A.showMsg('error', A.NEED_CONN); return; }
      if (f.dataset.fopen) {
        var tipo = f.dataset.fopen, fecha = ($('[data-cdate="' + tipo + '"]') || {}).value || todayKey();
        var inicial = tipo === 'efectivo' ? num((f.querySelector('[data-inicial]') || {}).value) : 0;
        c.abiertas[tipo] = { id: A.rid(), tipo: tipo, fecha: fecha, abierta: new Date().toISOString(), usuario: S.user, inicial: inicial, movimientos: [] };
        ui[tipo] = null;
        saveCaja('Apertura de caja ' + TIPOS[tipo].toLowerCase() + (inicial ? ' · ' + money(inicial) : ''));
        renderCajaWarn();
        A.showMsg('ok', 'Caja de ' + TIPOS[tipo].toLowerCase() + ' abierta' + (inicial ? ' con ' + money(inicial) : '') + '.');
        renderCaja();
        return;
      }
      if (f.dataset.fclose) {
        var t2 = f.dataset.fclose, cj = c.abiertas[t2], s = await sessionSummary(cj);
        var contado = s.esperado, d = 0;
        var ok = await A.ask({ title: '¿Cerrar la caja de ' + TIPOS[t2].toLowerCase() + '?', danger: true, ok: 'Sí, cerrar',
          text: 'Saldo actual ' + money(s.esperado) + ' (ya descontados los egresos). Después no vas a poder cobrar en ' + (t2 === 'efectivo' ? 'efectivo' : 'transferencia') + ' hasta abrirla de nuevo.' });
        if (!ok) return;
        var cierre = Object.assign({}, cj, { cerrada: new Date().toISOString(), usuarioCierre: S.user, contado: contado, esperado: s.esperado,
          diferencia: d, notaCierre: f.querySelector('[data-nota]').value.trim(), resumen: s });
        c.cierres.push(cierre);
        c.abiertas[t2] = null;
        ui[t2] = null;
        await saveCaja('Cierre de caja ' + TIPOS[t2].toLowerCase() + ' · ' + money(s.total));
        renderCajaWarn();
        A.showMsg('ok', 'Caja de ' + TIPOS[t2].toLowerCase() + ' cerrada con un saldo de ' + money(s.esperado) + '.');
        renderCaja();
        return;
      }
    });

    /* ---------------- Reporte diario de caja: datos reales, búsqueda, paginación y gráficos ---------------- */
    var DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    var DIAS_L = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    var dDesde = $('#cjDesde'), dHasta = $('#cjHasta'), lastDiario = null;
    function setRange(kind) {
      var t = new Date(), from = t, to = t;
      if (kind === '7d') from = new Date(t.getFullYear(), t.getMonth(), t.getDate() - 6);
      else if (kind === 'mes') from = new Date(t.getFullYear(), t.getMonth(), 1);
      else if (kind === 'mesant') { from = new Date(t.getFullYear(), t.getMonth() - 1, 1); to = new Date(t.getFullYear(), t.getMonth(), 0); }
      dDesde.value = isoDay(from); dHasta.value = isoDay(to);
      $$('[data-crange]').forEach(function (b) { b.classList.toggle('on', b.dataset.crange === kind); });
    }
    function dayList(from, to) {
      var out = [], d = new Date(from + 'T12:00:00'), end = new Date(to + 'T12:00:00');
      while (d <= end && out.length < 400) { out.push(isoDay(d)); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 12); }
      return out;
    }
    function fmtDay(k, long) { var d = new Date(k + 'T12:00:00'), p = k.split('-'); return (long ? DIAS_L : DIAS)[d.getDay()] + ' ' + p[2] + '/' + p[1] + (long ? '/' + p[0] : ''); }
    function isWeekend(k) { var g = new Date(k + 'T12:00:00').getDay(); return g === 0 || g === 6; }
    async function renderDiario(keepPage) {
      var quick = $('[data-crange].on');
      if (quick && !keepPage) setRange(quick.dataset.crange);   // el período rápido se recalcula con la fecha de hoy
      if (!dDesde.value || !dHasta.value) setRange('mes');
      var from = dDesde.value, to = dHasta.value;
      if (to < from) { var x = from; from = to; to = x; dDesde.value = from; dHasta.value = to; }
      if (!keepPage) pages.diario = 1;
      try {
        var ms = monthsBetween(from + 'T12:00:00', to + 'T12:00:00'), ventas = [], compras = [];
        for (var i = 0; i < ms.length; i++) { var d = await loadMonth(ms[i]); ventas = ventas.concat(d.ventas); compras = compras.concat(d.compras || []); }
        var movs = allMovs(), days = dayList(from, to);
        var inRange = function (iso) { var k = dayOf(iso); return k >= from && k <= to; };
        var tot = sumUp(ventas, movs, inRange, compras);
        var all = days.map(function (k) { return { day: k, r: sumUp(ventas, movs, function (iso) { return dayOf(iso) === k; }, compras) }; });
        var active = all.filter(function (x) { return x.r.efectivo.ing || x.r.efectivo.egr || x.r.transferencia.ing || x.r.transferencia.egr; });
        lastDiario = { from: from, to: to, all: all, active: active, tot: tot };
        renderSummary(lastDiario);
        renderCharts(lastDiario);
        // tablas separadas por caja, con paginación (los días más recientes primero)
        var rows = active.slice().reverse(), pg = paginate(rows, 'diario');
        renderPager($('#cjPager'), 'diario', pg, function () { renderDiario(true); });
        var cell = function (v, cls) { return '<td class="ta-r nowrap ' + (cls || '') + '">' + money(v) + '</td>'; };
        ['efectivo', 'transferencia'].forEach(function (k) {
          var tb = $(k === 'efectivo' ? '#cjDiaEf' : '#cjDiaTr'), tf = $(k === 'efectivo' ? '#cjDiaEfFoot' : '#cjDiaTrFoot');
          if (!rows.length) { tb.innerHTML = '<tr><td colspan="4" class="tbl-empty">Sin movimientos en estas fechas.</td></tr>'; tf.innerHTML = ''; return; }
          tb.innerHTML = pg.items.map(function (x) {
            var r = x.r[k];
            return '<tr class="' + (isWeekend(x.day) ? 'is-weekend' : '') + '"><td class="nowrap"><strong>' + esc(fmtDay(x.day, true)) + '</strong>' +
              (x.day === todayKey() ? ' <span class="rc-tag">HOY</span>' : '') + '</td>' +
              cell(r.ing, 'is-in') + cell(r.egr, 'is-out') + cell(r.saldo, 'is-bal') + '</tr>';
          }).join('');
          var t = tot[k];
          tf.innerHTML = '<tr><td><strong>Total del período</strong></td>' + cell(t.ing, 'is-in') + cell(t.egr, 'is-out') + cell(t.saldo, 'is-bal') + '</tr>';
        });
        $('#cjGrand').innerHTML = rows.length ? '<span>Saldo total del período (efectivo + transferencia)</span><strong>' + money(tot.total) + '</strong>' : '';
      } catch (e) {
        $('#cjDiaEf').innerHTML = $('#cjDiaTr').innerHTML = '<tr><td colspan="4" class="tbl-empty">' + esc(e.message || String(e)) + '</td></tr>';
      }
    }
    function sumDay(r) { return { ing: r.efectivo.ing + r.transferencia.ing, egr: r.efectivo.egr + r.transferencia.egr }; }
    /* Resumen en palabras simples */
    function renderSummary(D) {
      var ing = D.tot.efectivo.ing + D.tot.transferencia.ing, egr = D.tot.efectivo.egr + D.tot.transferencia.egr;
      var nDias = D.all.length, best = null, wk = { ing: 0, n: 0 }, wd = { ing: 0, n: 0 };
      D.all.forEach(function (x) {
        var s = sumDay(x.r);
        if (!best || s.ing > best.ing) best = { day: x.day, ing: s.ing };
        if (isWeekend(x.day)) { wk.ing += s.ing; wk.n++; } else { wd.ing += s.ing; wd.n++; }
      });
      var promWk = wk.n ? Math.round(wk.ing / wk.n) : 0, promWd = wd.n ? Math.round(wd.ing / wd.n) : 0;
      var frase = !ing ? 'Todavía no hay ventas en estas fechas.'
        : !wk.n ? 'En estas fechas no hay sábados ni domingos.'
        : promWk > promWd ? 'Los fines de semana se vende más: en promedio ' + money(promWk) + ' por día, contra ' + money(promWd) + ' de lunes a viernes.'
        : promWk < promWd ? 'De lunes a viernes se vende más: en promedio ' + money(promWd) + ' por día, contra ' + money(promWk) + ' los fines de semana.'
        : 'Se vende parecido toda la semana: ' + money(promWd) + ' por día en promedio.';
      $('#cjSummary').innerHTML =
        '<div class="kpis kpis-6">' +
          kpi('Ingreso (ventas)', money(ing), nDias + (nDias === 1 ? ' día' : ' días')) +
          kpi('Egreso (compras)', money(egr), '') +
          '<div class="kpi kpi-main"><span>Saldo</span><strong>' + money(ing - egr) + '</strong><small>ingreso menos egreso</small></div>' +
          kpi('Promedio por día', money(nDias ? Math.round(ing / nDias) : 0), 'de ventas') +
          kpi('Mejor día', best && best.ing ? fmtDay(best.day, false) : '—', best && best.ing ? money(best.ing) : '') +
          kpi('Fines de semana', money(wk.ing), ing ? Math.round(wk.ing / ing * 100) + '% de las ventas' : '') +
        '</div><p class="cj-insight">' + esc(frase) + '</p>';
    }
    function nice(v) { return v >= 1e6 ? (Math.round(v / 1e5) / 10).toString().replace('.', ',') + ' M' : v >= 1e3 ? Math.round(v / 1e3) + ' mil' : String(v); }
    function renderCharts(D) {
      // 1) por día: barra verde (entró) y roja (salió); sábados y domingos marcados
      var max = 1;
      D.all.forEach(function (x) { var s = sumDay(x.r); max = Math.max(max, s.ing, s.egr); });
      $('#cjChartDays').innerHTML = D.all.length ? D.all.map(function (x) {
        var s = sumDay(x.r), hi = Math.round(s.ing / max * 100), he = Math.round(s.egr / max * 100);
        var tip = fmtDay(x.day, true) + ' · Ingreso ' + money(s.ing) + ' · Egreso ' + money(s.egr);
        return '<div class="ch-col' + (isWeekend(x.day) ? ' is-weekend' : '') + (x.day === todayKey() ? ' is-today' : '') + '" title="' + esc(tip) + '">' +
          '<div class="ch-bars"><span class="ch-bar ch-in" style="height:' + (s.ing ? Math.max(2, hi) : 0) + '%"></span><span class="ch-bar ch-out" style="height:' + (s.egr ? Math.max(2, he) : 0) + '%"></span></div>' +
          '<span class="ch-lbl">' + x.day.slice(8) + '<small>' + DIAS[new Date(x.day + 'T12:00:00').getDay()] + '</small></span></div>';
      }).join('') : '';
      $('#cjChartMax').textContent = 'Máximo: ' + money(max === 1 ? 0 : max) + (D.all.length > 16 ? ' · Deslizá el gráfico para ver los días anteriores.' : '');
      var sc = $('.ch-scroll');
      if (sc) setTimeout(function () { sc.scrollLeft = sc.scrollWidth; }, 0);   // muestra primero los días más recientes
      // 2) por día de la semana (promedio), para comparar con el fin de semana
      var wd = [0, 0, 0, 0, 0, 0, 0].map(function () { return { ing: 0, egr: 0, n: 0 }; });
      D.all.forEach(function (x) { var g = new Date(x.day + 'T12:00:00').getDay(), s = sumDay(x.r); wd[g].ing += s.ing; wd[g].egr += s.egr; wd[g].n++; });
      var order = [1, 2, 3, 4, 5, 6, 0], max2 = 1;
      order.forEach(function (g) { if (wd[g].n) max2 = Math.max(max2, wd[g].ing / wd[g].n, wd[g].egr / wd[g].n); });
      $('#cjChartWeek').innerHTML = order.map(function (g) {
        var w = wd[g], ai = w.n ? w.ing / w.n : 0, ae = w.n ? w.egr / w.n : 0;
        return '<div class="wk-row' + (g === 0 || g === 6 ? ' is-weekend' : '') + '" title="' + esc(DIAS_L[g] + ': ingreso promedio ' + money(Math.round(ai)) + ', egreso promedio ' + money(Math.round(ae))) + '">' +
          '<span class="wk-lbl">' + DIAS_L[g] + '</span>' +
          '<span class="wk-track"><span class="wk-bar ch-in" style="width:' + (ai ? Math.max(1, Math.round(ai / max2 * 100)) : 0) + '%"></span>' +
          '<span class="wk-bar ch-out" style="width:' + (ae ? Math.max(1, Math.round(ae / max2 * 100)) : 0) + '%"></span></span>' +
          '<span class="wk-val"><span class="is-in">' + nice(Math.round(ai)) + '</span> / <span class="is-out">' + nice(Math.round(ae)) + '</span></span></div>';
      }).join('');
    }
    $$('[data-crange]').forEach(function (b) { b.addEventListener('click', function () { setRange(b.dataset.crange); renderDiario(); }); });
    $('#cjBuscar').addEventListener('click', function () { $$('[data-crange]').forEach(function (x) { x.classList.remove('on'); }); renderDiario(); });
    [dDesde, dHasta].forEach(function (i) { i.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('#cjBuscar').click(); } }); });
    setRange('mes');

    /* ---------------- PDF de reportes (hoja A4) ----------------
       blocks: { t:'title'|'sub'|'text'|'kv'|'table', ... } */
    async function reportPdf(fileName, blocks) {
      var lib = await loadPdfLib();
      var doc = new lib.jsPDF({ unit: 'mm', format: 'a4', compress: true });
      var W = 210, H = 297, M = 14, CW = W - M * 2, y = M;
      var plain = function (v) { return String(v == null ? '' : v).replace(/[−–]/g, '-'); };
      function need(h) { if (y + h > H - 14) { doc.addPage(); y = M; return true; } return false; }
      function text(str, size, bold, color, align) {
        doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size);
        doc.setTextColor.apply(doc, color || [22, 38, 58]);
        var lines = doc.splitTextToSize(plain(str), CW), lh = size * 0.42;
        need(lines.length * lh + 1);
        lines.forEach(function (l, i) { doc.text(l, align === 'center' ? W / 2 : M, y + lh + i * lh, { align: align || 'left' }); });
        y += lines.length * lh + 2;
      }
      function table(b) {
        var cols = b.head.length, widths = b.widths || b.head.map(function () { return 1 / cols; });
        var xs = [], x = M; widths.forEach(function (w) { xs.push(x); x += w * CW; });
        var rowH = 7, align = b.align || b.head.map(function (_, i) { return i ? 'right' : 'left'; });
        function cellText(v, i, bold, color) {
          doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(8.6);
          doc.setTextColor.apply(doc, color || [22, 38, 58]);
          var w = widths[i] * CW - 3, t = doc.splitTextToSize(plain(v), w)[0] || '';
          if (align[i] === 'right') doc.text(t, xs[i] + widths[i] * CW - 1.5, y + 4.7, { align: 'right' });
          else doc.text(t, xs[i] + 1.5, y + 4.7);
        }
        function header() {
          doc.setFillColor(226, 241, 251); doc.rect(M, y, CW, rowH, 'F');
          b.head.forEach(function (h, i) { cellText(h, i, true); });
          y += rowH;
        }
        if (b.title) { need(rowH * 3); text(b.title, 11.5, true); }
        need(rowH * 2); header();
        (b.rows.length ? b.rows : [[b.empty || 'Sin datos']]).forEach(function (r, ri) {
          if (need(rowH)) header();
          if (r.shade) { doc.setFillColor(255, 248, 232); doc.rect(M, y, CW, rowH, 'F'); }
          var vals = r.cells || r;
          vals.forEach(function (v, i) { cellText(v, i, i === 0 && !!b.boldFirst, b.colors && b.colors[i]); });
          doc.setDrawColor(217, 229, 238); doc.line(M, y + rowH, M + CW, y + rowH);
          y += rowH;
        });
        if (b.foot) {
          need(rowH);
          doc.setFillColor(247, 248, 251); doc.rect(M, y, CW, rowH, 'F');
          b.foot.forEach(function (v, i) { cellText(v, i, true, b.colors && i ? b.colors[i] : null); });
          y += rowH;
        }
        y += 5;
      }
      function kv(b) {
        var per = 3, w = CW / per, h = 15;
        for (var i = 0; i < b.items.length; i += per) {
          need(h + 2);
          b.items.slice(i, i + per).forEach(function (it, j) {
            var x = M + j * w;
            doc.setDrawColor(217, 229, 238); doc.setFillColor(it.main ? 26 : 255, it.main ? 145 : 255, it.main ? 218 : 255);
            doc.roundedRect(x + 1, y, w - 2, h, 2, 2, 'FD');
            doc.setFont('helvetica', 'bold'); doc.setFontSize(7.8); doc.setTextColor(it.main ? 255 : 94, it.main ? 255 : 98, it.main ? 255 : 117);
            doc.text(plain(it.k), x + 4, y + 5);
            doc.setFontSize(11.5); doc.setTextColor(it.main ? 255 : 22, it.main ? 255 : 38, it.main ? 255 : 58);
            doc.text(plain(it.v), x + 4, y + 11.5);
          });
          y += h + 2;
        }
        y += 3;
      }
      blocks.forEach(function (b) {
        if (b.t === 'title') text(b.v, 16, true);
        else if (b.t === 'sub') text(b.v, 10, false, [94, 98, 117]);
        else if (b.t === 'text') text(b.v, 10, true, b.color || [107, 70, 0]);
        else if (b.t === 'kv') kv(b);
        else if (b.t === 'table') table(b);
        else if (b.t === 'gap') y += b.v || 4;
      });
      var n = doc.getNumberOfPages();
      for (var p = 1; p <= n; p++) {
        doc.setPage(p); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(140, 140, 150);
        doc.text(plain(S.data.store.store_name) + ' · Generado el ' + fmtDate(new Date().toISOString(), true), M, H - 7);
        doc.text('Página ' + p + ' de ' + n, W - M, H - 7, { align: 'right' });
      }
      var blob = doc.output('blob'), a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = fileName;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    }
    var C_IN = [23, 128, 61], C_OUT = [220, 38, 38], C_BAL = [26, 111, 216];
    $('#cjDiarioPdf').addEventListener('click', async function () {
      if (!lastDiario) return;
      var btn = this, D = lastDiario, t = D.tot, days = D.active.slice().reverse();
      btn.disabled = true;
      try {
        var ing = t.efectivo.ing + t.transferencia.ing, egr = t.efectivo.egr + t.transferencia.egr;
        var kpis = $$('#cjSummary .kpi').map(function (k) { return { k: k.querySelector('span').textContent, v: k.querySelector('strong').textContent, main: k.classList.contains('kpi-main') }; });
        var tabla = function (k, titulo) {
          return { t: 'table', title: titulo, head: ['Fecha', 'Ingreso', 'Egreso', 'Saldo'], widths: [0.37, 0.21, 0.21, 0.21], boldFirst: true,
            colors: [null, C_IN, C_OUT, C_BAL], empty: 'Sin movimientos',
            rows: days.map(function (x) { var r = x.r[k]; return { cells: [fmtDay(x.day, true), money(r.ing), money(r.egr), money(r.saldo)], shade: isWeekend(x.day) }; }),
            foot: ['Total del período', money(t[k].ing), money(t[k].egr), money(t[k].saldo)] };
        };
        var wk = $$('#cjChartWeek .wk-row').map(function (row) {
          return [row.querySelector('.wk-lbl').textContent, row.querySelector('.wk-val .is-in').textContent, row.querySelector('.wk-val .is-out').textContent];
        });
        await reportPdf('caja-diaria-' + D.from + '-a-' + D.to + '.pdf', [
          { t: 'title', v: S.data.store.store_name + ' · Reporte diario de caja' },
          { t: 'sub', v: 'Del ' + fmtDay(D.from, true) + ' al ' + fmtDay(D.to, true) + ' · Ingreso: ventas cobradas · Egreso: compras pagadas' },
          { t: 'gap', v: 2 },
          { t: 'kv', items: kpis },
          { t: 'text', v: $('#cjSummary .cj-insight').textContent },
          { t: 'gap', v: 2 },
          tabla('efectivo', 'Caja Efectivo'),
          tabla('transferencia', 'Caja Transferencia'),
          { t: 'text', v: 'Saldo total del período (efectivo + transferencia): ' + money(t.total), color: [26, 111, 216] },
          { t: 'gap', v: 4 },
          { t: 'table', title: 'Promedio por día de la semana', head: ['Día', 'Ingreso promedio', 'Egreso promedio'], widths: [0.4, 0.3, 0.3],
            colors: [null, C_IN, C_OUT], rows: wk.map(function (r) { return { cells: r, shade: /Sábado|Domingo/.test(r[0]) }; }) }
        ]);
      } catch (e) { A.showMsg('error', e.message || String(e)); }
      finally { btn.disabled = false; }
    });
    $('#cjDiarioPrint').addEventListener('click', function () {
      if (!lastDiario) return;
      var cell = function (v) { return '<td class="r">' + money(v) + '</td>'; };
      var t = lastDiario.tot, days = lastDiario.active.slice().reverse();
      var tabla = function (k, titulo) {
        return '<h2>' + titulo + '</h2><table><thead><tr><th>Fecha</th><th class="r">Ingreso</th><th class="r">Egreso</th><th class="r">Saldo</th></tr></thead><tbody>' +
          days.map(function (x) { var r = x.r[k]; return '<tr><td>' + esc(fmtDay(x.day, true)) + '</td>' + cell(r.ing) + cell(r.egr) + cell(r.saldo) + '</tr>'; }).join('') +
          '</tbody><tfoot><tr class="b"><td>Total</td>' + cell(t[k].ing) + cell(t[k].egr) + cell(t[k].saldo) + '</tr></tfoot></table>';
      };
      printHTML('Caja diaria', '<h1>' + esc(S.data.store.store_name) + ' · Caja diaria</h1><div class="muted">Del ' + esc(fmtDay(lastDiario.from, true)) + ' al ' + esc(fmtDay(lastDiario.to, true)) + '</div>' +
        '<p>' + esc($('#cjSummary .cj-insight').textContent) + '</p>' + tabla('efectivo', 'Caja Efectivo') + tabla('transferencia', 'Caja Transferencia') +
        '<p class="b big">Saldo total del período: ' + money(t.total) + '</p>', false);
    });

    /* ---------------- Historial de cierres ---------------- */
    function renderCajaHist() {
      var list = norm().cierres.slice().reverse(), body = $('#cajaHist');
      var pg = paginate(list, 'caja');
      renderPager($('#cajaPager'), 'caja', pg, renderCajaHist);
      if (!list.length) { body.innerHTML = '<tr><td colspan="8" class="tbl-empty">Todavía no hay cierres de caja.</td></tr>'; return; }
      body.innerHTML = pg.items.map(function (c) {
        var d = c.diferencia || 0;
        return '<tr><td><strong>' + esc(TIPOS[c.tipo] || 'Efectivo') + '</strong></td><td class="nowrap">' + esc(fmtDate(c.abierta, true)) + '</td><td class="nowrap">' + esc(fmtDate(c.cerrada, true)) + '</td>' +
          '<td>' + esc(c.usuarioCierre || c.usuario || '') + '</td>' +
          '<td class="ta-r nowrap">' + money(c.resumen ? c.resumen.total : 0) + '</td>' +
          '<td class="ta-r nowrap is-out">' + money(c.resumen ? (c.resumen.egresos || c.resumen.retiros || 0) : 0) + '</td>' +
          '<td class="ta-r nowrap is-bal"><strong>' + money(c.esperado) + '</strong></td>' +
          '<td class="actions"><button type="button" class="btn btn-print btn-sm" data-cprint="' + esc(c.id) + '">Imprimir</button></td></tr>';
      }).join('');
    }
    $('#cajaHist').addEventListener('click', function (e) {
      var b = e.target.closest('[data-cprint]');
      if (!b) return;
      var c = norm().cierres.filter(function (x) { return x.id === b.dataset.cprint; })[0];
      if (c) printCierre(c);
    });
    function printCierre(c) {
      var r = c.resumen || {}, st = S.data.store, row = function (a, b, cls) { return '<tr><td>' + a + '</td><td class="r ' + (cls || '') + '">' + b + '</td></tr>'; };
      var ef = (c.tipo || 'efectivo') === 'efectivo';
      var movs = (c.movimientos || []).map(function (mv) {
        return row(esc((mv.tipo === 'ingreso' ? 'Ingreso: ' : 'Egreso: ') + (mv.motivo || '')), (mv.tipo === 'ingreso' ? '+' : '−') + money(mv.monto));
      }).join('');
      printHTML('Cierre de caja', '<h1>' + esc(st.store_name) + '</h1><div class="b">CIERRE DE CAJA · ' + (ef ? 'EFECTIVO' : 'TRANSFERENCIAS') + '</div>' +
        '<div class="muted">Apertura: ' + esc(fmtDate(c.abierta, true)) + ' (' + esc(c.usuario || '') + ')<br>Cierre: ' + esc(fmtDate(c.cerrada, true)) + ' (' + esc(c.usuarioCierre || '') + ')</div>' +
        '<table>' + (ef ? row('Fondo inicial', money(c.inicial)) : '') + row('Cobrado (' + (r.cant || 0) + ' ventas)', money(r.total || 0), 'b') +
        row('Ingresos', money(r.ingresos || 0)) + row('Egresos', money(r.egresos || r.retiros || 0)) + '</table>' +
        (movs ? '<h2>Movimientos</h2><table>' + movs + '</table>' : '') +
        '<table>' + row('Saldo al cerrar', money(c.esperado), 'b big') + '</table>' +
        (c.notaCierre ? '<p>Nota: ' + esc(c.notaCierre) + '</p>' : '') + '<p class="muted" style="margin-top:24px">Firma: ______________________</p>', true);
    }


    function printHTML(title, inner, narrow) {
      var css = 'body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:' + (narrow ? '4mm' : '14mm') + ';font-size:' + (narrow ? '12px' : '13px') + '}' +
        'h1{font-size:' + (narrow ? '15px' : '20px') + ';margin:0 0 4px}h2{font-size:14px;margin:16px 0 6px}.muted{color:#555}' +
        'table{width:100%;border-collapse:collapse;margin-top:4px}td,th{padding:4px 6px;border-bottom:1px solid #ddd;text-align:left}' +
        '.r{text-align:right}.b{font-weight:bold}.big{font-size:16px}@page{margin:' + (narrow ? '0' : '10mm') + '}';
      if (narrow && V.printThermal) {
        // comprobantes chicos (cierre de caja): mismo formato que el ticket de la impresora térmica
        var aj = P.ajustes || V.defaultAjustes();
        V.printThermal('<!doctype html><html lang="es"><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>' + V.ticketCSS(aj) +
          'table{width:100%;border-collapse:collapse}td,th{padding:3px 0;border-bottom:1px dashed #000;text-align:left;vertical-align:top}.r{text-align:right}.muted{font-weight:700}h2{font-size:15px;margin:10px 0 4px}' +
          '</style></head><body>' + inner + '<div class="feed"></div></body></html>', aj);
        return;
      }
      var ifr = document.createElement('iframe');
      ifr.setAttribute('aria-hidden', 'true');
      ifr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
      document.body.appendChild(ifr);
      var doc = ifr.contentWindow.document;
      doc.open();
      doc.write('<!doctype html><html lang="es"><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>' + css + '</style></head><body' +
        (narrow ? ' style="width:' + (+(P.ajustes && P.ajustes.ticket.ancho) === 58 ? '52mm' : '72mm') + '"' : '') + '>' + inner + '</body></html>');
      doc.close();
      setTimeout(function () { ifr.contentWindow.focus(); ifr.contentWindow.print(); setTimeout(function () { ifr.remove(); }, 3000); }, 300);
    }
    /* =================================================================
       REPORTES
       ================================================================= */
    function dayStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
    function isoDay(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2); }
    function repRange() {
      var now = new Date(), t = dayStart(now), per = $('#repPeriod').value, from, to;
      if (per === 'hoy') { from = t; to = t; }
      else if (per === 'ayer') { from = new Date(t.getTime() - 864e5); to = from; }
      else if (per === '7d') { from = new Date(t.getTime() - 6 * 864e5); to = t; }
      else if (per === 'mes') { from = new Date(t.getFullYear(), t.getMonth(), 1); to = t; }
      else if (per === 'mesant') { from = new Date(t.getFullYear(), t.getMonth() - 1, 1); to = new Date(t.getFullYear(), t.getMonth(), 0); }
      else {
        from = $('#repFrom').value ? new Date($('#repFrom').value + 'T00:00:00') : new Date(t.getFullYear(), t.getMonth(), 1);
        to = $('#repTo').value ? new Date($('#repTo').value + 'T00:00:00') : t;
        if (to < from) { var x = from; from = to; to = x; }
      }
      return { from: from, to: new Date(to.getTime() + 864e5 - 1) };
    }
    var lastRep = null;
    async function renderReportes() {
      var body = $('#repBody');
      $('#repFromW').hidden = $('#repToW').hidden = $('#repPeriod').value !== 'custom';
      if (!A.connected()) { body.innerHTML = '<div class="alert alert-error">' + esc(A.NEED_CONN) + '</div>'; return; }
      body.innerHTML = '<p class="hint">Calculando…</p>';
      try {
        await loadPrivate();
        var rg = repRange(), ms = monthsBetween(rg.from.toISOString(), rg.to.toISOString());
        var ventas = [], compras = [], costo = {};
        // los costos se toman de las compras hasta el final del período (último costo conocido)
        var costMonths = monthsBetween(new Date(rg.to.getFullYear(), rg.to.getMonth() - 5, 1).toISOString(), rg.to.toISOString());
        var all = ms.concat(costMonths.filter(function (m) { return ms.indexOf(m) === -1; })).sort();
        for (var i = 0; i < all.length; i++) {
          var d = await loadMonth(all[i]);
          d.compras.forEach(function (c) {
            if (c.estado === 'anulada') return;
            var f = new Date(c.fecha + (c.fecha.length === 10 ? 'T12:00:00' : ''));
            if (f <= rg.to) c.items.forEach(function (it) { if (it.costo) costo[it.product_id] = it.costo; });
            if (ms.indexOf(all[i]) !== -1 && f >= rg.from && f <= rg.to) compras.push(c);
          });
          if (ms.indexOf(all[i]) !== -1) d.ventas.forEach(function (v) {
            var f = new Date(v.fecha);
            if (v.estado !== 'anulada' && f >= rg.from && f <= rg.to) ventas.push(v);
          });
        }
        lastRep = buildRep(ventas, compras, costo, rg);
        body.innerHTML = repHTML(lastRep);
      } catch (e) {
        body.innerHTML = '<div class="alert alert-error">' + esc(e.message || String(e)) + '</div>';
      }
    }
    function buildRep(ventas, compras, costo, rg) {
      var r = { rg: rg, total: 0, cant: ventas.length, unidades: 0, pago: {}, doc: { ticket: 0, factura: 0 }, porDia: {}, prod: {}, cat: {}, marca: {},
                compras: 0, cantCompras: compras.length, costoVendido: 0, conCosto: 0, sinCosto: 0 };
      ventas.forEach(function (v) {
        r.total += v.totales.total;
        r.pago[v.pago.forma] = (r.pago[v.pago.forma] || 0) + v.totales.total;
        r.doc[isFactura(v) ? 'factura' : 'ticket'] += v.totales.total;
        var day = isoDay(new Date(v.fecha));
        r.porDia[day] = (r.porDia[day] || 0) + v.totales.total;
        v.items.forEach(function (it) {
          var p = findP(it.product_id), name = p ? p.name : String(it.descripcion).replace(/ T\. .*$/, '');
          r.unidades += it.cantidad;
          var k = it.product_id || name;
          r.prod[k] = r.prod[k] || { name: name, cant: 0, monto: 0 };
          r.prod[k].cant += it.cantidad; r.prod[k].monto += it.subtotal;
          var cat = (p && p.category) || 'Sin categoría', mk = (p && p.brand) || 'Sin marca';
          r.cat[cat] = (r.cat[cat] || 0) + it.subtotal;
          r.marca[mk] = (r.marca[mk] || 0) + it.subtotal;
          if (costo[it.product_id]) { r.costoVendido += costo[it.product_id] * it.cantidad; r.conCosto += it.subtotal; }
          else r.sinCosto += it.subtotal;
        });
      });
      compras.forEach(function (c) { r.compras += c.total; });
      r.ganancia = r.conCosto - r.costoVendido;
      r.stockBajo = products().map(function (p) { return { p: p, s: productStock(p) }; })
        .filter(function (x) { return x.s <= 2; }).sort(function (a, b) { return a.s - b.s; }).slice(0, 30);
      r.cierres = (norm().cierres || []).filter(function (c) { var f = new Date(c.cerrada); return f >= rg.from && f <= rg.to; });
      return r;
    }
    function productStock(p) { return hasSizes(p) ? p.sizes.reduce(function (t, s) { return t + (+s.stock || 0); }, 0) : (+p.stock || 0); }
    function bars(map, max, labelFn) {
      var keys = Object.keys(map);
      if (!keys.length) return '<p class="hint">Sin datos en este período.</p>';
      var top = max || Math.max.apply(null, keys.map(function (k) { return map[k]; }));
      return '<div class="bars">' + keys.map(function (k) {
        var pct = top ? Math.max(2, Math.round(map[k] / top * 100)) : 0;
        return '<div class="bar-row"><span class="bar-l">' + esc(labelFn ? labelFn(k) : k) + '</span><span class="bar-t"><span class="bar-f" style="width:' + pct + '%"></span></span><span class="bar-v">' + money(map[k]) + '</span></div>';
      }).join('') + '</div>';
    }
    function sortedMap(map) {
      var o = {};
      Object.keys(map).sort(function (a, b) { return map[b] - map[a]; }).forEach(function (k) { o[k] = map[k]; });
      return o;
    }
    function repHTML(r) {
      var dias = {};
      Object.keys(r.porDia).sort().forEach(function (k) { dias[k] = r.porDia[k]; });
      var top = Object.keys(r.prod).map(function (k) { return r.prod[k]; }).sort(function (a, b) { return b.cant - a.cant || b.monto - a.monto; }).slice(0, 10);
      var periodo = fmtDate(r.rg.from.toISOString()) + (isoDay(r.rg.from) === isoDay(r.rg.to) ? '' : ' al ' + fmtDate(r.rg.to.toISOString()));
      var gan = r.conCosto ? kpi('Ganancia estimada', money(r.ganancia), r.sinCosto ? 'sin contar ' + money(r.sinCosto) + ' sin costo cargado' : 'según el costo de tus compras') : kpi('Ganancia estimada', '—', 'cargá compras con costo para calcularla');
      return '<p class="hint rep-period">Período: <strong>' + esc(periodo) + '</strong></p>' +
        '<div class="kpis kpis-6">' +
          kpi('Total vendido', money(r.total), r.cant + (r.cant === 1 ? ' venta' : ' ventas')) +
          kpi('Ticket promedio', money(r.cant ? Math.round(r.total / r.cant) : 0), '') +
          kpi('Unidades vendidas', A.fmtNum(r.unidades) || '0', '') +
          kpi('Efectivo', money(r.pago.efectivo || 0), '') +
          kpi('Transferencias', money(r.pago.transferencia || 0), '') +
          gan +
        '</div>' +
        '<div class="rep-grid">' +
          '<section class="panel"><h2>Ventas por día</h2>' + bars(dias, 0, function (k) { var p = k.split('-'); return p[2] + '/' + p[1]; }) + '</section>' +
          '<section class="panel"><h2>Productos más vendidos</h2>' + (top.length ?
            '<table class="tbl tbl-sm"><thead><tr><th>#</th><th>Producto</th><th class="ta-r">Unid.</th><th class="ta-r">Monto</th></tr></thead><tbody>' +
            top.map(function (x, i) { return '<tr><td>' + (i + 1) + '</td><td>' + esc(x.name) + '</td><td class="ta-r">' + x.cant + '</td><td class="ta-r nowrap">' + money(x.monto) + '</td></tr>'; }).join('') +
            '</tbody></table>' : '<p class="hint">Sin ventas en este período.</p>') + '</section>' +
          '<section class="panel"><h2>Por categoría</h2>' + bars(sortedMap(r.cat)) + '</section>' +
          '<section class="panel"><h2>Por marca</h2>' + bars(sortedMap(r.marca)) + '</section>' +
          '<section class="panel"><h2>Comprobantes y compras</h2><table class="tbl tbl-sm"><tbody>' +
            '<tr><td>Tickets</td><td class="ta-r nowrap">' + money(r.doc.ticket) + '</td></tr>' +
            '<tr><td>Facturas electrónicas</td><td class="ta-r nowrap">' + money(r.doc.factura) + '</td></tr>' +
            '<tr><td>Compras a proveedores (' + r.cantCompras + ')</td><td class="ta-r nowrap">' + money(r.compras) + '</td></tr>' +
          '</tbody></table></section>' +
          '<section class="panel"><h2>Cierres de caja</h2>' + (r.cierres.length ?
            '<table class="tbl tbl-sm"><thead><tr><th>Cierre</th><th class="ta-r">Vendido</th><th class="ta-r">Diferencia</th></tr></thead><tbody>' +
            r.cierres.map(function (c) { var df = c.diferencia || 0; return '<tr><td class="nowrap">' + esc(fmtDate(c.cerrada, true)) + '</td><td class="ta-r nowrap">' + money(c.resumen ? c.resumen.total : 0) +
              '</td><td class="ta-r"><span class="diff-tag ' + (df === 0 ? 'is-ok' : df > 0 ? 'is-plus' : 'is-minus') + '">' + (df === 0 ? 'Cuadra' : (df > 0 ? '+' : '−') + money(Math.abs(df)).replace('Gs. ', '')) + '</span></td></tr>'; }).join('') +
            '</tbody></table>' : '<p class="hint">No hubo cierres en este período.</p>') + '</section>' +
          '<section class="panel rep-wide"><h2>Stock bajo (2 o menos)</h2>' + (r.stockBajo.length ?
            '<table class="tbl tbl-sm"><thead><tr><th>Producto</th><th>Talles con poco stock</th><th class="ta-r">Stock</th></tr></thead><tbody>' +
            r.stockBajo.map(function (x) {
              var low = hasSizes(x.p) ? x.p.sizes.filter(function (s) { return +s.stock <= 1; }).map(function (s) { return s.size; }).join(', ') : '';
              return '<tr><td>' + esc(x.p.name) + '</td><td>' + esc(low || '—') + '</td><td class="ta-r ' + (x.s <= 0 ? 't-out' : '') + '">' + x.s + '</td></tr>';
            }).join('') + '</tbody></table>' : '<p class="hint">Todo con stock suficiente.</p>') + '</section>' +
        '</div>';
    }
    ['#repPeriod', '#repFrom', '#repTo'].forEach(function (id) { $(id).addEventListener('change', renderReportes); });
    $('#repPrint').addEventListener('click', function () {
      if (!lastRep) return;
      printHTML('Reporte', '<h1>' + esc(S.data.store.store_name) + ' · Reporte de ventas</h1>' + $('#repBody').innerHTML.replace(/<button[^>]*>.*?<\/button>/g, ''), false);
    });
    $('#repPdf').addEventListener('click', async function () {
      if (!lastRep) return;
      var btn = this, r = lastRep;
      btn.disabled = true;
      try {
        var kpis = $$('#repBody .kpis .kpi').map(function (k) { return { k: k.querySelector('span').textContent, v: k.querySelector('strong').textContent }; });
        var top = Object.keys(r.prod).map(function (k) { return r.prod[k]; }).sort(function (a, b) { return b.cant - a.cant || b.monto - a.monto; });
        var mapRows = function (m) { return Object.keys(m).sort(function (a, b) { return m[b] - m[a]; }).map(function (k) { return [k, money(m[k]), r.total ? Math.round(m[k] / r.total * 100) + '%' : '']; }); };
        await reportPdf('reporte-' + isoDay(r.rg.from) + '-a-' + isoDay(r.rg.to) + '.pdf', [
          { t: 'title', v: S.data.store.store_name + ' · Reporte de ventas' },
          { t: 'sub', v: 'Período: ' + fmtDate(r.rg.from.toISOString()) + ' al ' + fmtDate(r.rg.to.toISOString()) },
          { t: 'gap', v: 2 },
          { t: 'kv', items: kpis },
          { t: 'table', title: 'Ventas por día', head: ['Día', 'Vendido'], widths: [0.6, 0.4],
            rows: Object.keys(r.porDia).sort().map(function (k) { return [fmtDate(k + 'T12:00:00'), money(r.porDia[k])]; }), empty: 'Sin ventas' },
          { t: 'table', title: 'Productos más vendidos', head: ['Producto', 'Unidades', 'Monto'], widths: [0.6, 0.15, 0.25],
            rows: top.map(function (x) { return [x.name, String(x.cant), money(x.monto)]; }), empty: 'Sin ventas' },
          { t: 'table', title: 'Por categoría', head: ['Categoría', 'Monto', '%'], widths: [0.6, 0.25, 0.15], rows: mapRows(r.cat), empty: 'Sin ventas' },
          { t: 'table', title: 'Por marca', head: ['Marca', 'Monto', '%'], widths: [0.6, 0.25, 0.15], rows: mapRows(r.marca), empty: 'Sin ventas' },
          { t: 'table', title: 'Comprobantes y compras', head: ['Concepto', 'Monto'], widths: [0.7, 0.3],
            rows: [['Tickets', money(r.doc.ticket)], ['Facturas electrónicas', money(r.doc.factura)], ['Compras a proveedores (' + r.cantCompras + ')', money(r.compras)]] },
          { t: 'table', title: 'Cierres de caja', head: ['Caja', 'Cierre', 'Cobrado', 'Diferencia'], widths: [0.2, 0.3, 0.25, 0.25],
            rows: r.cierres.map(function (c) { var d = c.diferencia || 0; return [c.tipo === 'transferencia' ? 'Transferencia' : 'Efectivo', fmtDate(c.cerrada, true), money(c.resumen ? c.resumen.total : 0), d ? (d > 0 ? 'Sobran ' : 'Faltan ') + money(Math.abs(d)) : 'Cuadra']; }),
            empty: 'No hubo cierres en este período' },
          { t: 'table', title: 'Stock bajo (2 o menos)', head: ['Producto', 'Stock'], widths: [0.8, 0.2],
            rows: r.stockBajo.map(function (x) { return [x.p.name, String(x.s)]; }), empty: 'Todo con stock suficiente' }
        ]);
      } catch (e) { A.showMsg('error', e.message || String(e)); }
      finally { btn.disabled = false; }
    });


    V.reportPdf = reportPdf;
    V.hooks.cajaWarn = renderCajaWarn;
    V.hooks.cajaFor = cajaFor;
    renderCajaWarn();
    A.on('tab', function (name) {
      if (name === 'caja') renderCaja();
      if (name === 'reportes') renderReportes();
    });
  }
})();