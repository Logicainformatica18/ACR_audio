<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Forma de onda precalculada de cada pista (para no calcularla en el navegador).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tracks', function (Blueprint $table) {
            // 4000 valores de 0 a 255 en base64 (unos 5,3 KB por pista)
            $table->text('peaks')->nullable()->after('position');
        });
    }

    public function down(): void
    {
        Schema::table('tracks', function (Blueprint $table) {
            $table->dropColumn('peaks');
        });
    }
};
