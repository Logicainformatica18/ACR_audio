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
    Route::get('songs/status', [SongController::class, 'status'])->name('songs.status');
    Route::get('songs/{song}/log', [SongController::class, 'log'])->whereNumber('song')->name('songs.log');
    Route::post('songs/{song}/retry', [SongController::class, 'retry'])->whereNumber('song')->name('songs.retry');
});

require __DIR__.'/settings.php';
require __DIR__.'/auth.php';
