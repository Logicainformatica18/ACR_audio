<?php

namespace Tests\Feature;

use App\Http\Controllers\SongController;
use App\Models\Song;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\TestCase;

class SongUploadTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('audio');
        Queue::fake(); // la separación se prueba en SeparationTest
    }

    public function test_guests_cannot_see_or_upload_songs(): void
    {
        $this->get('/songs')->assertRedirect('/login');
        $this->postJson('/songs', ['file' => UploadedFile::fake()->create('a.mp3', 10, 'audio/mpeg')])->assertUnauthorized();
        $this->assertDatabaseCount('songs', 0);
    }

    public function test_user_can_upload_an_audio_file(): void
    {
        $user = User::factory()->create();

        $response = $this->actingAs($user)->postJson('/songs', [
            'file' => UploadedFile::fake()->create('01_Mi canción.MP3', 500, 'audio/mpeg'),
        ]);

        $response->assertCreated()->assertJsonPath('song.title', '01 Mi canción')->assertJsonPath('song.status', 'pending');

        $song = Song::firstOrFail();
        $this->assertSame($user->id, $song->user_id);
        $this->assertSame('mp3', $song->original_ext);
        $this->assertSame('01_Mi canción.MP3', $song->original_name);
        Storage::disk('audio')->assertExists("{$user->id}/{$song->id}/original.mp3");
    }

    public function test_file_name_is_never_used_in_the_storage_path(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)->postJson('/songs', [
            'file' => UploadedFile::fake()->create('..\\..\\evil name.wav', 10, 'audio/wav'),
        ])->assertCreated();

        $song = Song::firstOrFail();
        $this->assertSame(["{$user->id}/{$song->id}/original.wav"], Storage::disk('audio')->allFiles());
    }

    public function test_rejects_wrong_extension_wrong_type_and_too_big_files(): void
    {
        $user = User::factory()->create();
        config(['audio.max_upload_mb' => 1]);

        $this->actingAs($user)->postJson('/songs', ['file' => UploadedFile::fake()->create('virus.exe', 10, 'application/x-msdownload')])
            ->assertUnprocessable()->assertJsonValidationErrors('file');

        $this->actingAs($user)->postJson('/songs', ['file' => UploadedFile::fake()->create('falso.mp3', 10, 'text/plain')])
            ->assertUnprocessable()->assertJsonValidationErrors('file');

        $this->actingAs($user)->postJson('/songs', ['file' => UploadedFile::fake()->create('grande.mp3', 2048, 'audio/mpeg')])
            ->assertUnprocessable()->assertJsonValidationErrors('file');

        $this->actingAs($user)->postJson('/songs', [])->assertUnprocessable()->assertJsonValidationErrors('file');

        $this->assertDatabaseCount('songs', 0);
        $this->assertSame([], Storage::disk('audio')->allFiles());
    }

    public function test_each_user_only_sees_their_own_songs(): void
    {
        $me = User::factory()->create();
        $other = User::factory()->create();
        Song::factory()->for($me)->create(['title' => 'Mía']);
        Song::factory()->for($other)->create(['title' => 'Ajena']);

        $this->actingAs($me)->get('/songs')
            ->assertOk()
            ->assertInertia(fn (Assert $page) => $page
                ->component('songs/index')
                ->has('songs', 1)
                ->where('songs.0.title', 'Mía')
                ->where('limits.max_mb', config('audio.max_upload_mb')));
    }

    public function test_title_is_derived_and_cleaned_from_the_file_name(): void
    {
        $this->assertSame('Mi tema final', SongController::titleFromFileName("Mi_tema  final.flac"));
        $this->assertSame('Canción sin título', SongController::titleFromFileName('.mp3'));
        $this->assertSame('Tab', SongController::titleFromFileName("Ta\tb.mp3"));
    }
}
