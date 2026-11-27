<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\Storage;

abstract class TestCase extends BaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        // Los tests no dependen de haber ejecutado "npm run build".
        $this->withoutVite();

        // NINGÚN test toca la carpeta real de audios: el disco "audio" siempre es
        // uno temporal (storage/framework/testing/disks/audio), vacío en cada test.
        // (Sin esto, borrar un usuario de prueba con id 1 borraba la carpeta real
        // del usuario 1 a través del evento User::deleting.)
        Storage::fake('audio');
    }
}
