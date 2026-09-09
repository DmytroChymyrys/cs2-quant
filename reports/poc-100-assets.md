# cs2-quant — proposed 100-asset POC universe

Generated 2026-09-09T17:19:54.285Z. **VALIDATED_PROPOSAL_NOT_SEEDED**. Exactly 100 individually selected names; no database writes or tracking changes are performed by this report. Current tracked universe remains the five approved smoke assets.

## Selection and identity rules

Selection is deliberately stratified by observed sales activity, listing supply, price, wear and item family. It is not random and is not an investable or market-representative portfolio. Rare singleton listings and zero-sales periods are intentional stress cases. All five smoke assets are retained. Prices below are USD from one fresh Items response; sales volumes are source aggregates from one fresh History response.

Only names resolving to exactly one null/absent-version row in each endpoint are eligible. Named versions are excluded even if their market_hash_name matches an eligible unversioned row. No arbitrary duplicate winner or variant aggregation is used. StatTrak/Souvenir prefixes, wear, Fade and Crimson Web may form part of a real market_hash_name; they are not permission to ingest a non-null source version.

The full snapshots still contain duplicate market_hash_name groups (Items 78, History 279). Observed duplicate (market_hash_name, version) groups: Items 0, History 0. This retains the earlier finding: the full market needs variant-aware identity, while zero composite collisions in these snapshots do not guarantee a durable key. The proposed subset has one canonical unversioned row per asset.

## Activity and price labels

Low/medium/high liquidity below means a **descriptive seven-day sales-activity proxy**, not an execution guarantee, derived score or valuation. Thresholds differ by category because knife/glove turnover is lower than case turnover. Listing quantity is reported independently; large supply does not imply sales liquidity. Cheap/mid/expensive is likewise relative to category.

| Category | Low activity (7d) | Medium activity (7d) | High activity (7d) | Cheap min price | Mid price | Expensive |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| cases | <50 | 50–499 | >=500 | <$2 | $2–<$15 | >=$15 |
| capsules/stickers | <5 | 5–49 | >=50 | <$1 | $1–<$100 | >=$100 |
| weapons | <5 | 5–49 | >=50 | <$5 | $5–<$100 | >=$100 |
| knives | <5 | 5–19 | >=20 | <$100 | $100–<$500 | >=$500 |
| gloves | <5 | 5–29 | >=30 | <$100 | $100–<$500 | >=$500 |

## Distribution

| Category | Assets | Min-price range (USD) | Median-price range (USD) | Listing quantity range | 24h volume range | 7d volume range | Low / medium / high activity | Cheap / mid / expensive |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| cases | 20 | 0.20–114.76 | 0.52–205.62 | 244–93,632 | 0–671 | 2–3,182 | 6 / 4 / 10 | 7 / 9 / 4 |
| capsules/stickers | 20 | 0.02–82430.91 | 0.02–82430.91 | 1–17,879 | 0–24 | 0–284 | 8 / 6 / 6 | 8 / 7 / 5 |
| weapons | 30 | 0.02–16797.19 | 0.04–16932.63 | 1–7,865 | 0–20 | 0–186 | 10 / 10 / 10 | 9 / 10 / 11 |
| knives | 15 | 37.69–18399.82 | 46.98–18399.82 | 1–82 | 0–5 | 0–40 | 4 / 5 / 6 | 5 / 6 / 4 |
| gloves | 15 | 31.90–28773.74 | 36.83–28773.74 | 2–156 | 0–8 | 0–53 | 5 / 5 / 5 | 7 / 4 / 4 |

Overall activity: {"high":37,"low":33,"medium":30}.

Absolute min-price bins: {"$100–<1,000":21,"$10–<100":29,"$1–<10":18,"< $1":18,">= $1,000":14}.

Listing-quantity bins: {"1,001–10,000":18,"101–1,000":24,"1–5":14,"26–100":20,"6–25":11,">10,000":13}.

24h sales-volume bins: {"0":36,"1–4":30,"20–99":9,"5–19":17,">=100":8}.

Edge coverage: 36 assets with zero 24h sales; 10 with zero 7d sales; 36 with at least one null 24h price statistic. 0 zero-listing assets and 0 null-min-price assets were selected. 0 zero-listing canonical candidates exist in this tradable Items snapshot; no missing name/state was invented.

## Proposed assets

