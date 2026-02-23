// index.mjs
// KiiiKii - Discord bot + ArcheAge event alerts + basic server management commands

import fs from "node:fs/promises";
import http from "node:http";
import cron from "node-cron";
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionsBitField,
} from "discord.js";

/* ------------------ config (persist) ------------------ */

const CONFIG_PATH = "./config.json";
let CONFIG = {
  alertChannelId: process.env.ALERT_CHANNEL_ID, // default from env (initial)
  mutedUntil: 0, // epoch ms
};

async function loadConfig() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    CONFIG = { ...CONFIG, ...JSON.parse(raw) };
  } catch {
    // ignore if not exists
  }
}

async function saveConfig() {
  await fs.writeFile(CONFIG_PATH, JSON.stringify(CONFIG, null, 2), "utf8");
}

/* ------------------ aa-alert settings ------------------ */

const NAME_MAP = {
  "black dragon": "검은 용",
  "golden plains battle": "황평",
  "hiram rift": "히라마 징조",
  "akasch invasion": "침공",
  "kraken": "크라켄",
  "jola, meina, & glenn": "샤글레",
  "crimson rift": "낮징",
  "crimson rift (auroria)": "태들징",
  "grimghast rift": "밤징",
};

const REGION = process.env.REGION || "NA";

const EVENTS_URL =
  "https://raw.githubusercontent.com/Archey6/archeage-tools/data/static/service/eventsNoDST.json";

const TARGETS = [
  "Hiram Rift",
  "Akasch Invasion",
  "Kraken",
  "Jola, Meina, & Glenn",
  "Black Dragon",
  "Golden Plains Battle",
  "Crimson Rift",
  "Crimson Rift (Auroria)",
  "Grimghast Rift",
].map((s) => s.toLowerCase());

const LEADS_MIN = [10, 1];
const CRON = "*/1 * * * *";

const sent = new Set();

const WEEKDAY = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
};

