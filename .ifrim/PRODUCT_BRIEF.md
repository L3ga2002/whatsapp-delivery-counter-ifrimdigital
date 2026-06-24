# Product Brief - WhatsApp Delivery Counter

## Problem

The client has many WhatsApp groups with couriers and restaurants. Current known scale is about 20 restaurants/groups, and the app must not hardcode a fixed restaurant limit. Couriers write short operational messages such as:

- `ridicat x1`
- `livrat x1`
- `ridicat x2`
- `livrat x1 zona 2`
- `livrat 45 lei`
- `livrat (55lei)`
- `preluat x1`
- `livrați x1`
- `Disponibil` / `Indisponibil`
- `Livrat X1 <Acest mesaj a fost editat>`

At the end of the reporting period, the client manually counts these messages to know how many orders each courier handled.

## Product

A Windows desktop application that imports exported WhatsApp chats and produces accurate courier reports for a selected date/time interval.

The product should grow from a single-chat counter into a multi-restaurant reporting tool:

- import many WhatsApp exports
- associate each export with a restaurant/group
- report by restaurant, courier, day, and selected interval
- export restaurant-facing and internal operational Excel reports

## Primary Users

- Business owner / dispatcher
- Admin person who calculates courier payments

## MVP

Must support:

- Import one or many `.zip` WhatsApp exports containing one `.txt`
- Import one or many direct `.txt` WhatsApp exports
- Associate each import with a restaurant/group name
- Romanian WhatsApp export format:
  `dd.mm.yyyy, HH:mm - Sender: message`
- Calendar interval selection:
  - from date/time
  - to date/time
- Scan module selection:
  - comenzi: `ridicat`, `livrat`, zone, noapte, diferente
  - ore lucrate: `Disponibil` / `Indisponibil`
  - timpi livrare: media dintre `ridicat` si `livrat`
- Count only messages inside selected interval
- Extract:
  - timestamp
  - sender
  - courier identity
  - status: `ridicat`, `livrat`
  - quantity from `x1`, `x2`, etc.
  - notes such as `zona 2`, `completare comanda`, edited message
- Courier alias mapping:
  - phone number -> real courier name
  - unknown sender stays visible until mapped
- Summary by courier:
  - picked up count
  - delivered count
  - difference
  - unclear messages
- Summary by restaurant
- Summary by day
- Summary by courier and day
- Separate day and night order totals:
  - day/normal orders
  - night orders from 23:00 to 03:59
  - night orders do not enter the normal total
- Worked-hours tracking from courier availability messages where reliable:
  - `Disponibil` opens work time
  - `Indisponibil` closes work time
  - availability often comes from a separate courier/pontaj WhatsApp group, but the app keeps all parsed data and lets the user choose scan modules
  - pairs must be from the same courier identity after alias resolution
  - work hours are reported separately from restaurant order totals
  - suspicious future/scheduled messages and very long sessions are sent to review
- Delivery time analytics:
  - pair `ridicat` to later `livrat` for the same courier
  - calculate average delivery time per courier where pairing is reliable
- Mismatch view:
  - picked up > delivered
  - delivered > picked up
  - status without clear quantity
- Export report to Excel following the client's operational format:
  - Data
  - Nume Livrator
  - Total Comenzi
  - Zona 1
  - Zona 2
  - Zona 3
  - Ridicate
  - Livrate
  - Neconcordante
  - Erori
  - Timp mediu livrare
  - Km exterior zonei 3, when present
  - Lei exterior / suma mentionata, when drivers write informal payment amounts instead of kilometers
  - Comenzi noapte and night zone columns
  - separate `Ore lucrate` sheet/report from the pontaj group
- Review navigation from errors to the exact imported conversation context inside the app.

## Not In MVP

- Direct reading from live WhatsApp groups
- WhatsApp account automation
- Scraping WhatsApp Web
- Cloud backend
- Multi-client SaaS dashboard

## Important Product Decision

The main scan mode is not "last 7 days".

The correct scan mode is a custom calendar interval. Quick presets can exist later, but the user must always be able to choose the exact start and end date/time.
