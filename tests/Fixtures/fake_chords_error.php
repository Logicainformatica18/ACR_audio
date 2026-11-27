<?php

// Motor de acordes FALSO que falla a mitad del análisis.
echo json_encode(['tipo' => 'progreso', 'pct' => 10])."\n";
echo json_encode(['tipo' => 'acorde', 'inicio' => 0.0, 'fin' => 3.0, 'acorde' => 'C', 'confianza' => 0.8])."\n";
echo json_encode(['tipo' => 'error', 'mensaje' => 'RuntimeError: CUDA out of memory'])."\n";
exit(1);
