/* Utilidades compartidas entre el catálogo y el panel */
window.Z = (function () {
  'use strict';
  var GENDERS = ['Dama', 'Caballero', 'Unisex', 'Niños'];
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    return 'Gs. ' + String(Math.round(+n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
  function lower(s) { return String(s == null ? '' : s).toLocaleLowerCase('es'); }
  function num(v) { return parseInt(String(v == null ? '' : v).replace(/\D/g, ''), 10) || 0; }
  function natCmp(a, b) { return String(a).localeCompare(String(b), 'es', { numeric: true, sensitivity: 'base' }); }
  function instLabel(price, n, amount) {
    var total = n * amount, label = n + ' x ' + money(amount);
    if (!price || total <= price) return label + ' (sin interés)';
    return label + ' (' + ((total - price) / price * 100).toFixed(1) + '% interés)';
  }
  function stockOf(p) {
    if (p.sizes && p.sizes.length) return p.sizes.reduce(function (t, s) { return t + (+s.stock || 0); }, 0);
    return +p.stock || 0;
  }
  function brandByName(brands, name) {
    var k = lower(name);
    for (var i = 0; i < brands.length; i++) if (lower(brands[i].name) === k) return brands[i];
    return null;
  }
  var SHOE_PATHS = '<path d="M2.5 15.5V9.8c0-.5.4-.8.9-.7l1.9.4c.9.2 1.8-.1 2.4-.8L9.2 7a.8.8 0 0 1 1.2 0l.9 1c.9 1 2.1 1.6 3.4 1.8l3.1.5c1.9.3 3.4 1.8 3.7 3.7l.1 1.5"/>' +
    '<path d="M2.5 15.5h19v1.4c0 .9-.7 1.6-1.6 1.6H4.1c-.9 0-1.6-.7-1.6-1.6z"/><path d="M10.6 10.6l1.2-1.1M12.6 11.4l1.2-1.2"/>';
  /* Ícono de calzado (SVG, sin emojis) */
  function shoe(size, cls) {
    return '<svg class="' + (cls || 'ico') + '" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
      ' stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + SHOE_PATHS + '</svg>';
  }
  function initial(name) { return esc(String(name || '?').trim().charAt(0).toUpperCase()); }
  var WA_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.04 2a9.9 9.9 0 0 0-8.5 15l-1.4 5 5.1-1.3A9.9 9.9 0 1 0 12.04 2Zm0 18.1a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3a8.2 8.2 0 1 1 6.9 3.8Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z"/></svg>';
  /* Ojito para ver u ocultar la contraseña: ojo cerrado = oculta, ojo abierto = se ve */
  var EYE_OPEN = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_CLOSED = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10c2.2 3 5.3 5 9 5s6.8-2 9-5"/><path d="M5.5 13.5 4 16M9.5 15l-.8 2.7M14.5 15l.8 2.7M18.5 13.5 20 16"/></svg>';
  function addEyes(root) {
    var list = (root || document).querySelectorAll('input[type="password"]:not([data-eye])');
    Array.prototype.forEach.call(list, function (inp) {
      inp.setAttribute('data-eye', '1');
      var wrap = document.createElement('span');
      wrap.className = 'pw-wrap';
      inp.parentNode.insertBefore(wrap, inp);
      wrap.appendChild(inp);
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'pw-eye';
      b.innerHTML = EYE_CLOSED;
      b.setAttribute('aria-label', 'Mostrar contraseña');
      b.title = 'Mostrar contraseña';
      b.addEventListener('click', function () {
        var show = inp.type === 'password';
        inp.type = show ? 'text' : 'password';
        b.innerHTML = show ? EYE_OPEN : EYE_CLOSED;
        b.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
        b.title = show ? 'Ocultar contraseña' : 'Mostrar contraseña';
        b.classList.toggle('is-on', show);
        inp.focus();
        try { var n = inp.value.length; inp.setSelectionRange(n, n); } catch (e) { /* nada */ }
      });
      wrap.appendChild(b);
      // al enviar el formulario se vuelve a ocultar
      if (inp.form) inp.form.addEventListener('submit', function () { if (inp.type === 'text') b.click(); });
    });
  }
  /* Paginador: « ‹ 1 … 4 5 6 … 20 › »  y "21–40 de 97" */
  function pager(el, o) {
    var max = Math.max(1, Math.ceil(o.total / o.per)), pg = Math.min(Math.max(1, o.page), max);
    if (!o.total) { el.innerHTML = ''; return; }
    var from = (pg - 1) * o.per, info = '<span class="pager-info">' + (from + 1) + '–' + Math.min(from + o.per, o.total) + ' de ' + o.total + '</span>';
    if (max === 1) { el.innerHTML = '<span class="pager-info">' + o.total + (o.total === 1 ? ' registro' : ' registros') + '</span>'; return; }
    var nums = [], last = 0;
    for (var i = 1; i <= max; i++) {
      if (i === 1 || i === max || Math.abs(i - pg) <= 1 || (pg <= 3 && i <= 4) || (pg >= max - 2 && i >= max - 3)) {
        if (last && i - last > 1) nums.push('<span class="pg-dots">…</span>');
        nums.push('<button type="button" data-pg="' + i + '" class="' + (i === pg ? 'on' : '') + '"' + (i === pg ? ' aria-current="page"' : '') + '>' + i + '</button>');
        last = i;
      }
    }
    el.innerHTML = info + '<div class="pager-btns">' +
      '<button type="button" data-pg="' + (pg - 1) + '"' + (pg === 1 ? ' disabled' : '') + ' aria-label="Página anterior">‹</button>' + nums.join('') +
      '<button type="button" data-pg="' + (pg + 1) + '"' + (pg === max ? ' disabled' : '') + ' aria-label="Página siguiente">›</button></div>';
    el.onclick = function (e) { var b = e.target.closest('[data-pg]'); if (b && !b.disabled) o.onPage(+b.dataset.pg); };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { addEyes(); });
  else setTimeout(addEyes, 0);

  /* Quita el texto "Verificando..." que una versión vieja del panel pone al lado de la contraseña:
     el estado correcto va debajo del botón Ingresar. */
  function cleanPwNotes() {
    document.querySelectorAll('.fld, .login-form label').forEach(function (lab) {
      if (!lab.querySelector('input[type="password"], .pw-wrap')) return;
      Array.prototype.slice.call(lab.childNodes).forEach(function (n) {
        if (n.nodeType === 3 && /verificando/i.test(n.textContent)) n.textContent = '';
        else if (n.nodeType === 1 && n !== lab.firstElementChild && !n.matches('span.pw-wrap, input, span, label') && /verificando/i.test(n.textContent || '')) n.remove();
      });
    });
  }
  function watchPwNotes() {
    if (!window.MutationObserver) { setInterval(cleanPwNotes, 400); return; }
    var mo = new MutationObserver(cleanPwNotes);
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    cleanPwNotes();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchPwNotes);
  else watchPwNotes();

  return { GENDERS: GENDERS, esc: esc, money: money, lower: lower, num: num, natCmp: natCmp,
           instLabel: instLabel, stockOf: stockOf, brandByName: brandByName, initial: initial, shoe: shoe, WA_ICON: WA_ICON, addEyes: addEyes, pager: pager };
})();