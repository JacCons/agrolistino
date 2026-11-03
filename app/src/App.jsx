import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { change, dateLong, dateShort, daysBefore, futuresSymbol, loadFavorites, money, monthName, priceRange, saveFavorites, toRow, toRows } from "./lib.js";

const DATA = window.AGRI_DATA;
const MARKETS = DATA.markets;
const marketName = (id) => MARKETS.find((m) => m.id === id)?.name ?? id;
const lastOf = (key) => toRow(DATA.series[key].at(-1));
const LATEST = DATA.products.reduce((d, p) => (DATA.series[p.key].at(-1)[0] > d ? DATA.series[p.key].at(-1)[0] : d), "");
const CURRENT_FROM = daysBefore(LATEST, 120);
const COMPARE_FROM = daysBefore(LATEST, 45);
const isCurrent = (p) => DATA.series[p.key].at(-1)[0] >= CURRENT_FROM;
const isRecent = (p) => DATA.series[p.key].at(-1)[0] >= COMPARE_FROM;
const sourceOf = (p) => DATA.sources?.[p.source] ?? { name: "Fonte ufficiale", url: "", phase: "" };

function Spark({ keyName }) {
  const values = toRows(DATA.series[keyName]).filter((r) => !r.suspect).slice(-26).map((r) => r.mid);
  if (values.length < 2) return null;
  const low = Math.min(...values), span = Math.max(...values) - low || 1;
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 100},${28 - ((v - low) / span) * 24}`).join(" ");
  return <svg className="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline points={points} /></svg>;
}

function Change({ value }) {
  if (value == null) return null;
  if (value === 0) return <p className="change flat">Invariato rispetto al listino precedente</p>;
  return <p className={value > 0 ? "change up" : "change down"}>{value > 0 ? "▲ In aumento" : "▼ In calo"} del {money(Math.abs(value))}% rispetto al listino precedente</p>;
}

function Prices({ row, unit }) {
  const items = row.min === row.max ? [["Prezzo", row.min]] : [["Minimo", row.min], ["Massimo", row.max]].filter(([, v]) => v != null);
  return (
    <div className="prices">
      {items.map(([label, value]) => <p className="price" key={label}><span>{label}</span><strong>{money(value)}</strong><span>{unit}</span></p>)}
    </div>
  );
}

function Source({ product, date }) {
  const source = sourceOf(product);
  return (
    <p className="source">
      Fonte: {source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.name}</a> : source.name}
      {date && `, rilevazione del ${dateLong(date)}`}{source.phase && `. Fase: ${source.phase.toLowerCase()}`}
    </p>
  );
}

function History({ rows, unit }) {
  const years = [...new Set(rows.map((r) => r.date.slice(0, 4)))].reverse();
  const [period, setPeriod] = useState("12");
  const [month, setMonth] = useState("");
  const from = daysBefore(rows.at(-1).date, 365);
  const shown = rows
    .map((row, i) => ({ ...row, delta: i && !row.suspect && !rows[i - 1].suspect ? row.mid - rows[i - 1].mid : null }))
    .filter((r) => (period === "12" ? r.date > from : r.date.startsWith(period)) && (!month || r.date.slice(5, 7) === month))
    .reverse();
  return (
    <>
      <div className="filters">
        <button className={period === "12" ? "chip on" : "chip"} onClick={() => setPeriod("12")}>Ultimi 12 mesi</button>
        {years.map((y) => <button key={y} className={period === y ? "chip on" : "chip"} onClick={() => setPeriod(y)}>{y}</button>)}
        <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Filtra per mese">
          <option value="">Tutti i mesi</option>
          {Array.from({ length: 12 }, (_, m) => <option key={m} value={String(m + 1).padStart(2, "0")}>{monthName(m)}</option>)}
        </select>
      </div>
      {rows.length < 2 && <p className="notice">Per questo prodotto è disponibile una sola rilevazione.</p>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Data</th><th>Minimo</th><th>Massimo</th><th>Variazione</th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.date}>
                <td>{dateShort(r.date)}{r.nominal ? " *" : ""}{r.suspect ? " ⚠" : ""}</td>
                <td>{money(r.min)}</td><td>{money(r.max)}</td>
                <td>{r.delta == null ? "–" : `${r.delta > 0 ? "+" : ""}${money(r.delta)}`}</td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan="4" className="muted">Nessuna rilevazione nel periodo scelto.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="muted hint">Prezzi in {unit}.{rows.some((r) => r.nominal) ? " * Prezzo nominale." : ""}{rows.some((r) => r.suspect) ? " ⚠ Valore da verificare, riportato come pubblicato dalla fonte." : ""}</p>
    </>
  );
}

function ChartTip({ active, payload, unit }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="tip">
      <strong>{dateLong(row.date)}</strong>
      {row.mid != null && <span>Spot: {priceRange(row)} {unit}</span>}
      {row.future != null && <span>Futures: {money(row.future)} {unit}</span>}
    </div>
  );
}

function PriceChart({ rows, unit, futures }) {
  const [range, setRange] = useState("all");
  const data = useMemo(() => {
    const byDate = new Map(rows.filter((r) => !r.suspect).map((r) => [r.date, { ...r }]));
    futures.forEach((f) => {
      const row = byDate.get(f.data) ?? { date: f.data };
      if (row.future == null) row.future = f.prezzo;
      byDate.set(f.data, row);
    });
    const all = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    return range === "all" ? all : all.filter((r) => r.date >= daysBefore(all.at(-1).date, 365 * Number(range)));
  }, [rows, futures, range]);
  if (rows.length < 2) return <p className="notice">Il grafico compare quando ci sono almeno due rilevazioni.</p>;
  return (
    <>
      <div className="filters">
        {[["1", "1 anno"], ["3", "3 anni"], ["all", "Tutto"]].map(([v, l]) => <button key={v} className={range === v ? "chip on" : "chip"} onClick={() => setRange(v)}>{l}</button>)}
      </div>
      <div className="chart" role="img" aria-label={`Andamento del prezzo in ${unit}. I valori sono nella scheda Prezzi passati.`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="date" tickFormatter={(d) => dateShort(d).slice(3)} minTickGap={48} tick={{ fill: "var(--muted)", fontSize: 14 }} axisLine={{ stroke: "var(--line)" }} tickLine={false} />
            <YAxis domain={["auto", "auto"]} width={64} tickFormatter={(v) => v.toLocaleString("it-IT")} tick={{ fill: "var(--muted)", fontSize: 14 }} axisLine={false} tickLine={false} />
            <Tooltip content={<ChartTip unit={unit} />} cursor={{ stroke: "var(--muted)", strokeDasharray: "3 3" }} />
            {futures.length > 0 && <Legend wrapperStyle={{ fontSize: 14 }} />}
            <Area dataKey="band" name="Intervallo min–max" stroke="none" fill="var(--series)" fillOpacity={0.16} connectNulls isAnimationActive={false} legendType="none" />
            <Line dataKey="mid" name="Prezzo spot" stroke="var(--series)" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            {futures.length > 0 && <Line dataKey="future" name="Futures" stroke="var(--future)" strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls isAnimationActive={false} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="muted hint">La linea è il valore medio tra minimo e massimo, la fascia è l’intervallo in {unit}.</p>
    </>
  );
}

function Futures({ contract, rows, unit }) {
  if (!contract) return <p className="notice">Per questo prodotto non è collegato un contratto futures.</p>;
  const latest = rows.reduce((d, r) => (r.data > d ? r.data : d), "");
  return (
    <>
      <p>Contratto correlato: <a href={contract.url} target="_blank" rel="noreferrer">{contract.label}</a> ({contract.symbol}).</p>
      {!rows.length
        ? <p className="notice">Nessuna quotazione caricata. Aggiungila in data/futures.csv da una fonte con licenza d’uso.</p>
        : <div className="table-wrap"><table>
            <thead><tr><th>Scadenza</th><th>Prezzo ({unit})</th><th>Data</th></tr></thead>
            <tbody>{rows.filter((r) => r.data === latest).map((r) => <tr key={r.scadenza}><td>{r.scadenza}</td><td>{money(r.prezzo)}</td><td>{dateShort(r.data)}</td></tr>)}</tbody>
          </table></div>}
      <p className="muted hint">Il futures quota un contratto europeo e non è una previsione del prezzo locale.</p>
    </>
  );
}

function Detail({ product, favorite, toggle, compare }) {
  const [tab, setTab] = useState("storico");
  const rows = useMemo(() => toRows(DATA.series[product.key]), [product]);
  const last = rows.at(-1);
  const [title, inlineSpec] = product.name.split(/ (?=\()/, 2);
  const spec = product.spec || inlineSpec;
  const contract = futuresSymbol(product);
  const futures = contract ? DATA.futures.filter((f) => f.simbolo === contract.symbol) : [];
  const mids = rows.filter((r) => !r.suspect).map((r) => r.mid);
  const low = Math.min(...mids), high = Math.max(...mids);
  const position = high > low ? ((last.mid - low) / (high - low)) * 100 : 50;
  return (
    <article className="detail">
      <div className="card slip">
        <div className="slip-top">
          <div>
            <p className="tagline">{marketName(product.market)}, {product.group}</p>
            <h2>{title}</h2>
            {spec && <p className="muted spec">{spec}</p>}
          </div>
          <button className={favorite ? "star on" : "star"} aria-pressed={favorite} onClick={toggle}>{favorite ? "★ Salvato" : "☆ Salva"}</button>
        </div>
        <p className="now">{isCurrent(product) ? "Prezzo attuale" : "Ultima quotazione disponibile"}, {dateLong(last.date)}{last.nominal ? " (prezzo nominale)" : ""}</p>
        <Prices row={last} unit={product.unit} />
        {last.suspect && <p className="notice warn">⚠ Valore da verificare: è molto diverso dalle rilevazioni vicine. È riportato come pubblicato dalla fonte ed è escluso da grafico e confronto.</p>}
        <Change value={change(rows)} />
        {mids.length > 1 && (
          <div className="meter" aria-label={`Prezzo attuale rispetto ai valori dello storico: più basso ${money(low)}, più alto ${money(high)}`}>
            <div className="track"><i style={{ left: `${position}%` }} /></div>
            <div className="ends"><span>Più basso: {money(low)}</span><span>Più alto: {money(high)}</span></div>
          </div>
        )}
        <Source product={product} date={last.date} />
        {product.commodity && <button className="link" onClick={() => compare(product.commodity)}>Confronta {product.commodity.toLowerCase()} tra le borse</button>}
      </div>
      <div className="card panel">
        <div className="tabs" role="tablist">
          {[["storico", "Prezzi passati"], ["grafico", "Grafico"], ["futures", "Futures"]].map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "tab on" : "tab"} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
        {tab === "storico" && <History key={product.key} rows={rows} unit={product.unit} />}
        {tab === "grafico" && <PriceChart key={product.key} rows={rows} unit={product.unit} futures={futures} />}
        {tab === "futures" && <Futures contract={contract} rows={futures} unit={product.unit} />}
      </div>
    </article>
  );
}

function EasterEgg({ close }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);
  return (
    <div className="egg" role="dialog" aria-modal="true" aria-label="Jacopo e Matteo" onClick={close}>
      {Array.from({ length: 14 }, (_, i) => <span key={i} className="grain" style={{ left: `${(i * 7.3 + 3) % 100}%`, animationDelay: `${(i % 5) * 0.35}s` }} aria-hidden="true">🌾</span>)}
      <div className="card egg-card" onClick={(e) => e.stopPropagation()}>
        <p className="tagline">Listino speciale</p>
        <h2>Jacopo e Matteo</h2>
        <p className="price"><span>Quotazione</span><strong>Fuori listino</strong><span>Valore in forte rialzo</span></p>
        <button className="primary" onClick={close} autoFocus>Torna ai prezzi</button>
      </div>
    </div>
  );
}

function PricesView({ marketId, setMarketId, active, select, favorites, toggle, compare, showEgg }) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("Tutte");
  const [showOld, setShowOld] = useState(false);
  const inMarket = useMemo(() => DATA.products.filter((p) => marketId === "all" || p.market === marketId), [marketId]);
  const groups = useMemo(() => ["Tutte", ...new Set(inMarket.filter((p) => showOld || isCurrent(p)).map((p) => p.group))], [inMarket, showOld]);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inMarket.filter((p) => (showOld || isCurrent(p)) && (group === "Tutte" || p.group === group)
      && (!q || `${p.name} ${p.path} ${p.spec ?? ""} ${p.group} ${p.commodity ?? ""}`.toLowerCase().includes(q)));
  }, [inMarket, query, group, showOld]);
  const market = MARKETS.find((m) => m.id === marketId);
  const product = DATA.products.find((p) => p.key === active);
  useEffect(() => {
    if (query.trim().toLowerCase().replace(/\s+/g, " ") === "jacopo e matteo") showEgg();
  }, [query, showEgg]);
  return (
    <>
      <section className="hero">
        <div className="hero-in">
          <h2>Prezzi agricoli del Veneto</h2>
          <p>Quotazioni ufficiali aggiornate al {dateLong(LATEST)}.</p>
          <div className="pills" role="group" aria-label="Scegli il mercato">
            <button className={marketId === "all" ? "pill on" : "pill"} aria-pressed={marketId === "all"} onClick={() => setMarketId("all")}>Tutti</button>
            {MARKETS.map((m) => <button key={m.id} disabled={!m.active} title={m.note} className={m.id === marketId ? "pill on" : "pill"} aria-pressed={m.id === marketId} onClick={() => setMarketId(m.id)}>{m.name}{m.active ? "" : " (in arrivo)"}</button>)}
          </div>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cerca frumento, mais, Prosecco, Grana…" aria-label="Cerca un prodotto" />
        </div>
      </section>
      <main className="grid">
        <aside className="card list">
          <div className="chips">
            {groups.map((g) => <button key={g} className={g === group ? "chip on" : "chip"} aria-pressed={g === group} onClick={() => setGroup(g)}>{g}</button>)}
          </div>
          <p className="count">{results.length} prodotti</p>
          <ul className="results">
            {results.map((p) => (
              <li key={p.key}>
                <button className={p.key === active ? "result on" : "result"} onClick={() => select(p.key)}>
                  <span>{marketId === "all" && <b>{marketName(p.market)}: </b>}{p.name}</span>
                  <span className="result-price">{priceRange(lastOf(p.key))} <small>{p.unit}{lastOf(p.key).suspect ? " ⚠ da verificare" : ""}</small></span>
                </button>
              </li>
            ))}
            {!results.length && <li className="muted hint">{inMarket.length ? "Nessun prodotto trovato. Prova un altro termine." : `Nessun dato per ${market?.name}. Avvia l’aggiornamento dati.`}</li>}
          </ul>
          <label className="check"><input type="checkbox" checked={showOld} onChange={(e) => setShowOld(e.target.checked)} /> Mostra anche i prodotti non quotati negli ultimi 4 mesi</label>
        </aside>
        <div id="detail">{product && <Detail key={product.key} product={product} favorite={favorites.includes(active)} toggle={toggle} compare={compare} />}</div>
      </main>
    </>
  );
}

function CompareView({ commodity, setCommodity, open }) {
  const [desc, setDesc] = useState(false);
  const options = useMemo(() => {
    const groups = {};
    DATA.products.filter((p) => p.commodity && isRecent(p)).forEach((p) => { (groups[p.group] ??= new Set()).add(p.commodity); });
    return Object.entries(groups).sort().map(([g, set]) => [g, [...set].sort()]);
  }, []);
  const sections = useMemo(() => {
    const units = {};
    DATA.products.filter((p) => p.commodity === commodity && isRecent(p)).forEach((p) => {
      const row = lastOf(p.key);
      if (row.mid && !row.suspect) (units[p.unit] ??= []).push({ product: p, row });
    });
    return Object.entries(units).map(([unit, items]) => [unit, items.sort((a, b) => (desc ? b.row.mid - a.row.mid : a.row.mid - b.row.mid))]);
  }, [commodity, desc]);
  return (
    <>
      <section className="hero">
        <div className="hero-in">
          <h2>Confronta le borse merci</h2>
          <p>Scegli una coltura e ordina le quotazioni per prezzo.</p>
          <div className="compare-controls">
            <select value={commodity} onChange={(e) => setCommodity(e.target.value)} aria-label="Scegli la coltura">
              {options.map(([g, list]) => <optgroup key={g} label={g}>{list.map((c) => <option key={c}>{c}</option>)}</optgroup>)}
            </select>
            <button className="pill on" onClick={() => setDesc(!desc)}>{desc ? "↓ Dal più alto" : "↑ Dal più basso"}</button>
          </div>
        </div>
      </section>
      <main className="single">
        <p className="notice">Qualità, resa e condizioni di vendita possono cambiare da una voce all’altra. I prezzi “Origine” e “Ingrosso” si riferiscono a fasi diverse.</p>
        {!sections.length && <p className="notice">Nessuna quotazione recente per questa coltura.</p>}
        {sections.map(([unit, items]) => {
          const top = Math.max(...items.map((i) => i.row.mid));
          return (
            <section className="card rank" key={unit}>
              <h3>Prezzi in {unit}</h3>
              <ol>
                {items.map(({ product: p, row }, i) => (
                  <li key={p.key}>
                    <button onClick={() => open(p.key)}>
                      <span className="pos">{i + 1}</span>
                      <span className="who">
                        <strong>{marketName(p.market)}</strong>
                        <span>{p.name}</span>
                        {p.spec && <small>{p.spec}</small>}
                        <small>{sourceOf(p).phase || "Quotazione"}, {dateShort(row.date)}</small>
                        <span className="bar"><i style={{ width: `${(row.mid / top) * 100}%` }} /></span>
                      </span>
                      <span className="val"><strong>{money(row.mid)}</strong><small>{priceRange(row)}</small></span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </main>
    </>
  );
}

function FavoritesView({ favorites, open, remove, goPrices }) {
  const list = favorites.map((k) => DATA.products.find((p) => p.key === k)).filter(Boolean);
  return (
    <>
      <section className="hero">
        <div className="hero-in">
          <h2>I tuoi preferiti</h2>
          <p>{list.length ? "I prezzi aggiornati dei prodotti che segui." : "Qui trovi i prodotti che vuoi tenere d’occhio."}</p>
        </div>
      </section>
      <main className="single">
        {!list.length && <div className="card empty"><p>Apri un prodotto e premi “Salva” per aggiungerlo.</p><button className="primary" onClick={goPrices}>Vai ai prezzi</button></div>}
        <ul className="fav-grid">
          {list.map((p) => {
            const rows = toRows(DATA.series[p.key].slice(-8));
            const row = rows.at(-1);
            return (
              <li className="card fav" key={p.key}>
                <button className="fav-open" onClick={() => open(p.key)}>
                  <span className="tagline">{marketName(p.market)}, {p.group}</span>
                  <strong className="fav-name">{p.name}</strong>
                  <span className="fav-price">{priceRange(row)} <small>{p.unit}{row.suspect ? " ⚠" : ""}</small></span>
                  <Spark keyName={p.key} />
                  <small>{dateLong(row.date)}{change(rows) != null ? `, ${change(rows) > 0 ? "+" : ""}${money(change(rows))}%` : ""}</small>
                </button>
                <button className="link" onClick={() => remove(p.key)}>Rimuovi</button>
              </li>
            );
          })}
        </ul>
      </main>
    </>
  );
}

export default function App() {
  const firstActive = DATA.products.find((p) => p.key === "verona:2")?.key ?? DATA.products.find(isCurrent)?.key;
  const [view, setView] = useState("prezzi");
  const [marketId, setMarket] = useState("verona");
  const [active, setActive] = useState(firstActive);
  const [commodity, setCommodity] = useState("Frumento tenero");
  const [favorites, setFavorites] = useState(loadFavorites);
  const [egg, setEgg] = useState(false);
  const logoClicks = useRef(0);
  const showEgg = useCallback(() => setEgg(true), []);
  const closeEgg = useCallback(() => setEgg(false), []);
  const clickLogo = () => {
    logoClicks.current += 1;
    if (logoClicks.current >= 5) { logoClicks.current = 0; setEgg(true); }
  };
  useEffect(() => { saveFavorites(favorites); }, [favorites]);
  useEffect(() => { window.scrollTo(0, 0); }, [view]);
  const select = (key) => {
    setActive(key);
    if (window.innerWidth < 900) requestAnimationFrame(() => document.getElementById("detail")?.scrollIntoView({ behavior: "smooth" }));
  };
  const open = (key) => {
    const p = DATA.products.find((x) => x.key === key);
    setMarket(p.market);
    setActive(key);
    setView("prezzi");
  };
  const setMarketId = (id) => {
    setMarket(id);
    const first = DATA.products.find((p) => (id === "all" || p.market === id) && isCurrent(p));
    if (first && !(id === "all")) setActive(first.key);
  };
  const toggle = () => setFavorites((f) => (f.includes(active) ? f.filter((k) => k !== active) : [...f, active]));
  const compare = (c) => { setCommodity(c); setView("confronto"); };
  const nav = [["prezzi", "Prezzi"], ["confronto", "Confronta"], ["preferiti", `★ Preferiti${favorites.length ? ` (${favorites.length})` : ""}`]];
  return (
    <>
      <header>
        <div className="bar-in">
          <div className="brand"><h1 onClick={clickLogo}>AgroListino</h1><p>Monitor Borse Merci</p></div>
          <nav aria-label="Sezioni">
            {nav.map(([id, label]) => <button key={id} className={view === id ? "nav on" : "nav"} aria-current={view === id ? "page" : undefined} onClick={() => setView(id)}>{label}</button>)}
          </nav>
        </div>
      </header>
      {view === "prezzi" && <PricesView {...{ marketId, setMarketId, active, select, favorites, toggle, compare, showEgg }} />}
      {view === "confronto" && <CompareView commodity={commodity} setCommodity={setCommodity} open={open} />}
      {view === "preferiti" && <FavoritesView favorites={favorites} open={open} remove={(k) => setFavorites((f) => f.filter((x) => x !== k))} goPrices={() => setView("prezzi")} />}
      {egg && <EasterEgg close={closeEgg} />}
      <footer>Prezzi indicativi a scopo informativo. Fonti: Camere di Commercio di Verona, Treviso-Belluno e Padova, ISMEA. Dati generati il {dateLong(DATA.generatedAt.slice(0, 10))}.</footer>
    </>
  );
}
