import { useQuery } from '@tanstack/react-query';
import {
  availableModelSchema,
  nodeRegistry,
  selectModel,
  coerceParamsForModel,
  type NodeType,
  type NodeDef,
  type ModelKind,
} from '@hiveflow/shared';
import { request } from './spaces';
import { ModelPicker } from '../components/ModelPicker';
export function useModels(kind?: ModelKind) {
  return useQuery({
    queryKey: ['models', kind ?? 'all'],
    queryFn: async () =>
      availableModelSchema
        .array()
        .parse(await request(`/models${kind ? `?kind=${kind}` : ''}`)),
    staleTime: 5000,
    refetchInterval: 15000,
  });
}
export function ModelControls({
  type,
  params,
  onChange,
  onNotice,
  variant = 'select',
}: {
  type: NodeType;
  params: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
  onNotice: (notice: string) => void;
  variant?: 'select' | 'panel';
}) {
  const definition: NodeDef = nodeRegistry[type];
  const query = useModels(definition.modelKind);
  const entries = (query.data ?? []).filter(
    (model) => model.kind === definition.modelKind,
  );
  let warning: string | undefined;
  let selected;
  try {
    if (query.data && definition.modelKind)
      selected = selectModel(
        String(params.model ?? ''),
        definition.modelKind,
        entries,
      );
  } catch (error) {
    warning =
      variant === 'panel'
        ? 'Choose an available AI model to continue.'
        : (error as Error).message;
  }
  const providerCodes = [...new Set(entries.map((model) => model.provider))];
  const options =
    params.options && typeof params.options === 'object'
      ? (params.options as Record<string, unknown>)
      : {};
  function changeModel(id: string) {
    try {
      const resolved = selectModel(id, definition.modelKind!, query.data ?? []);
      const coerced = coerceParamsForModel(type, params, resolved);
      onChange({ ...coerced.params, model: id });
      onNotice(coerced.notices.join('. '));
      return true;
    } catch (error) {
      onNotice((error as Error).message);
      return false;
    }
  }
  return (
    <div className="model-controls nodrag nopan">
      {variant === 'panel' ? (
        <ModelPicker
          models={entries}
          selected={selected}
          kind={definition.modelKind}
          loading={query.isPending}
          onSelect={changeModel}
        />
      ) : (
        <select
          aria-label="Model"
          value={
            entries.some((model) => model.id === params.model)
              ? String(params.model)
              : ''
          }
          onChange={(event) => changeModel(event.target.value)}
        >
          <option value="" disabled>
            Choose a model
          </option>
          {providerCodes.map((provider) => (
            <optgroup key={provider} label={provider}>
              {entries
                .filter((model) => model.provider === provider)
                .map((model) => (
                  <option
                    key={model.id}
                    value={model.id}
                    disabled={!model.available}
                  >
                    {model.label}
                    {!model.available
                      ? ` — ${model.unavailableReason}`
                      : model.status === 'preview'
                        ? ' (preview)'
                        : model.status === 'deprecated'
                          ? ' (deprecated)'
                          : ''}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      )}
      {(warning || query.isError) && (
        <p className="model-warning" role="status">
          {warning ??
            'Model catalog unavailable; retry when the API is online.'}
        </p>
      )}
      {!!selected?.options.length && (
        <details>
          <summary>Advanced</summary>
          {selected.options.map((option) => (
            <label key={option.key}>
              {option.label}
              {option.type === 'select' ? (
                <select
                  aria-label={option.label}
                  value={String(options[option.key] ?? option.default)}
                  onChange={(event) =>
                    onChange({
                      options: { ...options, [option.key]: event.target.value },
                    })
                  }
                >
                  {option.choices?.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              ) : (
                <input
                  aria-label={option.label}
                  type={option.type === 'boolean' ? 'checkbox' : 'number'}
                  min={option.min}
                  max={option.max}
                  checked={
                    option.type === 'boolean'
                      ? Boolean(options[option.key] ?? option.default)
                      : undefined
                  }
                  value={
                    option.type === 'number'
                      ? Number(options[option.key] ?? option.default)
                      : undefined
                  }
                  onChange={(event) =>
                    onChange({
                      options: {
                        ...options,
                        [option.key]:
                          option.type === 'boolean'
                            ? event.target.checked
                            : Number(event.target.value),
                      },
                    })
                  }
                />
              )}
            </label>
          ))}
        </details>
      )}
    </div>
  );
}
