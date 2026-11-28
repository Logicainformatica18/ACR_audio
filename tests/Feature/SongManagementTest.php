<?php

namespace Tests\Feature;

use App\Http\Controllers\MixerController;
use App\Models\Song;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\TestCase;

class SongManagementTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('audio');
    }

    /** Canción lista con original, una pista, ajustes y un silencio. */
    private function songWithFiles(User $user): Song
    {
        $song = Song::factory()->for($user)->ready()->create();
        $track = $song->tracks()->create(['stem' => 'vocals', 'file_name' => 'vocals.flac', 'size' => 3]);
        $track->setting()->create(['volume' => 0.5]);
        $track->silences()->create(['start_seconds' => 1, 'end_seconds' => 2]);
        Storage::disk('audio')->put($song->originalPath(), 'abc');
        Storage::disk('audio')->put($track->path(), 'abc');

        return $song;
    }

    public function test_owner_can_rename_a_song(): void
    {
        $song = Song::factory()->create(['title' => 'Viejo']);

        $this->actingAs($song->user)->patchJson("/songs/{$song->id}", ['title' => "  Nuevo\tnombre  "])
            ->assertOk()->assertJsonPath('song.title', 'Nuevonombre');

        $this->actingAs($song->user)->patchJson("/songs/{$song->id}", ['title' => '   '])->assertUnprocessable();
        $this->actingAs($song->user)->patchJson("/songs/{$song->id}", ['title' => str_repeat('x', 201)])->assertUnprocessable();
        $this->assertSame('Nuevonombre', $song->fresh()->title);
    }

    public function test_others_cannot_rename_or_delete(): void
    {
        $song = $this->songWithFiles(User::factory()->create());
        $intruder = User::factory()->create();

        $this->actingAs($intruder)->patchJson("/songs/{$song->id}", ['title' => 'Mío'])->assertForbidden();
        $this->actingAs($intruder)->deleteJson("/songs/{$song->id}")->assertForbidden();
        $this->assertDatabaseHas('songs', ['id' => $song->id]);
        Storage::disk('audio')->assertExists($song->originalPath());
    }

    public function test_deleting_a_song_removes_rows_and_files(): void
    {
        $user = User::factory()->create();
        $song = $this->songWithFiles($user);
        $keep = $this->songWithFiles($user);

        $this->actingAs($user)->deleteJson("/songs/{$song->id}")->assertOk();

        // Primero va a la papelera (se puede deshacer) y desaparece de la lista...
        $this->assertSoftDeleted($song);
        Storage::disk('audio')->assertExists($song->originalPath());
        $this->actingAs($user)->getJson('/songs/status')->assertJsonMissing(['id' => $song->id]);

        // ...y pasado el tiempo de deshacer se borra del todo: filas y archivos.
        $this->travel(Song::UNDO_SECONDS + 1)->seconds();
        Song::purgeTrashed();
        $this->assertDatabaseMissing('songs', ['id' => $song->id]);
        $this->assertDatabaseCount('tracks', 1);
        $this->assertDatabaseCount('track_settings', 1);
        $this->assertDatabaseCount('scheduled_silences', 1);
        Storage::disk('audio')->assertMissing($song->directory());
        Storage::disk('audio')->assertExists($keep->originalPath());
    }

    public function test_a_song_being_separated_cannot_be_deleted(): void
    {
        $song = Song::factory()->create(['status' => Song::STATUS_PROCESSING]);

        $this->actingAs($song->user)->deleteJson("/songs/{$song->id}")->assertStatus(409);
        $this->assertDatabaseHas('songs', ['id' => $song->id]);
    }

    public function test_deleting_the_account_removes_all_its_audio_files(): void
    {
        $user = User::factory()->create(['password' => 'secreto-largo-123']);
        $song = $this->songWithFiles($user);
        $other = $this->songWithFiles(User::factory()->create());

        $this->actingAs($user)->delete('/settings/profile', ['password' => 'secreto-largo-123'])->assertRedirect('/');

        Storage::disk('audio')->assertMissing((string) $user->id);
        $this->assertDatabaseMissing('songs', ['id' => $song->id]);
        Storage::disk('audio')->assertExists($other->originalPath());
    }

    public function test_preferences_page_and_update(): void
    {
        $models = sys_get_temp_dir().DIRECTORY_SEPARATOR.'acr_models_'.uniqid();
        mkdir($models);
        touch($models.DIRECTORY_SEPARATOR.'htdemucs_6s.yaml');
        config(['audio.separator.models_dir' => $models, 'audio.separator.model' => 'htdemucs_6s.yaml']);
        $user = User::factory()->create();

        $this->actingAs($user)->get('/settings/preferences')
            ->assertOk()
            ->assertInertia(fn (Assert $page) => $page
                ->component('settings/preferences')
                ->has('models', 1)
                ->where('models.0.value', 'htdemucs_6s.yaml')
                ->where('preferences.songs_sort', 'recent'));

        $valid = ['separation_model' => 'htdemucs_6s.yaml', 'songs_sort' => 'title', 'keyboard_shortcuts' => false, 'master_volume' => 0.4,
            'chords_auto' => false, 'upload_mode' => 'upload'];
        $this->actingAs($user)->put('/settings/preferences', $valid)->assertRedirect()->assertSessionHasNoErrors();
        $prefs = $user->fresh()->preferences();
        $this->assertSame('title', $prefs->songs_sort);
        $this->assertFalse($prefs->keyboard_shortcuts);
        $this->assertSame(0.4, $prefs->master_volume);
        $this->assertFalse($prefs->chords_auto);
        $this->assertSame('upload', $prefs->upload_mode);

        // "Preguntar cada vez" vuelve a activar el modal de subida.
        $this->actingAs($user)->put('/settings/preferences', [...$valid, 'upload_mode' => 'ask'])->assertSessionHasNoErrors();
        $this->assertNull($user->fresh()->preferences()->upload_mode);
        $this->actingAs($user)->get('/settings/preferences')
            ->assertInertia(fn (Assert $page) => $page->where('preferences.upload_mode', 'ask')->where('preferences.chords_auto', false));

        // Un modelo que no está descargado no se acepta (nunca se descargaría a la carpeta del separador).
        $this->actingAs($user)->put('/settings/preferences', [...$valid, 'separation_model' => 'htdemucs_ft.yaml'])
            ->assertSessionHasErrors('separation_model');

        unlink($models.DIRECTORY_SEPARATOR.'htdemucs_6s.yaml');
        rmdir($models);
    }

    public function test_sort_can_be_changed_from_the_songs_page(): void
    {
        $user = User::factory()->create();
        Song::factory()->for($user)->create(['title' => 'Zeta']);
        Song::factory()->for($user)->create(['title' => 'Alfa']);

        $this->actingAs($user)->patch('/settings/preferences/sort', ['songs_sort' => 'title'])->assertRedirect();
        $this->actingAs($user)->patch('/settings/preferences/sort', ['songs_sort' => 'cualquiera'])->assertSessionHasErrors('songs_sort');

        $this->actingAs($user)->get('/songs')->assertInertia(fn (Assert $page) => $page
            ->where('sort', 'title')
            ->where('songs.0.title', 'Alfa'));
    }

    public function test_dashboard_shows_only_own_stats(): void
    {
        $user = User::factory()->create();
        Song::factory()->for($user)->ready()->create(['original_size' => 1000, 'duration' => 120]);
        Song::factory()->for($user)->create(['status' => Song::STATUS_FAILED, 'original_size' => 500]);
        Song::factory()->create(); // de otro usuario

        $this->actingAs($user)->get('/dashboard')->assertInertia(fn (Assert $page) => $page
            ->component('dashboard')
            ->where('stats.total', 2)
            ->where('stats.ready', 1)
            ->where('stats.failed', 1)
            ->where('stats.bytes', 1500)
            ->where('stats.minutes', 2)
            ->has('recent', 2));
    }

    public function test_tracks_can_be_downloaded_with_a_readable_name(): void
    {
        $user = User::factory()->create();
        $song = $this->songWithFiles($user);
        $song->update(['title' => 'Mi tema: "versión" 2/3']);
        $track = $song->tracks()->first();

        $response = $this->actingAs($user)->get("/songs/{$song->id}/tracks/{$track->id}/audio?download=1");

        // Symfony envía un nombre ASCII de respaldo y el nombre real en UTF-8 (filename*).
        $response->assertOk()->assertDownload('Mi tema version 23 - Voz.flac');
        $this->assertStringContainsString("filename*=utf-8''".rawurlencode('Mi tema versión 23 - Voz.flac'), $response->headers->get('Content-Disposition'));

        $this->assertSame('ab - Voz.flac', MixerController::downloadName('a/b', 'Voz', 'flac'));
        $this->assertSame('evil - Voz.flac', MixerController::downloadName('..\\evil', 'Voz', 'flac'));
    }
}
