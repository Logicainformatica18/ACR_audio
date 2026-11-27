<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Silencios programados: apagan una pista entre dos momentos de la canción.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('scheduled_silences', function (Blueprint $table) {
            $table->id();
            $table->foreignId('track_id')->constrained()->cascadeOnDelete();
            $table->decimal('start_seconds', 10, 3);
            $table->decimal('end_seconds', 10, 3);
            $table->timestamps();

            $table->index(['track_id', 'start_seconds']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('scheduled_silences');
    }
};
