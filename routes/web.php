<?php

use App\Http\Controllers\ChordController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\FolderController;
use App\Http\Controllers\MixerController;
use App\Http\Controllers\MixExportController;
use App\Http\Controllers\SongController;
use App\Http\Controllers\YoutubeController;
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
    Route::post('songs/{song}/cancel', [SongController::class, 'cancel'])->whereNumber('song')->name('songs.cancel');
    // Separar una canción subida con "Solo subir" (misma acción que reintentar).
    Route::post('songs/{song}/separate', [SongController::class, 'retry'])->whereNumber('song')->name('songs.separate');
    Route::post('songs/chords/analyze-missing', [SongController::class, 'analyzeMissing'])->name('songs.chords.missing');

    Route::patch('songs/{song}', [SongController::class, 'update'])->whereNumber('song')->name('songs.update');
    Route::delete('songs/{song}', [SongController::class, 'destroy'])->whereNumber('song')->name('songs.destroy');
    Route::post('songs/restore', [SongController::class, 'restore'])->name('songs.restore');
    Route::post('songs/move', [SongController::class, 'move'])->name('songs.move');
    Route::post('songs/bulk', [SongController::class, 'bulk'])->name('songs.bulk');

    // Exportar mezcla y mezclas guardadas
    Route::post('songs/{song}/exports', [MixExportController::class, 'store'])->whereNumber('song')->name('songs.exports.store');
    Route::get('songs/{song}/exports/{export}/download', [MixExportController::class, 'download'])->whereNumber(['song', 'export'])->name('songs.exports.download');
    Route::delete('songs/{song}/exports/{export}', [MixExportController::class, 'destroy'])->whereNumber(['song', 'export'])->name('songs.exports.destroy');
    Route::post('songs/{song}/mixes', [MixExportController::class, 'storeMix'])->whereNumber('song')->name('songs.mixes.store');
    Route::patch('songs/{song}/mixes/{mix}', [MixExportController::class, 'updateMix'])->whereNumber(['song', 'mix'])->name('songs.mixes.update');
    Route::delete('songs/{song}/mixes/{mix}', [MixExportController::class, 'destroyMix'])->whereNumber(['song', 'mix'])->name('songs.mixes.destroy');

    // YouTube
    Route::post('youtube/inspect', [YoutubeController::class, 'inspect'])->middleware('throttle:30,1')->name('youtube.inspect');
    Route::post('youtube/import', [YoutubeController::class, 'import'])->name('youtube.import');
    Route::post('songs/{song}/download/cancel', [YoutubeController::class, 'cancel'])->whereNumber('song')->name('songs.download.cancel');
    Route::post('songs/{song}/download/retry', [YoutubeController::class, 'retry'])->whereNumber('song')->name('songs.download.retry');
    Route::get('youtube/version', [YoutubeController::class, 'version'])->name('youtube.version');
    Route::post('youtube/update', [YoutubeController::class, 'update'])->middleware('throttle:5,1')->name('youtube.update');

    // Carpetas
    Route::get('folders', [FolderController::class, 'index'])->name('folders.index');
    Route::post('folders', [FolderController::class, 'store'])->name('folders.store');
    Route::patch('folders/{folder}', [FolderController::class, 'update'])->whereNumber('folder')->name('folders.update');
    Route::post('folders/{folder}/move', [FolderController::class, 'move'])->whereNumber('folder')->name('folders.move');
    Route::delete('folders/{folder}', [FolderController::class, 'destroy'])->whereNumber('folder')->name('folders.destroy');
    Route::post('folders/{folder}/restore', [FolderController::class, 'restore'])->whereNumber('folder')->name('folders.restore');

    // Mezclador
    Route::get('songs/{song}', [MixerController::class, 'show'])->whereNumber('song')->name('songs.show');
    Route::put('songs/{song}/mixer', [MixerController::class, 'save'])->whereNumber('song')->name('songs.mixer.save');
    Route::get('songs/{song}/tracks/{track}/audio', [MixerController::class, 'audio'])
        ->whereNumber(['song', 'track'])
        ->scopeBindings()
        ->name('songs.tracks.audio');
    Route::get('songs/{song}/download', [MixerController::class, 'downloadOriginal'])->whereNumber('song')->name('songs.download');
    Route::patch('songs/{song}/tracks/{track}', [MixerController::class, 'renameTrack'])
        ->whereNumber(['song', 'track'])
        ->scopeBindings()
        ->name('songs.tracks.rename');

    // Acordes
    Route::get('songs/{song}/chords', [ChordController::class, 'index'])->whereNumber('song')->name('songs.chords.index');
    Route::post('songs/{song}/chords/analyze', [ChordController::class, 'analyze'])->whereNumber('song')->name('songs.chords.analyze');
    Route::post('songs/{song}/chords/cancel', [ChordController::class, 'cancel'])->whereNumber('song')->name('songs.chords.cancel');
    Route::patch('songs/{song}/chords/{chord}', [ChordController::class, 'update'])
        ->whereNumber(['song', 'chord'])
        ->scopeBindings()
        ->name('songs.chords.update');
});

require __DIR__.'/settings.php';
require __DIR__.'/auth.php';
