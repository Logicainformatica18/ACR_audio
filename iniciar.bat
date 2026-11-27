@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

rem ==================================================================
rem  ACR Audio - arranca los DOS trabajadores de la cola, cada uno en
rem  su propia ventana:
rem    1) Separacion de pistas  (cola "separation", usa la GPU)
rem    2) Acordes               (cola "acordes", en paralelo)
rem  Uso interno: iniciar.bat separacion  /  iniciar.bat acordes
rem
rem  IMPORTANTE: "php" de Herd es un .bat (php.bat). Por eso se llama con
rem  "call": sin call, al terminar php se cerraria la ventana entera en vez
rem  de volver al bucle que reinicia el worker.
rem ==================================================================

if /i "%~1"=="separacion" goto separacion
if /i "%~1"=="acordes" goto acordes

where php >nul 2>nul
if errorlevel 1 (
    echo No se encontro PHP. Abre Laravel Herd y vuelve a intentarlo.
    pause
    exit /b 1
)

start "ACR Audio - 1 SEPARACION de pistas (deja esta ventana abierta)" cmd /c ""%~f0" separacion"
start "ACR Audio - 2 ACORDES (deja esta ventana abierta)" cmd /c ""%~f0" acordes"

echo ==================================================================
echo  ACR Audio: se abrieron 2 ventanas. DEJALAS ABIERTAS las dos:
echo    1) SEPARACION de pistas
echo    2) ACORDES
echo  Web: http://acr_audio.test
echo ==================================================================
timeout /t 6 >nul
exit /b 0

:separacion
title ACR Audio - 1 SEPARACION de pistas (deja esta ventana abierta)
echo ==================================================================
echo  ACR Audio - 1) SEPARACION de pistas
echo ==================================================================
echo  Separa las canciones que subas, de una en una, usando la GPU.
echo  DEJALA ABIERTA. Si la cierras, las canciones nuevas se quedan
echo  "En cola" hasta que la vuelvas a abrir (no se pierden).
echo  Para detenerla: cierra la ventana o pulsa Ctrl+C.
echo ==================================================================
echo.
where ffmpeg >nul 2>nul
if errorlevel 1 (
    echo AVISO: ffmpeg no esta en el PATH. audio-separator lo necesita.
    echo.
)
rem Si el worker se cierra por un error, se vuelve a arrancar a los 5 segundos.
:bucle_separacion
call php artisan queue:work --queue=separation --sleep=2 --memory=512
echo.
echo El trabajador se detuvo. Reiniciando en 5 segundos... (Ctrl+C para salir)
timeout /t 5 /nobreak >nul
goto bucle_separacion

:acordes
title ACR Audio - 2 ACORDES (deja esta ventana abierta)
echo ==================================================================
echo  ACR Audio - 2) ACORDES
echo ==================================================================
echo  Reconoce los acordes de cada cancion cuando termina de separarse,
echo  en paralelo a la separacion de las siguientes. DEJALA ABIERTA.
echo  Si la cierras, el analisis espera "En cola" hasta que la abras.
echo  Para detenerla: cierra la ventana o pulsa Ctrl+C.
echo ==================================================================
echo.
if not exist "tools\acordes\.venv\Scripts\python.exe" (
    echo AVISO: falta el motor de acordes. Ejecuta tools\acordes\instalar.bat
    echo.
)
:bucle_acordes
call php artisan queue:work --queue=acordes --sleep=1 --memory=512
echo.
echo El trabajador se detuvo. Reiniciando en 5 segundos... (Ctrl+C para salir)
timeout /t 5 /nobreak >nul
goto bucle_acordes
