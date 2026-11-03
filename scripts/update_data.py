#!/usr/bin/env python3
"""Scarica i prezzi agricoli delle fonti ufficiali del Veneto e genera docs/data.js.

Uso:
  python3 scripts/update_data.py                 # scarica dal 2022 a oggi
  python3 scripts/update_data.py --since 2024    # periodo piu' breve
  python3 scripts/update_data.py --solo-locale   # usa solo i file gia' scaricati
"""
import argparse, csv, html, json, re, statistics, subprocess, time
import xml.etree.ElementTree as ET
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW, OUT = ROOT / "data/raw", ROOT / "docs/data.js"
ISMEA_FILE = ROOT / "data/ismea.csv"
MONTHS = "gennaio febbraio marzo aprile maggio giugno luglio agosto settembre ottobre novembre dicembre".split()

VERONA = "https://www.portaleprezziverona.it/camcom-verona/it/borsa-merci"
TREVISO = "https://portaleprezzitrevisobelluno.it"
PADOVA = "https://www.pd.camcom.it"
PADOVA_YEAR = "/it/tutela-impresa-e-consumatore/prezzi/prezzi-comparto-cerealicolo/rilevazione-prezzi-cereali-anno-{}"
ISMEA = "https://www.ismeamercati.it/flex/cm/pages/ServeBLOB.php/L/IT/IDPagina/439"

SOURCES = {
    "verona": dict(name="Borsa Merci della Camera di Commercio di Verona", url=VERONA, phase="Ingrosso"),
    "treviso": dict(name="Borsa Merci della Camera di Commercio di Treviso-Belluno", url=TREVISO, phase="Ingrosso"),
    "padova": dict(name="Camera di Commercio di Padova", url=PADOVA + PADOVA_YEAR.format(2026), phase="Ingrosso"),
    "ismea": dict(name="Rete di rilevazione ISMEA", url=ISMEA, phase="Origine"),
}
MARKETS = [
    dict(id="verona", name="Verona", active=True),
    dict(id="treviso", name="Treviso", active=True),
    dict(id="padova", name="Padova", active=True),
    dict(id="rovigo", name="Rovigo", active=True),
    dict(id="venezia", name="Venezia", active=True),
]
ISMEA_PLACES = {"verona": 94, "treviso": 67, "padova": 136, "rovigo": 38, "venezia": 31}

DERIVED = r"tritello|farinaccio|farinetta|pellett|molitoria|derivati|lavorazione|sfarinat|farin[ae]\b|insilato|trinciato|glutin|germe|spezzat|paglia"
COMMODITIES = [
    ("Farina di soia", r"estrazione.*so[ij]a|so[ij]a.*estrazione"),
    ("Farina di frumento", r"farin[ae] d[ei] (grano tenero|frumento)"),
    ("Crusca", r"crusca|cruschello"),
    ("Soia", r"\bsem[ei] di so[ij]a|^so[ij]a\b"),
    ("Frumento tenero", rf"^(?!.*({DERIVED})).*(grano tenero|frumento tenero|frumenti teneri|frumenti esteri|frumento n\. \d|cwrs|northern spring|manitoba)"),
    ("Mais", rf"^(?!.*({DERIVED})).*(granturco|granoturco|granon[ei]|\bmais\b)"),
    ("Orzo", rf"^(?!.*({DERIVED})).*\borzo\b"),
    ("Sorgo", r"\bsorgo\b"), ("Avena", r"\bavena\b"), ("Risone", r"\brison[ei]\b"),
    ("Grana Padano", r"grana padano"), ("Provolone", r"provolone"), ("Burro", r"\bburro\b"),
    ("Uova", r"\buova\b"), ("Conigli", r"\bconigli"),
    ("Polli vivi", r"(peso vivo|pollame vivo).*\bpolli\b"), ("Tacchini vivi", r"(peso vivo|pollame vivo).*\btacchin"),
    ("Pinot grigio", r"^(?!.*taglio).*pinot grigio"), ("Prosecco", r"^(?!.*taglio).*prosecco"),
    ("Chardonnay", r"^(?!.*taglio).*chardonnay"), ("Merlot", r"\bmerlot\b"), ("Cabernet", r"\bcabernet\b"),
]
ISMEA_GROUPS = [
    ("Uva/Vino", r"\bvin[io]\b|\bmosti\b|\buv[ae]\b|spumante"),
    ("Avicunicoli", r"\bpoll|\btacchin|\buova\b|\bconigli|\banatr|\banitr|\bgalline|\bgallett|\bfaraon"),
    ("Bestiame", r"\bbaliott|\bvitell|\bscottona|\bvacche|\bmanz|\bsuin|\bagnell|\bbovin|\blattonzol|\bmagron"),
    ("Lattiero/Caseari", r"\blatte\b|\bgrana\b|\bburro\b|\bformagg|\basiago\b|\bpanna\b|\bsiero\b|\bprovolone\b"),
    ("Olio", r"\bolio\b|\bolive\b"),
    ("Cereali e mangimi", r"\bfrument|\bgrano\b|\bmais\b|\borzo\b|\bsorgo\b|\bavena\b|\bso[ij]a\b|\bris[oi]|\bfieno\b|\bpaglia\b|\binsilato\b|\berba medica\b"),
]