Each row passed the unique-unversioned Items and History checks. “Retained” identifies the existing approved smoke assets. Full eight-decimal monetary strings and matched source fields are in [poc-100-assets.json](poc-100-assets.json).

### cases

| market_hash_name | Category | Min USD | Median USD | Quantity | 24h sales | 7d sales | Activity | Selection reason |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Danger Zone Case | cases | 1.09 | 1.86 | 93632 | 205 | 1864 | high | **Retained.** Retain smoke asset; very high listing quantity and active seven-day sales baseline. |
| Dreams & Nightmares Case | cases | 1.13 | 1.79 | 60995 | 671 | 3182 | high | High daily sales and deep listings at a low unit price. |
| Kilowatt Case | cases | 0.20 | 0.52 | 11681 | 103 | 852 | high | Cheapest selected case; low-value decimal precision with active turnover. |
| Recoil Case | cases | 0.31 | 0.72 | 49952 | 115 | 2150 | high | Cheap case with very deep listings and high weekly sales. |
| Fracture Case | cases | 0.48 | 0.80 | 28760 | 256 | 1345 | high | Sub-dollar case with substantial daily and weekly turnover. |
| Clutch Case | cases | 0.55 | 1.02 | 28646 | 457 | 1904 | high | Low price with high daily activity; compare against other cheap cases. |
| Fever Case | cases | 0.62 | 1.46 | 36716 | 67 | 1835 | high | Cheap case with deep supply but lower daily sales than Dreams & Nightmares. |
| Chroma 2 Case | cases | 3.58 | 4.84 | 18652 | 513 | 1244 | high | Mid-priced case with strong daily turnover and deep listings. |
| Spectrum 2 Case | cases | 2.70 | 3.78 | 40947 | 313 | 2501 | high | Mid-priced case with particularly deep supply and high weekly activity. |
| Operation Breakout Weapon Case | cases | 7.60 | 10.01 | 36009 | 45 | 1299 | high | Higher mid-price with deep supply and high weekly sales. |
| Glove Case | cases | 10.77 | 21.96 | 8528 | 20 | 152 | medium | Higher mid-price with lower sales activity relative to abundant supply. |
| Operation Broken Fang Case | cases | 5.40 | 9.12 | 10907 | 74 | 298 | medium | Mid-price and medium weekly activity versus high-volume cases. |
| Shattered Web Case | cases | 4.24 | 7.72 | 6984 | 8 | 124 | medium | Mid-price, medium weekly sales and a quieter current day. |
| Operation Riptide Case | cases | 8.59 | 13.31 | 4078 | 1 | 452 | medium | Medium weekly activity despite only one sale in the latest day. |
| eSports 2013 Case | cases | 44.04 | 78.70 | 244 | 0 | 2 | low | Rare expensive case; just two weekly sales and zero latest-day sales. |
| CS:GO Weapon Case | cases | 114.76 | 205.62 | 360 | 0 | 7 | low | Most expensive selected case; shallow relative supply and sparse weekly sales. |
| Operation Bravo Case | cases | 57.68 | 74.02 | 328 | 0 | 12 | low | Expensive case with low weekly activity and zero daily volume. |
| Operation Hydra Case | cases | 31.06 | 42.01 | 355 | 1 | 13 | low | Expensive case with relatively few listings and low weekly activity. |
| Huntsman Weapon Case | cases | 7.82 | 11.83 | 1547 | 0 | 7 | low | Mid-priced case with low weekly sales despite many listings. |
| Winter Offensive Weapon Case | cases | 9.62 | 12.91 | 893 | 2 | 5 | low | Mid-priced scarce case with only five weekly sales. |

### capsules/stickers

