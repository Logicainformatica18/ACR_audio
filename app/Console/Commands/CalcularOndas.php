<?php

namespace App\Console\Commands;

use App\Models\Track;
use App\Services\Waveform;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/**
 * Precalcula la forma de onda de las pistas que aún no la tienen (las
 * separadas antes de esta función). Las nuevas la calculan al separarse.
 *
 *   php artisan ondas:calcular            solo las que faltan
 *   php artisan ondas:calcular --todas    recalcula todas
 */
class CalcularOndas extends Command
{
    protected $signature = 'ondas:calcular {--todas : Recalcula también las que ya la tienen}';

    protected $description = 'Precalcula la forma de onda de las pistas para el mezclador';

    public function handle(): int
    {
        $disk = Storage::disk('audio');
        $query = Track::with('song')->orderBy('id');
        if (! $this->option('todas')) {
            $query->whereNull('peaks');
        }

        $done = 0;
        $failed = 0;
        foreach ($query->get() as $track) {
            $path = $track->path();
            $peaks = $disk->exists($path) ? Waveform::compute($disk->path($path)) : null;
            if ($peaks === null) {
                $failed++;
                $this->warn("  Pista #{$track->id} ({$track->label()} de \"{$track->song->title}\"): no se pudo calcular");

                continue;
            }
            $track->update(['peaks' => $peaks]);
            $done++;
            $this->line("  Pista #{$track->id}: {$track->label()} de \"{$track->song->title}\"");
        }

        $this->info("{$done} forma(s) de onda calculada(s)".($failed ? ", {$failed} con error" : '').'.');

        return $failed ? self::FAILURE : self::SUCCESS;
    }
}
