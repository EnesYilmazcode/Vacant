# Geocoding OSU buildings for Vacant

Research note, 2026-08-26. Everything below was measured against live services, not reasoned about.

> **Read Part II first if you are implementing this.** A second agent re-verified everything below
> on the same day against a wider sample. The primary finding holds and gets stronger, but six numbers
> here are wrong and the 3 km distance cap recommended in section 7 deletes two buildings that host
> real classes. Part II starts at "Part II: independent verification pass".

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

---
---

# Part II: independent verification pass

Second geocoding agent, same day, 9 HTTP requests. I did not take Part I on trust. I re-fetched the
GIS layer, re-derived the join against a **different** sample of buildings, wrote my own matcher
from scratch, and checked the coordinates against a third source. Part I holds up. Six numbers in
it need correcting and one recommendation in it will send students to the wrong place.

**Problem:** Part I proves the join on the 80 buildings that one subject sample happened to contain,
and nothing proves the sample is the campus. **Fix:** the harvest agent's independent sample
contributes 8 more building codes, the union is 88, and all 88 still join on the first try.

My 9 requests: 1 GIS query for the 88 codes, 1 GIS query with geometry, 1 GIS service metadata,
1 CORS probe, 1 ArcGIS Online item search, 1 fetch of the OSU GIS Hub page, 3 Nominatim reverse
lookups. No new class API traffic. The Overpass captures in the scratchpad were reused rather than
re-pulled.

## 1. The join, verified against a second sample

Part I observed 80 building codes across 36 subjects, page 1 each. The harvest-feasibility agent
independently sampled by `catalog-number` bucket and observed 77 real codes. Those two sets are not
the same set. The union is **88 codes**, and 8 of them Part I never saw:

| code | Class API name | GIS name | km from Oval |
|---|---|---|---|
| `007` | Mathematics Tower | Mathematics Tower | 0.11 |
| `057` | Edison Joining Technology Cntr | Edison Joining Technology Center | 2.55 |
| `085` | Frank W. Hale Jr Hall | Hale Hall | 0.44 |
| `265` | Engineering Research and Educa | Engineering Research and Education Laboratories | 0.38 |
| `298` | Agricultural Engineering Bldg | Agricultural Engineering Building | 1.08 |
| `309` | Pressey Hall | Pressey Hall | 2.07 |
| `386` | Wexner Center For The Arts | Wexner Center for the Arts | 0.39 |
| `837` | Outpatient Care East | Outpatient Care East | 4.98 |

**All 88 of 88 resolve out of the committed draft, and all 88 come back from a live GIS query.**
That is the single most important number in this document, because it is now measured on two samples
drawn by two different methods rather than one.

```bash
curl -s -G "https://gissvc.osu.edu/arcgis/rest/services/Data/FacilitiesStreets_RO/MapServer/11/query" \
  --data-urlencode "where@where88.txt" \
  --data-urlencode "outFields=buildingNumber,BLDG_NUM,BLDG_NAME,SchedulingAbbreviation,Latitude,Longitude,Campus,Address,Status,InstType,FloorCount" \
  --data-urlencode "returnGeometry=false" --data-urlencode "outSR=4326" --data-urlencode "f=json"
# HTTP 200, 26036 bytes, 0.36 s, 89 features, exceededTransferLimit absent
# 88 distinct buildingNumber, 0 missing, 0 rows with a null Latitude, Status = Active on all 88
```

The re-fetch also confirms the committed file is not stale. Great-circle distance between every live
coordinate and the coordinate sitting in `data/buildings.draft.json` is **at most 0.068 m**, which is
just the rounding to six decimal places. The draft is a faithful copy of what the service returns
today.

One more thing that cuts against a worry Part I raised: the harvest agent's building-name strings
agree with the GIS names on all 8 new codes, so `buildingCode` really is a stable key rather than a
label that drifts between samples.

## 2. Six corrections to Part I

