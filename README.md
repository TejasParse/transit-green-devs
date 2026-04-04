# Transit Green Devs

Transit Green Devs is a mobile-first transit and sustainability demo built with Expo/React Native on the frontend and Express/Postgres on the backend.

The current implementation focuses on low-carbon route comparison with route simulation:
- the rider searches for a start and destination
- the app uses Google Places Autocomplete to suggest addresses
- the app uses the Google Routes API to fetch walking, biking, public transit, and fuel-efficient driving routes
- the route cards are ordered from the lowest estimated carbon footprint upward
- the rider can inspect each route on the map before choosing one
- the rider can start navigation on any returned route
- when the simulation finishes, the trip summary is saved to Postgres
- the leaderboard and profile screens read trip history from the backend

## Tech Stack

### Frontend
- Expo SDK 54
- React Native
- Expo Router
- React Navigation bottom tabs
- `react-native-maps`
- `expo-location`

### Backend
- Node.js
- Express
- `pg`
- PostgreSQL 15 via Docker Compose

### External APIs
- Google Places API Autocomplete
- Google Routes API
- Google Maps SDK configuration for iOS and Android

## Repository Layout

```text
transit-green-devs/
├── client-mobile/         # Expo + React Native mobile app
│   ├── app/               # Expo Router screens and layouts
│   ├── components/        # Shared UI components
│   ├── context/           # App-level state providers
│   ├── lib/               # API clients and Google integration helpers
│   └── types/             # Shared frontend TypeScript types
├── server/                # Express API + Postgres integration
│   ├── config/            # Environment loading
│   ├── controllers/       # Request handlers
│   ├── db/                # Pool, schema bootstrap, and SQL queries
│   ├── middleware/        # Shared Express middleware
│   ├── routes/            # API route registration
│   ├── validators/        # Payload parsing and validation
│   ├── app.js             # Express app composition
│   ├── docker-compose.yml # Local Postgres setup
│   └── index.js           # Server startup entry point
├── co2.csv                # Project data asset
└── .env                   # Shared environment variables
```

## Frontend Architecture

The frontend is an Expo app inside [`client-mobile`](./client-mobile).

### App Shell and Navigation

The application root is [`client-mobile/app/_layout.tsx`](./client-mobile/app/_layout.tsx).

Responsibilities:
- wraps the app in `UserProvider`
- sets the navigation theme
- mounts the tab navigator

The bottom-tab navigation lives in [`client-mobile/app/(tabs)/_layout.tsx`](./client-mobile/app/(tabs)/_layout.tsx).

The three main tabs are:
- `Map`: [`client-mobile/app/(tabs)/index.tsx`](./client-mobile/app/(tabs)/index.tsx)
- `Leaderboard`: [`client-mobile/app/(tabs)/leaderboard.tsx`](./client-mobile/app/(tabs)/leaderboard.tsx)
- `Profile`: [`client-mobile/app/(tabs)/profile.tsx`](./client-mobile/app/(tabs)/profile.tsx)

### User State

User state is currently lightweight and local to the app. It is managed in [`client-mobile/context/user-context.tsx`](./client-mobile/context/user-context.tsx).

What it stores:
- a fixed `userId` of `campus-rider`
- an editable `displayName`
- a `tripVersion` counter used to trigger refreshes in leaderboard and profile screens after a trip is saved

This means:
- there is no real authentication yet
- the app behaves like a single-user demo with editable profile naming

### Main Map Screen

The main feature screen is [`client-mobile/app/(tabs)/index.tsx`](./client-mobile/app/(tabs)/index.tsx).

This screen handles:
- current location permission and lookup using `expo-location`
- start and destination text input state
- Google Places autocomplete suggestions for both fields
- route request orchestration
- multi-mode route comparison state
- route rendering on `react-native-maps`
- route simulation state
- trip summary modal
- trip persistence to the backend

#### Search Flow

The search flow works like this:

1. The rider opens the map tab.
2. The app requests foreground location permission.
3. If permission is granted, the app defaults the origin to the current location.
4. If the rider types into `From` or `To`, the app calls Google Places Autocomplete through [`client-mobile/lib/google-places.ts`](./client-mobile/lib/google-places.ts).
5. If the rider taps a suggestion, the app stores the selected `placeId`.
6. If the rider does not tap a suggestion, the raw typed address is still used as a fallback.

#### Routing Flow

Route building is handled by [`client-mobile/lib/google-routes.ts`](./client-mobile/lib/google-routes.ts).

Important details:
- the app calls Google `computeRoutes`
- it requests separate `travelMode` results for walking, biking, transit, and driving
- the driving request asks for `requestedReferenceRoutes: ['FUEL_EFFICIENT']`
- the driving request asks for fuel-consumption estimation so car CO2 can be derived
- it prefers `placeId` waypoints when the user selected an autocomplete result
- otherwise it falls back to typed addresses or device coordinates

