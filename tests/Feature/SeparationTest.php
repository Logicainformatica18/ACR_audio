<?php

namespace Tests\Feature;

use App\Jobs\SeparateSong;
use App\Models\Song;
use App\Models\User;
use App\Services\Separator;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class SeparationTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('audio');
    }

    public function test_upload_queues_a_separation_job_on_the_separation_queue(): void
    {
        Queue::fake();
        $user = User::factory()->create();

        $this->actingAs($user)->postJson('/songs', ['file' => UploadedFile::fake()->create('a.flac', 10, 'audio/flac')])->assertCreated();

        Queue::assertPushedOn(SeparateSong::QUEUE, SeparateSong::class, fn (SeparateSong $job) => $job->song->is(Song::first()));
    }

    public function test_stem_names_and_progress_are_parsed_from_the_output(): void
    {
        $this->assertSame('vocals', Separator::stemFromFileName('vocals.flac'));
        $this->assertSame('drums', Separator::stemFromFileName('original_(Drums)_htdemucs_6s.flac'));
        $this->assertSame('other', Separator::stemFromFileName('Other.FLAC'));
        $this->assertNull(Separator::stemFromFileName('original.flac'));
        $this->assertNull(Separator::stemFromFileName('..\\..\\evil.flac'));

        $this->assertSame(42, Separator::progressFromOutput(" 10%|#   | 1/10\r 42%|####  | 4/10"));
        $this->assertNull(Separator::progressFromOutput('cargando modelo...'));
    }

    public function test_error_summary_and_log_cleanup(): void
    {
        $log = "INFO cargando\r\n 10%|#\r 50%|##\r100%|###\nTraceback (most recent call last):\n  File x\nRuntimeError: CUDA out of memory\n";

        $this->assertSame('RuntimeError: CUDA out of memory', SeparateSong::errorSummary($log, 1));
        $this->assertSame('audio-separator terminó con el código 3.', SeparateSong::errorSummary('', 3));
        $this->assertStringNotContainsString('50%', SeparateSong::cleanLog($log));
        $this->assertStringContainsString('100%', SeparateSong::cleanLog($log));
        $this->assertSame('WARNING: x', SeparateSong::cleanLog("\x1B[33mWARNING: x\x1B[0m"));
    }

    public function test_job_fails_with_a_clear_message_when_the_separator_is_missing(): void
    {
        config(['audio.separator.bin' => 'C:\\no\\existe\\audio-separator.exe']);
        $song = Song::factory()->create();
        Storage::disk('audio')->put($song->originalPath(), 'x');

        (new SeparateSong($song))->handle(app(Separator::class));

        $song->refresh();
        $this->assertSame(Song::STATUS_FAILED, $song->status);
        $this->assertStringContainsString('SEPARATOR_BIN', $song->error);
        $this->assertNotNull($song->finished_at);
    }

    public function test_job_refuses_models_that_are_not_downloaded(): void
    {
        $models = sys_get_temp_dir().DIRECTORY_SEPARATOR.'acr_models_'.uniqid();
        mkdir($models);
        config(['audio.separator.bin' => PHP_BINARY, 'audio.separator.models_dir' => $models]);
        $song = Song::factory()->create(['model' => 'htdemucs_6s.yaml']);

        (new SeparateSong($song))->handle(app(Separator::class));

        $this->assertSame(Song::STATUS_FAILED, $song->fresh()->status);
        $this->assertStringContainsString('no está descargado', $song->fresh()->error);
        rmdir($models);
    }

    public function test_job_ignores_songs_that_are_not_pending(): void
    {
        $song = Song::factory()->ready()->create();

        (new SeparateSong($song))->handle(app(Separator::class));

        $this->assertSame(Song::STATUS_READY, $song->fresh()->status);
    }

    public function test_status_endpoint_reports_progress_and_queue_position_of_own_songs_only(): void
    {
        $me = User::factory()->create();
        $other = User::factory()->create();
        $processing = Song::factory()->for($other)->create(['status' => Song::STATUS_PROCESSING, 'started_at' => now()]);
        $first = Song::factory()->for($other)->create(['queued_at' => now()->subMinutes(2)]);
        $mine = Song::factory()->for($me)->create(['queued_at' => now()->subMinute()]);
        Cache::put(SeparateSong::progressKey($processing->id), 37);

        $this->actingAs($me)->getJson('/songs/status')
            ->assertOk()
            ->assertJsonCount(1, 'songs')
            ->assertJsonPath('songs.0.id', $mine->id)
            ->assertJsonPath('songs.0.queue_position', 3); // 1 procesándose + 1 antes en la cola

        $this->actingAs($other)->getJson('/songs/status')
            ->assertJsonPath('songs.0.progress', 37);
    }

    public function test_log_and_retry_only_for_own_songs(): void
    {
        Queue::fake();
        $owner = User::factory()->create();
        $intruder = User::factory()->create();
        $song = Song::factory()->for($owner)->create(['status' => Song::STATUS_FAILED, 'error' => 'falló', 'log' => 'salida completa']);

        $this->actingAs($intruder)->getJson("/songs/{$song->id}/log")->assertForbidden();
        $this->actingAs($intruder)->postJson("/songs/{$song->id}/retry")->assertForbidden();

        $this->actingAs($owner)->getJson("/songs/{$song->id}/log")->assertOk()->assertJsonPath('log', 'salida completa');
        $this->actingAs($owner)->postJson("/songs/{$song->id}/retry")->assertOk()->assertJsonPath('song.status', 'pending');

        $this->assertNull($song->fresh()->error);
        Queue::assertPushed(SeparateSong::class, 1);

        // Una canción que no falló no se puede reintentar.
        $this->actingAs($owner)->postJson("/songs/{$song->id}/retry")->assertUnprocessable();
    }
}