| Part I says | Measured | Impact |
|---|---|---|
| "1330 distinct `buildingNumber` values" | **1331**. 1347 features, 13 with a null or empty `buildingNumber`, 3 surplus rows from duplicate codes, so 1347 - 13 - 3 = 1331 | cosmetic |
| "`buildingNumber` is the join key", implying unique | **It is not unique.** `246` appears twice and `1243` three times | a build that asserts uniqueness fails, one that appends double-counts |
| "80 of 80 matched" | 88 of 88, on a wider sample | strengthens the claim |
| "Exactly one record has a `buildingNumber` and no coordinate" | True, `1072`. But **14 features total have no coordinate**, the other 13 also have no `buildingNumber` | breaks a naive `float(a["Latitude"])` loop over the raw pull |
| "A 3 km cap is the sane default" | **A 3 km cap drops two real scheduled buildings.** See below | students sent nowhere |
| "the OSU point says centroid", offered as a hint | **Now measured.** It is a centroid. See section 5 | bounds the walk-time error |

### The duplicate key, concretely

```
buildingNumber 246  -> 2 features, identical attributes, RPAC
buildingNumber 1243 -> 3 features, identical attributes, "Bus Shelter 403 - Carmack 2"
```

Both duplicate sets carry identical coordinates, so `index[code] = row` in a loop is harmless, and
that is exactly why it is dangerous. It works silently, and then a `len(features) == len(index)`
assertion in the guard script fails for a reason nobody can reproduce. Dedupe on `buildingNumber`
explicitly and move on.

### The distance cap is wrong

Part I recommends a 3 km cap because it covers 77 of the 80 buildings it saw. On the 88-building
union:

| Cutoff | Observed buildings kept |
|---|---|
| 2.0 km | 78 of 88 |
| 2.5 km | 81 of 88 |
| **3.0 km** | **83 of 88** |
| 5.0 km | 84 of 88 |
| **10.0 km** | **85 of 88** |
| no cap | 88 of 88 |

A 3 km cap silently deletes `837` Outpatient Care East at 4.98 km and `1019` Knowlton Executive
Terminal at 9.79 km. Both host real Autumn 2026 classes. Everything past 10 km is the three Wooster
buildings at 126 km.

**A 10 km cap drops exactly the three Wooster buildings and nothing else.** That is not a coincidence
of this sample, it is the shape of the campus. There is a 116 km gap in the distance distribution
between Don Scott Field and Wooster, so 10 km is a stable choice rather than a tuned one. Use it as
the data filter, and let "how far will you walk" be a separate user-facing setting on top, defaulted
to something like 1.5 km. Never bake the walking preference into the shipped dataset.

## 3. Neither Campus nor InstType is a usable filter

Part I already showed `Campus` is administrative rather than geographic. `InstType` is worse than it
looks, and it is the field a reader would reach for next. Breakdown of the 548 `unconfirmed` draft
rows:

```
154 (blank)   140 Academic   53 Student Life   35 Athletics   19 OSUHS - UH   18 Airport
 15 CampusParc  15 OSUP  14 OSUHS - EAST  12 OSUHS - SHARED  10 On-Site  10 OSUHS - AMBULATORY ...
```

`InstType = "Academic"` includes **Refuse Vehicle Storage**. It also includes Biological Sciences
Greenhouses and the Ornamental Plant Germplasm Center. 150 of the 548 unconfirmed rows, 27 percent,
have a name matching an obvious non-classroom keyword: parking garage, bus shelter, electrical
substation, corrosive storage, chiller, transmitter.

**The only filter that works is the harvest itself.** Intersect the GIS layer with the building codes
the class harvest actually produced. Every other filter is a heuristic that either keeps refuse
storage or drops an airport terminal where aviation classes meet. Ship the 88, or whatever the full
harvest yields, not the 628.

The 628 in the draft are still the right thing to have committed. They are the lookup table the
harvest joins against, and at 13 KB gzipped minified there is no cost to keeping them. They are just
not the shipped index.

