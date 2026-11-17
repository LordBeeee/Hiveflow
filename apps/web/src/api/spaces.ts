import {
  spaceDocumentSchema,
  spaceSummarySchema,
  type CreateSpaceInput,
  type UpdateSpaceInput,
} from '@hiveflow/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly errors: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}

export async function request(
  path: string,
  options: RequestInit = {},
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers: {
        ...(options.body instanceof FormData
          ? {}
          : { 'Content-Type': 'application/json' }),
        ...options.headers,
      },
      signal: options.signal ?? AbortSignal.timeout(15000),
    });
  } catch {
    throw new ApiError(
      0,
      'Could not reach Hiveflow. Check your connection and retry.',
    );
  }
  if (response.status === 204) return undefined;
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const details =
      body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const errors = Array.isArray(details.errors)
      ? details.errors.filter(
          (item): item is { path: string; message: string } =>
            !!item &&
            typeof item === 'object' &&
            typeof item.path === 'string' &&
            typeof item.message === 'string',
        )
      : [];
    throw new ApiError(
      response.status,
      typeof details.message === 'string'
        ? details.message
        : `Request failed (${response.status})`,
      errors,
    );
  }
  return body;
}

function parseDocument(body: unknown) {
  const parsed = spaceDocumentSchema.safeParse(body);
  if (!parsed.success)
    throw new ApiError(
      422,
      'This saved space uses an unsupported or damaged graph format.',
    );
  return parsed.data;
}

export const spacesApi = {
  list: async () => spaceSummarySchema.array().parse(await request('/spaces')),
  get: async (id: string) => parseDocument(await request(`/spaces/${id}`)),
  create: async (input: CreateSpaceInput) =>
    parseDocument(
      await request('/spaces', { method: 'POST', body: JSON.stringify(input) }),
    ),
  update: async (id: string, input: UpdateSpaceInput) =>
    parseDocument(
      await request(`/spaces/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    ),
  remove: async (id: string) => {
    await request(`/spaces/${id}`, { method: 'DELETE' });
  },
};
