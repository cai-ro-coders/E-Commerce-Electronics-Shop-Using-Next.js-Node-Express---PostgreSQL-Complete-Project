# ElectroShop — Electronics E-Commerce Admin & Storefront

A full-stack electronics store with a customer storefront and a complete staff/admin console. Built with **Next.js (App Router) + TypeScript + Tailwind CSS v4** on the frontend and **Node.js + Express + TypeScript + PostgreSQL + Prisma** on the backend.

---

## Quick access

| What | URL |
| --- | --- |
| Storefront | `http://localhost:3000` |
| Admin login | `http://localhost:3000/admin/login` |
| Admin dashboard (after login) | `http://localhost:3000/admin/dashboard` |
| API base URL | `http://localhost:4000/api` |
| API health check | `http://localhost:4000/api/health` |
| Swagger / OpenAPI docs | `http://localhost:4000/api/docs` |
| Uploaded files | `http://localhost:4000/uploads/...` |

## Demo accounts

All seeded accounts use the password **`password123`**.

| Role | Email | Password | Sign-in page |
| --- | --- | --- | --- |
| **Admin** | `admin@example.com` | `password123` | `http://localhost:3000/admin/login` |
| **Staff** | `staff@example.com` | `password123` | `http://localhost:3000/admin/login` |
| **Customer** | `ava.thompson1@example.com` | `password123` | `http://localhost:3000/login` |

- All 50 seeded customers use `password123`.
- Customer emails follow the pattern `first.last{N}@example.com`, where `N` is the 1-based position in the seed list — for example `liam.bennett2@example.com`, `sophia.nguyen3@example.com`.
- The admin guard redirects unauthenticated visitors to `/admin/login?redirect=...` and non-staff users back to the storefront.

> Change every default credential and `JWT_SECRET` before deploying anywhere shared or public.

---

## Highlights

### Storefront
- Home page with hero, featured product, categories, featured products and trust strip
- Product catalogue with search, category/brand/price filters, sorting and pagination
- Product detail pages with image gallery, specifications, reviews, wishlist and add-to-cart
- Category and brand browsing
- Slide-over cart, full cart page and checkout flow
- Stripe card payments with Stripe Elements, PayPal Checkout buttons and cash-on-delivery options
- Customer registration, login, forgot/reset password
- Account area: profile, addresses, wishlist, cart, notifications, security and login history
- Order history, order detail and public order tracking
- Contact page
- Responsive, mobile-first layout with light/dark theme support

### Admin console
- Secure staff-only login with role-aware navigation and route guard
- Dashboard with revenue/order charts, KPI cards, best sellers, low stock and recent activity
- Products: list, search/filter, create, edit, detail view, image uploader, specifications, CSV/JSON export
- Orders: list, status/payment filters, detail view, status updates, tracking, invoice print
- Customers: list, create, edit, status changes, detail view with order history
- Categories and brands: CRUD with image/logo upload and status management
- Coupons: create/edit/delete, usage counts and discount totals
- Reviews: moderation (approve/reject/pending), rating filters and stats
- Users & roles: staff accounts, permissions, account status, activity log
- Inventory: stock adjustment, low-stock view, inventory logs, FullCalendar restock/audit events, CSV export
- Notifications: list, mark read, mark all read, create and delete
- Files: drag-and-drop uploads, folders, stats, external file registration
- Reports: sales, inventory and customer reports with date ranges, charts and CSV/JSON export
- Settings: grouped store settings saved in bulk
- Collapsible responsive sidebar, mobile drawer, breadcrumbs, global product search, dark mode
- Loading skeletons, empty states, SweetAlert2 confirmations and toast feedback
- Server-side DataTables pattern with pagination, sorting, search, export and print

### Platform / API
- REST API with JWT authentication (HTTP-only cookie or Bearer token)
- Role-based access control (`admin`, `staff`, `customer`) and a permission catalog
- Zod request validation, centralized error handling, rate limiting and Helmet
- Prisma models and realistic seed data
- Swagger/OpenAPI documentation at `http://localhost:4000/api/docs`
- CSV/JSON exports for products, orders, inventory, reports and settings backup

---

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4 |
| Data/UI | TanStack Query, Chart.js, FullCalendar, SweetAlert2, React Hook Form, Zod, Lucide React |
| Backend | Node.js, Express, TypeScript, Prisma ORM, JWT, bcryptjs, Multer, Helmet |
| Payments | Stripe PaymentIntents + Elements, PayPal Checkout (database-backed credentials) |
| Database | PostgreSQL |

### Requirements

- Node.js 20+
- npm 10+
- PostgreSQL 14+

