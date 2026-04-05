#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${API_BASE_URL:-http://localhost:3001}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

request() {
  local method="$1"
  local path="$2"
  local body="${3-}"
  local response_file="$TMP_DIR/response.json"
  local status_code

  if [[ -n "$body" ]]; then
    status_code="$(
      curl -sS -o "$response_file" -w "%{http_code}" \
        -X "$method" \
        -H "Accept: application/json" \
        -H "Content-Type: application/json" \
        -d "$body" \
        "${BASE_URL}${path}"
    )"
  else
    status_code="$(
      curl -sS -o "$response_file" -w "%{http_code}" \
        -X "$method" \
        -H "Accept: application/json" \
        "${BASE_URL}${path}"
    )"
  fi

  if [[ "$status_code" -lt 200 || "$status_code" -ge 300 ]]; then
    echo "HTTP ${status_code} ${method} ${path}" >&2
    cat "$response_file" >&2
    exit 1
  fi

  cat "$response_file"
}

request_allow_error() {
  local method="$1"
  local path="$2"
  local body="${3-}"
  local response_file="$TMP_DIR/response-error.json"
  local status_code

  if [[ -n "$body" ]]; then
    status_code="$(
      curl -sS -o "$response_file" -w "%{http_code}" \
        -X "$method" \
        -H "Accept: application/json" \
        -H "Content-Type: application/json" \
        -d "$body" \
        "${BASE_URL}${path}"
    )"
  else
    status_code="$(
      curl -sS -o "$response_file" -w "%{http_code}" \
        -X "$method" \
        -H "Accept: application/json" \
        "${BASE_URL}${path}"
    )"
  fi

  STATUS_CODE="$status_code" RESPONSE_FILE="$response_file" node <<'NODE'
const fs = require('node:fs');

const status = Number(process.env.STATUS_CODE);
const rawBody = fs.readFileSync(process.env.RESPONSE_FILE, 'utf8');
let body;

try {
  body = rawBody ? JSON.parse(rawBody) : null;
} catch {
  body = rawBody;
}

process.stdout.write(JSON.stringify({ status, body }));
NODE
}

read_json_field() {
  local expression="$1"
  node -e "let raw=''; process.stdin.on('data', chunk => raw += chunk); process.stdin.on('end', () => { const data = JSON.parse(raw); const result = (() => ${expression})(); process.stdout.write(typeof result === 'string' ? result : JSON.stringify(result)); });"
}

DEPARTURE_TIME="$(node -e "console.log(new Date(Date.now() + 30 * 60 * 1000).toISOString())")"

CREATE_PAYLOAD="$(cat <<JSON
{"userId":4,"routeTitle":"Tempe Loop Carpool","routeSummary":"Driver heading across campus with room for one rider.","originLabel":"ASU Memorial Union","destinationLabel":"Tempe Marketplace","distanceMeters":4200,"durationSeconds":900,"co2Kg":0.81,"availableSeats":1,"departureTime":"${DEPARTURE_TIME}","pickupFlexibilityMinutes":15,"matchingRadiusMeters":1800,"maxDeviationMinutes":12,"pricePerMileUsd":0.55,"recurrencePattern":"none","pathPoints":[{"latitude":33.4175,"longitude":-111.9343},{"latitude":33.4259,"longitude":-111.8997}],"metadata":{"badges":["Driver view","Hackathon demo"],"summary":"Driver heading across campus with room for one rider."}}
JSON
)"

CREATED_JSON="$(request POST /api/carpools "$CREATE_PAYLOAD")"
TRIP_ID="$(printf '%s' "$CREATED_JSON" | read_json_field 'data.id')"

SECOND_HOST_ERROR="$(request_allow_error POST /api/carpools "$CREATE_PAYLOAD")"

