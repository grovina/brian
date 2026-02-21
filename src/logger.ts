import fs from "fs";
import path from "path";

let logStream: fs.WriteStream | null = null;
let originalLog = console.log;
let originalError = console.error;
let originalWarn = console.warn;

function formatLog(level: string, ...args: unknown[]): string {
  const timestamp = new Date().toISOString();
  const message = args
    .map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : String(arg)))
    .join(" ");
  return `[${timestamp}] ${level}: ${message}\n`;
}

export function initLogger(stateDir: string): void {
  const logDir = path.join(stateDir, "logs");

  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch {
    // already exists
  }

  const logFile = path.join(
    logDir,
    `brian-${new Date().toISOString().replace(/[:.]/g, "-")}.log`
  );

  try {
    logStream = fs.createWriteStream(logFile, { flags: "a" });
  } catch (err) {
    console.error("Failed to create log stream:", err);
    return;
  }

  console.log = (...args: unknown[]) => {
    if (logStream) logStream.write(formatLog("INFO", ...args));
    originalLog(...args);
  };

  console.error = (...args: unknown[]) => {
    if (logStream) logStream.write(formatLog("ERROR", ...args));
    originalError(...args);
  };

  console.warn = (...args: unknown[]) => {
    if (logStream) logStream.write(formatLog("WARN", ...args));
    originalWarn(...args);
  };

  process.on("exit", () => {
    if (logStream) logStream.end();
  });
}
