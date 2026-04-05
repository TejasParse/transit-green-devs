import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useEffect, useState, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { useUserProfile } from '@/context/user-context';
import { fetchUserDashboard, plantForestTree } from '@/lib/api';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { ForestTree, UserDashboard } from '@/types/dashboard';
import Animated, {
  Easing,
  FadeInDown,
  FadeInUp,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

const FOREST_POLL_INTERVAL_MS = 5000;

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
  sapling: { badge: 'SP', icon: 'eco', tint: '#5D9A49', surface: '#E5F4DE' },
  bush: { badge: 'BU', icon: 'eco', tint: '#337A4F', surface: '#DDEFE3' },
  oak: { badge: 'OK', icon: 'park', tint: '#5D6E2E', surface: '#ECF1DE' },
  pine: { badge: 'PI', icon: 'park', tint: '#21604C', surface: '#E0EFE8' },
  'cherry-blossom': { badge: 'CB', icon: 'local-florist', tint: '#BC6C8D', surface: '#F8EAF1' },
  cedar: { badge: 'CE', icon: 'park', tint: '#6B7A35', surface: '#EEF3E1' },
};

function formatPoints(points: number) {
  return `${points.toLocaleString()} pts`;
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

function FloatingOrb({
  color,
  style,
  duration,
}: {
  color: string;
  style: object;
  duration: number;
}) {
  const drift = useSharedValue(0);

  useEffect(() => {
    drift.value = withRepeat(
      withSequence(
        withTiming(1, { duration, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      false
    );
  }, [drift, duration]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -8 + drift.value * 16 },
      { translateX: -6 + drift.value * 12 },
      { scale: 0.96 + drift.value * 0.08 },
    ],
  }));

  return <Animated.View style={[style, { backgroundColor: color }, animatedStyle]} />;
}

function AnimatedTreeTile({
  treeVisual,
  borderColor,
  index,
}: {
  treeVisual: TreeVisual;
  borderColor: string;
  index: number;
}) {
  const sway = useSharedValue(0);
  const bloom = useSharedValue(0);

  useEffect(() => {
    sway.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1800 + index * 60, easing: Easing.inOut(Easing.sin) }),
        withTiming(-1, { duration: 1800 + index * 60, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      true
    );

    bloom.value = withDelay(
      index * 60,
      withTiming(1, { duration: 500, easing: Easing.out(Easing.cubic) })
    );
  }, [bloom, index, sway]);

  const animatedCellStyle = useAnimatedStyle(() => ({
    opacity: 0.55 + bloom.value * 0.45,
    transform: [{ scale: 0.9 + bloom.value * 0.1 }],
  }));

  const animatedTreeStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -1.5 + sway.value * 1.5 },
      { rotate: `${sway.value * 3}deg` },
      { scale: 0.96 + bloom.value * 0.04 },
    ],
  }));

  return (
    <Animated.View
      entering={FadeInUp.delay(index * 40).duration(420)}
      style={[
        styles.forestCell,
        {
          backgroundColor: treeVisual.surface,
          borderColor,
        },
        animatedCellStyle,
      ]}>
      <Animated.View
        style={[
          styles.treeAvatar,
          {
            backgroundColor: `${treeVisual.tint}20`,
            borderColor: `${treeVisual.tint}4D`,
          },
          animatedTreeStyle,
        ]}>
        <MaterialIcons name={treeVisual.icon} size={20} color={treeVisual.tint} />
      </Animated.View>
      <ThemedText style={[styles.treeBadgeText, { color: treeVisual.tint }]}>
        {treeVisual.badge}
      </ThemedText>
    </Animated.View>
  );
}

