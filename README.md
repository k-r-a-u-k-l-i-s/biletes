# Biļešu pieejamība

Statiska lapa, kas rāda gaidāmās izrādes un atlikušo biļešu skaitu
norises vietai **360** (Austrumu Robeža teātra klubs).

- Datums, laiks, izrādes nosaukums, atlikušās biļetes
- 🟢 10 vai vairāk · 🟡 mazāk nekā 10 · 🔴 izpārdots · 🔵 vēl nav pārdošanā · ⚪ atcelts
- Kopsavilkums galvenē: atlikušās biļetes, izrāžu skaits, šajā sezonā pārdotais
- Sezonu uzskaite ar pārslēgšanos 1. jūlijā; vecās sezonas saglabājas
- Pārdošanas rādītājs (`▼4`) — pēdējās nedēļas laikā pārdotās biļetes
- Sadaļa **Nesen pabeigtas** ar pēdējām 10 noslēgtajām izrādēm
- Sistēmas fonti, bez attēliem, bez bibliotēkām — `index.html` ~10 KB

## Kāpēc dati tiek gatavoti atsevišķi

Bilešu Paradīzes API **nesūta CORS galvenes**, tāpēc pārlūks nevar to izsaukt
tieši no citas vietnes — lapa ielādētos, bet saraksts paliktu tukšs.

Tā vietā GitHub Actions ik pēc 30 minūtēm izsauc API servera pusē un saglabā
`data.json` blakus lapai. Lapa lasa to no tā paša domēna — bez CORS un ātrāk:
**401 KB → ~11 KB**.

```
API → build-data.mjs (GitHub Actions) → data.json → index.html
```

## Kā tiek skaitītas pārdotās biļetes

API atdod **tikai atlikušo skaitu** (`prices[].count`) — kopējās ietilpības vai
pārdoto biļešu lauka tajā nav vispār. Zāles ietilpība ir **60 vietas** un neviena
izrāde nekad nav uzrādījusi vairāk, tāpēc:

```
pārdots = 60 − atlikušās biļetes
```

Sezonas summa (`sold`) = visu pašlaik saraksta šīs sezonas izrāžu pārdotais
**plus** `banked[sezona]` — jau noslēgto izrāžu pārdotais, kas tiek iekrāts
brīdī, kad izrāde pazūd no saraksta. Tāpēc summa nesamazinās, kad `finished`
saraksts pārsniedz 10 ierakstus un vecākie no tā izkrīt.

### Sezonu robeža

Sezona ilgst no augusta līdz maijam, un jūnijā–jūlijā izrāžu nav. Skaitītājs
pārslēdzas **1. jūlijā** — tieši šajā tukšajā posmā, tāpēc neviena sezona
netiek pārrauta uz pusēm:

```js
const SEASON_START_MONTH = 7; // jūlijs
```

Kalendārais gads neder: pašreizējais repertuārs iet no 2026. gada augusta līdz
2027. gada janvārim, un tā ir **viena** sezona — `2026/2027`.

Katra noslēgtā izrāde tiek ieskaitīta tajā sezonā, **kurai pieder tās datums**,
nevis tajā, kura ir šobrīd. Tāpēc sezonas noslēdzas pašas no sevis: nav
atsevišķas «pārslēgšanas» darbības, un izrāde, kas beidzas 1. jūlijā, joprojām
tiek ieskaitīta tajā sezonā, kurā tā notika. Jau izsludinātās nākamās sezonas
izrādes šīs sezonas summā netiek skaitītas.

Noslēgtās sezonas saglabājas `banked` un tiek rādītas lapas apakšā sadaļā
**«Iepriekšējās sezonas»**. Nekas netiek dzēsts — skaitītājs sākas no nulles,
bet vecie skaitļi paliek.

### Atceltās izrādes

Bilešu Paradīzei **nav «atcelts» stāvokļa** — atcelta izrāde uzrāda 0 atlikušo
un no izpārdotas neatšķiras. Tādas jāuzskaita ar roku failā `build-data.mjs`:

```js
const CANCELLED_IDS = new Set([
  175651, // 2026-09-29 "Divi duči sārtu rožu" — atcelta, nevis izpārdota
]);
```

Uzskaitītās izrādes netiek skaitītas kā pārdotas (citādi katra pieliktu veselu
zāli — 60 biļetes) un lapā tiek rādītas kā **«Atcelts»**, nevis «Izpārdots».

### Pārdošanas rādītājs `▼`

Atsevišķi no sezonas summas skripts salīdzina šo palaišanu ar iepriekšējo
**pēc `id`**:

