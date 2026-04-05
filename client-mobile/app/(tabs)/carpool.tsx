import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useIsFocused } from '@react-navigation/native';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import MapView, { Marker, Polyline, Region } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProfileDropdown } from '@/components/profile-dropdown';
import { ThemedText } from '@/components/themed-text';
import { useUserProfile } from '@/context/user-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  createCarpool,
  fetchCarpools,
  requestCarpoolSeat,
  respondToCarpoolSeatRequest,
  searchCarpools,
  updateCarpoolStatus,
} from '@/lib/api';
import { formatDistance, formatDuration, formatTripDate } from '@/lib/formatters';
import { createAutocompleteSessionToken, fetchPlaceSuggestions } from '@/lib/google-places';
import { buildDriveRoutePreview, buildDriveRouteTimeline } from '@/lib/google-routes';
import {
  AddressSuggestion,
  CarpoolOverview,
  CarpoolRiderInput,
  CarpoolSearchResult,
  Coordinates,
  HostedCarpoolTrip,
  WaypointInput,
} from '@/types/trips';

const DEFAULT_REGION: Region = {
  latitude: 33.4234,
  longitude: -111.94,
  latitudeDelta: 0.12,
  longitudeDelta: 0.12,
};
const CARPOOL_REFRESH_INTERVAL_MS = 4000;
const DEFAULT_CARPOOL_SIMULATION_SECONDS = 45;

type HostTripsTab = 'open' | 'history';

type PlaceFieldState = ReturnType<typeof usePlaceField>;
type DriveRoutePreview = Awaited<ReturnType<typeof buildDriveRoutePreview>>;
type DriveRouteTimeline = Awaited<ReturnType<typeof buildDriveRouteTimeline>>;
type RiderStopProgress = {
  pickupIndex: number;
  dropoffIndex: number;
};
type CarpoolSimulationState = {
  trip: HostedCarpoolTrip;
  pathPoints: Coordinates[];
  timeline: DriveRouteTimeline | null;
  riderStopProgress: Record<number, RiderStopProgress>;
};

async function loadCarpoolScreenData(
  userId: number,
  riderInput: CarpoolRiderInput | null
): Promise<{
  overview: CarpoolOverview;
  riderSearchResult: CarpoolSearchResult | null;
}> {
  const [overview, riderSearchResult] = await Promise.all([
    fetchCarpools(userId),
    riderInput ? searchCarpools(riderInput) : Promise.resolve(null),
  ]);

  return {
    overview,
    riderSearchResult,
  };
}

async function buildCarpoolSimulationState(
  trip: HostedCarpoolTrip
): Promise<CarpoolSimulationState> {
  if (!Array.isArray(trip.pathPoints) || trip.pathPoints.length < 2) {
    throw new Error('This hosted carpool is missing a valid host route.');
  }

  const acceptedRequests = [...trip.requests]
    .filter((request) => request.status === 'accepted')
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());

  if (acceptedRequests.length === 0) {
    return {
      trip,
      pathPoints: trip.pathPoints,
      timeline: null,
      riderStopProgress: {},
    };
  }

  const stops: {
    kind: 'host-origin' | 'pickup' | 'dropoff' | 'host-destination';
    label: string;
    point: Coordinates;
    requestId?: number;
  }[] = [
    {
      kind: 'host-origin',
      label: trip.originLabel,
      point: trip.pathPoints[0],
    },
    ...acceptedRequests.flatMap((request) => [
      {
        kind: 'pickup' as const,
        label: request.pickupLabel,
        point: request.pickupPoint,
        requestId: request.id,
      },
      {
        kind: 'dropoff' as const,
        label: request.dropoffLabel,
        point: request.dropoffPoint,
        requestId: request.id,
      },
    ]),
    {
      kind: 'host-destination',
      label: trip.destinationLabel,
      point: trip.pathPoints[trip.pathPoints.length - 1],
    },
  ];

  const timeline = await buildDriveRouteTimeline(
    stops.map((stop) => ({
      label: stop.label,
      point: stop.point,
    }))
  );
  const riderStopProgress: Record<number, RiderStopProgress> = {};

  stops.forEach((stop, index) => {
    if (stop.requestId == null) {
      return;
    }

    const stopPathIndex = timeline.stopPathIndices[index] ?? 0;
    const currentProgress = riderStopProgress[stop.requestId] ?? {
      pickupIndex: stopPathIndex,
      dropoffIndex: stopPathIndex,
    };

    if (stop.kind === 'pickup') {
      currentProgress.pickupIndex = stopPathIndex;
    }

    if (stop.kind === 'dropoff') {
      currentProgress.dropoffIndex = stopPathIndex;
    }

    riderStopProgress[stop.requestId] = currentProgress;
  });

  return {
    trip,
    pathPoints: timeline.pathPoints.length > 0 ? timeline.pathPoints : trip.pathPoints,
    timeline,
    riderStopProgress,
  };
}

function buildRegion(points: Coordinates[]): Region {
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
    latitudeDelta: Math.max((maxLatitude - minLatitude) * 1.7, 0.05),
    longitudeDelta: Math.max((maxLongitude - minLongitude) * 1.7, 0.05),
  };
}

function formatCurrency(amount: number) {
  return `$${amount.toFixed(2)}`;
}

function formatMiles(meters: number) {
  return `${(meters / 1609.34).toFixed(1)} mi`;
}

function formatRadius(value: number | null) {
  if (value == null) {
    return 'No match radius';
  }

  return `${value} mi host radius`;
}

function getSimulationDurationSeconds(trip: HostedCarpoolTrip) {
  const metadataDuration = Number(trip.metadata?.simulationDurationSeconds);

  if (Number.isFinite(metadataDuration) && metadataDuration > 0) {
    return Math.round(metadataDuration);
  }

  return Math.max(20, Math.round(trip.durationSeconds / Math.max(trip.simulationSpeedMultiplier, 0.25)));
}

function getHostTripsTabCopy(tab: HostTripsTab) {
  return tab === 'open' ? 'Scheduled & active' : 'Ended & cancelled';
}

function getWaypoint(field: PlaceFieldState): WaypointInput | null {
  const trimmedValue = field.value.trim();

  if (!trimmedValue) {
    return null;
  }

  if (field.selectedSuggestion?.placeId) {
    return {
      type: 'placeId',
      placeId: field.selectedSuggestion.placeId,
    };
  }

  return {
    type: 'address',
    address: trimmedValue,
  };
}

