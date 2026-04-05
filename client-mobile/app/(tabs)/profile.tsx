import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';
import { type ComponentProps, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';

import { ThemedText } from '@/components/themed-text';
import { useUserProfile } from '@/context/user-context';
import {
  acceptCarpoolRequest,
  cancelCarpool,
  cancelCarpoolRequest,
  completeCarpool,
  fetchUserDashboard,
  fetchUserTrips,
  rejectCarpoolRequest,
  startCarpool,
} from '@/lib/api';
import { getCarpoolRoleStatus } from '@/lib/carpool-status';
import { formatCo2, formatDistance, formatDuration, formatMultiplier, formatTripDate } from '@/lib/formatters';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { UserDashboard } from '@/types/dashboard';
import { TripRecord } from '@/types/trips';

const CARPOOL_POLL_INTERVAL_MS = 5000;

type HistoryView = 'personal' | 'offered';
type HistoryTripMeta = {
  icon: ComponentProps<typeof MaterialIcons>['name'];
  label: string;
};

type TreeVisual = {
  badge: string;
  icon: ComponentProps<typeof MaterialIcons>['name'];
  tint: string;
  surface: string;
};

const TREE_VISUALS: Record<string, TreeVisual> = {
  sapling: {
    badge: 'SP',
    icon: 'eco',
    tint: '#5D9A49',
    surface: '#E5F4DE',
  },
  bush: {
    badge: 'BU',
    icon: 'eco',
    tint: '#337A4F',
    surface: '#DDEFE3',
  },
  oak: {
    badge: 'OK',
    icon: 'park',
    tint: '#5D6E2E',
    surface: '#ECF1DE',
  },
  pine: {
    badge: 'PI',
    icon: 'park',
    tint: '#21604C',
    surface: '#E0EFE8',
  },
  'cherry-blossom': {
    badge: 'CB',
    icon: 'local-florist',
    tint: '#BC6C8D',
    surface: '#F8EAF1',
  },
  cedar: {
    badge: 'CE',
    icon: 'park',
    tint: '#6B7A35',
    surface: '#EEF3E1',
  },
};

function formatPoints(points: number) {
  return `${points.toLocaleString()} pts`;
}

function getTripPoints(trip: { co2SavedKg: number }) {
  return Math.max(Math.round(trip.co2SavedKg * 100), 0);
}

function getTreeVisual(treeTypeId: string): TreeVisual {
  return (
    TREE_VISUALS[treeTypeId] ?? {
      badge: treeTypeId.slice(0, 2).toUpperCase(),
      icon: 'park',
      tint: '#4F7A5B',
      surface: '#E7F0EA',
    }
  );
}

function getGridKey(x: number, y: number) {
  return `${x}:${y}`;
}

function getHistoryTripMeta(trip: TripRecord): HistoryTripMeta {
  if (trip.routeType === 'transit') {
    return {
      icon: 'directions-transit',
      label: 'Public Transport',
    };
  }

  if (trip.routeType === 'carpool') {
    return trip.participantRole === 'driver'
      ? {
          icon: 'drive-eta',
          label: 'Ride Offered',
        }
      : {
          icon: 'groups',
          label: 'Carpool Rider',
        };
  }

  if (trip.routeType === 'walk') {
    return {
      icon: 'directions-walk',
      label: 'Walk',
    };
  }

  if (trip.routeType === 'drive') {
    return {
      icon: 'directions-car',
      label: 'Drive',
    };
  }

  return {
    icon: 'directions-bike',
    label: 'Bike',
  };
}

export default function ProfileScreen() {
  const colorScheme = useColorScheme();
  const isFocused = useIsFocused();
  const router = useRouter();
  const {
    userId,
    displayName,
    activeProfile,
    availableProfiles,
    loginWithUsername,
    tripVersion,
    notifyTripSaved,
  } = useUserProfile();
  const [loginName, setLoginName] = useState(displayName);
  const [dashboard, setDashboard] = useState<UserDashboard | null>(null);
  const [isDashboardLoading, setIsDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [historyTrips, setHistoryTrips] = useState<TripRecord[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyView, setHistoryView] = useState<HistoryView>('personal');
  const [loginVisible, setLoginVisible] = useState(false);
  const [carpoolActionError, setCarpoolActionError] = useState<string | null>(null);
  const [carpoolActionMessage, setCarpoolActionMessage] = useState<string | null>(null);
  const [carpoolActionKey, setCarpoolActionKey] = useState<string | null>(null);
  const [loginMessage, setLoginMessage] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);

  const palette =
    colorScheme === 'dark'
      ? {
          background: '#09120E',
          card: '#13201A',
          cardSecondary: '#1A2A22',
          border: '#294036',
          text: '#EAF5EE',
          muted: '#A1B4A7',
          accent: '#4DA86D',
          accentAlt: '#D6A44B',
          accentSoft: 'rgba(77, 168, 109, 0.16)',
          input: '#102019',
          canvas: '#0F1713',
          shadow: '#000000',
          errorSurface: 'rgba(203, 99, 84, 0.12)',
          warningSurface: 'rgba(214, 164, 75, 0.14)',
        }
      : {
          background: '#EEF4EA',
          card: '#FFFFFF',
          cardSecondary: '#F1F7EE',
          border: '#D7E2D5',
          text: '#173126',
          muted: '#5B7266',
          accent: '#20744A',
          accentAlt: '#C7841F',
          accentSoft: 'rgba(32, 116, 74, 0.1)',
          input: '#F8FBF6',
          canvas: '#E7F0E4',
          shadow: '#173126',
          errorSurface: '#FDF1EE',
          warningSurface: '#FFF7E9',
        };

  function getCarpoolStatusColors(tone: ReturnType<typeof getCarpoolRoleStatus>['tone']) {
    if (tone === 'accent') {
      return {
        backgroundColor: colorScheme === 'dark' ? 'rgba(77, 168, 109, 0.16)' : '#EFF8F1',
        borderColor: colorScheme === 'dark' ? '#2B6A43' : '#CAE6D1',
        iconColor: palette.accent,
        badgeBackgroundColor: colorScheme === 'dark' ? '#183623' : '#DFF1E4',
      };
    }

    if (tone === 'warning') {
      return {
        backgroundColor: colorScheme === 'dark' ? 'rgba(214, 164, 75, 0.16)' : '#FFF6E8',
        borderColor: colorScheme === 'dark' ? '#7C5A1B' : '#F1DBB1',
        iconColor: palette.accentAlt,
        badgeBackgroundColor: colorScheme === 'dark' ? '#3D2B11' : '#FCE8BF',
      };
    }

    if (tone === 'success') {
      return {
        backgroundColor: colorScheme === 'dark' ? 'rgba(64, 180, 120, 0.14)' : '#ECF9F0',
        borderColor: colorScheme === 'dark' ? '#276845' : '#CBE7D5',
        iconColor: palette.accent,
        badgeBackgroundColor: colorScheme === 'dark' ? '#173123' : '#DDF2E4',
      };
    }

    return {
      backgroundColor: colorScheme === 'dark' ? '#161E19' : '#F4F7F3',
      borderColor: palette.border,
      iconColor: palette.muted,
      badgeBackgroundColor: colorScheme === 'dark' ? '#213029' : '#E8EDE7',
    };
  }

  function formatCarpoolTrustSummary(trip: UserDashboard['carpools']['trips'][number]) {
    if (trip.trustSignals.ratingCount > 0) {
      return `${trip.trustSignals.ratingAverage.toFixed(1)} stars`;
    }

    if (trip.trustSignals.ridesCompleted > 0) {
      return `${trip.trustSignals.ridesCompleted} rides`;
    }

    return 'New driver';
  }

  useEffect(() => {
    setLoginName(displayName);
  }, [displayName]);

  function handleUsernameLogin() {
    const result = loginWithUsername(loginName);

    if (!result.ok) {
      setLoginError(result.error);
      setLoginMessage(null);
      return;
    }

    setLoginError(null);
    setLoginMessage(`Signed in as ${loginName.trim() || activeProfile.displayName}.`);
  }

  useEffect(() => {
    if (!isFocused) {
      return;
    }

    let isMounted = true;

    async function loadDashboard(options?: { silent?: boolean }) {
      if (!options?.silent) {
        setIsDashboardLoading(true);
      }

      setDashboardError(null);

      try {
        const nextDashboard = await fetchUserDashboard(userId);
        if (isMounted) {
          setDashboard(nextDashboard);
        }
      } catch (error) {
        if (isMounted) {
          setDashboardError(
            error instanceof Error ? error.message : 'Unable to load your sustainability dashboard.'
          );
        }
      } finally {
        if (isMounted && !options?.silent) {
          setIsDashboardLoading(false);
        }
      }
    }

    void loadDashboard();
    const intervalId = setInterval(() => {
      void loadDashboard({ silent: true });
    }, CARPOOL_POLL_INTERVAL_MS);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [isFocused, tripVersion, userId]);

  useEffect(() => {
    if (!isFocused || !historyVisible) {
      return;
    }

    let isMounted = true;

    async function loadHistory() {
      setIsHistoryLoading(true);
      setHistoryError(null);

      try {
        const nextTrips = await fetchUserTrips(userId);
        if (isMounted) {
          setHistoryTrips(nextTrips);
        }
      } catch (error) {
        if (isMounted) {
          setHistoryError(error instanceof Error ? error.message : 'Unable to load trip history.');
        }
      } finally {
        if (isMounted) {
          setIsHistoryLoading(false);
        }
      }
    }

    void loadHistory();

    return () => {
      isMounted = false;
    };
  }, [historyVisible, isFocused, tripVersion, userId]);

  const summary = dashboard?.summary ?? null;
  const forest = dashboard?.forest ?? null;
  const carpoolSummary = dashboard?.carpools.summary ?? null;
  const myCarpools = dashboard?.carpools.trips ?? [];
  const displayNameForHeader = displayName || summary?.displayName || 'Campus Rider';
  const personalHistoryTrips = historyTrips.filter(
    (trip) =>
      trip.routeType === 'walk' ||
      trip.routeType === 'bike' ||
      trip.routeType === 'drive' ||
      trip.routeType === 'transit' ||
      (trip.routeType === 'carpool' && trip.participantRole === 'rider')
  );
  const offeredHistoryTrips = historyTrips.filter(
    (trip) => trip.routeType === 'carpool' && trip.participantRole === 'driver'
  );
  const activeCarpoolTrips = myCarpools.filter((trip) =>
    ['draft', 'scheduled', 'confirmed', 'active'].includes(trip.status)
  );

  function openHistoryModal() {
    setHistoryView('personal');
    setHistoryVisible(true);
  }

  function openLoginModal() {
    setLoginName(activeProfile.displayName);
    setLoginError(null);
    setLoginMessage(null);
    setLoginVisible(true);
  }

  function openForestTab() {
    router.push('/(tabs)/forest');
  }

  function handleProfileChipPress(profileName: string) {
    setLoginName(profileName);
    const result = loginWithUsername(profileName);

    if (!result.ok) {
      setLoginError(result.error);
      setLoginMessage(null);
      return;
    }

    setLoginError(null);
    setLoginMessage(`Signed in as ${profileName}.`);
  }

  async function refreshDashboardSnapshot() {
    const nextDashboard = await fetchUserDashboard(userId);
    setDashboard(nextDashboard);
  }

  async function handleCarpoolAction(actionKey: string, task: () => Promise<unknown>) {
    setCarpoolActionKey(actionKey);
    setCarpoolActionError(null);
    setCarpoolActionMessage(null);

    try {
      await task();
      await refreshDashboardSnapshot();
      notifyTripSaved();
      setCarpoolActionMessage('Carpool details updated.');
    } catch (error) {
      setCarpoolActionError(
        error instanceof Error ? error.message : 'Unable to update this carpool right now.'
      );
    } finally {
      setCarpoolActionKey(null);
    }
  }

  function renderForestPreviewGrid() {
    if (!forest) {
      return null;
    }

    const occupiedTrees = new Map(
      forest.plantedTrees.map((tree) => [getGridKey(tree.gridX, tree.gridY), tree])
    );
    const rows = Array.from({ length: forest.gridRows }, (_, rowIndex) => rowIndex);
    const columns = Array.from({ length: forest.gridColumns }, (_, columnIndex) => columnIndex);

    return (
      <View style={styles.forestGrid}>
        {rows.map((row) => (
          <View key={`row-${row}`} style={styles.forestGridRow}>
            {columns.map((column) => {
              const key = getGridKey(column, row);
              const plantedTree = occupiedTrees.get(key);

              if (plantedTree) {
                const treeVisual = getTreeVisual(plantedTree.treeTypeId);

                return (
                  <View
                    key={key}
                    style={[
                      styles.forestCell,
                      {
                        backgroundColor: treeVisual.surface,
                        borderColor: palette.border,
                      },
                    ]}>
                    <View
                      style={[
                        styles.treeAvatar,
                        {
                          backgroundColor: `${treeVisual.tint}20`,
                          borderColor: `${treeVisual.tint}4D`,
                        },
                      ]}>
                      <MaterialIcons name={treeVisual.icon} size={20} color={treeVisual.tint} />
                    </View>
                    <ThemedText style={[styles.treeBadgeText, { color: treeVisual.tint }]}>
                      {treeVisual.badge}
                    </ThemedText>
                  </View>
                );
              }

              return (
                <View
                  key={key}
                  style={[
                    styles.forestCell,
                    {
                      backgroundColor: palette.input,
                      borderColor: palette.border,
                    },
                  ]}
                />
              );
            })}
          </View>
        ))}
      </View>
    );
  }

  function renderHistoryContent() {
    const filteredTrips = historyView === 'personal' ? personalHistoryTrips : offeredHistoryTrips;

    if (isHistoryLoading) {
      return (
        <View style={[styles.messageCard, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
          <ActivityIndicator color={palette.accent} />
          <ThemedText style={{ color: palette.text }}>Loading history...</ThemedText>
        </View>
      );
    }

    if (historyError && filteredTrips.length === 0) {
      return (
        <View style={[styles.messageCard, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
          <MaterialIcons name="error-outline" size={20} color={palette.accentAlt} />
          <ThemedText style={{ color: palette.text, flex: 1 }}>{historyError}</ThemedText>
        </View>
      );
    }

    if (filteredTrips.length === 0) {
      return (
        <View style={[styles.messageCard, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
          <MaterialIcons name="history" size={20} color={palette.accent} />
          <ThemedText style={{ color: palette.text, flex: 1 }}>
            {historyView === 'personal'
              ? 'No personal trips saved yet. Complete a walk, bike, transit, or rider carpool trip to build your history.'
              : 'No rides offered yet. Publish and complete a carpool as a driver to see it here.'}
          </ThemedText>
        </View>
      );
    }

    return filteredTrips.map((trip) => (
      <View
        key={trip.id}
        style={[styles.tripCard, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
        <View style={styles.tripHeader}>
          {(() => {
            const tripMeta = getHistoryTripMeta(trip);

            return (
              <View
                accessibilityLabel={tripMeta.label}
                style={[styles.historyTypeBadge, { backgroundColor: `${palette.accent}18` }]}>
                <MaterialIcons name={tripMeta.icon} size={18} color={palette.accent} />
              </View>
            );
          })()}
          <View style={{ flex: 1 }}>
            <ThemedText style={[styles.tripTitle, { color: palette.text }]}>{trip.routeTitle}</ThemedText>
            <ThemedText style={{ color: palette.muted }}>
              {trip.originLabel} to {trip.destinationLabel}
            </ThemedText>
          </View>
        </View>

        <View style={styles.tripMetricRow}>
          <ThemedText style={{ color: palette.text }}>{formatDuration(trip.durationSeconds)}</ThemedText>
          <ThemedText style={{ color: palette.text }}>{formatDistance(trip.distanceMeters)}</ThemedText>
          <ThemedText style={{ color: palette.text }}>{formatCo2(trip.co2SavedKg)} saved</ThemedText>
        </View>

        <ThemedText style={{ color: palette.muted }}>
          Logged {formatTripDate(trip.completedAt)} | earned {formatPoints(getTripPoints(trip))}
        </ThemedText>
      </View>
    ));
  }

  function renderCarpoolActions(trip: UserDashboard['carpools']['trips'][number]) {
    const isDriver = trip.currentUserRole === 'driver';
    const pendingRequests = trip.requests?.filter((request) => request.status === 'pending') ?? [];
    const canStart = isDriver && trip.status === 'confirmed' && trip.acceptedRiders > 0;
    const canComplete = isDriver && trip.status === 'active';
    const canCancelTrip = isDriver && ['draft', 'scheduled', 'confirmed', 'active'].includes(trip.status);
    const canCancelRequest =
      !isDriver &&
      trip.currentUserRequest != null &&
      ['pending', 'accepted'].includes(trip.currentUserRequest.status);

    return (
      <View style={styles.carpoolActionGroup}>
        {pendingRequests.map((request) => {
          const acceptKey = `accept-${trip.id}-${request.id}`;
          const rejectKey = `reject-${trip.id}-${request.id}`;

          return (
            <View
              key={request.id}
              style={[
                styles.carpoolPendingRequestCard,
                { backgroundColor: palette.cardSecondary, borderColor: palette.border },
              ]}>
              <ThemedText style={[styles.tripTitle, { color: palette.text }]}>
                {request.riderName ?? `Rider #${request.riderId}`}
              </ThemedText>
              <ThemedText style={{ color: palette.muted }}>
                Adds about {request.estimatedAddedMinutes} min | {request.riderOriginLabel} to{' '}
                {request.riderDestinationLabel}
              </ThemedText>
              <View style={styles.carpoolInlineActions}>
                <Pressable
                  onPress={() =>
                    void handleCarpoolAction(acceptKey, () =>
                      acceptCarpoolRequest(trip.id, request.id, userId)
                    )
                  }
                  style={[styles.carpoolDecisionButton, { backgroundColor: palette.accent }]}
                  disabled={carpoolActionKey === acceptKey || carpoolActionKey === rejectKey}>
                  <ThemedText style={[styles.primaryActionText, { color: '#FFFFFF' }]}>
                    {carpoolActionKey === acceptKey ? 'Accepting...' : 'Accept'}
                  </ThemedText>
                </Pressable>
                <Pressable
                  onPress={() =>
                    void handleCarpoolAction(rejectKey, () =>
                      rejectCarpoolRequest(trip.id, request.id, userId)
                    )
                  }
                  style={[styles.carpoolDecisionButton, { backgroundColor: palette.accentAlt }]}
                  disabled={carpoolActionKey === acceptKey || carpoolActionKey === rejectKey}>
                  <ThemedText style={[styles.primaryActionText, { color: '#FFFFFF' }]}>
                    {carpoolActionKey === rejectKey ? 'Rejecting...' : 'Reject'}
                  </ThemedText>
                </Pressable>
              </View>
            </View>
          );
        })}

        {isDriver && trip.status === 'scheduled' ? (
          <View
            style={[
              styles.messageCard,
              { backgroundColor: palette.cardSecondary, borderColor: palette.border },
            ]}>
            <MaterialIcons name="groups" size={18} color={palette.accent} />
            <ThemedText style={{ color: palette.text, flex: 1 }}>
              Accept a rider first. Once the trip is confirmed, both devices can run the live shared ride simulation from the carpool tab.
            </ThemedText>
          </View>
        ) : null}

        {!isDriver &&
        trip.currentUserRequest?.status === 'accepted' &&
        ['scheduled', 'confirmed'].includes(trip.status) ? (
          <View
            style={[
              styles.messageCard,
              { backgroundColor: palette.cardSecondary, borderColor: palette.border },
            ]}>
            <MaterialIcons name="hourglass-top" size={18} color={palette.accentAlt} />
            <ThemedText style={{ color: palette.text, flex: 1 }}>
              Your seat is confirmed. The driver still needs to start the carpool before the live ride simulation begins on both devices.
            </ThemedText>
          </View>
        ) : null}

        {!isDriver && trip.currentUserRequest?.status === 'accepted' && trip.status === 'active' ? (
          <View
            style={[
              styles.messageCard,
              { backgroundColor: palette.cardSecondary, borderColor: palette.border },
            ]}>
            <MaterialIcons name="navigation" size={18} color={palette.accent} />
            <ThemedText style={{ color: palette.text, flex: 1 }}>
              The shared ride is live now. Open the carpool tab on the map screen to follow the trip on this device.
            </ThemedText>
          </View>
        ) : null}

        <View style={styles.carpoolInlineActions}>
          {canStart ? (
            <Pressable
              onPress={() => void handleCarpoolAction(`start-${trip.id}`, () => startCarpool(trip.id, userId))}
              style={[styles.carpoolDecisionButton, { backgroundColor: palette.accent }]}
              disabled={carpoolActionKey === `start-${trip.id}`}>
              <ThemedText style={[styles.primaryActionText, { color: '#FFFFFF' }]}>
                {carpoolActionKey === `start-${trip.id}` ? 'Starting...' : 'Start'}
              </ThemedText>
            </Pressable>
          ) : null}

          {canComplete ? (
            <Pressable
              onPress={() =>
                void handleCarpoolAction(`complete-${trip.id}`, () => completeCarpool(trip.id, userId))
              }
              style={[styles.carpoolDecisionButton, { backgroundColor: palette.accent }]}
              disabled={carpoolActionKey === `complete-${trip.id}`}>
              <ThemedText style={[styles.primaryActionText, { color: '#FFFFFF' }]}>
                {carpoolActionKey === `complete-${trip.id}` ? 'Completing...' : 'Complete'}
              </ThemedText>
            </Pressable>
          ) : null}

          {canCancelTrip ? (
            <Pressable
              onPress={() =>
                void handleCarpoolAction(`cancel-trip-${trip.id}`, () => cancelCarpool(trip.id, userId))
              }
              style={[styles.carpoolDecisionButton, { backgroundColor: palette.accentAlt }]}
              disabled={carpoolActionKey === `cancel-trip-${trip.id}`}>
              <ThemedText style={[styles.primaryActionText, { color: '#FFFFFF' }]}>
                {carpoolActionKey === `cancel-trip-${trip.id}` ? 'Cancelling...' : 'Cancel ride'}
              </ThemedText>
            </Pressable>
          ) : null}

          {canCancelRequest && trip.currentUserRequest ? (
            <Pressable
              onPress={() =>
                void handleCarpoolAction(`cancel-request-${trip.id}`, () =>
                  cancelCarpoolRequest(trip.id, trip.currentUserRequest!.id, userId)
                )
              }
              style={[styles.carpoolDecisionButton, { backgroundColor: palette.accentAlt }]}
              disabled={carpoolActionKey === `cancel-request-${trip.id}`}>
              <ThemedText style={[styles.primaryActionText, { color: '#FFFFFF' }]}>
                {carpoolActionKey === `cancel-request-${trip.id}` ? 'Cancelling...' : 'Cancel request'}
              </ThemedText>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.pageHeader}>
          <View style={styles.headerCopy}>
            <ThemedText type="title" style={[styles.pageTitle, { color: palette.text }]}>
              Profile
            </ThemedText>
            <ThemedText style={{ color: palette.muted }}>
              Grow a virtual forest from every lower-carbon trip you take.
            </ThemedText>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              accessibilityLabel="Profiles"
              onPress={openLoginModal}
              style={[styles.historyButton, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
              <MaterialIcons name="person-outline" size={18} color={palette.accent} />
            </Pressable>
            <Pressable
              accessibilityLabel="History"
              onPress={openHistoryModal}
              style={[styles.historyButton, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
              <MaterialIcons name="history" size={18} color={palette.accent} />
            </Pressable>
          </View>
        </View>

        {dashboardError ? (
          <View style={[styles.bannerCard, { backgroundColor: palette.errorSurface, borderColor: palette.border }]}>
            <MaterialIcons name="error-outline" size={20} color={palette.accentAlt} />
            <ThemedText style={{ color: palette.text, flex: 1 }}>{dashboardError}</ThemedText>
          </View>
        ) : null}

        {isDashboardLoading && !dashboard ? (
          <View style={[styles.loadingCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <ActivityIndicator color={palette.accent} />
            <ThemedText style={{ color: palette.text }}>Building your sustainability dashboard...</ThemedText>
          </View>
        ) : null}

        {summary ? (
          <>
            <View
              style={[
                styles.heroCard,
                {
                  backgroundColor: palette.card,
                  borderColor: palette.border,
                  shadowColor: palette.shadow,
                },
              ]}>
              <View style={[styles.heroOrbLarge, { backgroundColor: palette.accentSoft }]} />
              <View style={[styles.heroOrbSmall, { backgroundColor: `${palette.accentAlt}18` }]} />

              <View style={styles.heroHeader}>
                <View style={styles.heroHeaderCopy}>
                  <ThemedText style={[styles.heroEyebrow, { color: palette.accent }]}>
                    Sustainability Dashboard
                  </ThemedText>
                  <ThemedText type="title" style={[styles.heroTitle, { color: palette.text }]}>
                    {displayNameForHeader}
                  </ThemedText>
                  <ThemedText style={[styles.heroSubtitle, { color: palette.muted }]}>
                    {dashboard?.narrative}
                  </ThemedText>
                </View>

                <View style={[styles.balanceChip, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
                  <ThemedText style={[styles.balanceChipLabel, { color: palette.muted }]}>Available</ThemedText>
                  <ThemedText style={[styles.balanceChipValue, { color: palette.text }]}>
                    {formatPoints(summary.totalPointsAvailable)}
                  </ThemedText>
                </View>
              </View>

              <View style={styles.heroMetricRow}>
                <View style={[styles.heroMetricCard, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
                  <View style={[styles.metricIcon, { backgroundColor: palette.accentSoft }]}>
                    <MaterialIcons name="stars" size={22} color={palette.accent} />
                  </View>
                  <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>Total points</ThemedText>
                  <ThemedText style={[styles.metricValue, { color: palette.text }]}>
                    {formatPoints(summary.totalPointsEarned)}
                  </ThemedText>
                  <ThemedText style={{ color: palette.muted }}>
                    Earned from low-carbon route choices across your trips.
                  </ThemedText>
                </View>

                <View style={[styles.heroMetricCard, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
                  <View style={[styles.metricIcon, { backgroundColor: palette.accentSoft }]}>
                    <MaterialIcons name="eco" size={22} color={palette.accent} />
                  </View>
                  <ThemedText style={[styles.metricLabel, { color: palette.muted }]}>CO2 saved</ThemedText>
                  <ThemedText style={[styles.metricValue, { color: palette.text }]}>
                    {formatCo2(summary.totalCo2SavedKg)}
                  </ThemedText>
                  <ThemedText style={{ color: palette.muted }}>
                    Your avoided emissions compared with the driving baseline.
                  </ThemedText>
                </View>
              </View>

              <View style={[styles.narrativeCard, { backgroundColor: palette.input, borderColor: palette.border }]}>
                <MaterialIcons name="insights" size={18} color={palette.accent} />
                <ThemedText style={{ color: palette.text, flex: 1 }}>
                  Each planted tree represents a visible piece of your positive environmental impact.
                </ThemedText>
              </View>
            </View>

            <View style={styles.summaryGrid}>
              <View style={[styles.summaryCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
                <ThemedText style={[styles.summaryLabel, { color: palette.muted }]}>Trips</ThemedText>
                <ThemedText style={[styles.summaryValue, { color: palette.text }]}>{summary.totalTrips}</ThemedText>
              </View>
              <View style={[styles.summaryCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
                <ThemedText style={[styles.summaryLabel, { color: palette.muted }]}>Distance</ThemedText>
                <ThemedText style={[styles.summaryValue, { color: palette.text }]}>
                  {formatDistance(summary.totalDistanceMeters)}
                </ThemedText>
              </View>
              <View style={[styles.summaryCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
                <ThemedText style={[styles.summaryLabel, { color: palette.muted }]}>CO2 saved</ThemedText>
                <ThemedText style={[styles.summaryValue, { color: palette.text }]}>
                  {formatCo2(summary.totalCo2SavedKg)}
                </ThemedText>
              </View>
              <View style={[styles.summaryCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
                <ThemedText style={[styles.summaryLabel, { color: palette.muted }]}>Points earned</ThemedText>
                <ThemedText style={[styles.summaryValue, { color: palette.text }]}>
                  {formatPoints(summary.totalPointsEarned)}
                </ThemedText>
              </View>
            </View>

            {carpoolSummary ? (
              <View style={styles.sectionBlock}>
                <View style={styles.sectionHeaderInline}>
                  <ThemedText type="subtitle" style={{ color: palette.text }}>
                    My Carpools
                  </ThemedText>
                  <ThemedText style={{ color: palette.muted }}>
                    Manage your active and upcoming shared rides here. Completed carpools now live in History.
                  </ThemedText>
                </View>

                <View style={styles.summaryGrid}>
                  <View style={[styles.summaryCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
                    <ThemedText style={[styles.summaryLabel, { color: palette.muted }]}>Active</ThemedText>
                    <ThemedText style={[styles.summaryValue, { color: palette.text }]}>
                      {carpoolSummary.activeTrips}
                    </ThemedText>
                  </View>
                  <View style={[styles.summaryCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
                    <ThemedText style={[styles.summaryLabel, { color: palette.muted }]}>Completed</ThemedText>
                    <ThemedText style={[styles.summaryValue, { color: palette.text }]}>
                      {carpoolSummary.completedTrips}
                    </ThemedText>
                  </View>
                  <View style={[styles.summaryCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
                    <ThemedText style={[styles.summaryLabel, { color: palette.muted }]}>Riders helped</ThemedText>
                    <ThemedText style={[styles.summaryValue, { color: palette.text }]}>
                      {carpoolSummary.totalRidersHelped}
                    </ThemedText>
                  </View>
                  <View style={[styles.summaryCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
                    <ThemedText style={[styles.summaryLabel, { color: palette.muted }]}>Best impact</ThemedText>
                    <ThemedText style={[styles.summaryValue, { color: palette.text }]}>
                      {formatMultiplier(carpoolSummary.highestImpactMultiplier)}
                    </ThemedText>
                  </View>
                </View>

                {carpoolActionMessage ? (
                  <View style={[styles.messageCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
                    <MaterialIcons name="check-circle-outline" size={20} color={palette.accent} />
                    <ThemedText style={{ color: palette.text, flex: 1 }}>{carpoolActionMessage}</ThemedText>
                  </View>
                ) : null}

                {carpoolActionError ? (
                  <View style={[styles.messageCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
                    <MaterialIcons name="error-outline" size={20} color={palette.accentAlt} />
                    <ThemedText style={{ color: palette.text, flex: 1 }}>{carpoolActionError}</ThemedText>
                  </View>
                ) : null}

                {activeCarpoolTrips.length === 0 ? (
                  <View style={[styles.messageCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
                    <MaterialIcons name="groups" size={20} color={palette.accent} />
                    <ThemedText style={{ color: palette.text, flex: 1 }}>
                      No active carpool cards right now. Use the map tab to publish a ride or check History for completed carpools.
                    </ThemedText>
                  </View>
                ) : (
                  activeCarpoolTrips.map((trip) => {
                    const roleStatus = getCarpoolRoleStatus(trip, userId);
                    const statusColors = getCarpoolStatusColors(roleStatus.tone);

                    return (
                      <View
                        key={trip.id}
                        style={[styles.tripCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
                        <View style={styles.tripHeader}>
                          <View style={{ flex: 1, gap: 4 }}>
                            <ThemedText style={[styles.tripTitle, { color: palette.text }]}>
                              {trip.routeTitle}
                            </ThemedText>
                            <ThemedText style={{ color: palette.muted }}>
                              {trip.originLabel} to {trip.destinationLabel}
                            </ThemedText>
                          </View>
                          <View style={[styles.routeTypeBadge, { backgroundColor: `${palette.accent}18` }]}>
                            <ThemedText style={{ color: palette.accent, fontWeight: '700' }}>
                              {trip.currentUserRole}
                            </ThemedText>
                          </View>
                        </View>

                        <View style={styles.tripMetricRow}>
                          <ThemedText style={{ color: palette.text }}>
                            {trip.status} | {formatTripDate(trip.departureTime)}
                          </ThemedText>
                          <ThemedText style={{ color: palette.text }}>
                            {trip.availableSeats}/{trip.seatCapacity} seats
                          </ThemedText>
                        </View>

                        <View
                          style={[
                            styles.carpoolStatusCard,
                            {
                              backgroundColor: statusColors.backgroundColor,
                              borderColor: statusColors.borderColor,
                            },
                          ]}>
                          <MaterialIcons name={roleStatus.icon} size={18} color={statusColors.iconColor} />
                          <View style={styles.carpoolStatusCopy}>
                            <View
                              style={[
                                styles.carpoolStatusBadge,
                                {
                                  backgroundColor: statusColors.badgeBackgroundColor,
                                },
                              ]}>
                              <ThemedText
                                style={[
                                  styles.carpoolStatusBadgeText,
                                  { color: statusColors.iconColor },
                                ]}>
                                {roleStatus.badge}
                              </ThemedText>
                            </View>
                            <ThemedText style={[styles.tripTitle, { color: palette.text }]}>
                              {roleStatus.title}
                            </ThemedText>
                            <ThemedText style={{ color: palette.muted }}>
                              {roleStatus.description}
                            </ThemedText>
                          </View>
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
                            <MaterialIcons name="event" size={14} color={palette.accent} />
                            <ThemedText style={{ color: palette.text }}>
                              {formatTripDate(trip.departureTime)}
                            </ThemedText>
                          </View>
                          <View
                            style={[
                              styles.carpoolInsightPill,
                              {
                                backgroundColor: `${palette.accentAlt}14`,
                                borderColor: `${palette.accentAlt}28`,
                              },
                            ]}>
                            <MaterialIcons name="payments" size={14} color={palette.accentAlt} />
                            <ThemedText style={{ color: palette.text }}>
                              ${trip.pricePerMileUsd.toFixed(2)}/mi
                            </ThemedText>
                          </View>
                          <View
                            style={[
                              styles.carpoolInsightPill,
                              {
                                backgroundColor: `${palette.accent}14`,
                                borderColor: `${palette.accent}30`,
                              },
                            ]}>
                            <MaterialIcons name="verified-user" size={14} color={palette.accent} />
                            <ThemedText style={{ color: palette.text }}>
                              {formatCarpoolTrustSummary(trip)}
                            </ThemedText>
                          </View>
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
                            <MaterialIcons name="eco" size={14} color={palette.accent} />
                            <ThemedText style={{ color: palette.text }}>
                              {formatCo2(trip.co2SavedKg)} shared savings
                            </ThemedText>
                          </View>
                          <View
                            style={[
                              styles.carpoolInsightPill,
                              {
                                backgroundColor: `${palette.accentAlt}14`,
                                borderColor: `${palette.accentAlt}28`,
                              },
                            ]}>
                            <MaterialIcons name="military-tech" size={14} color={palette.accentAlt} />
                            <ThemedText style={{ color: palette.text }}>
                              {formatMultiplier(trip.carpoolImpactMultiplier ?? 1)} impact
                            </ThemedText>
                          </View>
                          <View
                            style={[
                              styles.carpoolInsightPill,
                              {
                                backgroundColor: `${palette.accent}14`,
                                borderColor: `${palette.accent}30`,
                              },
                            ]}>
                            <MaterialIcons name="diversity-3" size={14} color={palette.accent} />
                            <ThemedText style={{ color: palette.text }}>
                              {trip.participantCount} participant{trip.participantCount === 1 ? '' : 's'}
                            </ThemedText>
                          </View>
                        </View>

                        <ThemedText style={{ color: palette.muted }}>
                          Driver: {trip.driverName} | {trip.pricePerMileUsd.toFixed(2)}/mi | {trip.participantCount}{' '}
                          participant{trip.participantCount === 1 ? '' : 's'}
                        </ThemedText>
                        <ThemedText style={{ color: palette.muted }}>
                          Shared CO2 savings {formatCo2(trip.co2SavedKg)} | impact{' '}
                          {formatMultiplier(trip.carpoolImpactMultiplier ?? 1)}
                        </ThemedText>

                        {renderCarpoolActions(trip)}
                      </View>
                    );
                  })
                )}
              </View>
            ) : null}

            {forest ? (
              <Pressable
                onPress={openForestTab}
                style={[styles.sectionCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
                <View style={styles.sectionHeader}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <ThemedText type="subtitle" style={{ color: palette.text }}>
                      My Forest
                    </ThemedText>
                    <ThemedText style={{ color: palette.muted }}>
                      Tap to enter the full forest world and continue growing what you have planted.
                    </ThemedText>
                  </View>
                  <View style={[styles.previewForestBadge, { backgroundColor: `${palette.accent}18` }]}>
                    <MaterialIcons name="park" size={18} color={palette.accent} />
                  </View>
                </View>

                <View style={[styles.forestCanvasCard, { backgroundColor: palette.canvas, borderColor: palette.border }]}>
                  {renderForestPreviewGrid()}
                </View>

                <View style={[styles.narrativeCard, { backgroundColor: palette.warningSurface, borderColor: palette.border }]}>
                  <MaterialIcons name="eco" size={18} color={palette.accent} />
                  <ThemedText style={{ color: palette.text, flex: 1 }}>
                    {forest.totalTrees > 0
                      ? `${forest.totalTrees} planted tree${forest.totalTrees === 1 ? '' : 's'} in your world.`
                      : 'Your forest world is ready. Open it to plant your first tree.'}
                  </ThemedText>
                </View>
              </Pressable>
            ) : null}

            <View style={styles.footerNote}>
              <View style={styles.footerNoteRow}>
                <ThemedText style={{ color: palette.muted, textAlign: 'center', fontSize: 12 }}>
                  Built with love by Team GREEN DEVS
                </ThemedText>
                <ThemedText style={{ color: palette.accent, fontSize: 12 }}>💚</ThemedText>
              </View>
            </View>
          </>
        ) : null}
      </ScrollView>

      <Modal transparent visible={historyVisible} animationType="fade" onRequestClose={() => setHistoryVisible(false)}>
        <View style={styles.modalBackdrop}>
          <SafeAreaView
            style={[styles.modalCard, { backgroundColor: palette.card, borderColor: palette.border }]}
            edges={['top', 'bottom']}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1, gap: 4 }}>
                <ThemedText type="title" style={[styles.modalTitle, { color: palette.text }]}>
                  Trip History
                </ThemedText>
                <ThemedText style={{ color: palette.muted }}>
                  Keep personal travel and rides you offered in one clean place.
                </ThemedText>
              </View>
              <Pressable
                onPress={() => setHistoryVisible(false)}
                style={[styles.modalCloseButton, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
                <MaterialIcons name="close" size={20} color={palette.text} />
              </Pressable>
            </View>

            <View
              style={[
                styles.historyFilterRow,
                { backgroundColor: palette.cardSecondary, borderColor: palette.border },
              ]}>
              <Pressable
                accessibilityLabel="Personal trips"
                onPress={() => setHistoryView('personal')}
                style={[
                  styles.historyFilterButton,
                  historyView === 'personal' && {
                    backgroundColor: palette.accent,
                    borderColor: palette.accent,
                  },
                ]}>
                <MaterialIcons
                  name="person"
                  size={20}
                  color={historyView === 'personal' ? '#FFFFFF' : palette.text}
                />
              </Pressable>
              <Pressable
                accessibilityLabel="Rides offered"
                onPress={() => setHistoryView('offered')}
                style={[
                  styles.historyFilterButton,
                  historyView === 'offered' && {
                    backgroundColor: palette.accent,
                    borderColor: palette.accent,
                  },
                ]}>
                <MaterialIcons
                  name="drive-eta"
                  size={20}
                  color={historyView === 'offered' ? '#FFFFFF' : palette.text}
                />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.modalList} showsVerticalScrollIndicator={false}>
              {renderHistoryContent()}
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>

      <Modal transparent visible={loginVisible} animationType="fade" onRequestClose={() => setLoginVisible(false)}>
        <View style={styles.modalBackdrop}>
          <SafeAreaView
            style={[styles.modalCard, { backgroundColor: palette.card, borderColor: palette.border }]}
            edges={['top', 'bottom']}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1, gap: 4 }}>
                <ThemedText type="title" style={[styles.modalTitle, { color: palette.text }]}>
                  Profiles
                </ThemedText>
                <ThemedText style={{ color: palette.muted }}>
                  Switch users and update the rider name from one place.
                </ThemedText>
              </View>
              <Pressable
                onPress={() => setLoginVisible(false)}
                style={[styles.modalCloseButton, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
                <MaterialIcons name="close" size={20} color={palette.text} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.modalList} showsVerticalScrollIndicator={false}>
              <TextInput
                value={loginName}
                onChangeText={setLoginName}
                placeholder="Enter username"
                placeholderTextColor={palette.muted}
                autoCapitalize="words"
                autoCorrect={false}
                style={[
                  styles.input,
                  {
                    color: palette.text,
                    backgroundColor: palette.input,
                    borderColor: palette.border,
                  },
                ]}
              />
              <Pressable
                onPress={handleUsernameLogin}
                style={[styles.saveButton, { backgroundColor: palette.accent }]}>
                <MaterialIcons name="login" size={20} color="#FFFFFF" />
                <ThemedText style={styles.saveButtonText}>Switch with username</ThemedText>
              </Pressable>

              {loginMessage ? (
                <View style={[styles.messageCard, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
                  <MaterialIcons name="check-circle-outline" size={20} color={palette.accent} />
                  <ThemedText style={{ color: palette.text, flex: 1 }}>{loginMessage}</ThemedText>
                </View>
              ) : null}

              {loginError ? (
                <View style={[styles.messageCard, { backgroundColor: palette.errorSurface, borderColor: palette.border }]}>
                  <MaterialIcons name="error-outline" size={20} color={palette.accentAlt} />
                  <ThemedText style={{ color: palette.text, flex: 1 }}>{loginError}</ThemedText>
                </View>
              ) : null}

              <View style={styles.userNameList}>
                {availableProfiles.map((profile) => {
                  const isSelected = profile.userId === userId;

                  return (
                    <Pressable
                      key={profile.userId}
                      onPress={() => handleProfileChipPress(profile.displayName)}
                      style={[
                        styles.userNameChip,
                        {
                          backgroundColor: isSelected ? palette.accentSoft : palette.input,
                          borderColor: isSelected ? palette.accent : palette.border,
                        },
                      ]}>
                      <ThemedText
                        style={{
                          color: isSelected ? palette.accent : palette.text,
                          fontWeight: '700',
                        }}>
                        {profile.displayName}
                      </ThemedText>
                      <ThemedText style={{ color: palette.muted, flex: 1 }}>
                        {profile.canDrive ? 'Driver-ready' : 'Rider-ready'}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
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
    paddingBottom: 32,
    gap: 18,
  },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerCopy: {
    flex: 1,
    gap: 4,
  },
  pageTitle: {
    fontSize: 30,
    lineHeight: 34,
  },
  historyButton: {
    width: 44,
    minHeight: 44,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 0,
    paddingVertical: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingCard: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    gap: 10,
  },
  bannerCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  heroCard: {
    borderRadius: 30,
    borderWidth: 1,
    padding: 20,
    gap: 16,
    overflow: 'hidden',
    shadowOpacity: 0.12,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 7,
  },
  heroOrbLarge: {
    position: 'absolute',
    top: -48,
    right: -16,
    width: 168,
    height: 168,
    borderRadius: 999,
  },
  heroOrbSmall: {
    position: 'absolute',
    bottom: -24,
    left: -24,
    width: 108,
    height: 108,
    borderRadius: 999,
  },
  heroHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  heroHeaderCopy: {
    flex: 1,
    gap: 5,
  },
  heroEyebrow: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  heroTitle: {
    fontSize: 34,
    lineHeight: 38,
  },
  heroSubtitle: {
    fontSize: 15,
    lineHeight: 22,
  },
  balanceChip: {
    minWidth: 108,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 3,
  },
  balanceChipLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  balanceChipValue: {
    fontSize: 18,
    fontWeight: '800',
  },
  heroMetricRow: {
    flexDirection: 'row',
    gap: 12,
  },
  heroMetricCard: {
    flex: 1,
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  metricIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  metricValue: {
    fontSize: 26,
    lineHeight: 30,
    fontWeight: '800',
  },
  narrativeCard: {
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  summaryCard: {
    width: '47%',
    borderRadius: 22,
    borderWidth: 1,
    padding: 16,
    gap: 6,
  },
  summaryLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summaryValue: {
    fontSize: 22,
    lineHeight: 26,
    fontWeight: '800',
  },
  sectionBlock: {
    gap: 12,
  },
  sectionHeaderInline: {
    gap: 4,
  },
  sectionCard: {
    borderRadius: 26,
    borderWidth: 1,
    padding: 18,
    gap: 14,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  primaryActionButton: {
    minHeight: 44,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  primaryActionText: {
    fontWeight: '700',
  },
  forestSummaryRow: {
    flexDirection: 'row',
    gap: 10,
  },
  infoPill: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 3,
  },
  infoPillLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoPillValue: {
    fontSize: 17,
    fontWeight: '800',
  },
  forestCanvasCard: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 14,
  },
  forestGrid: {
    gap: 10,
  },
  forestGridRow: {
    flexDirection: 'row',
    gap: 10,
  },
  forestCell: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  treeAvatar: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  treeBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  horizontalList: {
    gap: 12,
    paddingRight: 4,
  },
  treeTierCard: {
    width: 228,
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  treeTierHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  treeTierIcon: {
    width: 46,
    height: 46,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  treeTierName: {
    fontSize: 18,
    fontWeight: '700',
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    minWidth: 0,
  },
  achievementGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  achievementCard: {
    width: '47%',
    borderRadius: 22,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  achievementHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  achievementIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  achievementTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  tripCard: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  tripHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  historyTypeBadge: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tripTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  routeTypeBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  tripImpactRow: {
    flexDirection: 'row',
    gap: 10,
  },
  tripImpactChip: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  tripImpactLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tripMetricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
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
  carpoolActionGroup: {
    gap: 10,
  },
  carpoolPendingRequestCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 12,
    gap: 8,
  },
  carpoolInlineActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  carpoolDecisionButton: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileCard: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 18,
    gap: 12,
  },
  userNameList: {
    gap: 10,
  },
  userNameChip: {
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  input: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
  },
  saveButton: {
    borderRadius: 16,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  footerNote: {
    paddingTop: 4,
    paddingBottom: 8,
    alignItems: 'center',
  },
  footerNoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 18,
    backgroundColor: 'rgba(4, 8, 6, 0.54)',
  },
  modalCard: {
    maxHeight: '90%',
    borderRadius: 28,
    borderWidth: 1,
    padding: 18,
    gap: 16,
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
  modalCloseButton: {
    width: 40,
    height: 40,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalList: {
    gap: 12,
    paddingBottom: 8,
  },
  historyFilterRow: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 6,
    flexDirection: 'row',
    gap: 8,
  },
  historyFilterButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  messageCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  plantSummaryRow: {
    flexDirection: 'row',
    gap: 10,
  },
  catalogCard: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  catalogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  catalogIcon: {
    width: 46,
    height: 46,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  catalogTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  catalogStatusBadge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  confirmPlantButton: {
    minHeight: 52,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  confirmPlantText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
