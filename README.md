# Biļešu pieejamība

Statiska lapa, kas rāda gaidāmās izrādes un atlikušo biļešu skaitu
norises vietai **360** (Austrumu Robeža teātra klubs).

- Datums, laiks, izrādes nosaukums, atlikušās biļetes
- 🟢 10 vai vairāk · 🟡 mazāk nekā 10 · 🔴 izpārdots
- Sistēmas fonti, bez attēliem, bez bibliotēkām — `index.html` ~7 KB
- Rinda ved uz izrādes lapu bilesuparadize.lv

## Kāpēc dati tiek gatavoti atsevišķi

Bilešu Paradīzes API **nesūta CORS galvenes**, tāpēc pārlūks nevar to izsaukt
tieši no citas vietnes — lapa ielādētos, bet saraksts paliktu tukšs.

Tā vietā GitHub Actions ik pēc 15 minūtēm izsauc API servera pusē un saglabā
`data.json` blakus lapai. Lapa lasa to no tā paša domēna — bez CORS un ātrāk:
**401 KB → 7 KB**.

```
API → build-data.mjs (GitHub Actions) → data.json → index.html
```

## Faili

| Fails | Nozīme |
|---|---|
| `index.html` | visa lapa (HTML + CSS + JS) |
| `data.json` | sagatavotie dati, atjauno Actions |
| `build-data.mjs` | iegūst un saspiež API atbildi |
| `.github/workflows/update-data.yml` | ik pēc 15 min palaiž skriptu un saglabā izmaiņas |

## Publicēšana

```bash
git remote add origin git@github.com:LIETOTAJS/biletes.git
git push -u origin main
```

Pēc tam repozitorijā:

1. **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`**
2. **Settings → Actions → General → Workflow permissions → Read and write permissions**
   (bez tā Actions nevar saglabāt `data.json`)

Lapa būs pieejama: `https://LIETOTAJS.github.io/biletes/`

## Vietējā pārbaude

`file://` neder — `fetch` prasa HTTP:

```bash
python3 -m http.server 8000
```

Datu atjaunošana ar roku:

```bash
node build-data.mjs
```

## Piezīmes

- Citai norises vietai: nomaini `VENUE_ID` failā `build-data.mjs`.
- Krāsu robežas ir `index.html` funkcijā `level()`: `0` sarkans, `1–9` dzeltens, `≥10` zaļš.
- GitHub aptur `schedule` darbus, ja repozitorijā 60 dienas nav aktivitātes —
  pietiek ar vienu commit vai palaišanu ar roku (**Actions → Run workflow**).
- Ja API atbild ar kļūdu vai tukšu sarakstu, skripts pārtrauc darbu un
  `data.json` paliek nemainīts — lapa rāda iepriekšējos datus, nevis tukšumu.