def load_previous():
    """Riparte da docs/data.js, cosi' i file grezzi non servono per i listini gia' elaborati."""
    if not OUT.exists():
        return dict(products={}, series={}), set()
    old = json.loads(OUT.read_text("utf-8")[len("window.AGRI_DATA="):].rstrip().rstrip(";"))
    if "seen" not in old:
        return dict(products={}, series={}), set()
    series = {k: {r[0]: r[1:] for r in rows} for k, rows in old["series"].items()}
    return dict(products={p["key"]: p for p in old["products"]}, series=series), set(old["seen"])


def curl(url):
    return subprocess.run(["curl", "-fsSL", "-A", "AgroListino", "-H", "Accept: application/json, text/html, */*", "-m", "40", url],
                          capture_output=True, check=True).stdout


def commodity_of(text):
    return next((c for c, rx in COMMODITIES if re.search(rx, text, re.I)), None)


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def price(text):
    text = (text or "").strip()
    value = re.sub(r"[^\d,]", "", text).replace(",", ".")
    return (float(value) if value else 0.0) or None, "*" in text


def parse_date(text):
    day, month, year = text.strip().split("/")
    return date(int(year), MONTHS.index(month.lower()) + 1, int(day)).isoformat()


def unit_of(text):
    t = text.lower()
    if re.search(r"grado\s*/\s*100", t): return "€/grado·hl"
    if "1000 litri" in t: return "€/1000 l"
    if "litro" in t: return "€/l"
    if "per 100" in t: return "€/100 uova"
    if "tonnellata" in t: return "€/t"
    if "kilogrammo" in t or "per kg" in t: return "€/kg"
    return None


def clean(text):
    text = re.sub(r"\([^)]*(prezzo|quotazione)[^)]*\)", "", text, flags=re.I)
    return " ".join(text.split()).strip(" -")


def label(text):
    letters = [c for c in text if c.isalpha()]
    return text.capitalize() if sum(c.isupper() for c in letters) * 2 > len(letters) else text


def walk(node, path, unit, rows):
    for cat in node.findall("categorie/categoria"):
        name = cat.findtext("nome", "")
        next_unit = unit_of(name) or unit
        next_path = path + [clean(name)]
        for p in cat.findall("prodotti/prodotto"):
            rows.append((p, next_path, unit_of(p.findtext("nome", "")) or next_unit))
        walk(cat, next_path, next_unit, rows)


def verona_unit(text):
    if "mosti" in text: return "€/grado"
    if re.search(r"\buv[ae]\b", text): return "€/kg"
    return "€/l" if re.search(r"\bvin[io]\b|ripasso", text) else "€"


