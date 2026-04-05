import MaterialIcons from '@expo/vector-icons/MaterialIcons';
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
import { fetchUserDashboard, fetchUserTrips, plantForestTree } from '@/lib/api';
import { formatCo2, formatDistance, formatDuration, formatTripDate } from '@/lib/formatters';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  ForestTree,
  UserDashboard,
} from '@/types/dashboard';
import { TripRecord } from '@/types/trips';

type ForestCellSelection = {
  x: number;
  y: number;
} | null;

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

function findFirstEmptyCell(
  gridColumns: number,
  gridRows: number,
  plantedTrees: ForestTree[]
): ForestCellSelection {
  const occupiedCells = new Set(plantedTrees.map((tree) => getGridKey(tree.gridX, tree.gridY)));

  for (let y = 0; y < gridRows; y += 1) {
    for (let x = 0; x < gridColumns; x += 1) {
      if (!occupiedCells.has(getGridKey(x, y))) {
        return { x, y };
      }
    }
  }

  return null;
}

export default function ProfileScreen() {
  const colorScheme = useColorScheme();
  const isFocused = useIsFocused();
  const { userId, displayName, setDisplayName, tripVersion } = useUserProfile();
  const [draftName, setDraftName] = useState(displayName);
  const [dashboard, setDashboard] = useState<UserDashboard | null>(null);
  const [isDashboardLoading, setIsDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [historyTrips, setHistoryTrips] = useState<TripRecord[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [plantModalVisible, setPlantModalVisible] = useState(false);
  const [selectedTreeId, setSelectedTreeId] = useState<string | null>(null);
  const [selectedForestCell, setSelectedForestCell] = useState<ForestCellSelection>(null);
  const [plantError, setPlantError] = useState<string | null>(null);
  const [isPlanting, setIsPlanting] = useState(false);

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

  useEffect(() => {
    setDraftName(displayName);
  }, [displayName]);

  useEffect(() => {
    if (!isFocused) {
      return;
    }

    let isMounted = true;

    async function loadDashboard() {
      setIsDashboardLoading(true);
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
        if (isMounted) {
          setIsDashboardLoading(false);
        }
      }
    }

    void loadDashboard();

    return () => {
      isMounted = false;
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
  const achievements = dashboard?.achievements ?? [];
  const recentTrips = dashboard?.recentTrips ?? [];
  const forestCapacity = forest ? forest.gridColumns * forest.gridRows : 0;
  const isForestFull = forest ? forest.totalTrees >= forestCapacity : false;
  const selectedTree =
    forest?.treeCatalog.find((treeOption) => treeOption.id === selectedTreeId) ?? null;
  const displayNameForHeader = displayName || summary?.displayName || 'Campus Rider';

  function openPlantModal() {
    if (!forest) {
      return;
    }

    const defaultTree =
      forest.treeCatalog.find((treeOption) => treeOption.isUnlocked && treeOption.isAffordable) ??
      forest.treeCatalog.find((treeOption) => treeOption.isUnlocked) ??
      forest.treeCatalog[0] ??
      null;

    setSelectedTreeId(defaultTree?.id ?? null);
    setSelectedForestCell(findFirstEmptyCell(forest.gridColumns, forest.gridRows, forest.plantedTrees));
    setPlantError(null);
    setPlantModalVisible(true);
  }

  async function handlePlantTree() {
    if (!selectedTree || !selectedForestCell || !summary) {
      return;
    }

    setIsPlanting(true);
    setPlantError(null);

    try {
      const nextDashboard = await plantForestTree({
        userId,
        treeTypeId: selectedTree.id,
        gridX: selectedForestCell.x,
        gridY: selectedForestCell.y,
      });

      setDashboard(nextDashboard);
      setPlantModalVisible(false);
      setSelectedForestCell(null);
      setSelectedTreeId(null);
    } catch (error) {
      setPlantError(error instanceof Error ? error.message : 'Unable to plant a tree right now.');
    } finally {
      setIsPlanting(false);
    }
  }

  function renderForestGrid(interactive = false) {
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
              const isSelected =
                selectedForestCell?.x === column && selectedForestCell?.y === row;

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

              if (interactive) {
                return (
                  <Pressable
                    key={key}
                    onPress={() => setSelectedForestCell({ x: column, y: row })}
                    style={[
                      styles.forestCell,
                      {
                        backgroundColor: isSelected ? palette.accentSoft : palette.input,
                        borderColor: isSelected ? palette.accent : palette.border,
                      },
                    ]}>
                    <MaterialIcons
                      name="add"
                      size={18}
                      color={isSelected ? palette.accent : palette.muted}
                    />
                  </Pressable>
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
    if (isHistoryLoading) {
      return (
        <View style={[styles.messageCard, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
          <ActivityIndicator color={palette.accent} />
          <ThemedText style={{ color: palette.text }}>Loading history...</ThemedText>
        </View>
      );
    }

    if (historyError && historyTrips.length === 0) {
      return (
        <View style={[styles.messageCard, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
          <MaterialIcons name="error-outline" size={20} color={palette.accentAlt} />
          <ThemedText style={{ color: palette.text, flex: 1 }}>{historyError}</ThemedText>
        </View>
      );
    }

    if (historyTrips.length === 0) {
      return (
        <View style={[styles.messageCard, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
          <MaterialIcons name="history" size={20} color={palette.accent} />
          <ThemedText style={{ color: palette.text, flex: 1 }}>
            No trips saved yet. Run a route simulation from the map tab to build your history.
          </ThemedText>
        </View>
      );
    }

    return historyTrips.map((trip) => (
      <View
        key={trip.id}
        style={[styles.tripCard, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
        <View style={styles.tripHeader}>
          <View style={{ flex: 1 }}>
            <ThemedText style={[styles.tripTitle, { color: palette.text }]}>{trip.routeTitle}</ThemedText>
            <ThemedText style={{ color: palette.muted }}>
              {trip.originLabel} to {trip.destinationLabel}
            </ThemedText>
          </View>
          <View style={[styles.routeTypeBadge, { backgroundColor: `${palette.accent}18` }]}>
            <ThemedText style={{ color: palette.accent, fontWeight: '700' }}>{trip.routeType}</ThemedText>
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
          <Pressable
            onPress={() => setHistoryVisible(true)}
            style={[styles.historyButton, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
            <MaterialIcons name="history" size={18} color={palette.accent} />
            <ThemedText style={[styles.historyButtonText, { color: palette.text }]}>History</ThemedText>
          </Pressable>
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

            {forest ? (
              <View style={[styles.sectionCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
                <View style={styles.sectionHeader}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <ThemedText type="subtitle" style={{ color: palette.text }}>
                      My Forest
                    </ThemedText>
                    <ThemedText style={{ color: palette.muted }}>
                      Redeem points to plant trees and turn your climate impact into a living grid.
                    </ThemedText>
                  </View>
                  <Pressable
                    disabled={isForestFull}
                    onPress={openPlantModal}
                    style={[
                      styles.primaryActionButton,
                      {
                        backgroundColor: isForestFull ? palette.cardSecondary : palette.accent,
                        borderColor: isForestFull ? palette.border : palette.accent,
                        opacity: isForestFull ? 0.6 : 1,
                      },
                    ]}>
                    <MaterialIcons
                      name="park"
                      size={18}
                      color={isForestFull ? palette.text : '#FFFFFF'}
                    />
                    <ThemedText
                      style={[
                        styles.primaryActionText,
                        { color: isForestFull ? palette.text : '#FFFFFF' },
                      ]}>
                      {isForestFull ? 'Forest full' : 'Plant Tree'}
                    </ThemedText>
                  </Pressable>
                </View>

                <View style={styles.forestSummaryRow}>
                  <View style={[styles.infoPill, { backgroundColor: palette.input, borderColor: palette.border }]}>
                    <ThemedText style={[styles.infoPillLabel, { color: palette.muted }]}>Planted</ThemedText>
                    <ThemedText style={[styles.infoPillValue, { color: palette.text }]}>
                      {forest.totalTrees}/{forestCapacity}
                    </ThemedText>
                  </View>
                  <View style={[styles.infoPill, { backgroundColor: palette.input, borderColor: palette.border }]}>
                    <ThemedText style={[styles.infoPillLabel, { color: palette.muted }]}>Available</ThemedText>
                    <ThemedText style={[styles.infoPillValue, { color: palette.text }]}>
                      {formatPoints(summary.totalPointsAvailable)}
                    </ThemedText>
                  </View>
                  <View style={[styles.infoPill, { backgroundColor: palette.input, borderColor: palette.border }]}>
                    <ThemedText style={[styles.infoPillLabel, { color: palette.muted }]}>Redeemed</ThemedText>
                    <ThemedText style={[styles.infoPillValue, { color: palette.text }]}>
                      {formatPoints(summary.totalPointsSpent)}
                    </ThemedText>
                  </View>
                </View>

                <View style={[styles.forestCanvasCard, { backgroundColor: palette.canvas, borderColor: palette.border }]}>
                  {renderForestGrid()}
                </View>

                <View style={[styles.narrativeCard, { backgroundColor: palette.warningSurface, borderColor: palette.border }]}>
                  <MaterialIcons name="eco" size={18} color={palette.accent} />
                  <ThemedText style={{ color: palette.text, flex: 1 }}>
                    {dashboard?.narrative}
                  </ThemedText>
                </View>
              </View>
            ) : null}

            {forest ? (
              <View style={styles.sectionBlock}>
                <View style={styles.sectionHeaderInline}>
                  <ThemedText type="subtitle" style={{ color: palette.text }}>
                    Tree Progression
                  </ThemedText>
                  <ThemedText style={{ color: palette.muted }}>
                    Unlock higher tiers through points and CO2 saved.
                  </ThemedText>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalList}>
                  {forest.treeCatalog.map((treeOption) => {
                    const treeVisual = getTreeVisual(treeOption.id);
                    const statusCopy = treeOption.isUnlocked
                      ? treeOption.isAffordable
                        ? 'Ready to plant'
                        : `Need ${formatPoints(Math.max(treeOption.cost - summary.totalPointsAvailable, 0))}`
                      : treeOption.unlockRequirement;

                    return (
                      <View
                        key={treeOption.id}
                        style={[
                          styles.treeTierCard,
                          {
                            backgroundColor: palette.card,
                            borderColor: treeOption.isUnlocked ? palette.accent : palette.border,
                          },
                        ]}>
                        <View style={styles.treeTierHeader}>
                          <View
                            style={[
                              styles.treeTierIcon,
                              {
                                backgroundColor: treeVisual.surface,
                                borderColor: `${treeVisual.tint}35`,
                              },
                            ]}>
                            <MaterialIcons name={treeVisual.icon} size={22} color={treeVisual.tint} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <ThemedText style={[styles.treeTierName, { color: palette.text }]}>
                              {treeOption.name}
                            </ThemedText>
                            <ThemedText style={{ color: palette.muted }}>
                              {treeOption.tier} | {formatPoints(treeOption.cost)}
                            </ThemedText>
                          </View>
                        </View>
                        <ThemedText style={{ color: palette.text }}>{treeOption.description}</ThemedText>
                        <ThemedText style={{ color: palette.muted }}>{statusCopy}</ThemedText>
                        <View style={[styles.progressTrack, { backgroundColor: palette.input }]}>
                          <View
                            style={[
                              styles.progressFill,
                              {
                                backgroundColor: treeOption.isUnlocked ? palette.accent : palette.accentAlt,
                                width: `${Math.max(treeOption.unlockProgress * 100, treeOption.isUnlocked ? 100 : 8)}%`,
                              },
                            ]}
                          />
                        </View>
                        <ThemedText style={{ color: palette.muted }}>
                          Planted {treeOption.plantedCount} time{treeOption.plantedCount === 1 ? '' : 's'}
                        </ThemedText>
                      </View>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}

            <View style={styles.sectionBlock}>
              <View style={styles.sectionHeaderInline}>
                <ThemedText type="subtitle" style={{ color: palette.text }}>
                  Achievements
                </ThemedText>
                <ThemedText style={{ color: palette.muted }}>
                  Small milestones that keep the forest growing.
                </ThemedText>
              </View>

              <View style={styles.achievementGrid}>
                {achievements.map((achievement) => (
                  <View
                    key={achievement.id}
                    style={[styles.achievementCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
                    <View style={styles.achievementHeader}>
                      <View
                        style={[
                          styles.achievementIcon,
                          {
                            backgroundColor: achievement.earned ? palette.accentSoft : palette.input,
                          },
                        ]}>
                        <MaterialIcons
                          name={achievement.earned ? 'emoji-events' : 'lock'}
                          size={20}
                          color={achievement.earned ? palette.accent : palette.muted}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <ThemedText style={[styles.achievementTitle, { color: palette.text }]}>
                          {achievement.title}
                        </ThemedText>
                        <ThemedText style={{ color: palette.muted }}>{achievement.description}</ThemedText>
                      </View>
                    </View>
                    <View style={[styles.progressTrack, { backgroundColor: palette.input }]}>
                      <View
                        style={[
                          styles.progressFill,
                          {
                            backgroundColor: achievement.earned ? palette.accent : palette.accentAlt,
                            width: `${Math.max(achievement.progress * 100, achievement.currentValue > 0 ? 10 : 0)}%`,
                          },
                        ]}
                      />
                    </View>
                    <ThemedText style={{ color: palette.text }}>
                      {achievement.currentValue.toFixed(achievement.unit === 'kg CO2' ? 1 : 0)} /{' '}
                      {achievement.targetValue} {achievement.unit}
                    </ThemedText>
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.sectionBlock}>
              <View style={styles.sectionHeaderInline}>
                <ThemedText type="subtitle" style={{ color: palette.text }}>
                  Recent Trips
                </ThemedText>
                <ThemedText style={{ color: palette.muted }}>
                  Your latest rides and their individual impact.
                </ThemedText>
              </View>

              {recentTrips.length === 0 ? (
                <View style={[styles.messageCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
                  <MaterialIcons name="history" size={20} color={palette.accent} />
                  <ThemedText style={{ color: palette.text, flex: 1 }}>
                    No completed trips yet. Simulate a route from the map tab to start building impact.
                  </ThemedText>
                </View>
              ) : (
                recentTrips.map((trip) => (
                  <View
                    key={trip.id}
                    style={[styles.tripCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
                    <View style={styles.tripHeader}>
                      <View style={{ flex: 1 }}>
                        <ThemedText style={[styles.tripTitle, { color: palette.text }]}>{trip.routeTitle}</ThemedText>
                        <ThemedText style={{ color: palette.muted }}>
                          {trip.originLabel} to {trip.destinationLabel}
                        </ThemedText>
                      </View>
                      <View style={[styles.routeTypeBadge, { backgroundColor: `${palette.accent}18` }]}>
                        <ThemedText style={{ color: palette.accent, fontWeight: '700' }}>{trip.routeType}</ThemedText>
                      </View>
                    </View>

                    <View style={styles.tripImpactRow}>
                      <View style={[styles.tripImpactChip, { backgroundColor: palette.input, borderColor: palette.border }]}>
                        <ThemedText style={[styles.tripImpactLabel, { color: palette.muted }]}>Saved</ThemedText>
                        <ThemedText style={{ color: palette.text, fontWeight: '700' }}>
                          {formatCo2(trip.co2SavedKg)}
                        </ThemedText>
                      </View>
                      <View style={[styles.tripImpactChip, { backgroundColor: palette.input, borderColor: palette.border }]}>
                        <ThemedText style={[styles.tripImpactLabel, { color: palette.muted }]}>Points</ThemedText>
                        <ThemedText style={{ color: palette.text, fontWeight: '700' }}>
                          {formatPoints(getTripPoints(trip))}
                        </ThemedText>
                      </View>
                    </View>

                    <ThemedText style={{ color: palette.muted }}>
                      {formatTripDate(trip.completedAt)} | {formatDistance(trip.distanceMeters)} |{' '}
                      {formatDuration(trip.durationSeconds)}
                    </ThemedText>
                  </View>
                ))
              )}
            </View>

            <View style={[styles.profileCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
              <ThemedText type="subtitle" style={{ color: palette.text }}>
                Rider Details
              </ThemedText>
              <ThemedText style={{ color: palette.muted }}>
                This name is used for newly saved trips and the leaderboard.
              </ThemedText>
              <TextInput
                value={draftName}
                onChangeText={setDraftName}
                placeholder="Set your rider name"
                placeholderTextColor={palette.muted}
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
                onPress={() => setDisplayName(draftName)}
                style={[styles.saveButton, { backgroundColor: palette.accent }]}>
                <MaterialIcons name="check" size={20} color="#FFFFFF" />
                <ThemedText style={styles.saveButtonText}>Use this rider name</ThemedText>
              </Pressable>
            </View>

            <View style={[styles.roadmapCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
              <View style={styles.roadmapHeader}>
                <MaterialIcons name="insights" size={20} color={palette.accentAlt} />
                <ThemedText type="subtitle" style={{ color: palette.text }}>
                  Built To Expand
                </ThemedText>
              </View>
              <ThemedText style={{ color: palette.muted }}>
                This forest system is ready for future map-based forests, friend challenges, and real-world tree planting partnerships.
              </ThemedText>
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
                  Every completed simulation appears here.
                </ThemedText>
              </View>
              <Pressable
                onPress={() => setHistoryVisible(false)}
                style={[styles.modalCloseButton, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
                <MaterialIcons name="close" size={20} color={palette.text} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.modalList} showsVerticalScrollIndicator={false}>
              {renderHistoryContent()}
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>

      <Modal
        transparent
        visible={plantModalVisible}
        animationType="fade"
        onRequestClose={() => setPlantModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <SafeAreaView
            style={[styles.modalCard, { backgroundColor: palette.card, borderColor: palette.border }]}
            edges={['top', 'bottom']}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1, gap: 4 }}>
                <ThemedText type="title" style={[styles.modalTitle, { color: palette.text }]}>
                  Plant Tree
                </ThemedText>
                <ThemedText style={{ color: palette.muted }}>
                  Spend points, choose a tile, and grow your forest.
                </ThemedText>
              </View>
              <Pressable
                onPress={() => setPlantModalVisible(false)}
                style={[styles.modalCloseButton, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
                <MaterialIcons name="close" size={20} color={palette.text} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.modalList} showsVerticalScrollIndicator={false}>
              {summary ? (
                <View style={styles.plantSummaryRow}>
                  <View style={[styles.infoPill, { backgroundColor: palette.input, borderColor: palette.border }]}>
                    <ThemedText style={[styles.infoPillLabel, { color: palette.muted }]}>Available</ThemedText>
                    <ThemedText style={[styles.infoPillValue, { color: palette.text }]}>
                      {formatPoints(summary.totalPointsAvailable)}
                    </ThemedText>
                  </View>
                  <View style={[styles.infoPill, { backgroundColor: palette.input, borderColor: palette.border }]}>
                    <ThemedText style={[styles.infoPillLabel, { color: palette.muted }]}>Forest space</ThemedText>
                    <ThemedText style={[styles.infoPillValue, { color: palette.text }]}>
                      {forestCapacity - (forest?.totalTrees ?? 0)} open
                    </ThemedText>
                  </View>
                </View>
              ) : null}

              {forest?.treeCatalog.map((treeOption) => {
                const treeVisual = getTreeVisual(treeOption.id);
                const isSelected = treeOption.id === selectedTreeId;
                const isPlantable = treeOption.isUnlocked && treeOption.isAffordable;

                return (
                  <Pressable
                    key={treeOption.id}
                    onPress={() => setSelectedTreeId(treeOption.id)}
                    style={[
                      styles.catalogCard,
                      {
                        backgroundColor: isSelected ? palette.accentSoft : palette.cardSecondary,
                        borderColor: isSelected ? palette.accent : palette.border,
                        opacity: treeOption.isUnlocked ? 1 : 0.92,
                      },
                    ]}>
                    <View style={styles.catalogHeader}>
                      <View
                        style={[
                          styles.catalogIcon,
                          {
                            backgroundColor: treeVisual.surface,
                            borderColor: `${treeVisual.tint}35`,
                          },
                        ]}>
                        <MaterialIcons name={treeVisual.icon} size={22} color={treeVisual.tint} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <ThemedText style={[styles.catalogTitle, { color: palette.text }]}>
                          {treeOption.name}
                        </ThemedText>
                        <ThemedText style={{ color: palette.muted }}>
                          {treeOption.tier} | costs {formatPoints(treeOption.cost)}
                        </ThemedText>
                      </View>
                      <View
                        style={[
                          styles.catalogStatusBadge,
                          {
                            backgroundColor: treeOption.isUnlocked ? `${palette.accent}18` : palette.input,
                            borderColor: treeOption.isUnlocked ? `${palette.accent}32` : palette.border,
                          },
                        ]}>
                        <ThemedText
                          style={{
                            color: treeOption.isUnlocked ? palette.accent : palette.muted,
                            fontWeight: '700',
                          }}>
                          {treeOption.isUnlocked ? (isPlantable ? 'Ready' : 'Unlocked') : 'Locked'}
                        </ThemedText>
                      </View>
                    </View>

                    <ThemedText style={{ color: palette.text }}>{treeOption.description}</ThemedText>
                    <ThemedText style={{ color: palette.muted }}>
                      {treeOption.isUnlocked
                        ? isPlantable
                          ? `Spend ${formatPoints(treeOption.cost)} to plant this tree.`
                          : `Need ${formatPoints(Math.max(treeOption.cost - (summary?.totalPointsAvailable ?? 0), 0))} more to plant.`
                        : treeOption.unlockRequirement}
                    </ThemedText>

                    <View style={[styles.progressTrack, { backgroundColor: palette.input }]}>
                      <View
                        style={[
                          styles.progressFill,
                          {
                            backgroundColor: treeOption.isUnlocked ? palette.accent : palette.accentAlt,
                            width: `${Math.max(treeOption.unlockProgress * 100, treeOption.isUnlocked ? 100 : 8)}%`,
                          },
                        ]}
                      />
                    </View>
                  </Pressable>
                );
              })}

              <View style={[styles.sectionCard, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
                <View style={styles.sectionHeaderInline}>
                  <ThemedText type="subtitle" style={{ color: palette.text }}>
                    Choose A Plot
                  </ThemedText>
                  <ThemedText style={{ color: palette.muted }}>
                    Pick an empty tile for your next tree.
                  </ThemedText>
                </View>
                <View style={[styles.forestCanvasCard, { backgroundColor: palette.canvas, borderColor: palette.border }]}>
                  {renderForestGrid(true)}
                </View>
                {selectedForestCell ? (
                  <ThemedText style={{ color: palette.text }}>
                    Selected tile: column {selectedForestCell.x + 1}, row {selectedForestCell.y + 1}
                  </ThemedText>
                ) : (
                  <ThemedText style={{ color: palette.muted }}>
                    Choose an empty tile to finish planting.
                  </ThemedText>
                )}
              </View>

              {plantError ? (
                <View style={[styles.bannerCard, { backgroundColor: palette.errorSurface, borderColor: palette.border }]}>
                  <MaterialIcons name="error-outline" size={20} color={palette.accentAlt} />
                  <ThemedText style={{ color: palette.text, flex: 1 }}>{plantError}</ThemedText>
                </View>
              ) : null}

              <Pressable
                disabled={
                  isPlanting ||
                  !selectedTree ||
                  !selectedForestCell ||
                  !selectedTree.isUnlocked ||
                  !selectedTree.isAffordable ||
                  isForestFull
                }
                onPress={handlePlantTree}
                style={[
                  styles.confirmPlantButton,
                  {
                    backgroundColor:
                      !selectedTree ||
                      !selectedForestCell ||
                      !selectedTree.isUnlocked ||
                      !selectedTree.isAffordable ||
                      isForestFull
                        ? palette.cardSecondary
                        : palette.accent,
                    borderColor:
                      !selectedTree ||
                      !selectedForestCell ||
                      !selectedTree.isUnlocked ||
                      !selectedTree.isAffordable ||
                      isForestFull
                        ? palette.border
                        : palette.accent,
                    opacity: isPlanting ? 0.75 : 1,
                  },
                ]}>
                {isPlanting ? <ActivityIndicator color="#FFFFFF" /> : <MaterialIcons name="park" size={18} color="#FFFFFF" />}
                <ThemedText style={styles.confirmPlantText}>
                  {selectedTree ? `Plant ${selectedTree.name}` : 'Plant Tree'}
                </ThemedText>
              </Pressable>
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
  headerCopy: {
    flex: 1,
    gap: 4,
  },
  pageTitle: {
    fontSize: 30,
    lineHeight: 34,
  },
  historyButton: {
    minHeight: 44,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  historyButtonText: {
    fontWeight: '700',
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
  profileCard: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 18,
    gap: 12,
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
  roadmapCard: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 18,
    gap: 10,
  },
  roadmapHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
