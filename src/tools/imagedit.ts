/**
 * https://platform.stability.ai/docs/api-reference#tag/Edit
 */

import { load as loadEnv } from 'std/dotenv/mod.ts';
const env = await loadEnv();

import { decodeBase64, encodeBase64 } from 'std/encoding/base64.ts';
import { FunctionDefinition, ToolContext } from '../ai/tool.ts';

export const metadata: FunctionDefinition = {
  name: 'edit_one_image',
  description:
    'Find specific elements within an image and redraw them to match the prompt',
  parameters: {
    type: 'object',
    properties: {
      image_id: {
        type: 'string',
        description: "The original image's ID",
      },
      prompt: {
        type: 'string',
        description:
          'Description of the final output image you wish to see. in English',
      },
      search_prompt: {
        type: 'string',
        description: 'Items to redraw in the image. in English',
      },
      negative_prompt: {
        type: 'string',
        description:
          'Items you do not wish to see in the output image. in English',
      },
    },
    required: ['image_id', 'prompt', 'search_prompt'],
  },
};

export async function execute(arg: string, ctx: ToolContext): Promise<string> {
  try {
    const { image_id, prompt, search_prompt, negative_prompt } = JSON.parse(
      arg,
    );

    const imgUrl = ctx.fileStorage.getUrlById(image_id);
    if (!imgUrl) {
      return 'Image not found!';
    }

    let imgBlob: Blob;
    if (imgUrl.startsWith('data:image/')) {
      const imgData = imgUrl.substring(imgUrl.indexOf(',') + 1);
      const blobType = /(image\/\w+);/g.exec(imgUrl)?.[1] ?? 'image/webp';
      imgBlob = new Blob([decodeBase64(imgData)], { type: blobType });
    } else {
      const res = await fetch(imgUrl);
      if (!res.ok) {
        return `HTTP error! Status: ${res.status}`;
      }
      imgBlob = await res.blob();
    }

    const formData = new FormData();
    formData.append('image', imgBlob);
    formData.append('prompt', prompt);
    formData.append('search_prompt', search_prompt);
    if (negative_prompt) {
      formData.append('negative_prompt', negative_prompt);
    }
    formData.append('output_format', 'webp');

    const res = await fetch(
      `https://api.stability.ai/v2beta/stable-image/edit/search-and-replace`,
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
    return `data:image/webp;base64,${encodeBase64(buffer)}`;
  } catch (err) {
    return `Failed to generate image: ${(err as Error).message}`;
  }
}