The frontend converts the Google response into route options that include:
- decoded polyline points for rendering
- start and end coordinates
- duration and distance
- estimated CO2 emitted
- estimated CO2 saved versus the fuel-efficient driving option

Route ordering rules:
- walking is shown first when available
- biking is shown next
- public transit is shown after active travel
- fuel-efficient driving is shown last as the highest-emission option in the current feature set

The carpool option is intentionally removed for now.

#### Simulation Flow

When the rider presses `Start ... navigation` on a route card:

1. The selected route polyline is sampled into a manageable number of points.
2. A timer advances a simulated route marker across those points.
3. The map enters focused navigation mode.
4. Large setup panels are hidden so the map becomes the main view.
5. A compact HUD shows progress, route details, ETA, and emissions.
6. When the simulation reaches the destination, the app opens the trip summary modal.

This is a visual simulation only. It does not use live turn-by-turn navigation or real GPS tracking during the trip.

#### Saving Trips

After the simulation completes, the frontend constructs a `TripPayload` and sends it to the backend using [`client-mobile/lib/api.ts`](./client-mobile/lib/api.ts).

Saved data includes:
- user ID
- display name
- route title and type
- origin and destination labels
- distance
- duration
- CO2 emitted
- CO2 saved
- start and completion timestamps
- route path points

### Leaderboard Screen

The leaderboard screen is [`client-mobile/app/(tabs)/leaderboard.tsx`](./client-mobile/app/(tabs)/leaderboard.tsx).

It calls:
- `GET /api/leaderboard`

It displays:
- total saved CO2 across all stored users
- total trips
- ranked users ordered by CO2 saved

### Profile Screen

The profile screen is [`client-mobile/app/(tabs)/profile.tsx`](./client-mobile/app/(tabs)/profile.tsx).

It supports:
- editing the display name for future trips
- viewing aggregate trip stats
- reading personal trip history from the backend

It calls:
- `GET /api/trips?userId=<id>`

## Backend Architecture

The backend entry point is [`server/index.js`](./server/index.js), but the server is now organized into focused modules.

The main backend layers are:
- [`server/routes`](./server/routes): endpoint registration
- [`server/controllers`](./server/controllers): request/response handlers
- [`server/db`](./server/db): Postgres pool, schema bootstrap, and SQL queries
- [`server/validators`](./server/validators): payload validation and parsing
- [`server/app.js`](./server/app.js): Express middleware and route wiring

### What the Server Does

At startup the server:
- loads `.env` files
- resolves `PORT`
- resolves `DATABASE_URL`
- composes the Express app
- creates a Postgres `Pool`
- ensures the `trips` table exists
- creates an index for trip lookup performance

Request flow:
1. A route in [`server/routes`](./server/routes) receives the request.
2. The matching controller in [`server/controllers`](./server/controllers) validates inputs and coordinates the work.
3. Database helpers in [`server/db/trip-queries.js`](./server/db/trip-queries.js) execute SQL against Postgres.
4. Shared middleware in [`server/middleware/error-handler.js`](./server/middleware/error-handler.js) formats errors consistently.

### Environment Handling

The server reads:
- `PORT`
- `DATABASE_URL`

If `DATABASE_URL` is missing, it defaults to:

```env
postgresql://postgres:postgres@localhost:5432/innovationhacks
```

This default matches [`server/docker-compose.yml`](./server/docker-compose.yml).

### Database Schema

The backend automatically creates a `trips` table with these important fields:

- `id`
- `user_id`
- `display_name`
- `route_type`
- `route_title`
- `origin_label`
- `destination_label`
- `distance_meters`
- `duration_seconds`
- `co2_kg`
- `co2_saved_kg`
- `started_at`
- `completed_at`
- `path_points` as JSONB
- `metadata` as JSONB
- `created_at`

### API Endpoints

#### `GET /health`

Purpose:
- verifies the server is running
- verifies Postgres is reachable

Response:

```json
{ "status": "ok" }
```

#### `GET /api/trips?userId=<id>`

Purpose:
- returns a single user’s trip history

Used by:
- profile screen

Sort order:
- newest completed trip first

#### `GET /api/leaderboard`

Purpose:
- aggregates trip records by user
- ranks users by total CO2 saved

Used by:
- leaderboard screen

#### `POST /api/trips`

Purpose:
- persists a completed trip

Used by:
- map screen after simulation finishes

### Backend Validation

The backend validates incoming trip payloads before inserting them into Postgres.

Checks include:
- required string fields
- numeric distance/duration/CO2 values
- valid ISO timestamps
- path point structure

This keeps malformed client payloads from being stored.

## Frontend-Backend Interaction

