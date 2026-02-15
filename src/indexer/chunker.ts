import path from "path";

export interface Chunk {
  content: string;
  index: number;
  metadata: {
    startLine?: number;
    endLine?: number;
    type?: string; // function, class, section, etc
    name?: string;
    [key: string]: any;
  };
}

export interface Chunker {
  chunk(content: string, filePath: string): Chunk[];
}

// Markdown chunker - split on headers
class MarkdownChunker implements Chunker {
  chunk(content: string, filePath: string): Chunk[] {
    const lines = content.split("\n");
    const chunks: Chunk[] = [];
    let currentChunk: string[] = [];
    let currentHeader = "";
    let startLine = 0;
    let chunkIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const headerMatch = line.match(/^(#{1,6})\s+(.+)/);

      if (headerMatch) {
        // Save previous chunk if exists
        if (currentChunk.length > 0) {
          chunks.push({
            content: currentChunk.join("\n"),
            index: chunkIndex++,
            metadata: {
              startLine,
              endLine: i - 1,
              type: "section",
              name: currentHeader,
            },
          });
        }

        currentHeader = headerMatch[2];
        startLine = i;
        currentChunk = [line];
      } else {
        currentChunk.push(line);
      }
    }

    // Save last chunk
    if (currentChunk.length > 0) {
      chunks.push({
        content: currentChunk.join("\n"),
        index: chunkIndex++,
        metadata: {
          startLine,
          endLine: lines.length - 1,
          type: "section",
          name: currentHeader,
        },
      });
    }

    return chunks;
  }
}

// Code chunker - simple function/class detection
class CodeChunker implements Chunker {
  chunk(content: string, filePath: string): Chunk[] {
    const lines = content.split("\n");
    const chunks: Chunk[] = [];
    let chunkIndex = 0;

    // Simple heuristic: split on function/class declarations
    const patterns = [
      /^\s*(export\s+)?(async\s+)?function\s+(\w+)/,
      /^\s*(export\s+)?class\s+(\w+)/,
      /^\s*(export\s+)?const\s+(\w+)\s*=/,
      /^\s*(export\s+)?interface\s+(\w+)/,
      /^\s*(export\s+)?type\s+(\w+)/,
    ];

    let currentChunk: string[] = [];
    let startLine = 0;
    let currentName = "";
    let currentType = "";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let matched = false;

      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match) {
          // Save previous chunk
          if (currentChunk.length > 0) {
            chunks.push({
              content: currentChunk.join("\n"),
              index: chunkIndex++,
              metadata: {
                startLine,
                endLine: i - 1,
                type: currentType,
                name: currentName,
              },
            });
          }

          currentName = match[match.length - 1];
          currentType = line.includes("function") ? "function" :
                       line.includes("class") ? "class" :
                       line.includes("interface") ? "interface" :
                       line.includes("type") ? "type" : "const";
          startLine = i;
          currentChunk = [line];
          matched = true;
          break;
        }
      }

      if (!matched) {
        currentChunk.push(line);
      }
    }

    // Save last chunk
    if (currentChunk.length > 0) {
      chunks.push({
        content: currentChunk.join("\n"),
        index: chunkIndex++,
        metadata: {
          startLine,
          endLine: lines.length - 1,
          type: currentType,
          name: currentName,
        },
      });
    }

    return chunks.length > 0 ? chunks : this.fallbackChunk(content);
  }

  private fallbackChunk(content: string): Chunk[] {
    // If no patterns matched, return whole file as one chunk
    return [{
      content,
      index: 0,
      metadata: { type: "file" },
    }];
  }
}

// Generic text chunker with sliding window
class TextChunker implements Chunker {
  private chunkSize = 500; // ~500 words
  private overlap = 100;

  chunk(content: string, filePath: string): Chunk[] {
    const words = content.split(/\s+/);
    const chunks: Chunk[] = [];
    let chunkIndex = 0;

    for (let i = 0; i < words.length; i += this.chunkSize - this.overlap) {
      const chunkWords = words.slice(i, i + this.chunkSize);
      chunks.push({
        content: chunkWords.join(" "),
        index: chunkIndex++,
        metadata: {
          wordStart: i,
          wordEnd: i + chunkWords.length,
        },
      });
    }

    return chunks;
  }
}

// JSON/YAML chunker
class StructuredDataChunker implements Chunker {
  chunk(content: string, filePath: string): Chunk[] {
    try {
      const data = JSON.parse(content);
      const chunks: Chunk[] = [];
      let chunkIndex = 0;

      // Chunk by top-level keys
      for (const [key, value] of Object.entries(data)) {
        chunks.push({
          content: `${key}:\n${JSON.stringify(value, null, 2)}`,
          index: chunkIndex++,
          metadata: {
            type: "object_key",
            name: key,
          },
        });
      }

      return chunks.length > 0 ? chunks : [{ content, index: 0, metadata: {} }];
    } catch {
      // Not valid JSON, treat as text
      return new TextChunker().chunk(content, filePath);
    }
  }
}

export function getChunker(filePath: string): Chunker {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".md") return new MarkdownChunker();
  if ([".ts", ".js", ".tsx", ".jsx", ".py"].includes(ext)) return new CodeChunker();
  if ([".json", ".jsonc"].includes(ext)) return new StructuredDataChunker();
  
  return new TextChunker();
}
