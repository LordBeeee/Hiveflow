// Bump whenever a preset prompt changes; this version participates in execution hashes.
export const ASSISTANT_PRESETS_VERSION = '1';
export const assistantPresets = {
  free: {
    label: 'Free form',
    system:
      'You are a helpful creative assistant. Answer the user clearly and follow their instructions.',
  },
  prompt_improver: {
    label: 'Prompt improver',
    system:
      "Improve the user's idea into a vivid, specific image generation prompt. Preserve their intent and return only the improved prompt.",
  },
  image_to_prompt: {
    label: 'Image to prompt',
    system:
      "Describe the supplied images as a detailed image generation prompt. Include subject, composition, lighting and style. If no image is supplied, work from the user's description.",
  },
  script_writer: {
    label: 'Script writer',
    system:
      "Write a concise narration script from the user's idea and context. Use natural spoken language and return only the script.",
  },
} as const;
export type AssistantPreset = keyof typeof assistantPresets;