| market_hash_name | Category | Min USD | Median USD | Quantity | 24h sales | 7d sales | Activity | Selection reason |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Sticker \| Team Liquid \| Paris 2023 | capsules/stickers | 0.02 | 0.04 | 12222 | 1 | 7 | medium | **Retained.** Retain smoke asset; two-cent price and deep listings despite low daily sales. |
| Paris 2023 Contenders Sticker Capsule | capsules/stickers | 0.15 | 0.31 | 17879 | 0 | 209 | high | High weekly activity and huge listing count, but zero latest-day sales. |
| Budapest 2025 Legends Sticker Capsule | capsules/stickers | 0.16 | 0.35 | 9398 | 24 | 140 | high | Cheap capsule with high weekly turnover and many listings. |
| Antwerp 2022 Legends Sticker Capsule | capsules/stickers | 0.47 | 1.70 | 2260 | 1 | 284 | high | Highest weekly sales among eligible stickers/capsules; low price. |
| Stockholm 2021 Challengers Sticker Capsule | capsules/stickers | 1.75 | 4.84 | 2806 | 23 | 105 | high | Mid-priced capsule with high observed weekly sales. |
| Sticker \| High Heat | capsules/stickers | 0.57 | 1.62 | 2133 | 7 | 197 | high | Cheap individual sticker with high sales activity; compare with capsules. |
| Sticker \| Winding Scorch (Foil) | capsules/stickers | 1.64 | 5.41 | 1891 | 15 | 83 | high | Mid-priced foil sticker with active sales and substantial supply. |
| Sticker Capsule 2 | capsules/stickers | 10.65 | 25.14 | 1211 | 7 | 42 | medium | More expensive capsule with medium weekly activity and a wide min/median gap. |
| Stockholm 2021 Legends Sticker Capsule | capsules/stickers | 0.87 | 5.01 | 9372 | 4 | 47 | medium | Cheap capsule with medium weekly activity and a large min/median gap. |
| Sticker \| Dragon Lore (Foil) | capsules/stickers | 8.59 | 12.30 | 162 | 0 | 11 | medium | Mid-priced foil with medium weekly sales and zero latest-day volume. |
| Sticker \| Titan \| Cluj-Napoca 2015 | capsules/stickers | 67.65 | 78.77 | 69 | 1 | 5 | medium | Higher mid-price, limited listings and medium weekly activity. |
| Sticker \| Crown (Foil) | capsules/stickers | 505.01 | 881.65 | 15 | 0 | 6 | medium | Expensive sticker with nonzero medium weekly activity; avoids only dormant expensive picks. |
| Sticker \| Virtus.pro \| Katowice 2015 | capsules/stickers | 16.63 | 46.59 | 18 | 0 | 3 | low | Mid-priced older sticker with low weekly activity and thin listings. |
| Sticker \| 100 Thieves \| 2020 RMR | capsules/stickers | 0.02 | 0.04 | 3488 | 1 | 1 | low | Cheap abundant sticker with only one weekly sale; supply is not liquidity. |
| Sticker \| Bad News Eagles \| Paris 2023 | capsules/stickers | 0.02 | 0.02 | 9051 | 0 | 1 | low | Very deep cheap supply with one weekly sale and zero daily volume. |
| Sticker \| iBUYPOWER \| Cologne 2014 | capsules/stickers | 87.41 | 135.37 | 33 | 0 | 3 | low | Upper-mid price, thin supply and low weekly sales. |
| Sticker \| Titan (Holo) \| Cologne 2014 | capsules/stickers | 174.57 | 329.59 | 17 | 0 | 1 | low | Expensive holo with thin supply and one weekly sale. |
| Sticker \| iBUYPOWER (Holo) \| Cologne 2014 | capsules/stickers | 276.11 | 423.75 | 17 | 0 | 0 | low | Expensive holo with zero seven-day sales; exercise empty recent history periods. |
| Sticker \| Howling Dawn | capsules/stickers | 5847.20 | 5847.20 | 1 | 0 | 0 | low | One expensive listing with zero recent sales; singleton price statistics. |
| Sticker \| Reason Gaming (Holo) \| Katowice 2014 | capsules/stickers | 82430.91 | 82430.91 | 1 | 0 | 0 | low | Extreme price tail and one listing, zero recent sales; deliberate outlier rather than typical market proxy. |

### weapons

