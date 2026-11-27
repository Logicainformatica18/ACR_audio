<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Canciones: un audio subido por un usuario y su estado de separación.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('songs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('title', 200);                 // nombre visible (editable)
            $table->string('original_name', 255);         // nombre del archivo tal como se subió (solo informativo)
            $table->string('original_ext', 10);           // extensión validada: mp3, wav, flac, m4a, ogg
            $table->unsignedBigInteger('original_size');  // bytes
            $table->float('duration')->nullable();        // segundos (se rellena al separar)
            // pending = en cola, processing = separando, ready = lista, failed = error
            $table->string('status', 20)->default('pending');
            $table->string('model', 100)->nullable();     // modelo usado para separar
            $table->longText('log')->nullable();          // salida de audio-separator (para ver errores)
            $table->string('error', 500)->nullable();     // resumen del error para la interfaz
            $table->timestamp('queued_at')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'status']);
            $table->index(['user_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('songs');
    }
};
