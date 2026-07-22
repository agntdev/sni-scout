import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  confirmKeyboard,
} from "../toolkit/index.js";

const DEFAULT_MAX_DEPTH = 3;
const MAX_DEPTH = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_SCANS_PER_WINDOW = 3;
const SCAN_RESULT_TTL_SECONDS = 90 * 24 * 60 * 60;

interface HostResult {
  ip_host: string;
  port: number;
  reachable: boolean;
  sni_values: string[];
  tls_details: Record<string, string>;
  timestamp: string;
}

const composer = new Composer<Ctx>();

composer.command("scan", async (ctx) => {
  const status = ctx.session.approvalStatus;
  if (status !== "approved") {
    await ctx.reply("You need access to scan hosts. Use /start to request approval.");
    return;
  }
  const args = ctx.message?.text?.split(/\s+/).slice(1);
  const depthArg = args?.[0];
  let maxDepth = DEFAULT_MAX_DEPTH;
  if (depthArg) {
    const parsed = parseInt(depthArg, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > MAX_DEPTH) {
      await ctx.reply(`Max depth must be 1–${MAX_DEPTH}. Try again.`);
      return;
    }
    maxDepth = parsed;
  }
  if (!ctx.session.scanHosts || ctx.session.scanHosts.length === 0) {
  ctx.session.step = "awaiting_hosts";
  ctx.session.scanMaxDepth = maxDepth;
  await ctx.reply("Send your host list (one host per line, or comma-separated).", {
    reply_markup: { force_reply: true, selective: false },
  } as any);
    return;
  }
  ctx.session.scanMaxDepth = maxDepth;
  ctx.session.step = "scanning";
  await runScan(ctx, ctx.session.scanHosts, maxDepth);
});

composer.callbackQuery("scan:set_depth", async (ctx) => {
  await ctx.answerCallbackQuery();
  const status = ctx.session.approvalStatus;
  if (status !== "approved") {
    await ctx.editMessageText("You need access to scan hosts. Request approval first.", {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    });
    return;
  }
  const depthStr = ctx.callbackQuery.data.split(":")[2];
  const depth = parseInt(depthStr ?? "", 10);
  if (isNaN(depth) || depth < 1 || depth > MAX_DEPTH) {
    await ctx.editMessageText(`Invalid depth. Enter a number 1–${MAX_DEPTH}.`);
    return;
  }
  ctx.session.scanMaxDepth = depth;
  ctx.session.step = "awaiting_hosts";
  await ctx.editMessageText(
    `Max depth set to ${depth}.\n\nSend your host list (one host per line, or comma-separated).`,
    {
      reply_markup: { force_reply: true, selective: false },
    } as any,
  );
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "awaiting_hosts") return next();
  const text = ctx.message.text.trim();
  const lines = text.split(/[\n,]+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) {
    await ctx.reply("No valid hosts found. Send one host per line or comma-separated.");
    return;
  }
  const invalid = lines.filter((h) => !/^[a-zA-Z0-9._:-]+$/.test(h));
  if (invalid.length > 0) {
    await ctx.reply(
      `Invalid host format: ${invalid.slice(0, 3).join(", ")}${invalid.length > 3 ? "…" : ""}\n\nUse hostnames or IPs (e.g. example.com, 1.2.3.4).`,
    );
    return;
  }
  const privateHosts = lines.filter((h) => isPrivateHost(h));
  if (privateHosts.length > 0) {
    await ctx.reply(
      `Private IPs blocked: ${privateHosts.slice(0, 3).join(", ")}${privateHosts.length > 3 ? "…" : ""}\n\nOnly public hosts can be scanned.`,
    );
    return;
  }
  const maxDepth = ctx.session.scanMaxDepth ?? DEFAULT_MAX_DEPTH;
  ctx.session.step = "scanning";
  await runScan(ctx, lines, maxDepth);
});

