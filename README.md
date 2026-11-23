# GENZ WIFI — software-first MVP

A lightweight, responsive, black-and-gold hotspot portal prototype for Kenya.

## Included
- Customer landing page and Wi-Fi package selection
- Simulated M-Pesa checkout flow (clearly marked DEMO; no real STK push)
- Voucher display after demo payment
- Owner dashboard for `komassystems@gmail.com`
- Package editing, demo voucher creation, basic sales/session counters
- KES currency formatting and mobile-friendly layout

## Run locally
No build tools are required:
1. Extract the ZIP.
2. Open `public/index.html` in a modern browser.

For a local web server, run:
`python -m http.server 8000`
from this folder, then visit `http://localhost:8000/public/`.

## Important production limitations
This is a working front-end prototype, not a production hotspot platform.
- Payments are simulated. Before taking money, integrate Safaricom Daraja STK Push and verify callbacks server-side.
- Vouchers are demo-generated in browser memory. Production vouchers must be stored in a database and provisioned to MikroTik RouterOS.
- Admin access is a visual demo only. Add server-side authentication, role checks, audit logs and secure secrets before deployment.
- No live router connection, real customer session tracking, or AI support backend is included.
- Confirm with Mtaani Fibre in writing that your plan permits paid hotspot redistribution/resale before launch.

## Current draft packages
1 Hour KSh 10; 6 Hours KSh 20; 24 Hours KSh 50; 7 Days KSh 250; 30 Days KSh 700.
All prices are editable in the Owner dashboard. The 3-hour package has been removed.


## Backend foundation (new)
A Node.js/TypeScript API and PostgreSQL/Prisma schema are included under `backend/`.
See `backend/README.md` for setup. The Daraja endpoint requires your own sandbox credentials and a public callback URL. MikroTik automatic voucher provisioning is not yet connected. Do not accept live payments until end-to-end sandbox tests, security review and router activation tests are complete.
