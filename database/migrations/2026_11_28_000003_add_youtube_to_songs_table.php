<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Canciones que vienen de YouTube: su enlace y metadatos, y la descarga como
 * tercer proceso independiente (cola "descargas"), con su estado y progreso.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('songs', function (Blueprint $table) {
            $table->string('youtube_id', 11)->nullable()->after('original_size');
            $table->string('source_url', 255)->nullable()->after('youtube_id');      // https://www.youtube.com/watch?v=ID
            $table->string('channel', 200)->nullable()->after('source_url');
            $table->string('thumbnail_url', 500)->nullable()->after('channel');
            // null = subida desde el PC; pending, processing, ready, failed, canceled
            $table->string('download_status', 16)->nullable()->after('thumbnail_url');
            $table->unsignedTinyInteger('download_progress')->default(0)->after('download_status');
            $table->string('download_error', 500)->nullable()->after('download_progress');
            $table->unsignedInteger('download_pid')->nullable()->after('download_error');
            $table->timestamp('download_heartbeat_at')->nullable()->after('download_pid');
            // Qué hacer al terminar la descarga (elegido en el modal de subida)
            $table->boolean('download_then_separate')->default(false)->after('download_heartbeat_at');
            $table->boolean('download_then_chords')->default(false)->after('download_then_separate');

            $table->index(['user_id', 'youtube_id']);
        });
    }

    public function down(): void
    {
        Schema::table('songs', function (Blueprint $table) {
            $table->dropIndex(['user_id', 'youtube_id']);
            $table->dropColumn([
                'youtube_id', 'source_url', 'channel', 'thumbnail_url', 'download_status', 'download_progress',
                'download_error', 'download_pid', 'download_heartbeat_at', 'download_then_separate', 'download_then_chords',
            ]);
        });
    }
};
