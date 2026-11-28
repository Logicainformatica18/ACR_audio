<?php

namespace Tests\Feature;

use App\Jobs\AnalyzeChords;
use App\Jobs\SeparateSong;
use App\Models\Song;
use App\Models\User;
use App\Services\ChordEngine;
use App\Services\Separator;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\TestCase;

/**
 * Subida flexible: "Separar pistas" o "Solo subir", interruptor general de
 * acordes, acciones por canción y estados independientes.
 */
class FlexibleUploadTest extends TestCase
{
    use RefreshDatabase;

    private function upload(User $user, array $data = [], string $name = 'tema.mp3')
    {
        return $this->actingAs($user)->postJson('/songs', ['file' => UploadedFile::fake()->create($name, 200, 'audio/mpeg'), ...$data]);
    }

    public function test_solo_subir_without_chords_keeps_the_original_and_queues_nothing(): void
    {
        Queue::fake();
        $user = User::factory()->create();

        $this->upload($user, ['mode' => 'upload', 'chords' => '0'])
            ->assertCreated()
            ->assertJsonPath('song.status', 'none')
            ->assertJsonPath('song.chords_status', null);

        $song = Song::first();
        $this->assertTrue(Storage::disk('audio')->exists($song->originalPath()));
        $this->assertSame(['original'], $song->tracks()->pluck('stem')->all());
        $this->assertNull($song->queued_at);
        Queue::assertNothingPushed();
    }

    public function test_solo_subir_with_chords_analyzes_the_original_right_away(): void
    {
        Queue::fake();
        $user = User::factory()->create();

        $this->upload($user, ['mode' => 'upload', 'chords' => '1'])->assertCreated()->assertJsonPath('song.chords_status', 'pending');

        Queue::assertNotPushed(SeparateSong::class);
        Queue::assertPushedOn('acordes', AnalyzeChords::class);
        $this->assertSame('original', app(ChordEngine::class)->inputs(Song::first())[1]);
    }

    public function test_separar_pistas_with_chords_waits_for_the_separation(): void
    {
        Queue::fake();
        $user = User::factory()->create();

        $this->upload($user, ['mode' => 'separate', 'chords' => '1'])
            ->assertCreated()
            ->assertJsonPath('song.status', 'pending')
            ->assertJsonPath('song.chords_status', 'waiting');

        Queue::assertPushedOn('separation', SeparateSong::class);
        Queue::assertNotPushed(AnalyzeChords::class); // se lanza al terminar la separación
    }

    public function test_without_a_choice_the_upload_uses_the_remembered_mode_and_the_general_switch(): void
    {
        Queue::fake();
        $user = User::factory()->create();

        // Por defecto: separar y detectar acordes (como antes de esta función).
        $this->upload($user, name: 'a.mp3')->assertJsonPath('song.status', 'pending')->assertJsonPath('song.chords_status', 'waiting');

        $user->preferences()->update(['upload_mode' => 'upload', 'chords_auto' => false]);
        $this->upload($user, name: 'b.mp3')->assertJsonPath('song.status', 'none')->assertJsonPath('song.chords_status', null);

        // Lo elegido en el modal manda sobre la preferencia.
        $this->upload($user, ['mode' => 'separate', 'chords' => '1'], 'c.mp3')->assertJsonPath('song.status', 'pending');
        $this->upload($user, ['mode' => 'otro'], 'd.mp3')->assertUnprocessable()->assertJsonValidationErrors('mode');
    }

    public function test_general_chords_switch_and_remembered_mode_are_saved_per_user(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)->get('/songs')->assertInertia(fn (Assert $p) => $p
            ->where('uploadPrefs.chords_auto', true)->where('uploadPrefs.upload_mode', null));

