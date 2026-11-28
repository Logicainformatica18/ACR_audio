"""
Motor de descargas de YouTube para ACR Audio (yt-dlp + Deno + FFmpeg).

Laravel solo le pasa IDs ya validados (nunca texto del usuario) y este script
vuelve a validarlos. Escribe una línea JSON por evento en la salida estándar:

  python youtube.py info video ID          -> {"tipo":"info", ...}
  python youtube.py info lista ID          -> {"tipo":"info", "entradas":[...]}  (sin descargar nada)
  python youtube.py descargar ID CARPETA   -> {"tipo":"progreso","pct":35,"fase":"descargando"} ...
                                              {"tipo":"fin","archivo":"original.flac", ...}
  python youtube.py version                -> {"tipo":"version","yt_dlp":"...","deno":"..."}
  (si algo falla)                          -> {"tipo":"error","codigo":"privado","mensaje":"..."}  y código 1

El audio se descarga en la mejor calidad disponible y se convierte a FLAC
(sin pérdida): nunca a MP3.
"""

import json
import os
import re
import shutil
import subprocess
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
LIST_ID = re.compile(r"^[A-Za-z0-9_-]{10,64}$")


def emitir(**evento):
    sys.stdout.write(json.dumps(evento, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def ruta_deno():
    """Deno instalado en este .venv (pip install deno) o, si no, el del PATH."""
    candidatos = [
        os.path.join(AQUI, ".venv", "Scripts", "deno.exe"),
        os.path.join(AQUI, ".venv", "bin", "deno"),
        os.environ.get("DENO_PATH") or "",
        shutil.which("deno") or "",
    ]
    for c in candidatos:
        if c and os.path.isfile(c):
            return c
    return None


def opciones_base():
    opts = {"quiet": True, "no_warnings": True, "noprogress": True, "noplaylist": True}
    deno = ruta_deno()
    if deno:
        opts["js_runtimes"] = {"deno": {"path": deno}}
    return opts


# Errores de yt-dlp -> código y mensaje claro en español.
ERRORES = [
    ("privado", ("private video", "video is private", "this video is private"), "El video es privado: solo su autor puede verlo."),
    ("region", ("not available in your country", "geo restrict", "geo-restrict", "blocked it in your country"),
     "El video no está disponible en tu país."),
    ("edad", ("sign in to confirm your age", "age-restricted", "age restricted", "inappropriate for some users"),
     "El video tiene restricción de edad: YouTube pide iniciar sesión para verlo."),
    ("miembros", ("members-only", "join this channel", "members only"), "El video es solo para miembros del canal."),
    ("enlace", ("unsupported url", "incomplete youtube id", "is not a valid url", "invalid url"),
     "El enlace no es válido."),
    ("desactualizado", ("signature extraction failed", "nsig extraction", "requested format is not available",
                        "http error 403", "no supported javascript runtime", "unable to extract", "please update",
                        "sabr", "precondition check failed"),
     "yt-dlp parece desactualizado (YouTube cambió algo). Actualízalo en Configuración → Preferencias → «Actualizar yt-dlp»."),
    ("no_disponible", ("video unavailable", "is unavailable", "has been removed", "is not available", "does not exist",
                       "this live event", "premieres in", "account associated with this video has been terminated"),
     "El video no está disponible (borrado, oculto o aún no publicado)."),
    ("red", ("getaddrinfo failed", "timed out", "connection reset", "temporary failure in name resolution",
             "unable to download webpage", "network is unreachable"),
     "No hay conexión con YouTube. Revisa tu conexión a internet."),
]


def clasificar(texto):
    t = (texto or "").lower()
    for codigo, claves, mensaje in ERRORES:
        if any(k in t for k in claves):
            return codigo, mensaje
    limpio = re.sub(r"\x1b\[[0-9;]*m", "", texto or "").replace("ERROR:", "").strip()
    return "otro", f"No se pudo completar: {limpio[:300]}" if limpio else "Error desconocido de yt-dlp."


def miniatura(info):
    """La miniatura más adecuada (unos 480 px de ancho si existe)."""
    thumbs = info.get("thumbnails") or []
    mejor = None
    for t in thumbs:
        if not t.get("url"):
            continue
        w = t.get("width") or 0
        if mejor is None or (abs(w - 480) < abs((mejor.get("width") or 0) - 480)):
            mejor = t
    if mejor:
        return mejor["url"]
    vid = info.get("id")
    return info.get("thumbnail") or (f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg" if vid else None)


def info_video(vid):
    import yt_dlp

    with yt_dlp.YoutubeDL({**opciones_base(), "skip_download": True}) as ydl:
        i = ydl.extract_info(f"https://www.youtube.com/watch?v={vid}", download=False)
    emitir(tipo="info", clase="video", id=i.get("id"), titulo=i.get("title"),
           canal=i.get("channel") or i.get("uploader"), duracion=i.get("duration"),
           miniatura=miniatura(i), url=f"https://www.youtube.com/watch?v={i.get('id')}")


def info_lista(lid):
    import yt_dlp

    opts = {**opciones_base(), "skip_download": True, "extract_flat": "in_playlist", "noplaylist": False}
    with yt_dlp.YoutubeDL(opts) as ydl:
        i = ydl.extract_info(f"https://www.youtube.com/playlist?list={lid}", download=False)
    entradas = []
    for e in i.get("entries") or []:
        if not e or not VIDEO_ID.match(str(e.get("id") or "")):
            continue
        entradas.append({
            "id": e["id"],
            "titulo": e.get("title") or "(sin título)",
            "canal": e.get("channel") or e.get("uploader"),
            "duracion": e.get("duration"),
            "miniatura": miniatura(e),
            # Los privados o borrados aparecen en la lista con títulos así:
            "disponible": (e.get("title") or "") not in ("[Private video]", "[Deleted video]"),
        })
    emitir(tipo="info", clase="lista", id=lid, titulo=i.get("title") or "Lista de YouTube",
           canal=i.get("channel") or i.get("uploader"), entradas=entradas)


def descargar(vid, carpeta):
    import yt_dlp

    os.makedirs(carpeta, exist_ok=True)
    ultimo = {"pct": -1}

    def progreso(d):
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            pct = int(d.get("downloaded_bytes", 0) * 90 / total) if total else 0  # 0–90 %: descarga
            if pct > ultimo["pct"]:
                ultimo["pct"] = pct
                emitir(tipo="progreso", pct=pct, fase="descargando")
        elif d.get("status") == "finished":
            emitir(tipo="progreso", pct=90, fase="convirtiendo a FLAC")

    def post(d):
        if d.get("status") == "finished" and d.get("postprocessor") == "ExtractAudio":
            emitir(tipo="progreso", pct=99, fase="convirtiendo a FLAC")

    opts = {
        **opciones_base(),
        "format": "bestaudio/best",
        "outtmpl": os.path.join(carpeta, "original.%(ext)s"),
        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "flac"}],
        "progress_hooks": [progreso],
        "postprocessor_hooks": [post],
        "overwrites": True,
    }
    emitir(tipo="progreso", pct=0, fase="preparando")
    with yt_dlp.YoutubeDL(opts) as ydl:
        i = ydl.extract_info(f"https://www.youtube.com/watch?v={vid}", download=True)
    destino = os.path.join(carpeta, "original.flac")
    if not os.path.isfile(destino):
        raise RuntimeError("La descarga terminó, pero no apareció el archivo FLAC (¿falta FFmpeg?).")
    emitir(tipo="progreso", pct=100, fase="listo")
    emitir(tipo="fin", archivo="original.flac", titulo=i.get("title"), canal=i.get("channel") or i.get("uploader"),
           duracion=i.get("duration"), miniatura=miniatura(i), url=f"https://www.youtube.com/watch?v={i.get('id')}")


def version():
    import yt_dlp.version

    deno = ruta_deno()
    deno_v = None
    if deno:
        try:
            out = subprocess.run([deno, "--version"], capture_output=True, text=True, timeout=20).stdout
            deno_v = (out.split("\n")[0].replace("deno", "").strip().split(" ")[0]) or None
        except Exception:  # noqa: BLE001
            deno_v = None
    emitir(tipo="version", yt_dlp=yt_dlp.version.__version__, deno=deno_v, deno_ruta=deno)


def main():
    a = sys.argv[1:]
    if a[:1] == ["version"]:
        return version()
    if len(a) == 3 and a[0] == "info" and a[1] == "video" and VIDEO_ID.match(a[2]):
        return info_video(a[2])
    if len(a) == 3 and a[0] == "info" and a[1] == "lista" and LIST_ID.match(a[2]):
        return info_lista(a[2])
    if len(a) == 3 and a[0] == "descargar" and VIDEO_ID.match(a[1]):
        return descargar(a[1], a[2])
    emitir(tipo="error", codigo="enlace", mensaje="Parámetros no válidos.")
    sys.exit(2)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001 - se informa a Laravel con un mensaje claro
        codigo, mensaje = clasificar(str(e))
        emitir(tipo="error", codigo=codigo, mensaje=mensaje, detalle=str(e)[:500])
        sys.exit(1)
