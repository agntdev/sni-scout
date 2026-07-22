import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";

const composer = new Composer<Ctx>();

composer.callbackQuery("upload:host_list", async (ctx) => {
  await ctx.answerCallbackQuery();
  const status = ctx.session.approvalStatus;
  if (status !== "approved") {
    await ctx.editMessageText(
      "You need access to upload host lists. Request approval first.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("🔐 Request Access", "register:request")],
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
    return;
  }
  ctx.session.step = "awaiting_hosts";
  await ctx.editMessageText(
    "Send your host list (one host per line, or comma-separated).\n\nExamples:\nexample.com\n1.2.3.4, 5.6.7.8",
    {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    },
  );
});

export default composer;
