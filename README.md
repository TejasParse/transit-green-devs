# Transit Green

Transit Green is a mobile-first sustainability app that helps users choose lower-emission travel and share rides through live carpool coordination.

## What We Built

We built an Expo React Native app backed by Express + PostgreSQL with three core experiences:

- route comparison (walk, bike, transit, drive, and carpool)
- live carpool marketplace (offer seats, request seats, accept/reject riders)
- trip simulation and impact tracking (ETA/CO2/leaderboard/profile progress)

The product is designed for demo use with seeded profiles so two devices can act as host and rider during a shared-trip simulation.

## Why We Built It

Daily commute decisions are usually optimized for speed, not sustainability.
Transit Green makes the lower-carbon option visible at decision time and adds a practical carpool flow so fewer single-occupancy car trips are needed.

## Key Features

### 1) Route Comparison on Map

- source/destination search with Google Places
- route generation with Google Routes
- side-by-side options with estimated distance, duration, and CO2 impact
- map visualization for each option

### 2) Carpool Lifecycle

- discover nearby live/scheduled carpools near user route
- create a hosted carpool with:
  - available seats
  - departure time
  - price per mile
  - max deviation window / matching radius
  - recurrence options (none/daily/weekdays)
- send seat requests as rider
- accept/reject/cancel requests as host
- auto-adjust shared route metadata when rider joins

### 3) Live Shared-Ride Simulation

- host starts simulation for active carpool
- driver live-stage updates are published (`driver_to_pickup`, `rider_onboard`, `driver_to_destination`, etc.)
- rider and host both receive synchronized state updates (picked up / dropped off)
- trip completion persists records for history and leaderboard impact

### 4) Profile + Leaderboard + Dashboard

- per-user trip and carpool history
- impact multiplier and rider-helped summaries
- global leaderboard based on saved CO2 impact
- forest tree progression endpoint for gamified sustainability actions

## Tech Stack

- Frontend: Expo SDK 54, React Native, Expo Router, react-native-maps
- Backend: Node.js, Express, pg
- Database: PostgreSQL 15
- External APIs: Google Places API, Google Routes API

## Repo Structure

```text
transit-green-devs/
|-- client-mobile/   # Expo app
|   |-- app/         # screens and tabs
|   |-- context/     # user + carpool notification state
|   |-- lib/         # API clients and routing helpers
|   `-- types/       # shared TS types
|-- server/          # Express API
|   |-- controllers/
|   |-- db/
|   |-- routes/
|   `-- validators/
`-- README.md
```

## API Highlights

- `GET /health`
- `GET /api/trips`
- `POST /api/trips`
- `GET /api/leaderboard`
- `GET /api/dashboard`
- `POST /api/forest/trees`
- `GET /api/carpools/search`
- `GET /api/carpools/my`
- `POST /api/carpools`
- `PATCH /api/carpools/:tripId`
- `POST /api/carpools/:tripId/requests`
- `POST /api/carpools/:tripId/requests/:requestId/accept`
- `POST /api/carpools/:tripId/requests/:requestId/reject`
- `POST /api/carpools/:tripId/requests/:requestId/cancel`
- `POST /api/carpools/:tripId/start`
- `POST /api/carpools/:tripId/live-status`
- `POST /api/carpools/:tripId/complete`
- `POST /api/carpools/:tripId/cancel`

## Local Setup

### Prerequisites

- Node.js 18+
- npm
- Docker Desktop (for local Postgres)

### 1) Install dependencies

```bash
cd client-mobile && npm install
cd ../server && npm install
```

### 2) Configure environment

Create env files from examples:

- `client-mobile/.env`
- `server/.env`

Minimum values:

```env
# client-mobile/.env
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=your_google_maps_key
EXPO_PUBLIC_API_BASE_URL=http://localhost:3001
```

```env
# server/.env
PORT=3001
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/innovationhacks
```

### 3) Start database

```bash
cd server
docker compose up -d
```

Optional clean reset:

```bash
npm run db:reset
```

### 4) Run backend

```bash
cd server
npm run start
```

### 5) Run mobile app

```bash
cd client-mobile
npm start
```

## Demo Guide (2 Devices)

1. Open app on two devices/emulators.
2. On Device A, switch/login to a driver profile (for example `Community Driver`) and publish a carpool.
3. On Device B, switch/login to a rider profile and request a seat.
4. Accept on Device A.
5. Start simulation on Device A.
6. Verify both devices reflect shared ride stage updates through pickup and dropoff.

## Current Scope / Limitations

- trip movement is simulated (not live GPS navigation)
- optimized for demo clarity over production hardening
