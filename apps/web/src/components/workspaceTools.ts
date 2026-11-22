import type { NodeType } from '@hiveflow/shared';
import type { IconName } from '../canvas/Icons';

interface WorkspaceTool {
  label: string;
  icon: IconName;
  type?: NodeType;
  color: string;
  description: string;
  href?: string;
}

export const creationTools: WorkspaceTool[] = [
  {
    label: 'Image',
    icon: 'image',
    type: 'image_generator',
    href: '/create/image',
    color: 'blue',
    description: 'Turn your ideas into images with a prompt and references.',
  },
  {
    label: 'Video',
    icon: 'video',
    type: 'video_generator',
    href: '/create/video',
    color: 'green',
    description: 'Bring a scene to life with a prompt or a starting image.',
  },
  {
    label: 'Voice',
    icon: 'audio',
    type: 'voiceover',
    href: '/create/audio',
    color: 'teal',
    description: 'Give your words a voice with text-to-speech.',
  },
];

export const workspaceTools: WorkspaceTool[] = [
  {
    label: 'Space',
    icon: 'spaces',
    color: 'purple',
    description: 'Build a connected creative workflow.',
  },
  ...creationTools,
];
