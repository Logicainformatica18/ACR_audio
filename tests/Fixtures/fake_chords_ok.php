<?php

// Motor de acordes FALSO para los tests: imprime los mismos eventos JSON que
// tools/acordes/acordes.py, sin Python ni GPU. Recibe: pistas... --modelo X --modelos-dir Y
$events = [
    ['tipo' => 'progreso', 'pct' => 1],
    ['tipo' => 'acorde', 'inicio' => 0.0, 'fin' => 2.0, 'acorde' => 'N', 'confianza' => 0.97],
    ['tipo' => 'acorde', 'inicio' => 2.0, 'fin' => 6.0, 'acorde' => 'Am', 'confianza' => 0.88],
    ['tipo' => 'progreso', 'pct' => 50],
    ['tipo' => 'tonalidad', 'valor' => 'A menor'],
    ['tipo' => 'acorde', 'inicio' => 6.0, 'fin' => 10.0, 'acorde' => 'F', 'confianza' => 0.9],
    ['tipo' => 'acorde', 'inicio' => 10.0, 'fin' => 12.5, 'acorde' => 'G7', 'confianza' => 0.61],
    ['tipo' => 'progreso', 'pct' => 100],
    ['tipo' => 'fin'],
];
fwrite(STDERR, "[acordes] modelo falso\n");
$files = array_slice($argv, 1, array_search('--modelo', $argv) - 1);
echo json_encode(['tipo' => 'pistas', 'n' => count($files)])."\n"; // evento desconocido: se ignora
// Una línea partida en dos escrituras, como puede llegar por la tubería.
$first = json_encode(array_shift($events))."\n";
echo substr($first, 0, 10);
flush();
usleep(20000);
echo substr($first, 10);
foreach ($events as $e) {
    echo json_encode($e)."\n";
}
