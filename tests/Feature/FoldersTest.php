<?php

namespace Tests\Feature;

use App\Jobs\AnalyzeChords;
use App\Jobs\SeparateSong;
use App\Models\Folder;
use App\Models\Song;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Queue;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\TestCase;

/** Carpetas, mover canciones, acciones en lote, papelera con deshacer y pistas renombradas. */
class FoldersTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create();
    }

    private function folder(array $attrs = [], ?User $owner = null): Folder
    {
        return ($owner ?? $this->user)->folders()->create(['name' => 'Carpeta', 'position' => 0, ...$attrs]);
    }

    public function test_create_rename_color_and_note(): void
    {
        $this->actingAs($this->user)->postJson('/folders')->assertCreated()->assertJsonPath('folder.name', 'Nueva carpeta');
        $id = Folder::first()->id;

        $this->actingAs($this->user)->patchJson("/folders/{$id}", ['name' => '  Metal  ', 'color' => 'red', 'note' => 'afinación Eb'])
            ->assertOk()->assertJsonPath('folder.name', 'Metal')->assertJsonPath('folder.color', 'red')->assertJsonPath('folder.note', 'afinación Eb');
        $this->actingAs($this->user)->patchJson("/folders/{$id}", ['color' => 'dorado'])->assertUnprocessable();
        $this->actingAs($this->user)->patchJson("/folders/{$id}", ['name' => '   '])->assertUnprocessable();

        $this->actingAs($this->user)->get('/songs')->assertInertia(fn (Assert $p) => $p->where('folders.0.name', 'Metal'));
    }

    public function test_folders_of_other_users_are_off_limits(): void
    {
        $foreign = $this->folder(['name' => 'Ajena'], User::factory()->create());
        $song = Song::factory()->for($this->user)->create();

        $this->actingAs($this->user)->patchJson("/folders/{$foreign->id}", ['name' => 'Mía'])->assertForbidden();
        $this->actingAs($this->user)->deleteJson("/folders/{$foreign->id}")->assertForbidden();
        $this->actingAs($this->user)->postJson('/folders', ['parent_id' => $foreign->id])->assertUnprocessable();
        $this->actingAs($this->user)->postJson('/songs/move', ['song_ids' => [$song->id], 'folder_id' => $foreign->id])->assertUnprocessable();
        $mine = $this->folder();
        $this->actingAs($this->user)->postJson("/folders/{$mine->id}/move", ['parent_id' => $foreign->id])->assertUnprocessable();
        $this->assertNull($song->fresh()->folder_id);
    }

    public function test_moving_songs_between_folders(): void
    {
        $metal = $this->folder(['name' => 'Metal']);
        [$a, $b] = Song::factory()->for($this->user)->count(2)->create()->all();
        $foreign = Song::factory()->create();

        $this->actingAs($this->user)->postJson('/songs/move', ['song_ids' => [$a->id, $b->id], 'folder_id' => $metal->id])
            ->assertOk()->assertJsonPath('moved', 2)->assertJsonPath('folders.0.songs_count', 2);
        $this->assertSame($metal->id, $a->fresh()->folder_id);

        // A "Sin carpeta".
        $this->actingAs($this->user)->postJson('/songs/move', ['song_ids' => [$a->id], 'folder_id' => null])->assertOk();
        $this->assertNull($a->fresh()->folder_id);

        // Nunca canciones ajenas.
        $this->actingAs($this->user)->postJson('/songs/move', ['song_ids' => [$foreign->id], 'folder_id' => $metal->id])->assertForbidden();
        $this->assertNull($foreign->fresh()->folder_id);
    }

    public function test_moving_folders_reorders_and_nests(): void
    {
        $a = $this->folder(['name' => 'A', 'position' => 0]);
        $b = $this->folder(['name' => 'B', 'position' => 1]);
        $c = $this->folder(['name' => 'C', 'position' => 2]);

        // Reordenar: C al principio.
        $this->actingAs($this->user)->postJson("/folders/{$c->id}/move", ['parent_id' => null, 'position' => 0])->assertOk();
        $this->assertSame(['C', 'A', 'B'], Folder::whereNull('parent_id')->orderBy('position')->pluck('name')->all());

        // Meter B dentro de A.
        $this->actingAs($this->user)->postJson("/folders/{$b->id}/move", ['parent_id' => $a->id])->assertOk();
        $this->assertSame($a->id, $b->fresh()->parent_id);
    }

    public function test_cycles_and_too_many_levels_are_rejected(): void
    {
        $metal = $this->folder(['name' => 'Metal']);
        $satriani = $this->folder(['name' => 'Satriani', 'parent_id' => $metal->id]);
        $surfing = $this->folder(['name' => 'Surfing', 'parent_id' => $satriani->id]);

        // Dentro de sí misma o de una subcarpeta suya.
        $this->actingAs($this->user)->postJson("/folders/{$metal->id}/move", ['parent_id' => $metal->id])
            ->assertUnprocessable()->assertJsonPath('message', 'Una carpeta no puede ir dentro de sí misma ni de una de sus subcarpetas.');
        $this->actingAs($this->user)->postJson("/folders/{$metal->id}/move", ['parent_id' => $surfing->id])->assertUnprocessable();
        $this->assertNull($metal->fresh()->parent_id);

        // Un cuarto nivel no.
        $this->actingAs($this->user)->postJson('/folders', ['parent_id' => $surfing->id])->assertUnprocessable();
        $other = $this->folder(['name' => 'Otra']);
        $this->folder(['name' => 'Hija', 'parent_id' => $other->id]);
        $this->actingAs($this->user)->postJson("/folders/{$other->id}/move", ['parent_id' => $satriani->id])->assertUnprocessable();
        $this->actingAs($this->user)->postJson("/folders/{$other->id}/move", ['parent_id' => $metal->id])->assertOk(); // 3 niveles: sí
    }

    public function test_deleting_a_folder_keeps_its_songs_and_can_be_undone(): void
    {
        $metal = $this->folder(['name' => 'Metal']);
        $satriani = $this->folder(['name' => 'Satriani', 'parent_id' => $metal->id]);
        $sub = $this->folder(['name' => 'Surfing', 'parent_id' => $satriani->id]);
        $inside = Song::factory()->for($this->user)->create(['folder_id' => $satriani->id]);
        $root = Song::factory()->for($this->user)->create(['folder_id' => $metal->id]);

        $response = $this->actingAs($this->user)->deleteJson("/folders/{$satriani->id}")
            ->assertOk()->assertJsonPath('moved_songs', [$inside->id])->assertJsonPath('moved_folders', [$sub->id]);

        // Las canciones y la subcarpeta pasan a la carpeta superior; nada se borra.
        $this->assertSame($metal->id, $inside->fresh()->folder_id);
        $this->assertSame($metal->id, $sub->fresh()->parent_id);
        $this->assertSoftDeleted($satriani);
        $this->assertSame(2, Song::count());

        // Deshacer.
        $this->actingAs($this->user)->postJson("/folders/{$satriani->id}/restore", [
            'song_ids' => $response->json('moved_songs'), 'folder_ids' => $response->json('moved_folders'),
        ])->assertOk();
        $this->assertSame($satriani->id, $inside->fresh()->folder_id);
        $this->assertSame($satriani->id, $sub->fresh()->parent_id);
        $this->assertFalse($satriani->fresh()->trashed());

        // Borrar una carpeta raíz: sus canciones van a "Sin carpeta".
        $this->actingAs($this->user)->deleteJson("/folders/{$metal->id}")->assertOk();
        $this->assertNull($root->fresh()->folder_id);
        $this->assertNull($satriani->fresh()->parent_id);
    }

    public function test_uploading_into_a_folder(): void
    {
        Queue::fake();
        $folder = $this->folder();
        $file = fn ($n) => UploadedFile::fake()->create($n, 100, 'audio/mpeg');

        $this->actingAs($this->user)->postJson('/songs', ['file' => $file('a.mp3'), 'mode' => 'upload', 'folder_id' => $folder->id])
            ->assertCreated()->assertJsonPath('song.folder_id', $folder->id);
        $foreign = $this->folder([], User::factory()->create());
        $this->actingAs($this->user)->postJson('/songs', ['file' => $file('b.mp3'), 'mode' => 'upload', 'folder_id' => $foreign->id])->assertUnprocessable();
        $this->assertSame(1, Song::count());
    }

    public function test_bulk_actions_skip_what_does_not_apply(): void
    {
        Queue::fake();
        $none = Song::factory()->for($this->user)->create(['status' => Song::STATUS_NONE]);
        $ready = Song::factory()->for($this->user)->ready()->create();
        $busy = Song::factory()->for($this->user)->create(['status' => Song::STATUS_PROCESSING, 'heartbeat_at' => now()]);

        $this->actingAs($this->user)->postJson('/songs/bulk', ['action' => 'separate', 'song_ids' => [$none->id, $ready->id]])
            ->assertOk()->assertJsonPath('done', [$none->id])->assertJsonPath('skipped', 1);
        Queue::assertPushed(SeparateSong::class, 1);

        $this->actingAs($this->user)->postJson('/songs/bulk', ['action' => 'chords', 'song_ids' => [$ready->id]])->assertJsonPath('done', [$ready->id]);
        Queue::assertPushed(AnalyzeChords::class, 1);

        $this->actingAs($this->user)->postJson('/songs/bulk', ['action' => 'delete', 'song_ids' => [$ready->id, $busy->id]])
            ->assertJsonPath('done', [$ready->id])->assertJsonPath('skipped', 1);
        $this->assertSoftDeleted($ready);

        $this->actingAs($this->user)->postJson('/songs/bulk', ['action' => 'delete', 'song_ids' => [Song::factory()->create()->id]])->assertForbidden();
    }

    public function test_deleted_songs_can_be_restored_and_requeued(): void
    {
        Queue::fake();
        $song = Song::factory()->for($this->user)->create(['status' => Song::STATUS_PENDING]);
        $foreign = Song::factory()->create();
        $foreign->delete();

        $this->actingAs($this->user)->deleteJson("/songs/{$song->id}")->assertOk();
        $this->assertSoftDeleted($song);

        $this->actingAs($this->user)->postJson('/songs/restore', ['song_ids' => [$song->id, $foreign->id]])
            ->assertOk()->assertJsonPath('restored', [$song->id]);
        $this->assertFalse($song->fresh()->trashed());
        $this->assertTrue($foreign->fresh()->trashed()); // nunca ajenas
        Queue::assertPushed(SeparateSong::class, 1); // vuelve a la cola
    }

    public function test_mixer_tracks_can_be_renamed_keeping_their_type(): void
    {
        $song = Song::factory()->for($this->user)->ready()->create();
        $track = $song->tracks()->create(['stem' => 'guitar', 'file_name' => 'guitar.flac', 'size' => 1, 'position' => 3]);

        $this->actingAs(User::factory()->create())->patchJson("/songs/{$song->id}/tracks/{$track->id}", ['label' => 'X'])->assertForbidden();
        $this->actingAs($this->user)->patchJson("/songs/{$song->id}/tracks/{$track->id}", ['label' => 'Guitarra Satriani'])
            ->assertOk()->assertJsonPath('label', 'Guitarra Satriani')->assertJsonPath('default_label', 'Guitarra');
        $this->assertSame('guitar', $track->fresh()->stem);
        $this->assertSame('Guitarra Satriani', $track->fresh()->label());

        // Vacío = vuelve a su nombre de tipo.
        $this->actingAs($this->user)->patchJson("/songs/{$song->id}/tracks/{$track->id}", ['label' => ''])->assertJsonPath('label', 'Guitarra');
    }
}
