<?php

namespace Tests\Feature;

use App\Jobs\AnalyzeChords;
use App\Jobs\SeparateSong;
use App\Models\Song;
use App\Models\User;
use App\Services\ChordEngine;
use App\Services\QueueWatchdog;
use App\Services\Separator;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\Process\Process;
use Tests\TestCase;

/**
 * Cancelar, reintentar, trabajos colgados o con el worker muerto, duplicados
 * y reparto de la GPU entre separación y acordes.
 */
class QueueRobustnessTest extends TestCase
{
    use RefreshDatabase;

    private function fakeSeparatorModels(): string
    {
        $models = sys_get_temp_dir().DIRECTORY_SEPARATOR.'acr_sep_'.uniqid();
        mkdir($models);
        file_put_contents($models.DIRECTORY_SEPARATOR.'htdemucs_6s.yaml', 'x');
        config(['audio.separator.bin' => PHP_BINARY, 'audio.separator.models_dir' => $models]);

        return $models;
    }

    public function test_a_pending_song_can_be_canceled_and_retried(): void
    {
        Queue::fake();
        $owner = User::factory()->create();
        $song = Song::factory()->for($owner)->create();

        $this->actingAs(User::factory()->create())->postJson("/songs/{$song->id}/cancel")->assertForbidden();
        $this->actingAs($owner)->postJson("/songs/{$song->id}/cancel")
            ->assertOk()
            ->assertJsonPath('song.status', 'canceled')
            ->assertJsonPath('song.error', 'Cancelada por ti.');

        // Ya cancelada: no se puede volver a cancelar, sí reintentar.
        $this->actingAs($owner)->postJson("/songs/{$song->id}/cancel")->assertUnprocessable();
        $this->actingAs($owner)->postJson("/songs/{$song->id}/retry")->assertOk()->assertJsonPath('song.status', 'pending');
        Queue::assertPushed(SeparateSong::class, 1);
    }

    public function test_the_job_does_not_start_a_song_that_was_canceled(): void
    {
        $models = $this->fakeSeparatorModels();
        $song = Song::factory()->create(['status' => Song::STATUS_CANCELED]);
        Storage::disk('audio')->put($song->originalPath(), '<?php echo "no debería ejecutarse";');

        (new SeparateSong($song))->handle(app(Separator::class));

        $this->assertSame(Song::STATUS_CANCELED, $song->fresh()->status);
        unlink($models.DIRECTORY_SEPARATOR.'htdemucs_6s.yaml');
        rmdir($models);
    }

    public function test_canceling_a_song_whose_worker_died_cleans_everything_up(): void
    {
        $owner = User::factory()->create();
        // Como el caso real: "Procesando" con el job reservado, el bloqueo tomado y el worker muerto.
        $song = Song::factory()->for($owner)->create([
            'status' => Song::STATUS_PROCESSING, 'started_at' => now()->subMinutes(5),
            'heartbeat_at' => now()->subMinutes(4), 'process_pid' => 999999,
        ]);
        Storage::disk('audio')->put($song->directory().'/work/parcial.flac', 'x');
        Cache::lock('laravel-queue-overlap:audio-separator', 3600)->get();
        config(['audio.separator.cancel_wait' => 0.5]);

        $this->actingAs($owner)->postJson("/songs/{$song->id}/cancel")
            ->assertOk()
            ->assertJsonPath('song.status', 'canceled');

        $this->assertFalse(Storage::disk('audio')->exists($song->directory().'/work'));
        $this->assertTrue(Cache::lock('laravel-queue-overlap:audio-separator', 10)->get(), 'el bloqueo de la GPU debe quedar libre');
        $this->assertNull($song->fresh()->process_pid);

        // Ahora sí se puede borrar.
        $this->actingAs($owner)->deleteJson("/songs/{$song->id}")->assertOk();
        $this->assertSoftDeleted($song);
    }

    public function test_a_processing_song_cannot_be_deleted_without_canceling_first(): void
    {
        $owner = User::factory()->create();
        $song = Song::factory()->for($owner)->create(['status' => Song::STATUS_PROCESSING, 'heartbeat_at' => now()]);

        $this->actingAs($owner)->deleteJson("/songs/{$song->id}")
            ->assertStatus(409)
            ->assertJsonPath('message', 'No se puede borrar mientras se está separando. Pulsa «Cancelar» primero.');
    }

    public function test_watchdog_fails_jobs_whose_worker_stopped_beating_and_frees_the_queue(): void
    {
        $dead = Song::factory()->create(['status' => Song::STATUS_PROCESSING, 'started_at' => now()->subMinutes(3), 'heartbeat_at' => now()->subMinutes(2)]);
        $alive = Song::factory()->create(['status' => Song::STATUS_PROCESSING, 'started_at' => now()->subMinute(), 'heartbeat_at' => now()->subSeconds(3)]);
        $deadChords = Song::factory()->ready()->create(['chords_status' => Song::STATUS_PROCESSING, 'chords_started_at' => now()->subMinutes(2), 'chords_heartbeat_at' => now()->subMinute()]);
        Cache::lock('laravel-queue-overlap:audio-separator', 3600)->get();

        QueueWatchdog::check();

        $this->assertSame(Song::STATUS_FAILED, $dead->fresh()->status);
        $this->assertStringContainsString('dejó de responder', $dead->fresh()->error);
        $this->assertSame(Song::STATUS_PROCESSING, $alive->fresh()->status); // la que late, sigue
        $this->assertSame(Song::STATUS_FAILED, $deadChords->fresh()->chords_status);
        $this->assertTrue(Cache::lock('laravel-queue-overlap:audio-separator', 10)->get());
    }

