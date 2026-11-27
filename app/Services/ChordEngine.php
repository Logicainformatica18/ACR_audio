<?php

namespace App\Services;

use App\Models\Song;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\Process\Process;

/**
 * Envoltorio del motor de acordes (tools/acordes/acordes.py, con su propio
 * entorno de Python). El script escribe una línea JSON por evento:
 *   {"tipo":"progreso","pct":35}
 *   {"tipo":"acorde","inicio":12.4,"fin":14.1,"acorde":"Bm","confianza":0.87}
 *   {"tipo":"tonalidad","valor":"B menor"}
 *   {"tipo":"fin"}  /  {"tipo":"error","mensaje":"..."}
 */
class ChordEngine
{
    /** Ruta absoluta: las relativas se toman desde la carpeta del proyecto. */
    public static function resolve(?string $path): ?string
    {
        if ($path === null || $path === '') {
            return null;
        }
        $isAbsolute = preg_match('/^([A-Za-z]:[\\\\\/]|[\\\\\/])/', $path) === 1;
        $full = $isAbsolute ? $path : base_path($path);

        return str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $full);
    }

    public function python(): ?string
    {
        return self::resolve(config('audio.chords.python'));
    }

    public function script(): ?string
    {
        return self::resolve(config('audio.chords.script'));
    }

    public function modelsDir(): ?string
    {
        return self::resolve(config('audio.chords.models_dir'));
    }

    public function model(): string
    {
        return (string) config('audio.chords.model', 'btc-large');
    }

    /** null si todo está listo, o un mensaje explicando qué falta. */
    public function problem(): ?string
    {
        if (! $this->python() || ! is_file($this->python())) {
            return 'No se encuentra el Python del motor de acordes. Ejecuta tools\\acordes\\instalar.bat o revisa CHORDS_PYTHON en el .env.';
        }
        if (! $this->script() || ! is_file($this->script())) {
            return 'No se encuentra el script del motor de acordes. Revisa CHORDS_SCRIPT en el .env.';
        }
        $weights = config('audio.chords.weights.'.$this->model());
        if (! $weights) {
            return "Modelo de acordes desconocido: {$this->model()}. Usa btc-large o btc-majmin en CHORDS_MODEL.";
        }
        if (! $this->modelsDir() || ! is_file($this->modelsDir().DIRECTORY_SEPARATOR.$weights)) {
            return "Falta el modelo {$weights}. Ejecuta tools\\acordes\\instalar.bat (o descargar_modelos.py).";
        }

        return null;
    }

    /**
     * Pistas que se mezclan para analizar: guitarra, bajo, piano y otros (sin
     * batería ni voz). Si la canción no tiene ninguna (por ejemplo, un modelo
     * de 2 pistas), se usa la pista instrumental o, como último recurso, el original.
     *
     * @return array<int, string> rutas absolutas
     */
    public function inputFiles(Song $song): array
    {
        $disk = Storage::disk('audio');
        $tracks = $song->tracks()->get()->keyBy('stem');
        $files = [];

        foreach (config('audio.chords.stems') as $stem) {
            if (isset($tracks[$stem]) && $disk->exists($tracks[$stem]->path())) {
                $files[] = $disk->path($tracks[$stem]->path());
            }
        }
        if ($files === [] && isset($tracks['instrumental']) && $disk->exists($tracks['instrumental']->path())) {
            $files[] = $disk->path($tracks['instrumental']->path());
        }
        if ($files === [] && $disk->exists($song->originalPath())) {
            $files[] = $disk->path($song->originalPath());
        }

        return array_map(fn ($f) => str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $f), $files);
    }

    /**
     * Prepara el proceso. Las rutas las construye la aplicación (ids y nombres
     * fijos) y se pasan como lista de argumentos, sin shell.
     *
     * @param  array<int, string>  $files
     */
    public function process(array $files, int $timeout, bool $cpu = false): Process
    {
        return new Process([
            $this->python(),
            $this->script(),
            ...$files,
            '--modelo', $this->model(),
            '--modelos-dir', $this->modelsDir(),
            ...($cpu ? ['--cpu'] : []),
        ], dirname($this->script()), [
            'PYTHONUNBUFFERED' => '1',
            'PYTHONIOENCODING' => 'utf-8',
        ], null, $timeout);
    }
}
