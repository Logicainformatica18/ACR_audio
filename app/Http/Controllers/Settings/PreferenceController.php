<?php

namespace App\Http\Controllers\Settings;

use App\Http\Controllers\Controller;
use App\Models\UserPreference;
use App\Services\Separator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;

/** Preferencias del usuario: modelo de separación, orden de la lista, atajos y volumen general. */
class PreferenceController extends Controller
{
    public function edit(Request $request, Separator $separator): Response
    {
        $prefs = $request->user()->preferences();

        return Inertia::render('settings/preferences', [
            'preferences' => [
                'separation_model' => $prefs->effectiveModel(),
                'songs_sort' => $prefs->songs_sort,
                'keyboard_shortcuts' => $prefs->keyboard_shortcuts,
                'master_volume' => $prefs->master_volume,
                'chords_auto' => $prefs->chords_auto,
                'upload_mode' => $prefs->upload_mode ?? 'ask',
            ],
            'models' => collect($separator->availableModels())
                ->map(fn ($label, $file) => ['value' => $file, 'label' => $label])
                ->values(),
            'defaultModel' => config('audio.separator.model'),
        ]);
    }

    public function update(Request $request, Separator $separator): RedirectResponse
    {
        $data = $request->validate([
            'separation_model' => ['required', 'string', Rule::in(array_keys($separator->availableModels()))],
            'songs_sort' => ['required', Rule::in(UserPreference::SORTS)],
            'keyboard_shortcuts' => ['required', 'boolean'],
            'master_volume' => ['required', 'numeric', 'between:0,1'],
            'chords_auto' => ['required', 'boolean'],
            // "ask" = mostrar el modal en cada subida
            'upload_mode' => ['required', Rule::in(['ask', ...UserPreference::UPLOAD_MODES])],
        ], [
            'separation_model.in' => 'Ese modelo no está descargado en la carpeta de modelos.',
        ]);
        $data['upload_mode'] = $data['upload_mode'] === 'ask' ? null : $data['upload_mode'];

        $request->user()->preferences()->update($data);

        return back()->with('success', 'Preferencias guardadas.');
    }

    /**
     * Desde la página de Canciones: interruptor general de acordes y/o modo de
     * subida recordado ("Recordar y no volver a preguntar"). Responde JSON.
     */
    public function updateUpload(Request $request): JsonResponse
    {
        $data = $request->validate([
            'chords_auto' => ['sometimes', 'boolean'],
            'upload_mode' => ['sometimes', 'nullable', Rule::in(UserPreference::UPLOAD_MODES)],
        ]);
        $prefs = $request->user()->preferences();
        $prefs->update($data);

        return response()->json(['chords_auto' => $prefs->chords_auto, 'upload_mode' => $prefs->upload_mode]);
    }

    /** Orden de la lista elegido desde la propia página de Canciones. */
    public function updateSort(Request $request): RedirectResponse
    {
        $data = $request->validate(['songs_sort' => ['required', Rule::in(UserPreference::SORTS)]]);
        $request->user()->preferences()->update($data);

        return back();
    }
}