def verona_info(group, cats, name, unit):
    if group == "Cereali":
        group = "Olio" if cats[0].upper().startswith("OLII") else "Cereali e mangimi"
    title = label(cats[-1]) if cats[-1].lower().startswith(name.lower()) else f"{label(cats[-1])}: {name}"
    if re.match(r"in cisterna|partenza", cats[-1], re.I):
        title = name
    return group, title, "", unit or verona_unit(" ".join(cats + [name]).lower())


def treviso_info(cats, name):
    top, text = cats[0].upper(), " ".join(cats + [name]).upper()
    if top.startswith("POLLAME"):
        unit = "€/capo" if re.search("PULCINI|POLLASTRE", text) else "€/kg"
        return "Avicunicoli", f"{label(cats[-1])} {'vivo' if 'VIVO' in top else 'macellato'}: {name}", "", unit
    if top.startswith("VINI"):
        if "MOSTI" in text: unit = "€/grado"
        elif name.upper().startswith("VINO "): unit = "€/grado·hl"
        elif "IGT" in name.upper() and not re.search("SAUVIGNON|MANZONI|GLERA|NOVELLO", text): unit = "€/grado·hl"
        else: unit = "€/l"
        return "Uva/Vino", f"{label(cats[-1])}: {name}" + (" (biologico)" if "BIOLOGICI" in top else ""), "", unit
    title = ", ".join(re.sub(r"\b[A-Z]{2,}\b", lambda m: m[0].lower(), label(c)) for c in cats[1:]) or name
    if title != name and len(name) <= 45 and not re.search(r"\d%", name):
        return "Cereali e mangimi", f"{title}: {name}", "", "€/t"
    return "Cereali e mangimi", title, name, "€/t"


def store(data, key, market, source, group, unit, name, path, spec, day, low, high, nominal=False):
    data["products"][key] = dict(key=key, market=market, source=source, group=group, unit=unit, name=name, path=path, spec=spec,
                                 commodity=commodity_of(f"{path} {name}".strip()))
    data["series"].setdefault(key, {})[day] = [low, high, int(nominal)]


def read_portal(path, market, data):
    try:
        root = ET.parse(path).getroot()
    except ET.ParseError:
        return print(f"Salto {path.name}: XML non valido")
    if root.findtext("nome", "").upper().startswith("MEDIE"):
        return
    for com in root.findall("commissioni/commissione"):
        try:
            day = parse_date(com.findtext("data", ""))
        except ValueError:  # i listini di chiusura possono non avere una data
            continue
        rows = []
        walk(com, [], None, rows)
        for p, cats, unit in rows:
            low, n1 = price(p.findtext("prezzomin"))
            high, n2 = price(p.findtext("prezzomax"))
            if low is None and high is None:
                continue
            raw = clean(p.findtext("nome", ""))
            info = treviso_info(cats, raw) if market == "treviso" else verona_info(com.findtext("nome", "").strip(), cats, raw, unit)
            group, title, spec, unit = info
            store(data, f"{market}:{p.findtext('id')}", market, market, group, unit, title, " / ".join(cats), spec, day, low, high, n1 or n2)


def download_verona(since, seen):
    RAW.mkdir(parents=True, exist_ok=True)
    known = [int(k.split(":")[1]) for k in seen if k.startswith("verona:")] + [int(p.stem) for p in RAW.glob("*.xml")]
    ids = sorted({int(i) for i in re.findall(r"download/xml/(\d+)", curl(VERONA).decode("utf-8", "replace"))}, reverse=True)
    if not ids:
        raise RuntimeError("nessun listino trovato: la pagina potrebbe essere cambiata")
    for i in ids:
        path = RAW / f"{i}.xml"
        if known and i < min(known):
            break
        if path.exists() or f"verona:{i}" in seen:
            continue
        path.write_bytes(curl(f"{VERONA}/rilevazione/download/xml/{i}"))
        print("Verona", i)
        time.sleep(0.5)
        years = re.findall(rb"/(20\d\d)</data>", path.read_bytes())
        if years and int(years[0]) < since:
            break


