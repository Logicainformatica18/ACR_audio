<?php

namespace App\Console\Commands;

use App\Models\Song;
use App\Services\ChordEngine;
use Illuminate\Console\Command;

/**
 * Pone en la cola "acordes" canciones ya separadas (por ejemplo, las que se
 * separaron antes de existir el reconocedor de acordes).
 *
 *   php artisan acordes:analizar           solo las que nunca se analizaron
 *   php artisan acordes:analizar 7         la canción 7 (aunque ya tenga acordes)
 *   php artisan acordes:analizar --todas   todas las canciones listas
 */
class AnalizarAcordes extends Command
{
    protected $signature = 'acordes:analizar
        {cancion? : Id de una canción}
        {--todas : Todas las canciones separadas, aunque ya tengan acordes}';

    protected $description = 'Encola el análisis de acordes de canciones ya separadas';

    public function handle(ChordEngine $engine): int
    {
        if ($problem = $engine->problem()) {
            $this->warn($problem);
        }

        $query = Song::where('status', Song::STATUS_READY)->orderBy('id');

        if ($id = $this->argument('cancion')) {
            $query->whereKey((int) $id);
        } elseif (! $this->option('todas')) {
            $query->whereNull('chords_status');
        }

        $songs = $query->get();
        if ($songs->isEmpty()) {
            $this->info($this->argument('cancion')
                ? 'No hay ninguna canción separada con ese id.'
                : 'No hay canciones pendientes de analizar.');

            return self::SUCCESS;
        }

        $queued = 0;
        foreach ($songs as $song) {
            if ($song->chordsBusy()) {
                $this->line("  #{$song->id} {$song->title}: ya está en la cola o analizándose");

                continue;
            }
            $song->queueChordAnalysis();
            $queued++;
            $this->line("  #{$song->id} {$song->title}: en cola");
        }

        $this->info("{$queued} canción(es) en la cola \"acordes\". La ventana de acordes de iniciar.bat las procesará.");

        return self::SUCCESS;
    }
}