composer.callbackQuery("scan:confirm:yes", async (ctx) => {
  await ctx.answerCallbackQuery();
  const hosts = ctx.session.scanHosts;
  const depth = ctx.session.scanMaxDepth ?? DEFAULT_MAX_DEPTH;
  if (!hosts || hosts.length === 0) {
    await ctx.editMessageText("No hosts to scan. Use /start to begin.");
    return;
  }
  ctx.session.step = "scanning";
  await runScan(ctx, hosts, depth);
});

composer.callbackQuery("scan:confirm:no", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "idle";
  ctx.session.scanHosts = undefined;
  ctx.session.scanMaxDepth = undefined;
  await ctx.editMessageText("Scan cancelled.", {
    reply_markup: inlineKeyboard([
      [inlineButton("⬅️ Back to menu", "menu:main")],
    ]),
  });
});

async function runScan(ctx: Ctx, hosts: string[], maxDepth: number) {
  const startTime = Date.now();
  const placeholder = await ctx.reply(`Scanning ${hosts.length} host(s)…`);

  const results: HostResult[] = [];
  for (let i = 0; i < hosts.length; i++) {
    const host = hosts[i]!;
    try {
      const result = await scanHost(host, maxDepth);
      results.push(result);
    } catch {
      results.push({
        ip_host: host,
        port: 443,
        reachable: false,
        sni_values: [],
        tls_details: {},
        timestamp: new Date().toISOString(),
      });
    }
    if (i < hosts.length - 1) {
      try {
        await ctx.api.editMessageText(
          ctx.chat!.id,
          placeholder.message_id,
          `Scanning host ${i + 1}/${hosts.length}…`,
        );
      } catch {
        // Message may be too old; ignore
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const reachable = results.filter((r) => r.reachable);
  const unreachable = results.filter((r) => !r.reachable);

  const history = ctx.session.scanHistory ?? [];
  history.push({
    timestamp: new Date().toISOString(),
    hosts,
    maxDepth,
    resultCount: results.length,
    reachableCount: reachable.length,
  });
  ctx.session.scanHistory = history.slice(-20);

  ctx.session.step = "idle";

  if (results.length === 0) {
    await ctx.reply("No hosts were scanned.", {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    });
    return;
  }

  const lines: string[] = [];
  lines.push(`Scan complete in ${elapsed}s.`);
  lines.push("");

  if (reachable.length > 0) {
    lines.push(`Reachable: ${reachable.length}`);
    for (const r of reachable) {
      lines.push(`\n${r.ip_host}:${r.port}`);
      if (r.sni_values.length > 0) {
        lines.push(`  SNI: ${r.sni_values.join(", ")}`);
      }
      if (r.tls_details.subject) {
        lines.push(`  Cert: ${r.tls_details.subject}`);
      }
      if (r.tls_details.issuer) {
        lines.push(`  Issuer: ${r.tls_details.issuer}`);
      }
    }
  }

  if (unreachable.length > 0) {
    lines.push(`\nUnreachable: ${unreachable.length}`);
    for (const r of unreachable) {
      lines.push(`  ${r.ip_host}`);
    }
  }

  const allSni = [...new Set(reachable.flatMap((r) => r.sni_values))];
  if (allSni.length > 0) {
    lines.push(`\nUnique SNI values: ${allSni.length}`);
  }

  await ctx.api.editMessageText(ctx.chat!.id, placeholder.message_id, lines.join("\n"), {
    reply_markup: inlineKeyboard([
      [inlineButton("🔍 New scan", "scan:menu")],
      [inlineButton("⬅️ Back to menu", "menu:main")],
    ]),
  });
}

async function scanHost(host: string, maxDepth: number): Promise<HostResult> {
  const port = 443;
  if (!host) {
    return {
      ip_host: host,
      port,
      reachable: false,
      sni_values: [],
      tls_details: {},
      timestamp: new Date().toISOString(),
    };
  }

  if (isPrivateHost(host)) {
    return {
      ip_host: host,
      port,
      reachable: false,
      sni_values: [],
      tls_details: { error: "Private IP range blocked" },
      timestamp: new Date().toISOString(),
    };
  }

  try {
    const netMod = await import("node:net");
    const tlsMod = await import("node:tls");

    const sniValues: string[] = [];
    const testNames = [host, "www." + host];

    for (const name of testNames) {
      try {
        const connected = await tryConnect(host, port, name, netMod, tlsMod);
        if (connected) {
          sniValues.push(name);
        }
      } catch {
        // SNI not accepted
      }
    }

    const cert = await getCert(host, port, netMod, tlsMod);
    const tlsDetails: Record<string, string> = {};
    if (cert) {
      if (cert.subject) tlsDetails.subject = cert.subject;
      if (cert.issuer) tlsDetails.issuer = cert.issuer;
      if (cert.valid_from) tlsDetails.valid_from = cert.valid_from;
      if (cert.valid_to) tlsDetails.valid_to = cert.valid_to;
    }

    if (sniValues.length === 0 && !cert) {
      return {
        ip_host: host,
        port,
        reachable: false,
        sni_values: [],
        tls_details: {},
        timestamp: new Date().toISOString(),
      };
    }

    return {
      ip_host: host,
      port,
      reachable: true,
      sni_values: sniValues,
      tls_details: tlsDetails,
      timestamp: new Date().toISOString(),
    };
  } catch {
    return {
      ip_host: host,
      port,
      reachable: false,
      sni_values: [],
      tls_details: {},
      timestamp: new Date().toISOString(),
    };
  }
}

function tryConnect(
  host: string,
  port: number,
  servername: string,
  netMod: typeof import("node:net"),
  tlsMod: typeof import("node:tls"),
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const socket = netMod.connect(port, host, () => {
      const tlsSocket = tlsMod.connect(
        { socket, servername, rejectUnauthorized: false },
        () => {
          tlsSocket.destroy();
          socket.destroy();
          resolve(true);
        },
      );
      tlsSocket.on("error", () => {
        socket.destroy();
        reject(new Error("TLS handshake failed"));
      });
    });
    socket.on("error", () => reject(new Error("Connection failed")));
    socket.setTimeout(3000, () => {
      socket.destroy();
      reject(new Error("Connection timeout"));
    });
  });
}

function getCert(
  host: string,
  port: number,
  netMod: typeof import("node:net"),
  tlsMod: typeof import("node:tls"),
): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    const socket = netMod.connect(port, host, () => {
      const tlsSocket = tlsMod.connect(
        { socket, servername: host, rejectUnauthorized: false },
        () => {
          const cert = tlsSocket.getPeerCertificate();
          tlsSocket.destroy();
          socket.destroy();
          if (cert && cert.subject) {
            const subjectCN = Array.isArray(cert.subject.CN) ? cert.subject.CN[0] : cert.subject.CN;
            const issuerCN = cert.issuer
              ? Array.isArray(cert.issuer.CN) ? cert.issuer.CN[0] : cert.issuer.CN
              : "";
            resolve({
              subject: subjectCN || "",
              issuer: issuerCN || "",
              valid_from: cert.valid_from || "",
              valid_to: cert.valid_to || "",
            });
          } else {
            resolve(null);
          }
        },
      );
      tlsSocket.on("error", () => {
        socket.destroy();
        resolve(null);
      });
    });
    socket.on("error", () => resolve(null));
    socket.setTimeout(3000, () => {
      socket.destroy();
      resolve(null);
    });
  });
}

function isPrivateHost(host: string): boolean {
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = host.match(ipv4Regex);
  if (!match) return false;
  const [, a, b] = match;
  const first = parseInt(a!, 10);
  const second = parseInt(b!, 10);
  if (first === 10) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  if (first === 127) return true;
  if (first === 169 && second === 254) return true;
  if (first === 0) return true;
  return false;
}

export default composer;