function hmsToSec(hms) {
  const m = String(hms ?? "").match(/^(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function nextOccurrenceUtc(timesEntry, now = new Date()) {
  const tSec = hmsToSec(timesEntry.time);
  if (tSec == null) return null;

  const allowedDays = Array.isArray(timesEntry.days) ? timesEntry.days : null;
  const allowedSet = allowedDays
    ? new Set(
        allowedDays
          .map((d) => WEEKDAY[String(d).toUpperCase()])
          .filter((x) => Number.isInteger(x))
      )
    : null;

  let candidate = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      0,
      0,
      0
    ) + tSec * 1000
  );

  const advanceToAllowed = () => {
    if (!allowedSet) return;
    for (let i = 0; i < 8; i++) {
      if (allowedSet.has(candidate.getUTCDay())) return;
      candidate = new Date(candidate.getTime() + 24 * 3600 * 1000);
    }
  };

  advanceToAllowed();

  if (candidate.getTime() <= now.getTime()) {
    candidate = new Date(candidate.getTime() + 24 * 3600 * 1000);
    advanceToAllowed();
  }

  return candidate;
}

async function fetchEvents() {
  const res = await fetch(EVENTS_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`events fetch failed: ${res.status}`);
  return await res.json();
}

/* ------------------ embed styling ------------------ */

function getEmbedColor(name) {
  const n = name.toLowerCase();

  if (n.includes("hiram rift") || n.includes("akasch invasion"))
    return 0x3498db;

  if (n.includes("golden plains battle"))
    return 0x9b59b6;

  if (
    n.includes("kraken") ||
    n.includes("jola, meina, & glenn") ||
    n.includes("black dragon")
  )
    return 0xe74c3c;

  if (n.includes("crimson rift") || n.includes("grimghast rift"))
    return 0xf39c12;

  return 0x95a5a6;
}

function getEmoji(name) {
  const n = name.toLowerCase();

  if (n.includes("hiram rift")) return "🌀";
  if (n.includes("akasch invasion")) return "🌌";
  if (n.includes("kraken")) return "🐙";
  if (n.includes("jola, meina, & glenn")) return "🔥";
  if (n.includes("black dragon")) return "🐉";
  if (n.includes("golden plains battle")) return "⚔️";
  if (n.includes("crimson rift (auroria)")) return "😈";
  if (n.includes("crimson rift")) return "☀️";
  if (n.includes("grimghast rift")) return "🌙";

  return "⏰";
}

/* ------------------ Discord bot settings ------------------ */

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const TEST_GUILD_ID = process.env.DISCORD_GUILD_ID; // commands register target guild
const ALERT_ROLE_ID = process.env.ALERT_ROLE_ID || null;

if (!TOKEN || !CLIENT_ID || !TEST_GUILD_ID) {
  console.error(
    "Missing env: DISCORD_TOKEN / DISCORD_CLIENT_ID / DISCORD_GUILD_ID"
  );
  process.exit(1);
}
if (!process.env.ALERT_CHANNEL_ID) {
  console.error("Missing env: ALERT_CHANNEL_ID");
  process.exit(1);
}

/* ------------------ Slash Commands ------------------ */

const commands = [
  new SlashCommandBuilder().setName("ping").setDescription("키키봇 체크"),

  new SlashCommandBuilder()
    .setName("setchannel")
    .setDescription("현재 채널을 알림 채널로 설정"),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("키키봇 상태/설정 확인"),

  new SlashCommandBuilder()
    .setName("mute")
    .setDescription("알림을 잠깐 끕니다 (분 단위)")
    .addIntegerOption((o) =>
      o
        .setName("minutes")
        .setDescription("몇 분 동안 끌까?")
        .setRequired(true)
        .setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName("testalert")
    .setDescription("알림 채널로 임베드 테스트 발송"),
].map((c) => c.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

async function registerCommands() {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, TEST_GUILD_ID), {
    body: commands,
  });
  console.log("Registered guild commands for guild:", TEST_GUILD_ID);
}

/* ------------------ client ------------------ */

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function requireManageGuild(interaction) {
  const perms = interaction.memberPermissions;
  return perms?.has(PermissionsBitField.Flags.ManageGuild);
}

async function sendToAlertChannel(embedObject) {
  const now = Date.now();
  if (CONFIG.mutedUntil && now < CONFIG.mutedUntil) return;

  const channelId = CONFIG.alertChannelId || process.env.ALERT_CHANNEL_ID;
  const ch = await client.channels.fetch(channelId);
  if (!ch || !("send" in ch)) {
    throw new Error("Configured alertChannelId is not a sendable channel");
  }

  const mention = ALERT_ROLE_ID ? `<@&${ALERT_ROLE_ID}>` : undefined;

  await ch.send({
    content: mention,
    embeds: [embedObject],
    allowedMentions: { roles: ALERT_ROLE_ID ? [ALERT_ROLE_ID] : [] },
  });
}

/* ------------------ aa-alert tick ------------------ */

async function tick() {
  const now = new Date();
  const nowEpoch = Math.floor(now.getTime() / 1000);

  const events = await fetchEvents();

  for (const ev of events) {
    if (ev.disabled) continue;

    const nameLower = String(ev.name ?? "").toLowerCase();
    if (!TARGETS.some((k) => nameLower.includes(k))) continue;

    const baseName = nameLower;
    const displayName = NAME_MAP[nameLower] ?? ev.name;

    const timesExact = ev.times?.filter((t) => t.region === REGION) ?? [];
    const timesFallback = ev.times?.filter((t) => t.region == null) ?? [];
    const times = timesExact.length ? timesExact : timesFallback;
    if (!times.length) continue;

    let bestNext = null;
    for (const t of times) {
      const next = nextOccurrenceUtc(t, now);
      if (!next) continue;
      if (!bestNext || next.getTime() < bestNext.getTime()) bestNext = next;
    }
    if (!bestNext) continue;

    const startEpoch = Math.floor(bestNext.getTime() / 1000);

    for (const leadMin of LEADS_MIN) {
      const alertEpoch = startEpoch - leadMin * 60;

      // cron every 1 min + 20 sec tolerance
      if (Math.abs(nowEpoch - alertEpoch) <= 20) {
        const minuteBucket = Math.floor(alertEpoch / 60);
        const key = `${ev.id}-${startEpoch}-${leadMin}-${minuteBucket}`;
        if (sent.has(key)) continue;
        sent.add(key);

        const embed = {
          title: `${getEmoji(baseName)} ${displayName}`,
          color: getEmbedColor(baseName),
          description:
            `**시작:** <t:${startEpoch}:F>\n` + `**${leadMin}분 전 알림**`,
          footer: { text: `${REGION} · Archeage Event Alert` },
        };

        await sendToAlertChannel(embed);
      }
    }
  }
}

/* ------------------ bot events ------------------ */

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log("AA alert (bot) started");

  await loadConfig();

  cron.schedule(CRON, () => tick().catch(console.error), {
    timezone: "Asia/Seoul",
  });

  tick().catch(console.error);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    // ping
    if (interaction.commandName === "ping") {
      await interaction.reply("pong 🐾 키키봇 온라인!");
      return;
    }

    // setchannel
    if (interaction.commandName === "setchannel") {
      await interaction.deferReply({ ephemeral: true });

      if (!requireManageGuild(interaction)) {
        await interaction.editReply(
          "❌ 이 명령어는 **서버 관리 권한(Manage Server)** 이 필요해."
        );
        return;
      }

      CONFIG.alertChannelId = interaction.channelId;
      await saveConfig();

      await interaction.editReply(
        `✅ 이 채널을 알림 채널로 설정했어: <#${CONFIG.alertChannelId}>`
      );
      return;
    }

    // status
    if (interaction.commandName === "status") {
      const muted =
        CONFIG.mutedUntil && Date.now() < CONFIG.mutedUntil
          ? `<t:${Math.floor(CONFIG.mutedUntil / 1000)}:F>까지`
          : "아님";

      await interaction.reply({
        ephemeral: true,
        embeds: [
          {
            title: "📌 키키봇 상태",
            description:
              `**알림 채널:** <#${CONFIG.alertChannelId || process.env.ALERT_CHANNEL_ID}>\n` +
              `**Mute:** ${muted}\n` +
              `**REGION:** ${REGION}\n` +
              `**CRON:** ${CRON}`,
          },
        ],
      });
      return;
    }

    // mute
    if (interaction.commandName === "mute") {
      await interaction.deferReply({ ephemeral: true });

      if (!requireManageGuild(interaction)) {
        await interaction.editReply(
          "❌ 이 명령어는 **서버 관리 권한(Manage Server)** 이 필요해."
        );
        return;
      }

      const minutes = interaction.options.getInteger("minutes", true);
      CONFIG.mutedUntil = Date.now() + minutes * 60 * 1000;
      await saveConfig();

      await interaction.editReply(`🔕 ${minutes}분 동안 알림을 꺼둘게!`);
      return;
    }

    // testalert
    if (interaction.commandName === "testalert") {
      await interaction.deferReply({ ephemeral: true });

      const embed = {
        title: "🔔 키키봇 임베드 테스트",
        color: 0x2ecc71,
        description: "이 메시지가 알림 채널에 보이면 성공!",
        footer: { text: "kikibot" },
      };

      await sendToAlertChannel(embed);
      await interaction.editReply("✅ 발송 완료! 알림 채널 확인해줘.");
      return;
    }
  } catch (err) {
    console.error(err);
    const msg = `❌ 실패: ${err?.message ?? "unknown error"}`;
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(msg);
    } else {
      await interaction.reply({ content: msg, ephemeral: true });
    }
  }
});

/* ------------------ start ------------------ */

await registerCommands();
await client.login(TOKEN);

// Railway health server
const port = Number(process.env.PORT || 3000);
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
  })
  .listen(port, "0.0.0.0", () => {
    console.log("health server listening on", port);
  });
