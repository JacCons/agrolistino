const number = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const longDate = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric" });
const shortDate = new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });
export const monthName = (m) => new Intl.DateTimeFormat("it-IT", { month: "long" }).format(new Date(2026, m, 1));

export const money = (v) => (v == null ? "n.d." : number.format(v));
export const dateLong = (d) => longDate.format(new Date(`${d}T12:00:00`));
export const dateShort = (d) => shortDate.format(new Date(`${d}T12:00:00`));

export const toRow = ([date, min, max, flags]) => ({
  date, min, max, nominal: !!(flags & 1), suspect: !!(flags & 2),
  mid: min != null && max != null ? (min + max) / 2 : min ?? max,
  band: [min ?? max, max ?? min],
});
export const toRows = (series = []) => series.map(toRow);

export const change = (rows) => {
  const valid = rows.filter((r) => !r.suspect);
  if (rows.at(-1).suspect || valid.length < 2 || !valid.at(-2).mid) return null;
  return ((valid.at(-1).mid - valid.at(-2).mid) / valid.at(-2).mid) * 100;
};

export const priceRange = ({ min, max }) => {
  if (min == null) return `fino a ${money(max)}`;
  if (max == null) return `da ${money(min)}`;
  return min === max ? money(min) : `${money(min)} – ${money(max)}`;
};

export const daysBefore = (date, days) => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};

export const futuresSymbol = (product) => {
  if (product.commodity === "Frumento tenero") return { symbol: "EBM", label: "Euronext Milling Wheat No. 2", url: "https://live.euronext.com/it/product/commodity-futures/EBM-DPAR/contract-specification" };
  if (product.commodity === "Mais") return { symbol: "EMA", label: "Euronext Corn", url: "https://www.zmp.de/en/futures/grain/matif-corn-paris-fr-future" };
  return null;
};

const FAVORITES = "agriprezzi:preferiti";
export const loadFavorites = () => {
  try { return JSON.parse(localStorage.getItem(FAVORITES)) || []; } catch { return []; }
};
export const saveFavorites = (keys) => {
  try { localStorage.setItem(FAVORITES, JSON.stringify(keys)); } catch { /* preferiti validi solo per la sessione */ }
};
