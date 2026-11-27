<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Estado del análisis de acordes de cada canción.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('songs', function (Blueprint $table) {
            // null = nunca analizada; pending, processing, ready, failed
            $table->string('chords_status', 16)->nullable()->after('finished_at');
            $table->unsignedTinyInteger('chords_progress')->default(0)->after('chords_status');
            $table->string('chords_model', 32)->nullable()->after('chords_progress');
            $table->string('chords_key', 32)->nullable()->after('chords_model'); // tonalidad: "B menor"
            $table->string('chords_error', 500)->nullable()->after('chords_key');
            $table->timestamp('chords_started_at')->nullable()->after('chords_error');
            $table->timestamp('chords_finished_at')->nullable()->after('chords_started_at');
        });
    }

    public function down(): void
    {
        Schema::table('songs', function (Blueprint $table) {
            $table->dropColumn([
                'chords_status', 'chords_progress', 'chords_model', 'chords_key',
                'chords_error', 'chords_started_at', 'chords_finished_at',
            ]);
        });
    }
};
