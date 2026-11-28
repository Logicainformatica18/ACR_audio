<?php

// Motor de YouTube FALSO para los tests: imprime los mismos eventos JSON que
// tools/youtube/youtube.py, sin internet. Uso igual que el real:
//   info video ID | info lista ID | descargar ID CARPETA | version
$a = array_slice($argv, 1);
$out = fn (array $e) => print json_encode($e, JSON_UNESCAPED_UNICODE)."\n";

if (($a[0] ?? '') === 'version') {
    $out(['tipo' => 'version', 'yt_dlp' => '2099.01.01', 'deno' => '2.9.8']);
    exit(0);
}
if (($a[0] ?? '') === 'info' && ($a[1] ?? '') === 'video') {
    if ($a[2] === 'PRIVADO0000') {
        $out(['tipo' => 'error', 'codigo' => 'privado', 'mensaje' => 'El video es privado: solo su autor puede verlo.']);
        exit(1);
    }
    $out(['tipo' => 'info', 'clase' => 'video', 'id' => $a[2], 'titulo' => 'Tema de prueba', 'canal' => 'Canal', 'duracion' => 61,
        'miniatura' => 'https://i.ytimg.com/vi/'.$a[2].'/hqdefault.jpg', 'url' => 'https://www.youtube.com/watch?v='.$a[2]]);
    exit(0);
}
if (($a[0] ?? '') === 'info' && ($a[1] ?? '') === 'lista') {
    $entries = [];
    foreach (['aaaaaaaaaa1', 'aaaaaaaaaa2', 'aaaaaaaaaa3'] as $i => $id) {
        $entries[] = ['id' => $id, 'titulo' => 'Pista '.($i + 1), 'duracion' => 30 + $i, 'miniatura' => 'https://evil.example/x.jpg', 'disponible' => true];
    }
    $out(['tipo' => 'info', 'clase' => 'lista', 'id' => $a[2], 'titulo' => 'Mi lista', 'entradas' => $entries]);
    exit(0);
}
if (($a[0] ?? '') === 'descargar') {
    if ($a[1] === 'ROTO0000000') {
        $out(['tipo' => 'progreso', 'pct' => 10, 'fase' => 'descargando']);
        $out(['tipo' => 'error', 'codigo' => 'desactualizado', 'mensaje' => 'yt-dlp parece desactualizado (YouTube cambió algo). Actualízalo en Configuración.']);
        exit(1);
    }
    $out(['tipo' => 'progreso', 'pct' => 0, 'fase' => 'preparando']);
    $out(['tipo' => 'progreso', 'pct' => 50, 'fase' => 'descargando']);
    file_put_contents($a[2].DIRECTORY_SEPARATOR.'original.flac', str_repeat('x', 1234));
    $out(['tipo' => 'progreso', 'pct' => 100, 'fase' => 'listo']);
    $out(['tipo' => 'fin', 'archivo' => 'original.flac', 'titulo' => 'Tema de prueba', 'canal' => 'Canal', 'duracion' => 61,
        'miniatura' => 'https://i.ytimg.com/vi/'.$a[1].'/hqdefault.jpg', 'url' => 'https://www.youtube.com/watch?v='.$a[1]]);
    exit(0);
}
$out(['tipo' => 'error', 'codigo' => 'enlace', 'mensaje' => 'Parámetros no válidos.']);
exit(2);
