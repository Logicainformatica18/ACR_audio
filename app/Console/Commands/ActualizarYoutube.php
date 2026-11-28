<?php

namespace App\Console\Commands;

use App\Services\YoutubeEngine;
use Illuminate\Console\Command;

/**
 * Actualiza yt-dlp (con su componente para YouTube) y Deno en tools/youtube/.venv.
 * YouTube cambia a menudo y yt-dlp publica arreglos casi cada semana.
 *
 *   php artisan youtube:actualizar
 */
class ActualizarYoutube extends Command
{
    protected $signature = 'youtube:actualizar';

    protected $description = 'Actualiza yt-dlp y Deno del motor de descargas de YouTube';

    public function handle(YoutubeEngine $engine): int
    {
        $before = $engine->run(['version'], 60);
        $this->line('Actualizando yt-dlp… (puede tardar un minuto)');
        [$ok, $output, $after] = $engine->update();

        if (! $ok) {
            $this->error('No se pudo actualizar yt-dlp.');
            $this->line($output);

            return self::FAILURE;
        }

        $was = $before['yt_dlp'] ?? '?';
        $now = $after['yt_dlp'] ?? '?';
        $this->info($was === $now ? "yt-dlp ya estaba al día ({$now})." : "yt-dlp actualizado: {$was} → {$now}.");
        $this->line('Deno: '.($after['deno'] ?? 'no encontrado'));

        return self::SUCCESS;
    }
}
