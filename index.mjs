import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID; // 테스트 서버 ID

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("Missing env: DISCORD_TOKEN / DISCORD_CLIENT_ID / DISCORD_GUILD_ID");
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder().setName("ping").setDescription("키키봇 테스트"),
  new SlashCommandBuilder().setName("testalert").setDescription("알림 테스트(커맨드 보이는지 확인)"),
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

  if (interaction.commandName === "ping") {
    await interaction.reply("pong 🐾 키키봇 온라인!");
  }

  if (interaction.commandName === "testalert") {
    await interaction.reply("✅ testalert 커맨드 보임 + 실행됨!");
  }
});

await registerCommands();
await client.login(TOKEN);
