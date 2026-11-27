@echo off
setlocal
chcp 65001 >nul
title ACR Audio - cola de separacion (deja esta ventana abierta)
cd /d "%~dp0"

echo ==================================================================
echo  ACR Audio - trabajador de la cola de separacion
echo ==================================================================
echo  Esta ventana separa las canciones que subas en la web, de una en
echo  una, usando la GPU. DEJALA ABIERTA mientras uses ACR Audio.
echo  Si la cierras, las canciones nuevas se quedan "En cola" hasta que
echo  la vuelvas a abrir (no se pierden).
echo.
echo  Web: http://acr_audio.test
echo  Para detenerla: cierra la ventana o pulsa Ctrl+C.
echo ==================================================================
echo.

where php >nul 2>nul
if errorlevel 1 (
    echo No se encontro PHP. Abre Laravel Herd y vuelve a intentarlo.
    pause
    exit /b 1
)

where ffmpeg >nul 2>nul
if errorlevel 1 (
    echo AVISO: ffmpeg no esta en el PATH. audio-separator lo necesita.
    echo.
)

rem Si el worker se cierra por un error, se vuelve a arrancar a los 5 segundos.
:bucle
php artisan queue:work --queue=separation --sleep=2 --memory=512
echo.
echo El trabajador se detuvo. Reiniciando en 5 segundos... (Ctrl+C para salir)
timeout /t 5 /nobreak >nul
goto bucle
