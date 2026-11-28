<?php

namespace Tests\Feature;

use App\Jobs\AnalyzeChords;
use App\Jobs\SeparateSong;
use App\Models\Chord;
use App\Models\Song;
use App\Models\Track;
use App\Models\User;
use App\Services\ChordEngine;
use App\Services\Separator;
use App\Services\Waveform;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ChordsTest extends TestCase
{
    use RefreshDatabase;

    private string $models;

    protected function setUp(): void
    {
        parent::setUp();
        // Carpeta de modelos falsa con el archivo de pesos "descargado".
        $this->models = sys_get_temp_dir().DIRECTORY_SEPARATOR.'acr_chords_'.uniqid();
        mkdir($this->models);
        file_put_contents($this->models.DIRECTORY_SEPARATOR.'btc_model_large_voca.pt', 'x');
    }

    protected function tearDown(): void
    {
        @unlink($this->models.DIRECTORY_SEPARATOR.'btc_model_large_voca.pt');
        @rmdir($this->models);
        parent::tearDown();
    }

    /** Usa PHP con un script falso como motor de acordes. */
    private function fakeEngine(string $script = 'fake_chords_ok.php'): void
    {
        config([
            'audio.chords.python' => PHP_BINARY,
            'audio.chords.script' => base_path('tests/Fixtures/'.$script),
            'audio.chords.models_dir' => $this->models,
            'audio.chords.model' => 'btc-large',
        ]);
    }

    /** Canción lista con sus 6 pistas en el disco falso. */
    private function readySong(?User $user = null, array $attributes = []): Song
    {
        $song = Song::factory()->for($user ?? User::factory()->create())->ready()->create($attributes);
        $disk = Storage::disk('audio');
        foreach (['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'] as $i => $stem) {
            $song->tracks()->create(['stem' => $stem, 'file_name' => "{$stem}.flac", 'size' => 5, 'position' => $i]);
            $disk->put($song->stemsDirectory()."/{$stem}.flac", 'falso');
        }

        return $song;
    }

    private function runJob(Song $song): void
    {
        (new AnalyzeChords($song))->handle(app(ChordEngine::class));
    }

    public function test_separation_launches_the_chords_that_were_waiting_for_it_on_their_own_queue(): void
    {
        Queue::fake();
        $models = sys_get_temp_dir().DIRECTORY_SEPARATOR.'acr_sep_'.uniqid();
        mkdir($models);
        file_put_contents($models.DIRECTORY_SEPARATOR.'htdemucs_6s.yaml', 'x');
        // PHP hace de audio-separator: ejecuta el "original", que crea las pistas.
        config(['audio.separator.bin' => PHP_BINARY, 'audio.separator.models_dir' => $models]);
        $script = file_get_contents(base_path('tests/Fixtures/fake_separator_original.php'));

        $waiting = Song::factory()->create(['model' => 'htdemucs_6s.yaml', 'chords_status' => Song::CHORDS_WAITING]);
        $waiting->tracks()->create(['stem' => 'original', 'file_name' => 'original.mp3', 'size' => 1, 'position' => 100]);
        Storage::disk('audio')->put($waiting->originalPath(), $script);
        $noChords = Song::factory()->create(['model' => 'htdemucs_6s.yaml']);
        Storage::disk('audio')->put($noChords->originalPath(), $script);

        (new SeparateSong($waiting))->handle(app(Separator::class));
        (new SeparateSong($noChords))->handle(app(Separator::class));

        $waiting->refresh();
        $this->assertSame(Song::STATUS_READY, $waiting->status);
        $this->assertSame(7, $waiting->tracks()->count(), '6 pistas + el original, que se conserva');
        $this->assertTrue($waiting->tracks()->where('stem', 'original')->exists());
        $this->assertSame(Song::STATUS_PENDING, $waiting->chords_status);
        Queue::assertPushedOn(AnalyzeChords::QUEUE, AnalyzeChords::class, fn (AnalyzeChords $job) => $job->song->is($waiting));
        $this->assertSame('acordes', AnalyzeChords::QUEUE);
        $this->assertNotSame(SeparateSong::QUEUE, AnalyzeChords::QUEUE);

        // Sin acordes pedidos: se separa y no se analiza nada.
        $this->assertSame(Song::STATUS_READY, $noChords->fresh()->status);
        $this->assertNull($noChords->fresh()->chords_status);
        Queue::assertPushed(AnalyzeChords::class, 1);

        unlink($models.DIRECTORY_SEPARATOR.'htdemucs_6s.yaml');
        rmdir($models);
    }

    public function test_analysis_uses_guitar_bass_piano_and_other_but_not_drums_or_vocals(): void
    {
        $song = $this->readySong();

        $files = array_map('basename', app(ChordEngine::class)->inputFiles($song));

        $this->assertSame(['guitar.flac', 'bass.flac', 'piano.flac', 'other.flac'], $files);
    }

    public function test_job_saves_each_chord_the_key_and_finishes(): void
    {
        $this->fakeEngine();
        $song = $this->readySong(attributes: ['chords_status' => Song::STATUS_PENDING]);

        $this->runJob($song);

        $song->refresh();
        $this->assertSame(Song::STATUS_READY, $song->chords_status);
        $this->assertSame(100, $song->chords_progress);
        $this->assertSame('A menor', $song->chords_key);
        $this->assertSame('btc-large (GPU)', $song->chords_model);
        $this->assertNotNull($song->chords_finished_at);
        $this->assertSame(['N', 'Am', 'F', 'G7'], $song->chords()->pluck('chord')->all());
        $am = $song->chords()->where('chord', 'Am')->first();
        $this->assertEquals([2.0, 6.0, 0.88, false], [$am->start_seconds, $am->end_seconds, $am->confidence, $am->edited]);
    }

    public function test_reanalysis_keeps_hand_edited_chords_and_does_not_overlap_them(): void
    {
        $this->fakeEngine();
        $song = $this->readySong(attributes: ['chords_status' => Song::STATUS_READY]);
        $song->chords()->create(['start_seconds' => 0, 'end_seconds' => 3, 'chord' => 'Bb', 'confidence' => 0.5, 'edited' => false]);
        $song->chords()->create(['start_seconds' => 3, 'end_seconds' => 5, 'chord' => 'Dm7', 'edited' => true]);

        $song->queueChordAnalysis(); // cola sync en los tests: corre ya

        $chords = $song->chords()->get()->map(fn ($c) => [$c->start_seconds, $c->end_seconds, $c->chord, $c->edited])->all();
        $this->assertSame([
            [0.0, 2.0, 'N', false],
            [2.0, 3.0, 'Am', false],   // Am (2–6) recortado alrededor del editado
            [3.0, 5.0, 'Dm7', true],   // el corregido a mano sigue ahí
            [5.0, 6.0, 'Am', false],
            [6.0, 10.0, 'F', false],
            [10.0, 12.5, 'G7', false],
        ], $chords);
        $this->assertFalse($song->chords()->where('chord', 'Bb')->exists()); // el automático viejo se borró
    }

    public function test_engine_error_marks_the_analysis_as_failed_with_the_message(): void
    {
        $this->fakeEngine('fake_chords_error.php');
        $song = $this->readySong(attributes: ['chords_status' => Song::STATUS_PENDING]);

        $this->runJob($song);

        $song->refresh();
        $this->assertSame(Song::STATUS_FAILED, $song->chords_status);
        $this->assertSame('RuntimeError: CUDA out of memory', $song->chords_error);
        $this->assertSame(1, $song->chords()->count()); // lo que llegó antes del error queda guardado
    }

    public function test_missing_engine_gives_a_clear_message(): void
    {
        $song = $this->readySong(attributes: ['chords_status' => Song::STATUS_PENDING]);

        $this->runJob($song); // phpunit.xml apunta CHORDS_PYTHON a una ruta que no existe

        $song->refresh();
        $this->assertSame(Song::STATUS_FAILED, $song->chords_status);
        $this->assertStringContainsString('instalar.bat', $song->chords_error);
    }

    public function test_job_ignores_songs_that_are_not_pending(): void
    {
        $this->fakeEngine();
        $song = $this->readySong(attributes: ['chords_status' => Song::STATUS_READY]);

        $this->runJob($song);

        $this->assertSame(0, $song->chords()->count());
    }

    public function test_mixer_receives_saved_chords_key_and_precomputed_waveforms(): void
    {
        $user = User::factory()->create();
        $song = $this->readySong($user, ['chords_status' => Song::STATUS_READY, 'chords_key' => 'B menor', 'chords_progress' => 100]);
        $song->chords()->create(['start_seconds' => 1, 'end_seconds' => 2.5, 'chord' => 'Bm', 'confidence' => 0.9]);
        Track::where('song_id', $song->id)->update(['peaks' => base64_encode(str_repeat("\x80", 4000))]);

        $this->actingAs($user)->get("/songs/{$song->id}")
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('songs/mixer')
                ->where('analysis.status', 'ready')
                ->where('analysis.key', 'B menor')
                ->where('chords.0.chord', 'Bm')
                ->where('chords.0.start', 1)
                ->where('tracks.0.peaks', base64_encode(str_repeat("\x80", 4000))));
    }

    public function test_chords_endpoint_is_only_for_the_owner(): void
    {
        $owner = User::factory()->create();
        $song = $this->readySong($owner, ['chords_status' => Song::STATUS_PROCESSING, 'chords_progress' => 40]);
        $song->chords()->create(['start_seconds' => 0, 'end_seconds' => 4, 'chord' => 'Em']);

        $this->actingAs(User::factory()->create())->getJson("/songs/{$song->id}/chords")->assertForbidden();
        $this->actingAs($owner)->getJson("/songs/{$song->id}/chords")
            ->assertOk()
            ->assertJsonPath('analysis.status', 'processing')
            ->assertJsonPath('analysis.progress', 40)
            ->assertJsonPath('chords.0.chord', 'Em');
    }

    public function test_a_chord_can_be_corrected_by_hand(): void
    {
        $owner = User::factory()->create();
        $song = $this->readySong($owner);
        $chord = $song->chords()->create(['start_seconds' => 0, 'end_seconds' => 4, 'chord' => 'Em', 'confidence' => 0.4]);
        $other = $this->readySong();
        $foreign = $other->chords()->create(['start_seconds' => 0, 'end_seconds' => 4, 'chord' => 'C']);

        $this->actingAs($owner)->patchJson("/songs/{$song->id}/chords/{$chord->id}", ['chord' => 'Em7'])
            ->assertOk()
            ->assertJsonPath('chord.chord', 'Em7')
            ->assertJsonPath('chord.edited', true);
        $this->assertTrue($chord->fresh()->edited);
        $this->assertNull($chord->fresh()->confidence);

        foreach (['F#m7', 'Bb', 'Dmaj7', 'Bsus4', 'Bdim', 'C/G', 'N', 'A7', 'Gm(maj7)'] as $ok) {
            $this->actingAs($owner)->patchJson("/songs/{$song->id}/chords/{$chord->id}", ['chord' => $ok])->assertOk();
        }
        foreach (['H', 'cm', 'Am<script>', '', 'C#m7b5/G#extra'] as $bad) {
            $this->actingAs($owner)->patchJson("/songs/{$song->id}/chords/{$chord->id}", ['chord' => $bad])->assertUnprocessable();
        }

        // Ni acordes ajenos ni acordes de otra canción.
        $this->actingAs($owner)->patchJson("/songs/{$other->id}/chords/{$foreign->id}", ['chord' => 'D'])->assertForbidden();
        $this->actingAs($owner)->patchJson("/songs/{$song->id}/chords/{$foreign->id}", ['chord' => 'D'])->assertNotFound();
        $this->assertSame('C', $foreign->fresh()->chord);
    }

    public function test_analyze_again_queues_the_song_unless_it_is_already_running(): void
    {
        Queue::fake();
        $owner = User::factory()->create();
        $song = $this->readySong($owner, ['chords_status' => Song::STATUS_READY]);

        $this->actingAs(User::factory()->create())->postJson("/songs/{$song->id}/chords/analyze")->assertForbidden();
        $this->actingAs($owner)->postJson("/songs/{$song->id}/chords/analyze")
            ->assertOk()
            ->assertJsonPath('analysis.status', 'pending');
        Queue::assertPushedOn('acordes', AnalyzeChords::class);

        $this->actingAs($owner)->postJson("/songs/{$song->id}/chords/analyze")->assertStatus(409);
        Queue::assertPushed(AnalyzeChords::class, 1);
    }

    public function test_a_song_cannot_be_deleted_while_its_chords_are_being_analyzed(): void
    {
        $owner = User::factory()->create();
        $song = $this->readySong($owner, ['chords_status' => Song::STATUS_PROCESSING]);

        $this->actingAs($owner)->deleteJson("/songs/{$song->id}")->assertStatus(409);
        $this->assertModelExists($song);
    }

    public function test_command_queues_songs_that_were_never_analyzed(): void
    {
        Queue::fake();
        $never = $this->readySong();
        $done = $this->readySong(attributes: ['chords_status' => Song::STATUS_READY]);
        Song::factory()->create(); // sin separar: no se analiza

        $this->artisan('acordes:analizar')->assertSuccessful();
        Queue::assertPushed(AnalyzeChords::class, 1);
        Queue::assertPushed(AnalyzeChords::class, fn ($job) => $job->song->is($never));

        $this->artisan('acordes:analizar', ['cancion' => $done->id])->assertSuccessful();
        Queue::assertPushed(AnalyzeChords::class, fn ($job) => $job->song->is($done));

        Song::query()->update(['chords_status' => Song::STATUS_READY]);
        $this->artisan('acordes:analizar', ['--todas' => true])->assertSuccessful();
        Queue::assertPushed(AnalyzeChords::class, 4);
    }

    public function test_free_ranges_cut_around_edited_chords(): void
    {
        $this->assertSame([[0.0, 2.0], [3.0, 6.0]], Chord::freeRanges(0.0, 6.0, [[2.0, 3.0]]));
        $this->assertSame([], Chord::freeRanges(2.0, 3.0, [[1.0, 4.0]]));
        $this->assertSame([[0.0, 1.0]], Chord::freeRanges(0.0, 1.0, [[5.0, 6.0]]));
        $this->assertSame([[1.0, 2.0]], Chord::freeRanges(1.0, 2.02, [[2.0, 3.0]])); // trozos < 0,05 s fuera
    }

    public function test_waveform_is_computed_from_a_real_audio_file(): void
    {
        // WAV de 2 s: 1 s de silencio y 1 s de tono a media amplitud.
        $rate = 8000;
        $samples = '';
        for ($i = 0; $i < 2 * $rate; $i++) {
            $v = $i < $rate ? 0 : (int) (16384 * sin(2 * M_PI * 440 * $i / $rate));
            $samples .= pack('v', $v & 0xFFFF);
        }
        $wav = 'RIFF'.pack('V', 36 + strlen($samples)).'WAVEfmt '.pack('VvvVVvv', 16, 1, 1, $rate, $rate * 2, 2, 16)
            .'data'.pack('V', strlen($samples)).$samples;
        $file = sys_get_temp_dir().DIRECTORY_SEPARATOR.'acr_wave_'.uniqid().'.wav';
        file_put_contents($file, $wav);

        $peaks = Waveform::compute($file, 100);
        unlink($file);

        $this->assertNotNull($peaks, 'ffmpeg debe estar en el PATH');
        $values = array_map('ord', str_split(base64_decode($peaks)));
        $this->assertCount(100, $values);
        $this->assertLessThanOrEqual(2, max(array_slice($values, 0, 48)));      // silencio
        $this->assertEqualsWithDelta(127, max(array_slice($values, 52)), 6);   // ~media amplitud
        $this->assertNull(Waveform::compute(sys_get_temp_dir().DIRECTORY_SEPARATOR.'no-existe.flac'));
    }

    public function test_waveform_command_fills_missing_peaks(): void
    {
        $song = $this->readySong();

        // Las pistas falsas no son audio: el comando avisa y no rompe nada.
        $this->artisan('ondas:calcular')->assertFailed();
        $this->assertSame(0, Track::whereNotNull('peaks')->where('song_id', $song->id)->count());
    }
}
