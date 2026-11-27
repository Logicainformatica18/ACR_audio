<?php

/*
|--------------------------------------------------------------------------
| ACR Audio
|--------------------------------------------------------------------------
| Configuración del almacenamiento de audios y del motor de separación.
| Los valores se leen del .env (ver .env.example).
*/

return [

    // La carpeta base de los audios es el disco "audio" (config/filesystems.php),
    // configurable con AUDIO_STORAGE_PATH.
    // Estructura: {base}/{usuario_id}/{cancion_id}/original.ext y stems/{pista}.flac

    // Subida
    'max_upload_mb' => (int) env('AUDIO_MAX_UPLOAD_MB', 250),
    'allowed_extensions' => ['mp3', 'wav', 'flac', 'm4a', 'ogg'],

    // Motor de separación (audio-separator)
    'separator' => [
        'bin' => env('SEPARATOR_BIN'),
        'models_dir' => env('SEPARATOR_MODELS_DIR'),
        'model' => env('SEPARATOR_MODEL', 'htdemucs_6s.yaml'),
        'output_format' => env('SEPARATOR_OUTPUT_FORMAT', 'FLAC'),
        // Segundos máximos por canción antes de cancelar el proceso.
        'timeout' => (int) env('SEPARATOR_TIMEOUT', 3600),
    ],

    // Motor de acordes (tools/acordes, con su propio .venv). Las rutas vacías
    // usan las del propio proyecto. Admiten rutas absolutas o relativas al proyecto.
    'chords' => [
        'python' => env('CHORDS_PYTHON') ?: 'tools/acordes/.venv/Scripts/python.exe',
        'script' => env('CHORDS_SCRIPT') ?: 'tools/acordes/acordes.py',
        'models_dir' => env('CHORDS_MODELS_DIR') ?: 'tools/acordes/modelos',
        // btc-large (vocabulario grande: 7, maj7, m7, dim, sus...) o btc-majmin
        'model' => env('CHORDS_MODEL', 'btc-large'),
        'timeout' => (int) env('CHORDS_TIMEOUT', 900),
        // Pistas que se mezclan para analizar (sin batería ni voz).
        'stems' => ['guitar', 'bass', 'piano', 'other'],
        // Archivo de pesos de cada modelo (para comprobar que está descargado).
        'weights' => [
            'btc-large' => 'btc_model_large_voca.pt',
            'btc-majmin' => 'btc_model.pt',
        ],
    ],

    // Modelos que el usuario puede elegir en sus preferencias.
    // La clave es el nombre que se pasa a audio-separator con -m.
    'models' => [
        'htdemucs_6s.yaml' => 'HTDemucs 6 pistas (voz, batería, bajo, guitarra, piano, otros)',
        'htdemucs_ft.yaml' => 'HTDemucs afinado (4 pistas: voz, batería, bajo, otros)',
        'htdemucs.yaml' => 'HTDemucs (4 pistas: voz, batería, bajo, otros)',
    ],

    // Pistas conocidas, en el orden en que se muestran, con nombre y color.
    'stems' => [
        'vocals' => ['label' => 'Voz', 'color' => '#D9668A'],
        'drums' => ['label' => 'Batería', 'color' => '#E0A23A'],
        'bass' => ['label' => 'Bajo', 'color' => '#5B8DEF'],
        'guitar' => ['label' => 'Guitarra', 'color' => '#E2603F'],
        'piano' => ['label' => 'Piano', 'color' => '#45B39D'],
        'other' => ['label' => 'Otros', 'color' => '#9B7FD1'],
        'instrumental' => ['label' => 'Instrumental', 'color' => '#7FA7C9'],
    ],
];
