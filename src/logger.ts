import fs from "fs";
import path from "path";

const LOG_DIR = path.join(process.env.HOME || "/home/brian", ".brian", "logs");
const LOG_FILE = path.join(LOG_DIR, `brian-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);

// Ensure log directory exists
try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
} catch (err) {
  // Directory might already exist
}

// Create log stream
let logStream: fs.WriteStream | null = null;
try {
  logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });
} catch (err) {
  console.error("Failed to create log stream:", err);
}

function formatLog(level: string, ...args: unknown[]): string {
  const timestamp = new Date().toISOString();
  const message = args.map(arg => 
    typeof arg === "object" ? JSON.stringify(arg) : String(arg)
  ).join(" ");
  return `[${timestamp}] ${level}: ${message}\n`;
}

function writeLog(level: string, ...args: unknown[]): void {
  const logLine = formatLog(level, ...args);
  
  // Write to file
  if (logStream) {
    logStream.write(logLine);
  }
  
  // Also write to console
  const originalLog = level === "ERROR" ? console.error : console.log;
  originalLog(...args);
}

export const logger = {
  info: (...args: unknown[]) => writeLog("INFO", ...args),
  error: (...args: unknown[]) => writeLog("ERROR", ...args),
  warn: (...args: unknown[]) => writeLog("WARN", ...args),
  debug: (...args: unknown[]) => writeLog("DEBUG", ...args),
};

// Override console methods
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

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

// Cleanup on exit
process.on("exit", () => {
  if (logStream) {
    logStream.end();
  }
});

export { LOG_FILE };
