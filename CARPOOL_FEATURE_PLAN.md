# Carpool Feature Plan

## Current State

The app already supports basic route planning and trip persistence:

- The client has route planning and navigation in [client-mobile/app/(tabs)/index.tsx](/Users/tejas/Coding/InnovationHacks/client-mobile/app/(tabs)/index.tsx).
- The server persists trips and leaderboard data through [server/db/trip-queries.js](/Users/tejas/Coding/InnovationHacks/server/db/trip-queries.js).
- The current schema already includes `profiles`, `cars`, `trips`, and `trip_users` in [server/db/schema.js](/Users/tejas/Coding/InnovationHacks/server/db/schema.js).

Right now the system is still mostly solo-trip-centric. `trip_users` exists, but it is only a lightweight join table and does not yet support the full carpool workflow.

## Recommended Product Model

The cleanest V1 is to make carpooling a layer on top of the existing trip flow, but move matching and detour logic to the server.

The current client owns route generation via Google APIs and the server mostly stores finished trips. That works for solo navigation, but not for shared-trip matching and acceptance.

Recommended architectural shift:

- Keep the current map/navigation UX in the client.
- Let the server own:
  - carpool offers
  - rider requests
  - detour calculations
  - acceptance/rejection
  - pooled-route recomputation
  - carbon reduction calculations

This is the most reliable way to support real carpool logic.

## Detour Strategy

For V1, use `max_detour_minutes`, not destination radius.

Reason:

- It matches the product requirement directly.
- It is easier to explain to drivers.
- Google Routes can compute actual detour duration by comparing:
  - base driver route: `driver_origin -> driver_destination`
  - pooled route: `driver_origin -> rider_pickup -> rider_dropoff -> driver_destination`

This lets the app show:

- detour added in minutes
- whether the rider fits inside the driver's remaining detour allowance
- estimated carbon reduction

Recommended carbon formula:

- `incremental_carbon_saved = rider_solo_route_co2 - pooled_route_extra_co2`
- `pooled_route_extra_co2 = pooled_route_co2 - current_driver_route_co2`

That gives the driver a simple message like:

- "Accepting this rider adds 4 minutes and reduces total carbon by 1.8 kg CO2."

## Implementation Plan

1. Refactor trip ownership so the server can represent both solo trips and shared-trip offers.
2. Add carpool offer creation before navigation starts, with support for immediate or scheduled departure.
3. Add rider discovery and request flow based on origin, destination, departure window, and detour tolerance.
4. Add driver acceptance flow that recomputes the route with pickup/dropoff waypoints and returns detour/carbon impact.
5. Update active navigation to follow the pooled route instead of the original solo route.
6. Persist final rider/driver outcomes and surface them in trip history and leaderboard views.

## Schema Changes

The current schema is not enough for a full carpool flow. `trips` is too focused on a single-user trip, and `trip_users` is too thin.

### Changes to `trips`

Keep `trips`, but make it the canonical route session.

Add:

- `trip_mode`
  - values: `solo`, `driver_offer`, `pooled_driver`, `pooled_rider`
- `is_carpool_enabled`
- `scheduled_start_at`
- `actual_start_at`
- `actual_end_at`
- `max_detour_minutes`
- `available_seats`
- `base_distance_meters`
- `base_duration_seconds`
- `current_distance_meters`
- `current_duration_seconds`
- `base_co2_kg`
- `current_co2_kg`
- `origin_place_id`
- `destination_place_id`

Also:

- make `completed_at` nullable for scheduled and active trips
- keep current `path_points`, but treat it as the latest active route shape, not just the original solo path

### Replace or Expand `trip_users`

The current `trip_users` table should become a real rider association table. Conceptually I would rename it to `trip_passengers`.

Recommended fields:

- `trip_id`
- `driver_id`
- `rider_id`
- `status`
  - values: `requested`, `accepted`, `rejected`, `cancelled`, `picked_up`, `dropped_off`
- `pickup_label`
- `dropoff_label`
- `pickup_place_id`
- `dropoff_place_id`
- `pickup_lat`
- `pickup_lng`
- `dropoff_lat`
- `dropoff_lng`
- `detour_minutes_added`
- `incremental_co2_saved_kg`
- `requested_at`
- `accepted_at`
- `picked_up_at`
- `dropped_off_at`

### Optional `carpool_requests` Table

