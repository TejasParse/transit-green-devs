import Constants from 'expo-constants';

import { RouteKind, RouteOption, RoutePlan, WaypointInput } from '@/types/trips';

const GOOGLE_ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const SOLO_DRIVE_CO2_PER_KM = 0.192;
const ESTIMATED_TRANSIT_CO2_PER_KM = 0.05;
const GASOLINE_CO2_PER_LITER = 2.31;
const ROUTE_PRIORITY: RouteKind[] = ['walk', 'bike', 'transit', 'drive'];

const ROUTE_COLORS: Record<RouteKind, string> = {
  walk: '#3D9B63',
  bike: '#2B73C6',
  transit: '#C77722',
  drive: '#20744A',
};

type GoogleTravelMode = 'DRIVE' | 'WALK' | 'BICYCLE' | 'TRANSIT';

type GoogleWaypoint = {
  location?: {
    latLng: {
      latitude: number;
      longitude: number;
    };
  };
  placeId?: string;
  address?: string;
};

type GoogleRoute = {
  distanceMeters?: number;
  duration?: string;
  description?: string;
  routeLabels?: string[];
  warnings?: string[];
  polyline?: {
    encodedPolyline?: string;
  };
  travelAdvisory?: {
    fuelConsumptionMicroliters?: string;
  };
  legs?: Array<{
    startLocation?: {
      latLng?: {
        latitude?: number;
        longitude?: number;
      };
    };
    endLocation?: {
      latLng?: {
        latitude?: number;
        longitude?: number;
      };
    };
  }>;
};

type GoogleRoutesResponse = {
  routes?: GoogleRoute[];
};

type BuildRoutePlanParams = {
  origin: WaypointInput;
  destination: WaypointInput;
  originLabel: string;
  destinationLabel: string;
};

type ModeFetchResult = {
  kind: RouteKind;
  routes: GoogleRoute[];
};

type ExpoConstantsShape = {
  expoConfig?: {
    extra?: {
      googleMapsApiKey?: string;
    };
  } | null;
};

function getGoogleMapsApiKey() {
  const constants = Constants as unknown as ExpoConstantsShape;
  const apiKey =
    constants.expoConfig?.extra?.googleMapsApiKey?.trim() ??
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();

  if (!apiKey) {
    throw new Error('Missing Google Maps API key. Add it to client-mobile/.env.');
  }

  return apiKey;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === 'string' ? error : 'Unknown error';
}

function parseGoogleErrorText(errorText: string) {
  if (!errorText) {
    return null;
  }

  try {
    const parsed = JSON.parse(errorText) as {
      error?: {
        message?: string;
        status?: string;
      };
    };
    const status = parsed.error?.status?.trim();
    const message = parsed.error?.message?.trim();

    if (status && message) {
      return `${status}: ${message}`;
    }

    return message || errorText;
  } catch {
    return errorText;
  }
}

function toWaypoint(waypoint: WaypointInput): GoogleWaypoint {
  if (waypoint.type === 'placeId') {
    return { placeId: waypoint.placeId };
  }

  if (waypoint.type === 'address') {
    return { address: waypoint.address };
  }

  return {
    location: {
      latLng: waypoint.coordinates,
    },
  };
}

function parseDurationSeconds(duration: string | undefined) {
  if (!duration) {
    return 0;
  }

  return Math.round(Number(duration.replace('s', '')));
}

function roundTo(value: number, digits = 2) {
  return Number(value.toFixed(digits));
}