def download_treviso(since, seen):
    folder = RAW / "treviso"
    folder.mkdir(parents=True, exist_ok=True)
    for year in range(date.today().year, since - 1, -1):
        page = curl(f"{TREVISO}/it/borsa-merci/borsa-merci/{year}").decode("utf-8", "replace")
        for i, title in re.findall(r'report/pdf/(\d+)"[^>]*>\s*([^<]*)', page):
            path = folder / f"{i}.xml"
            if path.exists() or f"treviso:{i}" in seen or "petrolio" in title.lower():
                continue
            path.write_bytes(curl(f"{TREVISO}/it/borsa-merci/download/report/xml/{i}"))
            print("Treviso", i, title.strip())
            time.sleep(0.5)


def download_padova(since, seen):
    folder = RAW / "padova"
    folder.mkdir(parents=True, exist_ok=True)
    for year in range(max(since, 2026), date.today().year + 1):  # rilevazione riattivata nel 2026
        page = curl(f"{PADOVA}/++api++{PADOVA_YEAR.format(year)}/@modulistica-items").decode("utf-8", "replace")
        for link in sorted(set(re.findall(r'"(https?://[^"]*rilevazione-cereali-[^"]*formato_alternativo_1)"', page))):
            found = re.search(r"(\d\d)-(\d\d)-(\d{4})/@@", link)
            if not found:
                continue
            path = folder / f"{found[3]}-{found[2]}-{found[1]}.xls"
            if not path.exists() and f"padova:{path.stem}" not in seen:
                path.write_bytes(curl(link if link.startswith("http") else PADOVA + link))
                print("Padova", path.stem)
                time.sleep(0.5)


def read_padova(path, data):
    import xlrd
    sheet = xlrd.open_workbook(path).sheet_by_index(0)
    section = ""
    for r in range(sheet.nrows):
        vals = [v for v in sheet.row_values(r) if v not in ("", None)]
        if len(vals) == 1 and isinstance(vals[0], str):
            section = clean(vals[0])
        elif len(vals) >= 4 and isinstance(vals[0], str) and all(isinstance(v, (int, float)) for v in vals[2:4]):
            name = clean(vals[0])
            title, _, spec = name.partition(" (")
            store(data, f"padova:{slug(name)}", "padova", "padova", "Cereali e mangimi", "€/t", title, section,
                  f"({spec}" if spec else "", path.stem, float(vals[2]), float(vals[3]))


def read_ismea():
    if not ISMEA_FILE.exists():
        return []
    with open(ISMEA_FILE, newline="", encoding="utf-8") as f:
        return list(csv.reader(f))[1:]


def download_ismea():
    known = {tuple(r[:3]) for r in read_ismea()}
    q = "[\"']"
    pattern = re.compile(rf"<td class={q}dataril{q}>(\d\d)-(\d\d)-(\d\d)</td>\s*<td class={q}wrap{q}>(.*?)</td>\s*"
                         rf"<td class={q}number{q}>([\d.,]+)\s*(.*?)</td>.*?<td class={q}wrap{q}>(.*?)</td>", re.S)
    new = []
    for market, place in ISMEA_PLACES.items():
        page = curl(f"{ISMEA}/ISUQC7/{place}").decode("utf-8", "replace")
        for dd, mm, yy, name, value, unit, cond in pattern.findall(page):
            row = [market, f"20{yy}-{mm}-{dd}", " ".join(html.unescape(name).split()), value, html.unescape(unit).strip(), html.unescape(cond).strip()]
            if tuple(row[:3]) not in known:
                known.add(tuple(row[:3]))
                new.append(row)
        time.sleep(0.5)
    header = not ISMEA_FILE.exists()
    with open(ISMEA_FILE, "a", newline="", encoding="utf-8") as f:
        out = csv.writer(f)
        if header:
            out.writerow(["mercato", "data", "prodotto", "prezzo", "unita", "condizione"])
        out.writerows(new)
    print(f"ISMEA: {len(new)} nuove quotazioni")
    if not new and not known:
        raise RuntimeError("nessuna quotazione letta: la pagina potrebbe essere cambiata")


