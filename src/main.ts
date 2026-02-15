import "./logger.js"; // Initialize logging first
import { startBot, stopBot, sendMessageToOwner } from "./telegram.js";
import { startHeartbeat, stopHeartbeat } from "./heartbeat.js";

console.log("Brian starting up...");

startBot();
startHeartbeat();

sendMessageToOwner("hey! back online").catch((err) => {
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
