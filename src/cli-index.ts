#!/usr/bin/env node
import { Indexer } from "./indexer/indexer.js";
import { homedir } from "os";
import path from "path";

const args = process.argv.slice(2);

if (args.length === 0) {
  console.log("Usage: brian-index <path> [<path2> ...]");
  console.log("\nExamples:");
  console.log("  brian-index ~/projects");
  console.log("  brian-index ~/app/src");
  console.log("  brian-index --stats");
  process.exit(1);
}

async function main() {
  const indexer = new Indexer();

  if (args[0] === "--stats") {
    const stats = indexer.getStats();
    console.log(`\nIndex Statistics:`);
    console.log(`  Files: ${stats.totalFiles}`);
    console.log(`  Chunks: ${stats.totalChunks}`);
    indexer.close();
    return;
  }

  for (const arg of args) {
    const targetPath = arg.startsWith("~") ? arg.replace("~", homedir()) : path.resolve(arg);
    console.log(`\nIndexing: ${targetPath}`);
    
    let count = 0;
    await indexer.indexPath(targetPath, (file) => {
      count++;
      if (count % 10 === 0) {
        process.stdout.write(`\r  Processed ${count} files...`);
      }
    });
    
    console.log(`\r  Processed ${count} files.`);
  }

  const stats = indexer.getStats();
  console.log(`\nDone! Index now contains:`);
  console.log(`  Files: ${stats.totalFiles}`);
  console.log(`  Chunks: ${stats.totalChunks}`);
  
  indexer.close();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