## 4. My own matcher, written independently

Part I reports 87.5 percent on 80 buildings. I wrote a separate normaliser and scorer without reading
its code first, and ran it on the 88-building union against the same cached Overpass captures,
1259 candidates carrying a name and a centre from `osm_wide.json` plus `osm_extra.json`.

Script: `scratchpad/geo/mymatch.py`. The normaliser does comma inversion, `&` to `and`, punctuation
strip, about 30 expansion rules, ordinal word to digit, stopword removal. The scorer takes
`max(Jaccard, 0.5*coverage + 0.5*SequenceMatcher)` with Part I's anti-fake guard of requiring at
least one shared token of 4 or more characters.

```
MATCH RATE on 88 observed buildings: strong (>= 0.90) 74 = 84.1% | grey band 9 | miss 5 = 5.7%
strong matches whose OSM centre is more than 100 m from the OSU GIS point: 0
agreement on the 74 strong matches: median 3.3 m, mean 5.6 m, max 42.8 m
   within  5 m: 46/74      within 10 m: 61/74
   within 25 m: 73/74      within 50 m: 74/74
```

Two independently written matchers, on overlapping but different building sets, land at 87.5 and
84.1 percent. **Treat mid-80s as the real ceiling for name matching against OSM and stop tuning.**
The median 3.3 m agreement reproduces Part I's 3.1 m almost exactly, which is the number that
actually matters here: two unrelated survey efforts put these buildings in the same place.

### The grey band is where the danger is

| code | Class API name | Best OSM name | Score | Distance to the OSU point |
|---|---|---|---|---|
| `007` | Mathematics Tower | Mathematics Building | 0.893 | 27.4 m |
| `049` | Drinko Hall, John Deaver | Drinko Hall | 0.750 | 15.1 m |
| `222` | Heffner Wetland Rsch & Educ | Heffner Wetland Building | 0.875 | 0.8 m |
| `248` | Chem & Biomolecular Eng & Chem | Chemical and Biomolecular Engineering | 0.760 | 5.8 m |
| `249` | Fisher Hall, Max M | Fisher Hall | 0.833 | 4.0 m |
| `265` | Engineering Research and Educa | Engineering Research and Education | 0.785 | 13.2 m |
| `297` | Howlett Greenhouses | Howlett Hall | 0.769 | **73.2 m, wrong structure** |
| `371` | Celeste Laboratory Of Chem | Celeste Laboratory of Chemistry | 0.766 | 2.9 m |
| `1019` | Knowlton Airport Terminal | Knowlton Hall | 0.742 | **9385.3 m, wrong building** |

Seven of those nine are correct and a human would wave them through. The other two are the reason an
OSM-first design is a bad idea:

- **`1019` Knowlton Airport Terminal scores 0.742 against Knowlton Hall.** Accepting it puts Don
  Scott Field, 9.4 km north, on the Oval. An `aviatn` student told to walk 4 minutes would be
  looking at the wrong building in the wrong township.
- **`297` Howlett Greenhouses scores 0.769 against Howlett Hall**, 73 m away and a different
  structure. Vacant should not send anyone into a greenhouse in the first place, but this is how it
  would happen.

There is no threshold that separates those two from the seven good ones. `Fisher Hall, Max M` at
0.833 is right and `Mathematics Tower` at 0.893 is right, both scoring above something dangerous and
below something else dangerous. The grey band cannot be automated, and that is a permanent property
of name matching rather than a bug in my scorer.

### The 5 misses, every one by name

| code | Class API name | GIS name | Best OSM guess | Score |
|---|---|---|---|---|
| `250` | Gerlach Graduate Programs Bldg | Gerlach Hall | Gerlach Hall | 0.719 |
| `085` | Frank W. Hale Jr Hall | Hale Hall | Hale Hall | 0.711 |
| `1321` | Waterman- Multispecies Animal | Waterman - Multispecies Animal Learning Complex | Multispecies Animal Learning Center | 0.650 |
| `837` | Outpatient Care East | Outpatient Care East | Martha Morehouse Outpatient Care | 0.639 |
| `057` | Edison Joining Technology Cntr | Edison Joining Technology Center | Parker Food Science and Technology | 0.311 |

