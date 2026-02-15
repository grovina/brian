import { VoyageAIClient } from "voyageai";

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const VOYAGE_MODEL = "voyage-3-lite"; // fast and cheap

class VoyageEmbeddingProvider {
  private client: VoyageAIClient;

  constructor() {
    if (!VOYAGE_API_KEY) {
      throw new Error("VOYAGE_API_KEY environment variable required");
    }
    this.client = new VoyageAIClient({ apiKey: VOYAGE_API_KEY });
  }

  async initialize(): Promise<void> {
    console.log("Using Voyage AI embeddings");
  }

  async embed(text: string): Promise<number[]> {
    const result = await this.client.embed({
      input: text,
      model: VOYAGE_MODEL,
    });
    if (!result.data?.[0]?.embedding) {
      throw new Error("No embedding returned from Voyage");
    }
    return result.data[0].embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const result = await this.client.embed({
      input: texts,
      model: VOYAGE_MODEL,
    });
    if (!result.data) {
      throw new Error("No embeddings returned from Voyage");
    }
    return result.data.map((d) => {
      if (!d.embedding) throw new Error("Missing embedding in batch result");
      return d.embedding;
    });
  }
}

// Singleton instance
let embeddingProvider: VoyageEmbeddingProvider | null = null;

export function getEmbeddingProvider(): VoyageEmbeddingProvider {
  if (!embeddingProvider) {
    embeddingProvider = new VoyageEmbeddingProvider();
  }
  return embeddingProvider;
}
