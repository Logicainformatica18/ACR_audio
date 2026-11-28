<?php

namespace App\Services;

use Symfony\Component\Process\Process;

/**
 * Motor de descargas de YouTube (tools/youtube/youtube.py, con su propio
 * entorno de Python: yt-dlp + Deno + FFmpeg).
 *
 * Seguridad: el enlace del usuario NUNCA llega a la línea de comandos. Aquí
 * se extraen solo los IDs (con expresiones estrictas) y el script recibe esos
 * IDs como argumentos separados, sin shell; el propio script vuelve a validarlos.
 */
class YoutubeEngine
{
    public const VIDEO_ID = '/^[A-Za-z0-9_-]{11}$/';

    public const LIST_ID = '/^[A-Za-z0-9_-]{10,64}$/';

    private const HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com'];

    /**
     * Extrae el video y/o la lista de un enlace de YouTube.
     *
     * @return array{video: ?string, list: ?string}|null null si no es un enlace de YouTube válido
     */
    public static function parseUrl(string $url): ?array
    {
        $url = trim($url);
        if ($url === '' || strlen($url) > 2000 || preg_match('/\s/', $url)) {
            return null;
        }
        if (! preg_match('#^https?://#i', $url)) {
            $url = 'https://'.$url; // "youtu.be/xxx" pegado sin https
        }
        $parts = parse_url($url);
        $host = strtolower($parts['host'] ?? '');
        if (! $parts || ! in_array($host, self::HOSTS, true) || isset($parts['user']) || isset($parts['pass'])) {
            return null;
        }
        parse_str($parts['query'] ?? '', $query);
        $path = $parts['path'] ?? '/';

        $video = null;
        if (str_ends_with($host, 'youtu.be')) {
            $video = trim($path, '/');
        } elseif (preg_match('#^/(shorts|embed|live|v)/([^/?]+)#', $path, $m)) {
            $video = $m[2];
        } elseif (in_array($path, ['/watch', '/watch/'], true)) {
            $video = is_string($query['v'] ?? null) ? $query['v'] : null;
        }
        $list = is_string($query['list'] ?? null) ? $query['list'] : null;

        $video = $video !== null && preg_match(self::VIDEO_ID, $video) ? $video : null;
        // Las listas "mix" automáticas (RD...) no son listas reales que se puedan leer enteras.
        $list = $list !== null && preg_match(self::LIST_ID, $list) && ! str_starts_with($list, 'RD') ? $list : null;

        return $video || $list ? ['video' => $video, 'list' => $list] : null;
    }

    public static function watchUrl(string $videoId): string
    {
        return 'https://www.youtube.com/watch?v='.$videoId;
    }

    public function python(): ?string
    {
        return ChordEngine::resolve(config('audio.youtube.python'));
    }

    public function script(): ?string
    {
        return ChordEngine::resolve(config('audio.youtube.script'));
    }

    public function problem(): ?string
    {
        if (! $this->python() || ! is_file($this->python())) {
            return 'No está instalado el motor de YouTube. Ejecuta tools\\youtube\\instalar.bat o revisa YOUTUBE_PYTHON en el .env.';
        }
        if (! $this->script() || ! is_file($this->script())) {
            return 'No se encuentra el script de YouTube. Revisa YOUTUBE_SCRIPT en el .env.';
        }

        return null;
    }

    /** @param  array<int, string>  $args  argumentos ya validados (IDs, rutas del servidor) */
    public function process(array $args, int $timeout): Process
    {
        return new Process([$this->python(), $this->script(), ...$args], dirname($this->script()), [
            'PYTHONUNBUFFERED' => '1',
            'PYTHONIOENCODING' => 'utf-8',
        ], null, $timeout);
    }

    /**
     * Ejecuta un comando corto del script y devuelve su último evento JSON.
     *
     * @return array<string, mixed>
     */
    public function run(array $args, int $timeout = 120): array
    {
        if ($problem = $this->problem()) {
            return ['tipo' => 'error', 'codigo' => 'motor', 'mensaje' => $problem];
        }
        $process = $this->process($args, $timeout);
        try {
            $process->run();
        } catch (\Throwable) {
            return ['tipo' => 'error', 'codigo' => 'tiempo', 'mensaje' => 'YouTube tardó demasiado en responder. Inténtalo de nuevo.'];
        }
        $last = null;
        foreach (preg_split('/\r?\n/', trim($process->getOutput())) as $line) {
            $event = json_decode($line, true);
            if (is_array($event) && isset($event['tipo'])) {
                $last = $event;
            }
        }

        return $last ?? ['tipo' => 'error', 'codigo' => 'otro', 'mensaje' => 'El motor de YouTube no respondió como se esperaba.'];
    }

    /** Actualiza yt-dlp (y Deno) en su entorno. Devuelve [ok, salida, versiones]. */
    public function update(): array
    {
        if ($problem = $this->problem()) {
            return [false, $problem, null];
        }
        $requirements = dirname($this->script()).DIRECTORY_SEPARATOR.'requirements.txt';
        $process = new Process([$this->python(), '-m', 'pip', 'install', '--upgrade', '--disable-pip-version-check', '-r', $requirements], dirname($this->script()));
        $process->setTimeout(600);
        $process->run();
        $output = trim($process->getOutput()."\n".$process->getErrorOutput());

        return [$process->isSuccessful(), $output, $this->run(['version'], 60)];
    }
}