    public function test_watchdog_kills_the_real_process_only_if_it_belongs_to_the_song(): void
    {
        $song = Song::factory()->create(['status' => Song::STATUS_PROCESSING, 'started_at' => now()->subMinutes(3), 'heartbeat_at' => now()->subMinutes(2)]);
        // Proceso real que lleva la carpeta de la canción en su línea de comandos (como audio-separator).
        $victim = new Process([PHP_BINARY, '-r', 'sleep(60);', 'x'.DIRECTORY_SEPARATOR.QueueWatchdog::pathNeedle($song).'original.mp3']);
        $victim->start();
        $other = new Process([PHP_BINARY, '-r', 'sleep(60);', 'otra-cosa']);
        $other->start();
        usleep(500_000);

        $this->assertFalse(QueueWatchdog::killTree($other->getPid(), QueueWatchdog::pathNeedle($song)), 'nunca mata otro programa');
        $song->update(['process_pid' => $victim->getPid()]);
        QueueWatchdog::check();

        $deadline = microtime(true) + 10;
        while ($victim->isRunning() && microtime(true) < $deadline) {
            usleep(100_000);
        }
        $this->assertFalse($victim->isRunning(), 'el proceso colgado debe terminarse');
        $this->assertTrue($other->isRunning());
        $other->stop(0);
    }

    public function test_a_hung_separation_is_detected_stopped_and_marked_as_failed(): void
    {
        $models = $this->fakeSeparatorModels();
        config(['audio.separator.stall_timeout' => 2]);
        $song = Song::factory()->create(['model' => 'htdemucs_6s.yaml']);
        Storage::disk('audio')->put($song->originalPath(), file_get_contents(base_path('tests/Fixtures/fake_separator_hang.php')));

        $start = microtime(true);
        (new SeparateSong($song))->handle(app(Separator::class));

        $song->refresh();
        $this->assertLessThan(15, microtime(true) - $start, 'no espera los 30 s del proceso colgado');
        $this->assertSame(Song::STATUS_FAILED, $song->status);
        $this->assertStringContainsString('se colgó', $song->error);
        $this->assertStringContainsString('39 %', $song->error);
        // Los archivos a medias se borran aunque el proceso acabe de morir.
        $this->assertFalse(Storage::disk('audio')->exists($song->directory().'/work'));
        $this->assertNull($song->process_pid);

        unlink($models.DIRECTORY_SEPARATOR.'htdemucs_6s.yaml');
        rmdir($models);
    }

    public function test_watchdog_forgets_the_queued_job_of_a_song(): void
    {
        config(['queue.default' => 'database']);
        $song = Song::factory()->create();
        $other = Song::factory()->create();
        Queue::connection('database')->push(new SeparateSong($song));
        Queue::connection('database')->push(new SeparateSong($other));

        QueueWatchdog::forgetJobs(SeparateSong::class, $song->id);

        $this->assertSame(1, DB::table('jobs')->count());
        $this->assertStringContainsString('i:'.$other->id.';', DB::table('jobs')->value('payload'));
    }

    public function test_uploading_the_same_file_twice_asks_before_duplicating(): void
    {
        Queue::fake();
        $user = User::factory()->create();
        $file = fn () => UploadedFile::fake()->create('Mi canción.mp3', 300, 'audio/mpeg');

        $this->actingAs($user)->postJson('/songs', ['file' => $file()])->assertCreated();
        $this->actingAs($user)->postJson('/songs', ['file' => $file()])
            ->assertStatus(409)
            ->assertJsonPath('code', 'duplicate')
            ->assertJsonPath('existing.title', 'Mi canción');
        $this->assertSame(1, Song::count());

        $this->actingAs($user)->postJson('/songs', ['file' => $file(), 'allow_duplicate' => '1'])->assertCreated();
        $this->assertSame(2, Song::count());

        // Otro usuario con el mismo archivo no es un duplicado.
        $this->actingAs(User::factory()->create())->postJson('/songs', ['file' => $file()])->assertCreated();
    }

    public function test_chords_use_the_cpu_while_a_separation_is_running(): void
    {
        $models = sys_get_temp_dir().DIRECTORY_SEPARATOR.'acr_chords_'.uniqid();
        mkdir($models);
        file_put_contents($models.DIRECTORY_SEPARATOR.'btc_model_large_voca.pt', 'x');
        config([
            'audio.chords.python' => PHP_BINARY,
            'audio.chords.script' => base_path('tests/Fixtures/fake_chords_ok.php'),
            'audio.chords.models_dir' => $models,
        ]);
        $song = Song::factory()->ready()->create(['chords_status' => Song::STATUS_PENDING]);
        $song->tracks()->create(['stem' => 'guitar', 'file_name' => 'guitar.flac', 'size' => 1, 'position' => 3]);
        Storage::disk('audio')->put($song->stemsDirectory().'/guitar.flac', 'x');
        Song::factory()->create(['status' => Song::STATUS_PROCESSING, 'heartbeat_at' => now()]);

        $process = app(ChordEngine::class)->process(['a.flac'], 10, true);
        $this->assertStringContainsString('--cpu', $process->getCommandLine());

        (new AnalyzeChords($song))->handle(app(ChordEngine::class));

        $this->assertSame('btc-large (CPU)', $song->fresh()->chords_model);
        $this->assertSame(Song::STATUS_READY, $song->fresh()->chords_status);
        $this->assertNull($song->fresh()->chords_heartbeat_at);

        unlink($models.DIRECTORY_SEPARATOR.'btc_model_large_voca.pt');
        rmdir($models);
    }
}
