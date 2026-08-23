# Tour Inventory Management System — Claude Code Prompt

## PROJECT OVERVIEW

Build a full-stack **Tour Inventory Management System** for a Tour Wholesaler.

- Wholesalers manage tour inventory and distribute to resellers & API consumers
- Resellers get dedicated login portal to browse & book tours with their NET price
- External websites consume tours via REST API using API Keys

---

## TECH STACK

- **Frontend**: Next.js 14 (App Router) + TypeScript + Tailwind CSS + shadcn/ui
- **Backend**: Firebase (Firestore, Auth, Functions, Storage)
- **API Layer**: Firebase Functions (Express.js) as REST API
- **Auth**: Firebase Authentication (Email/Password + API Key for B2B)
- **Hosting**: Firebase Hosting
- **Email**: Nodemailer via Firebase Functions
- **PDF**: PDFKit for voucher generation

---

## INITIAL SETUP INSTRUCTIONS

1. Initialize Next.js 14 project with TypeScript and App Router
2. Install and configure Firebase SDK (v10+)
3. Set up Firebase project with: Firestore, Auth, Storage, Functions
4. Install shadcn/ui and configure Tailwind CSS
5. Create `.env.local` template with all required Firebase config keys
6. Set up path aliases in `tsconfig.json` (`@/*` → `./src/*`)
7. Configure ESLint and Prettier

---

## PROJECT STRUCTURE

```
src/
├── app/
│   ├── (wholesaler)/          # Wholesaler dashboard layout
│   │   ├── dashboard/
│   │   ├── tours/
│   │   ├── resellers/
│   │   ├── api-access/
│   │   ├── bookings/
│   │   └── analytics/
│   ├── (reseller)/            # Reseller portal layout
│   │   ├── reseller/
│   │   │   ├── dashboard/
│   │   │   ├── tours/
│   │   │   ├── bookings/
│   │   │   └── profile/
│   ├── (auth)/
│   │   ├── login/
│   │   └── reseller/login/
│   └── api/                   # Next.js API routes (proxy to Firebase Functions)
├── components/
│   ├── ui/                    # shadcn/ui components
│   ├── wholesaler/            # Wholesaler-specific components
│   ├── reseller/              # Reseller-specific components
│   └── shared/                # Shared components
├── lib/
│   ├── firebase/              # Firebase config & helpers
│   ├── hooks/                 # Custom React hooks
│   ├── utils/                 # Utility functions
│   └── validations/           # Zod schemas
├── types/                     # TypeScript interfaces
functions/
├── src/
│   ├── api/                   # Express REST API
│   │   ├── middleware/        # Auth, rate limit middleware
│   │   └── routes/            # API route handlers
│   ├── triggers/              # Firestore & Auth triggers
│   └── scheduled/             # Cron jobs
firestore.rules
storage.rules
firestore.indexes.json
```

---

## FIRESTORE DATA MODELS

### TypeScript Interfaces (create in `src/types/index.ts`)

```typescript
export interface Tour {
  id: string;
  name: string;
  description: string;
  destination: string;
  country: string;
  category: string[];
  duration: { days: number; nights: number };
  languages: string[];
  images: string[];
  basePrice: number;
  publishedPrice: number;
  currency: string;
  inclusions: string[];
  exclusions: string[];
  itinerary: ItineraryDay[];
  availability: AvailabilitySlot[];
  minPax: number;
  maxPax: number;
  cancellationPolicy: string;
  status: 'draft' | 'active' | 'archived';
  visibleTo: 'all' | string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ItineraryDay {
  day: number;
  title: string;
  description: string;
  meals: string[];
}

export interface AvailabilitySlot {
  date: string; // YYYY-MM-DD
  slots: number;
  bookedSlots: number;
  status: 'available' | 'limited' | 'soldout' | 'closed';
}

export interface Reseller {
  id: string;
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  country: string;
  commissionRate: number;
  pricingTier: 'standard' | 'premium' | 'vip';
  status: 'active' | 'suspended' | 'pending';
  assignedTours: 'all' | string[];
  bookingCount: number;
  totalRevenue: number;
  uid: string;
  createdAt: Timestamp;
}

export interface ApiKey {
  id: string;
  keyName: string;
  hashedKey: string;
  permissions: ('read_tours' | 'check_availability' | 'create_booking')[];
  pricingTier: 'standard' | 'premium' | 'vip';
  assignedTours: 'all' | string[];
  rateLimit: number;
  status: 'active' | 'revoked';
  lastUsed: Timestamp | null;
  totalRequests: number;
  createdAt: Timestamp;
  createdBy: string;
}

export interface Booking {
  id: string;
  tourId: string;
  tourName: string;
  travelDate: string;
  pax: { adults: number; children: number; infants: number };
  leadPassenger: {
    name: string;
    email: string;
    phone: string;
    nationality: string;
  };
  passengers: { name: string; dob: string; passportNo: string }[];
  channel: 'reseller' | 'api';
  resellerId: string | null;
  apiKeyId: string | null;
  pricing: {
    basePrice: number;
    sellingPrice: number;
    commission: number;
    total: number;
    currency: string;
  };
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  paymentStatus: 'unpaid' | 'partial' | 'paid';
  specialRequests: string;
  voucherUrl: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PricingTier {
  id: string;
  name: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  description: string;
}
```

