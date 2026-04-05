import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { type ComponentProps, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import MapView, { Marker, Polyline, Region } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { useIsFocused } from '@react-navigation/native';

import { ThemedText } from '@/components/themed-text';
import {
  completeCarpool,
  createCarpool,
  createTrip,
  fetchMyCarpools,
  requestCarpoolSeat,
  searchCarpools,
  startCarpool,
  updateCarpool,
  updateCarpoolLiveStatus,
} from '@/lib/api';
import { getCarpoolRoleStatus } from '@/lib/carpool-status';
import {
  formatCo2,
  formatCurrency,
  formatDistance,
  formatDuration,
  formatMultiplier,
} from '@/lib/formatters';
import { createAutocompleteSessionToken, fetchPlaceSuggestions } from '@/lib/google-places';
import { buildDriveRouteWithStops, buildRoutePlan } from '@/lib/google-routes';
import { useUserProfile } from '@/context/user-context';
import {
  AddressSuggestion,
  CarpoolRequestRecord,
  CarpoolRecurrencePattern,
  CarpoolSearchMatch,
  CarpoolSearchResponse,
  CarpoolTripRecord,
  CreateCarpoolPayload,
  RouteOption,
  RoutePlan,
  TripPayload,
  TripRecord,
  UpdateCarpoolPayload,
  UpdateCarpoolLiveStatusPayload,
  WaypointInput,
} from '@/types/trips';
import { useColorScheme } from '@/hooks/use-color-scheme';

const DEFAULT_REGION: Region = {
  latitude: 33.4234,
  longitude: -111.94,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};
const MIN_LATITUDE_DELTA = 0.003;
const MAX_LATITUDE_DELTA = 0.6;
const MIN_LONGITUDE_DELTA = 0.003;
const MAX_LONGITUDE_DELTA = 0.6;
const ZOOM_FACTOR = 0.5;
const CARPOOL_ROUTE_ID = 'carpool-route-option';
const CARPOOL_COLOR = '#B85C25';
const DEFAULT_CARPOOL_SEARCH_WINDOW_MINUTES = 45;
const CARPOOL_POLL_INTERVAL_MS = 5000;
const ACTIVE_CARPOOL_STATUSES = ['draft', 'scheduled', 'confirmed', 'active'] as const;

function buildRegion(points: { latitude: number; longitude: number }[]): Region {
  if (points.length === 0) {
    return DEFAULT_REGION;
  }

  const latitudes = points.map((point) => point.latitude);
  const longitudes = points.map((point) => point.longitude);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);

  return {
    latitude: (minLatitude + maxLatitude) / 2,
    longitude: (minLongitude + maxLongitude) / 2,
    latitudeDelta: Math.max((maxLatitude - minLatitude) * 1.6, 0.02),
    longitudeDelta: Math.max((maxLongitude - minLongitude) * 1.6, 0.02),
  };
}

function samplePolyline(points: { latitude: number; longitude: number }[], maxPoints = 90) {
  if (points.length <= maxPoints) {
    return points;
  }

  const step = (points.length - 1) / (maxPoints - 1);

  return Array.from({ length: maxPoints }, (_, index) => {
    const pointIndex = Math.min(Math.round(index * step), points.length - 1);
    return points[pointIndex];
  });
}

function findClosestPolylineIndex(
  points: { latitude: number; longitude: number }[],
  target: { latitude: number; longitude: number }
) {
  return points.reduce(
    (closest, point, index) => {
      const distance =
        Math.abs(point.latitude - target.latitude) + Math.abs(point.longitude - target.longitude);

      if (distance < closest.distance) {
        return { index, distance };
      }

      return closest;
    },
    { index: 0, distance: Number.POSITIVE_INFINITY }
  ).index;
}

function findClosestPolylineIndexFrom(
  points: { latitude: number; longitude: number }[],
  target: { latitude: number; longitude: number },
  startIndex: number
) {
  if (startIndex <= 0) {
    return findClosestPolylineIndex(points, target);
  }

  const slicedPoints = points.slice(startIndex);

  if (slicedPoints.length === 0) {
    return points.length - 1;
  }

  return startIndex + findClosestPolylineIndex(slicedPoints, target);
}

function getRouteIcon(kind: RouteOption['kind']): ComponentProps<typeof MaterialIcons>['name'] {
  switch (kind) {
    case 'walk':
      return 'directions-walk';
    case 'bike':
      return 'directions-bike';
    case 'transit':
      return 'directions-transit';
    case 'carpool':
      return 'groups';
    case 'drive':
      return 'directions-car';
  }
}

function getRouteModeLabel(kind: RouteOption['kind']) {
  switch (kind) {
    case 'walk':
      return 'Walking';
    case 'bike':
      return 'Cycling';
    case 'transit':
      return 'Transit';
    case 'carpool':
      return 'Carpool';
    case 'drive':
      return 'Driving';
  }
}

function getRouteTabLabel(kind: RouteOption['kind']) {
  switch (kind) {
    case 'walk':
      return 'Walk';
    case 'bike':
      return 'Cycle';
    case 'transit':
      return 'Transit';
    case 'carpool':
      return 'Carpool';
    case 'drive':
      return 'Car';
  }
}

function getRouteStartLabel(kind: RouteOption['kind'], isSimulating: boolean) {
  if (isSimulating) {
    switch (kind) {
      case 'walk':
        return 'Walking...';
      case 'bike':
        return 'Cycling...';
      case 'transit':
        return 'Navigating...';
      case 'carpool':
        return 'Opening carpool...';
      case 'drive':
        return 'Driving...';
    }
  }

  switch (kind) {
    case 'walk':
      return 'Start walking navigation';
    case 'bike':
      return 'Start bike navigation';
    case 'transit':
      return 'Start transit navigation';
    case 'carpool':
      return 'Open carpool actions';
    case 'drive':
      return 'Start drive navigation';
  }
}

function getRouteFooterMessage(kind: RouteOption['kind']) {
  switch (kind) {
    case 'walk':
      return 'Following the selected walking route. The map is now in focused navigation mode.';
    case 'bike':
      return 'Following the selected cycling route. The map is now in focused navigation mode.';
    case 'transit':
      return 'Following the selected public transit route. The map is now in focused navigation mode.';
    case 'carpool':
      return 'Review nearby shared rides, seat pricing, and route impact before requesting a seat.';
    case 'drive':
      return 'Following the selected fuel-efficient driving route. The map is now in focused navigation mode.';
  }
}

function getSimulationMarkerTitle(kind: RouteOption['kind']) {
  switch (kind) {
    case 'walk':
      return 'Walker';
    case 'bike':
      return 'Bike';
    case 'transit':
      return 'Transit';
    case 'carpool':
      return 'Carpool';
    case 'drive':
      return 'Car';
  }
}

function isPlaceIdNotFoundError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return /NOT_FOUND:\s*Place ID/i.test(error.message) && /not found/i.test(error.message);
}

