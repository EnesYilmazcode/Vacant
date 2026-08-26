# Geocoding OSU buildings for Vacant

Research note, 2026-08-26. Everything below was measured against live services, not reasoned about.

62 HTTP requests total: 38 to `content.osu.edu`, 7 to `gissvc.osu.edu`, 7 to `maps.osu.edu`
(1 useful, 6 spent on config paths that 404), 3 to Overpass, 3 to Wikidata, 2 to `arcgis.com`,
2 to Nominatim. Eight of the 62 produced nothing: the six `maps.osu.edu` 404s, one Overpass 429
retry, and one SPARQL query against the wrong OSU entity id.

## The headline

**Problem:** the class API names rooms like `DL0357` in "Dreese Laboratories" but carries no
coordinates, so Vacant cannot rank a room by walking distance.

**Fix:** Ohio State publishes its own building layer on its own public ArcGIS server, and its
`buildingNumber` field is character-for-character the same value as the class API's
`meetings[].buildingCode`. It is a key join, not a fuzzy name match. All 80 buildings observed in
live Autumn 2026 schedule data joined on the first try, and the layer carries latitude, longitude,
campus, address and floor count already.

```
BLUEPRINT PLAN                              WHAT ACTUALLY WORKS

class API                                   class API
  meetings[].facilityDescription              meetings[].buildingCode  = "279"
      = "Dreese Laboratories"                          |
           |                                           |  exact string equality
           |  normalise + fuzzy match                  |  no padding, no normalising
           v                                           v
OSM via Overpass                            OSU FOD/FITS GIS, Building layer
  way[building][name]                         buildingNumber = "279"
      = "Dreese Laboratories"                 Latitude / Longitude / Campus
           |                                  SchedulingAbbreviation = "DL"
           v                                           |
  70 of 80 matched (87.5%)                             v
  10 need a human                            80 of 80 matched (100%)
  Ohio Stadium silently missing              Wooster buildings self-identify
```

OSM is still worth pulling, but as a second opinion rather than as the source. Where both sources
name the same building the two coordinates sit a median of **3.1 m** apart, and that agreement is
what earns a row the `verified` tier in the draft dataset.

---

## 1. The authoritative source

`maps.osu.edu` (where `www.osu.edu/map/` redirects) is an Esri Experience Builder app. The
blueprint is right that its candidate JSON endpoints return an HTML shell, but the shell gives the
game away: it loads `./jimu-core/init.js`, and `jimu-core` is Experience Builder. Experience
Builder means ArcGIS, and ArcGIS means a REST service somewhere.

Finding it took two hops through ArcGIS Online's public search:

```bash
# hop 1: who at OSU publishes GIS?
curl -s "https://www.arcgis.com/sharing/rest/search?q=Ohio+State+University+building&f=json&num=25&sortField=numviews&sortOrder=desc"
#   -> owner "IDM801688678_OSUGIS", "Facilities Information and Technology Services- GIS Hub"

# hop 2: what does that account publish?
curl -s "https://www.arcgis.com/sharing/rest/search?q=owner:IDM801688678_OSUGIS&f=json&num=100"
#   -> 13 items, several pointing at https://gissvc.osu.edu/arcgis/rest/services
```

`gissvc.osu.edu` is OSU's own ArcGIS Server and its service directory is browsable with no key:

```bash
curl -s "https://gissvc.osu.edu/arcgis/rest/services?f=json"
#   folders: AGOL, Apps, Connectors, Data, Hosted, Imagery, OSUMaps, Utilities
curl -s "https://gissvc.osu.edu/arcgis/rest/services/Data?f=json"
#   -> Data/FacilitiesStreets_RO  (MapServer)
curl -s "https://gissvc.osu.edu/arcgis/rest/services/Data/FacilitiesStreets_RO/MapServer?f=json"
#   -> layer 11 = "Building", capabilities "Query,Map,Data", maxRecordCount 2000
```

Note that `CampusMap_AGOL_RO`, the service the GIS Hub item still advertises, is dead: it answers
HTTP 200 with `{"error":{"code":404,"message":"Service AGOL/CampusMap_AGOL_RO/MapServer not
found"}}`. Check the body, not the status code.

### The one request that matters

```bash
curl -s -G "https://gissvc.osu.edu/arcgis/rest/services/Data/FacilitiesStreets_RO/MapServer/11/query" \
  --data-urlencode "where=1=1" \
  --data-urlencode "outFields=BLDG_NUM,BLDG_NAME,buildingNumber,SchedulingAbbreviation,FormalName,AlsoKnownAs,CampusMap,Address,City,State,Zip,Campus,Geography,Status,InstType,OwnerName,FloorCount,Latitude,Longitude" \
  --data-urlencode "returnGeometry=false" \
  --data-urlencode "outSR=4326" \
  --data-urlencode "f=json"
```

Measured: **1347 features, `exceededTransferLimit` absent**, so one request is the entire layer.
1330 distinct `buildingNumber` values, 1333 features carrying a latitude.

`Campus` breakdown of the 1333 geolocated features:

