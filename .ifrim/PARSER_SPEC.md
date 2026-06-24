# Parser Spec - WhatsApp Delivery Counter

## Supported Input

Accepted files:

- `.txt`
- `.zip` containing exactly one or more `.txt` files

If a zip contains multiple text files, the app must ask the user which chat to scan or scan each file separately with clear labels.

## Known Export Format

Romanian WhatsApp export sample shape:

```text
30.05.2026, 21:14 - Sender: ridicat x1
30.05.2026, 21:22 - Sender: Livrat x1
```

Regex baseline:

```regex
^(?<date>\d{2}\.\d{2}\.\d{4}), (?<time>\d{2}:\d{2}) - (?:(?<sender>[^:]+): )?(?<message>.*)$
```

## Date Handling

The parser must convert timestamps into local Europe/Bucharest date/time.

Scan interval is inclusive:

- include message if `timestamp >= from`
- include message if `timestamp <= to`

## Scan Options

The app imports and keeps all parsed signals from the selected conversations. Filtering happens at scan time with explicit user checkboxes:

- `Comenzi`: count `ridicat` / `livrat`, zones, day/night order totals, and mismatches.
- `Ore lucrate`: calculate availability sessions from `Disponibil` / `Indisponibil`.
- `Timpi livrare`: calculate delivery-time averages from `ridicat` -> `livrat` pairs.

At least one scan option must be selected. Classification such as `restaurant` or `availability` may be shown as a hint, but it must not discard parsed data before scan.

## Status Detection

Supported statuses:

- `ridicat`
- `livrat`

Case-insensitive. Must handle:

- `ridicat x1`
- `Ridicat X1.`
- `ridicat x1 <Acest mesaj a fost editat>`
- `Livrat x1 zona 2`
- `Livrat x2 (x1 zona 2 + x1 completare comanda)`

The parser should tolerate close human typos when the message still has delivery context such as `x1`, `x2`, or `zona N`.

Examples:

- `riricat x1` -> count as `ridicat x1`, but mark for review.
- `livrt x1 zona 2` -> count as `livrat x1 zona 2`, but mark for review.
- `riscat x1`, `ridica x1`, and `preluat x1` -> count as pickup/ridicat, but mark for review.
- `luat` as a standalone courier action -> count as pickup/ridicat x1, but mark for review.
- `Ridicat. 1` -> count as `ridicat x1`, but mark for review because it is not the standard `x1` format.
- `Am ridicat doar una` -> count as `ridicat x1`, but mark for review because the quantity is textual.
- `livrați x1` / `livrati x1` -> count as delivered/livrat, but mark for review.

Fuzzy status correction must be conservative and reviewable, not silent.

Do not count conversational references to statuses, such as:

- `George ai livrat?`
- `Pune o poza cu bonul daca nu ai livrat`

These are not courier action messages. They should be ignored for totals and logged as parser info/review context.

## Zone Detection

For delivered messages, detect zones:

- `zona 1`
- `zona 2`
- `zona 3`

Rules:

- `livrat x1 zona 2` counts 1 delivered order for Zone 2.
- `livrat x2 zona 2` counts 2 delivered orders for Zone 2.
- `livrat x2 (x1 zona 2 + x1 completare comanda)` counts 2 delivered orders total, but only 1 delivered order for Zone 2.
- Zone counts are grouped by courier in the main courier summary table.
- `ridicat ... zona N` does not increase delivered zone totals.
- `zona 4` should not be treated as a normal fixed zone. The client uses 3 normal zones. Anything beyond Zone 3 is treated as outside-zone/kilometer-based when km data exists.
- Detect exterior kilometers when present, for example `5 km`, `5km`, `km 5`.
- Drivers often do not write kilometers for outside-zone deliveries. They may write informal amounts such as `livrat 45 lei`, `livrat (55lei)`, or `55 ron`. Detect these as outside-zone/payment amount context in a separate `Lei exterior` field and flag them for review because the meaning is not fully standardized.
- Payment business rule currently understood: Zona 1 normal, Zona 2/Zona 3 special/double-style handling, outside Zone 3 by kilometers. Final payment math must be confirmed before automating payouts.

