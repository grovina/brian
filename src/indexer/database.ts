import { DatabaseSync } from "node:sqlite";
import { homedir } from "os";
import path from "path";
import fs from "fs";

const DB_PATH = path.join(homedir(), ".brian", "code-index.db");

export interface IndexedChunk {
  id?: number;
  filePath: string;
  fileType: string;
  chunkIndex: number;
  content: string;
  embedding: number[];
  metadata: string; // JSON string
  lastModified: number;
  createdAt: number;
}

export class IndexDatabase {
  private db: DatabaseSync;

  constructor(dbPath: string = DB_PATH) {
    // Ensure directory exists
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    
    this.db = new DatabaseSync(dbPath);
    this.initialize();
  }

  private initialize(): void {
    // Create chunks table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        file_type TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        embedding BLOB NOT NULL,
        metadata TEXT NOT NULL,
        last_modified INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(file_path, chunk_index)
      )
    `);

    // Create indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_file_path ON chunks(file_path);
      CREATE INDEX IF NOT EXISTS idx_file_type ON chunks(file_type);
      CREATE INDEX IF NOT EXISTS idx_last_modified ON chunks(last_modified);
    `);
  }

  insertChunk(chunk: IndexedChunk): number {
    const embeddingBlob = Buffer.from(new Float32Array(chunk.embedding).buffer);
    
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO chunks 
      (file_path, file_type, chunk_index, content, embedding, metadata, last_modified, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      chunk.filePath,
      chunk.fileType,
      chunk.chunkIndex,
      chunk.content,
      embeddingBlob,
      chunk.metadata,
      chunk.lastModified,
      chunk.createdAt || Date.now()
    );

    return result.lastInsertRowid as number;
  }

  deleteChunksByFile(filePath: string): void {
    const stmt = this.db.prepare("DELETE FROM chunks WHERE file_path = ?");
    stmt.run(filePath);
  }

  getFileLastModified(filePath: string): number | null {
    const stmt = this.db.prepare(
      "SELECT last_modified FROM chunks WHERE file_path = ? LIMIT 1"
    );
    const row = stmt.get(filePath) as { last_modified: number } | undefined;
    return row?.last_modified ?? null;
  }

  searchBySimilarity(queryEmbedding: number[], limit: number = 10): IndexedChunk[] {
    // Get all chunks and calculate cosine similarity in JS (no vec0 extension needed)
    const stmt = this.db.prepare("SELECT * FROM chunks");
    const rows = stmt.all() as any[];

    const results = rows.map((row) => {
      const embedding = new Float32Array(row.embedding.buffer);
      const similarity = cosineSimilarity(queryEmbedding, Array.from(embedding));
      
      return {
        id: row.id,
        filePath: row.file_path,
        fileType: row.file_type,
        chunkIndex: row.chunk_index,
        content: row.content,
        embedding: Array.from(embedding),
        metadata: row.metadata,
        lastModified: row.last_modified,
        createdAt: row.created_at,
        similarity,
      };
    });

    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  getAllFiles(): string[] {
    const stmt = this.db.prepare("SELECT DISTINCT file_path FROM chunks");
    const rows = stmt.all() as { file_path: string }[];
    return rows.map((r) => r.file_path);
  }

  getStats(): { totalChunks: number; totalFiles: number } {
    const chunksStmt = this.db.prepare("SELECT COUNT(*) as count FROM chunks");
    const filesStmt = this.db.prepare("SELECT COUNT(DISTINCT file_path) as count FROM chunks");
    
    const chunks = (chunksStmt.get() as { count: number }).count;
    const files = (filesStmt.get() as { count: number }).count;

    return { totalChunks: chunks, totalFiles: files };
  }

  close(): void {
    this.db.close();
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(magA) * Math.sqrt(magB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}