| Campus | Features |
|---|---|
| Columbus | 501 |
| Satellite | 326 |
| Wooster | 282 |
| Medical Center | 127 |
| Mansfield | 38 |
| Newark | 22 |
| Marion | 19 |
| Lima | 18 |

Exactly one record has a `buildingNumber` and no coordinate: `1072`, St. Stephen's Episcopal
Church, Columbus.

Two gotchas on the request itself. `returnCentroid=true` is accepted but silently returns nothing
on a MapServer layer (0 of 1347 features came back with a centroid), so use the `Latitude` and
`Longitude` **attribute** fields instead. Those attributes are typed as strings, not numbers, so
cast them: `Counter({'str': 1330, 'NoneType': 1})`.

### The join key

| Class API (`meetings[]`) | GIS Building layer | Agreement |
|---|---|---|
| `buildingCode` = `"279"` | `buildingNumber` = `"279"` | 80/80 = **100%** |
| `buildingCode` = `"279"` | `BLDG_NUM` = `"0279"` | zero-padded to 4, so use `buildingNumber` |
| prefix of `buildingDescriptionShort` (`"DL 357"` -> `DL`) | `SchedulingAbbreviation` = `"DL"` | 75/79 exact |

The four `SchedulingAbbreviation` disagreements are my parser's fault, not the data's. I split
`buildingDescriptionShort` on its last space, which breaks on the rows where the room label itself
contains a space (`280` Baker, `146` Bolz, `245` PAES), and one building, `1321` Waterman, has a
null `SchedulingAbbreviation` in GIS while the schedule uses `MALC`. **Join on `buildingNumber`.
Treat `SchedulingAbbreviation` as a display nicety.**

### Fields the layer gives away for free

`Address`, `Zip`, `Campus`, `Geography` ("Columbus Contiguous"), `Status` (1334 Active, 5 Under
Construction, 5 Pending), `InstType` (Academic / Student Life / Athletics / Airport / CampusParc /
...), `FloorCount`, `GrossArea`, `FormalName`, `AlsoKnownAs`, and `PhotoLink`, which is a
predictable URL of the form
`https://maps.osu.edu/components/building_photos/building-image-279.jpg`.

`FloorCount` matters more than it looks. A room number's leading digit is a floor, so a future
"how many stairs" penalty on the walking estimate has a source.

---

## 2. What Vacant actually needs

### The sample

36 subjects, page 1 only, Autumn 2026, filtered to in-person sections:

```
https://content.osu.edu/v2/classes/search?q=&subject=<code>&term=1268&campus=col&p=1&sort=catalogNumber&instruction-mode=p
```

Subjects were picked for geographic spread, not size: `mecheng ece civilen aviatn arch hcs animsci
enr fdscte nursing phr hthrhsc pubhlth anatomy dent vetclin optom music art dance theatre busfin
history english psych politsc socwork law chem physics biology earthsc math knsfhp milsci edutl`,
plus one unfiltered `cse` page.

Measured: **5746 meeting rows, 586 distinct (buildingCode, room) pairs, 82 distinct building
codes**, of which 80 are real buildings and two are the pseudo-codes `ONLINE` and `OFFCAMPUS`.

`instruction-mode=p` is worth using on the harvest. It is a real facet on the response (`slug:
"instruction-mode"`, `term: "p"`, "In Person") and it strips the independent-study bulk. CSE alone
has 657 Independent Study sections out of 1064.

### The sample is not the full list

Rarefaction over the 36 sampled subjects, 400 random shuffles, mean distinct buildings after *n*
subjects:

| Subjects | Distinct buildings |
|---|---|
| 1 | 9.2 |
| 3 | 22.4 |
| 6 | 35.9 |
| 10 | 47.4 |
| 15 | 57.2 |
| 20 | 63.9 |
| 25 | 69.7 |
| 30 | 74.6 |
| 36 | 80.0 |

The curve is still climbing at roughly 5 new buildings per 6 new subjects and shows no sign of
flattening. With 243 subjects in term 1268 and only page 1 of each pulled here, **the real building
list is meaningfully larger than 80, and only a full harvest produces it.** Proof by example:
`Mathematics Tower` (code `007`) is absent from this sample even though `math` was one of the
sampled subjects, because `sort=catalogNumber` filled page one with MATH 1xxx lecture halls.

This does not threaten the geocoding. The GIS layer already holds all 1330 building numbers, so
whatever the full harvest turns up will join without another lookup.

### The distinct triples observed

`(buildingCode, facilityDescription, facilityDescriptionShort)`, with the GIS row each one joins
to, sorted by code:

