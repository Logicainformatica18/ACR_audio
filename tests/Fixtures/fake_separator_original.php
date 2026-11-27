<?php

// "Archivo original" de una canción falsa: en el test se usa PHP como si fuera
// audio-separator, así que este archivo se EJECUTA y crea las pistas en --output_dir.
$out = $argv[array_search('--output_dir', $argv) + 1];
foreach (['Vocals', 'Drums', 'Bass', 'Guitar', 'Piano', 'Other'] as $stem) {
    file_put_contents($out.DIRECTORY_SEPARATOR.'original_('.$stem.')_htdemucs_6s.flac', 'falso');
}
echo " 50%|#####     | 1/2\n100%|##########| 2/2\n";
