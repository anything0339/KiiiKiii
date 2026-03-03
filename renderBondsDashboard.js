// renderBondsDashboard.js
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { AttachmentBuilder } from "discord.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * ✅ 폰트 등록 (레포 루트에 Aa보글보글.ttf가 있을 때)
 *   - 만약 나중에 fonts/ 폴더로 옮기면 path.join(__dirname, "fonts", "Aa보글보글.ttf") 로 바꾸면 됨
 */
GlobalFonts.registerFromPath(
  path.join(__dirname, "Aa보글보글.ttf"),
  "KIKI_FONT"
);

/* ---------------------------
   1) 재료 정규화/번역
---------------------------- */
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

/* ---------------------------
   2) 입력 파싱 (세로줄 없이 띄어쓰기)
   예)
   철 주괴 동틀녘 반도 20
   가죽 마하데비 60
   목재 하슬라 100
---------------------------- */
export function parseBondsLines(raw) {
  if (!raw) return [];

  // 1️⃣ 줄바꿈 + 쉼표 + 슬래시 모두 구분자로 사용
  const segments = String(raw)
    .split(/\n|,|\/+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const items = [];

  for (const seg of segments) {
    const tokens = seg.split(/\s+/);
    if (tokens.length < 3) continue;

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

    if (!material) continue;

    const town = tokens.slice(townStartIdx, tokens.length - 1).join(" ").trim();
    if (!town) continue;

    items.push({ material, town, qty });
  }

  return items;
}

/* ---------------------------
   3) 렌더 유틸
---------------------------- */
function drawRoundedRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
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

function formatStamp() {
  return new Date().toLocaleString("ko-KR");
}

function groupByMaterial(items) {
  const map = new Map();
  for (const m of MATERIAL_ORDER) map.set(m, []);

  for (const it of items) {
    if (!map.has(it.material)) map.set(it.material, []);
    map.get(it.material).push(it);
  }

  for (const m of MATERIAL_ORDER) {
    const arr = map.get(m) ?? [];
    arr.sort((a, b) => a.town.localeCompare(b.town, "ko"));
  }

  return map;
}

/* ---------------------------
   4) PNG 렌더 (게임UI + 엑셀표 / 재료 셀 병합)
---------------------------- */
export function renderBondsDashboardPng({ title = "동대륙 채권", items = [] }) {
  const grouped = groupByMaterial(items);

  // 레이아웃
  const W = 1000;
  const pad = 28;

  const titleBoxH = 78;
  const titleGap = 18;

  const headerH = 52;
  const rowH = 52;

  const tableX = pad;
  const tableY = pad + titleBoxH + titleGap;
  const tableW = W - pad * 2;

  const colMatW = 190; // 재료(병합)
  const colQtyW = 110; // 수량
  const colTownW = tableW - colMatW - colQtyW;

  // 총 행 수(아이템 개수만큼)
  const totalRows = items.length;
  const tableH = headerH + totalRows * rowH;

  // 전체 높이 계산
  const H = tableY + tableH + pad;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // 배경 흰색
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // 타이틀 박스 (살짝 UI 느낌만)
  ctx.fillStyle = "#f6f7fb";
  drawRoundedRect(ctx, pad, pad, W - pad * 2, titleBoxH, 16);
  ctx.fill();

  // 타이틀 중앙
  ctx.fillStyle = "#111827";
  ctx.font = "700 40px KIKI_FONT";
  ctx.textAlign = "center";
  ctx.fillText(title, W / 2, pad + 48);

  // 시간(작게)
  ctx.fillStyle = "#6b7280";
  ctx.font = "22px KIKI_FONT";
  ctx.fillText(formatStamp(), W / 2, pad + 72);
  ctx.textAlign = "left";

  // 표 헤더 (3칸 분할 + 가운데 정렬)
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#d1d5db"; // 엑셀 선

  // 재료 헤더 셀
  ctx.fillStyle = "#f3f4f6";
  ctx.fillRect(tableX, tableY, colMatW, headerH);
  ctx.strokeRect(tableX, tableY, colMatW, headerH);

  // 마을 헤더 셀
  ctx.fillStyle = "#f3f4f6";
  ctx.fillRect(tableX + colMatW, tableY, colTownW, headerH);
  ctx.strokeRect(tableX + colMatW, tableY, colTownW, headerH);

  // 수량 헤더 셀
  ctx.fillStyle = "#f3f4f6";
  ctx.fillRect(tableX + colMatW + colTownW, tableY, colQtyW, headerH);
  ctx.strokeRect(tableX + colMatW + colTownW, tableY, colQtyW, headerH);

  // 헤더 텍스트: 가운데 정렬 (수량도 헤더는 가운데)
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

  // 원복
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";;

  // 줄무늬
  const rowFill = (i) => (i % 2 === 0 ? "#ffffff" : "#fafafa");

  // 본문 시작
  let cursorY = tableY + headerH;

  // 재료별로 그리되, 왼쪽은 “병합 셀”로 한 번만
  for (const mat of MATERIAL_ORDER) {
    const rows = grouped.get(mat) ?? [];
    if (!rows.length) continue;

    const groupH = rows.length * rowH;

    // 재료 병합 셀 (왼쪽)
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(tableX, cursorY, colMatW, groupH);
    ctx.strokeRect(tableX, cursorY, colMatW, groupH);

    // 재료 텍스트 (가운데 정렬)
    const emoji = MAT_EMOJI[mat] ? `${MAT_EMOJI[mat]} ` : "";
    ctx.fillStyle = "#111827";
    ctx.font = "800 24px KIKI_FONT";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${emoji}${mat}`, tableX + colMatW / 2, cursorY + groupH / 2);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    // 오른쪽 행들 (마을/수량)
    rows.forEach((it, i) => {
      const y = cursorY + i * rowH;

      // 마을 셀
      ctx.fillStyle = rowFill(i);
      ctx.fillRect(tableX + colMatW, y, colTownW, rowH);
      ctx.strokeRect(tableX + colMatW, y, colTownW, rowH);

      // 수량 셀
      ctx.fillStyle = rowFill(i);
      ctx.fillRect(tableX + colMatW + colTownW, y, colQtyW, rowH);
      ctx.strokeRect(tableX + colMatW + colTownW, y, colQtyW, rowH);

// 마을 텍스트: 가운데 정렬
ctx.fillStyle = "#111827";
ctx.font = "24px KIKI_FONT";
const town = ellipsize(ctx, it.town, colTownW - 24);

ctx.textAlign = "center";
ctx.textBaseline = "middle";
ctx.fillText(town, tableX + colMatW + colTownW / 2, y + rowH / 2);

// 수량 텍스트: 숫자만 오른쪽 정렬 + 색 강조
const qtyColor =
  it.qty === 100 ? "#dc2626" : it.qty === 60 ? "#d97706" : "#059669";

ctx.fillStyle = qtyColor;
ctx.font = "900 24px KIKI_FONT";
ctx.textAlign = "right";
ctx.fillText(String(it.qty), tableX + tableW - 14, y + rowH / 2);

// 원복
ctx.textAlign = "left";
ctx.textBaseline = "alphabetic";
    });

    cursorY += groupH;
  }

  const buf = canvas.toBuffer("image/png");
  return new AttachmentBuilder(buf, { name: "bonds_east.png" });
}
