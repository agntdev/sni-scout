import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  mainMenuItems,
  inlineButton,
  inlineKeyboard,
} from "../toolkit/index.js";
import { registerMainMenuItem } from "../toolkit/index.js";
import { isAdmin } from "../admin-store.js";

registerMainMenuItem({
  label: "🔍 Scan",
  data: "scan:menu",
  order: 10,
});
registerMainMenuItem({
  label: "📋 Upload hosts",
  data: "upload:host_list",
  order: 20,
});
registerMainMenuItem({
  label: "📜 History",
  data: "history:show",
  order: 30,
});

const composer = new Composer<Ctx>();

const WELCOME =
  "Welcome to SNI Scanner. This bot scans public hosts to discover reachable SNI values and TLS configurations.\n\nTap a button below to get started.";

const APPROVED_MENU =
  "You're all set. Pick an option below.";

const PENDING_MENU =
  "Your access request is pending admin approval. You'll be able to scan once approved.";

const WELCOME_NEW =
  "Tap \"Request Access\" below to request admin approval. Once approved, you can scan public hosts.";

function buildFilteredMenu(userId?: number) {
  const items = mainMenuItems().filter(
    (item) => item.data !== "admin:menu" || (userId != null && isAdmin(userId)),
  );
  const rows: { text: string; data: string }[][] = [];
  for (let i = 0; i < items.length; i += 2) {
    rows.push(items.slice(i, i + 2).map((it) => ({ text: it.label, data: it.data })));
  }
  rows.push([{ text: "❓ Help", data: "menu:help" }]);
  return inlineKeyboard(rows.map((row) => row.map((b) => inlineButton(b.text, b.data))));
}

function buildMenu(ctx: Ctx) {
  const status = ctx.session.approvalStatus;
  if (status === "approved") return APPROVED_MENU;
  if (status === "pending") return PENDING_MENU;
  return WELCOME_NEW;
}

composer.command("start", async (ctx) => {
  const status = ctx.session.approvalStatus;
  if (status === "approved") {
    await ctx.reply(APPROVED_MENU, { reply_markup: buildFilteredMenu(ctx.from?.id) });
  } else if (status === "pending") {
    await ctx.reply(PENDING_MENU, {
      reply_markup: inlineKeyboard([
        [inlineButton("⏳ Pending approval", "register:pending")],
        [inlineButton("❓ Help", "menu:help")],
      ]),
    });
  } else {
    await ctx.reply(WELCOME_NEW, {
      reply_markup: inlineKeyboard([
        [inlineButton("🔐 Request Access", "register:request")],
        [inlineButton("❓ Help", "menu:help")],
      ]),
    });
  }
});

composer.callbackQuery("menu:main", async (ctx) => {
  await ctx.answerCallbackQuery();
  const text = buildMenu(ctx);
  const status = ctx.session.approvalStatus;
  if (status === "approved") {
    await ctx.editMessageText(text, { reply_markup: buildFilteredMenu(ctx.from?.id) });
  } else if (status === "pending") {
    await ctx.editMessageText(text, {
      reply_markup: inlineKeyboard([
        [inlineButton("⏳ Pending approval", "register:pending")],
        [inlineButton("❓ Help", "menu:help")],
      ]),
    });
  } else {
    await ctx.editMessageText(text, {
      reply_markup: inlineKeyboard([
        [inlineButton("🔐 Request Access", "register:request")],
        [inlineButton("❓ Help", "menu:help")],
      ]),
    });
  }
});

composer.callbackQuery("register:request", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId) return;
  ctx.session.approvalStatus = "pending";
  await ctx.editMessageText(
    "Access requested. An admin will review your request.\n\nYou'll be notified once approved.",
    {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    },
  );
});

composer.callbackQuery("register:pending", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    "Your access request is pending. You'll be notified once approved.",
    {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    },
  );
});

composer.callbackQuery("scan:menu", async (ctx) => {
  await ctx.answerCallbackQuery();
  const status = ctx.session.approvalStatus;
  if (status !== "approved") {
    await ctx.editMessageText(
      "You need access to scan hosts. Request approval first.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("🔐 Request Access", "register:request")],
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
    return;
  }
  ctx.session.step = "awaiting_depth";
  await ctx.editMessageText(
    "Enter max scan depth (1–5). Default is 3.\n\nSend a number or tap below for the default.",
    {
      reply_markup: inlineKeyboard([
        [inlineButton("Use default (3)", "scan:set_depth:3")],
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    },
  );
});

composer.callbackQuery("history:show", async (ctx) => {
  await ctx.answerCallbackQuery();
  const status = ctx.session.approvalStatus;
  if (status !== "approved") {
    await ctx.editMessageText(
      "You need access to view scan history. Request approval first.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("🔐 Request Access", "register:request")],
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
    return;
  }
  const history = ctx.session.scanHistory;
  if (!history || history.length === 0) {
    await ctx.editMessageText(
      "No scan history yet. Run a scan to see results here.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("🔍 New scan", "scan:menu")],
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
    return;
  }
  const lines = history.slice(-5).map((h: { resultCount: number; reachableCount: number; timestamp: string }, i: number) => {
    const count = h.resultCount;
    const reachable = h.reachableCount;
    return `${i + 1}. ${count} hosts scanned, ${reachable} reachable — ${new Date(h.timestamp).toLocaleDateString()}`;
  });
  await ctx.editMessageText(`Recent scans:\n\n${lines.join("\n")}`, {
    reply_markup: inlineKeyboard([
      [inlineButton("🔍 New scan", "scan:menu")],
      [inlineButton("⬅️ Back to menu", "menu:main")],
    ]),
  });
});

export default composer;
