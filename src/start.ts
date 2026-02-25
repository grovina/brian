import path from "path";
import { homedir } from "os";
import { Brian } from "./brian.js";
import { AutonomousWake } from "./wake/autonomous.js";
import { bash } from "./tools/index.js";
import { createModel } from "./model.js";

const name = process.env.BRIAN_NAME;
if (!name) {
  console.error("BRIAN_NAME not set");
  process.exit(1);
}

const stateDir = process.env.BRIAN_STATE_DIR ?? path.join(homedir(), ".brian");

const brian = new Brian({
  name,
  model: await createModel(),
  wake: new AutonomousWake(),
  tools: [bash],
  mcp: path.join(stateDir, "mcp"),
  stateDir,
});

await brian.start();
