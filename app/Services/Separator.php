<?php

namespace App\Services;

use Symfony\Component\Process\Process;

/**
 * Envoltorio de audio-separator.exe (motor externo, fuera del proyecto).
 *
 * Nunca descarga modelos: solo se permiten modelos cuyo archivo ya exista en
 * SEPARATOR_MODELS_DIR, para no modificar la carpeta del separador.
 */
class Separator
{
    /** Nombres de pista que produce audio-separator -> nombre interno. */
    public const STEM_NAMES = [
        'Vocals' => 'vocals',
        'Drums' => 'drums',
        'Bass' => 'bass',
        'Guitar' => 'guitar',
        'Piano' => 'piano',
        'Other' => 'other',
        'Instrumental' => 'instrumental',
    ];

    public function binary(): ?string
    {
        return config('audio.separator.bin');
    }

    public function modelsDir(): ?string
    {
        return config('audio.separator.models_dir');
    }

    /**
     * Modelos de config/audio.php que ya están descargados.
     *
     * @return array<string, string> archivo => descripción
     */
    public function availableModels(): array
    {
        $dir = $this->modelsDir();
        if (! $dir || ! is_dir($dir)) {
            return [];
        }

        return array_filter(
            config('audio.models'),
            fn ($label, $file) => is_file($dir.DIRECTORY_SEPARATOR.$file),
            ARRAY_FILTER_USE_BOTH,
        );
    }

    /** Devuelve null si todo está listo o un mensaje explicando qué falta. */
    public function problemWith(string $model): ?string
    {
        if (! $this->binary() || ! is_file($this->binary())) {
            return 'No se encuentra audio-separator. Revisa SEPARATOR_BIN en el .env.';
        }
        if (! $this->modelsDir() || ! is_dir($this->modelsDir())) {
            return 'No se encuentra la carpeta de modelos. Revisa SEPARATOR_MODELS_DIR en el .env.';
        }
        if (! array_key_exists($model, $this->availableModels())) {
            return "El modelo {$model} no está descargado en la carpeta de modelos.";
        }

        return null;
    }

    /**
     * Prepara el proceso. Todas las rutas las construye la aplicación: ninguna
     * contiene texto escrito por el usuario. Se pasan como lista de argumentos
     * (sin shell), así que no hay riesgo de inyección de comandos.
     */
    public function process(string $inputFile, string $outputDir, string $model, int $timeout): Process
    {
        $customNames = json_encode(array_combine(
            array_keys(self::STEM_NAMES),
            array_values(self::STEM_NAMES),
        ));

        // Rutas con un único tipo de separador (Storage mezcla / y \ en Windows).
        $inputFile = str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $inputFile);
        $outputDir = str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $outputDir);

        $process = new Process([
            $this->binary(),
            $inputFile,
            '-m', $model,
            '--model_file_dir', $this->modelsDir(),
            '--output_dir', $outputDir,
            '--output_format', strtoupper(config('audio.separator.output_format', 'FLAC')),
            '--custom_output_names', $customNames,
        ], $outputDir, [
            // Salida de Python sin búfer y en UTF-8, para leer el log en vivo.
            'PYTHONUNBUFFERED' => '1',
            'PYTHONIOENCODING' => 'utf-8',
        ], null, $timeout);

        return $process;
    }

    /**
     * Identifica la pista de un archivo de salida: "vocals.flac" o
     * "original_(Vocals)_htdemucs_6s.flac" -> "vocals". null si no se reconoce.
     */
    public static function stemFromFileName(string $fileName): ?string
    {
        $base = strtolower(pathinfo($fileName, PATHINFO_FILENAME));
        $known = array_values(self::STEM_NAMES);

        if (in_array($base, $known, true)) {
            return $base;
        }
        if (preg_match_all('/\(([^)]+)\)/', $base, $m)) {
            foreach ($m[1] as $candidate) {
                if (in_array(trim($candidate), $known, true)) {
                    return trim($candidate);
                }
            }
        }

        return null;
    }

    /** Último porcentaje de progreso que aparece en la salida (barras de tqdm). */
    public static function progressFromOutput(string $output): ?int
    {
        if (preg_match_all('/(\d{1,3})%\|/', $output, $m)) {
            return min(100, (int) end($m[1]));
        }

        return null;
    }

    /** Duración en segundos con ffprobe (null si no se puede). */
    public static function probeDuration(string $file): ?float
    {
        $probe = new Process(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', $file]);
        $probe->setTimeout(60);

        try {
            $probe->run();
        } catch (\Throwable) {
            return null;
        }

        $value = trim($probe->getOutput());

        return $probe->isSuccessful() && is_numeric($value) ? round((float) $value, 3) : null;
    }
}
