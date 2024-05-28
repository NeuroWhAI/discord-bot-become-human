/**
 * https://platform.stability.ai/docs/api-reference#tag/Generate
 */

import { load as loadEnv } from 'std/dotenv/mod.ts';
const env = await loadEnv();

import { encodeBase64 } from 'std/encoding/base64.ts';
import { FunctionDefinition, ToolContext } from '../ai/tool.ts';

export const metadata: FunctionDefinition = {
  name: 'generate_one_image',
  description: 'Generate an image matches the prompt',
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'What you wish to see in the output image. in English',
      },
      aspect_ratio: {
        type: 'string',
        enum: [
          '1:1',
          '2:3',
          '3:2',
          '4:5',
          '5:4',
          '9:16',
          '16:9',
          '9:21',
          '21:9',
        ],
      },
      negative_prompt: {
        type: 'string',
        description:
          'Items you do not wish to see in the output image. in English',
      },
      style_preset: {
        type: 'string',
        enum: [
          '3d-model',
          'analog-film',
          'anime',
          'cinematic',
          'comic-book',
          'digital-art',
          'enhance',
          'fantasy-art',
          'isometric',
          'line-art',
          'low-poly',
          'modeling-compound',
          'neon-punk',
          'origami',
          'photographic',
          'pixel-art',
          'tile-texture',
        ],
      },
    },
    required: ['prompt'],
  },
};

export async function execute(arg: string, _ctx: ToolContext): Promise<string> {
  try {
    const { prompt, aspect_ratio, negative_prompt, style_preset } = JSON.parse(
      arg,
    );
    const formData = new FormData();
    formData.append('model', 'sd3');
    formData.append('prompt', prompt);
    if (aspect_ratio) {
      formData.append('aspect_ratio', aspect_ratio);
    }
    if (negative_prompt) {
      formData.append('negative_prompt', negative_prompt);
    }
    if (style_preset) {
      formData.append('style_preset', style_preset);
    }
    formData.append('output_format', 'png');

    const res = await fetch(
      `https://api.stability.ai/v2beta/stable-image/generate/sd3`,
      {
        method: 'POST',
        body: formData,
        headers: {
          Authorization: `Bearer ${env.STABILITY_API_KEY}`,
          Accept: 'image/*',
        },
      },
    );
    if (!res.ok) {
      return `HTTP error! Status: ${res.status}`;
    }

    const buffer = await res.arrayBuffer();
    return `data:image/png;base64,${encodeBase64(buffer)}`;
  } catch (err) {
    return `Failed to generate image: ${(err as Error).message}`;
  }
}
