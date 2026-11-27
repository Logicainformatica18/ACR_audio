<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Preferencias de cada usuario (una fila por usuario).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('user_preferences', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->unique()->constrained()->cascadeOnDelete();
            $table->float('master_volume')->default(0.9);        // volumen general del mezclador (0 a 1)
            $table->string('separation_model', 100)->nullable(); // null = el del .env
            $table->string('songs_sort', 20)->default('recent'); // recent | title | status
            $table->boolean('keyboard_shortcuts')->default(true); // atajos de teclado en el mezclador
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_preferences');
    }
};
