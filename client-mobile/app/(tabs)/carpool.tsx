import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useIsFocused } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

import { ThemedText } from '@/components/themed-text';
import { useUserProfile } from '@/context/user-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  createCarpool,
  fetchCarpoolRequests,
  fetchNearbyCarpools,
  requestCarpoolSeat,
  respondToCarpoolRequest,
  updateCarpoolRequestProgress,
} from '@/lib/api';
import { formatDistance, formatDuration, formatTripDate } from '@/lib/formatters';
import {
  CarpoolDiscoveryResponse,
  CarpoolListing,
  CarpoolRideStatus,
  CarpoolRequestRecord,
  CarpoolRequestStatus,
} from '@/types/carpool';
import { Coordinates } from '@/types/trips';

const EMPTY_DISCOVERY: CarpoolDiscoveryResponse = {
  sourceRadiusMeters: 1200,
  destinationRadiusMeters: 1800,
  hosted: [],
  live: [],
  scheduled: [],
  generatedAt: new Date(0).toISOString(),
};

const DEFAULT_REGION: Region = {
  latitude: 33.4234,
  longitude: -111.94,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};

type SimulationStop = {
  requestId: number;
  riderName: string;
  pickupLabel: string;
  dropoffLabel: string;
  pickupPoint: Coordinates;
  dropoffPoint: Coordinates;
  pickupIndex: number;
  dropoffIndex: number;
};

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
    latitudeDelta: Math.max((maxLatitude - minLatitude) * 1.6, 0.02),
    longitudeDelta: Math.max((maxLongitude - minLongitude) * 1.6, 0.02),
  };
}

function samplePolyline(points: Coordinates[], maxPoints = 130) {
  if (points.length <= maxPoints) {
    return points;
  }

  const step = (points.length - 1) / (maxPoints - 1);

  return Array.from({ length: maxPoints }, (_, index) => {
    const pointIndex = Math.min(Math.round(index * step), points.length - 1);
    return points[pointIndex];
  });
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function haversineDistanceMeters(a: Coordinates, b: Coordinates) {
  const earthRadiusMeters = 6_371_000;
  const latDistance = toRadians(b.latitude - a.latitude);
  const lngDistance = toRadians(b.longitude - a.longitude);
  const startLat = toRadians(a.latitude);
  const endLat = toRadians(b.latitude);
  const h =
    Math.sin(latDistance / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(lngDistance / 2) ** 2;

  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(h));
}

function findNearestPointIndex(point: Coordinates, pathPoints: Coordinates[]) {
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < pathPoints.length; index += 1) {
    const candidate = pathPoints[index];
    const distance = haversineDistanceMeters(point, candidate);

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }

  return nearestIndex;
}

function formatCurrency(amount: number) {
  return `$${amount.toFixed(2)}`;
}

function formatEta(seconds: number | null) {
  if (seconds == null) {
    return '--';
  }

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (remainingMinutes === 0) {
    return `${hours} hr`;
  }

  return `${hours} hr ${remainingMinutes} min`;
}

function getStatusLabel(status: CarpoolRequestStatus) {
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'accepted':
      return 'Accepted';
    case 'rejected':
      return 'Rejected';
    case 'cancelled':
      return 'Cancelled';
  }
}

function readRideStatus(routeAdjustment: Record<string, unknown> | null | undefined): CarpoolRideStatus | null {
  let normalizedRouteAdjustment = routeAdjustment;

  if (typeof (routeAdjustment as unknown) === 'string') {
    try {
      const parsed = JSON.parse(routeAdjustment as unknown as string);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        normalizedRouteAdjustment = parsed as Record<string, unknown>;
      }
    } catch {
      normalizedRouteAdjustment = null;
    }
  }

  const rideStatus = normalizedRouteAdjustment?.rideStatus ?? normalizedRouteAdjustment?.ride_status;

  if (rideStatus === 'waiting_pickup' || rideStatus === 'onboard' || rideStatus === 'dropped_off') {
    return rideStatus;
  }

  return null;
}

