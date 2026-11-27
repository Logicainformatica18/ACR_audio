<?php

use App\Http\Controllers\SongController;
use Illuminate\Support\Facades\Route;
use Inertia\Inertia;

Route::redirect('/', '/songs')->name('home');

Route::middleware('auth')->group(function () {
    Route::get('dashboard', fn () => Inertia::render('dashboard'))->name('dashboard');

    // Canciones
    Route::get('songs', [SongController::class, 'index'])->name('songs.index');
    Route::post('songs', [SongController::class, 'store'])->name('songs.store');
});

require __DIR__.'/settings.php';
require __DIR__.'/auth.php';
