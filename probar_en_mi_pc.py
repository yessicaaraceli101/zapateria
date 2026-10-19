"""Abre el catálogo en tu computadora para probarlo.

Uso: hacé doble clic en este archivo, o en una terminal escribí
    python probar_en_mi_pc.py
y se abre http://localhost:8000 en el navegador. Para cerrarlo: Ctrl+C.
"""
import http.server
import os
import socketserver
import webbrowser

PUERTO = 8000
os.chdir(os.path.dirname(os.path.abspath(__file__)))


class SinCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


with socketserver.TCPServer(("127.0.0.1", PUERTO), SinCache) as servidor:
    url = f"http://localhost:{PUERTO}"
    print(f"Catálogo funcionando en {url}  (panel: {url}/admin.html)")
    print("Para cerrarlo presioná Ctrl+C.")
    webbrowser.open(url)
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\nListo, servidor cerrado.")