function decodePolyline(encodedPolyline: string | undefined) {
  if (!encodedPolyline) {
    return [];
  }

  const points: Array<{ latitude: number; longitude: number }> = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < encodedPolyline.length) {
    let shift = 0;
    let result = 0;
    let byte: number;

    do {
      byte = encodedPolyline.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    latitude += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;

    do {
      byte = encodedPolyline.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    longitude += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({
      latitude: latitude / 1e5,
      longitude: longitude / 1e5,
    });
  }

  return points;
}

function getRouteEndpoints(route: GoogleRoute, polyline: Array<{ latitude: number; longitude: number }>) {
  const firstLeg = route.legs?.[0];
  const startLocation = firstLeg?.startLocation?.latLng;
  const endLocation = firstLeg?.endLocation?.latLng;

  const start =
    startLocation?.latitude != null && startLocation.longitude != null
      ? {
          latitude: startLocation.latitude,
          longitude: startLocation.longitude,
        }
      : polyline[0];

  const end =
    endLocation?.latitude != null && endLocation.longitude != null
      ? {
          latitude: endLocation.latitude,
          longitude: endLocation.longitude,
        }
      : polyline[polyline.length - 1];

  if (!start || !end) {
    throw new Error('Unable to resolve the route coordinates from Google Maps.');
  }

  return { start, end };
}

function estimateDriveCo2Kg(route: GoogleRoute) {
  const fuelMicroliters = Number(route.travelAdvisory?.fuelConsumptionMicroliters ?? 0);

  if (fuelMicroliters > 0) {
    const liters = fuelMicroliters / 1_000_000;
    return roundTo(liters * GASOLINE_CO2_PER_LITER, 3);
  }

  const distanceKm = (route.distanceMeters ?? 0) / 1000;
  return roundTo(distanceKm * SOLO_DRIVE_CO2_PER_KM, 3);
}

function estimateLowCarbonCo2Kg(kind: Exclude<RouteKind, 'drive'>, route: GoogleRoute, driveCo2Kg: number) {
  if (kind === 'walk' || kind === 'bike') {
    return 0;
  }

  const distanceKm = (route.distanceMeters ?? 0) / 1000;
  const estimatedTransitCo2Kg = distanceKm * ESTIMATED_TRANSIT_CO2_PER_KM;
  const cappedTransitCo2Kg = driveCo2Kg > 0 ? Math.min(estimatedTransitCo2Kg, driveCo2Kg * 0.6) : estimatedTransitCo2Kg;

  return roundTo(cappedTransitCo2Kg, 3);
}

function dedupeRoutes(routes: GoogleRoute[]) {
  const seen = new Set<string>();

  return routes.filter((route) => {
    const key = route.polyline?.encodedPolyline ?? `${route.distanceMeters}-${route.duration}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function getTravelMode(kind: RouteKind): GoogleTravelMode {
  switch (kind) {
    case 'walk':
      return 'WALK';
    case 'bike':
      return 'BICYCLE';
    case 'transit':
      return 'TRANSIT';
    case 'drive':
      return 'DRIVE';
  }
}

function buildRouteRequest(kind: RouteKind, origin: WaypointInput, destination: WaypointInput) {
  const requestBody: Record<string, unknown> = {
    origin: toWaypoint(origin),
    destination: toWaypoint(destination),
    travelMode: getTravelMode(kind),
    regionCode: 'US',
    languageCode: 'en-US',
    polylineQuality: 'OVERVIEW',
  };

  if (kind === 'drive') {
    requestBody.computeAlternativeRoutes = true;
    requestBody.routingPreference = 'TRAFFIC_AWARE_OPTIMAL';
    requestBody.requestedReferenceRoutes = ['FUEL_EFFICIENT'];
    requestBody.extraComputations = ['FUEL_CONSUMPTION'];
    requestBody.routeModifiers = {
      vehicleInfo: {
        emissionType: 'HYBRID',
      },
    };
  }

  if (kind === 'transit') {
    requestBody.computeAlternativeRoutes = true;
    requestBody.departureTime = new Date().toISOString();
  }

  return requestBody;
}

async function fetchRoutesForMode(
  kind: RouteKind,
  origin: WaypointInput,
  destination: WaypointInput
): Promise<ModeFetchResult> {
  const apiKey = getGoogleMapsApiKey();
  const response = await fetch(GOOGLE_ROUTES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask':
        'routes.distanceMeters,routes.duration,routes.description,routes.routeLabels,routes.polyline.encodedPolyline,routes.travelAdvisory.fuelConsumptionMicroliters,routes.legs.startLocation,routes.legs.endLocation',
    },
    body: JSON.stringify(buildRouteRequest(kind, origin, destination)),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      parseGoogleErrorText(errorText) || `Google Routes API failed for ${kind} navigation.`
    );
  }

  const data = (await response.json()) as GoogleRoutesResponse;

  return {
    kind,
    routes: dedupeRoutes(data.routes ?? []),
  };
}

function choosePreferredRoute(kind: RouteKind, routes: GoogleRoute[]) {
  if (routes.length === 0) {
    return null;
  }

  if (kind === 'drive') {
    return (
      routes.find((route) => route.routeLabels?.includes('FUEL_EFFICIENT')) ??
      routes.reduce((best, route) =>
        estimateDriveCo2Kg(route) < estimateDriveCo2Kg(best) ? route : best
      )
    );
  }

  return routes.reduce((best, route) => {
    const bestDuration = parseDurationSeconds(best.duration);
    const nextDuration = parseDurationSeconds(route.duration);

    if (nextDuration !== bestDuration) {
      return nextDuration < bestDuration ? route : best;
    }

    return (route.distanceMeters ?? 0) < (best.distanceMeters ?? 0) ? route : best;
  });
}

function getModeBadges(kind: RouteKind, driveReferenceCo2Kg: number, driveAlternativeCo2Kg: number | null) {
  switch (kind) {
    case 'walk':
      return ['0 kg CO2', 'Lowest carbon'];
    case 'bike':
      return ['Near-zero CO2', 'Active travel'];
    case 'transit':
      return ['Shared ride', 'Low carbon'];
    case 'drive':
      return driveAlternativeCo2Kg && driveAlternativeCo2Kg > driveReferenceCo2Kg
        ? ['Fuel-efficient', 'Car navigation']
        : ['Car navigation'];
  }
}

function getRouteCopy(kind: RouteKind, fuelEfficientDrive: boolean) {
  switch (kind) {
    case 'walk':
      return {
        title: 'Walk route',
        subtitle: 'Zero direct emissions for the full trip',
        fallbackSummary: 'Walk the full trip on the lowest-carbon route Google returned.',
      };
    case 'bike':
      return {
        title: 'Bike route',
        subtitle: 'Cycling option with near-zero direct emissions',
        fallbackSummary: 'Bike the trip using the cycling route Google returned.',
      };
    case 'transit':
      return {
        title: 'Public transit',
        subtitle: 'Lower-emission shared travel option',
        fallbackSummary: 'Public transit route with estimated shared-trip emissions.',
      };
    case 'drive':
      return {
        title: 'Fuel-efficient drive',
        subtitle: fuelEfficientDrive
          ? 'Google selected the most carbon-efficient car route'
          : 'Best available driving route from Google Maps',
        fallbackSummary:
          'Turn-by-turn car simulation on the lowest-emission driving route Google returned.',
      };
  }
}

function buildWarnings() {
  return [];
}

function buildRouteOption(
  kind: RouteKind,
  route: GoogleRoute,
  driveReferenceCo2Kg: number,
  driveAlternativeCo2Kg: number | null,
  fuelEfficientDrive: boolean
): RouteOption {
  const polyline = decodePolyline(route.polyline?.encodedPolyline);
  const { start, end } = getRouteEndpoints(route, polyline);
  const distanceMeters = route.distanceMeters ?? 0;
  const durationSeconds = parseDurationSeconds(route.duration);
  const co2Kg =
    kind === 'drive'
      ? estimateDriveCo2Kg(route)
      : estimateLowCarbonCo2Kg(kind, route, driveReferenceCo2Kg);
  const comparisonCo2Kg = kind === 'drive' ? driveAlternativeCo2Kg ?? co2Kg : driveReferenceCo2Kg;
  const copy = getRouteCopy(kind, fuelEfficientDrive);

  return {
    id: `${kind}-${distanceMeters}-${durationSeconds}`,
    kind,
    title: copy.title,
    subtitle: copy.subtitle,
    summary: route.description || copy.fallbackSummary,
    distanceMeters,
    durationSeconds,
    co2Kg,
    co2SavedKg: Math.max(roundTo(comparisonCo2Kg - co2Kg, 3), 0),
    polyline,
    start,
    end,
    color: ROUTE_COLORS[kind],
    badges: getModeBadges(kind, driveReferenceCo2Kg, driveAlternativeCo2Kg),
    warnings: buildWarnings(),
  };
}

function sortRouteOptions(options: RouteOption[]) {
  return [...options].sort((left, right) => {
    if (left.co2Kg !== right.co2Kg) {
      return left.co2Kg - right.co2Kg;
    }

    const leftPriority = ROUTE_PRIORITY.indexOf(left.kind);
    const rightPriority = ROUTE_PRIORITY.indexOf(right.kind);

    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    return left.durationSeconds - right.durationSeconds;
  });
}

function getModeLabel(kind: RouteKind) {
  switch (kind) {
    case 'walk':
      return 'Walking';
    case 'bike':
      return 'Bike';
    case 'transit':
      return 'Public transit';
    case 'drive':
      return 'Driving';
  }
}

export async function buildRoutePlan({
  origin,
  destination,
  originLabel,
  destinationLabel,
}: BuildRoutePlanParams): Promise<RoutePlan> {
  const notices: string[] = [];
  const modeErrors = new Map<RouteKind, string>();
  const settledResults = await Promise.allSettled(
    ROUTE_PRIORITY.map((kind) => fetchRoutesForMode(kind, origin, destination))
  );

  const modeResults = new Map<RouteKind, GoogleRoute[]>();

  settledResults.forEach((result, index) => {
    const kind = ROUTE_PRIORITY[index];

    if (result.status === 'fulfilled') {
      modeResults.set(result.value.kind, result.value.routes);

      if (result.value.routes.length === 0 && kind !== 'drive') {
        notices.push(`${getModeLabel(kind)} route is not available for this trip.`);
      }

      return;
    }

    modeErrors.set(kind, getErrorMessage(result.reason));

    if (kind !== 'drive') {
      notices.push(`${getModeLabel(kind)} route could not be loaded right now.`);
    }
  });

  const drivingRoutes = modeResults.get('drive') ?? [];
  const driveErrorMessage = modeErrors.get('drive');

  if (drivingRoutes.length === 0) {
    if (driveErrorMessage) {
      throw new Error(`Driving route request failed: ${driveErrorMessage}`);
    }

    throw new Error('Google Maps did not return any driving routes for this trip.');
  }

  const preferredDriveRoute = choosePreferredRoute('drive', drivingRoutes);

  if (!preferredDriveRoute) {
    throw new Error('Google Maps returned driving data, but no usable driving route could be derived.');
  }

  const driveReferenceCo2Kg = estimateDriveCo2Kg(preferredDriveRoute);
  const alternativeDriveRoute =
    drivingRoutes.find((route) => route !== preferredDriveRoute) ?? null;
  const alternativeDriveCo2Kg = alternativeDriveRoute
    ? estimateDriveCo2Kg(alternativeDriveRoute)
    : null;
  const fuelEfficientDrive = Boolean(preferredDriveRoute.routeLabels?.includes('FUEL_EFFICIENT'));

  if (!fuelEfficientDrive) {
    notices.push('Google returned the best available driving route for this trip.');
  } else {
    notices.push('Drive navigation uses the fuel-efficient car route returned by Google Maps.');
  }

  if (alternativeDriveCo2Kg && alternativeDriveCo2Kg > driveReferenceCo2Kg) {
    notices.push('Driving emissions are shown against an alternate car route when Google returns one.');
  }

  const options: RouteOption[] = [];

  ROUTE_PRIORITY.forEach((kind) => {
    const routes = modeResults.get(kind) ?? [];
    const preferredRoute = kind === 'drive' ? preferredDriveRoute : choosePreferredRoute(kind, routes);

    if (!preferredRoute) {
      return;
    }

    options.push(
      buildRouteOption(
        kind,
        preferredRoute,
        driveReferenceCo2Kg,
        alternativeDriveCo2Kg,
        fuelEfficientDrive
      )
    );
  });

  if (options.length === 0) {
    throw new Error('No routes were returned by Google Maps for that trip.');
  }

  const sortedOptions = sortRouteOptions(options);
  const driveOption = sortedOptions.find((option) => option.kind === 'drive');
  const primaryOption = sortedOptions[0];

  return {
    originLabel,
    destinationLabel,
    origin: primaryOption.start,
    destination: primaryOption.end,
    baselineDriveCo2Kg: driveOption?.co2Kg ?? driveReferenceCo2Kg,
    generatedAt: new Date().toISOString(),
    notices,
    options: sortedOptions,
  };
}
