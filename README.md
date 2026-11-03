# AgroListino - Monitor Borse Merci

App web responsive per consultare i prezzi agricoli della Borsa Merci di Verona.

## Aprire l'app
Apri `docs/index.html` con un doppio clic.

## Aggiornare i dati
1. Apri il Terminale.
2. Entra nella cartella: `cd ~/Desktop/AgroListino`
3. Solo la prima volta: `python3 -m venv .venv`
4. Solo la prima volta: `.venv/bin/python -m pip install xlrd`
5. Avvia l'aggiornamento: `.venv/bin/python scripts/update_data.py`
6. Ricarica `docs/index.html`.

I file in `data/raw/` servono solo sul Mac: lo storico elaborato resta in `docs/data.js`.

Il primo download richiede tempo. Ogni nuova esecuzione scarica solo cio' che manca.
Se una fonte non risponde, lo script la salta e prosegue con le altre.

## Fonti
| Mercato | Fonte | Contenuto | Storico |
|---|---|---|---|
| Verona | Camera di Commercio | Cereali, mangimi, vini, avicunicoli, lattiero-caseari | Dal 2022 |
| Treviso | Camera di Commercio Treviso-Belluno | Cereali, mangimi, vini, pollame | Dal 2022 |
| Padova | Camera di Commercio | Cereali e mangimi | Da marzo 2026 |
| Verona, Treviso, Padova, Rovigo, Venezia | ISMEA, prezzi all'origine | Ortofrutta, cereali, bestiame e altro, secondo la settimana | Dalla prima esecuzione |

ISMEA pubblica in questa pagina solo le rilevazioni piu' recenti: lo storico cresce a ogni aggiornamento e resta in `data/ismea.csv`.
Per Belluno non ho trovato una rilevazione attuale. Vicenza e' stata esclusa: non ha una propria borsa merci.

## Aggiornamento automatico e uso da telefono
1. Dal Terminale esegui una volta `.venv/bin/python scripts/update_data.py --solo-locale`, cosi' `docs/data.js` contiene tutto lo storico.
2. Crea un repository su GitHub e carica questa cartella, escluse `.venv/` e `data/raw/`.
3. Su GitHub crea il file `.github/workflows/update.yml` con il testo qui sotto.
4. In Settings > Pages scegli il branch `main` e la cartella `/docs`.
5. In Actions avvia "Aggiorna prezzi" la prima volta. Poi parte ogni martedi' mattina.

```yaml
name: Aggiorna prezzi
on:
  schedule:
    - cron: "17 7 * * 2"  # martedi' mattina
  workflow_dispatch:
permissions:
  contents: write
jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: python3 -m pip install xlrd
      - run: python3 scripts/update_data.py
      - run: |
          git config user.name "agrolistino-bot"
          git config user.email "actions@users.noreply.github.com"
          git add data docs
          git diff --cached --quiet || git commit -m "Aggiorna listini"
          git push
```

L'app sara' disponibile all'indirizzo indicato da GitHub Pages.

## Modificare l'interfaccia
Serve Node.js.
1. `cd app`
2. `npm install`
3. `npm run build`

## Futures
Aggiungi le quotazioni in `data/futures.csv`, poi esegui di nuovo lo script.
I prezzi devono provenire da una fonte che ne permetta il riuso.

    simbolo,prodotto,scadenza,data,prezzo
    EBM,Frumento tenero,dic-26,AAAA-MM-GG,PREZZO

I simboli collegati sono `EBM` per il grano tenero e `EMA` per il mais.

## Aggiungere un mercato
1. Aggiungi il mercato a `MARKETS` in `scripts/update_data.py`.
2. Scrivi la lettura della sua fonte, salvando prodotti e prezzi nello stesso formato di Verona.
3. Imposta `active=True`.

## Limiti
- Le borse pubblicano rilevazioni settimanali. La Camera di Commercio di Verona non quota piu' l'ortofrutta da luglio 2022.
- Nel confronto, qualita' e fase di scambio possono cambiare da una voce all'altra.
- I prodotti non quotati da 4 mesi sono nascosti, salvo attivare l'opzione nell'elenco.
- I prezzi sono indicativi. La linea del grafico e' la media tra minimo e massimo.
- Prima di pubblicare l'app, verifica le condizioni di riuso con la Camera di Commercio.
