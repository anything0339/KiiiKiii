// KiiiKii - Discord bot + ArcheAge event alerts (ported from aa-alert webhook version)
import http from "node:http";
import cron from "node-cron";
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";

/* ------------------ 기존 aa-alert 설정 ------------------ */

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

// NA 고정으로 쓰고 싶으면 그대로 두고, 바꾸고 싶으면 Railway 변수 REGION으로 오버라이드 가능
const REGION = process.env.REGION || "NA";

// 이벤트 데이터(원격 JSON)
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

// (간단 중복 방지) 프로세스 재시작되면 초기화됨
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
  if (!res.ok) throw new Error(`events fetch 실패: ${res.status}`);
  return await res.json();
}

/* ------------------ 스타일 자동 설정(aa-alert 그대로) ------------------ */

function getEmbedColor(name) {
  const n = name.toLowerCase();

  if (n.includes("hiram rift") || n.includes("akasch invasion"))
    return 0x3498db; // 파랑

  if (n.includes("golden plains battle"))
    return 0x9b59b6; // 보라

  if (
    n.includes("kraken") ||
    n.includes("jola, meina, & glenn") ||
    n.includes("black dragon")
  )
    return 0xe74c3c; // 빨강

  if (n.includes("crimson rift") || n.includes("grimghast rift"))
    return 0xf39c12; // 주황

  return 0x95a5a6; // 기본 회색
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

/* ------------------ Discord bot 설정 ------------------ */

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;

// ✅ 테스트 서버(커맨드 등록용). 길드 서버로 보내는 건 별도 채널 ID로 처리
const TEST_GUILD_ID = process.env.DISCORD_GUILD_ID;

// ✅ 실제 알림이 올라갈 길드 서버 채널 ID (병행 테스트는 #kiki-test로)
const ALERT_CHANNEL_ID = process.env.ALERT_CHANNEL_ID;

// (선택) 멘션 역할 ID
const ALERT_ROLE_ID = process.env.ALERT_ROLE_ID || null;

if (!TOKEN || !CLIENT_ID || !TEST_GUILD_ID) {
  console.error("Missing env: DISCORD_TOKEN / DISCORD_CLIENT_ID / DISCORD_GUILD_ID");
  process.exit(1);
}
if (!ALERT_CHANNEL_ID) {
  console.error("Missing env: ALERT_CHANNEL_ID");
  process.exit(1);
}

// 커맨드: 테스트 서버에만 등록
const commands = [
  new SlashCommandBuilder().setName("ping").setDescription("키키봇 체크"),
  new SlashCommandBuilder()
    .setName("testalert")
    .setDescription("길드 서버 알림 채널로 임베드 테스트 발송"),
].map((c) => c.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

async function registerCommands() {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, TEST_GUILD_ID), {
    body: commands,
  });
  console.log("Registered guild commands (test server)");
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function sendToAlertChannel(embedObject) {
  const ch = await client.channels.fetch(ALERT_CHANNEL_ID);
  if (!ch || !("send" in ch)) {
    throw new Error("ALERT_CHANNEL_ID is not a sendable channel");
  }

  const mention = ALERT_ROLE_ID ? `<@&${ALERT_ROLE_ID}>` : undefined;

  await ch.send({
    content: mention,
    embeds: [embedObject],
    allowedMentions: { roles: ALERT_ROLE_ID ? [ALERT_ROLE_ID] : [] },
  });
}

/* ------------------ aa-alert tick (발송만 디스코드로) ------------------ */

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

      // 1분 크론 + 여유 20초
      if (Math.abs(nowEpoch - alertEpoch) <= 20) {
        const minuteBucket = Math.floor(alertEpoch / 60);
        const key = `${ev.id}-${startEpoch}-${leadMin}-${minuteBucket}`;

        if (sent.has(key)) continue;
        sent.add(key);

        // ✅ 임베드 “그대로” 유지 (웹훅 객체 형식 그대로)
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

  // 스케줄 시작
  cron.schedule(CRON, () => tick().catch(console.error), {
    timezone: "Asia/Seoul",
  });

  // 부팅 직후 한 번 실행
  tick().catch(console.error);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === "ping") {
      await interaction.reply("pong 🐾 키키봇 온라인!");
      return;
    }

    if (interaction.commandName === "testalert") {
      await interaction.reply({ content: "임베드 테스트 발송 중…", ephemeral: true });

      const embed = {
        title: "🔔 키키봇 임베드 테스트",
        color: 0x2ecc71,
        description:
          "이 메시지가 길드 서버 채널에 보이면 성공!\n\n(병행 테스트 중이면 #kiki-test로만 보내도록 설정해두자)",
        footer: { text: "kikibot" },
      };

      await sendToAlertChannel(embed);
      await interaction.editReply("✅ 발송 완료! 길드 서버 채널 확인해줘.");
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

// Railway health server (유지)
const port = Number(process.env.PORT || 3000);
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
  })
  .listen(port, "0.0.0.0", () => {
    console.log("health server listening on", port);
  });