function usePlaceField() {
  const sessionTokenRef = useRef(createAutocompleteSessionToken());
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [value, setValue] = useState('');
  const [selectedSuggestion, setSelectedSuggestion] = useState<AddressSuggestion | null>(null);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [isFocused, setIsFocused] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    const query = value.trim();

    if (!isFocused || query.length < 2 || selectedSuggestion?.fullText === query) {
      setSuggestions([]);
      setIsSearching(false);
      return;
    }

    let isCancelled = false;
    const timeout = setTimeout(async () => {
      setIsSearching(true);

      try {
        const nextSuggestions = await fetchPlaceSuggestions({
          input: query,
          sessionToken: sessionTokenRef.current,
        });

        if (!isCancelled) {
          setSuggestions(nextSuggestions);
        }
      } catch {
        if (!isCancelled) {
          setSuggestions([]);
        }
      } finally {
        if (!isCancelled) {
          setIsSearching(false);
        }
      }
    }, 250);

    return () => {
      isCancelled = true;
      clearTimeout(timeout);
    };
  }, [isFocused, selectedSuggestion?.fullText, value]);

  useEffect(
    () => () => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
    },
    []
  );

  function clearBlurTimeout() {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
  }

  function scheduleBlur() {
    clearBlurTimeout();
    blurTimeoutRef.current = setTimeout(() => {
      setIsFocused(false);
    }, 150);
  }

  function onChangeText(nextValue: string) {
    clearBlurTimeout();
    setIsFocused(true);
    setSelectedSuggestion(null);
    setValue(nextValue);
  }

  function selectSuggestion(suggestion: AddressSuggestion) {
    clearBlurTimeout();
    setValue(suggestion.fullText);
    setSelectedSuggestion(suggestion);
    setSuggestions([]);
    setIsFocused(false);
    sessionTokenRef.current = createAutocompleteSessionToken();
  }

  function reset() {
    clearBlurTimeout();
    setValue('');
    setSelectedSuggestion(null);
    setSuggestions([]);
    setIsFocused(false);
    sessionTokenRef.current = createAutocompleteSessionToken();
  }

  return {
    value,
    setValue,
    selectedSuggestion,
    suggestions,
    isFocused,
    isSearching,
    clearBlurTimeout,
    scheduleBlur,
    onFocus: () => {
      clearBlurTimeout();
      setIsFocused(true);
    },
    onChangeText,
    selectSuggestion,
    reset,
    showSuggestions: isFocused && value.trim().length >= 2,
  };
}

