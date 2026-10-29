/* Activación del panel: guarda el token de GitHub cifrado con el usuario y la contraseña del panel. */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var enc = new TextEncoder(), dec = new TextDecoder();
  var AUTH_PATH = 'data/acceso.json', SESSION_KEY = 'zapateria_admin';

  $('#ico').innerHTML = Z.shoe(26);
  var m = location.hostname.match(/^([^.]+)\.github\.io$/i);
  if (m) {
    var first = location.pathname.split('/').filter(Boolean)[0] || '';
    $('#owner').value = m[1];
    $('#repo').value = first && !/\.html?$/i.test(first) ? first : m[1] + '.github.io';
  }

  function msg(type, text) {
    $('#msgs').innerHTML = '<div class="alert alert-' + type + '">' + Z.esc(text) + '</div>';
  }
  function b64(buf) {
    var b = buf instanceof Uint8Array ? buf : new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(s) {
    var bin = atob(String(s).replace(/\s/g, '')), o = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i);
    return o;
  }
  async function key(user, pass, salt, it) {
    var base = await crypto.subtle.importKey('raw', enc.encode(Z.lower(user.trim()) + '\n' + pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: it, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  /* Devuelve el contenido descifrado o null si el usuario/contraseña no coinciden */
  async function check(user, pass, auth) {
    if (auth && Array.isArray(auth.users)) {
      // formato con varios usuarios: solo un administrador puede reactivar
      var ent = auth.users.filter(function (u) { return Z.lower(u.user) === Z.lower(user.trim()) && u.role !== 'cajero'; })[0];
      return ent ? check(user, pass, ent) : null;
    }
    try {
      var k = await key(user, pass, unb64(auth.salt), auth.iterations || 310000);
      var pt = dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(auth.iv) }, k, unb64(auth.ct)));
      try { var o = JSON.parse(pt); if (o && typeof o === 'object') return o; } catch (e) { /* formato anterior */ }
      return { token: pt };
    } catch (e) { return null; }
  }
  async function seal(user, pass, token, dataKey) {
    var salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), it = 310000;
    var k = await key(user, pass, salt, it);
    var ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, enc.encode(JSON.stringify({ token: token, dataKey: dataKey || '' })));
    return { salt: b64(salt), iv: b64(iv), ct: b64(ct), iterations: it };
  }
  async function gh(path, token, opts) {
    opts = opts || {};
    var r = await fetch('https://api.github.com' + path, {
      method: opts.method || 'GET', body: opts.body, cache: 'no-store',
      headers: { 'Accept': 'application/vnd.github+json', 'Authorization': 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28' }
    });
    if (r.status === 404 && opts.allow404) return null;
    if (!r.ok) {
      var t = ''; try { t = (await r.json()).message || ''; } catch (e) { /* nada */ }
      if (r.status === 401) throw new Error('GitHub rechazó el token: no es válido o venció.');
      if (r.status === 403) throw new Error('El token no tiene permiso "Contents: Read and write" sobre ese repositorio.');
      if (r.status === 404) throw new Error('No se encontró el repositorio, o el token no tiene acceso a él.');
      throw new Error('Error de GitHub (' + r.status + '): ' + t);
    }
    return r.json();
  }

  $('#f').addEventListener('submit', async function (e) {
    e.preventDefault();
    var user = $('#u').value.trim(), pass = $('#p').value;
    var owner = $('#owner').value.trim(), repo = $('#repo').value.trim(), branch = $('#branch').value.trim(), token = $('#token').value.trim();
    var nu = $('#nu').value.trim(), np = $('#np').value, np2 = $('#np2').value;
    if (!/^[A-Za-z0-9._@-]{3,40}$/.test(nu)) return msg('error', 'El nuevo usuario debe tener entre 3 y 40 caracteres: letras, números, punto, guion, guion bajo o @.');
    if (np.length < 8) return msg('error', 'La nueva contraseña debe tener al menos 8 caracteres.');
    if (np !== np2) return msg('error', 'Las contraseñas nuevas no coinciden.');
    if (Z.lower(nu) === 'admin' && np === 'admin123') return msg('error', 'Elegí una contraseña distinta a la de fábrica.');
    var btn = $('#go');
    btn.disabled = true; btn.textContent = 'Activando…';
    try {
      if (!window.crypto || !crypto.subtle) throw new Error('Abrí esta página desde https o localhost.');
      var info = await gh('/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo), token);
      branch = branch || info.default_branch || 'main';
      var path = '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) + '/contents/data/acceso.json';
      var remote = await gh(path + '?ref=' + encodeURIComponent(branch), token, { allow404: true });
      var current = remote ? JSON.parse(dec.decode(unb64(remote.content))) : null;
      var opened = current ? await check(user, pass, current) : null;
      var ok = !!opened;
      if (!ok) {
        var pub = null;
        try { var r = await fetch(AUTH_PATH + '?t=' + Date.now(), { cache: 'no-store' }); if (r.ok) pub = await r.json(); } catch (err) { /* nada */ }
        opened = pub ? await check(user, pass, pub) : null;
        ok = !!opened || (!current && !pub);
      }
      if (!ok) throw new Error('Usuario o contraseña del panel incorrectos.');
      // Se conserva la llave de las ventas y compras ya guardadas
      var dataKey = (opened && opened.dataKey) || b64(crypto.getRandomValues(new Uint8Array(32)));
      // queda un solo usuario administrador; los cajeros se vuelven a crear desde Configuración → Usuarios
      var hadOthers = current && Array.isArray(current.users) && current.users.length > 1;
      var auth = { version: 3, owner: owner, repo: repo, branch: branch, is_default: false,
                   users: [Object.assign({ user: nu, role: 'admin' }, await seal(nu, np, token, dataKey))] };
      var body = { message: 'Activar el panel', branch: branch, content: b64(enc.encode(JSON.stringify(auth, null, 2) + '\n')) };
      if (remote) body.sha = remote.sha;
      await gh(path, token, { method: 'PUT', body: JSON.stringify(body) });
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: token, dataKey: dataKey, user: nu, role: 'admin', repo: { owner: owner, repo: repo, branch: branch } }));
      $('#f').reset();
      $('#f').hidden = true;
      msg('ok', 'Panel activado. Desde ahora se ingresa con «' + nu + '» y la contraseña nueva.' + (hadOthers ? ' Volvé a crear los otros usuarios en Configuración → Usuarios.' : ''));
      $('.login-back').textContent = 'Ir al panel';
    } catch (err) {
      msg('error', err.message || String(err));
    } finally {
      btn.disabled = false; btn.textContent = 'Activar';
    }
  });
})();