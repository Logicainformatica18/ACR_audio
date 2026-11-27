@echo off
setlocal
chcp 65001 >nul
title Separador de pistas (htdemucs_6s, GPU)

rem Carpeta donde esta este .bat (con la barra final)
set "BASE=%~dp0"
set "SEP=%BASE%.venv\Scripts\audio-separator.exe"

if not exist "%SEP%" (
    echo No se encontro audio-separator en:
    echo "%SEP%"
    pause
    exit /b 1
)

if "%~1"=="" (
    echo Arrastra una o varias canciones encima de separar.bat
    pause
    exit /b 1
)

:siguiente
if "%~1"=="" goto fin
echo.
echo ==================================================
echo Separando: %~nx1
echo Salida:    %~dp1separado
echo ==================================================
"%SEP%" "%~f1" -m htdemucs_6s.yaml --output_dir "%~dp1separado" --model_file_dir "%BASE%modelos"
if errorlevel 1 goto error
echo Listo.
goto continuar

:error
echo *** ERROR al separar este archivo. Revisa los mensajes de arriba. ***

:continuar
shift
goto siguiente

:fin
echo.
echo Terminado.
pause
