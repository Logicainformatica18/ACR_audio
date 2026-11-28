<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Subida flexible: separar es opcional y los acordes son un proceso aparte.
 *
 * - songs.status sigue siendo el estado de la SEPARACIÓN, con un valor nuevo:
 *   "none" (no solicitada: se subió con "Solo subir").
 * - songs.chords_source: sobre qué se detectaron los acordes ("original" o "stems").
 * - Cada canción tiene una pista "original" (tracks.stem = original) que apunta
 *   a su archivo original, así el mezclador la trata como cualquier otra pista.
 * - Preferencias: detectar acordes automáticamente y modo de subida recordado.
 *
 * Las canciones existentes ya están separadas: su estado no cambia y sus
 * acordes quedan como estén (marcados como detectados sobre las pistas).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('songs', function (Blueprint $table) {
            $table->string('chords_source', 16)->nullable()->after('chords_model');
        });

        Schema::table('user_preferences', function (Blueprint $table) {
            $table->boolean('chords_auto')->default(true)->after('keyboard_shortcuts');
            // null = preguntar en cada subida; "separate" o "upload" = recordado
            $table->string('upload_mode', 16)->nullable()->after('chords_auto');
        });

        DB::table('songs')->where('chords_status', 'ready')->update(['chords_source' => 'stems']);

        // Pista "Original" para cada canción existente (la forma de onda la calcula ondas:calcular).
        $now = now();
        foreach (DB::table('songs')->get(['id', 'original_ext', 'original_size']) as $song) {
            $exists = DB::table('tracks')->where('song_id', $song->id)->where('stem', 'original')->exists();
            if (! $exists) {
                DB::table('tracks')->insert([
                    'song_id' => $song->id,
                    'stem' => 'original',
                    'file_name' => 'original.'.$song->original_ext,
                    'size' => $song->original_size,
                    'position' => 100,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }
        }
    }

    public function down(): void
    {
        DB::table('tracks')->where('stem', 'original')->delete();
        Schema::table('user_preferences', function (Blueprint $table) {
            $table->dropColumn(['chords_auto', 'upload_mode']);
        });
        Schema::table('songs', function (Blueprint $table) {
            $table->dropColumn('chords_source');
        });
    }
};
