<?php

use App\Http\Controllers\ChordController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\MixerController;
use App\Http\Controllers\SongController;
use Illuminate\Support\Facades\Route;

Route::redirect('/', '/songs')->name('home');

Route::middleware('auth')->group(function () {
    Route::get('dashboard', DashboardController::class)->name('dashboard');

    // Canciones
    Route::get('songs', [SongController::class, 'index'])->name('songs.index');
    Route::post('songs', [SongController::class, 'store'])->name('songs.store');
    Route::get('songs/status', [SongController::class, 'status'])->name('songs.status');
    Route::get('songs/{song}/log', [SongController::class, 'log'])->whereNumber('song')->name('songs.log');
    Route::post('songs/{song}/retry', [SongController::class, 'retry'])->whereNumber('song')->name('songs.retry');

    Route::patch('songs/{song}', [SongController::class, 'update'])->whereNumber('song')->name('songs.update');
    Route::delete('songs/{song}', [SongController::class, 'destroy'])->whereNumber('song')->name('songs.destroy');

    // Mezclador
    Route::get('songs/{song}', [MixerController::class, 'show'])->whereNumber('song')->name('songs.show');
    Route::put('songs/{song}/mixer', [MixerController::class, 'save'])->whereNumber('song')->name('songs.mixer.save');
    Route::get('songs/{song}/tracks/{track}/audio', [MixerController::class, 'audio'])
        ->whereNumber(['song', 'track'])
        ->scopeBindings()
        ->name('songs.tracks.audio');

    // Acordes
    Route::get('songs/{song}/chords', [ChordController::class, 'index'])->whereNumber('song')->name('songs.chords.index');
    Route::post('songs/{song}/chords/analyze', [ChordController::class, 'analyze'])->whereNumber('song')->name('songs.chords.analyze');
    Route::patch('songs/{song}/chords/{chord}', [ChordController::class, 'update'])
        ->whereNumber(['song', 'chord'])
        ->scopeBindings()
        ->name('songs.chords.update');
});

require __DIR__.'/settings.php';
require __DIR__.'/auth.php';
