import { VoyageAIClient } from "voyageai";
import { homedir } from "os";
import path from "path";

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const VOYAGE_MODEL = "voyage-3-lite";

interface EmbeddingProvider {
  initialize(): Promise<void>;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

class VoyageEmbeddingProvider implements EmbeddingProvider {
  private client: VoyageAIClient;

  constructor() {
    if (!VOYAGE_API_KEY) {
      throw new Error("VOYAGE_API_KEY environment variable required");
    }
    this.client = new VoyageAIClient({ apiKey: VOYAGE_API_KEY });
  }

  async initialize(): Promise<void> {
    console.log("Using Voyage AI embeddings (fast)");
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

class LocalEmbeddingProvider implements EmbeddingProvider {
  private context: any = null;

  async initialize(): Promise<void> {
    if (this.context) return;

    console.log("Using local embeddings (slow but free)");
    
    // Lazy load to avoid startup overhead
    const { getLlama, resolveModelFile, LlamaLogLevel } = await import("node-llama-cpp");
    
    const MODEL_PATH = "hf:ggml-org/embeddinggemma-300m-qat-q8_0-GGUF/embeddinggemma-300m-qat-Q8_0.gguf";
    const MODEL_CACHE_DIR = path.join(homedir(), ".brian", "models");
    
    const llama = await getLlama({ logLevel: LlamaLogLevel.error });
    const modelPath = await resolveModelFile(MODEL_PATH, MODEL_CACHE_DIR);
    const model = await llama.loadModel({ modelPath });
    this.context = await model.createEmbeddingContext();
    
    console.log("Local embedding model ready");
  }

  async embed(text: string): Promise<number[]> {
    if (!this.context) await this.initialize();
    const result = await this.context.getEmbeddingFor(text);
    return this.normalize(Array.from(result.vector));
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.context) await this.initialize();
    
    const embeddings = await Promise.all(
      texts.map(async (text) => {
        const result = await this.context.getEmbeddingFor(text);
        return this.normalize(Array.from(result.vector));
      })
    );
    return embeddings;
  }

  private normalize(vec: number[]): number[] {
    const magnitude = Math.sqrt(vec.reduce((sum, val) => sum + val * val, 0));
    if (magnitude < 1e-10) return vec;
    return vec.map((val) => val / magnitude);
  }
}

// Singleton instance
let embeddingProvider: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (!embeddingProvider) {
    // Try Voyage first, fallback to local
    try {
      if (VOYAGE_API_KEY) {
        embeddingProvider = new VoyageEmbeddingProvider();
      } else {
        embeddingProvider = new LocalEmbeddingProvider();
      }
    } catch {
      embeddingProvider = new LocalEmbeddingProvider();
    }
  }
  return embeddingProvider;
}
