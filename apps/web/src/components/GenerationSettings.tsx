import type { AvailableModel, CreationKind } from '@hiveflow/shared';

export function GenerationSettings({
  kind,
  params,
  model,
  onChange,
  hasStartImage,
}: {
  kind: CreationKind;
  params: Record<string, unknown>;
  model?: AvailableModel;
  onChange: (patch: Record<string, unknown>) => void;
  hasStartImage: boolean;
}) {
  const capabilities = model?.capabilities;
  function select(
    key: string,
    label: string,
    options: readonly (string | number)[],
    disabled = false,
  ) {
    const value = params[key] as string | number;
    return (
      <label key={key}>
        {label}
        <select
          aria-label={label}
          value={value}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              [key]:
                typeof value === 'number'
                  ? Number(event.target.value)
                  : event.target.value,
            })
          }
        >
          {[...new Set([value, ...options])].map((option) => (
            <option
              key={option}
              value={option}
              disabled={!options.includes(option)}
            >
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <div className="creation-settings">
      {kind !== 'audio' && (
        <>
          {select(
            'aspectRatio',
            'Aspect ratio',
            capabilities?.aspectRatios ?? [String(params.aspectRatio)],
            kind === 'video' &&
              hasStartImage &&
              capabilities?.imageToVideoRatio === 'adaptive',
          )}
          {select(
            'resolution',
            'Resolution',
            capabilities?.resolutions ?? [String(params.resolution)],
            kind === 'image' && !capabilities?.resolutions?.length,
          )}
        </>
      )}
      {kind === 'image' &&
        select(
          'count',
          'Image count',
          Array.from(
            { length: Math.min(4, capabilities?.maxCount ?? 4) },
            (_, i) => i + 1,
          ),
        )}
      {kind === 'video' && (
        <>
          {select(
            'duration',
            'Duration (seconds)',
            capabilities?.durations ?? [Number(params.duration)],
          )}
          <label className="creation-checkbox">
            <input
              aria-label="Generate audio"
              type="checkbox"
              checked={
                capabilities?.audio === 'included' ||
                Boolean(params.generateAudio)
              }
              disabled={
                capabilities?.audio === 'included' ||
                !(
                  capabilities?.audio === 'toggle' ||
                  capabilities?.supportsAudio
                )
              }
              onChange={(event) =>
                onChange({ generateAudio: event.target.checked })
              }
            />
            Generate audio
            {capabilities?.audio === 'included' ? ' (included)' : ''}
          </label>
          {hasStartImage && capabilities?.imageToVideoRatio === 'adaptive' && (
            <p>Aspect ratio follows the start image.</p>
          )}
        </>
      )}
      {kind === 'audio' && (
        <>
          {select(
            'voice',
            'Voice',
            capabilities?.voices ?? [String(params.voice)],
          )}
          {select(
            'language',
            'Language',
            capabilities?.languages ?? [String(params.language)],
          )}
          {select(
            'speed',
            'Speed',
            capabilities?.speedValues ??
              Array.from(
                {
                  length:
                    Math.round(
                      ((capabilities?.speed?.max ?? 1.5) -
                        (capabilities?.speed?.min ?? 0.75)) /
                        0.05,
                    ) + 1,
                },
                (_, i) =>
                  Number(
                    ((capabilities?.speed?.min ?? 0.75) + i * 0.05).toFixed(2),
                  ),
              ),
            capabilities?.supportsSpeed === false,
          )}
        </>
      )}
    </div>
  );
}