All five have a correct coordinate in the draft, from the GIS layer. `837` is the nastiest of the
five. The best OSM name it found, "Martha Morehouse Outpatient Care", is a **different real OSU
outpatient building**, so a name-matching pipeline with a lower threshold would confidently place it
in the wrong place rather than admitting it does not know.

`404`, `414` and `549`, the three Wooster buildings Part I lists as unmatchable, matched at 1.000
here, at 8.6 m, 14.0 m and 1.0 m. The difference is that my candidate pool included `osm_extra.json`,
Part I's own fixup pull. Both statements are true. Wooster buildings are absent from any Columbus
bounding box and present in OSM once you look at Wooster. Same for Ohio Stadium, which scored 1.000
at 2.6 m against `way/119153498` once the untagged element is in the pool.

## 5. The published point is a centroid, and here is the walk-time error it costs

Open question from Part I: is the OSU coordinate an entrance or a centroid? It is a centroid.
Measured by pulling the polygon geometry and comparing the published `Latitude`/`Longitude` to a
shoelace centroid of the largest ring:

| code | Building | Centroid to published point | Footprint | Published point inside the polygon |
|---|---|---|---|---|
| `017` | Knowlton Hall | 1.7 m | 145 x 61 m | yes |
| `246` | RPAC | 1.7 m | 113 x 139 m | yes |
| `065` | Smith Laboratory | 3.4 m | 54 x 97 m | yes |
| `148` | Scott Laboratory | 4.1 m | 87 x 98 m | yes |
| `280` | Baker Systems Engineering | 8.1 m | 35 x 71 m | yes |
| `279` | Dreese Laboratories | 9.0 m | 90 x 97 m | yes |
| `082` | Ohio Stadium | 26.5 m | 210 x 281 m | **no**, 35 rings |
| `038` | Hamilton Hall | 27.3 m | 141 x 97 m | yes |

7 of 8 published points fall inside their own footprint. The two outliers, Ohio Stadium and Hamilton
Hall, are exactly the two shapes where a centroid is meaningless: a 35-ring donut and an L.

**What this costs the app.** At 80 m per minute, the centroid-versus-door error is bounded by half
the building's longest dimension:

- a typical classroom building at 90 x 100 m: up to 50 m, about **38 seconds**
- Knowlton at 145 m long: up to 73 m, about **55 seconds**
- Ohio Stadium at 281 m: up to 140 m, about **1 minute 45 seconds**

For a "4 min walk" label that is fine. For the `usable = gapEnd - now - walkTime` arithmetic that is
the whole product, it is a systematic **under**estimate, because you always walk past the centroid to
reach a door and then walk inside to the room. Round walk time up, and consider a flat 1 minute
door-to-room constant. Do not chase per-building entrance overrides until somebody complains.

There is **no entrance or door layer** to chase even if you wanted one. The full service is:

```
 1 StreetFurniture   5 SiteAmenityLine   7 PavementMarkingLine   8 RightofWay
 9 LandscapeArea    10 Parking          11 Building            12 StreetPavement   13 WaterBody
```

No pedestrian network either, so if straight-line distance ever needs to become real walking
distance, that comes from OSM footways, not from OSU.

## 6. Three coordinates checked against a third source

Part I checked the draft against OSM by name. I checked it by reverse geocoding the draft's own
coordinate through Nominatim, which asks a different question: what is actually at this point on the
ground.

