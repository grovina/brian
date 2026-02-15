import fs from "fs";
import path from "path";
import { IndexDatabase } from "./database.js";
import { getEmbeddingProvider } from "./embeddings.js";
import { getChunker } from "./chunker.js";

const IGNORE_PATTERNS = [
  /node_modules/,
  /\.git/,
  /dist/,
  /build/,
  /\.next/,
  /\.cache/,
  /\.brian\/code-index\.db/,
  /\.DS_Store/,
];

const TEXT_EXTENSIONS = [
  ".ts", ".js", ".tsx", ".jsx", ".py", ".md", ".txt",
  ".json", ".jsonc", ".yaml", ".yml", ".toml",
  ".sh", ".bash", ".zsh",
  ".html", ".css", ".scss",
  ".go", ".rs", ".c", ".cpp", ".h",
  ".sql", ".env",
];

export class Indexer {
  private db: IndexDatabase;
  private embedder = getEmbeddingProvider();

  constructor() {
    this.db = new IndexDatabase();
  }

  async indexPath(rootPath: string, progressCallback?: (file: string) => void): Promise<void> {
    console.log(`Starting indexing: ${rootPath}`);
    await this.embedder.initialize();

    const files = this.walkDirectory(rootPath);
    console.log(`Found ${files.length} files to index`);

    for (const filePath of files) {
      try {
        await this.indexFile(filePath);
        progressCallback?.(filePath);
      } catch (err) {
        console.error(`Error indexing ${filePath}:`, err);
      }
    }

    const stats = this.db.getStats();
    console.log(`Indexing complete: ${stats.totalFiles} files, ${stats.totalChunks} chunks`);
  }

  async indexFile(filePath: string): Promise<void> {
    const stats = fs.statSync(filePath);
    const lastModified = stats.mtimeMs;

    // Check if file needs reindexing
    const dbLastModified = this.db.getFileLastModified(filePath);
    if (dbLastModified && dbLastModified >= lastModified) {
      return; // Already up to date
    }

    // Delete old chunks
    this.db.deleteChunksByFile(filePath);

    // Read and chunk file
    const content = fs.readFileSync(filePath, "utf-8");
    const chunker = getChunker(filePath);
    const chunks = chunker.chunk(content, filePath);

    // Generate embeddings and store
    for (const chunk of chunks) {
      const embedding = await this.embedder.embed(chunk.content);
      
      this.db.insertChunk({
        filePath,
        fileType: path.extname(filePath),
        chunkIndex: chunk.index,
        content: chunk.content,
        embedding,
        metadata: JSON.stringify(chunk.metadata),
        lastModified,
        createdAt: Date.now(),
      });
    }
  }

  async search(query: string, limit: number = 10) {
    await this.embedder.initialize();
    const queryEmbedding = await this.embedder.embed(query);
    return this.db.searchBySimilarity(queryEmbedding, limit);
  }

  getStats() {
    return this.db.getStats();
  }

  private walkDirectory(dir: string): string[] {
    const files: string[] = [];

    const walk = (currentPath: string) => {
      try {
        const entries = fs.readdirSync(currentPath, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(currentPath, entry.name);

          // Skip ignored patterns
          if (IGNORE_PATTERNS.some((pattern) => pattern.test(fullPath))) {
            continue;
          }

          if (entry.isDirectory()) {
            walk(fullPath);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (TEXT_EXTENSIONS.includes(ext)) {
              files.push(fullPath);
            }
          }
        }
      } catch (err) {
        // Skip directories we can't read
      }
    };

    walk(dir);
    return files;
  }

  close(): void {
    this.db.close();
  }
}
