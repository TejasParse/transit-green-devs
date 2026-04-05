import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useIsFocused } from '@react-navigation/native';
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

import { ProfileDropdown } from '@/components/profile-dropdown';
import { ThemedText } from '@/components/themed-text';
import { createTrip, requestCarpoolSeat, searchCarpools } from '@/lib/api';
import { formatCo2, formatDistance, formatDuration, formatTripDate } from '@/lib/formatters';
import { createAutocompleteSessionToken, fetchPlaceSuggestions } from '@/lib/google-places';
import { buildRoutePlan } from '@/lib/google-routes';
import { useUserProfile } from '@/context/user-context';
import {
  AddressSuggestion,
  CarpoolMatch,
  CarpoolRiderInput,
  RouteOption,
  RoutePlan,
  TripPayload,
  TripRecord,
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
const DEFAULT_SIMULATION_DURATION_SECONDS = 45;
const CARPOOL_REFRESH_INTERVAL_MS = 4000;

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

function getRouteIcon(kind: RouteOption['kind']): ComponentProps<typeof MaterialIcons>['name'] {
  switch (kind) {
    case 'walk':
      return 'directions-walk';
    case 'bike':
      return 'directions-bike';
    case 'transit':
      return 'directions-transit';
    case 'drive':
      return 'directions-car';
  }
}

function getTransportTabLabel(kind: RouteOption['kind'] | 'carpool') {
  if (kind === 'carpool') {
    return 'Carpool';
  }

  return getRouteTabLabel(kind);
}

function getTransportTabIcon(kind: RouteOption['kind'] | 'carpool'): ComponentProps<typeof MaterialIcons>['name'] {
  if (kind === 'carpool') {
    return 'groups';
  }

  return getRouteIcon(kind);
}

function getRouteModeLabel(kind: RouteOption['kind']) {
  switch (kind) {
    case 'walk':
      return 'Walking';
    case 'bike':
      return 'Cycling';
    case 'transit':
      return 'Transit';
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

function isVisibleCarpoolMatch(match: CarpoolMatch) {
  return match.status === 'scheduled' || Boolean(match.existingRequestStatus);
}


export default function MapScreen() {
  const isFocused = useIsFocused();
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

  const { userId, displayName, notifyTripSaved } = useUserProfile();

  const mapRef = useRef<MapView | null>(null);
  const miniMapRef = useRef<MapView | null>(null);
  const regionRef = useRef<Region>(DEFAULT_REGION);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tripStartedAtRef = useRef<string | null>(null);
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
  const [selectedMode, setSelectedMode] = useState<RouteOption['kind'] | 'carpool' | null>(null);
  const [carpoolMatches, setCarpoolMatches] = useState<CarpoolMatch[]>([]);
  const [selectedCarpoolTripId, setSelectedCarpoolTripId] = useState<number | null>(null);
  const [mapCarpoolRequest, setMapCarpoolRequest] = useState<CarpoolRiderInput | null>(null);
  const [hasLoadedCarpools, setHasLoadedCarpools] = useState(false);
  const [isSendingCarpoolRequest, setIsSendingCarpoolRequest] = useState<number | null>(null);
  const [isFetchingRoutes, setIsFetchingRoutes] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationPath, setSimulationPath] = useState<{ latitude: number; longitude: number }[] | null>(
    null
  );
  const [simulationIndex, setSimulationIndex] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [summaryTrip, setSummaryTrip] = useState<TripRecord | TripPayload | null>(null);
  const [summaryVisible, setSummaryVisible] = useState(false);
  const [isSavingTrip, setIsSavingTrip] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [simulationDurationInput, setSimulationDurationInput] = useState(
    String(DEFAULT_SIMULATION_DURATION_SECONDS)
  );

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

  const selectedRoute = routePlan?.options.find((route) => route.id === selectedRouteId) ?? null;
  const selectedCarpoolMatch =
    carpoolMatches.find((match) => match.tripId === selectedCarpoolTripId) ?? null;
  const isCarpoolMode = selectedMode === 'carpool';
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
  const canUseCurrentLocation = locationStatus === 'ready' && Boolean(currentLocation);

  function applyLiveCarpoolData(nextMatches: CarpoolMatch[]) {
    const visibleMatches = nextMatches.filter(isVisibleCarpoolMatch);

    setCarpoolMatches(visibleMatches);
    setSelectedCarpoolTripId((currentTripId) =>
      visibleMatches.some((match) => match.tripId === currentTripId)
        ? currentTripId
        : (visibleMatches[0]?.tripId ?? null)
    );
    setHasLoadedCarpools(true);
  }

  async function refreshLiveCarpools(options?: { suppressErrors?: boolean }) {
    if (!mapCarpoolRequest) {
      return;
    }

    try {
      const carpoolResult = await searchCarpools(mapCarpoolRequest);
      applyLiveCarpoolData(carpoolResult.matches);
    } catch (error) {
      if (!options?.suppressErrors) {
        setErrorMessage(
          error instanceof Error ? error.message : 'Unable to refresh live carpool updates.'
        );
      }
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
    if (!selectedRoute || isCarpoolMode) {
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
  }, [isCarpoolMode, selectedRouteId, selectedRoute]);

  useEffect(() => {
    if (!isCarpoolMode || !selectedCarpoolMatch?.pathPoints?.length) {
      return;
    }

    mapRef.current?.fitToCoordinates(selectedCarpoolMatch.pathPoints, {
      edgePadding: {
        top: 180,
        right: 48,
        bottom: 260,
        left: 48,
      },
      animated: true,
    });
  }, [isCarpoolMode, selectedCarpoolMatch]);

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
    if (!isFocused || !mapCarpoolRequest) {
      return;
    }

    const currentMapCarpoolRequest = mapCarpoolRequest;
    let isCancelled = false;
    let isRefreshing = false;

    async function pollLiveCarpools() {
      if (isRefreshing || isCancelled) {
        return;
      }

      isRefreshing = true;

      try {
        const carpoolResult = await searchCarpools(currentMapCarpoolRequest);

        if (!isCancelled) {
          applyLiveCarpoolData(carpoolResult.matches);
        }
      } catch {
        // Keep background refresh silent so the screen stays stable on transient failures.
      } finally {
        isRefreshing = false;
      }
    }

    void pollLiveCarpools();
    const interval = setInterval(() => {
      void pollLiveCarpools();
    }, CARPOOL_REFRESH_INTERVAL_MS);

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [isFocused, mapCarpoolRequest, userId]);

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
    setStatusMessage(null);
    setSaveError(null);
    setActiveField(null);
    setOriginSuggestions([]);
    setDestinationSuggestions([]);
    setIsFetchingRoutes(true);
    setIsSimulating(false);
    setSimulationPath(null);
    setSimulationIndex(0);
    setHasLoadedCarpools(false);
    setCarpoolMatches([]);
    setSelectedCarpoolTripId(null);
    setMapCarpoolRequest(null);

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
      setSelectedMode(nextRoutePlan.options[0]?.kind ?? null);
      const drivingOption = nextRoutePlan.options.find((option) => option.kind === 'drive');

      const nextCarpoolRequest: CarpoolRiderInput = {
        riderId: userId,
        pickupLabel: nextRoutePlan.originLabel,
        dropoffLabel: nextRoutePlan.destinationLabel,
        pickupPoint: nextRoutePlan.origin,
        dropoffPoint: nextRoutePlan.destination,
        routeDistanceMeters: drivingOption?.distanceMeters ?? null,
      };

      setMapCarpoolRequest(nextCarpoolRequest);

      try {
        const carpoolResult = await searchCarpools(nextCarpoolRequest);
        applyLiveCarpoolData(carpoolResult.matches);
      } catch {
        setCarpoolMatches([]);
      } finally {
        setHasLoadedCarpools(true);
      }
    } catch (error) {
      setRoutePlan(null);
      setSelectedRouteId(null);
      setSelectedMode(null);
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

    try {
      const savedTrip = await createTrip(tripPayload);
      setSummaryTrip(savedTrip);
      notifyTripSaved();
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : 'The trip finished, but saving it failed.'
      );
    } finally {
      setIsSavingTrip(false);
    }
  }

  function handleStartSimulation() {
    if (!selectedRoute) {
      return;
    }

    const simulationDurationSeconds = Number(simulationDurationInput);

    if (!Number.isFinite(simulationDurationSeconds) || simulationDurationSeconds <= 0) {
      setErrorMessage('Demo time must be greater than 0 seconds.');
      return;
    }

    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    const sampledPath = samplePolyline(selectedRoute.polyline);
    const intervalMs = Math.max(
      60,
      Math.round((simulationDurationSeconds * 1000) / Math.max(sampledPath.length - 1, 1))
    );

    setSaveError(null);
    setStatusMessage(null);
    setSummaryTrip(null);
    setSummaryVisible(false);
    setSimulationPath(sampledPath);
    setSimulationIndex(0);
    setIsSimulating(true);
    tripStartedAtRef.current = new Date().toISOString();

    timerRef.current = setInterval(() => {
      setSimulationIndex((current) => {
        const nextIndex = current + 1;

        if (nextIndex >= sampledPath.length) {
          if (timerRef.current) {
            clearInterval(timerRef.current);
          }

          setIsSimulating(false);
          void handleCompleteTrip(selectedRoute, selectedRoute.polyline);
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
    }, intervalMs);
  }

  async function handleSendCarpoolRequest(tripId: number) {
    if (!mapCarpoolRequest) {
      return;
    }

    setIsSendingCarpoolRequest(tripId);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      await requestCarpoolSeat(tripId, mapCarpoolRequest);
      setStatusMessage('Request sent. The host can accept it from the Carpool tab.');
      await refreshLiveCarpools();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to send the carpool request.'
      );
    } finally {
      setIsSendingCarpoolRequest(null);
    }
  }

  function handleCloseSummary() {
    setSummaryVisible(false);
    setSimulationPath(null);
    setSimulationIndex(0);
    setIsSimulating(false);
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
          {!isCarpoolMode
            ? routePlan?.options.map((route) => {
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
                    onPress={() => {
                      if (isSimulating) {
                        return;
                      }

                      setSelectedMode(route.kind);
                      setSelectedRouteId(route.id);
                    }}
                    zIndex={isSelected ? 5 : 2}
                  />
                );
              })
            : null}

          {isCarpoolMode && selectedCarpoolMatch ? (
            <Polyline
              coordinates={selectedCarpoolMatch.pathPoints}
              strokeColor={palette.accentAlt}
              strokeWidth={6}
              lineCap="round"
              lineJoin="round"
              zIndex={5}
            />
          ) : null}

          {!isCarpoolMode && selectedRoute ? (
            <>
              <Marker coordinate={selectedRoute.start} title="Start" description={routePlan?.originLabel} />
              <Marker
                coordinate={selectedRoute.end}
                title="Destination"
                description={routePlan?.destinationLabel}
              />
            </>
          ) : null}

          {isCarpoolMode && selectedCarpoolMatch ? (
            <>
              <Marker
                coordinate={mapCarpoolRequest?.pickupPoint ?? selectedCarpoolMatch.pathPoints[0]}
                title="Your pickup"
                description={mapCarpoolRequest?.pickupLabel ?? routePlan?.originLabel}
              />
              <Marker
                coordinate={
                  mapCarpoolRequest?.dropoffPoint ??
                  selectedCarpoolMatch.pathPoints[selectedCarpoolMatch.pathPoints.length - 1]
                }
                title="Your destination"
                description={mapCarpoolRequest?.dropoffLabel ?? routePlan?.destinationLabel}
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
                      {getRouteModeLabel(selectedRoute.kind)} navigation
                    </ThemedText>
                    <ThemedText style={{ color: palette.muted }}>
                      {routePlan?.originLabel} to {routePlan?.destinationLabel}
                    </ThemedText>
                  </View>
                  <View
                    style={[
                      styles.progressChip,
                      {
                        backgroundColor: colorScheme === 'dark' ? '#1A2D21' : '#EAF4ED',
                      },
                    ]}>
                    <MaterialIcons name="near-me" size={16} color={palette.accent} />
                    <ThemedText style={{ color: palette.text }}>{simulationProgress}%</ThemedText>
                  </View>
                </View>

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
              </View>

              <View
                style={[
                  styles.simulationFooter,
                  {
                    backgroundColor: palette.card,
                    borderColor: palette.border,
                  },
                ]}>
                <MaterialIcons name="navigation" size={18} color={selectedRoute.color} />
                <ThemedText style={{ color: palette.text, flex: 1 }}>
                  {getRouteFooterMessage(selectedRoute.kind)}
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

                <ProfileDropdown palette={palette} compact={shouldCompactSearchPanel} />

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

                <View
                  style={[
                    styles.simulationControlRow,
                    {
                      backgroundColor: palette.cardSecondary,
                      borderColor: palette.border,
                    },
                  ]}>
                  <View style={{ flex: 1 }}>
                    <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>
                      Demo Time
                    </ThemedText>
                    <ThemedText style={{ color: palette.text }}>
                      Choose how long the map replay should last.
                    </ThemedText>
                  </View>
                  <View style={styles.simulationDurationInputWrap}>
                    <TextInput
                      value={simulationDurationInput}
                      onChangeText={setSimulationDurationInput}
                      keyboardType="numbers-and-punctuation"
                      placeholder="45"
                      placeholderTextColor={palette.muted}
                      style={[
                        styles.simulationDurationInput,
                        {
                          color: palette.text,
                          backgroundColor: palette.input,
                          borderColor: palette.border,
                        },
                      ]}
                    />
                    <ThemedText style={{ color: palette.muted }}>sec</ThemedText>
                  </View>
                </View>

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

                {statusMessage ? (
                  <View
                    style={[
                      styles.messageRow,
                      {
                        backgroundColor: colorScheme === 'dark' ? '#15261B' : '#F0F8F2',
                        borderColor: colorScheme === 'dark' ? '#2C5A3B' : '#BFD8C4',
                      },
                    ]}>
                    <MaterialIcons name="check-circle-outline" size={18} color={palette.accent} />
                    <ThemedText style={{ color: palette.text, flex: 1 }}>{statusMessage}</ThemedText>
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
                    <View
                      style={[
                        styles.modeTabs,
                        {
                          backgroundColor: palette.cardSecondary,
                          borderColor: palette.border,
                        },
                      ]}>
                      {[
                        ...routePlan.options.map((route) => ({
                          key: route.kind,
                          route,
                          color: route.color,
                        })),
                        ...(hasLoadedCarpools
                          ? [
                              {
                                key: 'carpool' as const,
                                route: null,
                                color: palette.accentAlt,
                              },
                            ]
                          : []),
                      ].map((tab) => {
                        const isSelected = selectedMode === tab.key;

                        return (
                          <Pressable
                            key={tab.key}
                            disabled={isSimulating}
                            onPress={() => {
                              setSelectedMode(tab.key);
                              if (tab.route) {
                                setSelectedRouteId(tab.route.id);
                              }
                            }}
                            style={[
                              styles.modeTab,
                              isSelected
                                ? {
                                    backgroundColor: tab.color,
                                    borderColor: tab.color,
                                  }
                                : {
                                    backgroundColor: 'transparent',
                                    borderColor: 'transparent',
                                  },
                            ]}>
                            <MaterialIcons
                              name={getTransportTabIcon(tab.key)}
                              size={16}
                              color={isSelected ? '#FFFFFF' : tab.color}
                            />
                            <ThemedText
                              style={[
                                styles.modeTabText,
                                { color: isSelected ? '#FFFFFF' : palette.text },
                              ]}>
                              {getTransportTabLabel(tab.key)}
                            </ThemedText>
                          </Pressable>
                        );
                      })}
                    </View>

                    {!isCarpoolMode && selectedRoute ? (
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
                          onPress={handleStartSimulation}
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
                    ) : null}

                    {isCarpoolMode ? (
                      <View
                        style={[
                          styles.routeCard,
                          {
                            backgroundColor: palette.card,
                            borderColor: palette.accentAlt,
                          },
                        ]}>
                        <View style={styles.routeHeader}>
                          <View
                            style={[
                              styles.routeIcon,
                              {
                                backgroundColor: `${palette.accentAlt}20`,
                              },
                            ]}>
                            <MaterialIcons name="groups" size={22} color={palette.accentAlt} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <ThemedText style={[styles.routeTitle, { color: palette.text }]}>
                              Scheduled carpools
                            </ThemedText>
                            <ThemedText style={[styles.routeSubtitle, { color: palette.muted }]}>
                              Matching hosted trips for your source and destination.
                            </ThemedText>
                          </View>
                        </View>

                        {carpoolMatches.length === 0 ? (
                          <View
                            style={[
                              styles.messageRow,
                              {
                                backgroundColor: colorScheme === 'dark' ? '#1C241E' : '#F5FAF4',
                                borderColor: palette.border,
                              },
                            ]}>
                            <MaterialIcons name="search-off" size={18} color={palette.accentAlt} />
                            <ThemedText style={{ color: palette.text, flex: 1 }}>
                              No scheduled carpools match this trip yet. Try another route or host one from
                              the Carpool tab.
                            </ThemedText>
                          </View>
                        ) : (
                          carpoolMatches.map((match) => {
                            const isSelected = match.tripId === selectedCarpoolTripId;
                            const requestLabel = match.existingRequestStatus
                              ? 'Request already sent'
                              : isSendingCarpoolRequest === match.tripId
                                ? 'Sending request...'
                                : 'Send rider request';

                            return (
                              <View
                                key={match.tripId}
                                style={[
                                  styles.carpoolMatchCard,
                                  {
                                    backgroundColor: isSelected ? `${palette.accentAlt}16` : palette.cardSecondary,
                                    borderColor: isSelected ? palette.accentAlt : palette.border,
                                  },
                                ]}>
                                <View style={styles.routeHeader}>
                                  <View style={{ flex: 1 }}>
                                    <ThemedText style={[styles.routeTitle, { color: palette.text }]}>
                                      {match.hostDisplayName}
                                    </ThemedText>
                                    <ThemedText style={[styles.routeSubtitle, { color: palette.muted }]}>
                                      Host departs {formatTripDate(match.startedAt)}
                                    </ThemedText>
                                  </View>
                                  <View
                                    style={[
                                      styles.badge,
                                      { backgroundColor: `${palette.accentAlt}18` },
                                    ]}>
                                    <ThemedText style={[styles.badgeText, { color: palette.accentAlt }]}>
                                      {match.remainingSeats} seats
                                    </ThemedText>
                                  </View>
                                </View>

                                <View style={styles.metricRow}>
                                  <View style={styles.metricCard}>
                                    <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>Fare</ThemedText>
                                    <ThemedText style={[styles.metricValueSmall, { color: palette.text }]}>
                                      ${match.quotedPrice.toFixed(2)}
                                    </ThemedText>
                                  </View>
                                  <View style={styles.metricCard}>
                                    <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>
                                      Shared Time
                                    </ThemedText>
                                    <ThemedText style={[styles.metricValueSmall, { color: palette.text }]}>
                                      {formatDuration(match.durationSeconds)}
                                    </ThemedText>
                                  </View>
                                  <View style={styles.metricCard}>
                                    <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>
                                      Radius
                                    </ThemedText>
                                    <ThemedText style={[styles.metricValueSmall, { color: palette.text }]}>
                                      {match.maxDetourValue != null ? `${match.maxDetourValue} mi` : '--'}
                                    </ThemedText>
                                  </View>
                                </View>

                                <ThemedText style={[styles.routeBodyText, { color: palette.text }]}>
                                  Pickup gap {formatDistance(match.pickupDistanceMeters)} and drop-off gap{' '}
                                  {formatDistance(match.dropoffDistanceMeters)} from the host start/end radius.
                                </ThemedText>
                                <ThemedText style={[styles.routeBodyText, { color: palette.muted }]}>
                                  Host route: {match.originLabel} to {match.destinationLabel}. A rider can
                                  match when either endpoint falls inside the host radius.
                                </ThemedText>

                                <View style={styles.carpoolActionRow}>
                                  <Pressable
                                    onPress={() => {
                                      setSelectedCarpoolTripId(match.tripId);
                                      setSelectedMode('carpool');
                                    }}
                                    style={[
                                      styles.carpoolActionButton,
                                      {
                                        backgroundColor: isSelected ? palette.accentAlt : palette.card,
                                        borderColor: palette.border,
                                      },
                                    ]}>
                                    <MaterialIcons
                                      name="map"
                                      size={18}
                                      color={isSelected ? '#FFFFFF' : palette.text}
                                    />
                                    <ThemedText
                                      style={{ color: isSelected ? '#FFFFFF' : palette.text, fontWeight: '700' }}>
                                      {isSelected ? 'Showing on map' : 'Preview on map'}
                                    </ThemedText>
                                  </Pressable>

                                  <Pressable
                                    disabled={Boolean(match.existingRequestStatus) || isSendingCarpoolRequest === match.tripId}
                                    onPress={() => void handleSendCarpoolRequest(match.tripId)}
                                    style={[
                                      styles.carpoolActionButton,
                                      {
                                        backgroundColor:
                                          match.existingRequestStatus || isSendingCarpoolRequest === match.tripId
                                            ? '#98A59A'
                                            : palette.accentAlt,
                                        borderColor:
                                          match.existingRequestStatus || isSendingCarpoolRequest === match.tripId
                                            ? '#98A59A'
                                            : palette.accentAlt,
                                      },
                                    ]}>
                                    <MaterialIcons name="send" size={18} color="#FFFFFF" />
                                    <ThemedText style={{ color: '#FFFFFF', fontWeight: '700' }}>
                                      {requestLabel}
                                    </ThemedText>
                                  </Pressable>
                                </View>
                              </View>
                            );
                          })
                        )}
                      </View>
                    ) : null}
                  </ScrollView>
                </View>
              ) : null}
            </>
          )}
        </View>

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
                      Trip saved. It is now available in your history and the leaderboard.
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
  simulationControlRow: {
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  simulationDurationInputWrap: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  simulationDurationInput: {
    borderWidth: 1,
    borderRadius: 12,
    minWidth: 68,
    paddingHorizontal: 10,
    paddingVertical: 9,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
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
  },
  modeTab: {
    flex: 1,
    minHeight: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 8,
  },
  modeTabText: {
    fontSize: 12,
    fontWeight: '700',
  },
  progressChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  routeCard: {
    borderWidth: 1,
    borderRadius: 22,
    padding: 14,
    gap: 10,
  },
  carpoolMatchCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 12,
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
  carpoolActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  carpoolActionButton: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
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
});
