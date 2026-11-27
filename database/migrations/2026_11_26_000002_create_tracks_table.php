<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Pistas: cada archivo separado de una canción (voz, batería, bajo...).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tracks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('song_id')->constrained()->cascadeOnDelete();
            $table->string('stem', 30);                   // vocals, drums, bass, guitar, piano, other...
            $table->string('file_name', 60);              // nombre generado por el servidor: vocals.flac
            $table->unsignedBigInteger('size')->default(0);
            $table->unsignedTinyInteger('position')->default(0); // orden en el mezclador
            $table->timestamps();

            $table->unique(['song_id', 'stem']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tracks');
    }
};