| code | facilityDescription | facilityDescriptionShort | Sched. abbr | GIS BLDG_NAME | meetings |
|---|---|---|---|---|---|
| `003` | Agricultural Administration | `Agr Adm` | AA | Agricultural Administration | 16 |
| `004` | 209 West Eighteenth Avenue | `209 W 18th` | EA | Eighteenth Ave, 209 W | 16 |
| `005` | 18th Avenue Library | `18th Ave L` | SE | Eighteenth Avenue Library | 1 |
| `011` | Arps Hall | `Arps Hall` | AP | Arps Hall | 7 |
| `014` | Jennings Hall | `Jennings` | JE | Jennings Hall | 194 |
| `017` | Knowlton Hall | `Knowlton` | KN | Knowlton Hall | 44 |
| `018` | Campbell Hall | `Campbell` | CM | Campbell Hall | 13 |
| `024` | Postle Hall | `Postle` | PH | Postle Hall | 4 |
| `025` | Derby Hall | `Derby` | DB | Derby Hall | 36 |
| `026` | Caldwell Laboratory | `Caldwell` | CL | Caldwell Laboratory | 92 |
| `030` | Denney Hall | `Denney` | DE | Denney Hall | 97 |
| `037` | Hagerty Hall | `Hagerty` | HH | Hagerty Hall | 14 |
| `038` | Hamilton Hall | `Hamilton` | HM | Hamilton Hall | 52 |
| `039` | Hayes Hall | `Hayes Hall` | HA | Hayes Hall | 19 |
| `041` | Lazenby Hall | `Lazenby` | LZ | Lazenby Hall | 20 |
| `046` | Journalism Building | `Journalism` | JR | Journalism Building | 43 |
| `049` | Drinko Hall, John Deaver | `Drinko Hal` | DI | Drinko Hall | 124 |
| `053` | McPherson Chemical Lab | `McPherson` | MP | McPherson Chemical Laboratory | 61 |
| `054` | Mendenhall Laboratory | `Mendenhall` | ML | Mendenhall Laboratory | 78 |
| `056` | Converse Hall | `Converse` | CV | Converse Hall | 16 |
| `060` | Orton Hall | `Orton` | OR | Orton Hall | 5 |
| `061` | Page Hall | `Page` | PA | Page Hall | 6 |
| `063` | Cockins Hall | `Cockins` | CH | Cockins Hall | 10 |
| `064` | Parker Food Science & Tech | `Parker Fd` | FS | Parker Food Science and Technology | 54 |
| `065` | Smith Laboratory | `Smith Lab` | SM | Smith Laboratory | 208 |
| `066` | Plumb Hall | `Plumb` | PL | Plumb Hall | 26 |
| `067` | Pomerene Hall | `Pomerene` | PO | Pomerene Hall | 31 |
| `072` | Enarson Classroom Building | `EnrsnClsrm` | EC | Enarson Classroom Building | 79 |
| `082` | Ohio Stadium | `Stadium` | ST | Ohio Stadium | 2 |
| `084` | Stillman Hall | `Stillman` | SH | Stillman Hall | 77 |
| `087` | Townshend Hall | `Townshend` | TO | Townshend Hall | 4 |
| `090` | Ramseyer Hall | `Ramseyer` | RA | Ramseyer Hall | 6 |
| `106` | Sullivant Hall | `Sullivant` | SU | Sullivant Hall | 112 |
| `144` | Psychology Building | `Psychology` | PS | Psychology Building | 35 |
| `146` | Bolz Hall | `Bolz Hall` | BO | Bolz Hall | 73 |
| `148` | Scott Lab | `Scott Lab` | SO | Scott Laboratory | 194 |
| `149` | Hopkins Hall | `Hopkins` | HC | Hopkins Hall | 69 |
| `150` | Evans Laboratory | `Evans Lab` | EL | Evans Laboratory | 37 |
| `156` | Animal Science Building | `Animal Sci` | AS | Animal Science Building | 22 |
| `161` | Ohio Union, New | `Union, New` | OU | Ohio Union | 2 |
| `211` | Adventure Recreation Center | `Adv Rec Ct` | AR | Adventure Recreation Center | 7 |
| `222` | Heffner Wetland Rsch & Educ | `Heffnr Wet` | HW | Heffner Wetland Research and Education | 2 |
| `245` | Phys Activ & Educ Srvs Bldg | `PAES` | PE | Physical Activity and Education Services - PAES | 60 |
| `246` | Recreation & Phys Activ Ctr | `RPAC` | RP | Recreation and Physical Activity Center | 31 |
| `248` | Chem & Biomolecular Eng & Chem | `CBEC` | CB | CBEC | 2 |
| `249` | Fisher Hall, Max M | `Fisher Hal` | FI | Fisher Hall | 5 |
| `250` | Gerlach Graduate Programs Bldg | `Gerlach` | GE | Gerlach Hall | 35 |
| `251` | Schoenbaum Hall | `Schoenbaum` | SB | Schoenbaum Hall | 85 |
| `252` | Mason Hall | `Mason Hall` | MH | Mason Hall | 9 |
| `266` | Riffe Building | `Riffe Bldg` | RF | Riffe Building | 13 |
| `271` | Lincoln Tower | `Lincoln` | LT | Lincoln Tower | 1 |
| `273` | Parks Hall | `Parks Hall` | PK | Parks Hall | 36 |
| `274` | Hitchcock Hall | `Hitchcock` | HI | Hitchcock Hall | 42 |
| `275` | Newton Hall | `Newton` | NH | Newton Hall | 10 |
| `276` | Biological Sciences Building | `Bioscience` | BI | Biological Sciences Building | 7 |
| `277` | Graves Hall | `Graves` | GR | Graves Hall | 1 |
| `279` | Dreese Laboratories | `Dreese Lab` | DL | Dreese Laboratories | 90 |
| `280` | Baker Systems Engineering | `Baker Sys` | BE | Baker Systems Engineering | 88 |
| `281` | Meiling Hall | `Meiling` | ME | Meiling Hall | 2 |
| `293` | Cunz Hall | `Cunz Hall` | CZ | Cunz Hall | 14 |
| `295` | Howlett Hall | `Howlett` | HT | Howlett Hall | 19 |
| `297` | Howlett Greenhouses | `Howlett Gr` | HG | Howlett Greenhouses | 10 |
| `303` | McCampbell Hall | `McCampbell` | MC | McCampbell Hall | 3 |
| `306` | Atwell Hall | `Atwell Hal` | AH | Atwell Hall | 8 |
| `337` | Dulles Hall | `Dulles` | DU | Dulles Hall | 17 |
| `338` | Independence Hall | `Indpndnce` | IH | Independence Hall | 3 |
| `339` | University Hall | `U Hall` | UH | University Hall | 24 |
| `340` | Kottman Hall | `Kottman` | KH | Kottman Hall | 103 |
| `355` | Weigel Hall | `Weigel` | WG | Weigel Hall | 27 |
| `358` | Sherman Studio Art Center | `Sherman` | SA | Sherman Studio Art Center | 8 |
| `371` | Celeste Laboratory Of Chem | `Celeste Lb` | CE | Celeste Laboratory of Chemistry | 159 |
| `404` | Gerlaugh Hall | `Gerlaugh H` | GH | Gerlaugh Hall | 1 |
| `414` | Williams Hall | `Williams` | WI | Williams Hall | 2 |
| `549` | CFAES Wooster Admin Bldg | `CFAES WAB` | WAB | CFAES Wooster Administration Building | 1 |
| `1018` | Fontana Laboratories | `Fontana` | FL | Fontana Laboratories | 20 |
| `1019` | Knowlton Airport Terminal | `Knowlton A` | KT | Knowlton Executive Terminal | 3 |
| `1025` | Theatre, Film & Media Arts Bld | `TFM` | TFM | Theatre, Film and Media Arts Building | 70 |
| `1064` | Timashev Family Music Building | `Timashev` | TMV | Timashev Family Music Building | 63 |
| `1069` | Heminger Hall | `Heminger` | HMH | Heminger Hall | 15 |
| `1321` | Waterman- Multispecies Animal | `MALC` | - | Waterman - Multispecies Animal Learning Complex | 22 |
| `ONLINE` | ONLINE | `ONLINE` | - | (pseudo) | 14 |
| `OFFCAMPUS` | Off Campus | `OFFCAMPUS` | - | (pseudo) | 10 |