The communication flow is intentionally simple:

1. The frontend computes route data using Google APIs directly.
2. The frontend compares the returned modes locally and renders them on the map.
3. The frontend simulates the selected route locally when the rider starts navigation.
4. The frontend sends the completed trip summary to the backend.
5. The backend stores the trip in Postgres.
6. The leaderboard and profile screens pull aggregated/stored results back from the backend.

Why this split was chosen:
- Google routing and autocomplete are UI-driven and immediate
- Postgres is only used for durable trip history and leaderboard data
- the backend remains small and easy to review

## Environment Variables

These values should exist in the repo root `.env`.

```env
GOOGLE_MAPS_API_KEY=your_google_maps_key
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/innovationhacks
EXPO_PUBLIC_API_BASE_URL=http://localhost:3001
```

### Notes

- `GOOGLE_MAPS_API_KEY` is read by the Expo app config and by Google API helper modules.
- `DATABASE_URL` is used only by the backend.
- `EXPO_PUBLIC_API_BASE_URL` tells the mobile app where the Express API is running.
- If testing on a physical device, replace `localhost` with your computer’s LAN IP.

## Local Development Setup

### 1. Install dependencies

Frontend:

```bash
cd client-mobile
npm install
```

Backend:

```bash
cd server
npm install
```

### 2. Start Postgres

```bash
cd server
docker compose up -d
```

### 3. Start the backend

```bash
cd server
npm run start
```

### 4. Verify backend health

```bash
curl http://localhost:3001/health
```

Expected result:

```json
{"status":"ok"}
```

### 5. Start the mobile app

```bash
cd client-mobile
npm start
```

## Important Files for Code Review

### Frontend
- [`client-mobile/app/(tabs)/index.tsx`](./client-mobile/app/(tabs)/index.tsx): main route comparison and navigation simulation screen
- [`client-mobile/app/(tabs)/leaderboard.tsx`](./client-mobile/app/(tabs)/leaderboard.tsx): leaderboard UI
- [`client-mobile/app/(tabs)/profile.tsx`](./client-mobile/app/(tabs)/profile.tsx): profile and history UI
- [`client-mobile/lib/google-places.ts`](./client-mobile/lib/google-places.ts): Places autocomplete integration
- [`client-mobile/lib/google-routes.ts`](./client-mobile/lib/google-routes.ts): Routes API integration, mode comparison, and CO2 estimation
- [`client-mobile/lib/api.ts`](./client-mobile/lib/api.ts): backend HTTP client
- [`client-mobile/context/user-context.tsx`](./client-mobile/context/user-context.tsx): local user state
- [`client-mobile/app.config.ts`](./client-mobile/app.config.ts): env loading and Google Maps native config

### Backend
- [`server/index.js`](./server/index.js): server startup entry point
- [`server/app.js`](./server/app.js): Express app wiring and shared middleware
- [`server/routes/trip-routes.js`](./server/routes/trip-routes.js): trip and leaderboard endpoints
- [`server/controllers/trips-controller.js`](./server/controllers/trips-controller.js): request handlers for trip APIs
- [`server/db/trip-queries.js`](./server/db/trip-queries.js): SQL queries and row mapping
- [`server/db/schema.js`](./server/db/schema.js): schema bootstrap
- [`server/validators/trip-validator.js`](./server/validators/trip-validator.js): backend payload validation
- [`server/docker-compose.yml`](./server/docker-compose.yml): local Postgres bootstrap

## Current Constraints and Review Notes

- There is no authentication layer yet.
- The user is represented by a fixed demo `userId`.
- The trip is simulated client-side rather than driven by live GPS updates.
- Google API calls are made directly from the mobile client.
- The leaderboard is based on saved trip summaries, not live sessions.
- The database schema is intentionally minimal and optimized for feature demonstration rather than multi-tenant production use.

## Suggested Review Focus Areas

For peer review, the most useful things to inspect are:
- route search and fallback behavior when Google suggestions are not selected
- multi-mode route comparison ordering and unavailable-mode fallback behavior
- error handling around Google API failures
- simulation UX and timer-driven state updates
- trip payload validation between client and server
- assumptions around demo user identity and leaderboard aggregation
- readiness for future auth, real users, and real navigation tracking

## Verification Completed

Recent verification on this codebase included:
- TypeScript check on the mobile app with `npx tsc --noEmit`
- Expo lint with `npm run lint`
- backend startup check with `npm run start`
- API health verification through `/health`

## Future Improvements

- Add authentication and real user accounts
- Persist profile data separately from trip records
- Move Google API calls behind the backend for tighter key control
- Support real trip tracking instead of timer-driven simulation
- Add tests for backend validators and API endpoints
- Add richer analytics from `co2.csv` or other sustainability datasets
