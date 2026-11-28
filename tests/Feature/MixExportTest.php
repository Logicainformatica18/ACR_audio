<?php

namespace Tests\Feature;

use App\Models\Song;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/** Exportar mezcla (codificar con FFmpeg, descargar, borrar) y mezclas guardadas. */
class MixExportTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    private Song $song;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create();
        $this->song = Song::factory()->for($this->user)->ready()->create(['title' => 'Crush of Love']);
        $this->song->tracks()->create(['stem' => 'drums', 'file_name' => 'drums.flac', 'size' => 1, 'position' => 1]);
        $this->song->tracks()->create(['stem' => 'guitar', 'file_name' => 'guitar.flac', 'size' => 1, 'position' => 3]);
    }

    /** WAV real de 1 s (tono de 440 Hz), como el que manda el navegador. */
    private function wav(): UploadedFile
    {
        $rate = 8000;
        $samples = '';
        for ($i = 0; $i < $rate; $i++) {
            $v = (int) (12000 * sin(2 * M_PI * 440 * $i / $rate));
            $samples .= pack('v', $v & 0xFFFF).pack('v', $v & 0xFFFF);
        }
        $data = 'RIFF'.pack('V', 36 + strlen($samples)).'WAVEfmt '.pack('VvvVVvv', 16, 1, 2, $rate, $rate * 4, 4, 16)
            .'data'.pack('V', strlen($samples)).$samples;

        return UploadedFile::fake()->createWithContent('mezcla.wav', $data);
    }

    public function test_export_is_encoded_in_each_format_and_downloaded_with_a_readable_name(): void
    {
        foreach (['mp3', 'flac', 'wav'] as $format) {
            $r = $this->actingAs($this->user)->post("/songs/{$this->song->id}/exports", [
                'file' => $this->wav(), 'format' => $format, 'name' => 'Crush of Love - sin batería', 'gain_applied' => 0.8,
                'range_start' => 10, 'range_end' => 11,
            ], ['Accept' => 'application/json'])->assertCreated();

            $export = $this->song->exports()->latest('id')->first();
            $this->assertSame($format, $export->format);
            $this->assertSame("{$export->id}.{$format}", $export->file_name); // nombre del servidor, nunca el del usuario
            Storage::disk('audio')->assertExists($export->path());
            $this->assertGreaterThan(0, $export->size);
            $this->assertEqualsWithDelta(1.0, $export->duration, 0.1);
            $this->assertSame(0.8, $export->gain_applied);

            $download = $this->actingAs($this->user)->get($r->json('export.download_url'))->assertOk();
            $this->assertStringContainsString('Crush of Love - sin bater', $download->headers->get('Content-Disposition'));
            $this->assertStringContainsString(".{$format}", $download->headers->get('Content-Disposition'));
        }
        // El MP3 es MP3 de verdad (cabecera ID3 o de trama).
        $mp3 = Storage::disk('audio')->get($this->song->exports()->where('format', 'mp3')->first()->path());
        $this->assertTrue(str_starts_with($mp3, 'ID3') || (ord($mp3[0]) === 0xFF));
    }

    public function test_only_valid_wav_and_only_the_owner(): void
    {
        $this->actingAs($this->user)->post("/songs/{$this->song->id}/exports", [
            'file' => UploadedFile::fake()->createWithContent('x.wav', 'no es audio'), 'format' => 'mp3', 'name' => 'x',
        ], ['Accept' => 'application/json'])->assertUnprocessable();
        $this->actingAs($this->user)->post("/songs/{$this->song->id}/exports", ['file' => $this->wav(), 'format' => 'ogg', 'name' => 'x'], ['Accept' => 'application/json'])
            ->assertUnprocessable();

        $other = User::factory()->create();
        $this->actingAs($other)->post("/songs/{$this->song->id}/exports", ['file' => $this->wav(), 'format' => 'mp3', 'name' => 'x'], ['Accept' => 'application/json'])
            ->assertForbidden();

        $this->actingAs($this->user)->post("/songs/{$this->song->id}/exports", ['file' => $this->wav(), 'format' => 'wav', 'name' => 'mía'], ['Accept' => 'application/json'])->assertCreated();
        $export = $this->song->exports()->first();
        $this->actingAs($other)->get(route('songs.exports.download', [$this->song->id, $export->id]))->assertForbidden();
        $this->actingAs($other)->deleteJson(route('songs.exports.destroy', [$this->song->id, $export->id]))->assertForbidden();

        // Borrar libera el espacio.
        $this->actingAs($this->user)->deleteJson(route('songs.exports.destroy', [$this->song->id, $export->id]))->assertOk();
        Storage::disk('audio')->assertMissing($export->path());
        $this->assertModelMissing($export);
    }

    public function test_saved_mixes_store_validated_settings(): void
    {
        [$drums, $guitar] = $this->song->tracks()->orderBy('position')->get()->all();
        $settings = [
            'master' => 0.8,
            'tracks' => [['id' => $drums->id, 'volume' => 1, 'muted' => true, 'solo' => false], ['id' => $guitar->id, 'volume' => 0.5, 'muted' => false, 'solo' => false]],
            'silences' => [['track_id' => $guitar->id, 'start' => 10, 'end' => 12.5]],
            'show_original' => false,
            'range' => ['start' => 5, 'end' => 60],
        ];

        $r = $this->actingAs($this->user)->postJson("/songs/{$this->song->id}/mixes", ['name' => 'Sin batería', 'settings' => $settings])
            ->assertCreated()->assertJsonPath('mix.name', 'Sin batería')->assertJsonPath('mix.settings.tracks.0.muted', true)
            ->assertJsonPath('mix.settings.range.end', 60);
        $id = $r->json('mix.id');

        $this->actingAs($this->user)->get("/songs/{$this->song->id}")->assertInertia(fn ($p) => $p->where('mixes.0.name', 'Sin batería'));
        $this->actingAs($this->user)->patchJson("/songs/{$this->song->id}/mixes/{$id}", ['name' => 'Para practicar'])->assertJsonPath('mix.name', 'Para practicar');

        // Pistas de otra canción, silencios al revés o un rango imposible: no.
        $foreign = Song::factory()->for($this->user)->ready()->create();
        $ft = $foreign->tracks()->create(['stem' => 'bass', 'file_name' => 'bass.flac', 'size' => 1, 'position' => 2]);
        $bad = $settings;
        $bad['tracks'][0]['id'] = $ft->id;
        $this->actingAs($this->user)->postJson("/songs/{$this->song->id}/mixes", ['name' => 'x', 'settings' => $bad])->assertUnprocessable();
        $bad = $settings;
        $bad['silences'][0]['end'] = 5;
        $this->actingAs($this->user)->postJson("/songs/{$this->song->id}/mixes", ['name' => 'x', 'settings' => $bad])->assertUnprocessable();
        $bad = $settings;
        $bad['tracks'][0]['volume'] = 3;
        $this->actingAs($this->user)->postJson("/songs/{$this->song->id}/mixes", ['name' => 'x', 'settings' => $bad])->assertUnprocessable();

        // Solo el dueño.
        $other = User::factory()->create();
        $this->actingAs($other)->postJson("/songs/{$this->song->id}/mixes", ['name' => 'x', 'settings' => $settings])->assertForbidden();
        $this->actingAs($other)->deleteJson("/songs/{$this->song->id}/mixes/{$id}")->assertForbidden();

        $this->actingAs($this->user)->deleteJson("/songs/{$this->song->id}/mixes/{$id}")->assertOk();
        $this->assertSame(0, $this->song->mixes()->count());
    }
}
