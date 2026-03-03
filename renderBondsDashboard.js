import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { AttachmentBuilder } from "discord.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

GlobalFonts.registerFromPath(
  path.join(__dirname, "Aa보글보글.ttf"),
  "KIKI_FONT"
);

/* ------------------ 재료 정규화 ------------------ */

const MATERIAL_KO = {
  "iron ingots": "철 주괴",
  "iron ingot": "철 주괴",
  iron: "철 주괴",
  "철 주괴": "철 주괴",
  "철주괴": "철 주괴",

  leather: "가죽",
  "가죽": "가죽",

  lumber: "목재",
  wood: "목재",
  "목재": "목재",

  fabric: "옷감",
  cloth: "옷감",
  "옷감": "옷감",
};

const MATERIAL_ORDER = ["철 주괴", "가죽", "목재", "옷감"];

const MAT_EMOJI = {
  "철 주괴": "⛓️",
  "가죽": "🦬",
  "목재": "🪵",
  "옷감": "🧵",
};

export function normMaterial(input) {
  const key = String(input ?? "").trim().toLowerCase();
  return MATERIAL_KO[key] ?? null;
}

/* ------------------ 입력 파싱 ------------------ */

export function parseBondsLines(raw) {
  if (!raw) return [];

  const segments = String(raw)
    .split(/\n|,|\/+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const items = [];
  let currentMaterial = null;

  for (const seg of segments) {
    const tokens = seg.split(/\s+/);
    if (tokens.length < 2) continue;

    const qty = Number(tokens[tokens.length - 1]);
    if (![20, 60, 100].includes(qty)) continue;

    const firstTwo = tokens.slice(0, 2).join(" ");
    const firstOne = tokens[0];

    let material = normMaterial(firstTwo);
    let townStartIdx = 2;

    if (!material) {
      material = normMaterial(firstOne);
      townStartIdx = 1;
    }

    if (material) {
      currentMaterial = material;
    } else {
      if (!currentMaterial) continue;
      material = currentMaterial;
      townStartIdx = 0;
    }

    const town = tokens.slice(townStartIdx, tokens.length - 1).join(" ").trim();
    if (!town) continue;

    items.push({ material, town, qty });
  }

  return items;
}

/* ------------------ 유틸 ------------------ */

function formatStamp() {
  return new Date().toLocaleString("ko-KR");
}

function ellipsize(ctx, text, maxWidth) {
  const s = String(text ?? "");
  if (ctx.measureText(s).width <= maxWidth) return s;

  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const t = s.slice(0, mid) + "…";
    if (ctx.measureText(t).width <= maxWidth) lo = mid + 1;
    else hi = mid;
  }
  return s.slice(0, Math.max(1, lo - 1)) + "…";
}

function groupByMaterial(items) {
  const map = new Map();
  for (const m of MATERIAL_ORDER) map.set(m, []);
  for (const it of items) {
    if (!map.has(it.material)) map.set(it.material, []);
    map.get(it.material).push(it);
  }
  return map;
}

/* ------------------ 렌더 ------------------ */

export function renderBondsDashboardPng({ title = "동대륙 채권", items = [] }) {
  const grouped = groupByMaterial(items);

  const W = 800;
  const pad = 28;

  const titleBoxH = 78;
  const headerH = 50;
  const rowH = 50;

  const tableX = pad;
  const tableY = pad + titleBoxH + 16;
  const tableW = W - pad * 2;

  const colMatW = 170;
  const colQtyW = 95;
  const colTownW = tableW - colMatW - colQtyW;

  const totalRows = items.length;
  const tableH = headerH + totalRows * rowH;
  const H = tableY + tableH + pad;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  /* 배경 */
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  /* 타이틀 박스 */
  ctx.fillStyle = "#eef1f7";
  ctx.fillRect(pad, pad, W - pad * 2, titleBoxH);

  ctx.fillStyle = "#111827";
  ctx.font = "800 38px KIKI_FONT";
  ctx.textAlign = "center";
  ctx.fillText(title, W / 2, pad + 45);

  ctx.fillStyle = "#6b7280";
  ctx.font = "20px KIKI_FONT";
  ctx.fillText(formatStamp(), W / 2, pad + 68);

  ctx.textAlign = "left";

  /* 표 외곽 */
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#9ca3af";
  ctx.strokeRect(tableX, tableY, tableW, tableH);
  ctx.lineWidth = 1;

  /* 헤더 */
  ctx.strokeStyle = "#d1d5db";
  ctx.fillStyle = "#f3f4f6";

  ctx.fillRect(tableX, tableY, colMatW, headerH);
  ctx.strokeRect(tableX, tableY, colMatW, headerH);

  ctx.fillRect(tableX + colMatW, tableY, colTownW, headerH);
  ctx.strokeRect(tableX + colMatW, tableY, colTownW, headerH);

  ctx.fillRect(tableX + colMatW + colTownW, tableY, colQtyW, headerH);
  ctx.strokeRect(tableX + colMatW + colTownW, tableY, colQtyW, headerH);

  ctx.fillStyle = "#374151";
  ctx.font = "700 22px KIKI_FONT";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.fillText("재료", tableX + colMatW / 2, tableY + headerH / 2);
  ctx.fillText("마을", tableX + colMatW + colTownW / 2, tableY + headerH / 2);
  ctx.fillText(
    "수량",
    tableX + colMatW + colTownW + colQtyW / 2,
    tableY + headerH / 2
  );

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  let cursorY = tableY + headerH;

  for (const mat of MATERIAL_ORDER) {
    const rows = grouped.get(mat) ?? [];
    if (!rows.length) continue;

    const groupH = rows.length * rowH;

    /* 재료 병합 셀 */
    ctx.fillStyle = "#f4f6fb";
    ctx.fillRect(tableX, cursorY, colMatW, groupH);
    ctx.strokeRect(tableX, cursorY, colMatW, groupH);

    ctx.fillStyle = "#1f2937";
    ctx.font = "900 22px KIKI_FONT";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      `${MAT_EMOJI[mat] ?? ""} ${mat}`,
      tableX + colMatW / 2,
      cursorY + groupH / 2
    );

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    rows.forEach((it, i) => {
      const y = cursorY + i * rowH;

      ctx.fillStyle = i % 2 === 0 ? "#ffffff" : "#fafafa";

      ctx.fillRect(tableX + colMatW, y, colTownW, rowH);
      ctx.strokeRect(tableX + colMatW, y, colTownW, rowH);

      ctx.fillRect(tableX + colMatW + colTownW, y, colQtyW, rowH);
      ctx.strokeRect(tableX + colMatW + colTownW, y, colQtyW, rowH);

      /* 마을 가운데 정렬 */
      ctx.fillStyle = "#111827";
      ctx.font = "22px KIKI_FONT";
      const town = ellipsize(ctx, it.town, colTownW - 16);

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        town,
        tableX + colMatW + colTownW / 2,
        y + rowH / 2
      );

      /* 수량 오른쪽 정렬 */
      const qtyColor =
        it.qty === 100 ? "#dc2626" :
        it.qty === 60 ? "#d97706" :
        "#059669";

      ctx.fillStyle = qtyColor;
      ctx.font = "900 22px KIKI_FONT";
      ctx.textAlign = "right";
      ctx.fillText(
        String(it.qty),
        tableX + tableW - 12,
        y + rowH / 2
      );

      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    });

    cursorY += groupH;
  }

  const buf = canvas.toBuffer("image/png");
  return new AttachmentBuilder(buf, { name: "bonds_east.png" });
}