export default function ForestScreen() {
  const colorScheme = useColorScheme();
  const isFocused = useIsFocused();
  const { userId, displayName, tripVersion } = useUserProfile();
  const [dashboard, setDashboard] = useState<UserDashboard | null>(null);
  const [isDashboardLoading, setIsDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [plantModalVisible, setPlantModalVisible] = useState(false);
  const [selectedTreeId, setSelectedTreeId] = useState<string | null>(null);
  const [selectedForestCell, setSelectedForestCell] = useState<ForestCellSelection>(null);
  const [plantError, setPlantError] = useState<string | null>(null);
  const [isPlanting, setIsPlanting] = useState(false);
  const [selectedAchievementId, setSelectedAchievementId] = useState<string | null>(null);

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
            error instanceof Error ? error.message : 'Unable to load your forest right now.'
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
    }, FOREST_POLL_INTERVAL_MS);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [isFocused, tripVersion, userId]);

  const summary = dashboard?.summary ?? null;
  const forest = dashboard?.forest ?? null;
  const achievements = dashboard?.achievements ?? [];
  const forestCapacity = forest ? forest.gridColumns * forest.gridRows : 0;
  const isForestFull = forest ? forest.totalTrees >= forestCapacity : false;
  const selectedTree =
    forest?.treeCatalog.find((treeOption) => treeOption.id === selectedTreeId) ?? null;
  const selectedAchievement =
    achievements.find((achievement) => achievement.id === selectedAchievementId) ?? null;

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
                  <AnimatedTreeTile
                    key={key}
                    treeVisual={treeVisual}
                    borderColor={palette.border}
                    index={row * forest.gridColumns + column}
                  />
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
                <Animated.View
                  key={key}
                  entering={FadeInUp.delay((row * forest.gridColumns + column) * 18).duration(320)}
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

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <Animated.View
          entering={FadeInDown.duration(500)}
          layout={LinearTransition.springify().damping(18)}
          style={[
            styles.heroCard,
            {
              backgroundColor: palette.card,
              borderColor: palette.border,
              shadowColor: palette.shadow,
            },
          ]}>
          <FloatingOrb color={palette.accentSoft} style={styles.heroOrbLarge} duration={4200} />
          <FloatingOrb color={`${palette.accentAlt}18`} style={styles.heroOrbSmall} duration={5000} />

          <ThemedText style={[styles.heroEyebrow, { color: palette.accent }]}>Forest World</ThemedText>
          <ThemedText type="title" style={[styles.heroTitle, { color: palette.text }]}>
            {displayName}
          </ThemedText>
          <ThemedText style={[styles.heroSubtitle, { color: palette.muted }]}>
            Grow your planted forest, unlock new trees, and turn every sustainable trip into visible progress.
          </ThemedText>
          <View style={styles.heroPillRow}>
            <View style={[styles.heroPill, { backgroundColor: `${palette.accent}16`, borderColor: `${palette.accent}30` }]}>
              <MaterialIcons name="park" size={14} color={palette.accent} />
              <ThemedText style={{ color: palette.text }}>Living world</ThemedText>
            </View>
            <View style={[styles.heroPill, { backgroundColor: `${palette.accentAlt}16`, borderColor: `${palette.accentAlt}30` }]}>
              <MaterialIcons name="spa" size={14} color={palette.accentAlt} />
              <ThemedText style={{ color: palette.text }}>Nature-first</ThemedText>
            </View>
            <View style={[styles.heroPill, { backgroundColor: `${palette.accent}16`, borderColor: `${palette.accent}30` }]}>
              <MaterialIcons name="emoji-events" size={14} color={palette.accent} />
              <ThemedText style={{ color: palette.text }}>Progress game</ThemedText>
            </View>
          </View>
        </Animated.View>

        {dashboardError ? (
          <View style={[styles.bannerCard, { backgroundColor: palette.errorSurface, borderColor: palette.border }]}>
            <MaterialIcons name="error-outline" size={20} color={palette.accentAlt} />
            <ThemedText style={{ color: palette.text, flex: 1 }}>{dashboardError}</ThemedText>
          </View>
        ) : null}

        {isDashboardLoading && !dashboard ? (
          <View style={[styles.loadingCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <ActivityIndicator color={palette.accent} />
            <ThemedText style={{ color: palette.text }}>Loading your forest world...</ThemedText>
          </View>
        ) : null}

        {forest && summary ? (
          <>
            <Animated.View
              entering={FadeInUp.delay(80).duration(420)}
              layout={LinearTransition.springify().damping(20)}
              style={[styles.sectionCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
              <View style={styles.sectionHeader}>
                <View style={{ flex: 1, gap: 4 }}>
                  <ThemedText type="subtitle" style={{ color: palette.text }}>
                    My Forest
                  </ThemedText>
                  <ThemedText style={{ color: palette.muted }}>
                    Your planted trees live here as a growing world.
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
                  <MaterialIcons name="park" size={18} color={isForestFull ? palette.text : '#FFFFFF'} />
                  <ThemedText style={[styles.primaryActionText, { color: isForestFull ? palette.text : '#FFFFFF' }]}>
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
                <View style={styles.forestScene}>
                  <View style={[styles.forestSceneGlow, { backgroundColor: `${palette.accent}18` }]} />
                  <View style={[styles.forestSceneSun, { backgroundColor: `${palette.accentAlt}22` }]} />
                  <View style={[styles.forestHillBack, { backgroundColor: colorScheme === 'dark' ? '#173123' : '#D9ECD8' }]} />
                  <View style={[styles.forestHillFront, { backgroundColor: colorScheme === 'dark' ? '#20412D' : '#C4E1C2' }]} />
                  {renderForestGrid()}
                </View>
              </View>

              <View style={[styles.narrativeCard, { backgroundColor: palette.warningSurface, borderColor: palette.border }]}>
                <MaterialIcons name="eco" size={18} color={palette.accent} />
                <ThemedText style={{ color: palette.text, flex: 1 }}>
                  {dashboard?.narrative}
                </ThemedText>
              </View>
            </Animated.View>

            <Animated.View
              entering={FadeInUp.delay(140).duration(420)}
              layout={LinearTransition.springify().damping(20)}
              style={styles.sectionBlock}>
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
                        <View style={{ flex: 1, gap: 6 }}>
                          <View
                            style={[
                              styles.tierBadge,
                              { backgroundColor: treeOption.isUnlocked ? `${palette.accent}16` : palette.input },
                            ]}>
                            <ThemedText
                              style={{ color: treeOption.isUnlocked ? palette.accent : palette.muted, fontWeight: '700' }}>
                              {treeOption.tier}
                            </ThemedText>
                          </View>
                          <ThemedText style={[styles.treeTierName, { color: palette.text }]}>
                            {treeOption.name}
                          </ThemedText>
                          <ThemedText style={{ color: palette.muted }}>
                            {formatPoints(treeOption.cost)}
                          </ThemedText>
                        </View>
                      </View>
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
            </Animated.View>

            <Animated.View
              entering={FadeInUp.delay(200).duration(420)}
              layout={LinearTransition.springify().damping(20)}
              style={styles.sectionBlock}>
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
                  <Pressable
                    key={achievement.id}
                    onPress={() => setSelectedAchievementId(achievement.id)}
                    style={[
                      styles.achievementCard,
                      {
                        backgroundColor: palette.card,
                        borderColor:
                          selectedAchievementId === achievement.id ? palette.accent : palette.border,
                      },
                    ]}>
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
                      </View>
                    </View>
                    <View
                      style={[
                        styles.achievementMiniBar,
                        { backgroundColor: palette.input },
                      ]}>
                      <View
                        style={[
                          styles.achievementMiniFill,
                          {
                            backgroundColor: achievement.earned ? palette.accent : palette.accentAlt,
                            width: `${Math.max(achievement.progress * 100, achievement.currentValue > 0 ? 12 : 0)}%`,
                          },
                        ]}
                      />
                    </View>
                  </Pressable>
                ))}
              </View>

              {selectedAchievement ? (
                <Animated.View
                  entering={FadeInDown.duration(260)}
                  layout={LinearTransition.springify().damping(18)}
                  style={[styles.achievementDetailCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
                  <ThemedText style={[styles.achievementTitle, { color: palette.text }]}>
                    {selectedAchievement.title}
                  </ThemedText>
                  <ThemedText style={{ color: palette.muted }}>
                    {selectedAchievement.description}
                  </ThemedText>
                  <View style={[styles.progressTrack, { backgroundColor: palette.input }]}>
                    <View
                      style={[
                        styles.progressFill,
                        {
                          backgroundColor: selectedAchievement.earned ? palette.accent : palette.accentAlt,
                          width: `${Math.max(selectedAchievement.progress * 100, selectedAchievement.currentValue > 0 ? 10 : 0)}%`,
                        },
                      ]}
                    />
                  </View>
                  <ThemedText style={{ color: palette.text }}>
                    {selectedAchievement.currentValue.toFixed(selectedAchievement.unit === 'kg CO2' ? 1 : 0)} /{' '}
                    {selectedAchievement.targetValue} {selectedAchievement.unit}
                  </ThemedText>
                </Animated.View>
              ) : null}
            </Animated.View>
          </>
        ) : null}
      </ScrollView>

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
  safeArea: { flex: 1 },
  container: { padding: 20, paddingBottom: 32, gap: 18 },
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
  heroPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  heroPill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
  sectionBlock: { gap: 12 },
  sectionHeaderInline: { gap: 4 },
  sectionCard: {
    borderRadius: 26,
    borderWidth: 1,
    padding: 18,
    gap: 14,
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
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
    overflow: 'hidden',
  },
  forestScene: {
    borderRadius: 18,
    overflow: 'hidden',
    padding: 10,
    minHeight: 260,
    justifyContent: 'flex-end',
  },
  forestSceneGlow: {
    position: 'absolute',
    top: -30,
    left: '18%',
    width: 180,
    height: 180,
    borderRadius: 999,
  },
  forestSceneSun: {
    position: 'absolute',
    top: 24,
    right: 30,
    width: 88,
    height: 88,
    borderRadius: 999,
  },
  forestHillBack: {
    position: 'absolute',
    left: -30,
    right: -20,
    bottom: 52,
    height: 92,
    borderTopLeftRadius: 120,
    borderTopRightRadius: 140,
  },
  forestHillFront: {
    position: 'absolute',
    left: -24,
    right: -24,
    bottom: -8,
    height: 112,
    borderTopLeftRadius: 140,
    borderTopRightRadius: 140,
  },
  forestGrid: { gap: 10 },
  forestGridRow: { flexDirection: 'row', gap: 10 },
  forestCell: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  treeAvatar: {
    width: 34,
    height: 34,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  treeBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
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
  horizontalList: { gap: 12, paddingRight: 4 },
  treeTierCard: {
    width: 208,
    borderRadius: 28,
    borderWidth: 1,
    padding: 15,
    gap: 8,
    shadowOpacity: 0.07,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  treeTierHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  treeTierIcon: {
    width: 46,
    height: 46,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  treeTierName: {
    fontSize: 17,
    fontWeight: '700',
  },
  tierBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
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
    gap: 10,
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
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
  achievementMiniBar: {
    height: 6,
    borderRadius: 999,
    overflow: 'hidden',
  },
  achievementMiniFill: {
    height: '100%',
    borderRadius: 999,
  },
  achievementDetailCard: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 16,
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
    paddingVertical: 6,
  },
  confirmPlantButton: {
    minHeight: 50,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  confirmPlantText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
