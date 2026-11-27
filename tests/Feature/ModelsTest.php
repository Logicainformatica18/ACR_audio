<?php

namespace Tests\Feature;

use App\Models\Song;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ModelsTest extends TestCase
{
    use RefreshDatabase;

    public function test_song_tracks_settings_and_silences_are_related_and_cascade(): void
    {
        $song = Song::factory()->ready()->create();
        $track = $song->tracks()->create(['stem' => 'vocals', 'file_name' => 'vocals.flac', 'size' => 10, 'position' => 0]);
        $track->setting()->create(['volume' => 0.5, 'muted' => true]);
        $track->silences()->create(['start_seconds' => 1.5, 'end_seconds' => 3]);

        $this->assertSame('Voz', $track->label());
        $this->assertSame(0.5, $track->fresh()->setting->volume);
        $this->assertCount(1, $track->silences);
        $this->assertSame("{$song->user_id}/{$song->id}/stems/vocals.flac", $track->path());

        $song->user->delete();

        $this->assertDatabaseCount('songs', 0);
        $this->assertDatabaseCount('tracks', 0);
        $this->assertDatabaseCount('track_settings', 0);
        $this->assertDatabaseCount('scheduled_silences', 0);
    }

    public function test_track_setting_has_defaults_when_missing(): void
    {
        $song = Song::factory()->ready()->create();
        $track = $song->tracks()->create(['stem' => 'drums', 'file_name' => 'drums.flac']);

        $this->assertSame(1.0, $track->setting->volume);
        $this->assertFalse($track->setting->muted);
        $this->assertFalse($track->setting->solo);
    }

    public function test_preferences_are_created_once_with_defaults(): void
    {
        $user = User::factory()->create();

        $prefs = $user->preferences();
        $this->assertSame(0.9, $prefs->fresh()->master_volume);
        $this->assertSame($prefs->id, $user->fresh()->preferences()->id);
        $this->assertDatabaseCount('user_preferences', 1);
    }

    public function test_effective_model_falls_back_to_env_model(): void
    {
        config(['audio.separator.model' => 'htdemucs_6s.yaml']);
        $prefs = User::factory()->create()->preferences();

        $this->assertSame('htdemucs_6s.yaml', $prefs->effectiveModel());

        $prefs->update(['separation_model' => 'modelo_que_no_existe.yaml']);
        $this->assertSame('htdemucs_6s.yaml', $prefs->effectiveModel());

        $prefs->update(['separation_model' => 'htdemucs_ft.yaml']);
        $this->assertSame('htdemucs_ft.yaml', $prefs->effectiveModel());
    }
}
