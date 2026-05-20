# Comparative Rideshares

Compare ride prices, wait times, trends, alerts, and recommendations across Uber, Lyft, Taxi, and Waymo in the Bay Area.

![Landing Page](landing-page.png)

## Prerequisites

- Node.js **20.x** (enforced via `engines` in `package.json`; CI and Vercel must
  pin Node 20)
- npm

## Getting Started

1. **Clone the repository**

   ```bash
   git clone https://github.com/your-username/rideshareappnew.git
   cd rideshareappnew
   ```

2. **Install dependencies**

   ```bash
   npm install
   # or
   yarn install
   ```

3. **Run the development server**

   ```bash
   npm run dev
   # or
   yarn dev
   ```

4. **Open in browser**
   ```
   http://localhost:3000
   ```

## Environment Variables

Create a `.env.local` file in the project root. See `ENV_EXAMPLE.md` for all required variables.

**Minimum required:**

```bash
# Database (PostgreSQL)
# For Vercel/serverless: Use pooled connection for DATABASE_URL
# and unpooled connection for DIRECT_URL (migrations)
DATABASE_URL="postgresql://user:YOUR_PASSWORD@localhost:5432/rideshareappnew?schema=public"
DIRECT_URL="postgresql://user:YOUR_PASSWORD@localhost:5432/rideshareappnew?schema=public"

# NextAuth.js
AUTH_SECRET="your-auth-secret-key-generate-with-openssl-rand-base64-32"
```

> **Note:** For production (Vercel/Neon), see `ENV_EXAMPLE.md` for Neon connection string format and additional optional variables.

For Docker, create a `.env` file with:

```
POSTGRES_USER=rideshare
POSTGRES_PASSWORD=your_secure_password_here
POSTGRES_DB=rideshareappnew
```

**Important:** Never commit `.env` or `.env.local` files to Git. They are already in `.gitignore`.

## Running with Docker

### Build and run (production)

```bash
docker compose up --build -d
```

The app will be available at `http://localhost:3000`.

To run the database only (useful during development):

```bash
docker compose up -d db
```

### Prisma & Database Commands

```bash
# apply migrations locally (creates the database schema)
npm run db:migrate

# run migrations in production environments
npm run db:deploy

# regenerate Prisma Client after schema changes
npm run db:generate

# open Prisma Studio data browser
npm run db:studio
```

### Development

To use hot reloading, continue to run `npm run dev` locally outside Docker.

## Features

- **Ride comparison** across Uber, Lyft, Taxi, and Waymo with price, wait time, nearby-driver, surge, and route context
- **Interactive route mapping** with MapLibre GL, OSRM route geometry, airport detection, and popular-route shortcuts
- **Dashboard analytics** for saved routes, ride history, service-specific hourly averages, price trends, surge risk, and savings summaries
- **Price alerts** with per-route targets, alert notifications, and support for all visible ride options
- **Ride history** to track estimated versus final fares, repeat routes, service choices, and user savings over time
- **AI recommendations and insights** for service choice, departure timing, surge forecasts, and recommendation actions
- **Scheduled maintenance and aggregation** through cron routes for cleanup, weather enrichment, and insight aggregation
- **Production-minded API protections** including validation, CORS, request IDs, reCAPTCHA hooks, rate limiting, and structured error logging

## Usage

1. Enter pickup location (e.g., "Santa Clara University")
2. Enter destination (e.g., "San Jose Airport")
3. Compare services with route, surge, price, wait-time, and recommendation context
4. Save routes, set price alerts, or record ride history for later analysis
5. Use the dashboard to review trends, hourly averages, savings, and alerts

## Technologies Used

- Next.js 14, TypeScript, Tailwind CSS
- MapLibre GL (via mapcn), OSRM API
- Prisma ORM, PostgreSQL, Upstash Redis
- NextAuth.js, reCAPTCHA, OpenAI-powered insights
- Vercel deployment

## Generated Artifacts

Prisma generates a local client under `lib/generated/prisma`. That directory is ignored by Git, excluded from linting, and should not be inspected or edited during normal feature work. Regenerate it with `npm run db:generate` after schema changes.

## Testing

```bash
npm test
```
