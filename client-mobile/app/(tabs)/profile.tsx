import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
import { fetchUserTrips } from '@/lib/api';
import { formatCo2, formatDistance, formatDuration, formatTripDate } from '@/lib/formatters';
import { TripRecord } from '@/types/trips';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function ProfileScreen() {
  const colorScheme = useColorScheme();
  const isFocused = useIsFocused();
  const { userId, displayName, setDisplayName, tripVersion } = useUserProfile();
  const [draftName, setDraftName] = useState(displayName);
  const [trips, setTrips] = useState<TripRecord[]>([]);
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
          input: '#122018',
        }
      : {
          background: '#F4F7F1',
          card: '#FFFFFF',
          border: '#D8E1D6',
          text: '#173126',
          muted: '#5E7267',
          accent: '#20744A',
          input: '#F8FBF7',
        };

  useEffect(() => {
    setDraftName(displayName);
  }, [displayName]);

  useEffect(() => {
    if (!isFocused) {
      return;
    }

    let isMounted = true;

    async function loadTrips() {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const nextTrips = await fetchUserTrips(userId);
        if (isMounted) {
          setTrips(nextTrips);
        }
      } catch (error) {
        if (isMounted) {
          setErrorMessage(error instanceof Error ? error.message : 'Unable to load trip history.');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadTrips();

    return () => {
      isMounted = false;
    };
  }, [isFocused, tripVersion, userId]);

  const totalTrips = trips.length;
  const totalDistanceMeters = trips.reduce((sum, trip) => sum + trip.distanceMeters, 0);
  const totalCo2Kg = trips.reduce((sum, trip) => sum + trip.co2Kg, 0);
  const totalSavedKg = trips.reduce((sum, trip) => sum + trip.co2SavedKg, 0);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={[styles.profileCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <ThemedText type="title" style={[styles.title, { color: palette.text }]}>
            Your rider profile
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

        <View style={styles.summaryRow}>
          <View style={[styles.statCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <ThemedText style={[styles.statLabel, { color: palette.muted }]}>Trips</ThemedText>
            <ThemedText style={{ color: palette.text, fontSize: 22, fontWeight: '700' }}>{totalTrips}</ThemedText>
          </View>
          <View style={[styles.statCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <ThemedText style={[styles.statLabel, { color: palette.muted }]}>Distance</ThemedText>
            <ThemedText style={{ color: palette.text, fontSize: 22, fontWeight: '700' }}>
              {formatDistance(totalDistanceMeters)}
            </ThemedText>
          </View>
        </View>

        <View style={styles.summaryRow}>
          <View style={[styles.statCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <ThemedText style={[styles.statLabel, { color: palette.muted }]}>Emitted</ThemedText>
            <ThemedText style={{ color: palette.text, fontSize: 22, fontWeight: '700' }}>
              {formatCo2(totalCo2Kg)}
            </ThemedText>
          </View>
          <View style={[styles.statCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <ThemedText style={[styles.statLabel, { color: palette.muted }]}>Saved</ThemedText>
            <ThemedText style={{ color: palette.text, fontSize: 22, fontWeight: '700' }}>
              {formatCo2(totalSavedKg)}
            </ThemedText>
          </View>
        </View>

        <View style={styles.historyHeader}>
          <ThemedText type="subtitle" style={{ color: palette.text }}>
            Trip history
          </ThemedText>
          <ThemedText style={{ color: palette.muted }}>Every completed simulation appears here.</ThemedText>
        </View>

        {isLoading ? (
          <View style={[styles.messageCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <ActivityIndicator color={palette.accent} />
            <ThemedText style={{ color: palette.text }}>Loading history...</ThemedText>
          </View>
        ) : errorMessage ? (
          <View style={[styles.messageCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <MaterialIcons name="error-outline" size={20} color={palette.accent} />
            <ThemedText style={{ color: palette.text, flex: 1 }}>{errorMessage}</ThemedText>
          </View>
        ) : trips.length === 0 ? (
          <View style={[styles.messageCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <MaterialIcons name="history" size={20} color={palette.accent} />
            <ThemedText style={{ color: palette.text, flex: 1 }}>
              No trips saved yet. Run a route simulation from the map tab to build your history.
            </ThemedText>
          </View>
        ) : (
          trips.map((trip) => (
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
                <View style={[styles.tripBadge, { backgroundColor: `${palette.accent}18` }]}>
                  <ThemedText style={{ color: palette.accent, fontWeight: '700' }}>{trip.routeType}</ThemedText>
                </View>
              </View>

              <View style={styles.tripMetrics}>
                <ThemedText style={{ color: palette.text }}>{formatDuration(trip.durationSeconds)}</ThemedText>
                <ThemedText style={{ color: palette.text }}>{formatDistance(trip.distanceMeters)}</ThemedText>
                <ThemedText style={{ color: palette.text }}>{formatCo2(trip.co2Kg)}</ThemedText>
              </View>

              <ThemedText style={{ color: palette.muted }}>
                Logged {formatTripDate(trip.completedAt)} · saved {formatCo2(trip.co2SavedKg)}
              </ThemedText>
            </View>
          ))
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
  profileCard: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 18,
    gap: 12,
  },
  title: {
    fontSize: 30,
    lineHeight: 32,
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
  summaryRow: {
    flexDirection: 'row',
    gap: 12,
  },
  statCard: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    gap: 6,
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  historyHeader: {
    gap: 4,
  },
  messageCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  tripCard: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 16,
    gap: 10,
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
  tripBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  tripMetrics: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
});