def add_ismea(data):
    for market, day, name, value, unit, cond in read_ismea():
        if market not in ISMEA_PLACES:
            continue
        parts = [p.strip() for p in name.split(" - ") if p.strip().lower() not in ("ns", "n.s.")]
        low, _ = price(value)
        group = next((g for g, rx in ISMEA_GROUPS if re.search(rx, name, re.I)), "Ortofrutta")
        key = f"{market}:i-{slug(name)}"
        store(data, key, market, "ismea", group, unit.replace("/T", "/t").replace("/Kg", "/kg"), ", ".join(parts), "", cond, day, low, low)
        data["products"][key]["commodity"] = data["products"][key]["commodity"] or parts[0]


def flag_suspects(rows):
    """Marca con il bit 2 i prezzi incoerenti con le rilevazioni vicine: il valore originale resta invariato."""
    values = [r[2] or r[1] for r in rows]
    for i, row in enumerate(rows):
        near = values[max(0, i - 5):i] + values[i + 1:i + 6]
        odd = len(near) >= 3 and not statistics.median(near) / 3 <= values[i] <= statistics.median(near) * 3
        gap = row[1] and row[2] and row[1] < row[2] / 3
        row[3] = (row[3] & 1) | (2 if odd or gap else 0)
    return rows


def attempt(name, fn, *args):
    try:
        fn(*args)
    except Exception as err:  # una fonte non disponibile non deve fermare le altre
        print(f"{name}: saltato ({err})")


def read_futures():
    with open(ROOT / "data/futures.csv", newline="") as f:
        return [dict(r, prezzo=float(r["prezzo"])) for r in csv.DictReader(f)]


def main():
    args = argparse.ArgumentParser()
    args.add_argument("--since", type=int, default=2022)
    args.add_argument("--solo-locale", action="store_true")
    args = args.parse_args()
    data, seen = load_previous()
    if not args.solo_locale:
        attempt("Verona", download_verona, args.since, seen)
        attempt("Treviso", download_treviso, args.since, seen)
        attempt("Padova", download_padova, args.since, seen)
        attempt("ISMEA", download_ismea)
    for path in sorted((ROOT / "data").glob("verona_listino_*.xml")) + sorted(RAW.glob("*.xml"), key=lambda p: int(p.stem)):
        read_portal(path, "verona", data)
        if path.parent == RAW:
            seen.add(f"verona:{path.stem}")
    for path in sorted((RAW / "treviso").glob("*.xml"), key=lambda p: int(p.stem)):
        read_portal(path, "treviso", data)
        seen.add(f"treviso:{path.stem}")
    try:
        for path in sorted((RAW / "padova").glob("*.xls")):
            read_padova(path, data)
            seen.add(f"padova:{path.stem}")
    except ImportError:
        print("Padova saltata: manca xlrd, vedi README")
    add_ismea(data)
    series = {k: [[d, *v] for d, v in sorted(s.items()) if int(d[:4]) >= args.since] for k, s in data["series"].items()}
    series = {k: flag_suspects(rows) for k, rows in series.items() if rows and k.split(":")[0] in {m["id"] for m in MARKETS}}
    products = [p for p in data["products"].values() if p["key"] in series]
    result = dict(generatedAt=datetime.now(timezone.utc).isoformat(timespec="minutes"), markets=MARKETS, sources=SOURCES,
                  products=sorted(products, key=lambda p: (p["group"], p["name"])), series=series, futures=read_futures(), seen=sorted(seen))
    OUT.write_text("window.AGRI_DATA=" + json.dumps(result, ensure_ascii=False, separators=(",", ":")) + ";\n", "utf-8")
    suspects = sum(r[3] >> 1 for rows in series.values() for r in rows)
    print(f"{len(products)} prodotti in {len({p['market'] for p in products})} mercati, {suspects} valori da verificare -> {OUT}")


if __name__ == "__main__":
    main()
