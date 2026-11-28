<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Mezclas guardadas (ajustes del mezclador con un nombre) y archivos de audio
 * exportados (guardados en la carpeta de audios para volver a descargarlos).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('mixes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('song_id')->constrained()->cascadeOnDelete();
            $table->string('name', 120);
            // {master, tracks:[{id, volume, muted, solo}], silences:[{track_id, start, end}],
            //  show_original, range:{start, end}|null}
            $table->json('settings');
            $table->timestamps();
        });

        Schema::create('mix_exports', function (Blueprint $table) {
            $table->id();
            $table->foreignId('song_id')->constrained()->cascadeOnDelete();
            $table->foreignId('mix_id')->nullable()->constrained('mixes')->nullOnDelete();
            $table->string('name', 200);          // nombre de descarga, sin extensión (solo para la cabecera)
            $table->string('format', 8);          // wav | flac | mp3
            $table->string('file_name', 40);      // generado por el servidor: {id}.{ext}
            $table->unsignedBigInteger('size')->default(0);
            $table->float('duration')->nullable();
            $table->float('range_start')->nullable();
            $table->float('range_end')->nullable();
            $table->float('gain_applied')->nullable(); // < 1 si se bajó el volumen para no saturar
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('mix_exports');
        Schema::dropIfExists('mixes');
    }
};