---

## Project structure

```text
.
├── README.md
├── AI.md                        # Original product/spec notes
├── backend/
│   ├── .env                     # Database, JWT and CORS configuration
│   ├── prisma/
│   │   ├── schema.prisma        # Data model
│   │   └── seed.ts              # Realistic demo seed data
│   ├── uploads/                 # Uploaded files (served at /uploads)
│   └── src/
│       ├── app.ts               # Express bootstrap, Swagger, CORS, security
│       ├── config/              # Prisma client
│       ├── middleware/          # Auth, validation, uploads, rate limit, CSRF origin check
│       ├── routes/              # API modules
│       ├── services/            # Order/checkout, Stripe and PayPal payment logic
│       ├── utils/               # JWT, passwords, CSV, pagination, audit
│       └── validators/          # Zod schemas
└── frontend/
    ├── app/
    │   ├── (storefront)/        # Public shop, account, cart, checkout, orders
    │   └── admin/
    │       ├── (auth)/login/    # Standalone admin login
    │       └── (console)/       # Guarded admin console routes
    ├── components/
    │   ├── admin/               # Shell, guards, uploaders, product form
    │   ├── charts/              # Chart.js wrappers
    │   ├── providers/           # Auth, cart, wishlist, theme, React Query
    │   ├── storefront/          # Header, footer, cart drawer, product cards
    │   └── ui/                  # Buttons, inputs, modal, DataTable, badges, etc.
    ├── hooks/
    └── lib/                     # API client, alerts, constants, utils, exports
```

---

## Getting started

### 1. Create the database

Create a PostgreSQL database named `ecommerce` (or adjust the connection string below):

```bash
createdb -U postgresdb ecommerce
```

### 2. Backend setup

`backend/.env`:

```env
DATABASE_URL="postgresql://postgresdb:cairocoders@localhost:5432/ecommerce?schema=public"
PORT=4000
JWT_SECRET="change-me-super-secret"
JWT_EXPIRES_IN="7d"
FRONTEND_URL="http://localhost:3000"
NODE_ENV=development
```

Install, generate the Prisma client, push the schema and seed:

```bash
cd backend
npm install
npx prisma generate
npx prisma db push
npm run prisma:seed
npm run dev
```

The API starts on `http://localhost:4000`.

### 3. Frontend setup

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

`frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:4000/api
```

Open `http://localhost:3000` for the storefront, or `http://localhost:3000/admin/login` for the admin console.

### 4. Stripe card payments

Card payments are processed by Stripe. The publishable and secret keys are stored in the `settings` table and managed from the admin console — they are **not** read from `.env`.

