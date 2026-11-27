@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
echo === Instalando el motor de acordes de ACR Audio ===
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
echo Instalando torch con CUDA 12.8 (unos 3 GB)...
.venv\Scripts\python.exe -m pip install torch==2.11.0 --index-url https://download.pytorch.org/whl/cu128
if errorlevel 1 goto error
.venv\Scripts\python.exe -m pip install -r requirements.txt
if errorlevel 1 goto error
.venv\Scripts\python.exe descargar_modelos.py
if errorlevel 1 goto error
.venv\Scripts\python.exe -c "import torch; print(\"GPU disponible:\", torch.cuda.is_available())"
echo.
echo Listo.
pause
exit /b 0
:error
echo.
echo Algo fallo. Revisa los mensajes de arriba.
pause
exit /b 1