| market_hash_name | Category | Min USD | Median USD | Quantity | 24h sales | 7d sales | Activity | Selection reason |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| SSG 08 \| Acid Fade (Factory New) | weapons | 0.74 | 2.30 | 3145 | 7 | 103 | high | **Retained.** Retain smoke asset; cheap weapon with deep supply and high weekly activity. |
| AK-47 \| Crane Flight (Field-Tested) | weapons | 13.20 | 17.93 | 107 | 18 | 186 | high | High weekly sales in a mid-price weapon with moderate listing supply. |
| Desert Eagle \| Printstream (Field-Tested) | weapons | 37.28 | 44.52 | 455 | 20 | 150 | high | High-turnover mid-priced pistol baseline. |
| M4A1-S \| Black Lotus (Field-Tested) | weapons | 3.99 | 6.42 | 1357 | 20 | 137 | high | Cheap rifle with deep supply and high weekly activity. |
| AK-47 \| Inheritance (Field-Tested) | weapons | 37.08 | 49.11 | 319 | 20 | 133 | high | High-turnover mid-priced rifle, distinct finish family. |
| USP-S \| Printstream (Field-Tested) | weapons | 38.84 | 45.79 | 284 | 14 | 116 | high | High weekly activity on a silenced pistol; compare with Desert Eagle. |
| Glock-18 \| Candy Apple (Factory New) | weapons | 2.44 | 4.10 | 789 | 13 | 97 | high | Cheap pistol with deep supply and high weekly sales. |
| AWP \| Atheris (Field-Tested) | weapons | 4.71 | 5.51 | 499 | 10 | 67 | high | Cheap sniper with high weekly activity. |
| AK-47 \| Redline (Field-Tested) | weapons | 29.12 | 52.95 | 584 | 8 | 77 | high | Deep-supply mid-priced rifle with high weekly sales. |
| AK-47 \| Olive Polycam (Factory New) | weapons | 0.38 | 2.05 | 1816 | 0 | 107 | high | Cheap, deep listings and high weekly volume despite zero current-day sales. |
| M4A1-S \| Decimator (Field-Tested) | weapons | 11.57 | 14.74 | 278 | 3 | 23 | medium | Mid-priced rifle with medium weekly sales. |
| M4A4 \| Neo-Noir (Field-Tested) | weapons | 31.78 | 41.87 | 257 | 3 | 17 | medium | Medium weekly activity on a distinct rifle type. |
| P250 \| Asiimov (Field-Tested) | weapons | 12.21 | 14.00 | 304 | 8 | 24 | medium | Mid-priced pistol with medium weekly volume. |
| AWP \| Asiimov (Field-Tested) | weapons | 111.31 | 139.28 | 207 | 9 | 35 | medium | Expensive sniper with medium weekly activity and many listings. |
| AK-47 \| Vulcan (Field-Tested) | weapons | 170.68 | 266.66 | 96 | 3 | 23 | medium | Expensive rifle with medium weekly sales and moderate supply. |
| AK-47 \| Vulcan (Factory New) | weapons | 570.90 | 941.69 | 29 | 1 | 8 | medium | Same finish as field-tested pick, different wear/price and lower sales volume. |
| M4A1-S \| Blue Phosphor (Factory New) | weapons | 586.53 | 910.66 | 92 | 4 | 24 | medium | Expensive finish with medium weekly activity and a large min/median spread. |
| M4A1-S \| Hot Rod (Factory New) | weapons | 1471.53 | 2140.57 | 28 | 0 | 5 | medium | Four-digit price with some recent sales; thin but non-dormant expensive market. |
| AK-47 \| Bloodsport (Field-Tested) | weapons | 116.10 | 152.56 | 114 | 2 | 27 | medium | Expensive rifle with medium weekly turnover. |
| AWP \| Atheris (Well-Worn) | weapons | 3.74 | 4.27 | 203 | 3 | 17 | medium | Wear comparison with cheap Atheris field-tested; lower sales activity. |
| AUG \| Storm (Field-Tested) | weapons | 0.02 | 0.04 | 7748 | 1 | 3 | low | Two-cent weapon with thousands of listings but only three weekly sales. |
| AUG \| Contractor (Field-Tested) | weapons | 0.02 | 0.04 | 7865 | 0 | 1 | low | Two-cent deep-supply weapon with one weekly sale; inactivity despite availability. |
| P250 \| Sand Dune (Minimal Wear) | weapons | 0.04 | 0.21 | 852 | 0 | 4 | low | Very cheap low-activity pistol with many listings. |
| M4A1-S \| Decimator (Battle-Scarred) | weapons | 10.31 | 12.64 | 77 | 0 | 4 | low | Lower-sales wear comparison within Decimator family. |
| Glock-18 \| Sand Dune (Field-Tested) | weapons | 9.08 | 17.34 | 4 | 0 | 1 | low | Mid-priced pistol with four listings and one weekly sale. |
| AUG \| Hot Rod (Factory New) | weapons | 470.84 | 595.29 | 4 | 0 | 1 | low | Expensive low-activity weapon with only four listings. |
| AWP \| Dragon Lore (Factory New) | weapons | 11771.23 | 13831.02 | 5 | 0 | 1 | low | Five-figure price, sparse listings and one weekly sale. |
| AK-47 \| Wild Lotus (Factory New) | weapons | 15453.24 | 15453.24 | 1 | 0 | 0 | low | Five-figure singleton with zero recent sales; extreme price and history-null stress case. |
| StatTrak™ M4A4 \| Howl (Factory New) | weapons | 16797.19 | 16932.63 | 2 | 0 | 0 | low | Rare StatTrak canonical name with two listings and zero recent sales; source version remains null. |
| Souvenir AWP \| Dragon Lore (Factory New) | weapons | 14163.91 | 14163.91 | 1 | 0 | 0 | low | Rare Souvenir canonical name, one listing and zero recent sales; source version remains null. |

