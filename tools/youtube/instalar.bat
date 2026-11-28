@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
echo === Instalando el motor de descargas de YouTube de ACR Audio ===
echo.
if not exist .venv\Scripts\python.exe (
    echo Creando el entorno virtual .venv con Python 3.12...
    py -3.12 -m venv .venv
    if errorlevel 1 (
        echo No se encontro Python 3.12. Instalalo desde https://www.python.org/
        pause
        exit /b 1
    )
)
.venv\Scripts\python.exe -m pip install --upgrade pip
.venv\Scripts\python.exe -m pip install --upgrade -r requirements.txt
if errorlevel 1 goto error
.venv\Scripts\python.exe youtube.py version
where ffmpeg >nul 2>nul
if errorlevel 1 echo AVISO: ffmpeg no esta en el PATH; hace falta para convertir a FLAC.
echo.
echo Listo.
pause
exit /b 0
:error
echo.
echo Algo fallo. Revisa los mensajes de arriba.
pause
exit /b 1
