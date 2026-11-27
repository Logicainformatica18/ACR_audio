<?php

namespace Tests\Feature\Auth;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * El registro público está desactivado: solo se crean usuarios con usuario:crear.
 */
class RegistrationTest extends TestCase
{
    use RefreshDatabase;

    public function test_registration_screen_does_not_exist(): void
    {
        $this->get('/register')->assertNotFound();
    }

    public function test_users_cannot_register_by_post(): void
    {
        $this->post('/register', [
            'name' => 'Intruso',
            'email' => 'intruso@example.com',
            'password' => 'password123456',
            'password_confirmation' => 'password123456',
        ])->assertNotFound();

        $this->assertGuest();
        $this->assertDatabaseMissing('users', ['email' => 'intruso@example.com']);
    }

    public function test_command_creates_user_with_generated_password(): void
    {
        $this->artisan('usuario:crear', ['--nombre' => 'Admin', '--email' => 'admin@acr.test', '--generar' => true])
            ->expectsOutputToContain('Usuario creado: admin@acr.test')
            ->assertSuccessful();

        $user = User::where('email', 'admin@acr.test')->firstOrFail();
        $this->assertNotNull($user->email_verified_at);
        $this->assertNotNull($user->preference);
    }

    public function test_command_rejects_duplicate_email_and_weak_password(): void
    {
        User::factory()->create(['email' => 'ya@acr.test']);

        $this->artisan('usuario:crear', ['--nombre' => 'X', '--email' => 'ya@acr.test', '--password' => 'abcdefgh1234'])
            ->assertFailed();

        $this->artisan('usuario:crear', ['--nombre' => 'X', '--email' => 'nuevo@acr.test', '--password' => 'corta'])
            ->assertFailed();

        $this->assertDatabaseMissing('users', ['email' => 'nuevo@acr.test']);
    }
}