function formatCompactTime(dateString: string) {
  return new Date(dateString).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getAcceptedCarpoolRequests(trip: CarpoolTripRecord | null) {
  return (trip?.requests ?? [])
    .filter(
      (request): request is CarpoolRequestRecord & {
        pickupPoint: NonNullable<CarpoolRequestRecord['pickupPoint']>;
        dropoffPoint: NonNullable<CarpoolRequestRecord['dropoffPoint']>;
      } => request.status === 'accepted' && request.pickupPoint != null && request.dropoffPoint != null
    )
    .sort(
      (left, right) =>
        new Date(left.respondedAt ?? left.createdAt).getTime() -
        new Date(right.respondedAt ?? right.createdAt).getTime()
    );
}

function buildAcceptedRequestSignature(requests: ReturnType<typeof getAcceptedCarpoolRequests>) {
  return requests
    .map(
      (request) =>
        `${request.id}:${request.pickupPoint.latitude.toFixed(5)},${request.pickupPoint.longitude.toFixed(
          5
        )}:${request.dropoffPoint.latitude.toFixed(5)},${request.dropoffPoint.longitude.toFixed(5)}`
    )
    .join('|');
}

function buildCarpoolSimulationRoute(
  route: RouteOption,
  detourRoute: RouteOption,
  participantCount: number
) {
  const nextParticipantCount = Math.max(participantCount, 1);
  const nextCo2Kg = Math.max(Number((detourRoute.co2Kg / nextParticipantCount).toFixed(3)), 0);

  return {
    ...route,
    summary: detourRoute.summary || route.summary,
    distanceMeters: detourRoute.distanceMeters,
    durationSeconds: detourRoute.durationSeconds,
    co2Kg: nextCo2Kg,
    co2SavedKg: Math.max(Number((detourRoute.co2Kg - nextCo2Kg).toFixed(3)), route.co2SavedKg, 0),
    polyline: detourRoute.polyline,
    start: detourRoute.start,
    end: detourRoute.end,
  };
}

type CarpoolJourneyStep = {
  id: string;
  label: string;
  state: 'done' | 'active' | 'pending';
};

function getCarpoolDisplayRole(
  trip: CarpoolTripRecord | CarpoolSearchMatch,
  currentUserId: number
) {
  return trip.currentUserRole ?? (trip.driverId === currentUserId ? 'driver' : 'rider');
}

function buildCarpoolJourneySteps(
  trip: CarpoolTripRecord | CarpoolSearchMatch,
  currentUserId: number
): CarpoolJourneyStep[] {
  const role = getCarpoolDisplayRole(trip, currentUserId);
  const stepLabels =
    role === 'driver'
      ? ['Publish', 'Approve', 'Pickup', 'Drop-off', 'Impact']
      : ['Request', 'Confirm', 'Pickup', 'Ride', 'Impact'];
  const requestStatus = trip.currentUserRequest?.status ?? null;
  const liveStage = trip.liveStatus?.stage ?? null;
  let activeIndex = 0;

  if (trip.status === 'completed' || trip.status === 'ended') {
    activeIndex = stepLabels.length - 1;
  } else if (trip.status === 'active') {
    if (liveStage === 'driver_to_pickup') {
      activeIndex = 2;
    } else if (liveStage === 'rider_onboard') {
      activeIndex = 3;
    } else if (liveStage === 'driver_to_destination') {
      activeIndex = 4;
    } else {
      activeIndex = 2;
    }
  } else if (
    trip.status === 'confirmed' ||
    requestStatus === 'accepted' ||
    liveStage === 'ready_to_start' ||
    trip.acceptedRiders > 0
  ) {
    activeIndex = 1;
  } else if (requestStatus === 'pending' || trip.pendingRequestCount > 0) {
    activeIndex = 1;
  }

  return stepLabels.map((label, index) => ({
    id: `${role}-${label.toLowerCase()}`,
    label,
    state: index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'pending',
  }));
}

function formatTrustSummary(trip: CarpoolTripRecord | CarpoolSearchMatch) {
  if (trip.trustSignals.ratingCount > 0) {
    return `${trip.trustSignals.ratingAverage.toFixed(1)} stars`;
  }

  if (trip.trustSignals.ridesCompleted > 0) {
    return `${trip.trustSignals.ridesCompleted} rides`;
  }

  return 'New driver';
}

type DriverLiveStatusMilestone = {
  key: string;
  triggerIndex: number;
  stage: UpdateCarpoolLiveStatusPayload['stage'];
  activeRequestId: number | null;
  note: string | null;
};

function buildDriverLiveStatusMilestones(
  points: { latitude: number; longitude: number }[],
  requests: ReturnType<typeof getAcceptedCarpoolRequests>
): DriverLiveStatusMilestone[] {
  if (points.length === 0 || requests.length === 0) {
    return [];
  }

  const milestones: DriverLiveStatusMilestone[] = [];
  let searchStartIndex = 0;

  requests.forEach((request, requestIndex) => {
    const riderName = request.riderName ?? `Rider #${request.riderId}`;
    const nextRequest = requests[requestIndex + 1] ?? null;
    const pickupIndex = findClosestPolylineIndexFrom(points, request.pickupPoint, searchStartIndex);
    const dropoffIndex = findClosestPolylineIndexFrom(
      points,
      request.dropoffPoint,
      Math.min(pickupIndex + 1, points.length - 1)
    );

    milestones.push({
      key: `pickup-${request.id}`,
      triggerIndex: pickupIndex,
      stage: 'rider_onboard',
      activeRequestId: request.id,
      note: `${riderName} has been picked up. Head to the rider drop-off point next.`,
    });

    milestones.push({
      key: `dropoff-${request.id}`,
      triggerIndex: dropoffIndex,
      stage: nextRequest ? 'driver_to_pickup' : 'driver_to_destination',
      activeRequestId: nextRequest?.id ?? null,
      note: nextRequest
        ? `${riderName} has been dropped off. Continue to ${nextRequest.riderName ?? `Rider #${nextRequest.riderId}`}'s pickup point.`
        : `${riderName} has been dropped off. Finish the final leg to the original destination.`,
    });

    searchStartIndex = Math.min(dropoffIndex + 1, points.length - 1);
  });

  return milestones;
}

function isCarpoolSearchMatch(
  trip: CarpoolTripRecord | CarpoolSearchMatch | null
): trip is CarpoolSearchMatch {
  return Boolean(trip && 'estimatedAddedMinutes' in trip);
}

function buildCarpoolRouteOption(
  driveRoute: RouteOption,
  carpoolSearch: CarpoolSearchResponse | null,
  selectedMatch: CarpoolSearchMatch | null,
  activeTrip: CarpoolTripRecord | null,
  detourRoute: RouteOption | null
): RouteOption {
  const prioritizedTrip = activeTrip ?? selectedMatch ?? carpoolSearch?.matches[0] ?? null;
  const effectiveDriveRoute = detourRoute ?? driveRoute;
  const nextParticipantCount = prioritizedTrip
    ? prioritizedTrip.currentUserRole === 'driver' || prioritizedTrip.currentUserRequest?.status === 'accepted'
      ? prioritizedTrip.participantCount
      : prioritizedTrip.participantCount + 1
    : 2;
  const estimatedCo2Kg = prioritizedTrip
    ? Math.max(effectiveDriveRoute.co2Kg / Math.max(nextParticipantCount, 1), 0)
    : Number((driveRoute.co2Kg * 0.5).toFixed(3));
  const estimatedCo2SavedKg = prioritizedTrip
    ? isCarpoolSearchMatch(prioritizedTrip)
      ? prioritizedTrip.estimatedCo2SavedKg
      : Math.max(Number((effectiveDriveRoute.co2Kg - estimatedCo2Kg).toFixed(3)), 0)
    : Math.max(Number((driveRoute.co2Kg - estimatedCo2Kg).toFixed(3)), 0);
  const routeTitle = activeTrip
    ? activeTrip.currentUserRole === 'driver'
      ? 'Your carpool offer'
      : `Carpool with ${activeTrip.driverName}`
    : prioritizedTrip
      ? `Carpool with ${prioritizedTrip.driverName}`
      : 'Carpool';
  const routeSubtitle = activeTrip
    ? activeTrip.currentUserRole === 'driver'
      ? `${activeTrip.availableSeats} seat${activeTrip.availableSeats === 1 ? '' : 's'} open | ${formatCurrency(
          activeTrip.pricePerMileUsd
        )}/mi | ${activeTrip.status}`
      : `Seat ${activeTrip.currentUserRequest?.status ?? 'open'} | leaves ${formatCompactTime(
          activeTrip.departureTime
        )}`
    : prioritizedTrip
      ? `${prioritizedTrip.availableSeats} seat${prioritizedTrip.availableSeats === 1 ? '' : 's'} open | ${formatCurrency(
          prioritizedTrip.pricePerMileUsd
        )}/mi`
      : 'Offer your drive or request a shared seat on a nearby route';
  const routeSummary = activeTrip
    ? activeTrip.currentUserRole === 'driver'
      ? activeTrip.status === 'active'
        ? 'Your shared ride is live. Riders can follow the trip on their device now.'
        : activeTrip.acceptedRiders > 0
          ? detourRoute?.summary ??
            'A rider has been accepted. Start the shared ride to begin live simulation on both devices.'
          : 'Your offer is published. Accept a rider to unlock the shared ride simulation.'
      : activeTrip.currentUserRequest?.status === 'accepted'
        ? activeTrip.status === 'active'
          ? 'The driver has started the ride. Follow the live shared trip from this device.'
          : detourRoute?.summary ?? 'Your seat is confirmed. The driver can start the live ride whenever they are ready.'
        : carpoolSearch?.suggestion ??
          activeTrip.metadata?.routeSummary?.toString() ??
          'Shared rides appear here when a driver’s route and timing fit your trip.'
    : carpoolSearch?.suggestion ??
      prioritizedTrip?.metadata?.routeSummary?.toString() ??
      'Shared rides appear here when a driver’s route and timing fit your trip.';
  const polyline = detourRoute?.polyline?.length
    ? detourRoute.polyline
    : prioritizedTrip?.pathPoints?.length
      ? prioritizedTrip.pathPoints
      : driveRoute.polyline;
  const estimatedPriceUsd =
    prioritizedTrip && isCarpoolSearchMatch(prioritizedTrip)
      ? prioritizedTrip.estimatedPriceUsd
      : prioritizedTrip?.currentUserRequest?.estimatedPriceUsd ?? null;

  return {
    id: CARPOOL_ROUTE_ID,
    kind: 'carpool',
    title: routeTitle,
    subtitle: routeSubtitle,
    summary: routeSummary,
    distanceMeters: detourRoute?.distanceMeters ?? prioritizedTrip?.distanceMeters ?? driveRoute.distanceMeters,
    durationSeconds:
      detourRoute?.durationSeconds ??
      prioritizedTrip?.durationSeconds ??
      driveRoute.durationSeconds +
        (prioritizedTrip && isCarpoolSearchMatch(prioritizedTrip) ? prioritizedTrip.estimatedAddedMinutes : 8) *
          60,
    co2Kg: estimatedCo2Kg,
    co2SavedKg: estimatedCo2SavedKg,
    polyline,
    start: polyline[0] ?? driveRoute.start,
    end: polyline[polyline.length - 1] ?? driveRoute.end,
    color: CARPOOL_COLOR,
    badges: activeTrip
      ? [
          activeTrip.currentUserRole === 'driver' ? 'Driver view' : 'Rider view',
          activeTrip.status === 'active' ? 'Live ride' : activeTrip.status,
          `${activeTrip.availableSeats}/${activeTrip.seatCapacity} seats`,
          estimatedPriceUsd != null ? `${formatCurrency(estimatedPriceUsd)} est.` : `${formatCurrency(activeTrip.pricePerMileUsd)}/mi`,
        ]
      : prioritizedTrip
        ? [
            `${carpoolSearch?.matches.length ?? 1} match${(carpoolSearch?.matches.length ?? 1) === 1 ? '' : 'es'}`,
            `${prioritizedTrip.availableSeats}/${prioritizedTrip.seatCapacity} seats`,
            estimatedPriceUsd != null ? `${formatCurrency(estimatedPriceUsd)} est.` : `${formatCurrency(prioritizedTrip.pricePerMileUsd)}/mi`,
          ]
        : ['Create ride', 'Shared impact', 'Request-based seats'],
    warnings: [],
  };
}

export default function MapScreen() {
  const colorScheme = useColorScheme();
  const palette =
    colorScheme === 'dark'
      ? {
          background: '#0D1511',
          card: 'rgba(17, 28, 22, 0.94)',
          cardSecondary: '#18241D',
          border: '#2D3B32',
          text: '#EAF5EE',
          muted: '#A8B6AE',
          accent: '#4DA86D',
          accentAlt: '#F0B14A',
          danger: '#F16F63',
          input: '#132019',
        }
      : {
          background: '#EDF3EC',
          card: 'rgba(255, 255, 255, 0.95)',
          cardSecondary: '#F6FAF4',
          border: '#D4DED2',
          text: '#173126',
          muted: '#5E7267',
          accent: '#20744A',
          accentAlt: '#D9811B',
          danger: '#C64537',
          input: '#F8FBF7',
        };

  const isFocused = useIsFocused();
  const { userId, displayName, notifyTripSaved, tripVersion } = useUserProfile();

  const mapRef = useRef<MapView | null>(null);
  const miniMapRef = useRef<MapView | null>(null);
  const regionRef = useRef<Region>(DEFAULT_REGION);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tripStartedAtRef = useRef<string | null>(null);
  const sharedRideTripIdRef = useRef<number | null>(null);
  const lastResolvedDetourKeyRef = useRef<string | null>(null);
  const syncTrackedSharedRideRef = useRef<(nextMyCarpools: CarpoolTripRecord[]) => void>(() => {});
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originSessionTokenRef = useRef(createAutocompleteSessionToken());
  const destinationSessionTokenRef = useRef(createAutocompleteSessionToken());

  const [originInput, setOriginInput] = useState('Current location');
  const [destinationInput, setDestinationInput] = useState('');
  const [useCurrentLocation, setUseCurrentLocation] = useState(true);
  const [activeField, setActiveField] = useState<'origin' | 'destination' | null>(null);
  const [originSuggestions, setOriginSuggestions] = useState<AddressSuggestion[]>([]);
  const [destinationSuggestions, setDestinationSuggestions] = useState<AddressSuggestion[]>([]);
  const [selectedOriginSuggestion, setSelectedOriginSuggestion] = useState<AddressSuggestion | null>(null);
  const [selectedDestinationSuggestion, setSelectedDestinationSuggestion] = useState<AddressSuggestion | null>(
    null
  );
  const [isSearchingOrigin, setIsSearchingOrigin] = useState(false);
  const [isSearchingDestination, setIsSearchingDestination] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<{ latitude: number; longitude: number } | null>(
    null
  );
  const [locationStatus, setLocationStatus] = useState<'loading' | 'ready' | 'denied' | 'error'>(
    'loading'
  );
  const [routePlan, setRoutePlan] = useState<RoutePlan | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [carpoolSearchResult, setCarpoolSearchResult] = useState<CarpoolSearchResponse | null>(null);
  const [myCarpools, setMyCarpools] = useState<CarpoolTripRecord[]>([]);
  const [carpoolDetourRoute, setCarpoolDetourRoute] = useState<RouteOption | null>(null);
  const [selectedCarpoolTripId, setSelectedCarpoolTripId] = useState<number | null>(null);
  const [isFetchingCarpools, setIsFetchingCarpools] = useState(false);
  const [carpoolError, setCarpoolError] = useState<string | null>(null);
  const [carpoolMessage, setCarpoolMessage] = useState<string | null>(null);
  const [createCarpoolVisible, setCreateCarpoolVisible] = useState(false);
  const [editingCarpoolTripId, setEditingCarpoolTripId] = useState<number | null>(null);
  const [isPublishingCarpool, setIsPublishingCarpool] = useState(false);
  const [driverSeatInput, setDriverSeatInput] = useState('2');
  const [driverDepartureOffsetInput, setDriverDepartureOffsetInput] = useState('30');
  const [driverPickupFlexInput, setDriverPickupFlexInput] = useState('15');
  const [driverRadiusInput, setDriverRadiusInput] = useState('1600');
  const [driverDeviationInput, setDriverDeviationInput] = useState('10');
  const [driverPriceInput, setDriverPriceInput] = useState('0.45');
  const [driverRecurrencePattern, setDriverRecurrencePattern] =
    useState<CarpoolRecurrencePattern>('none');
  const [isSubmittingCarpoolRequest, setIsSubmittingCarpoolRequest] = useState(false);
  const [isFetchingRoutes, setIsFetchingRoutes] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationPath, setSimulationPath] = useState<{ latitude: number; longitude: number }[] | null>(
    null
  );
  const [simulationIndex, setSimulationIndex] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [summaryTrip, setSummaryTrip] = useState<TripRecord | TripPayload | null>(null);
  const [summaryVisible, setSummaryVisible] = useState(false);
  const [isSavingTrip, setIsSavingTrip] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveStatusMessage, setSaveStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadCurrentLocation() {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();

        if (!isMounted) {
          return;
        }

        if (permission.status !== 'granted') {
          setLocationStatus('denied');
          setUseCurrentLocation(false);
          setOriginInput('');
          return;
        }

        const currentPosition = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        if (!isMounted) {
          return;
        }

        const nextLocation = {
          latitude: currentPosition.coords.latitude,
          longitude: currentPosition.coords.longitude,
        };

        setCurrentLocation(nextLocation);
        setLocationStatus('ready');
        setOriginInput('Current location');
        mapRef.current?.animateToRegion(
          {
            ...nextLocation,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          },
          700
        );
      } catch {
        if (!isMounted) {
          return;
        }

        setLocationStatus('error');
        setUseCurrentLocation(false);
        setOriginInput('');
      }
    }

    void loadCurrentLocation();

    return () => {
      isMounted = false;
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (useCurrentLocation) {
      setOriginSuggestions([]);
      setIsSearchingOrigin(false);
      return;
    }

    const query = originInput.trim();

    if (query.length < 2 || selectedOriginSuggestion?.fullText === query) {
      setOriginSuggestions([]);
      setIsSearchingOrigin(false);
      return;
    }

    let isCancelled = false;
    const timeout = setTimeout(async () => {
      setIsSearchingOrigin(true);

      try {
        const suggestions = await fetchPlaceSuggestions({
          input: query,
          sessionToken: originSessionTokenRef.current,
          currentLocation,
        });

        if (!isCancelled) {
          setOriginSuggestions(suggestions);
        }
      } catch {
        if (!isCancelled) {
          setOriginSuggestions([]);
        }
      } finally {
        if (!isCancelled) {
          setIsSearchingOrigin(false);
        }
      }
    }, 250);

    return () => {
      isCancelled = true;
      clearTimeout(timeout);
    };
  }, [currentLocation, originInput, selectedOriginSuggestion?.fullText, useCurrentLocation]);

  useEffect(() => {
    const query = destinationInput.trim();

    if (query.length < 2 || selectedDestinationSuggestion?.fullText === query) {
      setDestinationSuggestions([]);
      setIsSearchingDestination(false);
      return;
    }

    let isCancelled = false;
    const timeout = setTimeout(async () => {
      setIsSearchingDestination(true);

      try {
        const suggestions = await fetchPlaceSuggestions({
          input: query,
          sessionToken: destinationSessionTokenRef.current,
          currentLocation,
        });

        if (!isCancelled) {
          setDestinationSuggestions(suggestions);
        }
      } catch {
        if (!isCancelled) {
          setDestinationSuggestions([]);
        }
      } finally {
        if (!isCancelled) {
          setIsSearchingDestination(false);
        }
      }
    }, 250);

    return () => {
      isCancelled = true;
      clearTimeout(timeout);
    };
  }, [currentLocation, destinationInput, selectedDestinationSuggestion?.fullText]);

  const selectedCarpoolMatch =
    carpoolSearchResult?.matches.find((match) => match.id === selectedCarpoolTripId) ??
    carpoolSearchResult?.matches[0] ??
    null;
  const canUseCurrentLocation = locationStatus === 'ready' && Boolean(currentLocation);
  const activeDriverCarpool =
    myCarpools.find(
      (trip) =>
        trip.currentUserRole === 'driver' &&
        ACTIVE_CARPOOL_STATUSES.includes(trip.status as (typeof ACTIVE_CARPOOL_STATUSES)[number])
    ) ?? null;
  const activeAcceptedRiderCarpool =
    myCarpools.find(
      (trip) =>
        trip.currentUserRole === 'rider' &&
        trip.currentUserRequest?.status === 'accepted' &&
        ACTIVE_CARPOOL_STATUSES.includes(trip.status as (typeof ACTIVE_CARPOOL_STATUSES)[number])
    ) ?? null;
  const activeRiderCarpool =
    myCarpools.find((trip) => {
      const currentRequestStatus = trip.currentUserRequest?.status ?? null;

      return (
        trip.currentUserRole === 'rider' &&
        (ACTIVE_CARPOOL_STATUSES.includes(trip.status as (typeof ACTIVE_CARPOOL_STATUSES)[number]) ||
          currentRequestStatus === 'pending' ||
          currentRequestStatus === 'accepted')
      );
    }) ?? null;
  const activeCarpoolRouteTrip = activeDriverCarpool ?? activeRiderCarpool;
  const acceptedCarpoolRequests = getAcceptedCarpoolRequests(activeCarpoolRouteTrip);
  const acceptedCarpoolSignature = buildAcceptedRequestSignature(acceptedCarpoolRequests);
  const activeCarpoolEndpoints = useMemo(() => {
    if (!activeCarpoolRouteTrip?.pathPoints.length || activeCarpoolRouteTrip.pathPoints.length <= 1) {
      return null;
    }

    return {
      origin: activeCarpoolRouteTrip.pathPoints[0],
      destination: activeCarpoolRouteTrip.pathPoints[activeCarpoolRouteTrip.pathPoints.length - 1],
    };
  }, [activeCarpoolRouteTrip?.pathPoints]);
  const carpoolSimulationTrip =
    activeDriverCarpool &&
    (activeDriverCarpool.status === 'active' || activeDriverCarpool.acceptedRiders > 0)
      ? activeDriverCarpool
      : activeAcceptedRiderCarpool;
  const displayedRoutes = useMemo(() => {
    if (!routePlan) {
      return [];
    }

    const driveRoute = routePlan.options.find((route) => route.kind === 'drive');

    if (!driveRoute) {
      return routePlan.options;
    }

    const driveRouteIndex = routePlan.options.findIndex((route) => route.id === driveRoute.id);
    const nextRoutes = [...routePlan.options];
    nextRoutes.splice(
      Math.max(driveRouteIndex, 0),
      0,
      buildCarpoolRouteOption(
        driveRoute,
        carpoolSearchResult,
        selectedCarpoolMatch,
        activeCarpoolRouteTrip,
        carpoolDetourRoute
      )
    );
    return nextRoutes;
  }, [activeCarpoolRouteTrip, carpoolDetourRoute, carpoolSearchResult, routePlan, selectedCarpoolMatch]);
  const selectedRoute = displayedRoutes.find((route) => route.id === selectedRouteId) ?? null;
  const tracedPath =
    simulationPath && isSimulating ? simulationPath.slice(0, Math.max(simulationIndex + 1, 1)) : [];
  const simulationMarker =
    simulationPath && simulationPath.length > 0
      ? simulationPath[Math.min(simulationIndex, simulationPath.length - 1)]
      : null;

  const summaryRegion = useMemo(
    () => buildRegion(summaryTrip?.pathPoints ?? selectedRoute?.polyline ?? []),
    [selectedRoute?.polyline, summaryTrip?.pathPoints]
  );
  const showOriginSuggestions = !useCurrentLocation && activeField === 'origin' && originInput.trim().length >= 2;
  const showDestinationSuggestions =
    activeField === 'destination' && destinationInput.trim().length >= 2;
  const shouldCompactSearchPanel =
    destinationInput.trim().length > 0 || selectedDestinationSuggestion != null || routePlan != null;
  const simulationProgress = Math.round(
    (simulationIndex / Math.max((simulationPath?.length ?? 1) - 1, 1)) * 100
  );
  const isSharedCarpoolSimulation = isSimulating && selectedRoute?.kind === 'carpool';
  const offerRestrictionMessage = activeRiderCarpool
    ? `You already have a rider trip for ${activeRiderCarpool.routeTitle}. Cancel or finish that ride before offering your own carpool.`
    : activeDriverCarpool
      ? `You already have an active hosted carpool for ${activeDriverCarpool.routeTitle}. Edit that offer instead of posting another one.`
      : null;
  const requestRestrictionMessage = activeDriverCarpool
    ? `You are currently offering ${activeDriverCarpool.routeTitle}. Complete or cancel that carpool before requesting another ride.`
    : null;
  const canOfferCarpool = !activeRiderCarpool && !activeDriverCarpool;
  const canEditHostedCarpool = Boolean(activeDriverCarpool);
  const canStartDriverCarpoolSimulation =
    selectedRoute?.kind === 'carpool' &&
    ((activeDriverCarpool?.status === 'confirmed' && (activeDriverCarpool?.acceptedRiders ?? 0) > 0) ||
      activeDriverCarpool?.status === 'active');
  const canJoinActiveCarpoolSimulation =
    selectedRoute?.kind === 'carpool' &&
    activeAcceptedRiderCarpool?.currentUserRequest?.status === 'accepted' &&
    activeAcceptedRiderCarpool?.status === 'active';
  const riderWaitingForDriverStart =
    selectedRoute?.kind === 'carpool' &&
    activeAcceptedRiderCarpool?.currentUserRequest?.status === 'accepted' &&
    Boolean(activeAcceptedRiderCarpool?.status) &&
    ['scheduled', 'confirmed'].includes(activeAcceptedRiderCarpool.status);
  const driverWaitingForAcceptedRider =
    selectedRoute?.kind === 'carpool' &&
    (activeDriverCarpool?.acceptedRiders ?? 0) === 0 &&
    Boolean(activeDriverCarpool?.status) &&
    ['draft', 'scheduled'].includes(activeDriverCarpool?.status ?? '');
  const canSimulateSharedCarpool = canStartDriverCarpoolSimulation || canJoinActiveCarpoolSimulation;
  const canRequestCarpoolSeat = !requestRestrictionMessage;
  const roleRestrictionMessage = offerRestrictionMessage ?? requestRestrictionMessage;
  const liveCarpoolMarker =
    activeCarpoolRouteTrip &&
    !carpoolSearchResult?.matches.some((match) => match.id === activeCarpoolRouteTrip.id)
      ? activeCarpoolRouteTrip
      : null;
  const activeCarpoolStatus = activeCarpoolRouteTrip
    ? getCarpoolRoleStatus(activeCarpoolRouteTrip, userId)
    : null;
  const featuredCarpool = activeCarpoolRouteTrip ?? selectedCarpoolMatch;
  const featuredCarpoolRole = featuredCarpool ? getCarpoolDisplayRole(featuredCarpool, userId) : null;
  const featuredCarpoolSteps = featuredCarpool
    ? buildCarpoolJourneySteps(featuredCarpool, userId)
    : [];
  const featuredCarpoolFare =
    selectedCarpoolMatch?.estimatedPriceUsd ??
    activeCarpoolRouteTrip?.currentUserRequest?.estimatedPriceUsd ??
    null;
  const featuredCarpoolDelay =
    selectedCarpoolMatch?.estimatedAddedMinutes ??
    activeCarpoolRouteTrip?.currentUserRequest?.estimatedAddedMinutes ??
    activeCarpoolRouteTrip?.maxDeviationMinutes ??
    null;
  const featuredCarpoolSavings =
    selectedCarpoolMatch?.estimatedCo2SavedKg ?? activeCarpoolRouteTrip?.co2SavedKg ?? null;
  const featuredCarpoolTitle = activeCarpoolRouteTrip
    ? featuredCarpoolRole === 'driver'
      ? 'Your shared ride command center'
      : `Ride with ${activeCarpoolRouteTrip.driverName}`
    : selectedCarpoolMatch
      ? 'Best eco match nearby'
      : null;
  const featuredCarpoolSubtitle = activeCarpoolRouteTrip
    ? activeCarpoolStatus?.description ?? null
    : selectedCarpoolMatch
      ? `Share this route with ${selectedCarpoolMatch.driverName} and avoid about ${formatCo2(
          selectedCarpoolMatch.estimatedCo2SavedKg
        )} compared with driving solo.`
      : null;
  const activeCarpoolStatusColors = activeCarpoolStatus
    ? activeCarpoolStatus.tone === 'accent'
      ? {
          backgroundColor: colorScheme === 'dark' ? 'rgba(77, 168, 109, 0.16)' : '#EFF8F1',
          borderColor: colorScheme === 'dark' ? '#2B6A43' : '#CAE6D1',
          iconColor: palette.accent,
          badgeBackgroundColor: colorScheme === 'dark' ? '#183623' : '#DFF1E4',
        }
      : activeCarpoolStatus.tone === 'warning'
        ? {
            backgroundColor: colorScheme === 'dark' ? 'rgba(240, 177, 74, 0.16)' : '#FFF6E8',
            borderColor: colorScheme === 'dark' ? '#7C5A1B' : '#F1DBB1',
            iconColor: palette.accentAlt,
            badgeBackgroundColor: colorScheme === 'dark' ? '#3D2B11' : '#FCE8BF',
          }
        : activeCarpoolStatus.tone === 'success'
          ? {
              backgroundColor: colorScheme === 'dark' ? 'rgba(64, 180, 120, 0.14)' : '#ECF9F0',
              borderColor: colorScheme === 'dark' ? '#276845' : '#CBE7D5',
              iconColor: palette.accent,
              badgeBackgroundColor: colorScheme === 'dark' ? '#173123' : '#DDF2E4',
            }
          : {
              backgroundColor: colorScheme === 'dark' ? '#161E19' : '#F4F7F3',
              borderColor: palette.border,
              iconColor: palette.muted,
              badgeBackgroundColor: colorScheme === 'dark' ? '#213029' : '#E8EDE7',
            }
    : null;

  function buildCompletedCarpoolSummary(trip: CarpoolTripRecord): TripPayload {
    const resolvedPathPoints =
      sharedRideTripIdRef.current === trip.id && carpoolDetourRoute?.polyline?.length
        ? carpoolDetourRoute.polyline
        : trip.pathPoints;
    const resolvedDistanceMeters =
      sharedRideTripIdRef.current === trip.id && carpoolDetourRoute
        ? carpoolDetourRoute.distanceMeters
        : trip.distanceMeters;
    const resolvedDurationSeconds =
      sharedRideTripIdRef.current === trip.id && carpoolDetourRoute
        ? carpoolDetourRoute.durationSeconds
        : trip.durationSeconds;

    return {
      userId,
      displayName,
      routeType: 'carpool',
      routeTitle: trip.routeTitle,
      originLabel: trip.originLabel,
      destinationLabel: trip.destinationLabel,
      distanceMeters: resolvedDistanceMeters,
      durationSeconds: resolvedDurationSeconds,
      co2Kg: Number(trip.co2Kg.toFixed(3)),
      co2SavedKg: Number(trip.co2SavedKg.toFixed(3)),
      availableSeats: trip.availableSeats,
      seatCapacity: trip.seatCapacity,
      status: trip.status,
      startedAt: trip.startedAt ?? tripStartedAtRef.current ?? new Date().toISOString(),
      completedAt: trip.completedAt ?? new Date().toISOString(),
      pathPoints: resolvedPathPoints,
      metadata: {
        ...trip.metadata,
        participantCount: trip.participantCount,
        ridersHelped: trip.ridersHelped,
        currentUserRole: trip.currentUserRole,
      },
    };
  }

  function showCompletedCarpoolSummary(trip: CarpoolTripRecord) {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    setIsSimulating(false);
    setSimulationPath(null);
    setSimulationIndex(0);
    setSummaryTrip(buildCompletedCarpoolSummary(trip));
    setSummaryVisible(true);
    setIsSavingTrip(false);
    setSaveError(null);
    setCarpoolError(null);
    setCarpoolMessage(null);
    setSaveStatusMessage(
      trip.currentUserRole === 'driver'
        ? `Carpool completed for ${trip.participantCount} participant${
            trip.participantCount === 1 ? '' : 's'
          }. The shared route is now closed on both devices.`
        : `The driver completed the carpool for ${trip.participantCount} participant${
            trip.participantCount === 1 ? '' : 's'
          }. This shared route is now closed on your device too.`
    );
    tripStartedAtRef.current = null;
    sharedRideTripIdRef.current = null;
    notifyTripSaved();
  }

  function mergeCarpoolTrip(nextTrip: CarpoolTripRecord) {
    setMyCarpools((currentTrips) => {
      const hasTrip = currentTrips.some((trip) => trip.id === nextTrip.id);

      if (!hasTrip) {
        return [nextTrip, ...currentTrips];
      }

      return currentTrips.map((trip) =>
        trip.id === nextTrip.id
          ? {
              ...trip,
              ...nextTrip,
              requests: nextTrip.requests ?? trip.requests,
              participants: nextTrip.participants ?? trip.participants,
            }
          : trip
      );
    });
  }

  async function publishCarpoolLiveStatus(
    tripId: number,
    payload: UpdateCarpoolLiveStatusPayload
  ) {
    const nextTrip = await updateCarpoolLiveStatus(tripId, payload);
    mergeCarpoolTrip(nextTrip);
    return nextTrip;
  }

  syncTrackedSharedRideRef.current = (nextMyCarpools: CarpoolTripRecord[]) => {
    const trackedTripId = sharedRideTripIdRef.current;

    if (!trackedTripId) {
      return;
    }

    const trackedTrip = nextMyCarpools.find((trip) => trip.id === trackedTripId) ?? null;

    if (!trackedTrip) {
      return;
    }

    if (['completed', 'ended'].includes(trackedTrip.status)) {
      showCompletedCarpoolSummary(trackedTrip);
    }
  };

  async function resolveSharedCarpoolRoute(
    trip: CarpoolTripRecord,
    options?: { applyState?: boolean }
  ) {
    const applyState = options?.applyState ?? true;
    const acceptedRequests = getAcceptedCarpoolRequests(trip);
    const firstPathPoint = trip.pathPoints[0];
    const lastPathPoint = trip.pathPoints[trip.pathPoints.length - 1];

    if (!firstPathPoint || !lastPathPoint || acceptedRequests.length === 0) {
      if (applyState) {
        setCarpoolDetourRoute(null);
      }
      return null;
    }

    try {
      const nextDetourRoute = await buildDriveRouteWithStops({
        origin: {
          type: 'coordinates',
          coordinates: firstPathPoint,
        },
        destination: {
          type: 'coordinates',
          coordinates: lastPathPoint,
        },
        stops: acceptedRequests.flatMap((request) => [
          {
            type: 'coordinates' as const,
            coordinates: request.pickupPoint,
          },
          {
            type: 'coordinates' as const,
            coordinates: request.dropoffPoint,
          },
        ]),
      });

      if (applyState) {
        setCarpoolDetourRoute(nextDetourRoute);
      }
      return nextDetourRoute;
    } catch {
      if (applyState) {
        setCarpoolDetourRoute(null);
      }
      return null;
    }
  }

  function clearBlurTimeout() {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
  }

  function scheduleSuggestionClose() {
    clearBlurTimeout();
    blurTimeoutRef.current = setTimeout(() => {
      setActiveField(null);
    }, 150);
  }

  function resetOriginToCurrentLocation() {
    clearBlurTimeout();
    setUseCurrentLocation(true);
    setOriginInput('Current location');
    setOriginSuggestions([]);
    setSelectedOriginSuggestion(null);
    originSessionTokenRef.current = createAutocompleteSessionToken();
    if (activeField === 'origin') {
      setActiveField(null);
    }
  }

  function selectSuggestion(field: 'origin' | 'destination', suggestion: AddressSuggestion) {
    clearBlurTimeout();

    if (field === 'origin') {
      setUseCurrentLocation(false);
      setOriginInput(suggestion.fullText);
      setSelectedOriginSuggestion(suggestion);
      setOriginSuggestions([]);
      originSessionTokenRef.current = createAutocompleteSessionToken();
    } else {
      setDestinationInput(suggestion.fullText);
      setSelectedDestinationSuggestion(suggestion);
      setDestinationSuggestions([]);
      destinationSessionTokenRef.current = createAutocompleteSessionToken();
    }

    setActiveField(null);
  }

  useEffect(() => {
    if (!selectedRoute) {
      return;
    }

    mapRef.current?.fitToCoordinates(selectedRoute.polyline, {
      edgePadding: {
        top: 180,
        right: 48,
        bottom: 260,
        left: 48,
      },
      animated: true,
    });
  }, [selectedRouteId, selectedRoute]);

  useEffect(() => {
    if (!summaryVisible || !summaryTrip?.pathPoints?.length) {
      return;
    }

    const timeout = setTimeout(() => {
      miniMapRef.current?.fitToCoordinates(summaryTrip.pathPoints, {
        edgePadding: {
          top: 30,
          right: 30,
          bottom: 30,
          left: 30,
        },
        animated: false,
      });
    }, 120);

    return () => clearTimeout(timeout);
  }, [summaryTrip, summaryVisible]);

  useEffect(() => {
    if (!isFocused) {
      return;
    }

    let isCancelled = false;

    async function refreshMyCarpoolState() {
      try {
        const nextMyCarpools = await fetchMyCarpools(userId);

        if (!isCancelled) {
          setMyCarpools(nextMyCarpools);
          syncTrackedSharedRideRef.current(nextMyCarpools);
        }
      } catch {}
    }

    void refreshMyCarpoolState();
    const intervalId = setInterval(() => {
      void refreshMyCarpoolState();
    }, CARPOOL_POLL_INTERVAL_MS);

    return () => {
      isCancelled = true;
      clearInterval(intervalId);
    };
  }, [isFocused, tripVersion, userId]);

  useEffect(() => {
    const trip = activeCarpoolRouteTrip;
    const endpoints = activeCarpoolEndpoints;

    if (!isFocused || !trip || !endpoints || acceptedCarpoolRequests.length === 0) {
      lastResolvedDetourKeyRef.current = null;
      setCarpoolDetourRoute(null);
      return;
    }

    const resolvedTrip = trip;
    const resolvedEndpoints = endpoints;

    const detourKey = `${resolvedTrip.id}:${acceptedCarpoolSignature}:${resolvedEndpoints.origin.latitude.toFixed(
      5
    )},${resolvedEndpoints.origin.longitude.toFixed(5)}:${resolvedEndpoints.destination.latitude.toFixed(
      5
    )},${resolvedEndpoints.destination.longitude.toFixed(5)}`;

    if (lastResolvedDetourKeyRef.current === detourKey) {
      return;
    }

    lastResolvedDetourKeyRef.current = detourKey;
    let isCancelled = false;

    async function loadSharedDetourRoute() {
      const nextDetourRoute = await resolveSharedCarpoolRoute(resolvedTrip, {
        applyState: false,
      });

      if (!isCancelled) {
        if (!nextDetourRoute) {
          lastResolvedDetourKeyRef.current = null;
        }
        setCarpoolDetourRoute(nextDetourRoute);
      }
    }

    void loadSharedDetourRoute();

    return () => {
      isCancelled = true;
    };
  }, [
    activeCarpoolEndpoints,
    activeCarpoolRouteTrip,
    acceptedCarpoolRequests.length,
    acceptedCarpoolSignature,
    isFocused,
  ]);

  useEffect(() => {
    if (!isFocused || !routePlan) {
      return;
    }

    const driveRoute = routePlan.options.find((route) => route.kind === 'drive');

    if (!driveRoute) {
      setCarpoolSearchResult(null);
      setSelectedCarpoolTripId(null);
      return;
    }

    const nextRoutePlan = routePlan;
    const nextDriveRoute = driveRoute;
    let isCancelled = false;

    async function refreshCarpoolsForActiveUser() {
      setIsFetchingCarpools(true);

      try {
        const nextCarpoolSearch = await searchCarpools({
          userId,
          originLat: nextRoutePlan.origin.latitude,
          originLng: nextRoutePlan.origin.longitude,
          destinationLat: nextRoutePlan.destination.latitude,
          destinationLng: nextRoutePlan.destination.longitude,
          desiredDepartureTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          windowMinutes: DEFAULT_CARPOOL_SEARCH_WINDOW_MINUTES,
          routeDistanceMeters: nextDriveRoute.distanceMeters,
        });

        if (isCancelled) {
          return;
        }

        setCarpoolError(null);
        setCarpoolSearchResult(nextCarpoolSearch);
        setSelectedCarpoolTripId((currentSelection) =>
          nextCarpoolSearch.matches.some((match) => match.id === currentSelection)
            ? currentSelection
            : nextCarpoolSearch.matches[0]?.id ?? null
        );
      } catch (error) {
        if (isCancelled) {
          return;
        }

        setCarpoolSearchResult({ matches: [], suggestion: null });
        setSelectedCarpoolTripId(null);
        setCarpoolError(
          error instanceof Error ? error.message : 'Unable to load nearby carpools right now.'
        );
      } finally {
        if (!isCancelled) {
          setIsFetchingCarpools(false);
        }
      }
    }

    void refreshCarpoolsForActiveUser();
    const intervalId = setInterval(() => {
      void refreshCarpoolsForActiveUser();
    }, CARPOOL_POLL_INTERVAL_MS);

    return () => {
      isCancelled = true;
      clearInterval(intervalId);
    };
  }, [isFocused, routePlan, tripVersion, userId]);

  async function loadCarpoolsForRoutePlan(nextRoutePlan: RoutePlan) {
    const driveRoute = nextRoutePlan.options.find((route) => route.kind === 'drive');

    if (!driveRoute) {
      setCarpoolSearchResult(null);
      setSelectedCarpoolTripId(null);
      setCarpoolError(null);
      return;
    }

    setIsFetchingCarpools(true);
    setCarpoolError(null);

    try {
      const nextCarpoolSearch = await searchCarpools({
        userId,
        originLat: nextRoutePlan.origin.latitude,
        originLng: nextRoutePlan.origin.longitude,
        destinationLat: nextRoutePlan.destination.latitude,
        destinationLng: nextRoutePlan.destination.longitude,
        desiredDepartureTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        windowMinutes: DEFAULT_CARPOOL_SEARCH_WINDOW_MINUTES,
        routeDistanceMeters: driveRoute.distanceMeters,
      });

      setCarpoolSearchResult(nextCarpoolSearch);
      setSelectedCarpoolTripId((currentSelection) =>
        nextCarpoolSearch.matches.some((match) => match.id === currentSelection)
          ? currentSelection
          : nextCarpoolSearch.matches[0]?.id ?? null
      );
    } catch (error) {
      setCarpoolSearchResult({ matches: [], suggestion: null });
      setSelectedCarpoolTripId(null);
      setCarpoolError(
        error instanceof Error ? error.message : 'Unable to load nearby carpools right now.'
      );
    } finally {
      setIsFetchingCarpools(false);
    }
  }

  function resetCarpoolComposer() {
    setEditingCarpoolTripId(null);
    setDriverSeatInput('2');
    setDriverDepartureOffsetInput('30');
    setDriverPickupFlexInput('15');
    setDriverRadiusInput('1600');
    setDriverDeviationInput('10');
    setDriverPriceInput('0.45');
    setDriverRecurrencePattern('none');
  }

  function openCarpoolComposer(trip?: CarpoolTripRecord | null) {
    if (trip) {
      setEditingCarpoolTripId(trip.id);
      setDriverSeatInput(String(Math.max(trip.availableSeats, 1)));
      setDriverDepartureOffsetInput(
        String(Math.max(Math.round((new Date(trip.departureTime).getTime() - Date.now()) / 60000), 0))
      );
      setDriverPickupFlexInput(String(trip.pickupFlexibilityMinutes));
      setDriverRadiusInput(String(trip.matchingRadiusMeters));
      setDriverDeviationInput(String(trip.maxDeviationMinutes));
      setDriverPriceInput(trip.pricePerMileUsd.toFixed(2));
      setDriverRecurrencePattern(trip.recurrencePattern);
    } else {
      resetCarpoolComposer();
    }

    setCreateCarpoolVisible(true);
    setCarpoolError(null);
    setCarpoolMessage(null);
  }

  async function handlePublishCarpool() {
    if (!routePlan) {
      return;
    }

    if (!canOfferCarpool && editingCarpoolTripId == null) {
      setCarpoolError(offerRestrictionMessage ?? 'Finish your rider trip before offering a carpool.');
      return;
    }

    const driveRoute = routePlan.options.find((route) => route.kind === 'drive');

    if (!driveRoute) {
      setCarpoolError('Driving route details are required before publishing a carpool.');
      return;
    }

    const availableSeats = Number(driverSeatInput);
    const departureOffsetMinutes = Number(driverDepartureOffsetInput);
    const pickupFlexibilityMinutes = Number(driverPickupFlexInput);
    const matchingRadiusMeters = Number(driverRadiusInput);
    const maxDeviationMinutes = Number(driverDeviationInput);
    const pricePerMileUsd = Number(driverPriceInput);

    if (
      !Number.isInteger(availableSeats) ||
      availableSeats <= 0 ||
      !Number.isFinite(departureOffsetMinutes) ||
      departureOffsetMinutes < 0 ||
      !Number.isInteger(pickupFlexibilityMinutes) ||
      pickupFlexibilityMinutes < 0 ||
      !Number.isInteger(matchingRadiusMeters) ||
      matchingRadiusMeters <= 0 ||
      !Number.isInteger(maxDeviationMinutes) ||
      maxDeviationMinutes <= 0 ||
      !Number.isFinite(pricePerMileUsd) ||
      pricePerMileUsd < 0
    ) {
      setCarpoolError('Check the carpool form values before publishing the ride.');
      return;
    }

    const departureTime = new Date(Date.now() + departureOffsetMinutes * 60 * 1000).toISOString();
    const payload: CreateCarpoolPayload = {
      userId,
      routeTitle: `${driveRoute.title} carpool`,
      routeSummary: driveRoute.summary,
      originLabel: routePlan.originLabel,
      destinationLabel: routePlan.destinationLabel,
      distanceMeters: driveRoute.distanceMeters,
      durationSeconds: driveRoute.durationSeconds,
      co2Kg: driveRoute.co2Kg,
      availableSeats,
      departureTime,
      pickupFlexibilityMinutes,
      matchingRadiusMeters,
      maxDeviationMinutes,
      pricePerMileUsd: Number(pricePerMileUsd.toFixed(2)),
      recurrencePattern: driverRecurrencePattern,
      pathPoints: driveRoute.polyline,
      metadata: {
        badges: driveRoute.badges,
        summary: driveRoute.summary,
      },
    };

    setIsPublishingCarpool(true);
    setCarpoolError(null);
    setCarpoolMessage(null);

    try {
      const editingTripId = editingCarpoolTripId;
      const isEditing = editingTripId != null;
      const publishedCarpool =
        isEditing
          ? await updateCarpool({ ...payload, tripId: editingTripId } as UpdateCarpoolPayload)
          : await createCarpool(payload);
      mergeCarpoolTrip(publishedCarpool);
      setCreateCarpoolVisible(false);
      resetCarpoolComposer();
      setCarpoolMessage(
        `${isEditing ? 'Carpool updated' : 'Carpool scheduled'} for ${formatCompactTime(
          publishedCarpool.departureTime
        )}. Manage requests from My Carpools in the dashboard.`
      );
      notifyTripSaved();
    } catch (error) {
      setCarpoolError(
        error instanceof Error
          ? error.message
          : editingCarpoolTripId != null
            ? 'Unable to update the carpool.'
            : 'Unable to publish the carpool.'
      );
    } finally {
      setIsPublishingCarpool(false);
    }
  }

  async function handleRequestSeat(match: CarpoolSearchMatch) {
    if (!routePlan) {
      return;
    }

    if (!canRequestCarpoolSeat) {
      setCarpoolError(
        requestRestrictionMessage ?? 'Finish your offered carpool before requesting another ride.'
      );
      return;
    }

    setIsSubmittingCarpoolRequest(true);
    setCarpoolError(null);
    setCarpoolMessage(null);

    try {
      await requestCarpoolSeat(match.id, {
        userId,
        originLabel: routePlan.originLabel,
        destinationLabel: routePlan.destinationLabel,
        pickupPoint: routePlan.origin,
        dropoffPoint: routePlan.destination,
        desiredDepartureTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        estimatedDistanceMeters: match.estimatedDistanceMeters,
        windowMinutes: DEFAULT_CARPOOL_SEARCH_WINDOW_MINUTES,
      });

      try {
        const nextMyCarpools = await fetchMyCarpools(userId);
        setMyCarpools(nextMyCarpools);
        syncTrackedSharedRideRef.current(nextMyCarpools);
      } catch {}

      await loadCarpoolsForRoutePlan(routePlan);
      setCarpoolMessage(
        `Request sent to ${match.driverName}. The driver will see that it adds about ${match.estimatedAddedMinutes} minutes.`
      );
      notifyTripSaved();
    } catch (error) {
      setCarpoolError(
        error instanceof Error ? error.message : 'Unable to send the carpool request right now.'
      );
    } finally {
      setIsSubmittingCarpoolRequest(false);
    }
  }

  async function handleFindRoutes() {
    const trimmedDestination = destinationInput.trim();
    const trimmedOrigin = originInput.trim();

    if (!trimmedDestination) {
      setErrorMessage('Enter a destination before searching.');
      return;
    }

    let origin: WaypointInput;
    let destination: WaypointInput;

    if (useCurrentLocation) {
      if (!currentLocation) {
        setErrorMessage('Your current location is not ready yet. Try again in a moment.');
        return;
      }

      origin = {
        type: 'coordinates',
        coordinates: currentLocation,
      };
    } else {
      if (!trimmedOrigin) {
        setErrorMessage('Enter a start location or switch back to current location.');
        return;
      }

      origin = selectedOriginSuggestion?.placeId
        ? {
            type: 'placeId',
            placeId: selectedOriginSuggestion.placeId,
          }
        : {
            type: 'address',
            address: trimmedOrigin,
          };
    }

    destination = selectedDestinationSuggestion?.placeId
      ? {
          type: 'placeId',
          placeId: selectedDestinationSuggestion.placeId,
        }
      : {
          type: 'address',
          address: trimmedDestination,
        };

    const originLabel = useCurrentLocation
      ? 'Current location'
      : selectedOriginSuggestion?.fullText ?? trimmedOrigin;
    const destinationLabel = selectedDestinationSuggestion?.fullText ?? trimmedDestination;

    setErrorMessage(null);
    setSaveError(null);
    setCarpoolError(null);
    setCarpoolMessage(null);
    setActiveField(null);
    setOriginSuggestions([]);
    setDestinationSuggestions([]);
    setIsFetchingRoutes(true);
    setCarpoolSearchResult(null);
    setSelectedCarpoolTripId(null);
    setIsSimulating(false);
    setSimulationPath(null);
    setSimulationIndex(0);

    try {
      let nextRoutePlan: RoutePlan;

      try {
        nextRoutePlan = await buildRoutePlan({
          origin,
          destination,
          originLabel,
          destinationLabel,
        });
      } catch (error) {
        const shouldRetryWithAddressFallback =
          isPlaceIdNotFoundError(error) &&
          ((!useCurrentLocation && Boolean(selectedOriginSuggestion?.placeId) && Boolean(trimmedOrigin)) ||
            (Boolean(selectedDestinationSuggestion?.placeId) && Boolean(trimmedDestination)));

        if (!shouldRetryWithAddressFallback) {
          throw error;
        }

        const fallbackOrigin =
          !useCurrentLocation && selectedOriginSuggestion?.placeId
            ? {
                type: 'address' as const,
                address: trimmedOrigin,
              }
            : origin;
        const fallbackDestination = selectedDestinationSuggestion?.placeId
          ? {
              type: 'address' as const,
              address: trimmedDestination,
            }
          : destination;

        nextRoutePlan = await buildRoutePlan({
          origin: fallbackOrigin,
          destination: fallbackDestination,
          originLabel,
          destinationLabel,
        });

        if (!useCurrentLocation && selectedOriginSuggestion?.placeId) {
          setSelectedOriginSuggestion(null);
          originSessionTokenRef.current = createAutocompleteSessionToken();
        }

        if (selectedDestinationSuggestion?.placeId) {
          setSelectedDestinationSuggestion(null);
          destinationSessionTokenRef.current = createAutocompleteSessionToken();
        }
      }

      setRoutePlan(nextRoutePlan);
      setSelectedRouteId(nextRoutePlan.options[0]?.id ?? null);
    } catch (error) {
      setRoutePlan(null);
      setSelectedRouteId(null);
      setCarpoolSearchResult(null);
      setSelectedCarpoolTripId(null);
      setErrorMessage(error instanceof Error ? error.message : 'Unable to load routes right now.');
    } finally {
      setIsFetchingRoutes(false);
    }
  }

  async function handleCompleteTrip(
    route: RouteOption,
    fullPath: { latitude: number; longitude: number }[]
  ) {
    const tripPayload: TripPayload = {
      userId,
      displayName,
      routeType: route.kind,
      routeTitle: route.title,
      originLabel: routePlan?.originLabel ?? (originInput.trim() || 'Current location'),
      destinationLabel: routePlan?.destinationLabel ?? destinationInput.trim(),
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
      co2Kg: Number(route.co2Kg.toFixed(3)),
      co2SavedKg: Number(route.co2SavedKg.toFixed(3)),
      startedAt: tripStartedAtRef.current ?? new Date().toISOString(),
      completedAt: new Date().toISOString(),
      pathPoints: fullPath,
      metadata: {
        badges: route.badges,
        summary: route.summary,
      },
    };

    setSummaryTrip(tripPayload);
    setSummaryVisible(true);
    setIsSavingTrip(true);
    setSaveError(null);
    setSaveStatusMessage(null);

    try {
      const savedTrip = await createTrip(tripPayload);
      setSummaryTrip(savedTrip);
      setSaveStatusMessage('Trip saved. It is now available in your history and the leaderboard.');
      notifyTripSaved();
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : 'The trip finished, but saving it failed.'
      );
    } finally {
      setIsSavingTrip(false);
    }
  }

  function handleCompleteAcceptedCarpoolSimulation(
    route: RouteOption,
    fullPath: { latitude: number; longitude: number }[]
  ) {
    const tripPayload: TripPayload = {
      userId,
      displayName,
      routeType: route.kind,
      routeTitle: route.title,
      originLabel: routePlan?.originLabel ?? (originInput.trim() || 'Current location'),
      destinationLabel: routePlan?.destinationLabel ?? destinationInput.trim(),
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
      co2Kg: Number(route.co2Kg.toFixed(3)),
      co2SavedKg: Number(route.co2SavedKg.toFixed(3)),
      startedAt: tripStartedAtRef.current ?? new Date().toISOString(),
      completedAt: new Date().toISOString(),
      pathPoints: fullPath,
      metadata: {
        badges: route.badges,
        summary: route.summary,
      },
    };

    setSummaryTrip(tripPayload);
    setSummaryVisible(true);
    setIsSavingTrip(false);
    setSaveError(null);
    setSaveStatusMessage(
      'Route animation finished on this device. The carpool will close automatically on both devices as soon as the driver completes the shared ride.'
    );
  }

  async function handleCompleteHostedCarpoolSimulation(
    trip: CarpoolTripRecord,
    route: RouteOption,
    fullPath: { latitude: number; longitude: number }[]
  ) {
    setIsSavingTrip(true);
    setSaveError(null);
    setSaveStatusMessage(null);

    try {
      const completedTrip = await completeCarpool(trip.id, userId);
      mergeCarpoolTrip(completedTrip);
      showCompletedCarpoolSummary({
        ...completedTrip,
        pathPoints: fullPath,
        metadata: {
          ...completedTrip.metadata,
          badges: route.badges,
          summary: route.summary,
        },
      });
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : 'The live carpool finished, but completing it failed.'
      );
    } finally {
      setIsSavingTrip(false);
    }
  }

  function buildCarpoolUpdatePayload(trip: CarpoolTripRecord, detourRoute: RouteOption): UpdateCarpoolPayload {
    return {
      tripId: trip.id,
      userId,
      routeTitle: trip.routeTitle,
      routeSummary: detourRoute.summary || trip.metadata?.summary?.toString() || null,
      originLabel: trip.originLabel,
      destinationLabel: trip.destinationLabel,
      distanceMeters: detourRoute.distanceMeters,
      durationSeconds: detourRoute.durationSeconds,
      co2Kg: Number(detourRoute.co2Kg.toFixed(3)),
      availableSeats: trip.availableSeats,
      departureTime: trip.departureTime,
      estimatedArrivalTime: new Date(
        new Date(trip.departureTime).getTime() + detourRoute.durationSeconds * 1000
      ).toISOString(),
      pickupFlexibilityMinutes: trip.pickupFlexibilityMinutes,
      matchingRadiusMeters: trip.matchingRadiusMeters,
      maxDeviationMinutes: trip.maxDeviationMinutes,
      pricePerMileUsd: trip.pricePerMileUsd,
      recurrencePattern: trip.recurrencePattern,
      recurrenceGroupKey: trip.recurrenceGroupKey,
      status: trip.status === 'draft' ? 'draft' : 'scheduled',
      pathPoints: detourRoute.polyline,
      metadata: {
        ...trip.metadata,
        summary: detourRoute.summary || trip.metadata?.summary,
        acceptedStops: getAcceptedCarpoolRequests(trip).map((request) => ({
          requestId: request.id,
          riderId: request.riderId,
          pickupPoint: request.pickupPoint,
          dropoffPoint: request.dropoffPoint,
        })),
      },
    };
  }

  async function handleStartSimulation() {
    if (!selectedRoute) {
      return;
    }

    let simulationTrip = selectedRoute.kind === 'carpool' ? carpoolSimulationTrip : null;
    let routeForSimulation = selectedRoute;

    if (selectedRoute.kind === 'carpool' && !canSimulateSharedCarpool) {
      return;
    }

    if (selectedRoute.kind === 'carpool' && simulationTrip) {
      const acceptedRequests = getAcceptedCarpoolRequests(simulationTrip);

      if (acceptedRequests.length > 0) {
        const resolvedDetourRoute =
          carpoolDetourRoute ?? (await resolveSharedCarpoolRoute(simulationTrip, { applyState: true }));

        if (resolvedDetourRoute) {
          routeForSimulation = buildCarpoolSimulationRoute(
            selectedRoute,
            resolvedDetourRoute,
            simulationTrip.participantCount
          );

          if (simulationTrip.currentUserRole === 'driver' && simulationTrip.status !== 'active') {
            try {
              const updatedTrip = await updateCarpool(
                buildCarpoolUpdatePayload(simulationTrip, resolvedDetourRoute)
              );
              simulationTrip = updatedTrip;
              mergeCarpoolTrip(updatedTrip);
            } catch {}
          }
        }
      }
    }

    if (
      routeForSimulation.kind === 'carpool' &&
      simulationTrip?.currentUserRole === 'driver' &&
      simulationTrip.status !== 'active'
    ) {
      try {
        const startedTrip = await startCarpool(simulationTrip.id, userId);
        simulationTrip = startedTrip;
        mergeCarpoolTrip(startedTrip);
        setCarpoolError(null);
        setCarpoolMessage(
          'Your shared ride is now live. Riders will see the trip become available for simulation on their device within a few seconds.'
        );
        notifyTripSaved();
      } catch (error) {
        setCarpoolError(
          error instanceof Error ? error.message : 'Unable to start the live shared ride right now.'
        );
        return;
      }
    }

    if (routeForSimulation.kind === 'carpool' && simulationTrip) {
      sharedRideTripIdRef.current = simulationTrip.id;
    } else {
      sharedRideTripIdRef.current = null;
    }

    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    const sampledPath = samplePolyline(routeForSimulation.polyline);
    const driverLiveMilestones =
      routeForSimulation.kind === 'carpool' && simulationTrip?.currentUserRole === 'driver'
        ? buildDriverLiveStatusMilestones(sampledPath, getAcceptedCarpoolRequests(simulationTrip))
        : [];
    const publishedMilestoneKeys = new Set<string>();

    setSaveError(null);
    setSaveStatusMessage(null);
    setSummaryTrip(null);
    setSummaryVisible(false);
    setSimulationPath(sampledPath);
    setSimulationIndex(0);
    setIsSimulating(true);
    tripStartedAtRef.current = new Date().toISOString();

    timerRef.current = setInterval(() => {
      setSimulationIndex((current) => {
        const nextIndex = current + 1;
        const isDriverCarpoolSimulation =
          routeForSimulation.kind === 'carpool' && simulationTrip?.currentUserRole === 'driver';

        if (isDriverCarpoolSimulation && simulationTrip) {
          driverLiveMilestones
            .filter(
              (milestone) =>
                nextIndex >= milestone.triggerIndex && !publishedMilestoneKeys.has(milestone.key)
            )
            .forEach((milestone) => {
              publishedMilestoneKeys.add(milestone.key);
              void publishCarpoolLiveStatus(simulationTrip.id, {
                userId,
                stage: milestone.stage,
                activeRequestId: milestone.activeRequestId,
                note: milestone.note,
              }).catch(() => {
                publishedMilestoneKeys.delete(milestone.key);
              });
            });
        }

        if (nextIndex >= sampledPath.length) {
          if (timerRef.current) {
            clearInterval(timerRef.current);
          }

          setIsSimulating(false);
          if (routeForSimulation.kind === 'carpool' && simulationTrip?.currentUserRole === 'driver') {
            void handleCompleteHostedCarpoolSimulation(
              simulationTrip,
              routeForSimulation,
              routeForSimulation.polyline
            );
          } else if (routeForSimulation.kind === 'carpool') {
            handleCompleteAcceptedCarpoolSimulation(routeForSimulation, routeForSimulation.polyline);
          } else {
            void handleCompleteTrip(routeForSimulation, routeForSimulation.polyline);
          }
          return sampledPath.length - 1;
        }

        if (nextIndex % 8 === 0) {
          mapRef.current?.animateToRegion(
            {
              ...sampledPath[nextIndex],
              latitudeDelta: 0.03,
              longitudeDelta: 0.03,
            },
            250
          );
        }

        return nextIndex;
      });
    }, 220);
  }

  function handleCloseSummary() {
    setSummaryVisible(false);
    setSimulationPath(null);
    setSimulationIndex(0);
    setIsSimulating(false);
    setSummaryTrip(null);
    setSaveError(null);
    setSaveStatusMessage(null);
    tripStartedAtRef.current = null;
  }

  function handleZoom(direction: 'in' | 'out') {
    const currentRegion = regionRef.current;
    const multiplier = direction === 'in' ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;

    const nextRegion: Region = {
      ...currentRegion,
      latitudeDelta: Math.min(
        MAX_LATITUDE_DELTA,
        Math.max(MIN_LATITUDE_DELTA, currentRegion.latitudeDelta * multiplier)
      ),
      longitudeDelta: Math.min(
        MAX_LONGITUDE_DELTA,
        Math.max(MIN_LONGITUDE_DELTA, currentRegion.longitudeDelta * multiplier)
      ),
    };

    regionRef.current = nextRegion;
    mapRef.current?.animateToRegion(nextRegion, 180);
  }

  function renderSuggestionList(
    suggestions: AddressSuggestion[],
    isLoading: boolean,
    emptyText: string,
    onSelect: (suggestion: AddressSuggestion) => void
  ) {
    if (isLoading) {
      return (
        <View
          style={[
            styles.suggestionContainer,
            {
              backgroundColor: palette.cardSecondary,
              borderColor: palette.border,
            },
          ]}>
          <View style={styles.suggestionLoadingRow}>
            <ActivityIndicator color={palette.accent} size="small" />
            <ThemedText style={{ color: palette.text }}>Searching addresses...</ThemedText>
          </View>
        </View>
      );
    }

    if (suggestions.length === 0) {
      return (
        <View
          style={[
            styles.suggestionContainer,
            {
              backgroundColor: palette.cardSecondary,
              borderColor: palette.border,
            },
          ]}>
          <ThemedText style={{ color: palette.muted }}>{emptyText}</ThemedText>
          <ThemedText style={[styles.suggestionFooter, { color: palette.muted }]}>
            Suggestions powered by Google
          </ThemedText>
        </View>
      );
    }

    return (
      <View
        style={[
          styles.suggestionContainer,
          {
            backgroundColor: palette.cardSecondary,
            borderColor: palette.border,
          },
        ]}>
        {suggestions.map((suggestion, index) => (
          <Pressable
            key={suggestion.id}
            onPressIn={clearBlurTimeout}
            onPress={() => onSelect(suggestion)}
            style={[
              styles.suggestionRow,
              index < suggestions.length - 1
                ? {
                    borderBottomColor: palette.border,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                  }
                : null,
            ]}>
            <MaterialIcons name="location-on" size={18} color={palette.accent} />
            <View style={styles.suggestionTextBlock}>
              <ThemedText style={[styles.suggestionPrimary, { color: palette.text }]}>
                {suggestion.primaryText}
              </ThemedText>
              <ThemedText style={{ color: palette.muted }}>
                {suggestion.secondaryText || suggestion.fullText}
              </ThemedText>
            </View>
            {suggestion.distanceMeters ? (
              <View
                style={[
                  styles.suggestionDistanceBadge,
                  {
                    backgroundColor: `${palette.accent}16`,
                  },
                ]}>
                <ThemedText style={{ color: palette.accent, fontWeight: '600' }}>
                  {formatDistance(suggestion.distanceMeters)}
                </ThemedText>
              </View>
            ) : null}
          </Pressable>
        ))}
        <ThemedText style={[styles.suggestionFooter, { color: palette.muted }]}>
          Suggestions powered by Google
        </ThemedText>
      </View>
    );
  }

  function renderStandardRouteCard() {
    if (!selectedRoute || selectedRoute.kind === 'carpool') {
      return null;
    }

    return (
      <View
        style={[
          styles.routeCard,
          {
            backgroundColor: palette.card,
            borderColor: selectedRoute.color,
          },
        ]}>
        <View style={styles.routeHeader}>
          <View
            style={[
              styles.routeIcon,
              {
                backgroundColor: `${selectedRoute.color}20`,
              },
            ]}>
            <MaterialIcons
              name={getRouteIcon(selectedRoute.kind)}
              size={22}
              color={selectedRoute.color}
            />
          </View>
          <View style={{ flex: 1 }}>
            <ThemedText style={[styles.routeTitle, { color: palette.text }]}>
              {selectedRoute.title}
            </ThemedText>
            <ThemedText style={[styles.routeSubtitle, { color: palette.muted }]}>
              {selectedRoute.subtitle}
            </ThemedText>
          </View>
        </View>

        <View style={styles.badgeRow}>
          {selectedRoute.badges.map((badge) => (
            <View
              key={`${selectedRoute.id}-${badge}`}
              style={[
                styles.badge,
                {
                  backgroundColor: `${selectedRoute.color}18`,
                },
              ]}>
              <ThemedText style={[styles.badgeText, { color: selectedRoute.color }]}>
                {badge}
              </ThemedText>
            </View>
          ))}
        </View>

        <View style={styles.metricRow}>
          <View style={styles.metricCard}>
            <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>Time</ThemedText>
            <ThemedText style={[styles.metricValueSmall, { color: palette.text }]}>
              {formatDuration(selectedRoute.durationSeconds)}
            </ThemedText>
          </View>
          <View style={styles.metricCard}>
            <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>Distance</ThemedText>
            <ThemedText style={[styles.metricValueSmall, { color: palette.text }]}>
              {formatDistance(selectedRoute.distanceMeters)}
            </ThemedText>
          </View>
          <View style={styles.metricCard}>
            <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>CO2</ThemedText>
            <ThemedText style={[styles.metricValueSmall, { color: palette.text }]}>
              {formatCo2(selectedRoute.co2Kg)}
            </ThemedText>
          </View>
        </View>

        <ThemedText style={[styles.routeBodyText, { color: palette.text }]}>
          {selectedRoute.summary}
        </ThemedText>
        <ThemedText style={[styles.routeBodyText, { color: palette.muted }]}>
          {selectedRoute.kind === 'drive'
            ? selectedRoute.co2SavedKg > 0
              ? `Estimated to save ${formatCo2(selectedRoute.co2SavedKg)} compared with another car route.`
              : 'Estimated emissions for the selected car route.'
            : selectedRoute.co2SavedKg > 0
              ? `Estimated to save ${formatCo2(selectedRoute.co2SavedKg)} compared with the fuel-efficient drive option.`
              : 'Estimated emissions for this route type.'}
        </ThemedText>

        <Pressable
          disabled={isSimulating}
          onPress={() => void handleStartSimulation()}
          style={[
            styles.secondaryButton,
            {
              backgroundColor: selectedRoute.color,
            },
          ]}>
          <MaterialIcons name="navigation" size={20} color="#FFFFFF" />
          <ThemedText style={styles.secondaryButtonText}>
            {getRouteStartLabel(selectedRoute.kind, isSimulating)}
          </ThemedText>
        </Pressable>
      </View>
    );
  }

  function renderCarpoolRouteCard() {
    if (!selectedRoute || selectedRoute.kind !== 'carpool') {
      return null;
    }

    return (
      <View
        style={[
          styles.routeCard,
          {
            backgroundColor: palette.card,
            borderColor: CARPOOL_COLOR,
          },
        ]}>
        <View style={styles.routeHeader}>
          <View
            style={[
              styles.routeIcon,
              {
                backgroundColor: `${CARPOOL_COLOR}20`,
              },
            ]}>
            <MaterialIcons name="groups" size={22} color={CARPOOL_COLOR} />
          </View>
          <View style={{ flex: 1 }}>
            <ThemedText style={[styles.routeTitle, { color: palette.text }]}>
              {selectedRoute.title}
            </ThemedText>
            <ThemedText style={[styles.routeSubtitle, { color: palette.muted }]}>
              {selectedRoute.subtitle}
            </ThemedText>
          </View>
        </View>

        <View style={styles.badgeRow}>
          {selectedRoute.badges.map((badge) => (
            <View
              key={`${selectedRoute.id}-${badge}`}
              style={[
                styles.badge,
                {
                  backgroundColor: `${CARPOOL_COLOR}18`,
                },
              ]}>
              <ThemedText style={[styles.badgeText, { color: CARPOOL_COLOR }]}>{badge}</ThemedText>
            </View>
          ))}
        </View>

        <View style={styles.metricRow}>
          <View style={styles.metricCard}>
            <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>Matches</ThemedText>
            <ThemedText style={[styles.metricValueSmall, { color: palette.text }]}>
              {carpoolSearchResult?.matches.length ?? 0}
            </ThemedText>
          </View>
          <View style={styles.metricCard}>
            <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>Saved</ThemedText>
            <ThemedText style={[styles.metricValueSmall, { color: palette.text }]}>
              {formatCo2(selectedRoute.co2SavedKg)}
            </ThemedText>
          </View>
          <View style={styles.metricCard}>
            <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>Impact</ThemedText>
            <ThemedText style={[styles.metricValueSmall, { color: palette.text }]}>
              {selectedCarpoolMatch ? formatMultiplier(selectedCarpoolMatch.carpoolImpactMultiplier ?? 1) : '2.0x'}
            </ThemedText>
          </View>
        </View>

        {featuredCarpool && featuredCarpoolTitle && featuredCarpoolSubtitle ? (
          <View
            style={[
              styles.carpoolHeroCard,
              {
                backgroundColor: colorScheme === 'dark' ? '#23160F' : '#FFF5EC',
                borderColor: colorScheme === 'dark' ? '#6D4324' : '#F0D3BA',
              },
            ]}>
            <View style={styles.carpoolHeroHeader}>
              <View
                style={[
                  styles.carpoolHeroIcon,
                  {
                    backgroundColor: `${CARPOOL_COLOR}18`,
                  },
                ]}>
                <MaterialIcons
                  name={activeCarpoolRouteTrip ? 'dashboard' : 'emoji-events'}
                  size={18}
                  color={CARPOOL_COLOR}
                />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <ThemedText style={[styles.tripTitle, { color: palette.text }]}>
                  {featuredCarpoolTitle}
                </ThemedText>
                <ThemedText style={{ color: palette.muted }}>{featuredCarpoolSubtitle}</ThemedText>
              </View>
            </View>

            <View style={styles.carpoolHeroMetricRow}>
              <View
                style={[
                  styles.carpoolHeroMetric,
                  {
                    backgroundColor: colorScheme === 'dark' ? '#1A221D' : '#FFFFFF',
                    borderColor: palette.border,
                  },
                ]}>
                <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>Departure</ThemedText>
                <ThemedText style={[styles.metricValueSmall, { color: palette.text }]}>
                  {formatCompactTime(featuredCarpool.departureTime)}
                </ThemedText>
              </View>
              <View
                style={[
                  styles.carpoolHeroMetric,
                  {
                    backgroundColor: colorScheme === 'dark' ? '#1A221D' : '#FFFFFF',
                    borderColor: palette.border,
                  },
                ]}>
                <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>Fare</ThemedText>
                <ThemedText style={[styles.metricValueSmall, { color: palette.text }]}>
                  {featuredCarpoolFare != null
                    ? `${formatCurrency(featuredCarpoolFare)} est.`
                    : `${formatCurrency(featuredCarpool.pricePerMileUsd)}/mi`}
                </ThemedText>
              </View>
              <View
                style={[
                  styles.carpoolHeroMetric,
                  {
                    backgroundColor: colorScheme === 'dark' ? '#1A221D' : '#FFFFFF',
                    borderColor: palette.border,
                  },
                ]}>
                <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>Trust</ThemedText>
                <ThemedText style={[styles.metricValueSmall, { color: palette.text }]}>
                  {formatTrustSummary(featuredCarpool)}
                </ThemedText>
              </View>
            </View>

            <View style={styles.carpoolHeroInsightRow}>
              <View
                style={[
                  styles.carpoolHeroInsightChip,
                  {
                    backgroundColor: `${palette.accent}14`,
                    borderColor: `${palette.accent}30`,
                  },
                ]}>
                <MaterialIcons name="eco" size={16} color={palette.accent} />
                <ThemedText style={{ color: palette.text }}>
                  {featuredCarpoolSavings != null ? formatCo2(featuredCarpoolSavings) : formatCo2(selectedRoute.co2SavedKg)} saved
                </ThemedText>
              </View>
              <View
                style={[
                  styles.carpoolHeroInsightChip,
                  {
                    backgroundColor: `${CARPOOL_COLOR}10`,
                    borderColor: `${CARPOOL_COLOR}2A`,
                  },
                ]}>
                <MaterialIcons name="schedule" size={16} color={CARPOOL_COLOR} />
                <ThemedText style={{ color: palette.text }}>
                  {featuredCarpoolDelay != null ? `~${featuredCarpoolDelay} min deviation` : 'Shared route'}
                </ThemedText>
              </View>
              <View
                style={[
                  styles.carpoolHeroInsightChip,
                  {
                    backgroundColor: `${palette.accentAlt}14`,
                    borderColor: `${palette.accentAlt}2A`,
                  },
                ]}>
                <MaterialIcons name="groups" size={16} color={palette.accentAlt} />
                <ThemedText style={{ color: palette.text }}>
                  {featuredCarpool.availableSeats}/{featuredCarpool.seatCapacity} seats open
                </ThemedText>
              </View>
            </View>

            <View style={styles.carpoolJourneyRow}>
              {featuredCarpoolSteps.map((step) => {
                const stepColors =
                  step.state === 'done'
                    ? {
                        backgroundColor: `${palette.accent}16`,
                        borderColor: `${palette.accent}32`,
                        color: palette.accent,
                      }
                    : step.state === 'active'
                      ? {
                          backgroundColor: `${CARPOOL_COLOR}12`,
                          borderColor: `${CARPOOL_COLOR}30`,
                          color: CARPOOL_COLOR,
                        }
                      : {
                          backgroundColor: colorScheme === 'dark' ? '#18201B' : '#F8FBF6',
                          borderColor: palette.border,
                          color: palette.muted,
                        };

                return (
                  <View
                    key={step.id}
                    style={[
                      styles.carpoolJourneyStep,
                      {
                        backgroundColor: stepColors.backgroundColor,
                        borderColor: stepColors.borderColor,
                      },
                    ]}>
                    <ThemedText style={[styles.carpoolJourneyStepText, { color: stepColors.color }]}>
                      {step.label}
                    </ThemedText>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        {carpoolSearchResult?.suggestion ? (
          <View
            style={[
              styles.carpoolSuggestionCard,
              {
                backgroundColor: `${CARPOOL_COLOR}12`,
                borderColor: `${CARPOOL_COLOR}30`,
              },
            ]}>
            <MaterialIcons name="eco" size={18} color={CARPOOL_COLOR} />
            <ThemedText style={{ color: palette.text, flex: 1 }}>{carpoolSearchResult.suggestion}</ThemedText>
          </View>
        ) : null}

        {carpoolMessage ? (
          <View
            style={[
              styles.carpoolSuggestionCard,
              {
                backgroundColor: colorScheme === 'dark' ? '#132019' : '#F2F9F4',
                borderColor: palette.border,
              },
            ]}>
            <MaterialIcons name="check-circle-outline" size={18} color={palette.accent} />
            <ThemedText style={{ color: palette.text, flex: 1 }}>{carpoolMessage}</ThemedText>
          </View>
        ) : null}

        {carpoolError ? (
          <View
            style={[
              styles.carpoolSuggestionCard,
              {
                backgroundColor: colorScheme === 'dark' ? '#2F1A18' : '#FFF2EF',
                borderColor: colorScheme === 'dark' ? '#6A3431' : '#F0CCC7',
              },
            ]}>
            <MaterialIcons name="error-outline" size={18} color={palette.danger} />
            <ThemedText style={{ color: palette.text, flex: 1 }}>{carpoolError}</ThemedText>
          </View>
        ) : null}

        {roleRestrictionMessage ? (
          <View
            style={[
              styles.carpoolSuggestionCard,
              {
                backgroundColor: `${CARPOOL_COLOR}10`,
                borderColor: `${CARPOOL_COLOR}28`,
              },
            ]}>
            <MaterialIcons name="swap-horiz" size={18} color={CARPOOL_COLOR} />
            <ThemedText style={{ color: palette.text, flex: 1 }}>{roleRestrictionMessage}</ThemedText>
          </View>
        ) : null}

        {activeCarpoolRouteTrip ? (
          <View
            style={[
              styles.carpoolSuggestionCard,
              {
                backgroundColor: colorScheme === 'dark' ? '#181F1B' : '#F6FAF4',
                borderColor: palette.border,
              },
            ]}>
            <MaterialIcons
              name={activeCarpoolRouteTrip.currentUserRole === 'driver' ? 'drive-eta' : 'verified-user'}
              size={18}
              color={activeCarpoolRouteTrip.status === 'active' ? palette.accent : CARPOOL_COLOR}
            />
            <View style={{ flex: 1, gap: 4 }}>
              <ThemedText style={[styles.tripTitle, { color: palette.text }]}>
                {activeCarpoolRouteTrip.currentUserRole === 'driver'
                  ? 'Your hosted carpool'
                  : `Seat with ${activeCarpoolRouteTrip.driverName}`}
              </ThemedText>
              <ThemedText style={{ color: palette.muted }}>
                {activeCarpoolRouteTrip.status === 'active'
                  ? 'This shared ride is live now. Both devices can follow the trip from the carpool tab.'
                  : activeCarpoolRouteTrip.currentUserRole === 'driver'
                    ? activeCarpoolRouteTrip.acceptedRiders > 0
                      ? 'A rider has been accepted. Start the shared ride to begin the live simulation.'
                      : 'Your offer is live. Accept a rider first to unlock the shared ride simulation.'
                    : 'Your seat is confirmed. The driver will start the live ride when ready.'}
              </ThemedText>
            </View>
          </View>
        ) : null}

        {activeCarpoolStatus && activeCarpoolStatusColors ? (
          <View
            style={[
              styles.carpoolStatusCard,
              {
                backgroundColor: activeCarpoolStatusColors.backgroundColor,
                borderColor: activeCarpoolStatusColors.borderColor,
              },
            ]}>
            <MaterialIcons
              name={activeCarpoolStatus.icon}
              size={18}
              color={activeCarpoolStatusColors.iconColor}
            />
            <View style={styles.carpoolStatusCopy}>
              <View
                style={[
                  styles.carpoolStatusBadge,
                  {
                    backgroundColor: activeCarpoolStatusColors.badgeBackgroundColor,
                  },
                ]}>
                <ThemedText
                  style={[
                    styles.carpoolStatusBadgeText,
                    { color: activeCarpoolStatusColors.iconColor },
                  ]}>
                  {activeCarpoolStatus.badge}
                </ThemedText>
              </View>
              <ThemedText style={[styles.tripTitle, { color: palette.text }]}>
                {activeCarpoolStatus.title}
              </ThemedText>
              <ThemedText style={{ color: palette.muted }}>
                {activeCarpoolStatus.description}
              </ThemedText>
            </View>
          </View>
        ) : null}

        {driverWaitingForAcceptedRider ? (
          <View
            style={[
              styles.carpoolSuggestionCard,
              {
                backgroundColor: colorScheme === 'dark' ? '#181F1B' : '#F6FAF4',
                borderColor: palette.border,
              },
            ]}>
            <MaterialIcons name="groups" size={18} color={CARPOOL_COLOR} />
            <ThemedText style={{ color: palette.text, flex: 1 }}>
              Accept at least one rider before the live shared ride can begin on both devices.
            </ThemedText>
          </View>
        ) : null}

        {riderWaitingForDriverStart ? (
          <View
            style={[
              styles.carpoolSuggestionCard,
              {
                backgroundColor: colorScheme === 'dark' ? '#181F1B' : '#F6FAF4',
                borderColor: palette.border,
              },
            ]}>
            <MaterialIcons name="hourglass-top" size={18} color={palette.accentAlt} />
            <ThemedText style={{ color: palette.text, flex: 1 }}>
              Your seat is confirmed. The driver needs to start the carpool before the shared ride simulation goes live here.
            </ThemedText>
          </View>
        ) : null}

        {canSimulateSharedCarpool ? (
          <Pressable
            disabled={isSimulating}
            onPress={() => void handleStartSimulation()}
            style={[
              styles.secondaryButton,
              {
                backgroundColor: palette.accent,
              },
            ]}>
            <MaterialIcons name="navigation" size={20} color="#FFFFFF" />
            <ThemedText style={styles.secondaryButtonText}>
              {isSimulating
                ? 'Sharing ride...'
                : canStartDriverCarpoolSimulation
                  ? activeDriverCarpool?.status === 'active'
                    ? 'Resume live driver simulation'
                    : 'Start live shared ride'
                  : 'Join live ride simulation'}
            </ThemedText>
          </Pressable>
        ) : null}

        <View style={styles.carpoolActionRow}>
          <Pressable
            disabled={!canOfferCarpool && !canEditHostedCarpool}
            onPress={() => {
              if (canEditHostedCarpool && activeDriverCarpool) {
                openCarpoolComposer(activeDriverCarpool);
                return;
              }

              if (!canOfferCarpool) {
                setCarpoolError(
                  offerRestrictionMessage ?? 'Finish your rider trip before offering a carpool.'
                );
                return;
              }

              openCarpoolComposer();
            }}
            style={[
              styles.carpoolPrimaryButton,
              { backgroundColor: canOfferCarpool || canEditHostedCarpool ? CARPOOL_COLOR : '#C69171' },
            ]}>
            <MaterialIcons
              name={canEditHostedCarpool ? 'edit' : 'add-road'}
              size={18}
              color="#FFFFFF"
            />
            <ThemedText style={styles.secondaryButtonText}>
              {canEditHostedCarpool
                ? 'Edit active offer'
                : canOfferCarpool
                  ? 'Offer this route'
                  : 'Rider trip already active'}
            </ThemedText>
          </Pressable>
          <View
            style={[
              styles.carpoolInfoChip,
              {
                backgroundColor: palette.input,
                borderColor: palette.border,
              },
            ]}>
            <ThemedText style={{ color: palette.muted }}>
              Price is shown up front and kept informational for now.
            </ThemedText>
          </View>
        </View>

        {isFetchingCarpools ? (
          <View style={[styles.messageRow, { backgroundColor: palette.input, borderColor: palette.border }]}>
            <ActivityIndicator color={CARPOOL_COLOR} />
            <ThemedText style={{ color: palette.text, flex: 1 }}>
              Looking for drivers heading your way...
            </ThemedText>
          </View>
        ) : carpoolSearchResult?.matches.length ? (
          <View style={styles.carpoolList}>
            {carpoolSearchResult.matches.map((match) => {
              const isSelected = selectedCarpoolTripId === match.id;
              const requestStatus = match.currentUserRequest?.status ?? null;
              const requestLabel =
                !canRequestCarpoolSeat
                  ? 'Finish your offered carpool first'
                  : requestStatus === 'accepted'
                    ? 'Seat confirmed'
                    : requestStatus === 'pending'
                      ? 'Waiting for driver'
                      : `Send request for ${formatCurrency(match.estimatedPriceUsd)}`;

              return (
                <Pressable
                  key={match.id}
                  onPress={() => setSelectedCarpoolTripId(match.id)}
                  style={[
                    styles.carpoolMatchCard,
                    {
                      backgroundColor: isSelected ? `${CARPOOL_COLOR}10` : palette.cardSecondary,
                      borderColor: isSelected ? CARPOOL_COLOR : palette.border,
                    },
                  ]}>
                  <View style={styles.carpoolMatchHeader}>
                    <View style={{ flex: 1, gap: 4 }}>
                      <ThemedText style={[styles.tripTitle, { color: palette.text }]}>
                        {match.driverName}
                      </ThemedText>
                      <ThemedText style={{ color: palette.muted }}>
                        Leaves {formatCompactTime(match.departureTime)} | {match.availableSeats}/
                        {match.seatCapacity} seats available
                      </ThemedText>
                    </View>
                    <View
                      style={[
                        styles.routeTypeBadge,
                        {
                          backgroundColor:
                            requestStatus === 'accepted'
                              ? `${palette.accent}18`
                              : requestStatus === 'pending'
                                ? `${palette.accentAlt}18`
                                : `${CARPOOL_COLOR}18`,
                        },
                      ]}>
                      <ThemedText
                        style={{
                          color:
                            requestStatus === 'accepted'
                              ? palette.accent
                              : requestStatus === 'pending'
                                ? palette.accentAlt
                                : CARPOOL_COLOR,
                          fontWeight: '700',
                        }}>
                        {requestStatus ?? 'open'}
                      </ThemedText>
                    </View>
                  </View>

                  <View style={styles.tripMetricRow}>
                    <ThemedText style={{ color: palette.text }}>
                      {formatCurrency(match.pricePerMileUsd)}/mi
                    </ThemedText>
                    <ThemedText style={{ color: palette.text }}>
                      {formatCurrency(match.estimatedPriceUsd)} est.
                    </ThemedText>
                    <ThemedText style={{ color: palette.text }}>
                      +{match.estimatedAddedMinutes} min
                    </ThemedText>
                  </View>

                  <View style={styles.carpoolInsightPillRow}>
                    <View
                      style={[
                        styles.carpoolInsightPill,
                        {
                          backgroundColor: `${palette.accent}14`,
                          borderColor: `${palette.accent}30`,
                        },
                      ]}>
                      <MaterialIcons name="military-tech" size={14} color={palette.accent} />
                      <ThemedText style={{ color: palette.text }}>
                        {formatMultiplier(match.carpoolImpactMultiplier ?? 1)} impact
                      </ThemedText>
                    </View>
                    <View
                      style={[
                        styles.carpoolInsightPill,
                        {
                          backgroundColor: `${CARPOOL_COLOR}10`,
                          borderColor: `${CARPOOL_COLOR}28`,
                        },
                      ]}>
                      <MaterialIcons name="verified-user" size={14} color={CARPOOL_COLOR} />
                      <ThemedText style={{ color: palette.text }}>{formatTrustSummary(match)}</ThemedText>
                    </View>
                    <View
                      style={[
                        styles.carpoolInsightPill,
                        {
                          backgroundColor: `${palette.accentAlt}14`,
                          borderColor: `${palette.accentAlt}28`,
                        },
                      ]}>
                      <MaterialIcons name="diversity-3" size={14} color={palette.accentAlt} />
                      <ThemedText style={{ color: palette.text }}>
                        {match.trustSignals.ridersHelped} riders helped
                      </ThemedText>
                    </View>
                  </View>
                  <ThemedText style={{ color: palette.muted }}>
                    This match leaves at {formatCompactTime(match.departureTime)}, keeps pickup inside the
                    {" driver's"} allowed deviation, and saves about {formatCo2(match.estimatedCo2SavedKg)} versus driving solo.
                  </ThemedText>

                  <Pressable
                    disabled={
                      !canRequestCarpoolSeat ||
                      isSubmittingCarpoolRequest ||
                      requestStatus === 'pending' ||
                      requestStatus === 'accepted'
                    }
                    onPress={() => void handleRequestSeat(match)}
                    style={[
                      styles.carpoolSecondaryButton,
                      {
                        backgroundColor:
                          !canRequestCarpoolSeat
                            ? palette.cardSecondary
                            : requestStatus === 'accepted'
                            ? palette.accent
                            : requestStatus === 'pending'
                              ? palette.cardSecondary
                              : CARPOOL_COLOR,
                        borderColor:
                          !canRequestCarpoolSeat
                            ? palette.border
                            : requestStatus === 'pending'
                              ? palette.border
                              : requestStatus === 'accepted'
                                ? palette.accent
                                : CARPOOL_COLOR,
                      },
                    ]}>
                    <MaterialIcons
                      name={!canRequestCarpoolSeat ? 'block' : requestStatus === 'accepted' ? 'check-circle' : 'person-add-alt-1'}
                      size={18}
                      color={!canRequestCarpoolSeat || requestStatus === 'pending' ? palette.text : '#FFFFFF'}
                    />
                    <ThemedText
                      style={[
                        styles.secondaryButtonText,
                        { color: !canRequestCarpoolSeat || requestStatus === 'pending' ? palette.text : '#FFFFFF' },
                      ]}>
                      {requestLabel}
                    </ThemedText>
                  </Pressable>
                </Pressable>
              );
            })}
          </View>
        ) : activeCarpoolRouteTrip ? null : (
          <View style={[styles.messageCard, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
            <MaterialIcons name="groups-2" size={20} color={CARPOOL_COLOR} />
            <ThemedText style={{ color: palette.text, flex: 1 }}>
              No live carpools fit this search yet. You can publish this drive instead, and nearby riders will see your seats.
            </ThemedText>
          </View>
        )}
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]} edges={['top']}>
      <View style={styles.container}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          initialRegion={DEFAULT_REGION}
          onRegionChangeComplete={(region) => {
            regionRef.current = region;
          }}>
          {displayedRoutes.map((route) => {
            const isSelected = route.id === selectedRouteId;

            return (
              <Polyline
                key={route.id}
                coordinates={route.polyline}
                strokeColor={route.color}
                strokeWidth={isSelected ? 6 : 4}
                lineCap="round"
                lineJoin="round"
                tappable
                onPress={() => !isSimulating && setSelectedRouteId(route.id)}
                zIndex={isSelected ? 5 : 2}
              />
            );
          })}

          {selectedRoute?.kind === 'carpool' && liveCarpoolMarker ? (
            <Marker
              key={`carpool-marker-live-${liveCarpoolMarker.id}`}
              coordinate={
                liveCarpoolMarker.pathPoints[0] ??
                routePlan?.origin ?? {
                  latitude: DEFAULT_REGION.latitude,
                  longitude: DEFAULT_REGION.longitude,
                }
              }
              title={
                liveCarpoolMarker.currentUserRole === 'driver'
                  ? 'Your hosted carpool'
                  : liveCarpoolMarker.driverName
              }
              description={`${formatCompactTime(liveCarpoolMarker.departureTime)} | ${liveCarpoolMarker.availableSeats} seats`}
              onPress={() => {
                setSelectedCarpoolTripId(liveCarpoolMarker.id);
                setSelectedRouteId(CARPOOL_ROUTE_ID);
              }}>
              <View
                style={[
                  styles.carpoolMapMarker,
                  {
                    backgroundColor:
                      liveCarpoolMarker.status === 'active' ? palette.accent : `${CARPOOL_COLOR}CC`,
                  },
                ]}>
                <MaterialIcons
                  name={liveCarpoolMarker.status === 'active' ? 'navigation' : 'groups'}
                  size={16}
                  color="#FFFFFF"
                />
              </View>
            </Marker>
          ) : null}

          {selectedRoute?.kind === 'carpool'
            ? carpoolSearchResult?.matches.map((match) => (
                <Marker
                  key={`carpool-marker-${match.id}`}
                  coordinate={
                    match.pathPoints[0] ??
                    routePlan?.origin ?? {
                      latitude: DEFAULT_REGION.latitude,
                      longitude: DEFAULT_REGION.longitude,
                    }
                  }
                  title={match.driverName}
                  description={`${formatCompactTime(match.departureTime)} | ${match.availableSeats} seats`}
                  onPress={() => setSelectedCarpoolTripId(match.id)}>
                  <View
                    style={[
                      styles.carpoolMapMarker,
                      {
                        backgroundColor:
                          selectedCarpoolTripId === match.id ? CARPOOL_COLOR : `${CARPOOL_COLOR}CC`,
                      },
                    ]}>
                    <MaterialIcons name="groups" size={16} color="#FFFFFF" />
                  </View>
                </Marker>
              ))
            : null}

          {selectedRoute ? (
            <>
              <Marker coordinate={selectedRoute.start} title="Start" description={routePlan?.originLabel} />
              <Marker
                coordinate={selectedRoute.end}
                title="Destination"
                description={routePlan?.destinationLabel}
              />
            </>
          ) : null}

          {tracedPath.length > 1 && selectedRoute ? (
            <Polyline
              coordinates={tracedPath}
              strokeColor={selectedRoute.color}
              strokeWidth={7}
              lineDashPattern={[1, 0]}
              zIndex={8}
            />
          ) : null}

          {simulationMarker && selectedRoute ? (
            <Marker
              coordinate={simulationMarker}
              title={getSimulationMarkerTitle(selectedRoute.kind)}
              anchor={{ x: 0.5, y: 0.5 }}>
              <View
                style={[
                  styles.vehicleMarker,
                  {
                    backgroundColor: selectedRoute.color,
                  },
                ]}>
                <MaterialIcons name={getRouteIcon(selectedRoute.kind)} size={18} color="#FFFFFF" />
              </View>
            </Marker>
          ) : null}
        </MapView>

        <View pointerEvents="box-none" style={styles.zoomControls}>
          <View
            style={[
              styles.zoomLabelChip,
              {
                backgroundColor: palette.card,
                borderColor: palette.border,
              },
            ]}>
            <MaterialIcons name="zoom-in-map" size={14} color={palette.text} />
            <ThemedText style={[styles.zoomLabelText, { color: palette.text }]}>Zoom</ThemedText>
          </View>
          <Pressable
            onPress={() => handleZoom('in')}
            style={[
              styles.zoomButton,
              {
                backgroundColor: palette.card,
                borderColor: palette.border,
              },
            ]}>
            <MaterialIcons name="add" size={20} color={palette.text} />
          </Pressable>
          <Pressable
            onPress={() => handleZoom('out')}
            style={[
              styles.zoomButton,
              {
                backgroundColor: palette.card,
                borderColor: palette.border,
              },
            ]}>
            <MaterialIcons name="remove" size={20} color={palette.text} />
          </Pressable>
        </View>

        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          {isSimulating && selectedRoute ? (
            <>
              <View
                style={[
                  styles.simulationHud,
                  isSharedCarpoolSimulation ? styles.sharedSimulationHud : null,
                  {
                    backgroundColor: palette.card,
                    borderColor: palette.border,
                  },
                ]}>
                <View style={styles.simulationHudHeader}>
                  <View style={styles.simulationHudIcon}>
                    <MaterialIcons name={getRouteIcon(selectedRoute.kind)} size={20} color={selectedRoute.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <ThemedText style={[styles.simulationTitle, { color: palette.text }]}>
                      {isSharedCarpoolSimulation ? 'Live shared ride' : `${getRouteModeLabel(selectedRoute.kind)} navigation`}
                    </ThemedText>
                    {!isSharedCarpoolSimulation ? (
                      <ThemedText style={{ color: palette.muted }}>
                        {routePlan?.originLabel} to {routePlan?.destinationLabel}
                      </ThemedText>
                    ) : null}
                  </View>
                  <View
                    style={[
                      styles.progressChip,
                      isSharedCarpoolSimulation ? styles.sharedProgressChip : null,
                      {
                        backgroundColor: colorScheme === 'dark' ? '#1A2D21' : '#EAF4ED',
                      },
                    ]}>
                    <MaterialIcons name="near-me" size={16} color={palette.accent} />
                    <ThemedText style={{ color: palette.text }}>{simulationProgress}%</ThemedText>
                  </View>
                </View>

                {selectedRoute.kind === 'carpool' && activeCarpoolStatus && activeCarpoolStatusColors ? (
                  <View
                    style={[
                      styles.simulationStatusCard,
                      isSharedCarpoolSimulation ? styles.sharedSimulationStatusCard : null,
                      {
                        backgroundColor: activeCarpoolStatusColors.backgroundColor,
                        borderColor: activeCarpoolStatusColors.borderColor,
                      },
                    ]}>
                    <MaterialIcons
                      name={activeCarpoolStatus.icon}
                      size={18}
                      color={activeCarpoolStatusColors.iconColor}
                    />
                    <View style={styles.carpoolStatusCopy}>
                      <View
                        style={[
                          styles.carpoolStatusBadge,
                          {
                            backgroundColor: activeCarpoolStatusColors.badgeBackgroundColor,
                          },
                        ]}>
                        <ThemedText
                          style={[
                            styles.carpoolStatusBadgeText,
                            { color: activeCarpoolStatusColors.iconColor },
                          ]}>
                          {activeCarpoolStatus.badge}
                        </ThemedText>
                      </View>
                      <ThemedText style={[styles.tripTitle, { color: palette.text }]}>
                        {activeCarpoolStatus.title}
                      </ThemedText>
                      <ThemedText style={{ color: palette.muted }}>
                        {activeCarpoolStatus.description}
                      </ThemedText>
                    </View>
                  </View>
                ) : null}

                {isSharedCarpoolSimulation ? (
                  <View
                    style={[
                      styles.sharedSimulationSummaryBar,
                      {
                        backgroundColor: colorScheme === 'dark' ? '#141D18' : '#F7FBF6',
                        borderColor: palette.border,
                      },
                    ]}>
                    <View style={styles.sharedSimulationSummaryItem}>
                      <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>ETA</ThemedText>
                      <ThemedText style={{ color: palette.text }}>
                        {formatDuration(selectedRoute.durationSeconds)}
                      </ThemedText>
                    </View>
                    <View style={styles.sharedSimulationDivider} />
                    <View style={styles.sharedSimulationSummaryItem}>
                      <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>Impact</ThemedText>
                      <ThemedText style={{ color: palette.text }}>
                        {formatCo2(selectedRoute.co2SavedKg)}
                      </ThemedText>
                    </View>
                  </View>
                ) : (
                  <View style={styles.simulationStatsRow}>
                    <View style={styles.simulationStatCard}>
                      <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>Route</ThemedText>
                      <ThemedText style={{ color: palette.text }}>{selectedRoute.title}</ThemedText>
                    </View>
                    <View style={styles.simulationStatCard}>
                      <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>ETA</ThemedText>
                      <ThemedText style={{ color: palette.text }}>
                        {formatDuration(selectedRoute.durationSeconds)}
                      </ThemedText>
                    </View>
                    <View style={styles.simulationStatCard}>
                      <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>CO2</ThemedText>
                      <ThemedText style={{ color: palette.text }}>{formatCo2(selectedRoute.co2Kg)}</ThemedText>
                    </View>
                  </View>
                )}
              </View>

              <View
                style={[
                  styles.simulationFooter,
                  isSharedCarpoolSimulation ? styles.sharedSimulationFooter : null,
                  {
                    backgroundColor: palette.card,
                    borderColor: palette.border,
                  },
                ]}>
                <MaterialIcons name="navigation" size={18} color={selectedRoute.color} />
                <ThemedText style={{ color: palette.text, flex: 1 }}>
                  {isSharedCarpoolSimulation
                    ? 'Shared ride live. Follow the route and use the zoom buttons for a closer view.'
                    : getRouteFooterMessage(selectedRoute.kind)}
                </ThemedText>
              </View>
            </>
          ) : (
            <>
              <View
                style={[
                  styles.searchPanel,
                  shouldCompactSearchPanel ? styles.searchPanelCompact : null,
                  {
                    backgroundColor: palette.card,
                    borderColor: palette.border,
                  },
                ]}>
                {isFetchingRoutes ? (
                  <View style={styles.compactHeaderRow}>
                    <ActivityIndicator color={palette.accent} size="small" />
                  </View>
                ) : null}

                <View style={[styles.inputGroup, shouldCompactSearchPanel ? styles.inputGroupCompact : null]}>
                  <View style={styles.originRow}>
                    <TextInput
                      value={originInput}
                      onFocus={() => {
                        clearBlurTimeout();
                        setActiveField('origin');
                        if (useCurrentLocation) {
                          setUseCurrentLocation(false);
                          setOriginInput('');
                          setSelectedOriginSuggestion(null);
                          originSessionTokenRef.current = createAutocompleteSessionToken();
                        }
                      }}
                      onChangeText={(value) => {
                        clearBlurTimeout();
                        setActiveField('origin');
                        if (useCurrentLocation) {
                          setUseCurrentLocation(false);
                        }
                        setSelectedOriginSuggestion(null);
                        setOriginInput(value);
                      }}
                      onBlur={scheduleSuggestionClose}
                      placeholder="Start"
                      placeholderTextColor={palette.muted}
                      style={[
                        styles.input,
                        shouldCompactSearchPanel ? styles.inputCompact : null,
                        styles.originInput,
                        {
                          color: palette.text,
                          backgroundColor: palette.input,
                          borderColor: palette.border,
                        },
                      ]}
                    />
                    <Pressable
                      disabled={!canUseCurrentLocation}
                      onPress={() => {
                        if (!canUseCurrentLocation) {
                          return;
                        }

                        resetOriginToCurrentLocation();
                      }}
                      style={[
                        styles.locationButton,
                        shouldCompactSearchPanel ? styles.locationButtonCompact : null,
                        {
                          backgroundColor: useCurrentLocation ? palette.accent : palette.cardSecondary,
                          borderColor: useCurrentLocation ? palette.accent : palette.border,
                          opacity: canUseCurrentLocation || useCurrentLocation ? 1 : 0.55,
                        },
                      ]}>
                      <MaterialIcons
                        name={useCurrentLocation ? 'my-location' : 'near-me'}
                        size={18}
                        color={useCurrentLocation ? '#FFFFFF' : palette.text}
                      />
                    </Pressable>
                  </View>
                  {showOriginSuggestions
                    ? renderSuggestionList(
                        originSuggestions,
                        isSearchingOrigin,
                        'No matching starting points found yet.',
                        (suggestion) => selectSuggestion('origin', suggestion)
                      )
                    : null}
                </View>

                <View style={[styles.inputGroup, shouldCompactSearchPanel ? styles.inputGroupCompact : null]}>
                  <TextInput
                    value={destinationInput}
                    onFocus={() => {
                      clearBlurTimeout();
                      setActiveField('destination');
                    }}
                    onChangeText={(value) => {
                      clearBlurTimeout();
                      setActiveField('destination');
                      setSelectedDestinationSuggestion(null);
                      setDestinationInput(value);
                    }}
                    onBlur={scheduleSuggestionClose}
                    placeholder="Destination"
                    placeholderTextColor={palette.muted}
                    style={[
                      styles.input,
                      shouldCompactSearchPanel ? styles.inputCompact : null,
                      {
                        color: palette.text,
                        backgroundColor: palette.input,
                        borderColor: palette.border,
                      },
                    ]}
                  />
                  {showDestinationSuggestions
                    ? renderSuggestionList(
                        destinationSuggestions,
                        isSearchingDestination,
                        'No destination suggestions found yet.',
                        (suggestion) => selectSuggestion('destination', suggestion)
                      )
                    : null}
                </View>

                <Pressable
                  disabled={isFetchingRoutes || isSimulating}
                  onPress={() => void handleFindRoutes()}
                  style={[
                    styles.primaryButton,
                    shouldCompactSearchPanel ? styles.primaryButtonCompact : null,
                    {
                      backgroundColor: isFetchingRoutes || isSimulating ? '#7FA98E' : palette.accent,
                    },
                  ]}>
                  <MaterialIcons name="travel-explore" size={20} color="#FFFFFF" />
                  <ThemedText style={styles.primaryButtonText}>Find low-carbon routes</ThemedText>
                </Pressable>

                {errorMessage ? (
                  <View
                    style={[
                      styles.messageRow,
                      {
                        backgroundColor: colorScheme === 'dark' ? '#2F1A18' : '#FFF2EF',
                        borderColor: colorScheme === 'dark' ? '#6A3431' : '#F0CCC7',
                      },
                    ]}>
                    <MaterialIcons name="error-outline" size={18} color={palette.danger} />
                    <ThemedText style={{ color: palette.text, flex: 1 }}>{errorMessage}</ThemedText>
                  </View>
                ) : null}
              </View>

              {routePlan ? (
                <View
                  style={[
                    styles.bottomSheet,
                    {
                      backgroundColor: palette.card,
                      borderColor: palette.border,
                    },
                  ]}>
                  <ScrollView contentContainerStyle={styles.bottomSheetContent} showsVerticalScrollIndicator={false}>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={[
                        styles.modeTabs,
                        {
                          backgroundColor: palette.cardSecondary,
                          borderColor: palette.border,
                        },
                      ]}>
                      {displayedRoutes.map((route) => {
                        const isSelected = selectedRouteId === route.id;

                        return (
                          <Pressable
                            key={route.id}
                            disabled={isSimulating}
                            onPress={() => setSelectedRouteId(route.id)}
                            style={[
                              styles.modeTab,
                              isSelected
                                ? {
                                    backgroundColor: route.color,
                                    borderColor: route.color,
                                  }
                                : {
                                    backgroundColor: 'transparent',
                                    borderColor: 'transparent',
                                  },
                            ]}>
                            <MaterialIcons
                              name={getRouteIcon(route.kind)}
                              size={16}
                              color={isSelected ? '#FFFFFF' : route.color}
                            />
                            <ThemedText
                              numberOfLines={1}
                              style={[
                                styles.modeTabText,
                                { color: isSelected ? '#FFFFFF' : palette.text },
                              ]}>
                              {getRouteTabLabel(route.kind)}
                            </ThemedText>
                          </Pressable>
                        );
                      })}
                    </ScrollView>

                    {selectedRoute?.kind === 'carpool' ? renderCarpoolRouteCard() : renderStandardRouteCard()}
                  </ScrollView>
                </View>
              ) : null}
            </>
          )}
        </View>

        <Modal
          transparent
          visible={createCarpoolVisible}
          animationType="fade"
          onRequestClose={() => {
            setCreateCarpoolVisible(false);
            resetCarpoolComposer();
          }}>
          <View style={styles.modalBackdrop}>
            <View
              style={[
                styles.modalCard,
                {
                  backgroundColor: palette.card,
                  borderColor: palette.border,
                },
              ]}>
              <View style={styles.modalHeader}>
                <View style={{ flex: 1 }}>
                  <ThemedText type="title" style={[styles.modalTitle, { color: palette.text }]}>
                    {editingCarpoolTripId != null ? 'Edit Carpool' : 'Publish Carpool'}
                  </ThemedText>
                  <ThemedText style={{ color: palette.muted }}>
                    {editingCarpoolTripId != null
                      ? 'Update timing, price, or seats for your current hosted ride.'
                      : 'Share this drive, set your own timing rules, and let riders request seats.'}
                  </ThemedText>
                </View>
                <Pressable
                  onPress={() => {
                    setCreateCarpoolVisible(false);
                    resetCarpoolComposer();
                  }}>
                  <MaterialIcons name="close" size={22} color={palette.text} />
                </Pressable>
              </View>

              <ScrollView contentContainerStyle={styles.carpoolComposer}>
                <View style={styles.carpoolComposerRow}>
                  <View style={styles.carpoolComposerField}>
                    <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>Seats</ThemedText>
                    <TextInput
                      value={driverSeatInput}
                      onChangeText={setDriverSeatInput}
                      keyboardType="number-pad"
                      style={[
                        styles.input,
                        {
                          color: palette.text,
                          backgroundColor: palette.input,
                          borderColor: palette.border,
                        },
                      ]}
                    />
                  </View>
                  <View style={styles.carpoolComposerField}>
                    <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>Leave in (min)</ThemedText>
                    <TextInput
                      value={driverDepartureOffsetInput}
                      onChangeText={setDriverDepartureOffsetInput}
                      keyboardType="number-pad"
                      style={[
                        styles.input,
                        {
                          color: palette.text,
                          backgroundColor: palette.input,
                          borderColor: palette.border,
                        },
                      ]}
                    />
                  </View>
                </View>

                <View style={styles.carpoolComposerRow}>
                  <View style={styles.carpoolComposerField}>
                    <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>
                      Pickup flex (min)
                    </ThemedText>
                    <TextInput
                      value={driverPickupFlexInput}
                      onChangeText={setDriverPickupFlexInput}
                      keyboardType="number-pad"
                      style={[
                        styles.input,
                        {
                          color: palette.text,
                          backgroundColor: palette.input,
                          borderColor: palette.border,
                        },
                      ]}
                    />
                  </View>
                  <View style={styles.carpoolComposerField}>
                    <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>
                      Pickup radius (m)
                    </ThemedText>
                    <TextInput
                      value={driverRadiusInput}
                      onChangeText={setDriverRadiusInput}
                      keyboardType="number-pad"
                      style={[
                        styles.input,
                        {
                          color: palette.text,
                          backgroundColor: palette.input,
                          borderColor: palette.border,
                        },
                      ]}
                    />
                  </View>
                </View>

                <View style={styles.carpoolComposerRow}>
                  <View style={styles.carpoolComposerField}>
                    <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>
                      Max deviation (min)
                    </ThemedText>
                    <TextInput
                      value={driverDeviationInput}
                      onChangeText={setDriverDeviationInput}
                      keyboardType="number-pad"
                      style={[
                        styles.input,
                        {
                          color: palette.text,
                          backgroundColor: palette.input,
                          borderColor: palette.border,
                        },
                      ]}
                    />
                  </View>
                  <View style={styles.carpoolComposerField}>
                    <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>
                      Price per mile
                    </ThemedText>
                    <TextInput
                      value={driverPriceInput}
                      onChangeText={setDriverPriceInput}
                      keyboardType="decimal-pad"
                      style={[
                        styles.input,
                        {
                          color: palette.text,
                          backgroundColor: palette.input,
                          borderColor: palette.border,
                        },
                      ]}
                    />
                  </View>
                </View>

                <View style={styles.carpoolComposerField}>
                  <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>Recurring ride</ThemedText>
                  <View style={styles.recurrenceRow}>
                    {(['none', 'daily', 'weekdays'] as CarpoolRecurrencePattern[]).map((pattern) => {
                      const isSelected = driverRecurrencePattern === pattern;
                      return (
                        <Pressable
                          key={pattern}
                          onPress={() => setDriverRecurrencePattern(pattern)}
                          style={[
                            styles.recurrenceChip,
                            {
                              backgroundColor: isSelected ? CARPOOL_COLOR : palette.cardSecondary,
                              borderColor: isSelected ? CARPOOL_COLOR : palette.border,
                            },
                          ]}>
                          <ThemedText style={{ color: isSelected ? '#FFFFFF' : palette.text }}>
                            {pattern === 'none' ? 'One-time' : pattern}
                          </ThemedText>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                <View
                  style={[
                    styles.carpoolSuggestionCard,
                    {
                      backgroundColor: `${CARPOOL_COLOR}12`,
                      borderColor: `${CARPOOL_COLOR}28`,
                    },
                  ]}>
                  <MaterialIcons name="payments" size={18} color={CARPOOL_COLOR} />
                  <ThemedText style={{ color: palette.text, flex: 1 }}>
                    Riders see the fare estimate before requesting. Payment is informational only for now.
                  </ThemedText>
                </View>

                {offerRestrictionMessage ? (
                  <View
                    style={[
                      styles.carpoolSuggestionCard,
                      {
                        backgroundColor: colorScheme === 'dark' ? '#2B2018' : '#FFF3EC',
                        borderColor: colorScheme === 'dark' ? '#6B4A31' : '#F1D1BF',
                      },
                    ]}>
                    <MaterialIcons name="block" size={18} color={palette.danger} />
                    <ThemedText style={{ color: palette.text, flex: 1 }}>{offerRestrictionMessage}</ThemedText>
                  </View>
                ) : null}

                <Pressable
                  disabled={isPublishingCarpool || (!canOfferCarpool && editingCarpoolTripId == null)}
                  onPress={() => void handlePublishCarpool()}
                  style={[
                    styles.secondaryButton,
                    {
                      backgroundColor:
                        isPublishingCarpool || (!canOfferCarpool && editingCarpoolTripId == null)
                          ? '#C69171'
                          : CARPOOL_COLOR,
                    },
                  ]}>
                  <MaterialIcons name="directions-car-filled" size={20} color="#FFFFFF" />
                  <ThemedText style={styles.secondaryButtonText}>
                    {isPublishingCarpool
                      ? editingCarpoolTripId != null
                        ? 'Updating...'
                        : 'Publishing...'
                      : editingCarpoolTripId != null
                        ? 'Update carpool'
                        : !canOfferCarpool
                        ? 'Rider trip already active'
                        : 'Publish carpool'}
                  </ThemedText>
                </Pressable>
              </ScrollView>
            </View>
          </View>
        </Modal>

        <Modal transparent visible={summaryVisible} animationType="fade" onRequestClose={handleCloseSummary}>
          <View style={styles.modalBackdrop}>
            <View
              style={[
                styles.modalCard,
                {
                  backgroundColor: palette.card,
                  borderColor: palette.border,
                },
              ]}>
              <View style={styles.modalHeader}>
                <View style={{ flex: 1 }}>
                  <ThemedText type="title" style={[styles.modalTitle, { color: palette.text }]}>
                    Trip complete
                  </ThemedText>
                  <ThemedText style={{ color: palette.muted }}>
                    {summaryTrip?.originLabel} to {summaryTrip?.destinationLabel}
                  </ThemedText>
                </View>
                <Pressable onPress={handleCloseSummary}>
                  <MaterialIcons name="close" size={22} color={palette.text} />
                </Pressable>
              </View>

              <MapView
                ref={miniMapRef}
                style={styles.summaryMap}
                initialRegion={summaryRegion}
                scrollEnabled={false}
                zoomEnabled={false}
                rotateEnabled={false}
                pitchEnabled={false}>
                {summaryTrip?.pathPoints?.length ? (
                  <>
                    <Polyline
                      coordinates={summaryTrip.pathPoints}
                      strokeColor={selectedRoute?.color ?? palette.accent}
                      strokeWidth={5}
                    />
                    <Marker coordinate={summaryTrip.pathPoints[0]} title="Start" />
                    <Marker
                      coordinate={summaryTrip.pathPoints[summaryTrip.pathPoints.length - 1]}
                      title="Destination"
                    />
                  </>
                ) : null}
              </MapView>

              <View style={styles.metricRow}>
                <View style={styles.metricCard}>
                  <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>Time taken</ThemedText>
                  <ThemedText style={{ color: palette.text }}>
                    {summaryTrip ? formatDuration(summaryTrip.durationSeconds) : '--'}
                  </ThemedText>
                </View>
                <View style={styles.metricCard}>
                  <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>Distance</ThemedText>
                  <ThemedText style={{ color: palette.text }}>
                    {summaryTrip ? formatDistance(summaryTrip.distanceMeters) : '--'}
                  </ThemedText>
                </View>
                <View style={styles.metricCard}>
                  <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>CO2 emitted</ThemedText>
                  <ThemedText style={{ color: palette.text }}>
                    {summaryTrip ? formatCo2(summaryTrip.co2Kg) : '--'}
                  </ThemedText>
                </View>
              </View>

              <View
                style={[
                  styles.saveStatusCard,
                  {
                    backgroundColor: colorScheme === 'dark' ? '#122018' : '#F5FAF4',
                    borderColor: palette.border,
                  },
                ]}>
                {isSavingTrip ? (
                  <>
                    <ActivityIndicator color={palette.accent} />
                    <ThemedText style={{ color: palette.text, flex: 1 }}>
                      Saving this trip to your history...
                    </ThemedText>
                  </>
                ) : saveError ? (
                  <>
                    <MaterialIcons name="error-outline" size={18} color={palette.danger} />
                    <ThemedText style={{ color: palette.text, flex: 1 }}>{saveError}</ThemedText>
                  </>
                ) : (
                  <>
                    <MaterialIcons name="check-circle-outline" size={18} color={palette.accent} />
                    <ThemedText style={{ color: palette.text, flex: 1 }}>
                      {saveStatusMessage ?? 'Trip saved. It is now available in your history and the leaderboard.'}
                    </ThemedText>
                  </>
                )}
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  searchPanel: {
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 24,
    borderWidth: 1,
    padding: 18,
    gap: 14,
    shadowColor: '#000000',
    shadowOpacity: 0.14,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  searchPanelCompact: {
    alignSelf: 'center',
    marginTop: 8,
    padding: 14,
    gap: 10,
    width: '88%',
    maxWidth: 380,
  },
  simulationHud: {
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
    gap: 14,
    shadowColor: '#000000',
    shadowOpacity: 0.14,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  sharedSimulationHud: {
    marginTop: 6,
    padding: 12,
    gap: 10,
  },
  simulationHudHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  simulationHudIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(32, 116, 74, 0.12)',
  },
  simulationTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  simulationStatsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  simulationStatCard: {
    flex: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(127, 127, 127, 0.08)',
    gap: 4,
  },
  simulationFooter: {
    marginHorizontal: 16,
    marginTop: 'auto',
    marginBottom: 18,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  sharedSimulationFooter: {
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  compactHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  inputGroup: {
    gap: 6,
  },
  inputGroupCompact: {
    gap: 4,
  },
  originRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  input: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
  },
  inputCompact: {
    borderRadius: 14,
    paddingHorizontal: 11,
    paddingVertical: 10,
    fontSize: 13,
  },
  originInput: {
    flex: 1,
  },
  locationButton: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 14,
    width: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationButtonCompact: {
    minHeight: 44,
    borderRadius: 14,
    width: 44,
  },
  suggestionContainer: {
    borderWidth: 1,
    borderRadius: 18,
    marginTop: 6,
    overflow: 'hidden',
  },
  suggestionLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  suggestionTextBlock: {
    flex: 1,
    gap: 2,
  },
  suggestionPrimary: {
    fontWeight: '700',
  },
  suggestionDistanceBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  suggestionFooter: {
    fontSize: 12,
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  primaryButton: {
    borderRadius: 16,
    paddingVertical: 14,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  primaryButtonCompact: {
    borderRadius: 14,
    paddingVertical: 12,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  messageRow: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bottomSheet: {
    marginHorizontal: 16,
    marginTop: 'auto',
    marginBottom: 14,
    borderRadius: 28,
    borderWidth: 1,
    maxHeight: '46%',
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOpacity: 0.14,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  bottomSheetContent: {
    padding: 18,
    gap: 14,
  },
  modeTabs: {
    borderWidth: 1,
    borderRadius: 18,
    flexDirection: 'row',
    gap: 6,
    padding: 6,
    alignItems: 'center',
  },
  modeTab: {
    minHeight: 38,
    minWidth: 96,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
    flexShrink: 0,
  },
  modeTabText: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 14,
  },
  progressChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  sharedProgressChip: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  routeCard: {
    borderWidth: 1,
    borderRadius: 22,
    padding: 14,
    gap: 10,
  },
  routeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  routeIcon: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  routeSubtitle: {
    fontSize: 12,
    lineHeight: 16,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  metricRow: {
    flexDirection: 'row',
    gap: 10,
  },
  metricCard: {
    flex: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: 'rgba(127, 127, 127, 0.08)',
    gap: 4,
  },
  metricLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  metricValueSmall: {
    fontSize: 13,
    fontWeight: '600',
  },
  routeBodyText: {
    fontSize: 13,
    lineHeight: 18,
  },
  secondaryButton: {
    borderRadius: 16,
    paddingVertical: 13,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  secondaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  vehicleMarker: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  zoomControls: {
    position: 'absolute',
    right: 16,
    bottom: 96,
    gap: 10,
  },
  zoomLabelChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    shadowColor: '#000000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  zoomLabelText: {
    fontSize: 12,
    fontWeight: '700',
  },
  zoomButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    backgroundColor: 'rgba(4, 8, 6, 0.5)',
  },
  modalCard: {
    borderRadius: 28,
    borderWidth: 1,
    padding: 18,
    gap: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  modalTitle: {
    fontSize: 26,
    lineHeight: 28,
  },
  summaryMap: {
    height: 180,
    borderRadius: 20,
  },
  saveStatusCard: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  messageCard: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  carpoolSuggestionCard: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  carpoolHeroCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 14,
    gap: 12,
  },
  carpoolHeroHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  carpoolHeroIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  carpoolHeroMetricRow: {
    flexDirection: 'row',
    gap: 10,
  },
  carpoolHeroMetric: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 4,
  },
  carpoolHeroInsightRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  carpoolHeroInsightChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  carpoolJourneyRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  carpoolJourneyStep: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  carpoolJourneyStepText: {
    fontSize: 12,
    fontWeight: '700',
  },
  carpoolStatusCard: {
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  simulationStatusCard: {
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  sharedSimulationStatusCard: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 8,
  },
  sharedSimulationSummaryBar: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sharedSimulationSummaryItem: {
    flex: 1,
    gap: 2,
  },
  sharedSimulationDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: 'rgba(127, 127, 127, 0.2)',
  },
  carpoolStatusCopy: {
    flex: 1,
    gap: 4,
  },
  carpoolStatusBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  carpoolStatusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  carpoolActionRow: {
    gap: 10,
  },
  carpoolPrimaryButton: {
    borderRadius: 16,
    paddingVertical: 13,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  carpoolSecondaryButton: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 12,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  carpoolInfoChip: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  carpoolList: {
    gap: 12,
  },
  carpoolInsightPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  carpoolInsightPill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  carpoolMatchCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    gap: 8,
  },
  carpoolMatchHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  tripTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  routeTypeBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  tripMetricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  carpoolMapMarker: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  carpoolComposer: {
    gap: 14,
  },
  carpoolComposerRow: {
    flexDirection: 'row',
    gap: 12,
  },
  carpoolComposerField: {
    flex: 1,
    gap: 6,
  },
  recurrenceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  recurrenceChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