export default function CarpoolScreen() {
  const colorScheme = useColorScheme();
  const isFocused = useIsFocused();
  const { userId, displayName, commuteIntent } = useUserProfile();

  const [discovery, setDiscovery] = useState<CarpoolDiscoveryResponse>(EMPTY_DISCOVERY);
  const [senderRequests, setSenderRequests] = useState<CarpoolRequestRecord[]>([]);
  const [hostRequests, setHostRequests] = useState<CarpoolRequestRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [actionKey, setActionKey] = useState<string | null>(null);

  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [seatCountInput, setSeatCountInput] = useState('2');
  const [pricePerMileInput, setPricePerMileInput] = useState('0.85');
  const [maxDetourInput, setMaxDetourInput] = useState('300');
  const [vehicleInput, setVehicleInput] = useState('');
  const [notesInput, setNotesInput] = useState('');
  const [startOffsetInput, setStartOffsetInput] = useState('15');
  const [createStatus, setCreateStatus] = useState<'scheduled' | 'active'>('scheduled');
  const [isCreatingCarpool, setIsCreatingCarpool] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const simulationMapRef = useRef<MapView | null>(null);
  const simulationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [simulationVisible, setSimulationVisible] = useState(false);
  const [simulationCarpool, setSimulationCarpool] = useState<CarpoolListing | null>(null);
  const [simulationPath, setSimulationPath] = useState<Coordinates[]>([]);
  const [simulationIndex, setSimulationIndex] = useState(0);
  const [simulationComplete, setSimulationComplete] = useState(false);
  const [simulationStops, setSimulationStops] = useState<SimulationStop[]>([]);
  const simulationProgressUpdatesRef = useRef<Record<number, CarpoolRideStatus>>({});

  const palette =
    colorScheme === 'dark'
      ? {
          background: '#0E1511',
          card: '#16221B',
          cardSecondary: '#1C2A22',
          border: '#2D4035',
          text: '#EAF5EE',
          muted: '#A5B5AC',
          accent: '#4DA86D',
          accentAlt: '#DEAE55',
          error: '#E97B72',
          input: '#111B16',
        }
      : {
          background: '#EEF4EA',
          card: '#FFFFFF',
          cardSecondary: '#F2F8F0',
          border: '#D5E1D3',
          text: '#173126',
          muted: '#5E7267',
          accent: '#1F754A',
          accentAlt: '#BE7C2A',
          error: '#C84E3F',
          input: '#F8FBF7',
        };

  const hasCommuteIntent = Boolean(commuteIntent?.origin && commuteIntent?.destination);
  const pendingHostRequests = useMemo(
    () => hostRequests.filter((request) => request.status === 'pending'),
    [hostRequests]
  );
  const simulationMarker =
    simulationPath.length > 0
      ? simulationPath[Math.min(simulationIndex, simulationPath.length - 1)]
      : null;
  const simulationProgress =
    simulationPath.length <= 1
      ? 0
      : Math.round((simulationIndex / Math.max(simulationPath.length - 1, 1)) * 100);
  const simulationRegion = useMemo(() => buildRegion(simulationPath), [simulationPath]);
  const simulationOnboardCount = simulationStops.filter(
    (stop) => simulationIndex >= stop.pickupIndex && simulationIndex < stop.dropoffIndex
  ).length;
  const simulationCompletedRides = simulationStops.filter(
    (stop) => simulationIndex >= stop.dropoffIndex
  ).length;

  const refreshAllData = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) {
        setIsLoading(true);
        setErrorMessage(null);
      }

      const [carpoolDiscoveryResult, requestSnapshotResult] = await Promise.allSettled([
        fetchNearbyCarpools({
          userId,
          source: commuteIntent?.origin,
          destination: commuteIntent?.destination,
          sourceRadiusMeters: 1400,
          destinationRadiusMeters: 2200,
        }),
        fetchCarpoolRequests(userId, 'all'),
      ]);

      if (carpoolDiscoveryResult.status === 'fulfilled') {
        const carpoolDiscovery = carpoolDiscoveryResult.value;
        setDiscovery({
          ...carpoolDiscovery,
          hosted: carpoolDiscovery.hosted ?? [],
          live: carpoolDiscovery.live ?? [],
          scheduled: carpoolDiscovery.scheduled ?? [],
        });
      } else if (!options?.silent && requestSnapshotResult.status === 'rejected') {
        const reason = carpoolDiscoveryResult.reason;
        setErrorMessage(reason instanceof Error ? reason.message : 'Unable to load carpools right now.');
      }

      if (requestSnapshotResult.status === 'fulfilled') {
        const requestSnapshot = requestSnapshotResult.value;
        setSenderRequests(requestSnapshot.sender);
        setHostRequests(requestSnapshot.host);
      } else if (!options?.silent && carpoolDiscoveryResult.status === 'rejected') {
        const reason = requestSnapshotResult.reason;
        setErrorMessage(reason instanceof Error ? reason.message : 'Unable to load carpool requests right now.');
      }

      if (!options?.silent) {
        setIsLoading(false);
      }
    },
    [commuteIntent?.destination, commuteIntent?.origin, userId]
  );

  useEffect(() => {
    if (!isFocused) {
      return;
    }

    void refreshAllData();
  }, [isFocused, refreshAllData]);

  useEffect(() => {
    if (!isFocused) {
      return;
    }

    const interval = setInterval(() => {
      void refreshAllData({ silent: true });
    }, 2000);

    return () => clearInterval(interval);
  }, [isFocused, refreshAllData]);

  useEffect(() => {
    return () => {
      if (simulationTimerRef.current) {
        clearInterval(simulationTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!simulationVisible || simulationPath.length < 2) {
      return;
    }

    const timeout = setTimeout(() => {
      simulationMapRef.current?.fitToCoordinates(simulationPath, {
        edgePadding: {
          top: 70,
          right: 42,
          bottom: 220,
          left: 42,
        },
        animated: false,
      });
    }, 150);

    return () => clearTimeout(timeout);
  }, [simulationPath, simulationVisible]);

  useEffect(() => {
    if (!simulationVisible || !simulationMarker) {
      return;
    }

    simulationMapRef.current?.animateToRegion(
      {
        latitude: simulationMarker.latitude,
        longitude: simulationMarker.longitude,
        latitudeDelta: 0.014,
        longitudeDelta: 0.014,
      },
      420
    );
  }, [simulationMarker, simulationVisible]);

  function handleCloseSimulation() {
    if (simulationTimerRef.current) {
      clearInterval(simulationTimerRef.current);
      simulationTimerRef.current = null;
    }

    setSimulationVisible(false);
    setSimulationCarpool(null);
    setSimulationPath([]);
    setSimulationIndex(0);
    setSimulationComplete(false);
    setSimulationStops([]);
    simulationProgressUpdatesRef.current = {};
  }

  function buildSimulationStops(
    carpoolId: number,
    path: Coordinates[],
    requestRecords: CarpoolRequestRecord[]
  ) {
    return requestRecords
      .filter(
        (request) =>
          request.carpoolId === carpoolId &&
          request.status === 'accepted' &&
          request.pickupPoint != null &&
          request.dropoffPoint != null
      )
      .map((request) => {
        const pickupPoint = request.pickupPoint as Coordinates;
        const dropoffPoint = request.dropoffPoint as Coordinates;
        const pickupIndex = findNearestPointIndex(pickupPoint, path);
        const dropoffIndex = Math.max(findNearestPointIndex(dropoffPoint, path), pickupIndex + 1);

        return {
          requestId: request.id,
          riderName: request.requesterName,
          pickupLabel: request.pickupLabel,
          dropoffLabel: request.dropoffLabel,
          pickupPoint,
          dropoffPoint,
          pickupIndex,
          dropoffIndex,
        };
      })
      .sort((a, b) => a.pickupIndex - b.pickupIndex);
  }

  function syncProgressLocally(requestId: number, rideStatus: CarpoolRideStatus) {
    setHostRequests((currentRequests) =>
      currentRequests.map((request) =>
        request.id === requestId
          ? {
              ...request,
              routeAdjustment: {
                ...request.routeAdjustment,
                rideStatus,
                progressUpdatedAt: new Date().toISOString(),
              },
            }
          : request
      )
    );
  }

  function pushSimulationProgressUpdate(requestId: number, rideStatus: CarpoolRideStatus) {
    const currentStatus = simulationProgressUpdatesRef.current[requestId];

    if (
      currentStatus === rideStatus ||
      (currentStatus === 'dropped_off' && rideStatus !== 'dropped_off') ||
      (currentStatus === 'onboard' && rideStatus === 'waiting_pickup')
    ) {
      return;
    }

    simulationProgressUpdatesRef.current[requestId] = rideStatus;
    syncProgressLocally(requestId, rideStatus);

    void updateCarpoolRequestProgress(requestId, {
      hostId: userId,
      rideStatus,
    }).catch(() => {
      setActionError('Unable to sync rider pickup/dropoff progress right now.');
    });
  }

  function startSimulationPlayback(path: Coordinates[], stops: SimulationStop[]) {
    if (simulationTimerRef.current) {
      clearInterval(simulationTimerRef.current);
    }

    const remainingSteps = Math.max(path.length - 1, 1);
    const desiredDurationMs = 50_000;
    const tickMs = 550;
    const stepSize = Math.max(1, Math.ceil(remainingSteps / Math.floor(desiredDurationMs / tickMs)));

    simulationTimerRef.current = setInterval(() => {
      setSimulationIndex((currentIndex) => {
        const nextIndex = Math.min(currentIndex + stepSize, path.length - 1);

        stops.forEach((stop) => {
          if (currentIndex <= stop.pickupIndex && nextIndex >= stop.pickupIndex) {
            pushSimulationProgressUpdate(stop.requestId, 'onboard');
          }

          if (currentIndex <= stop.dropoffIndex && nextIndex >= stop.dropoffIndex) {
            pushSimulationProgressUpdate(stop.requestId, 'dropped_off');
          }
        });

        if (nextIndex >= path.length - 1) {
          if (simulationTimerRef.current) {
            clearInterval(simulationTimerRef.current);
            simulationTimerRef.current = null;
          }
          setSimulationComplete(true);
        }

        return nextIndex;
      });
    }, tickMs);
  }

  async function handleStartSimulation(carpool: CarpoolListing) {
    if (!carpool.pathPoints || carpool.pathPoints.length < 2) {
      setActionError('This carpool route has no valid path to simulate.');
      return;
    }

    const sampledPath = samplePolyline(carpool.pathPoints, 150);
    let latestHostRequests = hostRequests;

    try {
      const requestSnapshot = await fetchCarpoolRequests(userId, 'host');
      latestHostRequests = requestSnapshot.host;
      setHostRequests(requestSnapshot.host);
    } catch {
      // Continue with the most recent local snapshot to keep demo playback available.
    }

    const stopsForSimulation = buildSimulationStops(carpool.id, sampledPath, latestHostRequests);
    simulationProgressUpdatesRef.current = {};
    stopsForSimulation.forEach((stop) => {
      simulationProgressUpdatesRef.current[stop.requestId] = 'waiting_pickup';
    });

    setActionError(null);
    setSuccessMessage(null);
    setSimulationCarpool(carpool);
    setSimulationPath(sampledPath);
    setSimulationStops(stopsForSimulation);
    setSimulationIndex(0);
    setSimulationComplete(false);
    setSimulationVisible(true);

    stopsForSimulation.forEach((stop) => {
      if (stop.pickupIndex === 0) {
        pushSimulationProgressUpdate(stop.requestId, 'onboard');
      }
    });

    startSimulationPlayback(sampledPath, stopsForSimulation);
  }

  function handleRestartSimulation() {
    if (!simulationCarpool || simulationPath.length < 2) {
      return;
    }

    setSimulationComplete(false);
    setSimulationIndex(0);
    const resetStops = simulationStops.map((stop) => ({
      ...stop,
    }));
    simulationProgressUpdatesRef.current = {};
    resetStops.forEach((stop) => {
      simulationProgressUpdatesRef.current[stop.requestId] = 'waiting_pickup';
      pushSimulationProgressUpdate(stop.requestId, 'waiting_pickup');
    });
    startSimulationPlayback(simulationPath, resetStops);
  }

  function openCreateModal() {
    setCreateError(null);
    setCreateStatus('scheduled');
    setStartOffsetInput('15');
    setSeatCountInput('2');
    setPricePerMileInput('0.85');
    setMaxDetourInput('300');
    setVehicleInput('');
    setNotesInput('');
    setCreateModalVisible(true);
  }

  async function handleCreateCarpool() {
    if (!commuteIntent) {
      setCreateError('Select a route from the Map tab first so source and destination can be reused.');
      return;
    }

    const availableSeats = Number(seatCountInput);
    const pricePerMile = Number(pricePerMileInput);
    const maxDetourMeters = Number(maxDetourInput);
    const startsInMinutes = Number(startOffsetInput);

    if (!Number.isInteger(availableSeats) || availableSeats <= 0 || availableSeats > 6) {
      setCreateError('Seats must be an integer between 1 and 6.');
      return;
    }

    if (!Number.isFinite(pricePerMile) || pricePerMile < 0) {
      setCreateError('Price per person per mile must be a non-negative number.');
      return;
    }

    if (!Number.isFinite(maxDetourMeters) || maxDetourMeters < 20) {
      setCreateError('Max detour must be at least 20 meters.');
      return;
    }

    if (createStatus === 'scheduled' && (!Number.isFinite(startsInMinutes) || startsInMinutes < 1)) {
      setCreateError('For scheduled carpools, start in must be at least 1 minute.');
      return;
    }

    const startsAt = new Date(
      Date.now() + (createStatus === 'active' ? 0 : Math.round(startsInMinutes) * 60_000)
    );
    const endsAt = new Date(startsAt.getTime() + Math.max(commuteIntent.durationSeconds, 900) * 1_000);

    setIsCreatingCarpool(true);
    setCreateError(null);
    setActionError(null);
    setSuccessMessage(null);

    try {
      await createCarpool({
        userId,
        displayName,
        routeTitle: `Carpool: ${commuteIntent.originLabel} to ${commuteIntent.destinationLabel}`,
        originLabel: commuteIntent.originLabel,
        destinationLabel: commuteIntent.destinationLabel,
        distanceMeters: commuteIntent.distanceMeters,
        durationSeconds: commuteIntent.durationSeconds,
        availableSeats,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        status: createStatus,
        pathPoints:
          commuteIntent.pathPoints.length >= 2
            ? commuteIntent.pathPoints
            : [commuteIntent.origin, commuteIntent.destination],
        pricePerMile: Number(pricePerMile.toFixed(2)),
        maxDetourMeters: Math.round(maxDetourMeters),
        vehicleLabel: vehicleInput.trim() || undefined,
        notes: notesInput.trim() || undefined,
      });

      setCreateModalVisible(false);
      setSuccessMessage(
        `Carpool created as ${createStatus}. It is now visible under Your Hosted Carpools.`
      );
      await refreshAllData();
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Unable to create this carpool right now.');
    } finally {
      setIsCreatingCarpool(false);
    }
  }

  async function handleRequestSeat(carpool: CarpoolListing) {
    if (!commuteIntent) {
      setActionError('Select your source and destination in the Map tab before requesting a carpool.');
      return;
    }

    setActionKey(`request-${carpool.id}`);
    setActionError(null);
    setSuccessMessage(null);

    try {
      await requestCarpoolSeat(carpool.id, {
        requesterId: userId,
        pickupLabel: commuteIntent.originLabel,
        pickupPoint: commuteIntent.origin,
        dropoffLabel: commuteIntent.destinationLabel,
        dropoffPoint: commuteIntent.destination,
        message: `${displayName} requested a seat.`,
      });

      setSuccessMessage('Seat request sent to host.');
      await refreshAllData();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to send carpool request.');
    } finally {
      setActionKey(null);
    }
  }

  async function handleRespondRequest(requestId: number, status: 'accepted' | 'rejected') {
    setActionKey(`respond-${requestId}-${status}`);
    setActionError(null);
    setSuccessMessage(null);

    try {
      await respondToCarpoolRequest(requestId, {
        hostId: userId,
        status,
      });

      setSuccessMessage(status === 'accepted' ? 'Request accepted.' : 'Request declined.');
      await refreshAllData();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to update request status.');
    } finally {
      setActionKey(null);
    }
  }
  function renderRequestBadge(status: CarpoolRequestStatus) {
    const colors =
      status === 'accepted'
        ? { text: palette.accent, background: `${palette.accent}20` }
        : status === 'pending'
          ? { text: palette.accentAlt, background: `${palette.accentAlt}20` }
          : { text: palette.error, background: `${palette.error}20` };

    return (
      <View style={[styles.statusBadge, { backgroundColor: colors.background }]}>
        <ThemedText style={{ color: colors.text, fontWeight: '700' }}>{getStatusLabel(status)}</ThemedText>
      </View>
    );
  }

  function renderCarpoolCard(carpool: CarpoolListing) {
    const requestStatus = carpool.myRequest?.status ?? null;
    const rideStatus = readRideStatus(carpool.myRequest?.routeAdjustment);
    const isSendingRequest = actionKey === `request-${carpool.id}`;
    const isPending = requestStatus === 'pending';
    const isAccepted = requestStatus === 'accepted';
    const hasRequest = requestStatus != null;
    const canRequest = !carpool.isHostedByCurrentUser && !isPending && carpool.remainingSeats > 0;

    return (
      <View
        key={`${carpool.status}-${carpool.id}`}
        style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1, gap: 3 }}>
            <ThemedText style={[styles.cardTitle, { color: palette.text }]}>{carpool.routeTitle}</ThemedText>
            <ThemedText style={{ color: palette.muted }}>
              {carpool.originLabel} to {carpool.destinationLabel}
            </ThemedText>
          </View>
          <View style={[styles.hostBadge, { backgroundColor: `${palette.accent}18` }]}>
            <MaterialIcons name="person" size={16} color={palette.accent} />
            <ThemedText style={{ color: palette.accent, fontWeight: '700' }}>{carpool.hostName}</ThemedText>
          </View>
        </View>

        <View style={styles.metricRow}>
          <View style={[styles.metricCard, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
            <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>Seats left</ThemedText>
            <ThemedText style={{ color: palette.text, fontWeight: '700' }}>{carpool.remainingSeats}</ThemedText>
          </View>
          <View style={[styles.metricCard, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
            <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>Price / mile</ThemedText>
            <ThemedText style={{ color: palette.text, fontWeight: '700' }}>
              {formatCurrency(carpool.pricePerMile)}
            </ThemedText>
          </View>
          <View style={[styles.metricCard, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
            <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>Detour max</ThemedText>
            <ThemedText style={{ color: palette.text, fontWeight: '700' }}>
              {Math.round(carpool.maxDetourMeters)}m
            </ThemedText>
          </View>
        </View>

        <View style={styles.metadataRow}>
          <ThemedText style={{ color: palette.text }}>
            {formatDuration(carpool.durationSeconds)} | {formatDistance(carpool.distanceMeters)}
          </ThemedText>
          <ThemedText style={{ color: palette.muted }}>
            {carpool.status === 'active'
              ? `Near source: ${formatDistance(carpool.sourceDistanceMeters ?? 0)}`
              : `Starts ${formatTripDate(carpool.startsAt)}`}
          </ThemedText>
        </View>

        {carpool.notes ? <ThemedText style={{ color: palette.muted }}>{carpool.notes}</ThemedText> : null}

        {carpool.isHostedByCurrentUser ? (
          <View style={[styles.messageRow, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
            <MaterialIcons name="verified-user" size={18} color={palette.accent} />
            <ThemedText style={{ color: palette.text, flex: 1 }}>
              You are hosting this carpool. Rider requests will appear in Host Requests.
            </ThemedText>
          </View>
        ) : null}

        {carpool.isHostedByCurrentUser ? (
          <Pressable
            onPress={() => handleStartSimulation(carpool)}
            style={[
              styles.secondaryButton,
              {
                backgroundColor: palette.accentAlt,
                borderColor: palette.accentAlt,
              },
            ]}>
            <MaterialIcons name="play-arrow" size={18} color="#FFFFFF" />
            <ThemedText style={styles.secondaryButtonText}>
              {carpool.status === 'scheduled' ? 'Go Live Simulation' : 'Simulate Live Carpool'}
            </ThemedText>
          </Pressable>
        ) : null}

        {hasRequest ? (
          <View style={[styles.messageRow, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
            {renderRequestBadge(requestStatus)}
            <ThemedText style={{ color: palette.text, flex: 1 }}>
              {isAccepted
                ? rideStatus === 'dropped_off'
                  ? 'Trip complete. You were dropped off.'
                  : rideStatus === 'onboard'
                    ? 'You have been picked up. Heading to destination.'
                    : `Host accepted. Pickup ETA: ${formatEta(carpool.myRequest?.etaSeconds ?? null)}.`
                : isPending
                  ? 'Request sent. Waiting for host response.'
                  : 'Request not accepted. You can try requesting again.'}
            </ThemedText>
          </View>
        ) : null}

        {!carpool.isHostedByCurrentUser ? (
          <Pressable
            disabled={!canRequest || isSendingRequest}
            onPress={() => handleRequestSeat(carpool)}
            style={[
              styles.primaryButton,
              {
                backgroundColor: canRequest ? palette.accent : palette.cardSecondary,
                borderColor: canRequest ? palette.accent : palette.border,
                opacity: isSendingRequest ? 0.75 : 1,
              },
            ]}>
            {isSendingRequest ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <MaterialIcons name="send" size={18} color="#FFFFFF" />
            )}
            <ThemedText style={styles.primaryButtonText}>
              {isAccepted
                ? rideStatus === 'dropped_off'
                  ? 'Dropped off'
                  : rideStatus === 'onboard'
                    ? 'Onboard'
                    : `Accepted | ETA ${formatEta(carpool.myRequest?.etaSeconds ?? null)}`
                : isPending
                  ? 'Request sent'
                  : carpool.remainingSeats <= 0
                    ? 'No seats left'
                    : requestStatus === 'rejected'
                      ? 'Request again'
                      : 'Request seat'}
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
    );
  }

  function renderDiscoverySection(title: string, list: CarpoolListing[], emptyMessage: string) {
    return (
      <View style={styles.sectionBlock}>
        <View style={styles.sectionHeader}>
          <ThemedText type="subtitle" style={{ color: palette.text }}>
            {title}
          </ThemedText>
          <ThemedText style={{ color: palette.muted }}>{list.length} found</ThemedText>
        </View>
        {list.length === 0 ? (
          <View style={[styles.messageRow, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
            <MaterialIcons name="search-off" size={18} color={palette.accentAlt} />
            <ThemedText style={{ color: palette.text, flex: 1 }}>{emptyMessage}</ThemedText>
          </View>
        ) : (
          list.map((carpool) => renderCarpoolCard(carpool))
        )}
      </View>
    );
  }

  function renderSenderRequests() {
    return (
      <View style={styles.sectionBlock}>
        <ThemedText type="subtitle" style={{ color: palette.text }}>
          Your Requests
        </ThemedText>
        {senderRequests.length === 0 ? (
          <View style={[styles.messageRow, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
            <MaterialIcons name="inbox" size={18} color={palette.accentAlt} />
            <ThemedText style={{ color: palette.text, flex: 1 }}>
              Seat requests you send will appear here with acceptance status and ETA.
            </ThemedText>
          </View>
        ) : (
          senderRequests.slice(0, 8).map((request) => (
            <View
              key={`sender-${request.id}`}
              style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
              {(() => {
                const rideStatus = readRideStatus(request.routeAdjustment);
                const senderStatusMessage =
                  request.status !== 'accepted'
                    ? request.status === 'pending'
                      ? 'Waiting for host response'
                      : 'Not accepted'
                    : rideStatus === 'dropped_off'
                      ? 'Trip complete. You were dropped off.'
                      : rideStatus === 'onboard'
                        ? 'You have been picked up. Heading to destination.'
                        : `Accepted | Pickup ETA ${formatEta(request.etaSeconds)}`;

                return (
                  <>
              <View style={styles.cardHeader}>
                <View style={{ flex: 1, gap: 3 }}>
                  <ThemedText style={[styles.cardTitle, { color: palette.text }]}>
                    {request.carpool.routeTitle}
                  </ThemedText>
                  <ThemedText style={{ color: palette.muted }}>
                    {request.pickupLabel} to {request.dropoffLabel}
                  </ThemedText>
                </View>
                {renderRequestBadge(request.status)}
              </View>
              <ThemedText style={{ color: palette.text }}>
                Host: {request.hostName} | Requested {formatTripDate(request.createdAt)}
              </ThemedText>
              <ThemedText style={{ color: palette.muted }}>
                {senderStatusMessage}
              </ThemedText>
                  </>
                );
              })()}
            </View>
          ))
        )}
      </View>
    );
  }

  function renderHostRequests() {
    return (
      <View style={styles.sectionBlock}>
        <View style={styles.sectionHeader}>
          <ThemedText type="subtitle" style={{ color: palette.text }}>
            Host Requests
          </ThemedText>
          <ThemedText style={{ color: palette.muted }}>{pendingHostRequests.length} pending</ThemedText>
        </View>
        {hostRequests.length === 0 ? (
          <View style={[styles.messageRow, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
            <MaterialIcons name="group" size={18} color={palette.accentAlt} />
            <ThemedText style={{ color: palette.text, flex: 1 }}>
              Incoming rider requests for carpools you host will appear here.
            </ThemedText>
          </View>
        ) : (
          hostRequests.slice(0, 8).map((request) => {
            const acceptingKey = `respond-${request.id}-accepted`;
            const rejectingKey = `respond-${request.id}-rejected`;
            const isPending = request.status === 'pending';

            return (
              <View
                key={`host-${request.id}`}
                style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
                <View style={styles.cardHeader}>
                  <View style={{ flex: 1, gap: 3 }}>
                    <ThemedText style={[styles.cardTitle, { color: palette.text }]}>
                      {request.carpool.routeTitle}
                    </ThemedText>
                    <ThemedText style={{ color: palette.muted }}>
                      Rider {request.requesterName} wants pickup at {request.pickupLabel}
                    </ThemedText>
                  </View>
                  {renderRequestBadge(request.status)}
                </View>

                <ThemedText style={{ color: palette.text }}>
                  Dropoff: {request.dropoffLabel} | Requested {formatTripDate(request.createdAt)}
                </ThemedText>

                {isPending ? (
                  <View style={styles.hostActionRow}>
                    <Pressable
                      disabled={Boolean(actionKey)}
                      onPress={() => handleRespondRequest(request.id, 'accepted')}
                      style={[
                        styles.hostActionButton,
                        { backgroundColor: palette.accent, borderColor: palette.accent },
                      ]}>
                      {actionKey === acceptingKey ? (
                        <ActivityIndicator color="#FFFFFF" />
                      ) : (
                        <MaterialIcons name="check" size={18} color="#FFFFFF" />
                      )}
                      <ThemedText style={styles.hostActionText}>Accept</ThemedText>
                    </Pressable>
                    <Pressable
                      disabled={Boolean(actionKey)}
                      onPress={() => handleRespondRequest(request.id, 'rejected')}
                      style={[
                        styles.hostActionButton,
                        { backgroundColor: palette.error, borderColor: palette.error },
                      ]}>
                      {actionKey === rejectingKey ? (
                        <ActivityIndicator color="#FFFFFF" />
                      ) : (
                        <MaterialIcons name="close" size={18} color="#FFFFFF" />
                      )}
                      <ThemedText style={styles.hostActionText}>Decline</ThemedText>
                    </Pressable>
                  </View>
                ) : (
                  <ThemedText style={{ color: palette.muted }}>
                    {request.status === 'accepted'
                      ? readRideStatus(request.routeAdjustment) === 'dropped_off'
                        ? 'Rider dropped off.'
                        : readRideStatus(request.routeAdjustment) === 'onboard'
                          ? 'Rider onboard.'
                          : `Accepted | ETA shown to rider: ${formatEta(request.etaSeconds)}`
                      : 'Handled'}
                  </ThemedText>
                )}
              </View>
            );
          })
        )}
      </View>
    );
  }
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            <ThemedText type="title" style={[styles.pageTitle, { color: palette.text }]}>
              Carpool
            </ThemedText>
            <ThemedText style={{ color: palette.muted }}>
              Discover nearby live and scheduled rides, then request a seat.
            </ThemedText>
          </View>
          <Pressable
            onPress={() => void refreshAllData()}
            style={[styles.refreshButton, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
            <MaterialIcons name="refresh" size={18} color={palette.accent} />
            <ThemedText style={{ color: palette.text, fontWeight: '700' }}>Refresh</ThemedText>
          </Pressable>
        </View>

        <View style={[styles.intentCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <View style={styles.intentHeader}>
            <MaterialIcons name="route" size={18} color={palette.accent} />
            <ThemedText style={{ color: palette.text, fontWeight: '700' }}>Current Source Preference</ThemedText>
          </View>
          {commuteIntent ? (
            <>
              <ThemedText style={{ color: palette.text }}>
                {commuteIntent.originLabel} to {commuteIntent.destinationLabel}
              </ThemedText>
              <ThemedText style={{ color: palette.muted }}>
                Based on your latest map route | {formatDistance(commuteIntent.distanceMeters)} |{' '}
                {formatDuration(commuteIntent.durationSeconds)}
              </ThemedText>
            </>
          ) : (
            <ThemedText style={{ color: palette.muted }}>
              Open the Map tab, select a source/destination, and fetch a route so carpool matching can use your
              selected source.
            </ThemedText>
          )}
        </View>

        {errorMessage ? (
          <View style={[styles.messageRow, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
            <MaterialIcons name="error-outline" size={18} color={palette.error} />
            <ThemedText style={{ color: palette.text, flex: 1 }}>{errorMessage}</ThemedText>
          </View>
        ) : null}

        {actionError ? (
          <View style={[styles.messageRow, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
            <MaterialIcons name="error-outline" size={18} color={palette.error} />
            <ThemedText style={{ color: palette.text, flex: 1 }}>{actionError}</ThemedText>
          </View>
        ) : null}

        {successMessage ? (
          <View style={[styles.messageRow, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
            <MaterialIcons name="check-circle-outline" size={18} color={palette.accent} />
            <ThemedText style={{ color: palette.text, flex: 1 }}>{successMessage}</ThemedText>
          </View>
        ) : null}

        <Pressable
          onPress={openCreateModal}
          disabled={!hasCommuteIntent}
          style={[
            styles.createButton,
            {
              backgroundColor: hasCommuteIntent ? palette.accentAlt : palette.cardSecondary,
              borderColor: hasCommuteIntent ? palette.accentAlt : palette.border,
            },
          ]}>
          <MaterialIcons name="add-circle-outline" size={18} color="#FFFFFF" />
          <ThemedText style={styles.createButtonText}>Create your own carpool</ThemedText>
        </Pressable>

        {isLoading ? (
          <View style={[styles.loadingCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <ActivityIndicator color={palette.accent} />
            <ThemedText style={{ color: palette.text }}>Loading carpool feed...</ThemedText>
          </View>
        ) : (
          <>
            {renderDiscoverySection(
              'Your Hosted Carpools',
              discovery.hosted,
              'You have not created any active or scheduled carpools yet.'
            )}
            {renderDiscoverySection(
              'Live Carpools Near Source',
              discovery.live,
              'No live carpools are currently near your selected source.'
            )}
            {renderDiscoverySection(
              'Scheduled Carpools Near Route',
              discovery.scheduled,
              'No scheduled carpools match this route right now.'
            )}
            {renderSenderRequests()}
            {renderHostRequests()}
          </>
        )}
      </ScrollView>

      <Modal
        transparent
        visible={createModalVisible}
        animationType="fade"
        onRequestClose={() => setCreateModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <SafeAreaView
            style={[styles.modalCard, { backgroundColor: palette.card, borderColor: palette.border }]}
            edges={['top', 'bottom']}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1, gap: 4 }}>
                <ThemedText type="title" style={[styles.modalTitle, { color: palette.text }]}>
                  Create Carpool
                </ThemedText>
                <ThemedText style={{ color: palette.muted }}>
                  Source and destination come from your latest map request.
                </ThemedText>
              </View>
              <Pressable
                onPress={() => setCreateModalVisible(false)}
                style={[styles.closeButton, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}> 
                <MaterialIcons name="close" size={20} color={palette.text} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.formBody} showsVerticalScrollIndicator={false}>
              <View style={[styles.formCard, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}> 
                <ThemedText style={[styles.inputLabel, { color: palette.muted }]}>Route</ThemedText>
                <ThemedText style={{ color: palette.text }}>
                  {commuteIntent
                    ? `${commuteIntent.originLabel} to ${commuteIntent.destinationLabel}`
                    : 'No map route selected yet.'}
                </ThemedText>
              </View>

              <View style={styles.inputRow}>
                <View style={styles.inputBlock}>
                  <ThemedText style={[styles.inputLabel, { color: palette.muted }]}>Seats</ThemedText>
                  <TextInput
                    value={seatCountInput}
                    onChangeText={setSeatCountInput}
                    keyboardType="number-pad"
                    style={[styles.input, { borderColor: palette.border, backgroundColor: palette.input, color: palette.text }]}
                  />
                </View>
                <View style={styles.inputBlock}>
                  <ThemedText style={[styles.inputLabel, { color: palette.muted }]}>Price / mile</ThemedText>
                  <TextInput
                    value={pricePerMileInput}
                    onChangeText={setPricePerMileInput}
                    keyboardType="decimal-pad"
                    style={[styles.input, { borderColor: palette.border, backgroundColor: palette.input, color: palette.text }]}
                  />
                </View>
              </View>

              <View style={styles.inputRow}>
                <View style={styles.inputBlock}>
                  <ThemedText style={[styles.inputLabel, { color: palette.muted }]}>Max detour (m)</ThemedText>
                  <TextInput
                    value={maxDetourInput}
                    onChangeText={setMaxDetourInput}
                    keyboardType="number-pad"
                    style={[styles.input, { borderColor: palette.border, backgroundColor: palette.input, color: palette.text }]}
                  />
                </View>
                <View style={styles.inputBlock}>
                  <ThemedText style={[styles.inputLabel, { color: palette.muted }]}>Start in (min)</ThemedText>
                  <TextInput
                    value={startOffsetInput}
                    onChangeText={setStartOffsetInput}
                    keyboardType="number-pad"
                    editable={createStatus === 'scheduled'}
                    style={[
                      styles.input,
                      {
                        borderColor: palette.border,
                        backgroundColor: createStatus === 'scheduled' ? palette.input : palette.cardSecondary,
                        color: palette.text,
                      },
                    ]}
                  />
                </View>
              </View>

              <View style={[styles.toggleRow, { borderColor: palette.border }]}> 
                <Pressable
                  onPress={() => setCreateStatus('scheduled')}
                  style={[
                    styles.toggleOption,
                    {
                      backgroundColor: createStatus === 'scheduled' ? palette.accent : 'transparent',
                      borderColor: createStatus === 'scheduled' ? palette.accent : palette.border,
                    },
                  ]}>
                  <ThemedText
                    style={{
                      color: createStatus === 'scheduled' ? '#FFFFFF' : palette.text,
                      fontWeight: '700',
                    }}>
                    Scheduled
                  </ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => setCreateStatus('active')}
                  style={[
                    styles.toggleOption,
                    {
                      backgroundColor: createStatus === 'active' ? palette.accent : 'transparent',
                      borderColor: createStatus === 'active' ? palette.accent : palette.border,
                    },
                  ]}>
                  <ThemedText
                    style={{
                      color: createStatus === 'active' ? '#FFFFFF' : palette.text,
                      fontWeight: '700',
                    }}>
                    Go live now
                  </ThemedText>
                </Pressable>
              </View>

              <View style={styles.inputBlock}>
                <ThemedText style={[styles.inputLabel, { color: palette.muted }]}>Vehicle (optional)</ThemedText>
                <TextInput
                  value={vehicleInput}
                  onChangeText={setVehicleInput}
                  placeholder="Example: Blue Honda Civic"
                  placeholderTextColor={palette.muted}
                  style={[styles.input, { borderColor: palette.border, backgroundColor: palette.input, color: palette.text }]}
                />
              </View>

              <View style={styles.inputBlock}>
                <ThemedText style={[styles.inputLabel, { color: palette.muted }]}>Notes (optional)</ThemedText>
                <TextInput
                  value={notesInput}
                  onChangeText={setNotesInput}
                  placeholder="Pickup instructions, luggage limits, etc."
                  placeholderTextColor={palette.muted}
                  multiline
                  style={[
                    styles.input,
                    styles.notesInput,
                    { borderColor: palette.border, backgroundColor: palette.input, color: palette.text },
                  ]}
                />
              </View>

              {createError ? (
                <View style={[styles.messageRow, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}> 
                  <MaterialIcons name="error-outline" size={18} color={palette.error} />
                  <ThemedText style={{ color: palette.text, flex: 1 }}>{createError}</ThemedText>
                </View>
              ) : null}

              <Pressable
                disabled={isCreatingCarpool || !hasCommuteIntent}
                onPress={handleCreateCarpool}
                style={[
                  styles.primaryButton,
                  {
                    backgroundColor: hasCommuteIntent ? palette.accent : palette.cardSecondary,
                    borderColor: hasCommuteIntent ? palette.accent : palette.border,
                    opacity: isCreatingCarpool ? 0.75 : 1,
                  },
                ]}>
                {isCreatingCarpool ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <MaterialIcons name="directions-car" size={18} color="#FFFFFF" />
                )}
                <ThemedText style={styles.primaryButtonText}>Create carpool</ThemedText>
              </Pressable>
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>

      <Modal
        transparent
        visible={simulationVisible}
        animationType="fade"
        onRequestClose={handleCloseSimulation}>
        <View style={styles.modalBackdrop}>
          <SafeAreaView
            style={[styles.modalCard, { backgroundColor: palette.card, borderColor: palette.border }]}
            edges={['top', 'bottom']}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1, gap: 4 }}>
                <ThemedText type="title" style={[styles.modalTitle, { color: palette.text }]}>
                  Live Carpool Simulation
                </ThemedText>
                <ThemedText style={{ color: palette.muted }}>
                  {simulationCarpool
                    ? `${simulationCarpool.originLabel} to ${simulationCarpool.destinationLabel}`
                    : 'Routing demo'}
                </ThemedText>
              </View>
              <Pressable
                onPress={handleCloseSimulation}
                style={[styles.closeButton, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
                <MaterialIcons name="close" size={20} color={palette.text} />
              </Pressable>
            </View>

            <MapView
              ref={simulationMapRef}
              style={styles.simulationMap}
              initialRegion={simulationRegion}
              zoomEnabled
              scrollEnabled
              rotateEnabled={false}
              pitchEnabled={false}>
              {simulationPath.length >= 2 ? (
                <>
                  <Polyline coordinates={simulationPath} strokeColor={palette.accent} strokeWidth={5} />
                  <Marker coordinate={simulationPath[0]} title="Start" pinColor={palette.accent} />
                  <Marker
                    coordinate={simulationPath[simulationPath.length - 1]}
                    title="Destination"
                    pinColor={palette.accentAlt}
                  />
                </>
              ) : null}

              {simulationStops.map((stop) => (
                <Marker
                  key={`pickup-${stop.requestId}`}
                  coordinate={stop.pickupPoint}
                  title={`Pickup: ${stop.riderName}`}
                  description={stop.pickupLabel}
                  pinColor="#2E7D32"
                />
              ))}

              {simulationStops.map((stop) => (
                <Marker
                  key={`dropoff-${stop.requestId}`}
                  coordinate={stop.dropoffPoint}
                  title={`Dropoff: ${stop.riderName}`}
                  description={stop.dropoffLabel}
                  pinColor="#AD1457"
                />
              ))}

              {simulationMarker ? (
                <Marker coordinate={simulationMarker} title="Carpool Vehicle">
                  <View
                    style={[
                      styles.simulationMarkerBubble,
                      { backgroundColor: palette.accentAlt, borderColor: '#FFFFFF' },
                    ]}>
                    <MaterialIcons name="directions-car" size={18} color="#FFFFFF" />
                  </View>
                </Marker>
              ) : null}
            </MapView>

            <View style={styles.metricRow}>
              <View style={[styles.metricCard, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
                <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>Progress</ThemedText>
                <ThemedText style={{ color: palette.text, fontWeight: '700' }}>{simulationProgress}%</ThemedText>
              </View>
              <View style={[styles.metricCard, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
                <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>Onboard</ThemedText>
                <ThemedText style={{ color: palette.text, fontWeight: '700' }}>
                  {simulationOnboardCount}
                </ThemedText>
              </View>
              <View style={[styles.metricCard, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
                <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>Dropped</ThemedText>
                <ThemedText style={{ color: palette.text, fontWeight: '700' }}>
                  {simulationCompletedRides}
                </ThemedText>
              </View>
            </View>

            <ScrollView contentContainerStyle={styles.simulationStopsList} showsVerticalScrollIndicator={false}>
              {simulationStops.length === 0 ? (
                <View style={[styles.messageRow, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
                  <MaterialIcons name="info-outline" size={18} color={palette.accentAlt} />
                  <ThemedText style={{ color: palette.text, flex: 1 }}>
                    No accepted riders yet. Accept requests to show pickup/dropoff events in simulation.
                  </ThemedText>
                </View>
              ) : (
                simulationStops.map((stop) => {
                  const hasPicked = simulationIndex >= stop.pickupIndex;
                  const hasDropped = simulationIndex >= stop.dropoffIndex;
                  const statusLabel = !hasPicked
                    ? 'Waiting pickup'
                    : hasDropped
                      ? 'Dropped off'
                      : 'In car';
                  const statusColor = !hasPicked ? palette.accentAlt : hasDropped ? palette.accent : palette.text;

                  return (
                    <View
                      key={`rider-stop-${stop.requestId}`}
                      style={[styles.card, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
                      <ThemedText style={[styles.cardTitle, { color: palette.text }]}>{stop.riderName}</ThemedText>
                      <ThemedText style={{ color: palette.muted }}>
                        Pickup: {stop.pickupLabel}
                      </ThemedText>
                      <ThemedText style={{ color: palette.muted }}>
                        Dropoff: {stop.dropoffLabel}
                      </ThemedText>
                      <ThemedText style={{ color: statusColor, fontWeight: '700' }}>{statusLabel}</ThemedText>
                    </View>
                  );
                })
              )}
            </ScrollView>

            <View style={styles.hostActionRow}>
              <Pressable
                onPress={handleRestartSimulation}
                style={[styles.hostActionButton, { backgroundColor: palette.accent, borderColor: palette.accent }]}>
                <MaterialIcons name="replay" size={18} color="#FFFFFF" />
                <ThemedText style={styles.hostActionText}>
                  {simulationComplete ? 'Replay' : 'Restart'}
                </ThemedText>
              </Pressable>
              <Pressable
                onPress={handleCloseSimulation}
                style={[styles.hostActionButton, { backgroundColor: palette.error, borderColor: palette.error }]}>
                <MaterialIcons name="close" size={18} color="#FFFFFF" />
                <ThemedText style={styles.hostActionText}>Close</ThemedText>
              </Pressable>
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    padding: 20,
    gap: 14,
    paddingBottom: 30,
  },
  headerRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  headerCopy: {
    flex: 1,
    gap: 4,
  },
  pageTitle: {
    fontSize: 30,
    lineHeight: 34,
  },
  refreshButton: {
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  intentCard: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 14,
    gap: 8,
  },
  intentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loadingCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    alignItems: 'center',
    gap: 10,
  },
  sectionBlock: {
    gap: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  card: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  hostBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metricRow: {
    flexDirection: 'row',
    gap: 8,
  },
  metricCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  metadataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  createButton: {
    minHeight: 50,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  createButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  messageRow: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 15,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  secondaryButton: {
    minHeight: 46,
    borderRadius: 15,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  secondaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  hostActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  hostActionButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  hostActionText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 18,
    backgroundColor: 'rgba(4, 8, 6, 0.56)',
  },
  modalCard: {
    maxHeight: '90%',
    borderRadius: 28,
    borderWidth: 1,
    padding: 18,
    gap: 14,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  modalTitle: {
    fontSize: 26,
    lineHeight: 30,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formBody: {
    gap: 12,
    paddingBottom: 8,
  },
  simulationMap: {
    height: 220,
    borderRadius: 18,
    overflow: 'hidden',
  },
  simulationMarkerBubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  simulationStopsList: {
    gap: 10,
    paddingBottom: 4,
  },
  formCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 12,
    gap: 6,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 10,
  },
  inputBlock: {
    flex: 1,
    gap: 6,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  notesInput: {
    minHeight: 92,
    textAlignVertical: 'top',
  },
  toggleRow: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 5,
    flexDirection: 'row',
    gap: 6,
  },
  toggleOption: {
    flex: 1,
    minHeight: 38,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