---

## FIREBASE SECURITY RULES

### `firestore.rules`
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isWholesaler() {
      return request.auth != null && request.auth.token.role == 'wholesaler';
    }

    function isReseller() {
      return request.auth != null && request.auth.token.role == 'reseller';
    }

    function getResellerId() {
      return request.auth.token.resellerId;
    }

    // Tours
    match /tours/{tourId} {
      allow read: if isWholesaler() ||
        (isReseller() && (
          resource.data.visibleTo == 'all' ||
          getResellerId() in resource.data.visibleTo
        ));
      allow write: if isWholesaler();
    }

    // Resellers
    match /resellers/{resellerId} {
      allow read, write: if isWholesaler();
      allow read: if isReseller() && request.auth.uid == resource.data.uid;
    }

    // API Keys — wholesaler only, never exposed to client directly
    match /apiKeys/{keyId} {
      allow read, write: if isWholesaler();
    }

    // Bookings
    match /bookings/{bookingId} {
      allow read, write: if isWholesaler();
      allow read, create: if isReseller() &&
        request.auth.token.resellerId == resource.data.resellerId;
    }

    // Pricing Tiers
    match /pricingTiers/{tierId} {
      allow read: if request.auth != null;
      allow write: if isWholesaler();
    }
  }
}
```

---

## WHOLESALER DASHBOARD — PAGES TO BUILD

### `/dashboard`
- KPI cards: Total Tours, Active Resellers, API Consumers, Today's Bookings, Monthly Revenue
- Line chart: Booking trend (last 30 days) using Recharts
- Pie chart: Channel breakdown (Reseller vs API)
- Recent bookings table with status badges

### `/tours`
- Data table with: thumbnail, name, destination, base price, status badge, booking count
- Filters: search by name, filter by destination/category/status
- Bulk actions: publish, archive
- FAB button: Add New Tour

### `/tours/new` and `/tours/[id]/edit`
Build as a multi-step form with progress indicator:
- **Step 1 — Basic Info**: name, description, destination, country, category (multi-select), duration, languages, min/max pax, cancellation policy
- **Step 2 — Pricing**: base price, published price, currency selector
- **Step 3 — Itinerary**: drag-and-drop day builder (react-beautiful-dnd), each day has title + description + meals
- **Step 4 — Availability**: calendar UI to add date ranges with slot count; toggle open/close per date
- **Step 5 — Images**: drag-and-drop upload to Firebase Storage, reorder images, set cover image
- **Step 6 — Distribution**: toggle "All Resellers" or select specific resellers from a list
- **Step 7 — Review & Publish**: summary of all inputs, Publish / Save as Draft buttons

### `/resellers`
- Table: company name, contact, commission rate, pricing tier, status, booking count
- Button: Invite Reseller (modal with email input → sends Firebase Auth invite link)
- Actions per row: Edit, Suspend/Activate, View Bookings, Set Commission

### `/resellers/[id]`
- Profile card with editable fields
- Commission rate & pricing tier selector
- Tour assignment panel (assign/unassign tours)
- Booking history table filtered by this reseller
- Revenue & commission summary cards

### `/api-access`
- List of API keys: name, status badge, permissions, rate limit, last used, total requests
- Button: Generate New API Key
  - Modal fields: key name, permissions checkboxes, pricing tier, tour assignment, rate limit (req/hour)
  - On generate: show raw key ONCE in a copy modal with warning
- Per key actions: Revoke, Edit permissions, View usage stats
- Usage chart per key (requests over time)

### `/bookings`
- Full bookings table across all channels
- Filters: channel, status, payment status, date range, reseller name
- Export to CSV button
- Click row → booking detail modal/page
- Manual status override (wholesaler can update status & payment status)

### `/analytics`
- Revenue by channel bar chart
- Top 10 tours by booking count
- Top 5 resellers by revenue
- Monthly revenue trend
- Date range picker for all charts

---

## RESELLER PORTAL — PAGES TO BUILD

### `/reseller/login`
- Branded login page (logo placeholder, company name)
- Email + password form
- Forgot password link
- Redirect to `/reseller/dashboard` after login

### `/reseller/dashboard`
- Welcome message: "Welcome back, [Company Name]"
- Summary cards: Available Tours, My Bookings This Month, Commission Earned
- Recent bookings mini table

### `/reseller/tours`
- Grid view (card layout) of assigned tours
- Each card: cover image, tour name, destination, duration, **NET PRICE** (prominently shown)
- Search bar, filter by destination/category
- Availability status indicator per card

### `/reseller/tours/[id]`
- Full tour details page
- NET price banner at top
- Image gallery
- Itinerary accordion
- Inclusions/Exclusions lists
- Availability calendar (read-only, color-coded)
- Book Now CTA button

### `/reseller/bookings/new`
Multi-step booking wizard:
- **Step 1**: Select tour + travel date (from available dates) + pax count
- **Step 2**: Lead passenger: name, email, phone, nationality
- **Step 3**: All passengers: name, DOB, passport number per pax
- **Step 4**: Special requests textarea
- **Step 5**: Pricing summary → Confirm Booking button

### `/reseller/bookings`
- Bookings table: booking ID, tour name, travel date, pax, status, payment status
- Filter by status, date range
- Download voucher button (when status = confirmed)

### `/reseller/profile`
- Company info display
- Commission rate & pricing tier (read-only)
- Change password form

---

## REST API — FIREBASE FUNCTIONS

### Setup Express app in `functions/src/api/index.ts`

```typescript
import express from 'express';
import cors from 'cors';
import { validateApiKey } from './middleware/auth';
import { rateLimiter } from './middleware/rateLimiter';
import toursRouter from './routes/tours';
import bookingsRouter from './routes/bookings';
import metaRouter from './routes/meta';

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());
app.use(validateApiKey);   // All routes require valid API key
app.use(rateLimiter);      // Rate limit per API key