---

## 3. Three field traps in the class API

**`buildingDescription` is not a building description.** It is the room label. A real row:

```json
{"buildingCode": "053", "buildingDescription": "McPherson Lab 1000",
 "buildingDescriptionShort": "MP 1000", "facilityDescription": "McPherson Chemical Lab",
 "facilityDescriptionShort": "McPherson", "facilityId": "MP1000", "facilityType": "1C",
 "facilityCapacity": 380, "room": "1000"}
```

3131 of 5746 sampled meeting rows have `buildingDescription != facilityDescription`, which is every
row that actually has a room. **`facilityDescription` is the building name. `buildingDescription`
and `buildingDescriptionShort` both include the room number.**

**`facilityDescriptionShort` is truncated to 10 characters.** Length histogram across the sample:
3 chars 70 rows, 4 chars 121, 5 chars 67, 6 chars 194, 7 chars 319, 8 chars 605, 9 chars 908,
10 chars 857, and nothing longer. That produces `Drinko Hal`, `Atwell Hal`, `Knowlton A`,
`EnrsnClsrm`, `Heffnr Wet`, `Indpndnce`. Do not display it and do not match on it. Use the GIS
`SchedulingAbbreviation` or `BLDG_NAME` instead.

**Roughly 45% of in-person meeting rows have no facility at all.** 2605 of 5746 sampled rows came
back with `buildingCode`, `facilityDescription`, `facilityId` and `room` all `null` and
`facilityCapacity: 0`, even with `instruction-mode=p` applied. Every subject contributes some. The
harvest has to drop them before it can compute a busy interval.

`facilityType` is a room-class code worth keeping: `1B` 1410 rows, `2A` 676, `1C` 394, `2M` 162,
`2K` 70, `2H` 69, `2P` 64, `PERF` 59, `6F` 55, `1A` 43, plus a long tail including `LAB`, `LCTR`
and `SMNR`. `1x` looks like general classroom and `2x` like laboratory, but that is inference, not
measurement.

---

## 4. What OpenStreetMap actually returned

The blueprint's query works, but its bounding box is too small and its filter is too narrow.

```
POST https://overpass-api.de/api/interpreter
[out:json][timeout:180];
(
  way["building"]["name"](39.980,-83.090,40.090,-82.995);
  relation["building"]["name"](39.980,-83.090,40.090,-82.995);
);
out center tags;
```

