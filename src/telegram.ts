import { Bot, type Context } from "grammy";
import fs from "fs/promises";
import path from "path";
import { config } from "./config.js";
import { runAgent } from "./agent.js";

const bot = new Bot(config.telegram.botToken);

const MAX_MESSAGE_LENGTH = 4096;

function isOwner(ctx: Context): boolean {
  return ctx.from?.id === config.telegram.ownerId;
}

async function sendLongMessage(ctx: Context, text: string): Promise<void> {
  if (text.length <= MAX_MESSAGE_LENGTH) {
    await ctx.reply(text, { parse_mode: "Markdown" }).catch(() =>
      // Fall back to plain text if Markdown parsing fails
      ctx.reply(text)
    );
    return;
  }

  // Split into chunks at line boundaries
  const lines = text.split("\n");
  let chunk = "";
  for (const line of lines) {
    if (chunk.length + line.length + 1 > MAX_MESSAGE_LENGTH) {
      if (chunk) {
        await ctx.reply(chunk, { parse_mode: "Markdown" }).catch(() =>
          ctx.reply(chunk)
        );
      }
      chunk = line;
    } else {
      chunk += (chunk ? "\n" : "") + line;
    }
  }
  if (chunk) {
    await ctx.reply(chunk, { parse_mode: "Markdown" }).catch(() =>
      ctx.reply(chunk)
    );
  }
}

bot.on("message:text", async (ctx) => {
  if (!isOwner(ctx)) return;

  try {
    const result = await runAgent(ctx.message.text);
    await sendLongMessage(ctx, result.response);
  } catch (err) {
    console.error("Agent error:", err);
    await ctx.reply(`Error: ${(err as Error).message}`);
  }
});

bot.on("message:photo", async (ctx) => {
  if (!isOwner(ctx)) return;

  try {
    // Get the largest photo
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const file = await ctx.getFile();
    const filePath = file.file_path;
    if (!filePath) {
      await ctx.reply("Could not retrieve the image.");
      return;
    }

    const url = `https://api.telegram.org/file/bot${config.telegram.botToken}/${filePath}`;
    const response = await fetch(url);
    const buffer = Buffer.from(await response.arrayBuffer());
    const base64 = buffer.toString("base64");

    // Determine media type from file extension
    const ext = path.extname(filePath).toLowerCase();
    const mediaTypeMap: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
    };
    const mediaType = mediaTypeMap[ext] || "image/jpeg";

    const caption = ctx.message.caption || "";
    const content: Array<{type: string; text?: string; source?: any}> = [];
    
    if (caption) {
      content.push({
        type: "text",
        text: caption,
      });
    }
    
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: mediaType,
        data: base64,
      },
    });

    const result = await runAgent(content as any);
    await sendLongMessage(ctx, result.response);
  } catch (err) {
    console.error("Image handling error:", err);
    await ctx.reply(`Error handling image: ${(err as Error).message}`);
  }
});

bot.on("message:document", async (ctx) => {
  if (!isOwner(ctx)) return;

  try {
    const file = await ctx.getFile();
    const filePath = file.file_path;
    if (!filePath) {
      await ctx.reply("Could not retrieve the file.");
      return;
    }

    const url = `https://api.telegram.org/file/bot${config.telegram.botToken}/${filePath}`;
    const response = await fetch(url);
    const buffer = Buffer.from(await response.arrayBuffer());

    // Determine save location from caption or default to secrets dir
    const fileName = ctx.message.document.file_name || "unnamed";
    const caption = ctx.message.caption || "";
    let savePath: string;

    if (caption.startsWith("/") || caption.startsWith("~/")) {
      savePath = caption.replace("~", process.env.HOME || "");
    } else if (caption) {
      savePath = path.join(config.paths.secrets, caption);
    } else {
      savePath = path.join(config.paths.secrets, fileName);
    }

    await fs.mkdir(path.dirname(savePath), { recursive: true });
    await fs.writeFile(savePath, buffer);

    // Let the agent know about the file
    const message = `File received and saved to ${savePath}${caption ? ` (caption: "${caption}")` : ""}`;
    const result = await runAgent(message);
    await sendLongMessage(ctx, result.response);
  } catch (err) {
    console.error("File handling error:", err);
    await ctx.reply(`Error handling file: ${(err as Error).message}`);
  }
});

export async function sendMessageToOwner(text: string): Promise<void> {
  await bot.api.sendMessage(config.telegram.ownerId, text, {
    parse_mode: "Markdown",
  }).catch(() =>
    bot.api.sendMessage(config.telegram.ownerId, text)
  );
}

export function startBot(): void {
  bot.start({
    onStart: () => {
      console.log("Telegram bot started");
    },
  });
}

export function stopBot(): void {
  bot.stop();
}
