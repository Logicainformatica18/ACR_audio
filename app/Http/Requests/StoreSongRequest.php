<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Validación de un audio subido: tipo (extensión + tipo MIME real detectado
 * por PHP) y tamaño máximo.
 */
class StoreSongRequest extends FormRequest
{
    /**
     * Tipos MIME que PHP (fileinfo) detecta para los formatos permitidos.
     * Algunos m4a se detectan como video/mp4 y algunos ogg como application/ogg.
     */
    public const MIME_TYPES = [
        'audio/mpeg', 'audio/mp3', 'audio/mpeg3', 'audio/x-mpeg-3',
        'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave',
        'audio/flac', 'audio/x-flac',
        'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'video/mp4', 'audio/aac',
        'audio/ogg', 'application/ogg', 'audio/vorbis', 'audio/opus', 'video/ogg',
    ];

    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    public function rules(): array
    {
        $maxKb = config('audio.max_upload_mb') * 1024;
        $extensions = implode(',', config('audio.allowed_extensions'));

        return [
            'file' => [
                'required',
                'file',
                "extensions:{$extensions}",
                'mimetypes:'.implode(',', self::MIME_TYPES),
                "max:{$maxKb}",
            ],
            // "separate" = separar pistas; "upload" = solo subir. Si falta, se usa lo recordado.
            'mode' => ['nullable', 'in:separate,upload'],
            'chords' => ['nullable', 'boolean'],
            'allow_duplicate' => ['nullable', 'boolean'],
        ];
    }

    public function messages(): array
    {
        $formats = strtoupper(implode(', ', config('audio.allowed_extensions')));

        return [
            'file.required' => 'No llegó ningún archivo.',
            'file.uploaded' => 'No se pudo subir el archivo. Puede que pese más de lo que permite PHP (upload_max_filesize).',
            'file.extensions' => "Formato no permitido. Usa {$formats}.",
            'file.mimetypes' => 'El archivo no parece un audio válido.',
            'file.max' => 'El archivo pesa más de '.config('audio.max_upload_mb').' MB.',
        ];
    }
}
