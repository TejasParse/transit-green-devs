import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useIsFocused } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { useUserProfile } from '@/context/user-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { fetchLeaderboard } from '@/lib/api';
import { formatCo2, formatDistance, formatTripDate } from '@/lib/formatters';
import { LeaderboardEntry, LeaderboardSnapshot } from '@/types/trips';

const EMPTY_LEADERBOARD: LeaderboardSnapshot = {
  summary: {
    activeRiders: 0,
    totalTrips: 0,
    totalDistanceMeters: 0,
    totalCo2Kg: 0,
    totalCo2SavedKg: 0,
  },
  entries: [],
  currentUser: null,
};

export default function LeaderboardScreen() {
  const colorScheme = useColorScheme();
  const isFocused = useIsFocused();
  const { userId, tripVersion } = useUserProfile();
  const [leaderboard, setLeaderboard] = useState<LeaderboardSnapshot>(EMPTY_LEADERBOARD);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const palette =
    colorScheme === 'dark'
      ? {
          background: '#0E1511',
          card: '#152019',
          border: '#2A3A31',
          text: '#EAF5EE',
          muted: '#A2B1A7',
          accent: '#4DA86D',
          accentAlt: '#E6B14C',
        }
      : {
          background: '#F4F7F1',
          card: '#FFFFFF',
          border: '#D8E1D6',
          text: '#173126',
          muted: '#5E7267',
          accent: '#20744A',
          accentAlt: '#C67A18',
        };

  useEffect(() => {
    if (!isFocused) {
      return;
    }

    let isMounted = true;

    async function loadLeaderboard() {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const nextLeaderboard = await fetchLeaderboard(userId);
        if (isMounted) {
          setLeaderboard(nextLeaderboard);
        }
      } catch (error) {
        if (isMounted) {
          setErrorMessage(
            error instanceof Error ? error.message : 'Unable to load the leaderboard right now.'
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadLeaderboard();

    return () => {
      isMounted = false;
    };
  }, [isFocused, tripVersion, userId]);

  const entries = leaderboard.entries;
  const currentUser = leaderboard.currentUser;
  const topThreeEntries = entries.slice(0, 3);

  function renderEntryCard(entry: LeaderboardEntry) {
    const isCurrentUser = entry.userId === userId;

    return (
      <View
        key={entry.userId}
        style={[
          styles.entryCard,
          {
            backgroundColor: palette.card,
            borderColor: isCurrentUser ? palette.accent : palette.border,
          },
        ]}>
        <View style={styles.rankCircle}>
          <ThemedText style={{ color: palette.text, fontWeight: '700' }}>#{entry.rank}</ThemedText>
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <View style={styles.entryHeader}>
            <ThemedText style={[styles.entryName, { color: palette.text }]}>{entry.displayName}</ThemedText>
            {isCurrentUser ? (
              <View style={[styles.youBadge, { backgroundColor: `${palette.accent}18` }]}>
                <ThemedText style={{ color: palette.accent, fontWeight: '700' }}>You</ThemedText>
              </View>
            ) : null}
          </View>
          <ThemedText style={{ color: palette.muted }}>
            {entry.totalTrips} trips | {formatDistance(entry.totalDistanceMeters)}
          </ThemedText>
          <ThemedText style={{ color: palette.text }}>
            Saved {formatCo2(entry.totalCo2SavedKg)} | emitted {formatCo2(entry.totalCo2Kg)}
          </ThemedText>
          {entry.lastTripAt ? (
            <ThemedText style={{ color: palette.muted }}>Last trip {formatTripDate(entry.lastTripAt)}</ThemedText>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <ThemedText type="title" style={[styles.title, { color: palette.text }]}>
            Community leaderboard
          </ThemedText>
          <ThemedText style={{ color: palette.muted }}>
            Riders are ranked by how much CO2 they have avoided compared with driving solo.
          </ThemedText>
        </View>

        <View style={styles.summaryRow}>
          <View style={[styles.summaryCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <ThemedText style={[styles.summaryLabel, { color: palette.muted }]}>Saved together</ThemedText>
            <ThemedText style={{ color: palette.text, fontSize: 22, fontWeight: '700' }}>
              {formatCo2(leaderboard.summary.totalCo2SavedKg)}
            </ThemedText>
          </View>
          <View style={[styles.summaryCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <ThemedText style={[styles.summaryLabel, { color: palette.muted }]}>Trips logged</ThemedText>
            <ThemedText style={{ color: palette.text, fontSize: 22, fontWeight: '700' }}>
              {leaderboard.summary.totalTrips}
            </ThemedText>
          </View>
        </View>

        <View style={styles.summaryRow}>
          <View style={[styles.summaryCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <ThemedText style={[styles.summaryLabel, { color: palette.muted }]}>Riders active</ThemedText>
            <ThemedText style={{ color: palette.text, fontSize: 22, fontWeight: '700' }}>
              {leaderboard.summary.activeRiders}
            </ThemedText>
          </View>
          <View style={[styles.summaryCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <ThemedText style={[styles.summaryLabel, { color: palette.muted }]}>Distance</ThemedText>
            <ThemedText style={{ color: palette.text, fontSize: 22, fontWeight: '700' }}>
              {formatDistance(leaderboard.summary.totalDistanceMeters)}
            </ThemedText>
          </View>
        </View>

        {isLoading ? (
          <View style={[styles.loadingCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <ActivityIndicator color={palette.accent} />
            <ThemedText style={{ color: palette.text }}>Loading leaderboard...</ThemedText>
          </View>
        ) : errorMessage ? (
          <View style={[styles.messageCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <MaterialIcons name="error-outline" size={20} color={palette.accentAlt} />
            <ThemedText style={{ color: palette.text, flex: 1 }}>{errorMessage}</ThemedText>
          </View>
        ) : entries.length === 0 ? (
          <View style={[styles.messageCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <MaterialIcons name="emoji-events" size={20} color={palette.accentAlt} />
            <ThemedText style={{ color: palette.text, flex: 1 }}>
              No trips yet. Finish a simulated trip on the map tab and it will appear here.
            </ThemedText>
          </View>
        ) : (
          <>
            {currentUser ? (
              <View
                style={[
                  styles.currentUserCard,
                  { backgroundColor: palette.card, borderColor: palette.accent },
                ]}>
                <ThemedText style={[styles.summaryLabel, { color: palette.accent }]}>Your standing</ThemedText>
                <ThemedText style={{ color: palette.text, fontSize: 24, fontWeight: '700' }}>
                  #{currentUser.rank} in community
                </ThemedText>
                <ThemedText style={{ color: palette.muted }}>
                  {formatCo2(currentUser.totalCo2SavedKg)} saved across {currentUser.totalTrips} trips.
                </ThemedText>
                {currentUser.rank === 1 ? (
                  <ThemedText style={{ color: palette.accent }}>
                    You are currently leading the leaderboard.
                  </ThemedText>
                ) : currentUser.co2GapToNextRankKg != null ? (
                  <ThemedText style={{ color: palette.text }}>
                    {formatCo2(currentUser.co2GapToNextRankKg)} more to pass rank #{currentUser.rank - 1}.
                  </ThemedText>
                ) : null}
              </View>
            ) : null}

            <View style={[styles.podiumCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
              <ThemedText type="subtitle" style={{ color: palette.text }}>
                Top riders
              </ThemedText>
              {topThreeEntries.map((entry) => (
                <View key={entry.userId} style={styles.podiumRow}>
                  <MaterialIcons
                    name={entry.rank === 1 ? 'emoji-events' : 'workspace-premium'}
                    size={20}
                    color={entry.rank === 1 ? palette.accentAlt : palette.accent}
                  />
                  <View style={{ flex: 1 }}>
                    <ThemedText style={{ color: palette.text, fontWeight: '700' }}>
                      #{entry.rank} {entry.displayName}
                    </ThemedText>
                    <ThemedText style={{ color: palette.muted }}>
                      {entry.totalTrips} trips | {formatDistance(entry.totalDistanceMeters)}
                    </ThemedText>
                  </View>
                  <ThemedText style={{ color: palette.text, fontWeight: '700' }}>
                    {formatCo2(entry.totalCo2SavedKg)}
                  </ThemedText>
                </View>
              ))}
            </View>

            <ThemedText type="subtitle" style={{ color: palette.text }}>
              Full ranking
            </ThemedText>
            {entries.map((entry) => renderEntryCard(entry))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    padding: 20,
    gap: 16,
  },
  header: {
    gap: 6,
  },
  title: {
    fontSize: 30,
    lineHeight: 32,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 12,
  },
  summaryCard: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    gap: 6,
  },
  summaryLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  loadingCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
    gap: 10,
  },
  messageCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    flexDirection: 'row',
    gap: 10,
  },
  currentUserCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    gap: 6,
  },
  podiumCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  podiumRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  entryCard: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
    flexDirection: 'row',
    gap: 14,
  },
  rankCircle: {
    width: 46,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(127, 127, 127, 0.12)',
  },
  entryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  entryName: {
    fontSize: 18,
    fontWeight: '700',
  },
  youBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
});

