import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';

import { ThemedText } from '@/components/themed-text';
import { useUserProfile } from '@/context/user-context';
import { fetchLeaderboard } from '@/lib/api';
import { formatCo2, formatDistance } from '@/lib/formatters';
import { LeaderboardEntry } from '@/types/trips';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function LeaderboardScreen() {
  const colorScheme = useColorScheme();
  const isFocused = useIsFocused();
  const { userId, tripVersion } = useUserProfile();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
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
        const nextEntries = await fetchLeaderboard();
        if (isMounted) {
          setEntries(nextEntries);
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
  }, [isFocused, tripVersion]);

  const totalSavedKg = entries.reduce((sum, entry) => sum + entry.totalCo2SavedKg, 0);
  const totalTrips = entries.reduce((sum, entry) => sum + entry.totalTrips, 0);

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
              {formatCo2(totalSavedKg)}
            </ThemedText>
          </View>
          <View style={[styles.summaryCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <ThemedText style={[styles.summaryLabel, { color: palette.muted }]}>Trips logged</ThemedText>
            <ThemedText style={{ color: palette.text, fontSize: 22, fontWeight: '700' }}>
              {totalTrips}
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
          entries.map((entry, index) => {
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
                  <ThemedText style={{ color: palette.text, fontWeight: '700' }}>{index + 1}</ThemedText>
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
                    {entry.totalTrips} trips · {formatDistance(entry.totalDistanceMeters)}
                  </ThemedText>
                  <ThemedText style={{ color: palette.text }}>
                    Saved {formatCo2(entry.totalCo2SavedKg)} · emitted {formatCo2(entry.totalCo2Kg)}
                  </ThemedText>
                </View>
              </View>
            );
          })
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
  entryCard: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
    flexDirection: 'row',
    gap: 14,
  },
  rankCircle: {
    width: 38,
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