app.use('/tours', toursRouter);
app.use('/bookings', bookingsRouter);
app.use('/destinations', metaRouter);

export default app;
```

### API Endpoints to implement:

```
GET    /v1/tours
       Query: destination, category, date_from, date_to, pax, currency, page, limit
       Response: { data: Tour[], pagination: {...} }

GET    /v1/tours/:tourId
       Response: Tour (full detail)

GET    /v1/tours/:tourId/availability
       Query: month (YYYY-MM), pax
       Response: { dates: AvailabilitySlot[] }

POST   /v1/bookings
       Body: { tourId, travelDate, pax, leadPassenger, passengers, specialRequests }
       Response: { bookingId, status, totalPrice, currency, paymentDeadline }

GET    /v1/bookings/:bookingId
       Response: Booking (full detail)

DELETE /v1/bookings/:bookingId
       Response: { cancelled: true, refundPolicy: string }

GET    /v1/destinations
       Response: { destinations: { name, country, tourCount }[] }

GET    /v1/categories
       Response: { categories: string[] }
```

### API Key Middleware (`functions/src/api/middleware/auth.ts`)
- Read `x-api-key` from request header
- Hash the key with SHA-256 and look up in Firestore `/apiKeys`
- Validate: exists, status = 'active', has required permission for this route
- Attach `apiKeyDoc` to `req` object for downstream use
- Return 401 if missing, 403 if unauthorized

### Rate Limiter Middleware (`functions/src/api/middleware/rateLimiter.ts`)
- Use Firestore document `/rateLimits/{apiKeyId}` with counters
- Track `requestsThisHour` and `windowStart` timestamp
- Reset counter when window expires
- Return 429 with `Retry-After` header if limit exceeded

---

## FIREBASE FUNCTIONS — TRIGGERS & SCHEDULED

### Auth Trigger: `onUserCreate`
- When new user created via invite flow, set custom claims: `{ role: 'reseller', resellerId: 'xxx' }`
- Wholesaler account: `{ role: 'wholesaler' }`

### Firestore Trigger: `onBookingCreate`
- Decrement `availability[date].slots` and increment `bookedSlots` in the tour document
- Update slot status: available → limited (< 20% left) → soldout (0 left)
- Send confirmation email to lead passenger
- Send notification email to reseller

### Firestore Trigger: `onBookingStatusChange`
- If status → 'cancelled': restore availability slots, trigger refund logic
- If status → 'confirmed': generate PDF voucher, upload to Storage, update `voucherUrl`

### Scheduled: `dailyAvailabilityCleanup` (runs at midnight)
- Find all availability slots with date < today, set status to 'closed'

### Scheduled: `bookingReminders` (runs at 9 AM daily)
- Find bookings with travelDate = today + 7 days → send reminder email
- Find bookings with travelDate = today + 1 day → send final reminder email

### Scheduled: `monthlyCommissionReport` (runs 1st of each month)
- Aggregate bookings per reseller for previous month
- Calculate total commission
- Send commission report email to each reseller

---

## SHARED COMPONENTS TO BUILD

### `<TourCard />` — used in reseller tour grid
### `<BookingStatusBadge />` — color-coded status pill
### `<AvailabilityCalendar />` — calendar with color heatmap (green/yellow/red)
### `<PricingTierBadge />` — standard/premium/vip badge
### `<ApiKeyCard />` — shows key name, status, usage bar, actions
### `<StepForm />` — reusable multi-step form wrapper with progress bar
### `<DataTable />` — reusable table with sort, filter, pagination (TanStack Table)
### `<ConfirmDialog />` — reusable confirmation modal for destructive actions
### `<CopyButton />` — one-click copy with success feedback
### `<EmptyState />` — empty state with icon, title, description, CTA

---

## CUSTOM HOOKS TO BUILD

```typescript
useAuth()           // Current user, role, loading state
useTours()          // Fetch tours with filters (Firestore real-time)
useTour(id)         // Single tour detail
useResellers()      // Fetch all resellers
useBookings()       // Fetch bookings with filters
useApiKeys()        // Fetch API keys for wholesaler
useNetPrice(tour)   // Calculate reseller NET price based on their commission
useAvailability()   // Check availability for a date + pax
```

---

## PRICING CALCULATION LOGIC

```typescript
// In src/lib/utils/pricing.ts

