import type { Tool } from "./index.js";
import { Indexer } from "../indexer/indexer.js";

export const searchCodeTool: Tool = {
  name: "search_files",
  definition: {
    name: "search_files",
    description: "Search the indexed codebase using semantic similarity. Returns relevant code chunks that match the query.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query (natural language or code-related)",
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
