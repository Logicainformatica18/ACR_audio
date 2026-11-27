"""
Descarga los pesos oficiales de BTC (unos 12 MB cada uno) desde el repositorio
de sus autores (https://github.com/jayg996/BTC-ISMIR19, licencia MIT) a la
carpeta modelos/. Esa carpeta está en .gitignore.

Uso:  .venv\\Scripts\\python.exe descargar_modelos.py
"""

import hashlib
import os
import sys
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
DESTINO = os.path.join(AQUI, "modelos")
BASE = "https://github.com/jayg996/BTC-ISMIR19/raw/master/test/"

# Huella SHA-256 de los archivos publicados (para detectar descargas corruptas).
ARCHIVOS = {
    "btc_model_large_voca.pt": "1673d23f8f9a55ae7f9e8b80a51da616debb22675b8d8b67ea6ce0ef37b0ab51",
    "btc_model.pt": "71c2c5db17e8c43b8a9a9da5db36ef2d667158c07a214eba16344c154c00bf54",
}


def sha256(ruta):
    h = hashlib.sha256()
    with open(ruta, "rb") as f:
        for bloque in iter(lambda: f.read(1 << 20), b""):
            h.update(bloque)
    return h.hexdigest()


def main():
    os.makedirs(DESTINO, exist_ok=True)
    ok = True
    for nombre, huella in ARCHIVOS.items():
        ruta = os.path.join(DESTINO, nombre)
        if os.path.isfile(ruta) and sha256(ruta) == huella:
            print(f"Ya está: {nombre}")
            continue
        print(f"Descargando {nombre}...")
        urllib.request.urlretrieve(BASE + nombre, ruta + ".part")
        if sha256(ruta + ".part") != huella:
            os.remove(ruta + ".part")
            print(f"ERROR: la huella de {nombre} no coincide; descarga descartada.")
            ok = False
            continue
        os.replace(ruta + ".part", ruta)
        print(f"Listo: {nombre}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