SEARCH_JSON="$(request GET "/api/carpools/search?userId=2&originLat=33.4176&originLng=-111.9340&destinationLat=33.4257&destinationLng=-111.9001&desiredDepartureTime=${DEPARTURE_TIME}&windowMinutes=45&routeDistanceMeters=4100")"
MATCH_ID="$(
  TRIP_ID="$TRIP_ID" printf '%s' "$SEARCH_JSON" | node -e "let raw=''; process.stdin.on('data', chunk => raw += chunk); process.stdin.on('end', () => { const data = JSON.parse(raw); const tripId = Number(process.env.TRIP_ID); const matchId = data.matches.find((item) => item.id === tripId)?.id ?? data.matches[0]?.id ?? ''; process.stdout.write(String(matchId)); });"
)"

if [[ -z "$MATCH_ID" ]]; then
  echo "Created carpool did not appear in search results." >&2
  exit 1
fi

REQUEST_PAYLOAD="$(cat <<JSON
{"userId":2,"originLabel":"ASU Memorial Union","destinationLabel":"Tempe Marketplace","pickupPoint":{"latitude":33.4176,"longitude":-111.9340},"dropoffPoint":{"latitude":33.4257,"longitude":-111.9001},"desiredDepartureTime":"${DEPARTURE_TIME}","estimatedDistanceMeters":4100,"windowMinutes":45}
JSON
)"

REQUEST_JSON="$(request POST "/api/carpools/${MATCH_ID}/requests" "$REQUEST_PAYLOAD")"
REQUEST_ID="$(printf '%s' "$REQUEST_JSON" | read_json_field 'data.id')"

RIDER_HOST_PAYLOAD="$(cat <<JSON
{"userId":2,"routeTitle":"Rider should fail","routeSummary":"Should be rejected.","originLabel":"ASU Memorial Union","destinationLabel":"Tempe Marketplace","distanceMeters":4200,"durationSeconds":900,"co2Kg":0.81,"availableSeats":1,"departureTime":"${DEPARTURE_TIME}","pickupFlexibilityMinutes":15,"matchingRadiusMeters":1800,"maxDeviationMinutes":12,"pricePerMileUsd":0.55,"recurrencePattern":"none","pathPoints":[{"latitude":33.4175,"longitude":-111.9343},{"latitude":33.4259,"longitude":-111.8997}],"metadata":{"badges":["Driver view"],"summary":"Should be rejected."}}
JSON
)"
RIDER_CANNOT_HOST_ERROR="$(request_allow_error POST /api/carpools "$RIDER_HOST_PAYLOAD")"

DRIVER_BEFORE_ACCEPT_JSON="$(request GET "/api/carpools/my?userId=4")"
ACCEPTED_JSON="$(request POST "/api/carpools/${MATCH_ID}/requests/${REQUEST_ID}/accept" '{"userId":4}')"
RIDER_AFTER_ACCEPT_JSON="$(request GET "/api/carpools/my?userId=2")"
STARTED_JSON="$(request POST "/api/carpools/${MATCH_ID}/start" '{"userId":4}')"
PICKUP_LIVE_JSON="$(request POST "/api/carpools/${MATCH_ID}/live-status" "{\"userId\":4,\"stage\":\"rider_onboard\",\"activeRequestId\":${REQUEST_ID},\"note\":\"Rider picked up for demo verification.\"}")"
FINAL_LEG_LIVE_JSON="$(request POST "/api/carpools/${MATCH_ID}/live-status" '{"userId":4,"stage":"driver_to_destination","note":"Rider dropped off and driver is finishing route."}')"
COMPLETED_JSON="$(request POST "/api/carpools/${MATCH_ID}/complete" '{"userId":4}')"
DRIVER_DASHBOARD_JSON="$(request GET "/api/dashboard?userId=4")"
RIDER_DASHBOARD_JSON="$(request GET "/api/dashboard?userId=2")"

