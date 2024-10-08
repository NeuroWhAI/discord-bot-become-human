/**
 * https://docs.tavily.com/docs/tavily-api/rest_api
 */

import { load as loadEnv } from 'std/dotenv/mod.ts';
const env = await loadEnv();

import { FunctionDefinition, ToolContext } from '../ai/tool.ts';

export const metadata: FunctionDefinition = {
  name: 'search_internet',
  description: 'Search the Internet to get information',
  parameters: {
    type: 'object',
    properties: {
      query_or_url: {
        type: 'string',
        description: 'The search query string or URL',
      },
      include_details: {
        type: 'boolean',
        description: 'Include raw content in the search results for query',
      },
      include_images: {
        type: 'boolean',
        description:
          'Include a list of related images in the response for query',
      },
    },
    required: ['query_or_url'],
  },
};

export async function execute(arg: string, _ctx: ToolContext): Promise<string> {
  const { query_or_url, include_details, include_images } = JSON.parse(arg);

  if (
    query_or_url.startsWith('http://') || query_or_url.startsWith('https://')
  ) {
    return await getUrlContent(query_or_url);
  } else {
    return await searchQuery(query_or_url, include_details, include_images);
  }
}

async function searchQuery(
  query: string,
  include_details: boolean,
  include_images: boolean,
) {
  const requestPayload: SearchRequest = {
    api_key: env.TAVILY_API_KEY,
    query,
    search_depth: 'advanced',
    include_answer: true,
  };
  if (include_details) {
    requestPayload.max_results = 1;
    requestPayload.include_raw_content = true;
  } else {
    requestPayload.max_results = 8;
  }
  if (include_images) {
    requestPayload.include_images = true;
  }

  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestPayload),
  });
  if (!res.ok) {
    return `HTTP error! Status: ${res.status}`;
  }
  const data: SearchResponse = await res.json();
  if (!data.results?.length) {
    return 'No results found';
  }

  if (include_details) {
    const result = data.results[0];
    const imagesStr = data.images?.length
      ? '\nImages:\n' + data.images.map((url) => '- ' + url).join('\n')
      : '';
    return `Query: ${data.query}
Summary: ${data.answer}
Title: ${result.title}
URL: ${result.url}` + imagesStr +
      `\nContent:\n${result.raw_content}`.trimEnd();
  } else {
    return JSON.stringify(
      {
        query: data.query,
        summary: data.answer,
        results: data.results.map((result) => ({
          title: result.title,
          url: result.url,
          content: result.content,
        })),
        images: data.images,
      },
      null,
      1,
    );
  }
}

async function getUrlContent(url: string) {
  const res = await fetch('https://r.jina.ai/' + url, {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + env.JINA_API_KEY,
      'X-Timeout': '10',
      'X-Locale': 'ko-KR',
      'X-With-Generated-Alt': 'true',
    },
  });
  if (!res.ok) {
    return `HTTP error! Status: ${res.status}`;
  }

  return await res.text();
}

interface SearchRequest {
  api_key: string;
  query: string;
  search_depth?: string;
  include_images?: boolean;
  include_answer?: boolean;
  include_raw_content?: boolean;
  max_results?: number;
  include_domains?: string[];
  exclude_domains?: string[];
}

interface SearchResponse {
  answer: string;
  query: string;
  response_time: string;
  follow_up_questions: string[];
  images: string[];
  results: {
    title: string;
    url: string;
    content: string;
    raw_content: string;
    score: string;
  }[];
}
