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
  return { GENDERS: GENDERS, esc: esc, money: money, lower: lower, num: num, natCmp: natCmp,
           instLabel: instLabel, stockOf: stockOf, brandByName: brandByName, initial: initial, shoe: shoe, WA_ICON: WA_ICON };
})();