export CREATED_JSON SECOND_HOST_ERROR SEARCH_JSON REQUEST_JSON DRIVER_BEFORE_ACCEPT_JSON ACCEPTED_JSON RIDER_AFTER_ACCEPT_JSON STARTED_JSON PICKUP_LIVE_JSON FINAL_LEG_LIVE_JSON COMPLETED_JSON DRIVER_DASHBOARD_JSON RIDER_DASHBOARD_JSON RIDER_CANNOT_HOST_ERROR TRIP_ID MATCH_ID REQUEST_ID

node <<'NODE'
const created = JSON.parse(process.env.CREATED_JSON);
const secondHostError = JSON.parse(process.env.SECOND_HOST_ERROR);
const search = JSON.parse(process.env.SEARCH_JSON);
const requestRecord = JSON.parse(process.env.REQUEST_JSON);
const driverBeforeAccept = JSON.parse(process.env.DRIVER_BEFORE_ACCEPT_JSON);
const accepted = JSON.parse(process.env.ACCEPTED_JSON);
const riderAfterAccept = JSON.parse(process.env.RIDER_AFTER_ACCEPT_JSON);
const started = JSON.parse(process.env.STARTED_JSON);
const pickupLive = JSON.parse(process.env.PICKUP_LIVE_JSON);
const finalLegLive = JSON.parse(process.env.FINAL_LEG_LIVE_JSON);
const completed = JSON.parse(process.env.COMPLETED_JSON);
const driverDashboard = JSON.parse(process.env.DRIVER_DASHBOARD_JSON);
const riderDashboard = JSON.parse(process.env.RIDER_DASHBOARD_JSON);
const riderCannotHostError = JSON.parse(process.env.RIDER_CANNOT_HOST_ERROR);
const tripId = Number(process.env.TRIP_ID);
const matchId = Number(process.env.MATCH_ID);

console.log(JSON.stringify({
  created: {
    tripId: created.id,
    status: created.status,
    liveStage: created.liveStatus?.stage ?? null,
    availableSeats: created.availableSeats,
  },
  protections: {
    secondHostError,
    riderCannotHostError,
  },
  search: {
    totalMatches: search.matches.length,
    matchedTripId: matchId,
    driverName: search.matches.find((item) => item.id === matchId)?.driverName ?? null,
  },
  request: {
    requestId: requestRecord.id,
    status: requestRecord.status,
    driverPendingCountBeforeAccept:
      driverBeforeAccept.find((trip) => trip.id === tripId)?.pendingRequestCount ?? null,
  },
  accept: {
    tripStatus: accepted.status,
    liveStage: accepted.liveStatus?.stage ?? null,
    acceptedRiders: accepted.acceptedRiders,
    availableSeats: accepted.availableSeats,
  },
  riderAfterAccept: {
    currentRequestStatus:
      riderAfterAccept.find((trip) => trip.id === tripId)?.currentUserRequest?.status ?? null,
    liveStage:
      riderAfterAccept.find((trip) => trip.id === tripId)?.liveStatus?.stage ?? null,
  },
  start: {
    tripStatus: started.status,
    liveStage: started.liveStatus?.stage ?? null,
  },
  pickupLive: {
    liveStage: pickupLive.liveStatus?.stage ?? null,
    activeRiderName: pickupLive.liveStatus?.activeRiderName ?? null,
  },
  finalLegLive: {
    liveStage: finalLegLive.liveStatus?.stage ?? null,
    activeRiderName: finalLegLive.liveStatus?.activeRiderName ?? null,
  },
  complete: {
    tripStatus: completed.status,
    liveStage: completed.liveStatus?.stage ?? null,
    participantCount: completed.participantCount,
    co2SavedKg: completed.co2SavedKg,
  },
  dashboard: {
    driverActiveTrips: driverDashboard.carpools.summary.activeTrips,
    riderActiveTrips: riderDashboard.carpools.summary.activeTrips,
    driverCompletedTrips: driverDashboard.carpools.summary.completedTrips,
    riderCompletedTrips: riderDashboard.carpools.summary.completedTrips,
  },
}, null, 2));
NODE
