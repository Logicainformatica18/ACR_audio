<?php

namespace Database\Factories;

use App\Models\Song;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Song>
 */
class SongFactory extends Factory
{
    protected $model = Song::class;

    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'title' => fake()->sentence(3),
            'original_name' => 'cancion.mp3',
            'original_ext' => 'mp3',
            'original_size' => 1024,
            'status' => Song::STATUS_PENDING,
            'queued_at' => now(),
        ];
    }

    public function ready(): static
    {
        return $this->state(fn () => [
            'status' => Song::STATUS_READY,
            'model' => 'htdemucs_6s.yaml',
            'duration' => 180.0,
            'started_at' => now()->subMinute(),
            'finished_at' => now(),
        ]);
    }
}
