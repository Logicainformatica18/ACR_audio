<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password;

use function Laravel\Prompts\password;
use function Laravel\Prompts\text;

/**
 * Crea un usuario de ACR Audio (el registro público está desactivado).
 *
 *   php artisan usuario:crear                       (pregunta los datos)
 *   php artisan usuario:crear --nombre="Ana" --email=ana@acr.test --generar
 */
class CrearUsuario extends Command
{
    protected $signature = 'usuario:crear
        {--nombre= : Nombre visible}
        {--email= : Correo con el que iniciará sesión}
        {--password= : Contraseña (si no se indica, se pregunta)}
        {--generar : Genera una contraseña segura al azar y la muestra una sola vez}';

    protected $description = 'Crea un usuario que puede iniciar sesión en ACR Audio';

    public function handle(): int
    {
        $name = $this->option('nombre') ?: text('Nombre', required: true);
        $email = $this->option('email') ?: text('Correo electrónico', required: true);

        $generated = false;
        if ($this->option('generar')) {
            $plain = Str::password(20, symbols: false);
            $generated = true;
        } else {
            $plain = $this->option('password') ?: password('Contraseña (mínimo 12 caracteres)', required: true);
        }

        $validator = Validator::make(
            ['name' => $name, 'email' => $email, 'password' => $plain],
            [
                'name' => ['required', 'string', 'max:255'],
                'email' => ['required', 'string', 'lowercase', 'email', 'max:255', 'unique:users,email'],
                'password' => ['required', Password::min(12)->letters()->numbers()],
            ],
        );

        if ($validator->fails()) {
            foreach ($validator->errors()->all() as $error) {
                $this->error($error);
            }

            return self::FAILURE;
        }

        $user = User::create(['name' => $name, 'email' => $email, 'password' => $plain]);
        $user->forceFill(['email_verified_at' => now()])->save();
        $user->preferences();

        $this->info("Usuario creado: {$user->email} (id {$user->id})");

        if ($generated) {
            $this->newLine();
            $this->warn('Contraseña generada (se muestra solo esta vez, guárdala ahora):');
            $this->line("  {$plain}");
            $this->newLine();
            $this->line('Cámbiala después desde Configuración > Contraseña.');
        }

        return self::SUCCESS;
    }
}
