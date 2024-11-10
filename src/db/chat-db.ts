import { load as loadEnv } from 'std/dotenv/mod.ts';
const env = await loadEnv();

import { encodeHex } from 'std/encoding/hex.ts';
import OpenAI from 'openai';
import { ChromaClient } from 'chromadb';

const chroma = new ChromaClient({
  path: env.CHROMA_DB_URL,
});

export class ChatDB {
  constructor(openai: OpenAI, model: string, channelId: string) {
    this.openai = openai;
    this.model = model;
    this.channelId = channelId;
  }

  private readonly openai: OpenAI;
  private readonly model: string;
  private readonly channelId: string;

  public async store(document: string) {
    const now = new Date();

    const docBuffer = new TextEncoder().encode(document);
    const hashBuffer = await crypto.subtle.digest('SHA-256', docBuffer);
    const id = encodeHex(hashBuffer);

    const collection = await this.getCollection();
    const embedding = await this.createEmbedding(document);

    const res = await collection.add({
      ids: id,
      documents: `[${now.toLocaleString()}]\n` + document,
      embeddings: embedding,
    });

    if (res.error) {
      throw new Error(res.error);
    }
  }

  public async search(query: string): Promise<string[]> {
    const collection = await this.getCollection();
    const embedding = await this.createEmbedding(query);

    const res = await collection.query({
      queryEmbeddings: embedding,
      nResults: 3,
    });

    const docs: string[] = [];

    for (const doc of res.documents[0]) {
      if (doc) {
        docs.push(doc);
      }
    }

    return docs;
  }

  private async createEmbedding(document: string): Promise<number[]> {
    const res = await this.openai.embeddings.create({
      model: this.model,
      input: document,
    });
    return res.data[0].embedding;
  }

  private async getCollection() {
    return await chroma.getOrCreateCollection({
      name: 'ch-' + this.channelId,
      metadata: { 'hnsw:space': 'cosine' },
    });
  }
}
