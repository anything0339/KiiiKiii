// renderBondsDashboard.js
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { AttachmentBuilder } from "discord.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ✅ 루트에 폰트 있을 때는 이렇게!
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

export function normMaterial(input) {
  const key = String(input ?? "").trim().toLowerCase();
  return MATERIAL_KO[key] ?? null;
}

/* ---------------------------
   2) 입력 파싱
   형식: 재료 | 마을 | 수량
---------------------------- */
export function parseBondsLines(raw) {
  const lines = String(raw ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const items = [];

  for (const line of lines) {
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length !== 3) continue;

    const material = normMaterial(parts[0]);
    const town = parts[1];
    const qty = Number(parts[2]);

    if (!material) continue;
    if (!town) continue;
    if (![20, 60, 100].includes(qty)) continue;

    items.push({ material, town, qty });
  }

  return items;
}

/* ---------------------------
   3) PNG 렌더 (대시보드 스타일)
---------------------------- */
function qtyStyle(qty) {
  // 너무 쨍하지 않게, 다크 대시보드 톤
  if (qty === 20) return { bg: "#163d2b", fg: "#8ff0b8" };
  if (qty === 60) return { bg: "#3d3317", fg: "#ffd78a" };
  return { bg: "#3a1c1c", fg: "#ff9a9a" }; // 100
}

function groupByMaterial(items) {
  const map = new Map();
  for (const m of MATERIAL_ORDER) map.set(m, []);

  for (const it of items) {
    if (!map.has(it.material)) map.set(it.material, []);
    map.get(it.material).push(it);
  }

  // 섹션 내부 정렬: 마을명 기준
  for (const m of MATERIAL_ORDER) {
    const arr = map.get(m) ?? [];
    arr.sort((a, b) => a.town.localeCompare(b.town, "ko"));
  }

  return map;
}

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
  // 예: 2026. 3. 3. 오후 5:10:22
  return new Date().toLocaleString("ko-KR");
}

/**
 * @param {object} arg
 * @param {string} arg.title
 * @param {{material:string,town:string,qty:number}[]} arg.items
 * @returns {AttachmentBuilder}
 */
export function renderBondsDashboardPng({ title = "동대륙 채권", items = [] }) {
  const grouped = groupByMaterial(items);

  // 레이아웃 상수
  const cardW = 1000;
  const padding = 36;
  const innerW = cardW - padding * 2;

  const headerH = 130;
  const gap = 18;

  const colGap = 18;
  const colW = Math.floor((innerW - colGap) / 2);

  const sectionPad = 18;
  const sectionHeaderH = 46;
  const rowH = 44;

  // 섹션 높이 계산 (빈 섹션은 0)
  const sectionHeights = MATERIAL_ORDER.map((m) => {
    const rows = grouped.get(m)?.length ?? 0;
    if (rows === 0) return 0;
    return sectionPad * 2 + sectionHeaderH + rows * rowH;
  });

  const row1H = Math.max(sectionHeights[0], sectionHeights[1]);
  const row2H = Math.max(sectionHeights[2], sectionHeights[3]);

  const hasRow1 = row1H > 0;
  const hasRow2 = row2H > 0;

  let bodyH = 0;
  if (hasRow1) bodyH += row1H;
  if (hasRow1 && hasRow2) bodyH += gap;
  if (hasRow2) bodyH += row2H;

  const height = headerH + padding + bodyH + padding;

  const canvas = createCanvas(cardW, height);
  const ctx = canvas.getContext("2d");

  // 전체 배경
  ctx.fillStyle = "#0b1020";
  ctx.fillRect(0, 0, cardW, height);

  // 헤더 카드
  ctx.fillStyle = "#0f1730";
  drawRoundedRect(ctx, padding, 22, cardW - padding * 2, headerH - 28, 18);
  ctx.fill();

  // 제목
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 44px sans-serif";
  ctx.fillText(title, padding + 22, 78);

  // 타임스탬프
  ctx.fillStyle = "#93a4d8";
  ctx.font = "26px sans-serif";
  ctx.fillText(formatStamp(), padding + 22, 112);

  // 섹션 카드 그리기
  function drawSection(x, y, w, h, material, rows) {
    ctx.fillStyle = "#121a33";
    drawRoundedRect(ctx, x, y, w, h, 18);
    ctx.fill();

    // 섹션 타이틀
    ctx.fillStyle = "#e9ecf5";
    ctx.font = "700 30px sans-serif";
    ctx.fillText(material, x + 18, y + 44);

    // 구분선
    ctx.fillStyle = "#253056";
    ctx.fillRect(x + 18, y + 60, w - 36, 2);

    // 항목
    ctx.font = "26px sans-serif";
    const townMaxW = w - 36 - 110; // 배지 공간 확보
    let ry = y + 74;

    for (const it of rows) {
      // 마을명
      ctx.fillStyle = "#e9ecf5";
      const town = ellipsize(ctx, it.town, townMaxW);
      ctx.fillText(town, x + 18, ry + 30);

      // 수량 배지
      const { bg, fg } = qtyStyle(it.qty);
      const bx = x + w - 18 - 86;
      const by = ry + 9;
      const bw = 86;
      const bh = 30;

      ctx.fillStyle = bg;
      drawRoundedRect(ctx, bx, by, bw, bh, 12);
      ctx.fill();

      ctx.fillStyle = fg;
      ctx.font = "700 22px sans-serif";
      const t = String(it.qty);
      const tw = ctx.measureText(t).width;
      ctx.fillText(t, bx + (bw - tw) / 2, by + 22);

      ctx.font = "26px sans-serif";
      ry += rowH;
    }
  }

  // 2열 배치 좌표
  const xL = padding;
  const xR = padding + colW + colGap;

  // 본문 시작 y
  let y = headerH + padding;

  // Row 1 (철 주괴 / 가죽)
  if (hasRow1) {
    const leftRows = grouped.get("철 주괴") ?? [];
    const rightRows = grouped.get("가죽") ?? [];

    if (leftRows.length) {
      drawSection(xL, y, colW, sectionHeights[0], "철 주괴", leftRows);
    }
    if (rightRows.length) {
      drawSection(xR, y, colW, sectionHeights[1], "가죽", rightRows);
    }

    y += row1H + gap;
  }

  // Row 2 (목재 / 옷감)
  if (hasRow2) {
    const leftRows = grouped.get("목재") ?? [];
    const rightRows = grouped.get("옷감") ?? [];

    if (leftRows.length) {
      drawSection(xL, y, colW, sectionHeights[2], "목재", leftRows);
    }
    if (rightRows.length) {
      drawSection(xR, y, colW, sectionHeights[3], "옷감", rightRows);
    }
  }

  const buf = canvas.toBuffer("image/png");
  return new AttachmentBuilder(buf, { name: "bonds_east.png" });
}
