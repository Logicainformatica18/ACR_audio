<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Carpetas para organizar las canciones (hasta 3 niveles), nombres propios
 * para las pistas y papelera breve para poder deshacer un borrado.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('folders', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            // Al borrar una carpeta, la app mueve antes su contenido a la superior.
            $table->foreignId('parent_id')->nullable()->constrained('folders')->nullOnDelete();
            $table->string('name', 100);
            $table->string('color', 16)->nullable();   // una de las 8 claves de la paleta
            $table->string('note', 255)->nullable();   // "afinación Eb"
            $table->unsignedInteger('position')->default(0); // orden entre hermanas
            $table->softDeletes();                      // para "Deshacer" tras borrar
            $table->timestamps();

            $table->index(['user_id', 'parent_id', 'position']);
        });

        Schema::table('songs', function (Blueprint $table) {
            $table->foreignId('folder_id')->nullable()->after('user_id')->constrained('folders')->nullOnDelete();
            $table->softDeletes(); // borrar → papelera unos segundos (Deshacer) → borrado definitivo
        });

        Schema::table('tracks', function (Blueprint $table) {
            // Nombre puesto por el usuario ("Guitarra Satriani"); el tipo sigue en stem.
            $table->string('label', 100)->nullable()->after('stem');
        });
    }

    public function down(): void
    {
        Schema::table('tracks', function (Blueprint $table) {
            $table->dropColumn('label');
        });
        Schema::table('songs', function (Blueprint $table) {
            $table->dropConstrainedForeignId('folder_id');
            $table->dropSoftDeletes();
        });
        Schema::dropIfExists('folders');
    }
};
