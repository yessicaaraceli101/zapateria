# Catálogo de zapatería para GitHub Pages

Funciona 100 % en GitHub Pages, gratis y sin servidor. El panel de administración
guarda cada cambio directamente en tu repositorio de GitHub.

## Qué incluye

- **Catálogo** (`index.html`): búsqueda, franja de marcas que filtra al tocarla, filtros por
  categoría, para quién, talle y precio. Talles con stock (los agotados salen tachados),
  cuotas con interés calculado y botón de WhatsApp con modelo, talle y forma de pago.
- **Panel** (`admin.html` o `/admin`): productos, marcas (ya vienen Beira Rio, Modare,
  Actvitta, BR Sport, Molekinha y Molekinho), datos de la tienda, y cambio de
  **usuario y contraseña**.

## Publicarlo (una sola vez)

### 1. Crear el repositorio
1. Entrá a github.com (creá una cuenta si no tenés).
2. Arriba a la derecha: **+ → New repository**.
3. Nombre: `zapateria` · marcá **Public** · **Create repository**.
4. Tocá **uploading an existing file** y arrastrá **todo el contenido** de esta carpeta
   (las carpetas `assets`, `data`, `img`, `admin` y los archivos sueltos). **Commit changes**.

### 2. Activar GitHub Pages
1. En el repositorio: **Settings → Pages**.
2. En *Branch* elegí **main** y la carpeta **/ (root)** → **Save**.
3. En 1 o 2 minutos aparece tu dirección: `https://TU-USUARIO.github.io/zapateria/`

### 3. Crear el token para el panel
El panel necesita un permiso de GitHub para poder guardar los cambios.
1. Foto de perfil (arriba a la derecha) → **Settings** → abajo a la izquierda
   **Developer settings** → **Personal access tokens → Fine-grained tokens** →
   **Generate new token**.
2. *Token name*: `panel zapateria`. *Expiration*: elegí la fecha más lejana que te deje.
3. *Repository access*: **Only select repositories** → `zapateria`.
4. *Permissions → Repository permissions → Contents*: **Read and write**.
5. **Generate token** y copialo (empieza con `github_pat_`). Solo se muestra una vez.

### 4. Activar el panel (lo hace solo quien instala)
1. Abrí `https://TU-USUARIO.github.io/zapateria/conectar.html`
   (esta página no tiene enlaces en ningún lado; el dueño de la tienda no la ve).
2. Usuario actual: `admin` · Contraseña actual: `admin123`.
3. Elegí el **usuario y la contraseña definitivos** (se reemplazan en el mismo paso,
   así el token nunca queda guardado con la contraseña de fábrica).
4. Completá tu usuario de GitHub, el repositorio y pegá el token → **Activar**.
5. Entrá a `/admin` con el usuario y la contraseña nuevos.

Dentro del panel no aparece nada de GitHub: solo productos, marcas y configuración.

## Uso diario
- Entrá a `/admin` con tu usuario y contraseña.
- Cada cambio aparece en el catálogo público en **1 o 2 minutos** (es lo que tarda GitHub Pages).
- Usuario y contraseña se cambian en **Configuración**.
- Si el token vence, el panel avisa "El sistema necesita ser reactivado": creá un token nuevo
  (paso 3) y cargalo en `conectar.html` (usuario y contraseña actuales, y los nuevos que quieras).

## Si olvidás la contraseña
Volvé a subir el archivo `data/acceso.json` del zip a tu repositorio (reemplazando
el que está). El acceso vuelve a ser `admin` / `admin123` y tenés que repetir el paso 4
(activar con conectar.html y cambiar la contraseña). Tus productos no se pierden.

## Probar en tu computadora (con Python)
Hacé doble clic en `probar_en_mi_pc.py` o ejecutá `python probar_en_mi_pc.py`.
Se abre `http://localhost:8000`.
También sirve `python -m http.server 8000` ejecutado dentro de esta carpeta.
En tu PC podés entrar al panel con admin / admin123 para mirarlo; para guardar
cambios hay que activarlo con conectar.html.

## Seguridad
- El token se guarda **cifrado** (AES-256) con tu usuario y contraseña; sin ellos no sirve.
  Como el archivo cifrado es público, usá una contraseña larga y que no uses en otro lado.
- El token solo tiene permiso sobre este repositorio.
- Fotos: se achican solas antes de subirlas (máximo 1000 px).
