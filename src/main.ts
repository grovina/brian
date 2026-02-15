import { startBot, stopBot, sendMessageToOwner } from "./telegram.js";
import { startHeartbeat, stopHeartbeat } from "./heartbeat.js";

console.log("Brian starting up...");

startBot();
startHeartbeat();

sendMessageToOwner(
  "Hello! I'm online. I have shell access, Docker, and git on this machine. I don't know anything about your projects yet — tell me what to work on or send me files I'll need."
).catch((err) => {
  console.error("Failed to send startup message:", err);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
  console.log("Shutting down...");
  stopHeartbeat();
  stopBot();
  process.exit(0);
}
