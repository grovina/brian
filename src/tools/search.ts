import type { Tool } from "./index.js";
import { Indexer } from "../indexer/indexer.js";

export const searchTool: Tool = {
  name: "search",
  definition: {
    name: "search",
    description: "Search indexed content (files, docs, code, etc) using semantic similarity. Returns relevant chunks matching the query. Can be extended to include web search and external sources.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query (natural language)",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return (default: 10)",
        },
      },
      required: ["query"],
    },
  },

  async execute(input: Record<string, unknown>): Promise<string> {
    const { query, limit = 10 } = input as { query: string; limit?: number };
    const indexer = new Indexer();
    
    try {
      const results = await indexer.search(query, limit as number);
      
      if (results.length === 0) {
        return "No results found.";
      }

      const output = results.map((result, i) => {
        const metadata = JSON.parse(result.metadata);
        return [
          `## Result ${i + 1} (similarity: ${((result as any).similarity * 100).toFixed(1)}%)`,
          `**File:** ${result.filePath}`,
          metadata.name ? `**Name:** ${metadata.name}` : null,
          metadata.type ? `**Type:** ${metadata.type}` : null,
          `\n\`\`\`${result.fileType.replace(".", "")}`,
          result.content,
          `\`\`\`\n`,
        ].filter(Boolean).join("\n");
      });

      return output.join("\n---\n\n");
    } finally {
      indexer.close();
    }
  },
};