Measured: **1186 elements, 1146 ways and 40 relations, 1047 distinct names, every one carrying a
centre**. So pulling relations as well as ways adds 40 elements, and 3 of the 80 buildings Vacant
needs are relations (Knowlton Hall `relation/8663659`, Derby Hall `relation/6618923`, Scott
Laboratory `relation/2075433`), so the relation pull is not optional.

Widening the box past the blueprint's `39.990,-83.040,40.008,-83.008` is also not optional. Two
buildings that appear in the live Autumn 2026 schedule sit outside it: Sherman Studio Art Center at
`-83.0377` and Knowlton Executive Terminal at `40.0752,-83.0751`, which is Don Scott Field, 8 km
north of the Oval. `aviatn` sections meet there.

On endpoints: `overpass-api.de` answered **429 Too Many Requests**, not 504, on the first attempt
and 200 on the immediate retry. Retry logic should key on any non-200 body, not on a specific
status. The `overpass.kumi.systems` mirror was never needed.

### The OSM tags that are not there

Only **129** of the 1186 elements carry `building=university` or `operator=The Ohio State
University`, against roughly 250 real OSU buildings, so filtering to those tags before matching
loses buildings. Of the whole set, 23 carry `wikidata`, 40 carry `short_name`, 44 carry `ref`, and
**none carries an OSU building number**. There is no code-keyed join into OSM. Name matching is the
only route, which is exactly why the GIS layer is better.

### Ohio Stadium is invisible to the blueprint query

`way/119153498` is named "Ohio Stadium" and is tagged `leisure=stadium` with **no `building` tag
at all**. `way["building"]["name"]` will never see it, and it appears in the class schedule
(`music` sections, `ST0161`). A `nwr["name"~"Ohio Stadium"]` query finds it at
`40.0016478,-83.0197398`, 0.7 m from OSU's own coordinate. Any OSM-first design needs a
hand-maintained exception list, which is a maintenance burden the GIS route does not have.

---

## 5. The matcher and its real match rate

I wrote a normaliser (lowercase, comma inversion so `Drinko Hall, John Deaver` becomes
`john deaver drinko hall`, punctuation stripped, `of/and/for/at/in/on` dropped, and about 40
expansion rules covering `laboratories|laboratory|labs -> lab`, `building|bldg|bld -> ""`,
`hall -> ""`, `the -> ""`, `center|centre|cntr -> ctr`, `engineering -> eng`, `research -> rsch`,
`sciences|science -> sci`, `physical -> phys`, `activity -> activ`, `education -> educ`,
`services -> srvs`, `administration -> adm`) then scored exact, token-set, Jaccard and
`difflib.SequenceMatcher` against every `name`, `official_name`, `alt_name`, `short_name`,
`old_name` and `addr:housename` in the OSM pull.

**Result on the 80 buildings observed: 70 matched at >= 0.90 (87.5%), 0 in the 0.72 to 0.90 grey
band, 10 unmatched (12.5%).**

The 10 misses, every one by name:

| code | Class API name | What it really is | Why the matcher missed |
|---|---|---|---|
| `049` | Drinko Hall, John Deaver | Drinko Hall, in OSM | inverted comma form leaves `john deaver drinko` vs `drinko`, Jaccard 0.41 |
| `249` | Fisher Hall, Max M | Fisher Hall, in OSM | same, 0.48 |
| `250` | Gerlach Graduate Programs Bldg | Gerlach Hall, in OSM | OSU's name is a different name, 0.61 |
| `004` | 209 West Eighteenth Avenue | `209 W. 18th Avenue`, in OSM | spelled-out vs numeric ordinal, 0.50 |
| `1019` | Knowlton Airport Terminal | Knowlton Executive Terminal, in OSM | different middle word, 0.60 |
| `1321` | Waterman- Multispecies Animal | Multispecies Animal Learning Center, in OSM | OSU truncates the name mid-phrase, 0.51 |
| `082` | Ohio Stadium | Ohio Stadium, in OSM but with no `building` tag | never in the candidate set |
| `404` | Gerlaugh Hall | Wooster, not Columbus | outside every Columbus bbox |
| `414` | Williams Hall | Wooster, not Columbus | outside every Columbus bbox; nearest name in box was `Sherwin-Williams` |
| `549` | CFAES Wooster Admin Bldg | Wooster, not Columbus | outside every Columbus bbox |

Six of the ten are resolvable by hand and three are not Columbus buildings at all. That is the
honest ceiling for name matching: about 88% automatic, then a permanent hand-maintained exception
file that has to be revisited every time OSU renames a building or OSM retags one.

**A warning about how easy it is to fake a good number.** My first scorer gave 98.8%. It had a
containment bonus, and `AT&T` normalises to the single token `t` after stopword removal, so `AT&T`
scored 0.90 against seven different OSU buildings including Ohio Stadium and the CFAES Wooster
Administration Building. Requiring at least one shared token of 4 or more characters dropped the
score to the true 87.5%. If a matcher reports above about 90% on this data, suspect it.