## Night Deliveries

Night interval is `23:00` through `03:59`.

Rules:

- Night orders must not be included in the normal/day `Total Comenzi`.
- Night orders are counted in separate night columns.
- Night orders can still have Zona 1, Zona 2, Zona 3, outside kilometers, or informal lei amounts.
- Messages between `00:00` and `03:59` belong to the previous reporting day for the night shift.
- The user-selected scan interval remains the outer filter; no message outside the selected interval is counted.

## Work Hours

Couriers may write availability messages:

- `Disponibil`
- `Indisponibil`
- short variants such as `disp` / `indisp`

Rules:

- Work-hour messages often come from a separate pontaj/availability WhatsApp group, not from restaurant delivery groups.
- Imported files may be classified as `restaurant` or `availability` for operator context, but scan options decide what is counted.
- Pair work sessions only for the same courier identity after alias resolution and same availability source.
- Never pair `Disponibil` from one courier with `Indisponibil` from another courier.
- `Disponibil` opens a work session.
- `Indisponibil` closes a work session.
- Missing or reversed pairs are flagged for review and not counted as worked time.
- Sessions are clipped to the user-selected interval.
- Sessions crossing midnight are split by calendar day in the work-hours report.
- Very long sessions over 18 hours are treated as likely missing-message cases, flagged for review, and not counted automatically.
- Future/scheduled text such as `o sa fiu disponibil de la 10 pana la 12` is flagged for review and not counted automatically.
- Work hours must not be duplicated into each restaurant/day row; they belong in a separate work-hours report and can be summarized globally by courier.

## Multi-Restaurant Reporting

The parser/reporting layer must support any number of restaurants/groups, not a hardcoded count. Current client scale is about 20 restaurants and may grow.

Each imported chat should carry:

- import id
- source file
- restaurant/group display name
- parsed messages
- parser issues

Reports should be groupable by:

- restaurant
- courier
- day
- selected interval

## Delivery Time Pairing

For analytics, pair courier events chronologically:

- each `ridicat xN` creates N open pickup units for that courier
- each later `livrat xN` closes N open pickup units for that courier
- duration = delivered timestamp - picked-up timestamp
- average delivery time is calculated only from reliable pairs
- unmatched pickups/deliveries remain in review

When pairing across restaurants, keep restaurant context. If a courier serves multiple restaurants in the same interval, pairing must not mix restaurants unless explicitly allowed by future product rules.

## Quantity Detection

Preferred quantity pattern:

```regex
\bx\s*(\d+)\b
```

Examples:

- `x1` -> 1
- `X1` -> 1
- `x2` -> 2

If status exists but quantity is missing:

- default to 1 only if the confidence rule allows it
- otherwise mark as `needs_review`

MVP default: status without quantity counts as 1 but appears in the review list.

The parser may also infer small explicit quantities written as plain numbers or words near a clear courier action, for example `Ridicat. 1`, `livrat doua`, or `am ridicat doar una`. These inferred quantities must be reviewable and should not be silent.

## Courier Detection

Courier identity comes from the WhatsApp sender field.

If sender is a phone number:

- display phone number until mapped
- allow alias: phone -> courier name
- persist alias locally

If sender is a saved contact name:

- use contact name directly
- still allow alias correction

## Ignored Messages

Ignore for counts:

- system messages
- media omitted messages
- restaurant preparation messages like `E gata`
- confirmations like `confirmat`, unless a future rule explicitly uses them

## Required Outputs

For each parsed relevant message:

- id
- source file
- timestamp
- sender raw
- courier display name
- status
- quantity
- note
- confidence
- needs review boolean
- original message

For each courier report:

- courier id/display name
- picked up quantity
- delivered quantity
- difference
- reviewed count
- unclear count
- source messages