1. Sign in to the [Stripe Dashboard](https://dashboard.stripe.com/test/apikeys) and copy your **test** keys:
   - Publishable key: `pk_test_…`
   - Secret key: `sk_test_…`
2. Open `http://localhost:3000/admin/settings`, choose the **Payment** tab and save both keys.
3. Go to `http://localhost:3000/checkout`, select **Credit / debit card (Stripe)** and pay with a Stripe test card.

| Test card | Result |
| --- | --- |
| `4242 4242 4242 4242` | Payment succeeds |
| `4000 0000 0000 0002` | Card declined |
| `4000 0000 0000 9995` | Insufficient funds |
| `4000 0025 0000 3155` | Requires 3D Secure authentication |

Use any future expiry date, any three-digit CVC, and any postal code. No real money moves in test mode.

How it works:

- `/api/settings/public` exposes only the publishable key to the storefront.
- The secret key stays on the server and is masked for staff users in the settings API.
- Checkout creates the order as **Pending**, creates a Stripe PaymentIntent, confirms the card with Stripe Elements, then calls `POST /api/payments/confirm`.
- After Stripe confirms the PaymentIntent, the backend verifies the paid amount and marks the order **Paid** / **Processing**, stores the PaymentIntent id as the transaction id, and sends notifications.
- A declined card leaves the order pending so the customer can retry at checkout without creating a duplicate order.

> The seed leaves the Stripe keys empty, so checkout shows a setup notice until real keys are saved. Re-running the seed clears the keys again — save them afterwards.

### 5. PayPal Checkout

PayPal payments use the official [PayPal JavaScript SDK](https://developer.paypal.com/sdk/js/) rendered by [`@paypal/react-paypal-js`](https://www.npmjs.com/package/@paypal/react-paypal-js). The Client ID and Client Secret are stored in the `settings` table and managed from the admin console — they are **not** read from `.env`.

1. Sign in to the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/applications/sandbox) and create (or open) a **Sandbox** app.
2. Copy the **Client ID** and **Client Secret**.
3. Open `http://localhost:3000/admin/settings`, choose the **Payment** tab, paste both values and keep **paypal_mode** on `Sandbox`. Save.
4. Go to `http://localhost:3000/checkout`, select **PayPal**, accept the terms and click the yellow PayPal button. Approve the payment with a [sandbox buyer account](https://developer.paypal.com/dashboard/accounts) (created in the same dashboard).
5. After approval you are returned to checkout and the order becomes **Paid** / **Processing**.

How it works:

- `/api/settings/public` exposes the Client ID plus `paypal_configured` / `stripe_configured` booleans. Neither secret is ever returned publicly.
- The Client Secret stays on the server and is masked for staff users in the settings API.
- Checkout creates the order as **Pending**, then `POST /api/payments/intent` with `gateway: "paypal"` creates a PayPal order through the PayPal Orders v2 API and stores the PayPal order id on the local payment.
- The PayPal buttons open the PayPal approval flow. On approval the storefront calls `POST /api/payments/paypal/capture` with the local `orderId` and the PayPal `orderID`.
- The backend captures the PayPal order, verifies the captured amount, currency and custom id, then marks the order **Paid** / **Processing**, stores the **capture id** as the transaction id, and sends notifications.
- Captures are idempotent: if the PayPal order is already `COMPLETED` the existing capture is returned, so retries never double-charge.
- Cancelling the PayPal window or a failed capture leaves the local order pending, so the customer can retry without creating a duplicate order.
- `paypal_mode` selects the API host: `sandbox` → `https://api-m.sandbox.paypal.com`, `live` → `https://api-m.paypal.com`. PayPal client IDs do not encode the environment, so set this correctly before going live.

> The seed leaves the PayPal credentials empty, so checkout shows a setup notice until real credentials are saved. Re-running the seed clears them again — save them afterwards.

### 6. Production build

```bash
# Backend
cd backend
npm run build
npm start

# Frontend
cd frontend
npm run build
npm start
```

> Start the backend before the frontend so initial page data requests succeed.

---

## Routes

### Storefront

| Route | Description |
| --- | --- |
| `/` | Home page |
| `/products` | Product catalogue |
| `/products/[slug]` | Product detail |
| `/categories` | Category browsing |
| `/brands` | Brand browsing |
| `/cart` | Shopping cart |
| `/checkout` | Checkout |
| `/login` | Customer login |
| `/register` | Customer registration |
| `/forgot-password` | Request password reset |
| `/reset-password` | Set a new password |
| `/account` | Account overview |
| `/account/profile` | Profile details |
| `/account/addresses` | Saved addresses |
| `/account/wishlist` | Wishlist |
| `/account/cart` | Cart items |
| `/account/notifications` | Notifications |
| `/account/security` | Change password |
| `/account/login-history` | Login history |
| `/account/orders` | Customer order history |
| `/orders` | Order history |
| `/orders/[id]` | Order detail and tracking |
| `/contact` | Contact form |

### Admin console

All admin routes require a staff/admin session.

| Route | Description |
| --- | --- |
| `/admin` | Redirects to the dashboard |
| `/admin/login` | Admin/staff login |
| `/admin/dashboard` | KPIs, charts, best sellers, low stock, activity |
| `/admin/products` | Products list (server-side table, export/print) |
| `/admin/products/new` | Create product |
| `/admin/products/[id]` | Product detail |
| `/admin/products/[id]/edit` | Edit product |
| `/admin/orders` | Orders list and filters |
| `/admin/orders/[id]` | Order detail, status updates, invoice |
| `/admin/customers` | Customers list |
| `/admin/customers/[id]` | Customer detail with order history |
| `/admin/categories` | Categories CRUD |
| `/admin/brands` | Brands CRUD |
| `/admin/coupons` | Coupons CRUD |
| `/admin/reviews` | Review moderation |
| `/admin/users` | Staff users, roles and activity tabs |
| `/admin/inventory` | Stock adjustment, logs, FullCalendar events |
| `/admin/notifications` | Notifications |
| `/admin/files` | File manager |
| `/admin/reports` | Sales, inventory and customer reports |
| `/admin/settings` | Store settings |

---

## Seed data

The seed script creates a complete demo dataset:

- 52 users: 1 admin, 1 staff and 50 customers
- 18 categories and 23 brands
- 50 products with images, specifications and inventory logs
- Addresses, carts, wishlists and login history
- 12 coupons with usage records
- 51 orders with items, payments and status history
- 60 reviews across pending/approved/rejected states
- 50 file assets
- 31 store settings
- Inventory restock/audit events for the calendar

To rebuild the demo data from scratch (this **erases existing data**):

```bash
cd backend
npx prisma db push --force-reset
npm run prisma:seed
```

The seed uses plain inserts, so running it repeatedly against a populated database will fail on unique constraints. Reset first as shown above.

---

## API overview

Base URL: `http://localhost:4000/api`

Authentication uses an HTTP-only `token` cookie. API clients may also send `Authorization: Bearer <token>`. State-changing browser requests are checked against `FRONTEND_URL`.

| Module | Main endpoints |
| --- | --- |
| Auth | `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `POST /auth/forgot-password`, `POST /auth/reset-password`, `POST /auth/change-password`, `GET /auth/me`, `PUT /auth/profile`, `GET /auth/login-history` |
| Products | `GET /products`, `GET /products/stats`, `GET /products/export`, `GET /products/:idOrSlug`, `POST /products`, `PUT /products/:id`, `PATCH /products/:id/status`, `DELETE /products/:id` |
| Categories | `GET /categories`, `GET /categories/stats`, `GET /categories/:idOrSlug`, `POST /categories`, `PUT /categories/:id`, `DELETE /categories/:id` |
| Brands | `GET /brands`, `GET /brands/stats`, `GET /brands/:idOrSlug`, `POST /brands`, `PUT /brands/:id`, `DELETE /brands/:id` |
| Orders | `GET /orders`, `GET /orders/stats`, `GET /orders/export`, `GET /orders/export/csv`, `GET /orders/my`, `GET /orders/track/:orderNumber`, `GET /orders/:id`, `GET /orders/:id/receipt`, `POST /orders/checkout`, `PUT /orders/:id`, `PATCH /orders/:id/status`, `DELETE /orders/:id` |
| Customers | `GET /customers`, `GET /customers/stats`, `GET /customers/:id`, `GET /customers/:id/orders`, `POST /customers`, `PUT /customers/:id`, `PATCH /customers/:id/status`, `DELETE /customers/:id` |
| Reviews | `GET /reviews`, `GET /reviews/stats`, `POST /reviews`, `PUT /reviews/:id`, `PATCH /reviews/:id/status`, `DELETE /reviews/:id` |
| Coupons | `GET /coupons`, `GET /coupons/stats`, `GET /coupons/:id`, `POST /coupons`, `POST /coupons/validate`, `PUT /coupons/:id`, `DELETE /coupons/:id` |
| Cart | `GET /cart`, `POST /cart/items`, `PUT /cart/items/:id`, `DELETE /cart/items/:id`, `DELETE /cart` |
| Wishlist | `GET /wishlist`, `GET /wishlist/count`, `POST /wishlist`, `POST /wishlist/toggle`, `DELETE /wishlist/:productId` |
| Addresses | `GET /addresses`, `POST /addresses`, `PUT /addresses/:id`, `PATCH /addresses/:id/default`, `DELETE /addresses/:id` |
| Payments | `GET /payments`, `GET /payments/stats`, `GET /payments/order/:orderId`, `POST /payments/intent` (Stripe PaymentIntent or PayPal order), `POST /payments/confirm` (verify PaymentIntent), `POST /payments/paypal/capture` (capture PayPal order), `PATCH /payments/:id`, `POST /payments/:id/refund` |
| Inventory | `GET /inventory/stats`, `GET /inventory/low-stock`, `GET /inventory/valuation`, `GET /inventory/logs`, `GET /inventory/logs/export`, `POST /inventory/adjust`, `GET /inventory/events`, `POST /inventory/events`, `PUT /inventory/events/:id`, `DELETE /inventory/events/:id` |
| Users | `GET /users`, `GET /users/permissions`, `GET /users/activity`, `GET /users/:id`, `POST /users`, `PUT /users/:id`, `PATCH /users/:id/status`, `DELETE /users/:id` |
| Notifications | `GET /notifications`, `GET /notifications/unread-count`, `PATCH /notifications/:id/read`, `POST /notifications/read-all`, `POST /notifications`, `DELETE /notifications/:id` |
| Files | `GET /files`, `GET /files/stats`, `GET /files/folders`, `POST /files/upload`, `POST /files`, `DELETE /files/:id` |
| Reports | `GET /reports/sales`, `GET /reports/inventory`, `GET /reports/customers`, `GET /reports/export?type=sales\|inventory\|customers` |
| Settings | `GET /settings/public`, `GET /settings`, `GET /settings/stats`, `GET /settings/backup`, `PUT /settings/bulk`, `POST /settings`, `PUT /settings/:id`, `DELETE /settings/:id` |
| Contact | `POST /contact`, `GET /contact`, `PATCH /contact/:id`, `DELETE /contact/:id` |
| Dashboard | `GET /dashboard/admin` |
| Admin | `GET /admin/overview`, `GET /admin/roles`, `GET /admin/activity`, `GET /admin/sessions`, `GET /admin/system` |
| Uploads | `POST /uploads` (multipart form-data) |

Use the interactive Swagger UI at `http://localhost:4000/api/docs` for request bodies, schemas and try-it-out requests.

### Authentication and access

- **Public:** storefront catalogue, product detail, contact form, customer registration/login, order tracking.
- **Customer:** `/account/*`, cart, wishlist, addresses, own orders and payments.
- **Staff:** products, orders, customers, inventory, reviews, files and reports (permission-aware).
- **Admin:** everything, including users/roles, settings, activity, sessions and system information.

---

## Scripts

### Backend

```bash
npm run dev              # Start API with tsx watch
npm run build            # Compile TypeScript
npm start                # Run compiled server
npm run prisma:generate  # Generate Prisma client
npm run prisma:migrate   # Create/apply a development migration
npm run prisma:seed      # Seed demo data
```

### Frontend

```bash
npm run dev              # Next.js dev server
npm run build            # Production build
npm start                # Production server
npm run lint             # ESLint
npx tsc --noEmit         # TypeScript check
```

---

## Verification

The project has been verified with:

- `npx tsc --noEmit` — clean
- `npm run lint` — 0 errors (warnings remain for intentional `any` API boundaries and `<img>` usage)
- `npm run build` — production build succeeds; all storefront and admin routes are generated
- Headless Chrome smoke tests across every storefront/admin page (desktop + mobile, light/dark)
- API smoke tests for authentication, CRUD, inventory adjustments, order status updates, review moderation, file upload and exports
- End-to-end admin product creation through the UI
- Reports net-sales calculation (sales minus refunds) checked against seeded orders
- Stripe configuration flow: admin key management, secret-key masking for staff, publishable-key exposure, Stripe Elements rendering and PaymentIntent error handling
- PayPal configuration flow: admin Client ID/Secret management, masked secret for staff, public Client ID and provider flags via `/api/settings/public`, PayPal SDK button rendering and unconfigured-provider notices

---

## Troubleshooting

### Ports already in use

Default ports are **3000** (frontend) and **4000** (backend). Stop the old processes or change `PORT` (backend) and use `next dev -p <port>` (frontend). If you change the frontend port, update `FRONTEND_URL` in `backend/.env` to match.

### Native module errors on Apple Silicon

If you see errors such as `Cannot find module '../lightningcss.darwin-x64.node'` or `@esbuild/darwin-x64`, Node was started under Rosetta while dependencies were installed for arm64 (or vice versa). Fix by using the same architecture for install and run:

```bash
# Check the current architecture
node -p "process.arch"

# If the shell runs under Rosetta (x86_64) but dependencies are arm64:
arch -arm64 npm run dev
```

Alternatively, reinstall dependencies with the same Node/npm architecture used to run the app. Deleting `.next` after switching architecture also clears stale compiled caches.

### CORS or cookie login issues

- Confirm `FRONTEND_URL` matches the exact origin used in the browser, including port.
- The frontend API client must send `credentials: 'include'`.
- If using a Bearer token, send `Authorization: Bearer <token>`.

### Database connection errors

- Confirm PostgreSQL is running and the `ecommerce` database exists.
- Check `DATABASE_URL` credentials, host and port.
- Run `npx prisma generate` after schema changes.

### Uploads not displaying

Uploaded files are stored on the local filesystem under `backend/uploads/` and served from `http://localhost:4000/uploads/...`. Ensure the backend is running and the folder is writable.

---

## Notes and production checklist

- Stripe and PayPal credentials are stored in the database and managed from **Admin → Settings → Payment**. Cash on delivery remains available as an alternative checkout option. Both Stripe and PayPal perform real charges once valid credentials are saved.
- Before going live, replace the Stripe test keys with live keys, switch `paypal_mode` to `live` and add live PayPal credentials, then review the Stripe/PayPal webhook and fulfilment flows required for your business.
- Product imagery uses Unsplash URLs and local uploads. Brand logos intentionally fall back to monograms when no logo is set.
- Uploaded files live on the local filesystem; use object storage (S3, etc.) in production.
- Before deploying: change `JWT_SECRET`, all seeded passwords, `FRONTEND_URL`, database credentials, and set `NODE_ENV=production`.
- Serve the frontend and API over HTTPS and restrict CORS to the production storefront origin.
