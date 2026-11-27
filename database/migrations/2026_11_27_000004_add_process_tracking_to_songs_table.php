<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Seguimiento de los procesos externos (separación y acordes) para poder
 * cancelarlos y detectar trabajos colgados o con el worker muerto.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('songs', function (Blueprint $table) {
            // PID del proceso de audio-separator (o de su envoltorio cmd) mientras separa
            $table->unsignedInteger('process_pid')->nullable()->after('finished_at');
            // El job lo actualiza cada 2 s mientras separa: si deja de hacerlo, el worker murió
            $table->timestamp('heartbeat_at')->nullable()->after('process_pid');
            $table->unsignedInteger('chords_pid')->nullable()->after('chords_finished_at');
            $table->timestamp('chords_heartbeat_at')->nullable()->after('chords_pid');
        });
    }

    public function down(): void
    {
        Schema::table('songs', function (Blueprint $table) {
            $table->dropColumn(['process_pid', 'heartbeat_at', 'chords_pid', 'chords_heartbeat_at']);
        });
    }
};