### knives

| market_hash_name | Category | Min USD | Median USD | Quantity | 24h sales | 7d sales | Activity | Selection reason |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| ★ Bowie Knife \| Tiger Tooth (Factory New) | knives | 123.17 | 155.08 | 82 | 2 | 19 | medium | **Retained.** Retain smoke asset; relatively deep knife supply with medium weekly activity. |
| ★ Survival Knife | knives | 52.36 | 61.40 | 75 | 4 | 40 | high | Cheap vanilla knife with highest observed weekly knife sales. |
| ★ Paracord Knife | knives | 51.39 | 62.53 | 35 | 5 | 30 | high | Cheap vanilla knife with high category-relative weekly activity. |
| ★ Talon Knife \| Tiger Tooth (Factory New) | knives | 472.19 | 545.44 | 34 | 4 | 32 | high | Upper-mid knife price with high weekly activity for the category. |
| ★ Skeleton Knife \| Tiger Tooth (Factory New) | knives | 320.51 | 366.57 | 59 | 4 | 31 | high | Mid-priced knife with high category-relative weekly activity. |
| ★ Butterfly Knife \| Tiger Tooth (Factory New) | knives | 1135.91 | 1276.57 | 28 | 3 | 30 | high | Expensive knife with high observed activity, balancing dormant expensive picks. |
| ★ Kukri Knife \| Fade (Factory New) | knives | 174.20 | 212.83 | 80 | 4 | 26 | high | Mid-priced unversioned Fade with deep knife supply and active weekly sales. |
| ★ Kukri Knife \| Forest DDPAT (Field-Tested) | knives | 46.21 | 55.49 | 13 | 1 | 9 | medium | Cheap knife with medium weekly activity and modest listing count. |
| ★ Nomad Knife \| Slaughter (Minimal Wear) | knives | 224.82 | 277.41 | 30 | 1 | 11 | medium | Mid-price and medium weekly activity on another knife family. |
| ★ Bayonet \| Forest DDPAT (Field-Tested) | knives | 129.35 | 143.44 | 9 | 0 | 5 | medium | Mid-price with thin supply and medium weekly activity. |
| ★ Butterfly Knife \| Slaughter (Minimal Wear) | knives | 1252.65 | 1579.49 | 16 | 0 | 6 | medium | Expensive knife with medium weekly activity and zero current-day sales. |
| ★ Navaja Knife \| Scorched (Field-Tested) | knives | 37.69 | 46.98 | 10 | 0 | 1 | low | Cheap knife with ten listings and only one weekly sale. |
| ★ Shadow Daggers \| Black Laminate (Battle-Scarred) | knives | 39.62 | 47.87 | 5 | 0 | 1 | low | Cheap low-activity knife pair with only five listings. |
| ★ Karambit \| Crimson Web (Factory New) | knives | 6474.09 | 6474.09 | 1 | 0 | 0 | low | Expensive singleton with zero recent sales; unversioned source row only. |
| ★ StatTrak™ Navaja Knife \| Blue Steel (Factory New) | knives | 18399.82 | 18399.82 | 1 | 0 | 0 | low | Extreme observed singleton asking price with no recent sales; tests outlier retention without treating ask as fair value. |

### gloves

