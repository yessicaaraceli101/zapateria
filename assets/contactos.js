/* =================================================================
   Clientes y Proveedores
   - Se guardan CIFRADOS en data/privado/contactos.json.
   - En Vender se busca el cliente y trae su RUC o cédula;
     en Compras se busca el proveedor y trae su RUC.
   ================================================================= */
(function () {
  'use strict';
  var A = window.ZA;
  if (!A || !A.V) return;
  var V = A.V, P = V.P, $ = A.$, $$ = A.$$, esc = A.esc, lower = A.lower;
  var PAGE = 10, page = { cl: 1, pv: 1 };
  var TRASH = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
  var PEN = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>';

  function C() { return P.contactos || (P.contactos = { clientes: [], proveedores: [] }); }
  function norm(x) { return String(x || '').replace(/[^0-9a-z]/gi, '').toLowerCase(); }
  function save(msg) { return V.save([V.CONT_PATH], msg); }
  async function ready() {
    if (!A.connected()) throw new Error(A.NEED_CONN);
    await V.loadPrivate();
    return C();
  }
  /* RUC: "80012345-6" → { doc, dv }; revisa el dígito verificador */
  function parseRuc(txt) {
    var raw = String(txt || '').replace(/[.\s]/g, ''), m = raw.match(/^(\d{3,10})-?(\d)$/);
    if (!m) return null;
    return { doc: m[1], dv: m[2], ok: V.rucDv(m[1]) === +m[2] };
  }
  function pager(el, key, total, rerender) {
    var max = Math.max(1, Math.ceil(total / PAGE));
    if (page[key] > max) page[key] = max;
    Z.pager(el, { page: page[key], per: PAGE, total: total, onPage: function (n) { page[key] = n; rerender(); } });
    return (page[key] - 1) * PAGE;
  }

  function filterBy(list, q, fields) {
    var w = lower(q).split(/\s+/).filter(Boolean), d = norm(q);
    if (!w.length) return list;
    return list.filter(function (x) {
      var hay = lower(fields.map(function (f) { return x[f] || ''; }).join(' '));
      return w.every(function (t) { return hay.indexOf(t) !== -1; }) || (d.length >= 3 && norm((x.doc || '') + (x.dv || '') + (x.ruc || '')).indexOf(d) !== -1);
    });
  }
  function sorted(list) { return list.slice().sort(function (a, b) { return Z.natCmp(a.nombre || '', b.nombre || ''); }); }

  /* =================================================================
     CLIENTES
     ================================================================= */
  var clTipo = 'ruc';
  function setClTipo(t) {
    clTipo = t;
    $$('[data-cltipo]').forEach(function (b) { b.classList.toggle('on', b.dataset.cltipo === t); });
    $('#clDocLbl').textContent = t === 'ruc' ? 'RUC con DV *' : 'Número de cédula *';
    $('#clDoc').placeholder = t === 'ruc' ? '80012345-6' : '1234567';
  }
  $$('[data-cltipo]').forEach(function (b) { b.addEventListener('click', function () { setClTipo(b.dataset.cltipo); $('#clDoc').focus(); }); });
  function clReset() {
    $('#clForm').reset(); $('#clId').value = ''; setClTipo('ruc');
    $('#clFormTitle').textContent = 'Nuevo cliente'; $('#clSaveBtn').textContent = 'Guardar cliente'; $('#clCancel').hidden = true;
  }
  async function renderClientes() {
    var body = $('#clRows');
    try { await ready(); } catch (e) { body.innerHTML = '<tr><td colspan="5" class="tbl-empty">' + esc(e.message) + '</td></tr>'; return; }
    var all = sorted(C().clientes), list = filterBy(all, $('#clSearch').value, ['nombre', 'doc', 'tel', 'email']);
    $('#clCount').textContent = all.length + (all.length === 1 ? ' cliente' : ' clientes');
    var from = pager($('#clPager'), 'cl', list.length, renderClientes);
    if (!list.length) { body.innerHTML = '<tr><td colspan="5" class="tbl-empty">' + (all.length ? 'No hay clientes con esa búsqueda.' : 'Todavía no hay clientes. Cargalos acá o se guardan solos al vender con RUC o cédula.') + '</td></tr>'; return; }
    body.innerHTML = list.slice(from, from + PAGE).map(function (c) {
      return '<tr><td><strong>' + esc(c.nombre || '—') + '</strong>' + (c.dir ? '<span class="t-sub">' + esc(c.dir) + '</span>' : '') + '</td>' +
        '<td class="nowrap">' + (c.tipo === 'ci' ? 'CI ' : 'RUC ') + esc(c.doc + (c.dv ? '-' + c.dv : '')) + '</td>' +
        '<td class="nowrap">' + esc(c.tel || '—') + '</td><td>' + esc(c.email || '—') + '</td>' +
        '<td class="actions"><button type="button" class="icon-btn" data-cledit="' + esc(c.id) + '" title="Editar" aria-label="Editar ' + esc(c.nombre) + '">' + PEN + '</button>' +
        (A.can('borrarClientes') ? '<button type="button" class="icon-btn icon-danger icon-void" data-cldel="' + esc(c.id) + '" title="Eliminar" aria-label="Eliminar ' + esc(c.nombre) + '">' + TRASH + '</button>' : '') + '</td></tr>';
    }).join('');
  }
  $('#clSearch').addEventListener('input', function () { page.cl = 1; renderClientes(); });
  $('#clCancel').addEventListener('click', clReset);
  $('#clRows').addEventListener('click', async function (e) {
    var b, list = C().clientes;
    if ((b = e.target.closest('[data-cledit]'))) {
      var c = list.filter(function (x) { return x.id === b.dataset.cledit; })[0];
      if (!c) return;
      $('#clId').value = c.id; setClTipo(c.tipo === 'ci' ? 'ci' : 'ruc');
      $('#clDoc').value = c.doc + (c.dv ? '-' + c.dv : ''); $('#clName').value = c.nombre || ''; $('#clTel').value = c.tel || '';
      $('#clMail').value = c.email || ''; $('#clDir').value = c.dir || '';
      $('#clFormTitle').textContent = 'Editar cliente'; $('#clSaveBtn').textContent = 'Guardar cambios'; $('#clCancel').hidden = false;
      $('#clName').focus();
      return;
    }
    if ((b = e.target.closest('[data-cldel]'))) {
      if (!A.can('borrarClientes')) { A.showMsg('error', 'No tenés permiso para eliminar clientes.'); return; }
      var d = list.filter(function (x) { return x.id === b.dataset.cldel; })[0];
      if (!d) return;
      var ok = await A.ask({ title: '¿Eliminar a ' + (d.nombre || d.doc) + '?', text: 'Se borra de la lista de clientes. Las ventas que ya tiene no se tocan.', ok: 'Sí, eliminar', danger: true });
      if (!ok) return;
      C().clientes = list.filter(function (x) { return x.id !== d.id; });
      save('Eliminar cliente ' + (d.nombre || d.doc));
      A.showMsg('ok', 'Cliente eliminado.');
      renderClientes();
    }
  });
  $('#clForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    try { await ready(); } catch (err) { A.showMsg('error', err.message); return; }
    var id = $('#clId').value, name = $('#clName').value.trim(), raw = $('#clDoc').value.trim(), doc, dv = '';
    if (clTipo === 'ruc') {
      var r = parseRuc(raw);
      if (!r) { A.showMsg('error', 'Escribí el RUC con su dígito verificador, por ejemplo 80012345-6.'); $('#clDoc').focus(); return; }
      if (!r.ok) { A.showMsg('error', 'El RUC ' + r.doc + '-' + r.dv + ' no es válido: el dígito verificador debería ser ' + V.rucDv(r.doc) + '.'); $('#clDoc').focus(); return; }
      doc = r.doc; dv = r.dv;
    } else {
      doc = raw.replace(/\D/g, '');
      if (doc.length < 4) { A.showMsg('error', 'Escribí el número de cédula.'); $('#clDoc').focus(); return; }
    }
    if (!name) { A.showMsg('error', 'Escribí el nombre o la razón social.'); $('#clName').focus(); return; }
    var list = C().clientes;
    if (list.some(function (x) { return x.id !== id && norm(x.doc) === norm(doc); })) { A.showMsg('error', 'Ya hay un cliente con ese documento.'); return; }
    var data = { tipo: clTipo, doc: doc, dv: dv, nombre: name, tel: $('#clTel').value.trim(), email: $('#clMail').value.trim(), dir: $('#clDir').value.trim(), actualizado: new Date().toISOString() };
    if (id) Object.assign(list.filter(function (x) { return x.id === id; })[0] || {}, data);
    else list.push(Object.assign({ id: A.rid(), creado: new Date().toISOString() }, data));
    save((id ? 'Editar' : 'Nuevo') + ' cliente ' + name);
    A.showMsg('ok', id ? 'Cliente actualizado.' : 'Cliente guardado. Ya lo podés buscar al vender.');
    clReset();
    renderClientes();
  });

  /* =================================================================
     PROVEEDORES
     ================================================================= */
  function pvReset() {
    $('#pvForm').reset(); $('#pvId').value = '';
    $('#pvFormTitle').textContent = 'Nuevo proveedor'; $('#pvSaveBtn').textContent = 'Guardar proveedor'; $('#pvCancel').hidden = true;
  }
  async function renderProveedores() {
    var body = $('#pvRows');
    try { await ready(); } catch (e) { body.innerHTML = '<tr><td colspan="5" class="tbl-empty">' + esc(e.message) + '</td></tr>'; return; }
    var all = sorted(C().proveedores), list = filterBy(all, $('#pvSearch').value, ['nombre', 'ruc', 'contacto', 'tel']);
    $('#pvCount').textContent = all.length + (all.length === 1 ? ' proveedor' : ' proveedores');
    var from = pager($('#pvPager'), 'pv', list.length, renderProveedores);
    if (!list.length) { body.innerHTML = '<tr><td colspan="5" class="tbl-empty">' + (all.length ? 'No hay proveedores con esa búsqueda.' : 'Todavía no hay proveedores. Cargalos acá o se guardan solos al registrar una compra.') + '</td></tr>'; return; }
    body.innerHTML = list.slice(from, from + PAGE).map(function (p) {
      return '<tr><td><strong>' + esc(p.nombre) + '</strong>' + (p.email ? '<span class="t-sub">' + esc(p.email) + '</span>' : '') + '</td>' +
        '<td class="nowrap">' + esc(p.ruc || '—') + '</td><td class="nowrap">' + esc(p.tel || '—') + '</td><td>' + esc(p.contacto || '—') + '</td>' +
        '<td class="actions"><button type="button" class="icon-btn" data-pvedit="' + esc(p.id) + '" title="Editar" aria-label="Editar ' + esc(p.nombre) + '">' + PEN + '</button>' +
        (A.can('borrarClientes') ? '<button type="button" class="icon-btn icon-danger icon-void" data-pvdel="' + esc(p.id) + '" title="Eliminar" aria-label="Eliminar ' + esc(p.nombre) + '">' + TRASH + '</button>' : '') + '</td></tr>';
    }).join('');
  }
  $('#pvSearch').addEventListener('input', function () { page.pv = 1; renderProveedores(); });
  $('#pvCancel').addEventListener('click', pvReset);
  $('#pvRows').addEventListener('click', async function (e) {
    var b, list = C().proveedores;
    if ((b = e.target.closest('[data-pvedit]'))) {
      var p = list.filter(function (x) { return x.id === b.dataset.pvedit; })[0];
      if (!p) return;
      $('#pvId').value = p.id; $('#pvName').value = p.nombre || ''; $('#pvRuc').value = p.ruc || ''; $('#pvTel').value = p.tel || '';
      $('#pvMail').value = p.email || ''; $('#pvContacto').value = p.contacto || ''; $('#pvDir').value = p.dir || '';
      $('#pvFormTitle').textContent = 'Editar proveedor'; $('#pvSaveBtn').textContent = 'Guardar cambios'; $('#pvCancel').hidden = false;
      $('#pvName').focus();
      return;
    }
    if ((b = e.target.closest('[data-pvdel]'))) {
      if (!A.can('borrarClientes')) { A.showMsg('error', 'No tenés permiso para eliminar proveedores.'); return; }
      var d = list.filter(function (x) { return x.id === b.dataset.pvdel; })[0];
      if (!d) return;
      var ok = await A.ask({ title: '¿Eliminar a ' + d.nombre + '?', text: 'Se borra de la lista de proveedores. Las compras que ya tiene no se tocan.', ok: 'Sí, eliminar', danger: true });
      if (!ok) return;
      C().proveedores = list.filter(function (x) { return x.id !== d.id; });
      save('Eliminar proveedor ' + d.nombre);
      A.showMsg('ok', 'Proveedor eliminado.');
      renderProveedores();
    }
  });
  $('#pvForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    try { await ready(); } catch (err) { A.showMsg('error', err.message); return; }
    var id = $('#pvId').value, name = $('#pvName').value.trim(), rucTxt = $('#pvRuc').value.trim(), ruc = '';
    if (!name) { A.showMsg('error', 'Escribí el nombre del proveedor.'); $('#pvName').focus(); return; }
    if (rucTxt) {
      var r = parseRuc(rucTxt);
      if (!r) { A.showMsg('error', 'Escribí el RUC con su dígito verificador, por ejemplo 80012345-6.'); $('#pvRuc').focus(); return; }
      if (!r.ok) { A.showMsg('error', 'El RUC ' + r.doc + '-' + r.dv + ' no es válido: el dígito verificador debería ser ' + V.rucDv(r.doc) + '.'); $('#pvRuc').focus(); return; }
      ruc = r.doc + '-' + r.dv;
    }
    var list = C().proveedores;
    if (list.some(function (x) { return x.id !== id && ((ruc && norm(x.ruc) === norm(ruc)) || lower(x.nombre).trim() === lower(name)); })) { A.showMsg('error', 'Ese proveedor ya está cargado.'); return; }
    var data = { nombre: name, ruc: ruc, tel: $('#pvTel').value.trim(), email: $('#pvMail').value.trim(), contacto: $('#pvContacto').value.trim(), dir: $('#pvDir').value.trim(), actualizado: new Date().toISOString() };
    if (id) Object.assign(list.filter(function (x) { return x.id === id; })[0] || {}, data);
    else list.push(Object.assign({ id: A.rid(), creado: new Date().toISOString() }, data));
    save((id ? 'Editar' : 'Nuevo') + ' proveedor ' + name);
    A.showMsg('ok', id ? 'Proveedor actualizado.' : 'Proveedor guardado. Ya lo podés buscar al registrar una compra.');
    pvReset();
    renderProveedores();
  });

  V.hooks.contactos = function () {
    if (!$('[data-pane="clientes"]').hidden) renderClientes();
    if (!$('[data-pane="proveedores"]').hidden) renderProveedores();
  };
  A.on('tab', function (name) {
    if (name === 'clientes') renderClientes();
    if (name === 'proveedores') renderProveedores();
  });
})();