### OSM against OSU GIS, where both have an opinion

For the 70 strong name matches, distance between the OSM polygon centre and OSU's published point:

| Statistic | Value |
|---|---|
| median | **3.1 m** |
| mean | 5.2 m |
| max | 42.8 m (Hamilton Hall, an L-shaped building where a centroid is ambiguous) |
| under 25 m | 69 of 70 |
| under 50 m | 70 of 70 |

Two entirely independent datasets landing 3 m apart is the strongest evidence available that both
are right. This is the cross-check that sets the `verified` tier.

---

## 6. Alternative sources, and what each actually returned

| Source | Verdict | Measured |
|---|---|---|
| **OSU FOD/FITS GIS, Building layer** | **Use this** | 1347 buildings, 1330 codes, exact join, one request, has campus and address |
| OSM via Overpass | Use as cross-check | 1186 named buildings in the wide box, 87.5% auto-match, no OSU codes, Ohio Stadium untagged |
| Nominatim | Skip | Same OSM data behind a 1 req/sec policy. `Dreese Laboratories, Columbus, Ohio` returns `40.0021646,-83.0158474`. `Celeste Laboratory Of Chem, Columbus, Ohio`, the exact string the class API hands you, returns **zero results**. It cannot take the API's abbreviated names. |
| Wikidata / Wikipedia | Skip | The right entity is **Q309331**, not the `Q504363` you might guess. A SPARQL union over P361 / P127 / P137 / P276 / P1830 with P625 returns **31 items**, of which about 6 are teaching buildings. Coverage of Vacant's 80 is roughly 5%. Accuracy is also uneven: 18th Ave Library 0.8 m off, Dulles Hall 0.9 m, Ohio Stadium 0.7 m, but **Ohio Union 108.3 m off**. |
| OSU campus map SPA | Indirect but decisive | `maps.osu.edu` returns a 6522-byte Experience Builder shell. `config.json` and `env.js` both 404. It is worthless directly and priceless as the pointer to `gissvc.osu.edu`. |
| OSU ArcGIS Hub | Worth a look later | `https://data-OSUGIS.opendata.arcgis.com`. Not fetched here. Likely carries the terms of use for the GIS layer, which is the main open question below. |

One incidental note: the OSU GIS account's public item list includes a WMS entry whose URL embeds a
third-party Nearmap API key in the path. Vacant should not touch it. Basemap imagery is not needed
for this app and using someone's exposed key would be the wrong call regardless.

---

## 7. The draft dataset

Written to `C:/Users/galax/Downloads/Projects/Vacant/data/buildings.draft.json`.

**628 records.** Shape, keyed by `buildingCode` exactly as the class API spells it:

```json
"279": {
 "name": "Dreese Laboratories",
 "short": "DL",
 "lat": 40.002221,
 "lon": -83.01599,
 "source": "osu-gis:FacilitiesStreets_RO/11 + osm-crosscheck",
 "confidence": "verified",
 "campus": "Columbus",
 "km_from_oval": 0.25,
 "address": "2015 Neil Ave",
 "observed_in_schedule": true,
 "api_name": "Dreese Laboratories",
 "api_short": "Dreese Lab",
 "osm_check_m": 7.2
}
```

The six required keys are all present. The extras are cheap and each earns its place:
`km_from_oval` is what actually excludes the far rooms (see below, `campus` does not),
`observed_in_schedule` separates measured from speculative,
`api_name`/`api_short` are what the class API will actually hand the app at runtime, and
`osm_check_m` is the audit trail for the confidence tier. A `_meta` key at the top of the file
records provenance and the join rule.

Contents:

| Confidence | Records | Meaning |
|---|---|---|
| `verified` | 69 | seen in live schedule data **and** an independent OSM building of the same name within 25 m |
| `high` | 11 | seen in live schedule data, coordinate from OSU GIS alone |
| `unconfirmed` | 548 | in OSU GIS for Columbus or Medical Center, never seen in the 36-subject sample, included so a full harvest cannot miss |

By campus: Columbus 498, Medical Center 127, Wooster 3.

The 11 `high` rows are `004`, `038`, `049`, `082`, `249`, `250`, `404`, `414`, `549`, `1019`,
`1321`. Every one of them is a miss from section 5 and I checked each by hand against its GIS
address. None is wrong. They are `high` rather than `verified` only because the automatic OSM
confirmation did not fire.

### Nothing is unmatched, but three rows must not be used

Every observed building code resolved. What needs a human is not a missing coordinate, it is a
policy call:

| code | Name | Coordinate | Why a human has to decide |
|---|---|---|---|
| `404` | Gerlaugh Hall | 40.782959, -81.927953 | **Wooster campus, 126.6 km from the Oval** |
| `414` | Williams Hall | 40.781498, -81.927686 | **Wooster campus, 126.5 km** |
| `549` | CFAES Wooster Administration Building | 40.779872, -81.930234 | **Wooster campus, 126.2 km** |
| `ONLINE` | pseudo-building, 14 rows | none | has no room, exclude from the index |
| `OFFCAMPUS` | pseudo-building, 10 rows | none | has no room, exclude from the index |
| `1072` | St. Stephen's Episcopal Church | none in GIS | only geolocation gap in the whole layer; never seen in the schedule sample |

