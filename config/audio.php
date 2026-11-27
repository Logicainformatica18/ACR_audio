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