        $this->actingAs($user)->patchJson('/settings/preferences/upload', ['chords_auto' => false])
            ->assertOk()->assertJsonPath('chords_auto', false);
        $this->actingAs($user)->patchJson('/settings/preferences/upload', ['upload_mode' => 'upload'])
            ->assertOk()->assertJsonPath('upload_mode', 'upload');
        $this->actingAs($user)->patchJson('/settings/preferences/upload', ['upload_mode' => 'magia'])->assertUnprocessable();

        $this->actingAs($user)->get('/songs')->assertInertia(fn (Assert $p) => $p
            ->where('uploadPrefs.chords_auto', false)->where('uploadPrefs.upload_mode', 'upload'));

        // Otro usuario no se ve afectado.
        $this->assertTrue(User::factory()->create()->preferences()->chords_auto);
        // Volver a preguntar.
        $this->actingAs($user)->patchJson('/settings/preferences/upload', ['upload_mode' => null])->assertJsonPath('upload_mode', null);
    }

    public function test_a_solo_subir_song_can_be_separated_later(): void
    {
        Queue::fake();
        $owner = User::factory()->create();
        $song = Song::factory()->for($owner)->create(['status' => Song::STATUS_NONE, 'queued_at' => null]);

        $this->actingAs(User::factory()->create())->postJson("/songs/{$song->id}/separate")->assertForbidden();
        $this->actingAs($owner)->postJson("/songs/{$song->id}/separate")->assertOk()->assertJsonPath('song.status', 'pending');
        Queue::assertPushed(SeparateSong::class, 1);

        $ready = Song::factory()->for($owner)->ready()->create();
        $this->actingAs($owner)->postJson("/songs/{$ready->id}/separate")->assertUnprocessable();
    }

    public function test_detecting_chords_per_song_uses_the_original_or_waits_for_the_separation(): void
    {
        Queue::fake();
        $owner = User::factory()->create();
        $original = Song::factory()->for($owner)->create(['status' => Song::STATUS_NONE]);
        $separating = Song::factory()->for($owner)->create(['status' => Song::STATUS_PROCESSING, 'heartbeat_at' => now()]);

        $this->actingAs(User::factory()->create())->postJson("/songs/{$original->id}/chords/analyze")->assertForbidden();
        $this->actingAs($owner)->postJson("/songs/{$original->id}/chords/analyze")->assertOk()->assertJsonPath('analysis.status', 'pending');
        $this->actingAs($owner)->postJson("/songs/{$separating->id}/chords/analyze")->assertOk()->assertJsonPath('analysis.status', 'waiting');

        Queue::assertPushed(AnalyzeChords::class, 1); // solo la que no espera
        $this->actingAs($owner)->postJson("/songs/{$original->id}/chords/analyze")->assertStatus(409); // ya en cola
    }

    public function test_detect_chords_in_all_songs_without_them_only_touches_own_songs(): void
    {
        Queue::fake();
        $owner = User::factory()->create();
        $none = Song::factory()->for($owner)->ready()->create();
        $failed = Song::factory()->for($owner)->create(['status' => Song::STATUS_NONE, 'chords_status' => Song::STATUS_FAILED]);
        $done = Song::factory()->for($owner)->ready()->create(['chords_status' => Song::STATUS_READY]);
        $foreign = Song::factory()->ready()->create();

        $this->actingAs($owner)->postJson('/songs/chords/analyze-missing')->assertOk()->assertJsonPath('queued', 2);

        $this->assertSame(Song::STATUS_PENDING, $none->fresh()->chords_status);
        $this->assertSame(Song::STATUS_PENDING, $failed->fresh()->chords_status);
        $this->assertSame(Song::STATUS_READY, $done->fresh()->chords_status);
        $this->assertNull($foreign->fresh()->chords_status);
        $this->actingAs($owner)->postJson('/songs/chords/analyze-missing')->assertJsonPath('queued', 0);
    }

    public function test_chords_detected_on_the_original_can_be_improved_after_separating(): void
    {
        $song = Song::factory()->ready()->create(['chords_status' => Song::STATUS_READY, 'chords_source' => 'original']);
        $this->assertTrue($song->canImproveChords());

        $this->actingAs($song->user)->get('/songs')->assertInertia(fn (Assert $p) => $p->where('songs.0.can_improve_chords', true));

        $song->update(['chords_source' => 'stems']);
        $this->assertFalse($song->fresh()->canImproveChords());
        $this->assertFalse(Song::factory()->create(['status' => Song::STATUS_NONE, 'chords_status' => 'ready', 'chords_source' => 'original'])->canImproveChords());
    }

    public function test_chord_analysis_can_be_canceled(): void
    {
        Queue::fake();
        $owner = User::factory()->create();
        $pending = Song::factory()->for($owner)->create(['status' => Song::STATUS_NONE, 'chords_status' => Song::STATUS_PENDING]);
        $waiting = Song::factory()->for($owner)->create(['chords_status' => Song::CHORDS_WAITING]);
        $idle = Song::factory()->for($owner)->create(['status' => Song::STATUS_NONE]);

        $this->actingAs(User::factory()->create())->postJson("/songs/{$pending->id}/chords/cancel")->assertForbidden();
        $this->actingAs($owner)->postJson("/songs/{$pending->id}/chords/cancel")->assertOk()->assertJsonPath('analysis.status', 'canceled');
        $this->actingAs($owner)->postJson("/songs/{$waiting->id}/chords/cancel")->assertOk()->assertJsonPath('analysis.status', 'canceled');
        $this->actingAs($owner)->postJson("/songs/{$idle->id}/chords/cancel")->assertUnprocessable();

        // Un job viejo de un análisis cancelado no hace nada.
        (new AnalyzeChords($pending))->handle(app(ChordEngine::class));
        $this->assertSame(Song::STATUS_CANCELED, $pending->fresh()->chords_status);

        // Y se puede volver a pedir.
        $this->actingAs($owner)->postJson("/songs/{$pending->id}/chords/analyze")->assertOk()->assertJsonPath('analysis.status', 'pending');
    }

    public function test_separation_cancel_and_failure_resolve_chords_waiting_for_it(): void
    {
        Queue::fake();
        $owner = User::factory()->create();

        // Cancelar la separación cancela también los acordes que esperaban.
        $canceled = Song::factory()->for($owner)->create(['chords_status' => Song::CHORDS_WAITING]);
        $this->actingAs($owner)->postJson("/songs/{$canceled->id}/cancel")->assertOk();
        $this->assertSame(Song::STATUS_CANCELED, $canceled->fresh()->chords_status);

        // Si la separación falla, los acordes se analizan con el original.
        config(['audio.separator.bin' => 'C:\\no\\existe.exe']);
        $failing = Song::factory()->for($owner)->create(['chords_status' => Song::CHORDS_WAITING]);
        Storage::disk('audio')->put($failing->originalPath(), 'x');
        (new SeparateSong($failing))->handle(app(Separator::class));

        $this->assertSame(Song::STATUS_FAILED, $failing->fresh()->status);
        $this->assertSame(Song::STATUS_PENDING, $failing->fresh()->chords_status);
        Queue::assertPushed(AnalyzeChords::class, fn ($job) => $job->song->is($failing));
    }

    public function test_status_endpoint_reports_both_processes(): void
    {
        $owner = User::factory()->create();
        Song::factory()->for($owner)->create(['status' => Song::STATUS_NONE, 'chords_status' => Song::STATUS_PROCESSING,
            'chords_progress' => 40, 'chords_started_at' => now(), 'chords_heartbeat_at' => now()]);

        $this->actingAs($owner)->getJson('/songs/status')
            ->assertOk()
            ->assertJsonPath('songs.0.status', 'none')
            ->assertJsonPath('songs.0.chords_status', 'processing')
            ->assertJsonPath('songs.0.chords_progress', 40);
    }
}
