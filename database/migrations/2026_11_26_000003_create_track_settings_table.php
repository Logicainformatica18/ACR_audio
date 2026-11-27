<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Ajustes de pista en el mezclador: volumen, mute y solo (uno por pista).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('track_settings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('track_id')->unique()->constrained()->cascadeOnDelete();
            $table->float('volume')->default(1);   // 0 a 1
            $table->boolean('muted')->default(false);
            $table->boolean('solo')->default(false);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('track_settings');
    }
};