If you want a cleaner workflow separation, add `carpool_requests` instead of overloading the passenger table.

Recommended fields:

- `id`
- `trip_id`
- `rider_id`
- `status`
- `requested_pickup_label`
- `requested_dropoff_label`
- `requested_pickup_place_id`
- `requested_dropoff_place_id`
- `requested_pickup_lat`
- `requested_pickup_lng`
- `requested_dropoff_lat`
- `requested_dropoff_lng`
- `detour_minutes_estimate`
- `incremental_co2_saved_kg`
- `message`
- `created_at`
- `updated_at`

### Add `trip_stops` or `trip_waypoints`

This is the easiest way to update navigation after acceptance without hiding too much logic inside `metadata`.

Recommended fields:

- `trip_id`
- `stop_order`
- `stop_type`
  - values: `driver_origin`, `pickup`, `dropoff`, `driver_destination`
- `label`
- `place_id`
- `latitude`
- `longitude`
- `related_rider_id`
- `eta_seconds`

This table becomes the ordered source of truth for pooled navigation.

## API Changes

Do not force everything into `/api/trips`. Add a dedicated carpool route group.

Recommended endpoints:

- `POST /api/carpool/offers`
  - driver creates an immediate or scheduled poolable trip
- `GET /api/carpool/offers/search`
  - rider searches for matching pooled trips
- `GET /api/carpool/offers/:id`
  - returns route, seats, accepted riders, current detour, and schedule info
- `POST /api/carpool/offers/:id/requests`
  - rider requests pickup/dropoff on a trip
- `GET /api/carpool/offers/:id/requests`
  - driver sees pending requests
- `POST /api/carpool/requests/:id/accept`
  - server recomputes pooled route and persists detour/carbon values
- `POST /api/carpool/requests/:id/reject`
- `PATCH /api/carpool/trips/:id/start`
  - marks scheduled trip as active
- `PATCH /api/carpool/trips/:id/complete`
  - completes trip and finalizes rider states

## Client Changes

The current tabs are:

- `Map`
- `Leaderboard`
- `Profile`

Recommended addition:

- `Pool`

### Changes to `Map` Tab

Before navigation starts:

- add a toggle: `Offer this trip for carpool`
- if enabled, show:
  - `Available seats`
  - `Depart now / schedule later`
  - `Scheduled departure time`
  - `Max detour minutes`

After route selection:

- show either:
  - `Start Solo Trip`
  - `Create Pool Offer`

If rider requests arrive while the driver is waiting or active:

- show a bottom sheet with:
  - rider pickup and dropoff
  - detour minutes added
  - carbon reduction estimate
  - `Accept` / `Reject`

Once a request is accepted:

- replace the current route with the pooled route
- show the next stop as:
  - pickup
  - dropoff
  - final driver destination

### New `Pool` Tab

This should serve both rider search and driver request management.

Rider search form:

- origin
- destination
- desired departure time
- optional pickup flexibility later

Search results should show:

- driver route title
- ETA
- pickup estimate
- detour already committed
- carbon savings estimate

Driver inbox should show:

- incoming requests
- request status
- seats remaining
- current total detour used

## Trip History and Leaderboard

Trip history should distinguish between:

- solo trips
- driver trips with riders
- rider trips

For each pooled trip, show:

- number of riders carried or joined
- added detour
- carbon saved
- pooled route path

Leaderboard logic should also be updated. Decide early whether carbon savings are awarded to:

- driver only
- rider only
- both users

Recommended V1:

- award carbon-saving credit to both users
- store raw values separately so the scoring model can be changed later

## Important Design Choices

- Route matching and detour calculation must be server-side.
- Scheduled trips need nullable actual start/end timestamps.
- The current `trip_users` structure is too thin for production carpool logic.
- `trip_stops` is worth adding early because pooled navigation becomes much easier to reason about.

## Recommended Implementation Order

1. Extend the schema for offers, requests, passengers, and ordered stops.
2. Move pooled route recomputation to the server.
3. Add carpool offer creation on the `Map` tab.
4. Add the `Pool` tab for rider discovery and driver request inbox.
5. Implement accept/reject with detour and carbon impact.
6. Update navigation after acceptance to include pickup/dropoff.
7. Reflect pooled trips in history and leaderboard.

## Best Next Step

The highest-leverage next step is the schema and API redesign.

Without that, the client can show carpool toggles, but the real matching and route-updating logic will not have a stable backend model.
