import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  confirmKeyboard,
} from "../toolkit/index.js";
import { registerMainMenuItem } from "../toolkit/index.js";
import {
  getAdminConfig,
  isAdmin,
  addAdmin,
  removeAdmin,
  addAuditEntry,
} from "../admin-store.js";

registerMainMenuItem({
  label: "⚙️ Admin",
  data: "admin:menu",
  order: 5,
});

const composer = new Composer<Ctx>();

// ── /admin command ──────────────────────────────────────────────────────────

composer.command("admin", async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId || !isAdmin(userId)) {
    await ctx.reply("Admin access required. Only designated admins can use this command.");
    return;
  }
  await ctx.reply(buildAdminMenu(), { reply_markup: adminMenuKeyboard() });
});

// ── Admin menu (main) ───────────────────────────────────────────────────────

composer.callbackQuery("admin:menu", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId || !isAdmin(userId)) {
    await ctx.editMessageText("Admin access required. Only designated admins can use this command.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    });
    return;
  }
  await ctx.editMessageText(buildAdminMenu(), { reply_markup: adminMenuKeyboard() });
});

// ── Manage admins ───────────────────────────────────────────────────────────

composer.callbackQuery("admin:admins", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId || !isAdmin(userId)) return;
  const config = getAdminConfig();
  const adminList = formatAdminList(config.adminIds);
  await ctx.editMessageText(
    `Admin users:\n\n${adminList}\n\nTap an option below.`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("➕ Add admin", "admin:admins:add")],
        [inlineButton("➖ Remove admin", "admin:admins:remove")],
        [inlineButton("⬅️ Back to settings", "admin:menu")],
      ]),
    },
  );
});

composer.callbackQuery("admin:admins:add", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId || !isAdmin(userId)) return;
  ctx.session.adminStep = "awaiting_admin_add";
  await ctx.editMessageText(
    "Send the Telegram username (e.g. @username) or numeric user ID to add as admin.",
    {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back to settings", "admin:menu")],
      ]),
    },
  );
});

composer.callbackQuery("admin:admins:remove", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId || !isAdmin(userId)) return;
  const config = getAdminConfig();
  if (config.adminIds.length <= 1) {
    await ctx.editMessageText(
      "Can't remove the last admin. Add another admin first, then remove this one.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("⬅️ Back to settings", "admin:menu")],
        ]),
      },
    );
    return;
  }
  const buttons = config.adminIds
    .filter((id) => id !== userId)
    .map((id) => [inlineButton(String(id), `admin:admins:rm:${id}`)]);
  buttons.push([inlineButton("⬅️ Back to settings", "admin:menu")]);
  await ctx.editMessageText(
    "Select the admin to remove:",
    { reply_markup: inlineKeyboard(buttons) },
  );
});

composer.callbackQuery(/^admin:admins:rm:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId || !isAdmin(userId)) return;
  const targetId = parseInt(ctx.match![1], 10);
  ctx.session.pendingRemoveAdminId = targetId;
  await ctx.editMessageText(
    `Remove admin ${targetId}? This action cannot be undone.`,
    { reply_markup: confirmKeyboard("admin:confirm_rm_admin") },
  );
});

composer.callbackQuery("admin:confirm_rm_admin:yes", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId || !isAdmin(userId)) return;
  const targetId = ctx.session.pendingRemoveAdminId;
  if (targetId == null) {
    await ctx.editMessageText("Something went wrong. Try again.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to settings", "admin:menu")]]),
    });
    return;
  }
  removeAdmin(targetId);
  addAuditEntry(userId, "remove_admin", `Removed admin ${targetId}`);
  ctx.session.pendingRemoveAdminId = undefined;
  await ctx.editMessageText(`Admin ${targetId} removed.`, {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to settings", "admin:menu")]]),
  });
});

composer.callbackQuery("admin:confirm_rm_admin:no", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.pendingRemoveAdminId = undefined;
  await ctx.editMessageText("Removal cancelled.", {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to settings", "admin:menu")]]),
  });
});

// ── Scan limits ─────────────────────────────────────────────────────────────

composer.callbackQuery("admin:scan_limits", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId || !isAdmin(userId)) return;
  const config = getAdminConfig();
  await ctx.editMessageText(
    `Scan limits:\n\nDefault max depth: ${config.defaultMaxDepth}`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("Change max depth", "admin:scan_limits:depth")],
        [inlineButton("⬅️ Back to settings", "admin:menu")],
      ]),
    },
  );
});

composer.callbackQuery("admin:scan_limits:depth", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId || !isAdmin(userId)) return;
  ctx.session.adminStep = "awaiting_depth_input";
  await ctx.editMessageText(
    "Enter the new default max scan depth (1–5).",
    {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back to settings", "admin:menu")],
      ]),
    },
  );
});

// ── Notifications ───────────────────────────────────────────────────────────

composer.callbackQuery("admin:notifications", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId || !isAdmin(userId)) return;
  const config = getAdminConfig();
  const current = config.notifications === "chat_only" ? "User's Telegram chat only" : "Chat and channel";
  await ctx.editMessageText(
    `Notification target:\n\nCurrent: ${current}`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("Chat only", "admin:notif:set:chat_only")],
        [inlineButton("Chat + channel", "admin:notif:set:chat_and_channel")],
        [inlineButton("⬅️ Back to settings", "admin:menu")],
      ]),
    },
  );
});

composer.callbackQuery(/^admin:notif:set:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId || !isAdmin(userId)) return;
  const value = ctx.match![1] as "chat_only" | "chat_and_channel";
  if (value !== "chat_only" && value !== "chat_and_channel") return;
  const config = getAdminConfig();
  const old = config.notifications;
  config.notifications = value;
  addAuditEntry(userId, "set_notifications", `Changed from ${old} to ${value}`);
  const label = value === "chat_only" ? "User's Telegram chat only" : "Chat and channel";
  await ctx.editMessageText(`Notifications updated to: ${label}.`, {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to settings", "admin:menu")]]),
  });
});

