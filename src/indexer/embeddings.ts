import { getLlama, resolveModelFile, LlamaLogLevel, LlamaModel, LlamaEmbeddingContext } from "node-llama-cpp";
import { homedir } from "os";
import path from "path";

const MODEL_PATH = "hf:ggml-org/embeddinggemma-300m-qat-q8_0-GGUF/embeddinggemma-300m-qat-Q8_0.gguf";
const MODEL_CACHE_DIR = path.join(homedir(), ".brian", "models");

export class EmbeddingProvider {
  private model: LlamaModel | null = null;
  private context: LlamaEmbeddingContext | null = null;

  async initialize(): Promise<void> {
    if (this.context) return;

    console.log("Initializing local embedding model (embeddinggemma)...");
    const llama = await getLlama({ logLevel: LlamaLogLevel.error });
    
    console.log(`Resolving model: ${MODEL_PATH}`);
    const modelPath = await resolveModelFile(MODEL_PATH, MODEL_CACHE_DIR);
    
    console.log(`Loading model from: ${modelPath}`);
    this.model = await llama.loadModel({ modelPath });

    console.log("Creating embedding context...");
    this.context = await this.model.createEmbeddingContext();
    console.log("Embedding model ready");
  }

  async embed(text: string): Promise<number[]> {
    if (!this.context) {
      await this.initialize();
    }

    const result = await this.context!.getEmbeddingFor(text);
    return this.normalize(Array.from(result.vector));
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.context) {
      await this.initialize();
    }

    const embeddings = await Promise.all(
      texts.map(async (text) => {
        const result = await this.context!.getEmbeddingFor(text);
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
    embeddingProvider = new EmbeddingProvider();
  }
  return embeddingProvider;
}