| code | Draft coordinate | Nominatim reverse says | Verdict |
|---|---|---|---|
| `279` | 40.002221, -83.015990 | `Dreese Laboratories, 2015, Neil Avenue, University District, Columbus, OH 43210` | correct |
| `161` | 39.997660, -83.008642 | `Sloopy's Diner, 1739, North High Street, Columbus, OH 43201` | correct, Sloopy's is inside the Ohio Union at 1739 N High St |
| `082` | 40.001670, -83.019729 | `Safelite Field, Cannon Dr, University District, Columbus, OH 43210` | correct, Safelite Field is the playing surface inside Ohio Stadium |

All three land on or inside the right structure. Two of the three return the name of a **tenant**
rather than the building, which matters if anyone ever plans to reverse geocode as a verification
step: a correct coordinate can return a name that does not look like a match at all.

**The brief's Dreese anchor is wrong, and Part I is right to say so.** The brief says Dreese
Laboratories is "on the west side of College Rd near 19th". Nominatim, independently of the OSU GIS
`Address` field and independently of the OSM name match, puts the point at 2015 Neil Avenue. Three
sources, one answer. A regression test written from the brief would fail against correct data.

## 7. The licence question, answered

Part I leaves this open. It is now closed enough to act on.

The OSU GIS Hub item (`361279ecd67a422fba0ec357ca1c0f4c`, `https://data-OSUGIS.opendata.arcgis.com`)
carries this `licenseInfo`, verbatim:

> For use by anyone interested in OSU data. This data is hosted by Facilities Information and
> Technology Services (FITS) at The Ohio State University. Requests and Questions can be sent to
> gismaps@osu.edu

The site's own footer card reads `Copyright 2025. OSU GIS`. The hub's "Terms of Service" navigation
link is `href="#"`, a placeholder that goes nowhere, so there is no formal terms page to read.

That is an explicit grant of public use with an asserted copyright and a named contact, not an open
licence. What to do:

1. **Credit it.** `Building locations (c) 2025 The Ohio State University, Facilities Information and Technology Services.`
2. **Email `gismaps@osu.edu`** before the app goes public. One paragraph saying what Vacant is, that
   it caches the Building layer weekly at build time rather than hitting the service at runtime, and
   asking whether they want anything specific in the credit. FITS publishes this so people use it,
   and the request costs nothing.
3. Note that `FacilitiesStreets_RO` is **not** one of the 13 items the OSU GIS account publishes to
   ArcGIS Online. It lives on `gissvc.osu.edu` directly. The Hub licence statement is the closest
   applicable statement, not a statement about this exact layer, which is another reason to send the
   email.

### The OSM attribution string, unchanged

If any shipped coordinate or name comes from OpenStreetMap, ODbL 1.0 requires this exact credit:

```
(c) OpenStreetMap contributors
```

rendered with a real copyright symbol, linked to `https://www.openstreetmap.org/copyright`, plus a
note that the data is available under the Open Database License at
`https://opendatacommons.org/licenses/odbl/1-0/`.

Vacant has no map view, so there is no basemap corner to put it in. Three places:

1. The About or Info panel in the app: `Building locations (c) OpenStreetMap contributors, ODbL.`
2. A `_meta` block inside the shipped `buildings.json`, so the obligation travels with the file.
3. The repo `README.md` under a Data sources heading.

**Ship both credits regardless of which source won.** The current draft takes every coordinate from
OSU GIS and uses OSM only to compute the `osm_check_m` audit field, which is arguably a derived
measurement and arguably not. Two lines of text is not worth the argument.

## 8. CORS is open, which changes one architectural option

```
$ curl -D - -H "Origin: https://enesyilmazcode.github.io" ".../MapServer/11/query?..."
HTTP/1.1 200 OK
Vary: Origin
Access-Control-Allow-Origin: https://enesyilmazcode.github.io
Access-Control-Allow-Credentials: true
Server: Microsoft-IIS/10.0
```

The service reflects any origin. A GitHub Pages page can query it directly from the browser with no
proxy and no key. That does **not** change the plan. The whole point of Vacant is answering offline
from a cached file, and a runtime dependency on someone else's ArcGIS server is the opposite of that.
What it does change is that the weekly build can run anywhere, including a browser-based one-off, and
that a future "report a wrong coordinate" tool has an easy path.