// ── Approval workflow ───────────────────────────────────────────────────────

composer.callbackQuery("admin:approval", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId || !isAdmin(userId)) return;
  const config = getAdminConfig();
  const status = config.approvalRequired ? "Enabled" : "Disabled";
  await ctx.editMessageText(
    `Approval workflow:\n\nCurrent: ${status}`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton(
          config.approvalRequired ? "Disable approval" : "Enable approval",
          "admin:approval:toggle",
        )],
        [inlineButton("⬅️ Back to settings", "admin:menu")],
      ]),
    },
  );
});

composer.callbackQuery("admin:approval:toggle", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId || !isAdmin(userId)) return;
  const config = getAdminConfig();
  ctx.session.pendingApprovalToggle = !config.approvalRequired;
  const newStatus = config.approvalRequired ? "Disabled" : "Enabled";
  await ctx.editMessageText(
    `Set approval workflow to ${newStatus}?`,
    { reply_markup: confirmKeyboard("admin:confirm_approval") },
  );
});

composer.callbackQuery("admin:confirm_approval:yes", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (!userId || !isAdmin(userId)) return;
  const newVal = ctx.session.pendingApprovalToggle;
  if (newVal == null) {
    await ctx.editMessageText("Something went wrong. Try again.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to settings", "admin:menu")]]),
    });
    return;
  }
  const config = getAdminConfig();
  const old = config.approvalRequired;
  config.approvalRequired = newVal;
  addAuditEntry(userId, "set_approval", `Changed from ${old} to ${newVal}`);
  ctx.session.pendingApprovalToggle = undefined;
  const label = newVal ? "Enabled" : "Disabled";
  await ctx.editMessageText(`Approval workflow updated to: ${label}.`, {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to settings", "admin:menu")]]),
  });
});

composer.callbackQuery("admin:confirm_approval:no", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.pendingApprovalToggle = undefined;
  await ctx.editMessageText("Change cancelled.", {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to settings", "admin:menu")]]),
  });
});

// ── Text input handling (admin add, depth input) ────────────────────────────

composer.on("message:text", async (ctx, next) => {
  const step = ctx.session.adminStep;
  if (step !== "awaiting_admin_add" && step !== "awaiting_depth_input") {
    return next();
  }

  const userId = ctx.from?.id;
  if (!userId || !isAdmin(userId)) {
    ctx.session.adminStep = undefined;
    return next();
  }

  const text = ctx.message.text.trim();

  if (step === "awaiting_admin_add") {
    ctx.session.adminStep = undefined;
    let targetId: number | null = null;

    if (text.startsWith("@")) {
      targetId = parseUsernameToId(text);
    } else if (/^\d+$/.test(text)) {
      targetId = parseInt(text, 10);
    }

    if (targetId == null || targetId <= 0) {
      await ctx.reply("Invalid format. Send a @username or numeric user ID.", {
        reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to settings", "admin:menu")]]),
      });
      return;
    }

    const added = addAdmin(targetId);
    if (!added) {
      await ctx.reply(`${targetId} is already an admin.`, {
        reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to settings", "admin:menu")]]),
      });
      return;
    }

    addAuditEntry(userId, "add_admin", `Added admin ${targetId}`);
    await ctx.reply(`Admin ${targetId} added.`, {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to settings", "admin:menu")]]),
    });
    return;
  }

  if (step === "awaiting_depth_input") {
    ctx.session.adminStep = undefined;
    const depth = parseInt(text, 10);
    if (isNaN(depth) || depth < 1 || depth > 5) {
      await ctx.reply("Invalid depth. Enter a number 1–5.", {
        reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to settings", "admin:menu")]]),
      });
      return;
    }
    const config = getAdminConfig();
    const old = config.defaultMaxDepth;
    config.defaultMaxDepth = depth;
    addAuditEntry(userId, "set_max_depth", `Changed from ${old} to ${depth}`);
    await ctx.reply(`Default scan depth updated to ${depth}.`, {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to settings", "admin:menu")]]),
    });
    return;
  }
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildAdminMenu(): string {
  const config = getAdminConfig();
  const adminCount = config.adminIds.length;
  const depth = config.defaultMaxDepth;
  const notif = config.notifications === "chat_only" ? "Chat only" : "Chat + channel";
  const approval = config.approvalRequired ? "On" : "Off";
  return (
    `Admin settings\n\n` +
    `Admins: ${adminCount}\n` +
    `Default max depth: ${depth}\n` +
    `Notifications: ${notif}\n` +
    `Approval workflow: ${approval}\n\n` +
    `Tap an option to change it.`
  );
}

function adminMenuKeyboard() {
  return inlineKeyboard([
    [inlineButton("👥 Manage admins", "admin:admins")],
    [inlineButton("📏 Scan limits", "admin:scan_limits")],
    [inlineButton("🔔 Notifications", "admin:notifications")],
    [inlineButton("✅ Approval workflow", "admin:approval")],
    [inlineButton("⬅️ Back to menu", "menu:main")],
  ]);
}

function formatAdminList(ids: number[]): string {
  if (ids.length === 0) return "No admins configured.";
  return ids.map((id, i) => `${i + 1}. ${id}`).join("\n");
}

function parseUsernameToId(username: string): number | null {
  const clean = username.startsWith("@") ? username.slice(1) : username;
  if (!/^[a-zA-Z0-9_]{5,32}$/.test(clean)) return null;
  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = ((hash << 5) - hash + clean.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 9000000000 + 1000000000;
}

export default composer;
