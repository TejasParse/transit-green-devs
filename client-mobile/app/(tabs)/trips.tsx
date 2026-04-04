import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';

import { RouteMap } from '../../components/route-map';
import { DOWNTOWN_PHOENIX } from '@/constants/phoenix';
import { ThemedText } from '@/components/themed-text';
import { api } from '@/lib/api';
import {
  formatCarbonKg,
  formatDistanceMiles,
  formatDurationMinutes,
  formatTripDate,
} from '@/lib/geo';
import type { TripRecord } from '@/types/app';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricPill}>
      <ThemedText style={styles.metricLabel}>{label}</ThemedText>
      <ThemedText style={styles.metricValue}>{value}</ThemedText>
    </View>
  );
}

export default function TripsScreen() {
  const isFocused = useIsFocused();
  const [trips, setTrips] = useState<TripRecord[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadTrips = useCallback(async () => {
    try {
      setIsLoading(true);
      setErrorMessage(null);
      const response = await api.getTrips();
      setTrips(response.trips);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isFocused) {
      void loadTrips();
    }
  }, [isFocused, loadTrips]);

  useEffect(() => {
    if (trips.length === 0) {
      setSelectedTripId(null);
      return;
    }

    const selectedTripStillExists = trips.some((trip) => trip.id === selectedTripId);
    if (!selectedTripStillExists) {
      setSelectedTripId(trips[0].id);
    }
  }, [selectedTripId, trips]);

  const selectedTrip = trips.find((trip) => trip.id === selectedTripId) ?? trips[0] ?? null;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <FlatList
        data={trips}
        keyExtractor={(item) => String(item.id)}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={() => void loadTrips()} />}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <View style={styles.headerRow}>
              <View style={styles.headingCopy}>
                <ThemedText style={styles.eyebrow}>Trip Log</ThemedText>
                <ThemedText type="title" style={styles.title}>
                  Saved Phoenix routes
                </ThemedText>
              </View>

              <Pressable style={styles.refreshButton} onPress={() => void loadTrips()}>
                <ThemedText style={styles.refreshButtonText}>Refresh</ThemedText>
              </Pressable>
            </View>

            {errorMessage ? (
              <View style={styles.errorBanner}>
                <ThemedText style={styles.errorText}>{errorMessage}</ThemedText>
              </View>
            ) : null}

            <View style={styles.mapCard}>
              <RouteMap
                origin={selectedTrip?.origin || DOWNTOWN_PHOENIX}
                destination={selectedTrip?.destination}
                routePath={selectedTrip?.routePath}
                currentPosition={selectedTrip?.destination}
              />
            </View>

            {selectedTrip ? (
              <View style={styles.summaryCard}>
                <View style={styles.summaryHeader}>
                  <View>
                    <ThemedText style={styles.summaryEyebrow}>Selected Trip</ThemedText>
                    <ThemedText style={styles.summaryTitle}>{selectedTrip.destinationName}</ThemedText>
                    <ThemedText style={styles.summarySubtle}>
                      {`${selectedTrip.originName} to ${selectedTrip.destinationName}`}
                    </ThemedText>
                  </View>
                  <View
                    style={[
                      styles.routeBadge,
                      selectedTrip.routeKind === 'eco' ? styles.routeBadgeEco : styles.routeBadgeFallback,
                    ]}>
                    <ThemedText style={styles.routeBadgeText}>
                      {selectedTrip.routeKind === 'eco' ? 'Eco route' : 'Best available'}
                    </ThemedText>
                  </View>
                </View>

                <View style={styles.metricRow}>
                  <MetricPill label="Distance" value={formatDistanceMiles(selectedTrip.distanceMeters)} />
                  <MetricPill
                    label="Duration"
                    value={formatDurationMinutes(
                      selectedTrip.actualDurationSeconds ?? selectedTrip.durationSeconds
                    )}
                  />
                  <MetricPill label="Carbon" value={formatCarbonKg(selectedTrip.estimatedCarbonKg)} />
                </View>

                <ThemedText style={styles.summarySubtle}>
                  {`Started ${formatTripDate(selectedTrip.startedAt)}`}
                </ThemedText>
              </View>
            ) : (
              <View style={styles.emptyCard}>
                {isLoading ? (
                  <ActivityIndicator color="#2B6E52" />
                ) : (
                  <ThemedText style={styles.emptyText}>
                    Start a trip from the Ride tab and it will show up here with the recorded route.
                  </ThemedText>
                )}
              </View>
            )}

            <ThemedText style={styles.listTitle}>Recent trips</ThemedText>
          </View>
        }
        ListEmptyComponent={
          isLoading ? null : (
            <View style={styles.emptyCard}>
              <ThemedText style={styles.emptyText}>
                No trips saved yet. Plan a Phoenix route and let the simulator finish it.
              </ThemedText>
            </View>
          )
        }
        renderItem={({ item }) => {
          const isSelected = item.id === selectedTrip?.id;

          return (
            <Pressable
              onPress={() => setSelectedTripId(item.id)}
              style={[styles.tripCard, isSelected ? styles.tripCardSelected : null]}>
              <View style={styles.tripCardHeader}>
                <View>
                  <ThemedText style={styles.tripDestination}>{item.destinationName}</ThemedText>
                  <ThemedText style={styles.tripRoute}>{`${item.originName} to ${item.destinationName}`}</ThemedText>
                </View>
                <ThemedText style={styles.tripTimestamp}>{formatTripDate(item.startedAt)}</ThemedText>
              </View>

              <View style={styles.tripMetrics}>
                <MetricPill label="Distance" value={formatDistanceMiles(item.distanceMeters)} />
                <MetricPill
                  label="Duration"
                  value={formatDurationMinutes(item.actualDurationSeconds ?? item.durationSeconds)}
                />
                <MetricPill label="Carbon" value={formatCarbonKg(item.estimatedCarbonKg)} />
              </View>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F2EBDD',
  },
  content: {
    gap: 16,
    padding: 20,
    paddingBottom: 36,
  },
  headerBlock: {
    gap: 16,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  headingCopy: {
    flex: 1,
    gap: 4,
  },
  eyebrow: {
    color: '#C76D4D',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: {
    color: '#1F3558',
  },
  refreshButton: {
    backgroundColor: '#1F3558',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  refreshButtonText: {
    color: '#FFF9F1',
    fontWeight: '700',
  },
  mapCard: {
    backgroundColor: '#FFF9F1',
    borderRadius: 28,
    minHeight: 280,
    overflow: 'hidden',
  },
  summaryCard: {
    backgroundColor: '#FFF9F1',
    borderRadius: 24,
    gap: 16,
    padding: 18,
  },
  summaryHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  summaryEyebrow: {
    color: '#667085',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  summaryTitle: {
    color: '#102A43',
    fontSize: 22,
    fontWeight: '800',
  },
  summarySubtle: {
    color: '#52606D',
  },
  routeBadge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  routeBadgeEco: {
    backgroundColor: '#DDF3E5',
  },
  routeBadgeFallback: {
    backgroundColor: '#FCE3D9',
  },
  routeBadgeText: {
    color: '#102A43',
    fontSize: 12,
    fontWeight: '700',
  },
  metricRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metricPill: {
    backgroundColor: '#F2EBDD',
    borderRadius: 18,
    gap: 2,
    minWidth: 100,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  metricLabel: {
    color: '#7B8794',
    fontSize: 12,
  },
  metricValue: {
    color: '#102A43',
    fontSize: 15,
    fontWeight: '700',
  },
  listTitle: {
    color: '#102A43',
    fontSize: 18,
    fontWeight: '800',
  },
  tripCard: {
    backgroundColor: '#FFF9F1',
    borderRadius: 24,
    gap: 16,
    padding: 18,
  },
  tripCardSelected: {
    borderColor: '#2B6E52',
    borderWidth: 2,
  },
  tripCardHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  tripDestination: {
    color: '#102A43',
    fontSize: 18,
    fontWeight: '800',
  },
  tripRoute: {
    color: '#52606D',
  },
  tripTimestamp: {
    color: '#7B8794',
  },
  tripMetrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  emptyCard: {
    alignItems: 'center',
    backgroundColor: '#FFF9F1',
    borderRadius: 24,
    justifyContent: 'center',
    minHeight: 120,
    padding: 20,
  },
  emptyText: {
    color: '#52606D',
    textAlign: 'center',
  },
  errorBanner: {
    backgroundColor: '#FCE3D9',
    borderRadius: 18,
    padding: 14,
  },
  errorText: {
    color: '#8B2E14',
    fontWeight: '600',
  },
});
