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
        description:
          'Detailed long list of very short English words(mainly nouns or adjectives) that guide the output image.\n' +
          'List form: Subject, Settings, Actions, Context, Environment, Lighting, Artist, Styles, Medium, Type, Color Scheme, Computer Graphics, Quality, and more.\n' +
          'e.g. 1 girl, playing game, blue hair',
      },
      aspect_ratio: {
        type: 'string',
        enum: [
          'square',
          'portrait',
          'portrait extra',
          'landscape',
          'landscape extra',
        ],
      },
      negative_prompt: {
        type: 'string',
        description:
          'Things to exclude in the output image. in English. e.g. ugly, low quality',
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

    if (
      style_preset === 'anime' || style_preset === 'digital-art' ||
      style_preset === 'fantasy-art'
    ) {
      return await generateWithRunpod(
        prompt,
        aspect_ratio,
        negative_prompt,
        style_preset,
      );
    } else {
      return await generateWithStability(
        prompt,
        aspect_ratio,
        negative_prompt,
        style_preset,
      );
    }
  } catch (err) {
    return `Failed to generate image: ${(err as Error).message}`;
  }
}

async function generateWithStability(
  prompt: string,
  aspect_ratio: string,
  negative_prompt: string,
  style_preset: string,
): Promise<string> {
  const formData = new FormData();
  formData.append('model', 'sd3-large-turbo');
  formData.append('prompt', prompt);
  if (aspect_ratio) {
    let numberRatio = '1:1';
    if (aspect_ratio === 'portrait') {
      numberRatio = '4:5';
    } else if (aspect_ratio === 'portrait extra') {
      numberRatio = '9:16';
    } else if (aspect_ratio === 'landscape') {
      numberRatio = '5:4';
    } else if (aspect_ratio === 'landscape extra') {
      numberRatio = '16:9';
    }

    formData.append('aspect_ratio', numberRatio);
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
}

async function generateWithRunpod(
  prompt: string,
  aspect_ratio: string,
  negative_prompt: string,
  style_preset: string,
): Promise<string> {
  let numberRatio = '1024*1024';
  if (aspect_ratio === 'portrait') {
    numberRatio = '896*1088';
  } else if (aspect_ratio === 'portrait extra') {
    numberRatio = '768*1344';
  } else if (aspect_ratio === 'landscape') {
    numberRatio = '1088*896';
  } else if (aspect_ratio === 'landscape extra') {
    numberRatio = '1344*768';
  }

  const defaultNegativePrompt =
    'nsfw, naked, nude, lowres, bad anatomy, bad hands, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, signature, watermark, username, blurry, artist name, genital, nipple, sexual';
  negative_prompt = negative_prompt
    ? defaultNegativePrompt + ', ' + negative_prompt
    : defaultNegativePrompt;

  const style = ['Fooocus V2', 'Fooocus Masterpiece'];
  if (style_preset === 'anime') {
    style.push('SAI Anime');
  } else if (style_preset === 'digital-art') {
    style.push('SAI Digital Art');
  } else if (style_preset === 'fantasy-art') {
    style.push('SAI Fantasy Art');
  }

  const res = await fetch(
    `https://api.runpod.ai/v2/${env.RUNPOD_ANIME_IMAGEN_ENDPOINT_ID}/runsync`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.RUNPOD_API_KEY}`,
      },
      body: JSON.stringify({
        input: {
          api_name: 'txt2img',
          require_base64: true,
          prompt,
          image_number: 1,
          image_seed: -1,
          sharpness: 2,
          guidance_scale: 6,
          negative_prompt,
          style_selections: style,
          performance_selection: 'Speed',
          aspect_ratios_selection: numberRatio,
        },
      }),
    },
  );
  if (!res.ok) {
    return `HTTP error! Status: ${res.status}`;
  }

  const genRes = await res.json();
  if (genRes.status !== 'COMPLETED') {
    return `Failed to generate image: ${genRes.status}`;
  }

  if (!genRes.output?.length) {
    return `No output images found!`;
  }

  return `data:image/png;base64,${genRes.output[0].base64}`;
}