**`campus=col` in the class API does not mean Columbus.** Three Wooster buildings came back under
it from `hcs` and `animsci`. A nearest-room search that does not filter will happily tell a student
in Dreese that a room 126 km away is available.

**And the GIS `Campus` field will not save you either, because it is administrative rather than
geographic.** Measured on the draft: **85 of its 628 records sit more than 10 km from the Oval**,
and only 3 of those are tagged Wooster. The other 82 are tagged `Columbus` (39) or `Medical Center`
(43) and include OSU Health System clinics in Marysville, Newark and Portsmouth, a transplant
centre 124 km out, an address on E Galbraith Rd 146 km out, and radio transmitters. Filtering on
`Campus in {Columbus, Medical Center}` leaves every one of them in.

The rule that actually works is a distance cap. Distribution of the 625 Columbus and Medical Center
records by great-circle distance from the Oval:

| Cutoff | Records inside |
|---|---|
| 2.0 km | 334 |
| 2.5 km | 394 |
| 3.0 km | 438 |
| 5.0 km | 463 |
| 10.0 km | 543 |
| no cap | 625 |

A 3 km cap covers 77 of the 80 observed buildings and is the sane default. The draft carries a
`km_from_oval` field on every record so the build can apply whatever cap it likes. Note the one
honest outlier: `1019` Knowlton Executive Terminal at 9.79 km is Don Scott Field, and `aviatn`
sections really do meet there, so a hard cap does drop a real room. Either special-case it or make
the cap a user-visible "how far will you walk" setting, which the app arguably wants anyway.

### Payload size

| Variant | Raw | Gzipped |
|---|---|---|
| Full draft, indented, all extra fields | 205,548 B | 22,600 B |
| All 628, minified, name/short/lat/lon only | 54,247 B | 13,417 B |
| The 80 observed only, minified | 6,514 B | 1,970 B |

13 KB gzipped for the whole walkable campus is nothing for an offline-first PWA. Ship the
minified 628 and stop worrying about it. The production build should still intersect the GIS layer
with the harvested building codes, because half those 548 unconfirmed records are bus shelters,
parking garages and refuse vehicle storage.

---

## 8. Sanity checks against reality

| Building | Draft coordinate | Address in GIS | Verdict |
|---|---|---|---|
| Dreese Laboratories (`279`) | 40.002221, -83.015990 | 2015 Neil Ave | **Correct, and the brief's anchor is wrong.** See below. |
| Ohio Union (`161`) | 39.997660, -83.008642 | 1739 N High St | Correct. High St runs at about -83.0086 here. OSM agrees to 1.1 m. |
| Ohio Stadium (`082`) | 40.001670, -83.019729 | 411 Woody Hayes Dr | Correct. West of the campus core toward the Olentangy. OSM 0.7 m, Wikidata 0.7 m. |

The brief says Dreese Laboratories is "on the west side of College Rd near 19th". It is not. Three
independent sources put it on **Neil Avenue**:

- OSU GIS `Address` field: `2015 Neil Ave`
- OSM `way/300842706` `addr:housenumber=2015`, `addr:street=Neil Avenue`
- Nominatim reverse display name: `Dreese Laboratories, 2015, Neil Avenue, University District ...`

Its neighbours corroborate: Caldwell Laboratory is 2024 Neil Avenue and Baker Systems is 1971 Neil
Avenue, both within 100 m. College Road is roughly -83.0125, about 300 m east, and the buildings
there are Denney Hall (164 Annie & John Glenn Ave) and the Journalism Building (242 W 18th Ave).
The longitude every source reports for Dreese, -83.0160, is Neil Avenue. **If you were using the
brief's anchor as your regression test, it would have failed a correct dataset.**

No coordinate in the draft is obviously wrong. 77 of the 80 observed buildings sit within 2.62 km
of the Oval. The one legitimate far outlier is `1019` Knowlton Executive Terminal at 9.79 km, which
is Don Scott Field and is genuinely where `aviatn` meets. The other three are the Wooster buildings
at about 126.5 km.

---

## 9. Licensing and attribution

**If any coordinate that ships came from OpenStreetMap, ODbL 1.0 attribution is mandatory.**

The exact string:

```
© OpenStreetMap contributors
```

linking to `https://www.openstreetmap.org/copyright`, plus a statement that the data is available
under the Open Database License, `https://opendatacommons.org/licenses/odbl/1-0/`.

Where it goes. ODbL requires the notice be "reasonably calculated to make any Person that uses,
views, accesses, interacts with, or is otherwise exposed to the Derived Database aware" of the
source. Vacant has no map view, so a basemap corner credit does not apply. Put it in three places:

