import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
} from "discord.js";

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID; // 테스트 서버 (커맨드 등록용)

const ALERT_CHANNEL_ID = process.env.ALERT_CHANNEL_ID; // 길드 서버 #kiki-test 채널 ID
const ALERT_ROLE_ID = process.env.ALERT_ROLE_ID; // (선택) 멘션 역할 ID

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("Missing env: DISCORD_TOKEN / DISCORD_CLIENT_ID / DISCORD_GUILD_ID");
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder().setName("ping").setDescription("키키봇 테스트"),
  new SlashCommandBuilder()
    .setName("testalert")
    .setDescription("길드 서버 알림 채널로 임베드 테스트 발송"),
].map((c) => c.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

async function registerCommands() {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
    body: commands,
  });
  console.log("Registered guild commands");
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", () => console.log(`Logged in as ${client.user.tag}`));

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === "ping") {
      await interaction.reply("pong 🐾 키키봇 온라인!");
      return;
    }

    if (interaction.commandName === "testalert") {
      await interaction.reply({ content: "임베드 테스트 발송 중…", ephemeral: true });

      if (!ALERT_CHANNEL_ID) {
        throw new Error("Missing env: ALERT_CHANNEL_ID");
      }

      const embed = new EmbedBuilder()
        .setTitle("🔔 키키봇 임베드 테스트")
        .setDescription("길드 서버 채널로 임베드 발송 성공!\n\n다음 단계: aa-alert 일정 포맷 이식")
        .setTimestamp(new Date());

      const ch = await client.channels.fetch(ALERT_CHANNEL_ID);
      if (!ch || !("send" in ch)) {
        throw new Error("ALERT_CHANNEL_ID is not a sendable channel");
      }

      const mention = ALERT_ROLE_ID ? `<@&${ALERT_ROLE_ID}>` : undefined;

      await ch.send({
        content: mention,
        embeds: [embed],
        allowedMentions: { roles: ALERT_ROLE_ID ? [ALERT_ROLE_ID] : [] },
      });

      await interaction.editReply("✅ 발송 완료! 길드 서버 #kiki-test 확인해줘.");
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

await registerCommands();
await client.login(TOKEN);
