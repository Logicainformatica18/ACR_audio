<?php

namespace Tests\Feature;

use App\Jobs\AnalyzeChords;
use App\Jobs\DownloadYoutube;
use App\Jobs\SeparateSong;
use App\Models\Song;
use App\Models\User;
use App\Services\QueueWatchdog;
use App\Services\YoutubeEngine;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/** Enlaces de YouTube, lectura de videos y listas, importación y la cola "descargas". */
class YoutubeTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create();
        // PHP con un script falso hace de motor de YouTube (sin internet).
        config(['audio.youtube.python' => PHP_BINARY, 'audio.youtube.script' => base_path('tests/Fixtures/fake_youtube.php')]);
    }

    public function test_youtube_links_are_parsed_strictly(): void
    {
        $ok = [
            'https://www.youtube.com/watch?v=jNQXAC9IVRw' => ['jNQXAC9IVRw', null],
            'youtube.com/watch?v=jNQXAC9IVRw&t=10s' => ['jNQXAC9IVRw', null],
            'https://youtu.be/jNQXAC9IVRw?si=abc' => ['jNQXAC9IVRw', null],
            'https://m.youtube.com/watch?v=jNQXAC9IVRw' => ['jNQXAC9IVRw', null],
            'https://music.youtube.com/watch?v=jNQXAC9IVRw&list=PL1234567890ab' => ['jNQXAC9IVRw', 'PL1234567890ab'],
            'https://www.youtube.com/shorts/jNQXAC9IVRw' => ['jNQXAC9IVRw', null],
            'https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG' => [null, 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG'],
            'https://www.youtube.com/watch?v=jNQXAC9IVRw&list=RDjNQXAC9IVRw' => ['jNQXAC9IVRw', null], // los "mix" no son listas
        ];
        foreach ($ok as $url => [$video, $list]) {
            $this->assertSame(['video' => $video, 'list' => $list], YoutubeEngine::parseUrl($url), $url);
        }

        $bad = [
            '', 'hola', 'https://vimeo.com/123', 'https://www.youtube.com.evil.com/watch?v=jNQXAC9IVRw',
            'https://evil.com/?u=https://youtube.com/watch?v=jNQXAC9IVRw', 'https://www.youtube.com/watch?v=corto',
            'https://www.youtube.com/watch?v=jNQXAC9IVRw;rm -rf', 'https://www.youtube.com/watch?v=jNQXAC9IVRw"&&calc',
            'https://user:pass@www.youtube.com/watch?v=jNQXAC9IVRw', 'javascript:alert(1)', 'https://www.youtube.com/',
            'https://www.youtube.com/watch?v=jNQXAC9IVRw extra',
        ];
        foreach ($bad as $url) {
            $this->assertNull(YoutubeEngine::parseUrl($url), $url);
        }
    }

    public function test_inspect_a_video_and_mark_duplicates(): void
    {
        $this->actingAs($this->user)->postJson('/youtube/inspect', ['url' => 'https://youtu.be/jNQXAC9IVRw'])
            ->assertOk()
            ->assertJsonPath('video.id', 'jNQXAC9IVRw')
            ->assertJsonPath('video.title', 'Tema de prueba')
            ->assertJsonPath('video.duration', 61)
            ->assertJsonPath('video.existing', null)
            ->assertJsonPath('playlist', null);

        Song::factory()->for($this->user)->create(['youtube_id' => 'jNQXAC9IVRw', 'title' => 'La que ya tengo']);
        $this->actingAs($this->user)->postJson('/youtube/inspect', ['url' => 'https://youtu.be/jNQXAC9IVRw'])
            ->assertJsonPath('video.existing', 'La que ya tengo');
    }

    public function test_inspect_a_playlist_without_downloading_and_with_video_and_list(): void
    {
        $r = $this->actingAs($this->user)->postJson('/youtube/inspect', ['url' => 'https://www.youtube.com/watch?v=jNQXAC9IVRw&list=PL1234567890ab'])
            ->assertOk()
            ->assertJsonPath('video.id', 'jNQXAC9IVRw')
            ->assertJsonPath('playlist.title', 'Mi lista')
            ->assertJsonCount(3, 'playlist.entries');
        // Miniaturas que no son de YouTube se descartan.
        $this->assertNull($r->json('playlist.entries.0.thumbnail'));
        $this->assertSame(0, Song::count());
        Queue::fake();
        Queue::assertNothingPushed();
    }

    public function test_inspect_rejects_invalid_links_and_reports_clear_errors(): void
    {
        $this->actingAs($this->user)->postJson('/youtube/inspect', ['url' => 'https://vimeo.com/1'])
            ->assertUnprocessable()->assertJsonPath('code', 'enlace');
        $this->actingAs($this->user)->postJson('/youtube/inspect', ['url' => 'https://www.youtube.com/watch?v=PRIVADO0000'])
            ->assertUnprocessable()->assertJsonPath('code', 'privado')->assertJsonPath('message', 'El video es privado: solo su autor puede verlo.');

        config(['audio.youtube.python' => base_path('no-existe/python.exe')]);
        $this->actingAs($this->user)->postJson('/youtube/inspect', ['url' => 'https://youtu.be/jNQXAC9IVRw'])
            ->assertStatus(503)->assertJsonPath('code', 'motor');
    }

    public function test_import_queues_downloads_on_their_own_queue_and_skips_duplicates(): void
    {
        Queue::fake();
        $folder = $this->user->folders()->create(['name' => 'Mi lista', 'position' => 0]);
        Song::factory()->for($this->user)->create(['youtube_id' => 'aaaaaaaaaa2']);

        $this->actingAs($this->user)->postJson('/youtube/import', [
            'videos' => [
                ['id' => 'aaaaaaaaaa1', 'title' => 'Pista 1', 'duration' => 30, 'thumbnail' => 'https://i.ytimg.com/vi/aaaaaaaaaa1/hq.jpg'],
                ['id' => 'aaaaaaaaaa2', 'title' => 'Pista 2'],
            ],
            'mode' => 'upload', 'chords' => true, 'folder_id' => $folder->id,
        ])->assertCreated()->assertJsonPath('created', 1)->assertJsonPath('skipped', 1);

        $song = Song::where('youtube_id', 'aaaaaaaaaa1')->first();
        $this->assertSame('Pista 1', $song->title);
        $this->assertSame($folder->id, $song->folder_id);
        $this->assertSame('pending', $song->download_status);
        $this->assertSame('https://www.youtube.com/watch?v=aaaaaaaaaa1', $song->source_url);
        $this->assertTrue($song->download_then_chords);
        $this->assertFalse($song->download_then_separate);
        Queue::assertPushedOn('descargas', DownloadYoutube::class);

        // Con permiso, sí se duplica.
        $this->actingAs($this->user)->postJson('/youtube/import', ['videos' => [['id' => 'aaaaaaaaaa2']], 'mode' => 'upload', 'chords' => false, 'allow_duplicates' => true])
            ->assertJsonPath('created', 1);

        // IDs inválidos o carpetas ajenas: nunca.
        $this->actingAs($this->user)->postJson('/youtube/import', ['videos' => [['id' => 'x; rm -rf /']], 'mode' => 'upload', 'chords' => false])
            ->assertUnprocessable();
        $foreign = User::factory()->create()->folders()->create(['name' => 'Ajena', 'position' => 0]);
        $this->actingAs($this->user)->postJson('/youtube/import', ['videos' => [['id' => 'aaaaaaaaaa3']], 'mode' => 'upload', 'chords' => false, 'folder_id' => $foreign->id])
            ->assertUnprocessable();
    }

    public function test_download_job_saves_the_flac_and_follows_the_chosen_flow(): void
    {
        Queue::fake();
        $song = $this->pendingDownload('aaaaaaaaaa1', separate: true, chords: true);

        (new DownloadYoutube($song))->handle(app(YoutubeEngine::class));

        $song->refresh();
        $this->assertSame(Song::STATUS_READY, $song->download_status);
        $this->assertSame(100, $song->download_progress);
        $this->assertSame(1234, $song->original_size);
        $this->assertSame('flac', $song->original_ext);
        Storage::disk('audio')->assertExists($song->directory().'/original.flac');
        $this->assertTrue($song->tracks()->where('stem', 'original')->exists());
        // Separar + acordes: la separación se encola y los acordes la esperan.
        $this->assertSame(Song::STATUS_PENDING, $song->status);
        $this->assertSame(Song::CHORDS_WAITING, $song->chords_status);
        Queue::assertPushedOn('separation', SeparateSong::class);

        // Solo subir + acordes: acordes con el original, ya.
        $other = $this->pendingDownload('aaaaaaaaaa2', separate: false, chords: true);
        (new DownloadYoutube($other))->handle(app(YoutubeEngine::class));
        $this->assertSame(Song::STATUS_NONE, $other->fresh()->status);
        $this->assertSame(Song::STATUS_PENDING, $other->fresh()->chords_status);
        Queue::assertPushedOn('acordes', AnalyzeChords::class);
    }

    public function test_download_errors_are_clear_and_can_be_retried(): void
    {
        Queue::fake();
        $song = $this->pendingDownload('ROTO0000000');

        (new DownloadYoutube($song))->handle(app(YoutubeEngine::class));

        $this->assertSame(Song::STATUS_FAILED, $song->fresh()->download_status);
        $this->assertStringContainsString('desactualizado', $song->fresh()->download_error);
        $this->actingAs($this->user)->get("/songs/{$song->id}")->assertRedirect('/songs'); // sin audio aún

        $this->actingAs(User::factory()->create())->postJson("/songs/{$song->id}/download/retry")->assertForbidden();
        $this->actingAs($this->user)->postJson("/songs/{$song->id}/download/retry")->assertOk()->assertJsonPath('song.download_status', 'pending');
        Queue::assertPushedOn('descargas', DownloadYoutube::class);
    }

    public function test_downloads_can_be_canceled_and_hung_ones_are_detected(): void
    {
        Queue::fake();
        $queued = $this->pendingDownload('aaaaaaaaaa1');
        $this->actingAs($this->user)->postJson("/songs/{$queued->id}/download/cancel")->assertOk()->assertJsonPath('song.download_status', 'canceled');
        (new DownloadYoutube($queued))->handle(app(YoutubeEngine::class)); // el job viejo no hace nada
        $this->assertSame(Song::STATUS_CANCELED, $queued->fresh()->download_status);

        $dead = $this->pendingDownload('aaaaaaaaaa2');
        $dead->update(['download_status' => Song::STATUS_PROCESSING, 'download_heartbeat_at' => now()->subMinutes(2)]);
        Storage::disk('audio')->put($dead->directory().'/original.webm.part', 'x');
        QueueWatchdog::check();
        $this->assertSame(Song::STATUS_FAILED, $dead->fresh()->download_status);
        $this->assertStringContainsString('3 DESCARGAS', $dead->fresh()->download_error);
        Storage::disk('audio')->assertMissing($dead->directory().'/original.webm.part');

        // Mientras se descarga no se puede borrar ni separar.
        $busy = $this->pendingDownload('aaaaaaaaaa3');
        $busy->update(['download_status' => Song::STATUS_PROCESSING, 'download_heartbeat_at' => now()]);
        $this->actingAs($this->user)->deleteJson("/songs/{$busy->id}")->assertStatus(409);
        $this->actingAs($this->user)->postJson("/songs/{$busy->id}/separate")->assertUnprocessable();
    }

    public function test_version_and_update_command(): void
    {
        $this->actingAs($this->user)->getJson('/youtube/version')->assertOk()->assertJsonPath('yt_dlp', '2099.01.01');
        config(['audio.youtube.python' => base_path('no-existe/python.exe')]);
        $this->artisan('youtube:actualizar')->assertFailed();
    }

    private function pendingDownload(string $id, bool $separate = false, bool $chords = false): Song
    {
        return Song::factory()->for($this->user)->create([
            'status' => Song::STATUS_NONE, 'original_ext' => 'flac', 'original_size' => 0, 'queued_at' => null,
            'youtube_id' => $id, 'source_url' => YoutubeEngine::watchUrl($id), 'download_status' => Song::STATUS_PENDING,
            'download_then_separate' => $separate, 'download_then_chords' => $chords,
        ]);
    }
}
