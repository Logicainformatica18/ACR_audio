<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Acordes detectados en una canción (o corregidos a mano por el usuario).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('chords', function (Blueprint $table) {
            $table->id();
            $table->foreignId('song_id')->constrained()->cascadeOnDelete();
            $table->decimal('start_seconds', 10, 3);
            $table->decimal('end_seconds', 10, 3);
            $table->string('chord', 16);               // notación de guitarrista: Bm, F#m7, N...
            $table->decimal('confidence', 4, 3)->nullable(); // 0 a 1 (null si lo escribió el usuario)
            $table->boolean('edited')->default(false);  // corregido a mano: se conserva al volver a analizar
            $table->timestamps();

            $table->index(['song_id', 'start_seconds']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('chords');
    }
};