export default function CarpoolScreen() {
  const colorScheme = useColorScheme();
  const isFocused = useIsFocused();
  const {
    activeProfile,
    displayName,
    notifyTripSaved,
    refreshProfiles,
    tripVersion,
    userId,
  } = useUserProfile();
  const simulationMapRef = useRef<MapView | null>(null);
  const simulationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hostOriginField = usePlaceField();
  const hostDestinationField = usePlaceField();
  const riderPickupField = usePlaceField();
  const riderDropoffField = usePlaceField();

  const [overview, setOverview] = useState<CarpoolOverview>({ hostTrips: [], riderRequests: [] });
  const [isOverviewLoading, setIsOverviewLoading] = useState(true);
  const [isRefreshingOverview, setIsRefreshingOverview] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);

  const [hostRoutePreview, setHostRoutePreview] = useState<DriveRoutePreview | null>(null);
  const [isPlanningHostRoute, setIsPlanningHostRoute] = useState(false);
  const [hostFormError, setHostFormError] = useState<string | null>(null);
  const [availableSeatsInput, setAvailableSeatsInput] = useState('2');
  const [detourLimitInput, setDetourLimitInput] = useState('1.0');
  const [pricePerMileInput, setPricePerMileInput] = useState('1.10');
  const [startDelayMinutesInput, setStartDelayMinutesInput] = useState('60');
  const [simulationDurationInput, setSimulationDurationInput] = useState(
    String(DEFAULT_CARPOOL_SIMULATION_SECONDS)
  );
  const [isCreatingCarpool, setIsCreatingCarpool] = useState(false);
  const [hostTripsTab, setHostTripsTab] = useState<HostTripsTab>('open');

  const [isSearchingMatches, setIsSearchingMatches] = useState(false);
  const [riderSearchError, setRiderSearchError] = useState<string | null>(null);
  const [riderSearchResult, setRiderSearchResult] = useState<CarpoolSearchResult | null>(null);
  const [resolvedRiderInput, setResolvedRiderInput] = useState<CarpoolRiderInput | null>(null);
  const [requestingTripId, setRequestingTripId] = useState<number | null>(null);
  const [respondingRequestId, setRespondingRequestId] = useState<number | null>(null);

  const [simulationState, setSimulationState] = useState<CarpoolSimulationState | null>(null);
  const [simulationIndex, setSimulationIndex] = useState(0);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationError, setSimulationError] = useState<string | null>(null);
  const simulationTrip = simulationState?.trip ?? null;

  const palette =
    colorScheme === 'dark'
      ? {
          background: '#0C1410',
          card: '#14211A',
          cardSecondary: '#1A2B21',
          border: '#2D4136',
          text: '#EAF5EE',
          muted: '#A2B6A8',
          accent: '#4DA86D',
          accentAlt: '#D29A43',
          warning: '#F1C05E',
          danger: '#E26E64',
          input: '#102019',
          mapSurface: '#0E1813',
        }
      : {
          background: '#EFF4EE',
          card: '#FFFFFF',
          cardSecondary: '#F3F8F2',
          border: '#D5E0D4',
          text: '#173126',
          muted: '#5C7265',
          accent: '#20744A',
          accentAlt: '#BE7B1C',
          warning: '#B98019',
          danger: '#C6473A',
          input: '#F8FBF7',
          mapSurface: '#E6EFE4',
        };

  useEffect(() => {
    if (!isFocused) {
      return;
    }

    let isMounted = true;

    async function loadOverview() {
      setIsOverviewLoading(true);
      setOverviewError(null);

      try {
        const nextData = await loadCarpoolScreenData(userId, resolvedRiderInput);

        if (isMounted) {
          applyCarpoolScreenData(nextData);
        }
      } catch (error) {
        if (isMounted) {
          setOverviewError(
            error instanceof Error ? error.message : 'Unable to load hosted carpools right now.'
          );
        }
      } finally {
        if (isMounted) {
          setIsOverviewLoading(false);
        }
      }
    }

    void loadOverview();

    return () => {
      isMounted = false;
    };
  }, [isFocused, resolvedRiderInput, tripVersion, userId]);

  useEffect(() => {
    if (!isFocused) {
      return;
    }

    let isCancelled = false;
    let isRefreshing = false;

    async function pollOverview() {
      if (isRefreshing) {
        return;
      }

      isRefreshing = true;

      try {
        const nextData = await loadCarpoolScreenData(userId, resolvedRiderInput);

        if (!isCancelled) {
          applyCarpoolScreenData(nextData);
        }
      } catch {
        // Keep polling silent so transient refresh failures do not thrash the UI.
      } finally {
        isRefreshing = false;
      }
    }

    const interval = setInterval(() => {
      void pollOverview();
    }, CARPOOL_REFRESH_INTERVAL_MS);

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [isFocused, resolvedRiderInput, userId]);

  useEffect(() => {
    if (!simulationState?.pathPoints?.length) {
      return;
    }

    const timeout = setTimeout(() => {
      simulationMapRef.current?.fitToCoordinates(simulationState.pathPoints, {
        edgePadding: {
          top: 30,
          right: 30,
          bottom: 30,
          left: 30,
        },
        animated: false,
      });
    }, 180);

    return () => clearTimeout(timeout);
  }, [simulationState]);

  useEffect(
    () => () => {
      if (simulationTimerRef.current) {
        clearInterval(simulationTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (simulationTimerRef.current) {
      clearInterval(simulationTimerRef.current);
    }

    setSimulationState(null);
    setSimulationIndex(0);
    setIsSimulating(false);
    setSimulationError(null);
    setRiderSearchResult(null);
    setResolvedRiderInput(null);
    setRiderSearchError(null);
    setHostFormError(null);
  }, [userId]);

  const acceptedSimulationRequests = useMemo(
    () =>
      [...(simulationTrip?.requests.filter((request) => request.status === 'accepted') ?? [])].sort(
        (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
      ),
    [simulationTrip]
  );
  const openHostTrips = useMemo(
    () => overview.hostTrips.filter((trip) => trip.status === 'scheduled' || trip.status === 'active'),
    [overview.hostTrips]
  );
  const archivedHostTrips = useMemo(
    () => overview.hostTrips.filter((trip) => trip.status === 'ended' || trip.status === 'cancelled'),
    [overview.hostTrips]
  );
  const simulationPath = simulationState?.pathPoints ?? [];
  const simulationMarker =
    simulationPath.length > 0
      ? simulationPath[Math.min(simulationIndex, simulationPath.length - 1)]
      : null;
  const simulationProgress = simulationPath.length
    ? Math.round((simulationIndex / Math.max(simulationPath.length - 1, 1)) * 100)
    : 0;

  function applyCarpoolScreenData(data: {
    overview: CarpoolOverview;
    riderSearchResult: CarpoolSearchResult | null;
  }) {
    setOverview(data.overview);

    if (data.riderSearchResult) {
      setRiderSearchResult(data.riderSearchResult);
      setRiderSearchError(null);
    }

    setLastRefreshedAt(new Date().toISOString());
  }

  function renderHostedTripCard(trip: HostedCarpoolTrip) {
    return (
      <View
        key={trip.id}
        style={[styles.tripCard, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
        <View style={styles.sectionHeaderRow}>
          <View style={{ flex: 1 }}>
            <ThemedText style={{ color: palette.text, fontWeight: '700' }}>{trip.routeTitle}</ThemedText>
            <ThemedText style={{ color: palette.muted }}>
              {trip.originLabel} to {trip.destinationLabel}
            </ThemedText>
          </View>
          <View
            style={[
              styles.statusBadge,
              {
                backgroundColor: `${trip.status === 'active' ? palette.accent : palette.accentAlt}18`,
                borderColor: trip.status === 'active' ? palette.accent : palette.accentAlt,
              },
            ]}>
            <ThemedText
              style={{
                color: trip.status === 'active' ? palette.accent : palette.accentAlt,
                fontWeight: '700',
                textTransform: 'capitalize',
              }}>
              {trip.status}
            </ThemedText>
          </View>
        </View>

        <ThemedText style={{ color: palette.text }}>
          {formatDuration(trip.durationSeconds)} | {formatDistance(trip.distanceMeters)} |{' '}
          {formatTripDate(trip.startedAt)}
        </ThemedText>
        <ThemedText style={{ color: palette.muted }}>
          {trip.remainingSeats} seats left | {formatRadius(trip.maxDetourValue)} |{' '}
          {trip.pricePerSeatMile != null ? `${formatCurrency(trip.pricePerSeatMile)}/mi` : 'No fare set'}
        </ThemedText>
        <ThemedText style={{ color: palette.muted }}>
          Simulation replay: about {getSimulationDurationSeconds(trip)} seconds on the full map
        </ThemedText>

        <View style={styles.tripActionRow}>
          {trip.status !== 'cancelled' ? (
            <Pressable
              disabled={isSimulating}
              onPress={() => void handleStartSimulation(trip)}
              style={[
                styles.actionButton,
                { backgroundColor: isSimulating ? '#8FA99A' : palette.accent },
              ]}>
              <MaterialIcons name="play-arrow" size={18} color="#FFFFFF" />
              <ThemedText style={styles.actionButtonText}>
                {trip.status === 'ended' ? 'Replay on map' : 'Simulate on map'}
              </ThemedText>
            </Pressable>
          ) : null}
          {trip.status === 'scheduled' ? (
            <Pressable
              disabled={isSimulating}
              onPress={() => void handleCancelTrip(trip.id)}
              style={[
                styles.actionButton,
                { backgroundColor: isSimulating ? '#B79E9A' : palette.danger },
              ]}>
              <MaterialIcons name="cancel" size={18} color="#FFFFFF" />
              <ThemedText style={styles.actionButtonText}>Cancel</ThemedText>
            </Pressable>
          ) : null}
        </View>

        {trip.requests.length === 0 ? (
          <ThemedText style={{ color: palette.muted }}>
            No rider requests yet. The trip will still simulate with only the host route.
          </ThemedText>
        ) : (
          trip.requests.map((request) => (
            <View
              key={request.id}
              style={[styles.requestRow, { backgroundColor: palette.card, borderColor: palette.border }]}>
              <View style={{ flex: 1 }}>
                <ThemedText style={{ color: palette.text, fontWeight: '700' }}>
                  {request.riderDisplayName ?? 'Rider'}
                </ThemedText>
                <ThemedText style={{ color: palette.muted }}>
                  {request.pickupLabel} to {request.dropoffLabel}
                </ThemedText>
                <ThemedText style={{ color: palette.text }}>
                  Pickup gap {formatMiles(request.pickupDistanceMeters)} | Drop-off gap{' '}
                  {formatMiles(request.dropoffDistanceMeters)} | Fare {formatCurrency(request.quotedPrice)}
                </ThemedText>
              </View>
              {request.status === 'pending' ? (
                <View style={styles.pendingActionColumn}>
                  <Pressable
                    disabled={respondingRequestId === request.id}
                    onPress={() => void handleRespondToRequest(trip.id, request.id, 'accept')}
                    style={[styles.miniActionButton, { backgroundColor: palette.accent }]}>
                    <MaterialIcons name="check" size={16} color="#FFFFFF" />
                  </Pressable>
                  <Pressable
                    disabled={respondingRequestId === request.id}
                    onPress={() => void handleRespondToRequest(trip.id, request.id, 'decline')}
                    style={[styles.miniActionButton, { backgroundColor: palette.danger }]}>
                    <MaterialIcons name="close" size={16} color="#FFFFFF" />
                  </Pressable>
                </View>
              ) : (
                <View
                  style={[
                    styles.statusBadge,
                    {
                      backgroundColor: `${request.status === 'accepted' ? palette.accent : palette.accentAlt}18`,
                      borderColor:
                        request.status === 'accepted' ? palette.accent : palette.accentAlt,
                    },
                  ]}>
                  <ThemedText
                    style={{
                      color: request.status === 'accepted' ? palette.accent : palette.accentAlt,
                      fontWeight: '700',
                      textTransform: 'capitalize',
                    }}>
                    {request.status}
                  </ThemedText>
                </View>
              )}
            </View>
          ))
        )}
      </View>
    );
  }

  async function reloadOverview(options?: {
    showRefreshingIndicator?: boolean;
    refreshMatches?: boolean;
  }) {
    const { showRefreshingIndicator = false, refreshMatches = Boolean(resolvedRiderInput) } =
      options ?? {};

    setOverviewError(null);

    if (showRefreshingIndicator) {
      setIsRefreshingOverview(true);
    }

    try {
      const nextData = await loadCarpoolScreenData(
        userId,
        refreshMatches ? resolvedRiderInput : null
      );
      applyCarpoolScreenData(nextData);
    } catch (error) {
      setOverviewError(
        error instanceof Error ? error.message : 'Unable to refresh hosted carpools right now.'
      );
    } finally {
      if (showRefreshingIndicator) {
        setIsRefreshingOverview(false);
      }
    }
  }

  function renderSuggestionList(
    field: PlaceFieldState,
    emptyText: string,
    onSelect: (suggestion: AddressSuggestion) => void
  ) {
    if (field.isSearching) {
      return (
        <View
          style={[
            styles.suggestionContainer,
            { backgroundColor: palette.cardSecondary, borderColor: palette.border },
          ]}>
          <View style={styles.suggestionLoadingRow}>
            <ActivityIndicator color={palette.accent} size="small" />
            <ThemedText style={{ color: palette.text }}>Searching addresses...</ThemedText>
          </View>
        </View>
      );
    }

    if (field.suggestions.length === 0) {
      return (
        <View
          style={[
            styles.suggestionContainer,
            { backgroundColor: palette.cardSecondary, borderColor: palette.border },
          ]}>
          <ThemedText style={{ color: palette.muted }}>{emptyText}</ThemedText>
        </View>
      );
    }

    return (
      <View
        style={[
          styles.suggestionContainer,
          { backgroundColor: palette.cardSecondary, borderColor: palette.border },
        ]}>
        {field.suggestions.map((suggestion, index) => (
          <Pressable
            key={suggestion.id}
            onPressIn={field.clearBlurTimeout}
            onPress={() => onSelect(suggestion)}
            style={[
              styles.suggestionRow,
              index < field.suggestions.length - 1
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
          </Pressable>
        ))}
      </View>
    );
  }

  async function handlePlanHostRoute() {
    const origin = getWaypoint(hostOriginField);
    const destination = getWaypoint(hostDestinationField);

    if (!origin || !destination) {
      setHostFormError('Choose both an origin and destination for the host route.');
      return;
    }

    setHostFormError(null);
    setIsPlanningHostRoute(true);

    try {
      const preview = await buildDriveRoutePreview({
        origin,
        destination,
        originLabel: hostOriginField.value.trim(),
        destinationLabel: hostDestinationField.value.trim(),
      });

      setHostRoutePreview(preview);
    } catch (error) {
      setHostRoutePreview(null);
      setHostFormError(
        error instanceof Error ? error.message : 'Unable to plan the host route right now.'
      );
    } finally {
      setIsPlanningHostRoute(false);
    }
  }

  async function handleCreateHostedCarpool() {
    if (!hostRoutePreview) {
      setHostFormError('Plan the host route before creating a carpool.');
      return;
    }

    const availableSeats = Number(availableSeatsInput);
    const detourLimit = Number(detourLimitInput);
    const pricePerMile = Number(pricePerMileInput);
    const startDelayMinutes = Number(startDelayMinutesInput);
    const simulationDurationSeconds = Number(simulationDurationInput);

    if (!Number.isInteger(availableSeats) || availableSeats <= 0) {
      setHostFormError('Available seats must be a positive whole number.');
      return;
    }

    if (!Number.isFinite(detourLimit) || detourLimit <= 0) {
      setHostFormError('Match radius must be greater than 0 miles.');
      return;
    }

    if (!Number.isFinite(pricePerMile) || pricePerMile <= 0) {
      setHostFormError('Price per rider mile must be greater than 0.');
      return;
    }

    if (!Number.isFinite(startDelayMinutes) || startDelayMinutes < 0) {
      setHostFormError('Start delay must be 0 or greater.');
      return;
    }

    if (!Number.isFinite(simulationDurationSeconds) || simulationDurationSeconds <= 0) {
      setHostFormError('Simulation time must be greater than 0 seconds.');
      return;
    }

    setIsCreatingCarpool(true);
    setHostFormError(null);

    try {
      const startedAt = new Date(Date.now() + startDelayMinutes * 60_000);
      const completedAt = new Date(startedAt.getTime() + hostRoutePreview.option.durationSeconds * 1000);
      const simulationSpeedMultiplier = Number(
        (hostRoutePreview.option.durationSeconds / simulationDurationSeconds).toFixed(2)
      );

      await createCarpool({
        userId,
        displayName,
        routeType: 'drive',
        routeTitle: 'Hosted carpool drive',
        originLabel: hostRoutePreview.originLabel,
        destinationLabel: hostRoutePreview.destinationLabel,
        distanceMeters: hostRoutePreview.option.distanceMeters,
        durationSeconds: hostRoutePreview.option.durationSeconds,
        co2Kg: hostRoutePreview.option.co2Kg,
        co2SavedKg: hostRoutePreview.option.co2SavedKg,
        availableSeats,
        carpoolEnabled: true,
        maxDetourType: 'distance',
        maxDetourValue: detourLimit,
        pricePerSeatMile: Number(pricePerMile.toFixed(2)),
        simulationSpeedMultiplier,
        status: 'scheduled',
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        pathPoints: hostRoutePreview.option.polyline,
        metadata: {
          badges: ['Hosted carpool', 'Scheduled ride'],
          summary: 'Driver-hosted carpool scheduled from the mobile demo.',
          simulationDurationSeconds: Math.round(simulationDurationSeconds),
          hostOriginPoint: hostRoutePreview.origin,
          hostDestinationPoint: hostRoutePreview.destination,
        },
      });

      hostOriginField.reset();
      hostDestinationField.reset();
      setHostRoutePreview(null);
      setAvailableSeatsInput('2');
      setDetourLimitInput('1.0');
      setPricePerMileInput('1.10');
      setStartDelayMinutesInput('60');
      setSimulationDurationInput(String(DEFAULT_CARPOOL_SIMULATION_SECONDS));
      await reloadOverview();
    } catch (error) {
      setHostFormError(
        error instanceof Error ? error.message : 'Unable to create the hosted carpool.'
      );
    } finally {
      setIsCreatingCarpool(false);
    }
  }

  async function handleFindMatches() {
    const pickup = getWaypoint(riderPickupField);
    const dropoff = getWaypoint(riderDropoffField);

    if (!pickup || !dropoff) {
      setRiderSearchError('Choose both rider pickup and dropoff before matching.');
      return;
    }

    setIsSearchingMatches(true);
    setRiderSearchError(null);

    try {
      const preview = await buildDriveRoutePreview({
        origin: pickup,
        destination: dropoff,
        originLabel: riderPickupField.value.trim(),
        destinationLabel: riderDropoffField.value.trim(),
      });
      const nextRiderInput: CarpoolRiderInput = {
        riderId: userId,
        pickupLabel: preview.originLabel,
        dropoffLabel: preview.destinationLabel,
        pickupPoint: preview.origin,
        dropoffPoint: preview.destination,
        routeDistanceMeters: preview.option.distanceMeters,
      };
      const result = await searchCarpools(nextRiderInput);

      setResolvedRiderInput(nextRiderInput);
      setRiderSearchResult(result);
    } catch (error) {
      setRiderSearchResult(null);
      setResolvedRiderInput(null);
      setRiderSearchError(
        error instanceof Error ? error.message : 'Unable to match rider pickup with hosted carpools.'
      );
    } finally {
      setIsSearchingMatches(false);
    }
  }

  async function handleSendRequest(tripId: number) {
    if (!resolvedRiderInput) {
      return;
    }

    setRequestingTripId(tripId);

    try {
      await requestCarpoolSeat(tripId, resolvedRiderInput);
      await reloadOverview();

      if (riderSearchResult) {
        const nextMatches = riderSearchResult.matches.map((match) =>
          match.tripId === tripId
            ? { ...match, existingRequestStatus: 'pending' as const }
            : match
        );
        setRiderSearchResult({ ...riderSearchResult, matches: nextMatches });
      }
    } catch (error) {
      setRiderSearchError(
        error instanceof Error ? error.message : 'Unable to send the rider request.'
      );
    } finally {
      setRequestingTripId(null);
    }
  }

  async function handleRespondToRequest(
    tripId: number,
    requestId: number,
    action: 'accept' | 'decline'
  ) {
    setRespondingRequestId(requestId);

    try {
      await respondToCarpoolSeatRequest(tripId, requestId, {
        hostId: userId,
        action,
      });
      await reloadOverview();
    } catch (error) {
      setOverviewError(
        error instanceof Error ? error.message : 'Unable to respond to the rider request.'
      );
    } finally {
      setRespondingRequestId(null);
    }
  }

  async function finishSimulation(trip: HostedCarpoolTrip) {
    setIsSimulating(false);

    try {
      if (trip.status !== 'ended') {
        const completedTrip = await updateCarpoolStatus(trip.id, {
          hostId: userId,
          status: 'ended',
          completedAt: new Date().toISOString(),
          simulationSpeedMultiplier: trip.simulationSpeedMultiplier,
        });
        setSimulationState((currentState) =>
          currentState
            ? {
                ...currentState,
                trip: completedTrip,
              }
            : currentState
        );
        notifyTripSaved();
        await refreshProfiles();
        await reloadOverview();
      }
    } catch (error) {
      setSimulationError(
        error instanceof Error ? error.message : 'The carpool finished locally, but syncing failed.'
      );
    }
  }

  async function handleStartSimulation(trip: HostedCarpoolTrip) {
    if (simulationTimerRef.current) {
      clearInterval(simulationTimerRef.current);
    }

    setSimulationError(null);

    try {
      let nextTrip = trip;

      if (trip.status === 'scheduled') {
        nextTrip = await updateCarpoolStatus(trip.id, {
          hostId: userId,
          status: 'active',
          startedAt: new Date().toISOString(),
          simulationSpeedMultiplier: trip.simulationSpeedMultiplier,
        });
        await reloadOverview();
      }

      const nextSimulationState = await buildCarpoolSimulationState(nextTrip);

      setSimulationState(nextSimulationState);
      setSimulationIndex(0);
      setIsSimulating(true);

      const simulationDurationSeconds = getSimulationDurationSeconds(nextTrip);
      const intervalMs = Math.max(
        60,
        Math.round(
          (simulationDurationSeconds * 1000) /
            Math.max(nextSimulationState.pathPoints.length - 1, 1)
        )
      );

      simulationTimerRef.current = setInterval(() => {
        setSimulationIndex((currentIndex) => {
          const nextIndex = currentIndex + 1;

          if (nextIndex >= nextSimulationState.pathPoints.length) {
            if (simulationTimerRef.current) {
              clearInterval(simulationTimerRef.current);
            }

            void finishSimulation(nextTrip);
            return Math.max(nextSimulationState.pathPoints.length - 1, 0);
          }

          if (nextIndex % 8 === 0) {
            const nextPoint = nextSimulationState.pathPoints[nextIndex];

            simulationMapRef.current?.animateToRegion(
              {
                ...nextPoint,
                latitudeDelta: 0.03,
                longitudeDelta: 0.03,
              },
              220
            );
          }

          return nextIndex;
        });
      }, intervalMs);
    } catch (error) {
      setSimulationError(
        error instanceof Error ? error.message : 'Unable to start the hosted carpool simulation.'
      );
    }
  }

  async function handleCancelTrip(tripId: number) {
    try {
      await updateCarpoolStatus(tripId, {
        hostId: userId,
        status: 'cancelled',
      });
      await reloadOverview();
    } catch (error) {
      setOverviewError(error instanceof Error ? error.message : 'Unable to cancel this hosted carpool.');
    }
  }

  function handleCloseSimulationView() {
    if (simulationTimerRef.current) {
      clearInterval(simulationTimerRef.current);
    }

    setSimulationState(null);
    setSimulationIndex(0);
    setIsSimulating(false);
    setSimulationError(null);
  }

  function getRiderMarkerState(request: HostedCarpoolTrip['requests'][number]) {
    const stopProgress = simulationState?.riderStopProgress[request.id];

    if (!simulationMarker) {
      return {
        label: 'Waiting',
        point: request.pickupPoint,
        color: palette.warning,
      };
    }

    if (!stopProgress || simulationIndex < stopProgress.pickupIndex) {
      return {
        label: 'Waiting for pickup',
        point: request.pickupPoint,
        color: palette.warning,
      };
    }

    if (simulationIndex >= stopProgress.dropoffIndex) {
      return {
        label: 'Dropped off',
        point: request.dropoffPoint,
        color: palette.accentAlt,
      };
    }

    return {
      label: 'In car',
      point: simulationMarker,
      color: palette.accent,
    };
  }

  const simulationRegion = useMemo(
    () => buildRegion(simulationState?.pathPoints ?? []),
    [simulationState]
  );

  if (simulationTrip) {
    const simulationDurationSeconds = getSimulationDurationSeconds(simulationTrip);

    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]} edges={['top']}>
        <View style={styles.fullScreenSimulationContainer}>
          <MapView
            ref={simulationMapRef}
            style={StyleSheet.absoluteFill}
            initialRegion={simulationRegion}
            onRegionChangeComplete={() => {}}>
            <Polyline coordinates={simulationPath} strokeColor={palette.accent} strokeWidth={6} />
            <Marker coordinate={simulationPath[0]} title="Host origin" />
            <Marker coordinate={simulationPath[simulationPath.length - 1]} title="Host destination" />
            {simulationMarker ? (
              <Marker coordinate={simulationMarker} title="Host car">
                <View style={[styles.vehicleMarker, { backgroundColor: palette.accent }]}>
                  <MaterialIcons name="directions-car" size={18} color="#FFFFFF" />
                </View>
              </Marker>
            ) : null}
            {acceptedSimulationRequests.map((request) => {
              const riderState = getRiderMarkerState(request);

              return (
                <Marker
                  key={request.id}
                  coordinate={riderState.point}
                  title={request.riderDisplayName ?? 'Rider'}
                  description={riderState.label}>
                  <View style={[styles.riderMarker, { backgroundColor: riderState.color }]}>
                    <MaterialIcons name="person" size={14} color="#FFFFFF" />
                  </View>
                </Marker>
              );
            })}
          </MapView>

          <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
            <View
              style={[
                styles.fullScreenSimulationHeader,
                { backgroundColor: palette.card, borderColor: palette.border },
              ]}>
              <View style={{ flex: 1 }}>
                <ThemedText type="subtitle" style={{ color: palette.text }}>
                  Carpool Simulation
                </ThemedText>
                <ThemedText style={{ color: palette.muted }}>
                  {simulationTrip.originLabel} to {simulationTrip.destinationLabel}
                </ThemedText>
              </View>
              <View
                style={[
                  styles.statusBadge,
                  {
                    backgroundColor: `${(isSimulating ? palette.accent : palette.accentAlt)}18`,
                    borderColor: isSimulating ? `${palette.accent}55` : `${palette.accentAlt}55`,
                  },
                ]}>
                <ThemedText
                  style={{
                    color: isSimulating ? palette.accent : palette.accentAlt,
                    fontWeight: '700',
                  }}>
                  {isSimulating ? `${simulationProgress}%` : 'Completed'}
                </ThemedText>
              </View>
              <Pressable
                onPress={handleCloseSimulationView}
                style={[
                  styles.closeSimulationButton,
                  { backgroundColor: palette.cardSecondary, borderColor: palette.border },
                ]}>
                <MaterialIcons name="close" size={20} color={palette.text} />
              </Pressable>
            </View>

            <View
              style={[
                styles.fullScreenSimulationFooter,
                { backgroundColor: palette.card, borderColor: palette.border },
              ]}>
              <View style={styles.simulationStatRow}>
                <View style={styles.simulationStatCard}>
                  <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>Demo Time</ThemedText>
                  <ThemedText style={{ color: palette.text }}>{simulationDurationSeconds} sec</ThemedText>
                </View>
                <View style={styles.simulationStatCard}>
                  <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>Riders</ThemedText>
                  <ThemedText style={{ color: palette.text }}>{acceptedSimulationRequests.length}</ThemedText>
                </View>
                <View style={styles.simulationStatCard}>
                  <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>Status</ThemedText>
                  <ThemedText style={{ color: palette.text, textTransform: 'capitalize' }}>
                    {simulationTrip.status}
                  </ThemedText>
                </View>
              </View>

              <ScrollView
                style={styles.fullScreenSimulationRequests}
                contentContainerStyle={styles.fullScreenSimulationRequestsContent}
                showsVerticalScrollIndicator={false}>
                {acceptedSimulationRequests.map((request) => {
                  const riderState = getRiderMarkerState(request);

                  return (
                    <View
                      key={`sim-${request.id}`}
                      style={[
                        styles.requestRow,
                        { backgroundColor: palette.cardSecondary, borderColor: palette.border },
                      ]}>
                      <View style={{ flex: 1 }}>
                        <ThemedText style={{ color: palette.text, fontWeight: '700' }}>
                          {request.riderDisplayName ?? 'Rider'}
                        </ThemedText>
                        <ThemedText style={{ color: palette.muted }}>
                          {request.pickupLabel} to {request.dropoffLabel}
                        </ThemedText>
                      </View>
                      <View
                        style={[
                          styles.statusBadge,
                          {
                            backgroundColor: `${riderState.color}20`,
                            borderColor: `${riderState.color}55`,
                          },
                        ]}>
                        <ThemedText style={{ color: riderState.color, fontWeight: '700' }}>
                          {riderState.label}
                        </ThemedText>
                      </View>
                    </View>
                  );
                })}

                {simulationError ? (
                  <View
                    style={[
                      styles.messageRow,
                      { borderColor: palette.border, backgroundColor: palette.cardSecondary },
                    ]}>
                    <MaterialIcons name="error-outline" size={18} color={palette.danger} />
                    <ThemedText style={{ color: palette.text, flex: 1 }}>{simulationError}</ThemedText>
                  </View>
                ) : null}
              </ScrollView>
            </View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <ThemedText type="title" style={[styles.title, { color: palette.text, flex: 1 }]}>
              Carpool Demo
            </ThemedText>
            <Pressable
              disabled={isOverviewLoading || isRefreshingOverview}
              onPress={() => void reloadOverview({ showRefreshingIndicator: true, refreshMatches: true })}
              style={[
                styles.refreshButton,
                {
                  backgroundColor:
                    isOverviewLoading || isRefreshingOverview ? palette.cardSecondary : palette.card,
                  borderColor: palette.border,
                },
              ]}>
              {isRefreshingOverview ? (
                <ActivityIndicator color={palette.accent} size="small" />
              ) : (
                <MaterialIcons name="refresh" size={18} color={palette.text} />
              )}
              <ThemedText style={{ color: palette.text, fontWeight: '700' }}>Refresh</ThemedText>
            </Pressable>
          </View>
          <ThemedText style={{ color: palette.muted }}>
            Host scheduled rides, match riders against a start/end radius, accept requests, and replay
            the pickup and drop-off flow on one device.
          </ThemedText>
          <ThemedText style={{ color: palette.muted }}>
            Auto-refresh every {Math.round(CARPOOL_REFRESH_INTERVAL_MS / 1000)}s
            {lastRefreshedAt ? ` | Last synced ${formatTripDate(lastRefreshedAt)}` : ''}
          </ThemedText>
          <ProfileDropdown palette={palette} />
        </View>

        <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <ThemedText type="subtitle" style={{ color: palette.text }}>
            Demo Login
          </ThemedText>
          <ThemedText style={{ color: palette.muted }}>
            The selected profile acts as the current signed-in user for hosting, requesting, and the
            leaderboard/profile views.
          </ThemedText>
          {activeProfile ? (
            <ThemedText style={{ color: palette.muted }}>
              Active as {activeProfile.displayName} {activeProfile.hasCar ? '| host enabled' : '| rider mode'}
            </ThemedText>
          ) : null}
        </View>

        <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <ThemedText type="subtitle" style={{ color: palette.text }}>
            Host a Carpool
          </ThemedText>
          <ThemedText style={{ color: palette.muted }}>
            Plan a driving route first, then publish the ride with seat count, host radius, pricing,
            simulation time, and a future start time.
          </ThemedText>
          {!activeProfile?.hasCar ? (
            <View style={[styles.messageRow, { borderColor: palette.border, backgroundColor: palette.cardSecondary }]}>
              <MaterialIcons name="info-outline" size={18} color={palette.accentAlt} />
              <ThemedText style={{ color: palette.text, flex: 1 }}>
                This persona has no car assigned in the seed data. Switch to a profile with hosting enabled.
              </ThemedText>
            </View>
          ) : null}

          <TextInput
            value={hostOriginField.value}
            onFocus={hostOriginField.onFocus}
            onBlur={hostOriginField.scheduleBlur}
            onChangeText={hostOriginField.onChangeText}
            placeholder="Host origin"
            placeholderTextColor={palette.muted}
            style={[styles.input, { color: palette.text, backgroundColor: palette.input, borderColor: palette.border }]}
            editable={activeProfile?.hasCar}
          />
          {hostOriginField.showSuggestions
            ? renderSuggestionList(
                hostOriginField,
                'No matching origin suggestions found yet.',
                hostOriginField.selectSuggestion
              )
            : null}

          <TextInput
            value={hostDestinationField.value}
            onFocus={hostDestinationField.onFocus}
            onBlur={hostDestinationField.scheduleBlur}
            onChangeText={hostDestinationField.onChangeText}
            placeholder="Host destination"
            placeholderTextColor={palette.muted}
            style={[styles.input, { color: palette.text, backgroundColor: palette.input, borderColor: palette.border }]}
            editable={activeProfile?.hasCar}
          />
          {hostDestinationField.showSuggestions
            ? renderSuggestionList(
                hostDestinationField,
                'No destination suggestions found yet.',
                hostDestinationField.selectSuggestion
              )
            : null}

          <Pressable
            disabled={isPlanningHostRoute || !activeProfile?.hasCar}
            onPress={() => void handlePlanHostRoute()}
            style={[
              styles.primaryButton,
              { backgroundColor: isPlanningHostRoute || !activeProfile?.hasCar ? '#8FA99A' : palette.accent },
            ]}>
            <MaterialIcons name="alt-route" size={18} color="#FFFFFF" />
            <ThemedText style={styles.primaryButtonText}>
              {isPlanningHostRoute ? 'Planning host route...' : 'Plan host route'}
            </ThemedText>
          </Pressable>

          {hostRoutePreview ? (
            <View style={[styles.routePreviewCard, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
              <ThemedText style={{ color: palette.text, fontWeight: '700' }}>
                {hostRoutePreview.option.title}
              </ThemedText>
              <ThemedText style={{ color: palette.muted }}>
                {formatDuration(hostRoutePreview.option.durationSeconds)} |{' '}
                {formatDistance(hostRoutePreview.option.distanceMeters)} |{' '}
                {hostRoutePreview.option.co2Kg.toFixed(2)} kg CO2
              </ThemedText>
              <ThemedText style={{ color: palette.text }}>{hostRoutePreview.option.summary}</ThemedText>

              <View style={styles.dualInputRow}>
                <View style={styles.dualInputCell}>
                  <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>Seats</ThemedText>
                  <TextInput
                    value={availableSeatsInput}
                    onChangeText={setAvailableSeatsInput}
                    keyboardType="number-pad"
                    style={[styles.input, styles.tightInput, { color: palette.text, backgroundColor: palette.input, borderColor: palette.border }]}
                  />
                </View>
                <View style={styles.dualInputCell}>
                  <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>Start in minutes</ThemedText>
                  <TextInput
                    value={startDelayMinutesInput}
                    onChangeText={setStartDelayMinutesInput}
                    keyboardType="numbers-and-punctuation"
                    style={[styles.input, styles.tightInput, { color: palette.text, backgroundColor: palette.input, borderColor: palette.border }]}
                  />
                </View>
              </View>

              <View style={styles.dualInputRow}>
                <View style={styles.dualInputCell}>
                  <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>
                    Simulation time (sec)
                  </ThemedText>
                  <TextInput
                    value={simulationDurationInput}
                    onChangeText={setSimulationDurationInput}
                    keyboardType="numbers-and-punctuation"
                    style={[
                      styles.input,
                      styles.tightInput,
                      {
                        color: palette.text,
                        backgroundColor: palette.input,
                        borderColor: palette.border,
                      },
                    ]}
                  />
                </View>
                <View style={styles.dualInputCell}>
                  <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>Price per rider mile</ThemedText>
                  <TextInput
                    value={pricePerMileInput}
                    onChangeText={setPricePerMileInput}
                    keyboardType="numbers-and-punctuation"
                    style={[
                      styles.input,
                      styles.tightInput,
                      {
                        color: palette.text,
                        backgroundColor: palette.input,
                        borderColor: palette.border,
                      },
                    ]}
                  />
                </View>
              </View>

              <View style={styles.dualInputRow}>
                <View style={styles.dualInputCell}>
                  <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>Host radius (mi)</ThemedText>
                  <TextInput
                    value={detourLimitInput}
                    onChangeText={setDetourLimitInput}
                    keyboardType="numbers-and-punctuation"
                    style={[
                      styles.input,
                      styles.tightInput,
                      {
                        color: palette.text,
                        backgroundColor: palette.input,
                        borderColor: palette.border,
                      },
                    ]}
                  />
                </View>
                <View style={styles.dualInputCell}>
                  <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>Demo note</ThemedText>
                  <View
                    style={[
                      styles.inlineInfoCard,
                      { backgroundColor: palette.cardSecondary, borderColor: palette.border },
                    ]}>
                    <ThemedText style={{ color: palette.text }}>
                      Riders can match if their pickup is near your start or their destination is near
                      your finish within this radius.
                    </ThemedText>
                  </View>
                </View>
              </View>

              <Pressable
                disabled={isCreatingCarpool}
                onPress={() => void handleCreateHostedCarpool()}
                style={[
                  styles.primaryButton,
                  { backgroundColor: isCreatingCarpool ? '#8FA99A' : palette.accentAlt },
                ]}>
                <MaterialIcons name="event-seat" size={18} color="#FFFFFF" />
                <ThemedText style={styles.primaryButtonText}>
                  {isCreatingCarpool ? 'Publishing...' : 'Publish hosted carpool'}
                </ThemedText>
              </Pressable>
            </View>
          ) : null}

          {hostFormError ? (
            <View style={[styles.messageRow, { borderColor: palette.border, backgroundColor: palette.cardSecondary }]}>
              <MaterialIcons name="error-outline" size={18} color={palette.danger} />
              <ThemedText style={{ color: palette.text, flex: 1 }}>{hostFormError}</ThemedText>
            </View>
          ) : null}
        </View>

        <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <ThemedText type="subtitle" style={{ color: palette.text }}>
            Manage Hosted Carpools
          </ThemedText>
          <ThemedText style={{ color: palette.muted }}>
            Open trips stay in the main view. Ended and cancelled ones move into a separate history tab.
          </ThemedText>

          <View
            style={[
              styles.hostTripsTabs,
              { backgroundColor: palette.cardSecondary, borderColor: palette.border },
            ]}>
            {(['open', 'history'] as HostTripsTab[]).map((tab) => {
              const isSelected = hostTripsTab === tab;

              return (
                <Pressable
                  key={tab}
                  onPress={() => setHostTripsTab(tab)}
                  style={[
                    styles.hostTripsTab,
                    {
                      backgroundColor: isSelected ? palette.accent : 'transparent',
                      borderColor: isSelected ? palette.accent : 'transparent',
                    },
                  ]}>
                  <ThemedText style={{ color: isSelected ? '#FFFFFF' : palette.text, fontWeight: '700' }}>
                    {getHostTripsTabCopy(tab)}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>

          {isOverviewLoading ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator color={palette.accent} />
              <ThemedText style={{ color: palette.text }}>Loading host trips...</ThemedText>
            </View>
          ) : hostTripsTab === 'open' && openHostTrips.length === 0 ? (
            <View style={[styles.messageRow, { borderColor: palette.border, backgroundColor: palette.cardSecondary }]}>
              <MaterialIcons name="directions-car" size={18} color={palette.accentAlt} />
              <ThemedText style={{ color: palette.text, flex: 1 }}>
                No scheduled or active hosted carpools for this persona right now.
              </ThemedText>
            </View>
          ) : hostTripsTab === 'history' && archivedHostTrips.length === 0 ? (
            <View style={[styles.messageRow, { borderColor: palette.border, backgroundColor: palette.cardSecondary }]}>
              <MaterialIcons name="history" size={18} color={palette.accentAlt} />
              <ThemedText style={{ color: palette.text, flex: 1 }}>
                No ended or cancelled hosted carpools for this persona yet.
              </ThemedText>
            </View>
          ) : (
            (hostTripsTab === 'open' ? openHostTrips : archivedHostTrips).map(renderHostedTripCard)
          )}

          {overviewError ? (
            <View style={[styles.messageRow, { borderColor: palette.border, backgroundColor: palette.cardSecondary }]}>
              <MaterialIcons name="error-outline" size={18} color={palette.danger} />
              <ThemedText style={{ color: palette.text, flex: 1 }}>{overviewError}</ThemedText>
            </View>
          ) : null}
        </View>

        <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <ThemedText type="subtitle" style={{ color: palette.text }}>
            Manual Carpool Search
          </ThemedText>
          <ThemedText style={{ color: palette.muted }}>
            The map tab now shows carpool matches beside walking and transit options. This manual
            search stays here if you want to test host matching directly from the carpool screen.
          </ThemedText>

          <TextInput
            value={riderPickupField.value}
            onFocus={riderPickupField.onFocus}
            onBlur={riderPickupField.scheduleBlur}
            onChangeText={riderPickupField.onChangeText}
            placeholder="Rider pickup"
            placeholderTextColor={palette.muted}
            style={[styles.input, { color: palette.text, backgroundColor: palette.input, borderColor: palette.border }]}
          />
          {riderPickupField.showSuggestions
            ? renderSuggestionList(
                riderPickupField,
                'No pickup suggestions found yet.',
                riderPickupField.selectSuggestion
              )
            : null}

          <TextInput
            value={riderDropoffField.value}
            onFocus={riderDropoffField.onFocus}
            onBlur={riderDropoffField.scheduleBlur}
            onChangeText={riderDropoffField.onChangeText}
            placeholder="Rider destination"
            placeholderTextColor={palette.muted}
            style={[styles.input, { color: palette.text, backgroundColor: palette.input, borderColor: palette.border }]}
          />
          {riderDropoffField.showSuggestions
            ? renderSuggestionList(
                riderDropoffField,
                'No destination suggestions found yet.',
                riderDropoffField.selectSuggestion
              )
            : null}

          <Pressable
            disabled={isSearchingMatches}
            onPress={() => void handleFindMatches()}
            style={[
              styles.primaryButton,
              { backgroundColor: isSearchingMatches ? '#8FA99A' : palette.accent },
            ]}>
            <MaterialIcons name="groups" size={18} color="#FFFFFF" />
            <ThemedText style={styles.primaryButtonText}>
              {isSearchingMatches ? 'Finding matches...' : 'Find matching hosts'}
            </ThemedText>
          </Pressable>

          {riderSearchResult ? (
            riderSearchResult.matches.length === 0 ? (
              <View
                style={[
                  styles.messageRow,
                  { borderColor: palette.border, backgroundColor: palette.cardSecondary },
                ]}>
                <MaterialIcons name="search-off" size={18} color={palette.accentAlt} />
                <ThemedText style={{ color: palette.text, flex: 1 }}>
                  No hosts match this pickup or destination radius right now. Try another trip or switch
                  to a different host persona.
                </ThemedText>
              </View>
            ) : (
              riderSearchResult.matches.map((match) => (
                <View
                  key={match.tripId}
                  style={[styles.tripCard, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
                  <View style={styles.sectionHeaderRow}>
                    <View style={{ flex: 1 }}>
                      <ThemedText style={{ color: palette.text, fontWeight: '700' }}>
                        {match.hostDisplayName}
                      </ThemedText>
                      <ThemedText style={{ color: palette.muted }}>
                        {match.originLabel} to {match.destinationLabel}
                      </ThemedText>
                    </View>
                    <View
                      style={[
                        styles.statusBadge,
                        { backgroundColor: `${palette.accent}18`, borderColor: `${palette.accent}55` },
                      ]}>
                      <ThemedText style={{ color: palette.accent, fontWeight: '700' }}>
                        {match.remainingSeats} seats
                      </ThemedText>
                    </View>
                  </View>

                  <ThemedText style={{ color: palette.text }}>
                    Pickup gap {formatMiles(match.pickupDistanceMeters)} | Drop-off gap{' '}
                    {formatMiles(match.dropoffDistanceMeters)}
                  </ThemedText>
                  <ThemedText style={{ color: palette.muted }}>
                    {formatRadius(match.maxDetourValue)} | Price {formatCurrency(match.quotedPrice)}
                  </ThemedText>

                  <Pressable
                    disabled={requestingTripId === match.tripId || Boolean(match.existingRequestStatus)}
                    onPress={() => void handleSendRequest(match.tripId)}
                    style={[
                      styles.primaryButton,
                      {
                        backgroundColor: match.existingRequestStatus ? '#96A7A0' : palette.accentAlt,
                      },
                    ]}>
                    <MaterialIcons name="send" size={18} color="#FFFFFF" />
                    <ThemedText style={styles.primaryButtonText}>
                      {match.existingRequestStatus
                        ? 'Request already sent'
                        : requestingTripId === match.tripId
                          ? 'Sending request...'
                          : 'Send rider request'}
                    </ThemedText>
                  </Pressable>
                </View>
              ))
            )
          ) : null}

          {riderSearchError ? (
            <View style={[styles.messageRow, { borderColor: palette.border, backgroundColor: palette.cardSecondary }]}>
              <MaterialIcons name="error-outline" size={18} color={palette.danger} />
              <ThemedText style={{ color: palette.text, flex: 1 }}>{riderSearchError}</ThemedText>
            </View>
          ) : null}
        </View>

        <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <ThemedText type="subtitle" style={{ color: palette.text }}>
            My Rider Requests
          </ThemedText>
          <ThemedText style={{ color: palette.muted }}>
            These are the requests for the currently selected rider persona.
          </ThemedText>

          {overview.riderRequests.length === 0 ? (
            <View style={[styles.messageRow, { borderColor: palette.border, backgroundColor: palette.cardSecondary }]}>
              <MaterialIcons name="person" size={18} color={palette.accentAlt} />
              <ThemedText style={{ color: palette.text, flex: 1 }}>
                No rider requests yet for this persona.
              </ThemedText>
            </View>
          ) : (
            overview.riderRequests.map((request) => (
              <View
                key={`rider-${request.id}`}
                style={[styles.requestRow, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
                <View style={{ flex: 1 }}>
                  <ThemedText style={{ color: palette.text, fontWeight: '700' }}>
                    Host {request.hostDisplayName ?? 'Unknown'}
                  </ThemedText>
                  <ThemedText style={{ color: palette.muted }}>
                    {request.pickupLabel} to {request.dropoffLabel}
                  </ThemedText>
                  <ThemedText style={{ color: palette.text }}>
                    {request.tripStatus ? `Trip ${request.tripStatus}` : 'Awaiting host'} | Fare{' '}
                    {formatCurrency(request.quotedPrice)}
                  </ThemedText>
                </View>
                <View
                  style={[
                    styles.statusBadge,
                    {
                      backgroundColor:
                        request.status === 'accepted' ? `${palette.accent}18` : `${palette.accentAlt}18`,
                      borderColor:
                        request.status === 'accepted' ? `${palette.accent}55` : `${palette.accentAlt}55`,
                    },
                  ]}>
                  <ThemedText
                    style={{
                      color: request.status === 'accepted' ? palette.accent : palette.accentAlt,
                      fontWeight: '700',
                      textTransform: 'capitalize',
                    }}>
                    {request.status}
                  </ThemedText>
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  fullScreenSimulationContainer: {
    flex: 1,
  },
  container: {
    padding: 18,
    gap: 18,
  },
  header: {
    gap: 6,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  title: {
    fontSize: 30,
  },
  refreshButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minWidth: 108,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  fullScreenSimulationHeader: {
    alignItems: 'center',
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginHorizontal: 16,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  closeSimulationButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  fullScreenSimulationFooter: {
    borderRadius: 24,
    borderWidth: 1,
    gap: 12,
    marginHorizontal: 16,
    marginTop: 'auto',
    marginBottom: 18,
    maxHeight: '42%',
    padding: 16,
  },
  fullScreenSimulationRequests: {
    flexGrow: 0,
  },
  fullScreenSimulationRequestsContent: {
    gap: 10,
  },
  card: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 18,
    gap: 14,
  },
  sectionHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  personaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  personaChip: {
    borderRadius: 16,
    borderWidth: 1,
    minWidth: '46%',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  input: {
    borderRadius: 16,
    borderWidth: 1,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  tightInput: {
    marginTop: 6,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 16,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  suggestionContainer: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  suggestionLoadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    padding: 14,
  },
  suggestionRow: {
    alignItems: 'center',
    flexDirection: 'row',
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
  routePreviewCard: {
    borderRadius: 18,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  dualInputRow: {
    flexDirection: 'row',
    gap: 12,
  },
  dualInputCell: {
    flex: 1,
  },
  metricLabel: {
    fontSize: 12,
    textTransform: 'uppercase',
  },
  segmentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  segmentChip: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inlineInfoCard: {
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 6,
    minHeight: 50,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  loadingCard: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 20,
  },
  hostTripsTabs: {
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    padding: 6,
  },
  hostTripsTab: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  messageRow: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  tripCard: {
    borderRadius: 18,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  statusBadge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  tripActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  actionButton: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  requestRow: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  pendingActionColumn: {
    gap: 8,
  },
  miniActionButton: {
    alignItems: 'center',
    borderRadius: 12,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  mapCard: {
    borderRadius: 20,
    borderWidth: 1,
    height: 280,
    overflow: 'hidden',
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  vehicleMarker: {
    alignItems: 'center',
    borderRadius: 999,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  riderMarker: {
    alignItems: 'center',
    borderRadius: 999,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  simulationStatRow: {
    flexDirection: 'row',
    gap: 10,
  },
  simulationStatCard: {
    flex: 1,
    gap: 4,
  },
});