1. In the app's About or Info panel, visible without leaving the app. One line: `Building
   locations © OpenStreetMap contributors, ODbL.`
2. In a `_meta` block inside the shipped `buildings.json` itself, so the obligation travels with
   the file if anyone copies it.
3. In the repo `README.md` under a Data sources heading.

If a map view is ever added, the credit must also be visible in the map corner in the standard way.

**The good news is that you may not owe it.** The draft dataset's coordinates all come from OSU's
own GIS layer. OSM is used only to compute the `osm_check_m` audit number. If the shipped file
carries no OSM-derived coordinate and no OSM-derived name, ODbL does not attach. Two caveats before
relying on that: `osm_check_m` is arguably a derived measurement, so either strip it from the
shipped build or keep the credit; and attributing OSM anyway costs one line and is the decent thing
to do given how much the cross-check was worth here.

The OSU GIS layer's own terms are the real open question. It is public, unauthenticated, CORS-
reachable and published by the university's own Facilities Information and Technology Services
under an ArcGIS Hub open-data site, all of which reads as intended for public use. But I did not
find a licence statement on the service itself. **Check `https://data-OSUGIS.opendata.arcgis.com`
for a terms of use page before shipping, and credit `Ohio State University Facilities Information
and Technology Services` regardless.**

---

## 10. Things that surprised me

1. **OSU publishes a better dataset than OSM and it joins on a primary key.** The entire fuzzy
   matching plan in the blueprint is unnecessary. The whole geocoding problem is one HTTP request
   plus a dictionary lookup.
2. **`buildingDescription` is a room label, not a building name.** 3131 of 5746 sampled rows prove
   it. Anyone reading the field name and trusting it will build a broken index.
3. **`facilityDescriptionShort` is hard-truncated at 10 characters.** `Drinko Hal`. It is unusable
   for display and for matching, and nothing in the API says so.
4. **`campus=col` returns buildings in Wooster, 126 km away.** Three of them, in this small sample.
   And the GIS `Campus` field does not fix it: 82 records tagged `Columbus` or `Medical Center` are
   more than 10 km from the Oval. Filter on distance, not on a campus label. I got this wrong on my
   first pass and only caught it by measuring.
5. **Ohio Stadium has no `building` tag in OSM**, so the blueprint's Overpass query silently
   returns 79 of 80 rather than erroring.
6. **A containment bonus in a name matcher will happily match `AT&T` to `Ohio Stadium`** and report
   98.8% accuracy. The real number was 87.5%.
7. **45% of `instruction-mode=p` meeting rows have no room at all.** The filter narrows the result
   but does not guarantee a facility.
8. **`overpass-api.de` returns 429, not 504, under load.** Retry on any non-200.
9. **`returnCentroid=true` silently returns nothing on an ArcGIS MapServer layer**, and the
   `Latitude` / `Longitude` attributes are strings.
10. **The building list is nowhere near saturated at 36 subjects.** The rarefaction curve is still
    linear. Do not treat any subject sample as the building list.

---

## 11. Open questions

- What licence covers `gissvc.osu.edu`? Check the ArcGIS Hub site for terms before shipping.
- How stable is `buildingNumber` across terms and across a GIS re-publish? The three records I
  sampled with `outFields=*` all shared one `last_edited_date` (epoch 1787724962000) and one
  `created_user`, which hints at a bulk load rather than incremental edits, but I did not request
  that field on the full pull so this is a hint and not a measurement. If OSU renumbers, the join
  breaks silently. The weekly build should assert that every harvested `buildingCode` still
  resolves, and fail loudly if one does not.
- Is the OSU point the entrance or the centroid? It matters for walking time. The 3.1 m median
  agreement with OSM polygon centres says centroid. Big buildings like Scott Laboratory and Ohio
  Stadium will need an entrance override before walking estimates feel honest.
- Does `facilityType` reliably separate a general-purpose classroom from a wet lab, a performance
  hall and a greenhouse? Vacant should not send anyone to Howlett Greenhouses. That question
  belongs to the facility-types research, not here.
- The full harvest will add building codes this sample never saw. Confirm the GIS layer covers all
  of them once the harvest exists. Coverage is 80/80 so far, and the layer holds 1330 codes, so the
  risk is low but not zero.

---

## 12. Reproducing this

Scratch scripts and raw captures live in
`C:/Users/galax/AppData/Local/Temp/claude/C--Users-galax-Downloads-Projects/ff09d3ae-8ad6-40bb-942d-f7cf03ac4117/scratchpad/geo/`:

| File | What it is |
|---|---|
| `hx.py` | request wrapper with a global request counter, retries and pauses |
| `sweep.py` | the 36-subject class API sweep, resumable via `sweep_raw.json` |
| `overpass.py` | Overpass runner with endpoint failover to the kumi mirror |
| `match.py` | the normaliser, scorer and match report |
| `build.py` | writes `data/buildings.draft.json` |
| `osu_buildings_raw.json` | the full 1347-feature GIS pull |
| `osm_wide.json`, `osm_extra.json` | the 1186-element Overpass pull, plus Ohio Stadium and Wooster |
| `meetings.json` | 5746 flattened meeting rows from the sample |

On this box run Python as `python -X utf8 script.py` or it dies on the unicode in building names.
Do not name a helper module `http.py`; it shadows the stdlib package and breaks `requests`.
