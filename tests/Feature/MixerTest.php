<?php

namespace Tests\Feature;

use App\Models\Song;
use App\Models\Track;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\TestCase;

class MixerTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private Song $song;

    private Track $vocals;

    private Track $drums;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('audio');

        $this->owner = User::factory()->create();
        $this->song = Song::factory()->for($this->owner)->ready()->create(['duration' => 120]);
        $this->vocals = $this->song->tracks()->create(['stem' => 'vocals', 'file_name' => 'vocals.flac', 'size' => 100, 'position' => 0]);
        $this->drums = $this->song->tracks()->create(['stem' => 'drums', 'file_name' => 'drums.flac', 'size' => 100, 'position' => 1]);
        Storage::disk('audio')->put($this->vocals->path(), str_repeat('A', 100));
        Storage::disk('audio')->put($this->drums->path(), str_repeat('B', 100));
    }

    public function test_owner_opens_the_mixer_with_tracks_settings_and_silences(): void
    {
        $this->vocals->setting()->create(['volume' => 0.4, 'muted' => true, 'solo' => false]);
        $this->vocals->silences()->create(['start_seconds' => 10, 'end_seconds' => 12.5]);
        $this->owner->preferences()->update(['master_volume' => 0.7]);

        $this->actingAs($this->owner)->get("/songs/{$this->song->id}")
            ->assertOk()
            ->assertInertia(fn (Assert $page) => $page
                ->component('songs/mixer')
                ->has('tracks', 2)
                ->where('tracks.0.stem', 'vocals')
                ->where('tracks.0.label', 'Voz')
                ->where('tracks.0.volume', 0.4)
                ->where('tracks.0.muted', true)
                ->where('tracks.0.silences.0.end', 12.5)
                ->where('tracks.1.volume', 1) // sin fila: valores por defecto
                ->where('preferences.master_volume', 0.7)
                ->etc());
    }

    public function test_other_users_cannot_open_listen_or_save(): void
    {
        $intruder = User::factory()->create();

        $this->actingAs($intruder)->get("/songs/{$this->song->id}")->assertForbidden();
        $this->actingAs($intruder)->get("/songs/{$this->song->id}/tracks/{$this->vocals->id}/audio")->assertForbidden();
        $this->actingAs($intruder)->putJson("/songs/{$this->song->id}/mixer", ['tracks' => [], 'silences' => []])->assertForbidden();
    }

    public function test_guests_are_redirected_to_login(): void
    {
        $this->get("/songs/{$this->song->id}/tracks/{$this->vocals->id}/audio")->assertRedirect('/login');
    }

    public function test_songs_that_are_not_ready_redirect_to_the_list(): void
    {
        $pending = Song::factory()->for($this->owner)->create();

        $this->actingAs($this->owner)->get("/songs/{$pending->id}")->assertRedirect('/songs');
    }

    public function test_audio_is_served_with_range_support(): void
    {
        $url = "/songs/{$this->song->id}/tracks/{$this->vocals->id}/audio";

        $full = $this->actingAs($this->owner)->get($url);
        $full->assertOk()->assertHeader('Content-Type', 'audio/flac')->assertHeader('Accept-Ranges', 'bytes');

        $partial = $this->actingAs($this->owner)->get($url, ['Range' => 'bytes=0-9']);
        $partial->assertStatus(206)->assertHeader('Content-Range', 'bytes 0-9/100')->assertHeader('Content-Length', '10');
    }

    public function test_a_track_from_another_song_is_not_found(): void
    {
        $other = Song::factory()->for($this->owner)->ready()->create();
        $foreign = $other->tracks()->create(['stem' => 'bass', 'file_name' => 'bass.flac']);

        $this->actingAs($this->owner)->get("/songs/{$this->song->id}/tracks/{$foreign->id}/audio")->assertNotFound();
    }

    public function test_save_persists_settings_silences_and_master_volume(): void
    {
        $this->vocals->silences()->create(['start_seconds' => 1, 'end_seconds' => 2]); // se reemplaza

        $this->actingAs($this->owner)->putJson("/songs/{$this->song->id}/mixer", [
            'master_volume' => 0.55,
            'tracks' => [
                ['id' => $this->vocals->id, 'volume' => 0.3, 'muted' => false, 'solo' => true],
                ['id' => $this->drums->id, 'volume' => 0.8, 'muted' => true, 'solo' => false],
            ],
            'silences' => [
                ['track_id' => $this->drums->id, 'start' => 30.25, 'end' => 45.5],
                ['track_id' => $this->drums->id, 'start' => 60, 'end' => 61],
            ],
        ])->assertOk();

        $this->assertSame(0.3, $this->vocals->fresh()->setting->volume);
        $this->assertTrue($this->vocals->fresh()->setting->solo);
        $this->assertTrue($this->drums->fresh()->setting->muted);
        $this->assertCount(0, $this->vocals->fresh()->silences);
        $this->assertSame([30.25, 60.0], $this->drums->fresh()->silences->pluck('start_seconds')->all());
        $this->assertSame(0.55, $this->owner->fresh()->preferences()->master_volume);

        // Guardar dos veces no duplica filas de ajustes.
        $this->actingAs($this->owner)->putJson("/songs/{$this->song->id}/mixer", [
            'tracks' => [['id' => $this->vocals->id, 'volume' => 1, 'muted' => false, 'solo' => false]],
            'silences' => [],
        ])->assertOk();
        $this->assertDatabaseCount('track_settings', 2);
        $this->assertDatabaseCount('scheduled_silences', 0);
    }

    public function test_save_rejects_foreign_tracks_and_invalid_times(): void
    {
        $other = Song::factory()->for($this->owner)->ready()->create();
        $foreign = $other->tracks()->create(['stem' => 'bass', 'file_name' => 'bass.flac']);
        $url = "/songs/{$this->song->id}/mixer";

        $this->actingAs($this->owner)->putJson($url, [
            'tracks' => [['id' => $foreign->id, 'volume' => 1, 'muted' => false, 'solo' => false]],
            'silences' => [],
        ])->assertUnprocessable()->assertJsonValidationErrors('tracks.0.id');

        $this->actingAs($this->owner)->putJson($url, [
            'tracks' => [],
            'silences' => [['track_id' => $this->vocals->id, 'start' => 10, 'end' => 5]],
        ])->assertUnprocessable()->assertJsonValidationErrors('silences.0.end');

        $this->actingAs($this->owner)->putJson($url, [
            'tracks' => [['id' => $this->vocals->id, 'volume' => 3, 'muted' => false, 'solo' => false]],
            'silences' => [['track_id' => $this->vocals->id, 'start' => 0, 'end' => 9999]],
        ])->assertUnprocessable()->assertJsonValidationErrors(['tracks.0.volume', 'silences.0.end']);
    }
}