| Situācija | Rīcība |
|---|---|
| tas pats `id`, skaits samazinājies | starpība → `delta`, lapā `▼4` |
| `id` iepriekš nebija | jauna izrāde — nekāda starpība |
| `id` pazudis no API (vai iznācis ārpus 12 h filtra) | pārceļ uz `finished`, iesaldējot pēdējo zināmo skaitu — **netiek uzskatīts par kritumu līdz nullei** |

Konstatētais kritums **netiek aizmirsts nākamajā palaišanā**. Katrai izrādei
tiek glabāts savs kritumu žurnāls `drops`, un `delta` ir to summa pēdējās
**7 dienās**:

```js
const DROP_WINDOW_DAYS = 7;
```

Ja to nedarītu, rādītājs dzīvotu tikai 30 minūtes — līdz nākamajai palaišanai —
un praksē to gandrīz nekad nesanāktu redzēt.

Ieraksti tiek grupēti pa dienām (`[["2026-08-04", 4], ["2026-08-07", 8]]`), tāpēc
vienas dienas pārdošanas saplūst vienā ierakstā un žurnāls nekad nav garāks par
`DROP_WINDOW_DAYS` ierakstiem neatkarīgi no tā, cik bieži skripts palaižas.
Vecākie ieraksti izkrīt paši.

## Faili

| Fails | Nozīme |
|---|---|
| `index.html` | visa lapa (HTML + CSS + JS) |
| `data.json` | sagatavotie dati + sezonas skaitītājs, atjauno Actions |
| `build-data.mjs` | iegūst API atbildi, salīdzina ar iepriekšējo, saspiež |
| `.github/workflows/update-data.yml` | ik pēc 30 min palaiž skriptu un saglabā izmaiņas |

## `data.json` struktūra

```jsonc
{
  "updated": "2026-08-07T11:48:29.858Z",
  "venue": "Austrumu Robeža teātra klubs",
  "capacity": 60,                                // vietu skaits zālē
  "season": "2026/2027",                         // šī brīža sezona
  "totals": { "remaining": 3135, "shows": 63 },  // kopā atlicis · izrāžu skaits
  "sold": 585,                                   // pārdots šajā sezonā
  "banked": { "2026/2027": 0 },                  // iekrātais pa sezonām (avota dati)
  "seasons": [                                   // noslēgtās sezonas, jaunākā pirmā
    { "id": "2025/2026", "sold": 4210 }
  ],
  "events": [
    {
      "id": 174935,                              // stabila atslēga salīdzināšanai
      "d": "2026-08-19T19:00:00",                // sākums, Rīgas laiks, bez zonas
      "t": "Neliešu balle",                      // performance.titles.lv
      "n": 28,                                   // atlikušās biļetes (prices[].count summa)
      "u": "https://www.bilesuparadize.lv/lv/event/174935",
      "s": "2026-06-10T00:00:00",                // sales.start — šķir "izpārdots" no "vēl nav pārdošanā"
      "cancelled": true,                         // tikai atceltajām (skat. CANCELLED_IDS)
      "drops": [["2026-08-04", 4], ["2026-08-07", 8]],  // kritumi pa dienām, 7 dienu logs
      "delta": 12                                // drops summa — lapā "▼12"
    }
  ],
  "finished": [                                  // pēdējās 10 noslēgtās, iesaldētas
    { "id": 174900, "d": "...", "t": "...", "n": 6 }
  ]
}
```

Lauki `cancelled`, `drops` un `delta` parādās tikai tad, kad tiem ir vērtība.

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
- Krāsu robežas ir `index.html` funkcijā `level()`: `0` sarkans, `1–9` dzeltens,
  `≥10` zaļš; nākotnes `sales.start` vienmēr nozīmē zilo «vēl nav pārdošanā».
- Galvenes skaitļus lapa rēķina no tā, kas tiešām redzams sarakstā (lapa filtrē
  stingrāk nekā skripts), tāpēc galvene un saraksts nekad nesaiet pretrunā.
  `totals` failā paliek skripta rēķinātais — noderīgs, ja `data.json` lasa kas cits.
- Ja API atbild ar kļūdu vai tukšu sarakstu, skripts pārtrauc darbu **neko
  nerakstot** — saglabājas gan dati, gan `banked`, gan `finished`.
- `banked` nav atjaunojams no API (tas glabā vēsturi, ko API vairs nerāda) —
  to nevajag dzēst ar roku.
- Atbilde bez neviena cenu ieraksta netiek uzskatīta par momentānu izpārdošanu,
  lai kļūda API pusē neiepludinātu sezonas skaitītājā neesošas pārdošanas.
- GitHub aptur `schedule` darbus, ja repozitorijā 60 dienas nav aktivitātes —
  pietiek ar vienu commit vai palaišanu ar roku (**Actions → Run workflow**).