| market_hash_name | Category | Min USD | Median USD | Quantity | 24h sales | 7d sales | Activity | Selection reason |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| ★ Driver Gloves \| Imperial Plaid (Field-Tested) | gloves | 144.45 | 212.30 | 156 | 6 | 51 | high | **Retained.** Retain smoke asset; deep glove supply and high category-relative sales. |
| ★ Hand Wraps \| Duct Tape (Field-Tested) | gloves | 49.26 | 58.21 | 96 | 8 | 53 | high | Cheap gloves with the highest observed weekly activity in this category. |
| ★ Driver Gloves \| Racing Green (Field-Tested) | gloves | 31.90 | 39.01 | 139 | 7 | 40 | high | Low-price gloves with deep supply and high observed sales. |
| ★ Driver Gloves \| Snow Leopard (Field-Tested) | gloves | 270.48 | 358.74 | 95 | 5 | 46 | high | Mid-priced gloves with high category-relative weekly activity. |
| ★ Sport Gloves \| Vice (Field-Tested) | gloves | 400.22 | 678.54 | 67 | 4 | 34 | high | Upper-mid gloves with high weekly activity, contrasting expensive low-activity wear. |
| ★ Sport Gloves \| Bronze Morph (Field-Tested) | gloves | 84.25 | 115.45 | 101 | 2 | 23 | medium | Cheap gloves with medium activity and over one hundred listings. |
| ★ Moto Gloves \| Turtle (Field-Tested) | gloves | 64.11 | 87.95 | 122 | 4 | 26 | medium | Cheap gloves with medium weekly activity and substantial supply. |
| ★ Moto Gloves \| Turtle (Minimal Wear) | gloves | 123.60 | 154.72 | 37 | 2 | 5 | medium | Mid-priced wear comparison with fewer listings and lower weekly activity. |
| ★ Hydra Gloves \| Mangrove (Field-Tested) | gloves | 34.02 | 37.54 | 66 | 4 | 19 | medium | Cheap alternative glove family with medium weekly sales. |
| ★ Hand Wraps \| Duct Tape (Battle-Scarred) | gloves | 55.50 | 62.55 | 6 | 1 | 6 | medium | Cheap wear comparison with only six listings and medium weekly activity. |
| ★ Hydra Gloves \| Mangrove (Well-Worn) | gloves | 34.14 | 36.83 | 4 | 0 | 2 | low | Cheap thin-supply gloves with only two weekly sales. |
| ★ Specialist Gloves \| Fade (Minimal Wear) | gloves | 515.56 | 555.75 | 13 | 0 | 1 | low | Expensive gloves with thin supply and one weekly sale. |
| ★ Sport Gloves \| Pandora's Box (Field-Tested) | gloves | 3883.28 | 5457.45 | 10 | 0 | 1 | low | Expensive gloves with sparse listings and one weekly sale. |
| ★ Moto Gloves \| Spearmint (Minimal Wear) | gloves | 3530.15 | 4648.99 | 2 | 0 | 0 | low | Expensive two-listing market with zero weekly sales. |
| ★ Sport Gloves \| Vice (Factory New) | gloves | 28773.74 | 28773.74 | 2 | 0 | 0 | low | Extreme glove price tail with two listings and zero recent sales; wear comparison to active field-tested market. |

## Validation results

- Proposed: 100; distinct names: 100.
- Exactly one unversioned Items row: 100/100.
- Exactly one unversioned History row: 100/100.
- Current smoke assets retained: 5/5.
- Candidate failures: 0.
- No proposed candidate failed identity, history, category-count, activity-band or price-band checks.

## Snapshot provenance and limits

- items: HTTP 200; 2026-09-09T17:12:49.635Z → 2026-09-09T17:12:51.162Z; https://api.skinport.com/v1/items?app_id=730&currency=USD&tradable=1; SHA-256 c134419ba16a4c8e315c20d0cfc58f11ac3ccfe1ba83da6f177383853e4044fd.
- sales/history: HTTP 200; 2026-09-09T17:12:49.663Z → 2026-09-09T17:12:50.103Z; https://api.skinport.com/v1/sales/history?app_id=730&currency=USD; SHA-256 9d2216b714f572f896d4490b777e5a720269e7a54dbf35350249770a3bee63ed.

History body unchanged since earlier discovery: true. A matching hash proves unchanged returned aggregates, not whether every underlying sale was freshly processed; History exposes no per-row update timestamp. Requests are near-synchronous, not an atomic cross-endpoint snapshot. Quantities, prices and eligibility can change after report generation; rerun live name validation at seeding time.

The explicit proposal is [config/poc-100-proposed.json](../config/poc-100-proposed.json). The approved seed input remains [config/tracked-assets.json](../config/tracked-assets.json) with five names. No automatic promotion, seeding, collection, schedule change or commit was performed.
