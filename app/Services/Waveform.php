<?php

namespace App\Services;

use Symfony\Component\Process\Process;
use Throwable;

/**
 * Forma de onda precalculada de una pista: 4000 columnas con el pico de
 * amplitud de cada una (0 a 255), en base64. El mezclador la dibuja sin tener
 * que recorrer el audio decodificado.
 *
 * ffmpeg decodifica la pista a 8000 Hz (suficiente para el dibujo) con sus
 * canales originales (convertir mono a estéreo bajaría 3 dB) y se va leyendo
 * por trozos, sin cargar el audio entero en memoria. Las columnas se reparten
 * en proporción al total, así que el número de canales no cambia el reparto.
 */
class Waveform
{
    public const COLUMNS = 4000;

    private const RATE = 8000;

    /** Valores por bloque intermedio (160 = 10 ms en estéreo, 20 ms en mono). */
    private const BLOCK = 160;

    public static function compute(string $file, int $columns = self::COLUMNS): ?string
    {
        $process = new Process([
            'ffmpeg', '-v', 'error', '-nostdin', '-i', $file,
            '-ar', (string) self::RATE, '-f', 's16le', '-acodec', 'pcm_s16le', '-',
        ]);
        $process->setTimeout(300);

        $blocks = [];      // pico de cada bloque de 10 ms
        $current = 0;      // pico del bloque en curso
        $count = 0;        // valores leídos del bloque en curso
        $perBlock = self::BLOCK;
        $rest = '';

        try {
            $process->run(function (string $type, string $data) use (&$blocks, &$current, &$count, $perBlock, &$rest) {
                if ($type !== Process::OUT) {
                    return;
                }
                $data = $rest.$data;
                $usable = strlen($data) - (strlen($data) % 2);
                $rest = substr($data, $usable);
                if ($usable === 0) {
                    return;
                }
                // De 64 KB en 64 KB, para no crear arrays enormes si llega mucho de golpe.
                for ($off = 0; $off < $usable; $off += 65536) {
                    foreach (unpack('s*', substr($data, $off, min(65536, $usable - $off))) as $v) {
                        if ($v < 0) {
                            $v = -$v;
                        }
                        if ($v > $current) {
                            $current = $v;
                        }
                        if (++$count === $perBlock) {
                            $blocks[] = $current;
                            $current = 0;
                            $count = 0;
                        }
                    }
                }
            });
        } catch (Throwable) {
            return null;
        }

        if ($count > 0) {
            $blocks[] = $current;
        }
        if (! $process->isSuccessful() || $blocks === []) {
            return null;
        }

        $n = count($blocks);
        $bytes = '';
        for ($i = 0; $i < $columns; $i++) {
            $a = intdiv($i * $n, $columns);
            $b = max($a + 1, intdiv(($i + 1) * $n, $columns));
            $max = 0;
            for ($j = $a; $j < $b && $j < $n; $j++) {
                if ($blocks[$j] > $max) {
                    $max = $blocks[$j];
                }
            }
            $bytes .= chr(min(255, (int) round($max / 32768 * 255)));
        }

        return base64_encode($bytes);
    }
}