export function calculateNetPrice(
  publishedPrice: number,
  commissionRate: number,    // e.g. 15 for 15%
  pricingTier: PricingTier
): number {
  const commissionDiscount = publishedPrice * (commissionRate / 100);
  let tierDiscount = 0;

  if (pricingTier.discountType === 'percentage') {
    tierDiscount = publishedPrice * (pricingTier.discountValue / 100);
  } else {
    tierDiscount = pricingTier.discountValue;
  }

  return publishedPrice - commissionDiscount - tierDiscount;
}

export function calculateBookingTotal(
  netPrice: number,
  pax: { adults: number; children: number; infants: number }
): number {
  // Apply your pax pricing logic here
  return netPrice * (pax.adults + pax.children * 0.7 + pax.infants * 0);
}
```

---

## API KEY GENERATION LOGIC

```typescript
// In functions/src/utils/apiKey.ts
import * as crypto from 'crypto';

export function generateApiKey(): { raw: string; hashed: string } {
  const raw = 'twis_' + crypto.randomBytes(32).toString('hex'); // prefix for identification
  const hashed = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hashed };
}

// Store only `hashed` in Firestore
// Show `raw` to user exactly once, then discard
```

---

## ENVIRONMENT VARIABLES

Create `.env.local` with:
```
# Firebase Client SDK
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=

# Firebase Admin (for Functions)
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=

# App Config
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_API_BASE_URL=https://[project-id].cloudfunctions.net/api/v1

# Email (Nodemailer via Gmail or SMTP)
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=
```

---

## UI/UX REQUIREMENTS

- **Color scheme**: Professional — dark sidebar, white content area, accent color teal/blue
- **Responsive**: Mobile-first for reseller portal; desktop-first for wholesaler dashboard
- **Dark mode**: Implement via `next-themes`
- **Loading states**: Use skeleton loaders (shadcn Skeleton) for all data fetching
- **Toast notifications**: Use shadcn Sonner for all CRUD success/error feedback
- **Confirmation dialogs**: Always confirm before delete/revoke/suspend actions
- **Empty states**: Every list/table must have a designed empty state with CTA
- **Error boundaries**: Wrap pages with error boundary, show retry button

---

## DEVELOPMENT ORDER (RECOMMENDED)

1. **Project setup**: Next.js + Firebase + shadcn/ui
2. **Auth system**: Firebase Auth + custom claims + login pages
3. **Firestore helpers**: CRUD utilities for all collections
4. **TypeScript types**: All interfaces in `src/types/`
5. **Tour management**: CRUD for tours (wholesaler side)
6. **Reseller management**: Invite flow, commission, assignment
7. **Reseller portal**: Login → browse tours → pricing → booking wizard
8. **Booking system**: Create, confirm, cancel + availability update triggers
9. **API Key system**: Generate, validate, rate limit middleware
10. **REST API**: All endpoints with auth + rate limit
11. **Firebase Functions triggers**: Email, availability, voucher PDF
12. **Scheduled functions**: Cleanup, reminders, commission reports
13. **Analytics dashboard**: Charts, KPIs, exports
14. **Polish**: Dark mode, loading states, empty states, error handling

---

## NOTES FOR CLAUDE CODE

- Always use **TypeScript strict mode**
- Use **Zod** for all form validation and API input validation
- Use **TanStack Query** (React Query) for all data fetching and caching
- Use **TanStack Table** for all data tables
- Use **react-hook-form** with Zod resolver for all forms
- Implement **optimistic updates** for booking status changes
- All Firestore queries must respect **security rules** — never fetch data the user shouldn't see
- API endpoints must always return consistent response shape: `{ success: boolean, data?: any, error?: string }`
- Generate **OpenAPI/Swagger spec** for the REST API at `/v1/docs`