Do not send credentials. The service sets an `AGS_ROLES` cookie with a 60 second `Max-Age` on every
response and there is no reason to carry it.

## 9. What surprised me, on top of Part I's list

1. **The join key is not unique.** `246` and `1243` each appear more than once in a layer whose whole
   value is being a lookup table. The rows are identical, which is worse than if they differed.
2. **`InstType = "Academic"` includes "Refuse Vehicle Storage".** There is no attribute filter that
   yields "buildings with classrooms". The harvest is the filter.
3. **The recommended 3 km cap deletes two buildings that host real classes.** 10 km is the number
   that separates campus from Wooster, with a 116 km empty gap on either side of it.
4. **Name matching's worst failure is confident and wrong, not uncertain.** Knowlton Airport Terminal
   to Knowlton Hall at 0.742 is a 9.4 km error sitting inside the grey band a human is most likely to
   approve in bulk. Outpatient Care East to Martha Morehouse Outpatient Care is the same failure at
   0.639.
5. **Reverse geocoding a correct coordinate can return a tenant, not a building.** The Ohio Union
   reverse-geocodes to "Sloopy's Diner" and Ohio Stadium to "Safelite Field". Both are right. A
   verification script comparing reverse-geocoded names to API names would flag both as failures.
6. **Two independent samples of the class schedule agree the campus is about 88 buildings**, matching
   the harvest agent's Chao1 estimate of 88 exactly. The building list may be closer to saturated
   than Part I's still-climbing rarefaction curve suggests, though the two samples share a subject
   bias, so treat that as encouraging rather than settled.
7. **The GIS point sits outside its own building for Ohio Stadium.** 35 rings. Any code doing a
   point-in-polygon check as a sanity gate will fail on a correct row.

## 10. Standing recommendation

Nothing in the draft dataset needs to change. It is correct, it is current to within 7 centimetres of
what the service returns today, and the join rate is now 88 of 88 across two independent samples. The
changes belong in the build script that consumes it:

```
dedupe on buildingNumber                     -> 246 and 1243 are duplicated
drop km_from_oval > 10                       -> removes exactly the 3 Wooster buildings
intersect with harvested building codes      -> the only filter that works
do not filter on Campus or InstType          -> both keep refuse storage and drop real classrooms
round walk time up, add a door-to-room const -> the point is a centroid, error up to 1m45s
assert every harvested code resolves         -> fail the build loudly if the join ever breaks
credit OSU FITS and OpenStreetMap both       -> two lines, no argument
```

## 11. Reproducing Part II

New scratch files, alongside Part I's, in
`C:/Users/galax/AppData/Local/Temp/claude/C--Users-galax-Downloads-Projects/ff09d3ae-8ad6-40bb-942d-f7cf03ac4117/scratchpad/geo/`:

| File | What it is |
|---|---|
| `mymatch.py` | the independently written normaliser, scorer and match report |
| `mymatch_out.json` | per-building match result, 88 rows |
| `union88.json` | the 88 observed building codes, union of both agents' samples |
| `where88.txt` | the ArcGIS `where` clause for those 88 |
| `gis88.json` | the live re-fetch, 89 features |
| `geom5.json` | 8 buildings with polygon geometry, for the centroid test |
| `fac_layers.json` | the full FacilitiesStreets service layer list |
| `items.json`, `hub.html` | the ArcGIS Online item search and the GIS Hub page, for the licence |

The building-code union comes from `scratchpad/hf/rooms-union.json` and `rooms-sample.json`, which
the harvest-feasibility agent produced. If you rerun this after a real full harvest, replace
`union88.json` with the harvest's actual building list and expect the join rate to stay at 100
percent. If it does not, the GIS layer was republished, and the assertion in the build script is the
thing that should have told you.
