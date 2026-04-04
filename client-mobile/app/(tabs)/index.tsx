import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RouteMap } from '../../components/route-map';
import { DOWNTOWN_PHOENIX, isWithinPhoenix } from '@/constants/phoenix';
import { ThemedText } from '@/components/themed-text';
import { api } from '@/lib/api';
import {
  computePolylineDistance,
  formatCarbonKg,
  formatDistanceMiles,
  formatDurationMinutes,
  getCoordinateAtDistance,
} from '@/lib/geo';
import type { Coordinate, PlaceDetails, PlaceSuggestion, PlannedRoute } from '@/types/app';

const AUTOCOMPLETE_DELAY_MS = 250;

type ActiveTrip = {
  id: number;
  startedAt: string;
  destinationName: string;
  progressMeters: number;
  pathDistanceMeters: number;
  currentPosition: Coordinate;
  speedMetersPerSecond: number;
  simulationDurationSeconds: number;
  isCompleting: boolean;
  completionFailed: boolean;
};

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

export default function RideScreen() {
  const [origin, setOrigin] = useState(DOWNTOWN_PHOENIX);
  const [originName, setOriginName] = useState('Downtown Phoenix');
  const [originSearchText, setOriginSearchText] = useState('Downtown Phoenix');
  const [destinationSearchText, setDestinationSearchText] = useState('');
  const [originSuggestions, setOriginSuggestions] = useState<PlaceSuggestion[]>([]);
  const [destinationSuggestions, setDestinationSuggestions] = useState<PlaceSuggestion[]>([]);
  const [selectedDestination, setSelectedDestination] = useState<PlaceDetails | null>(null);
  const [plannedRoute, setPlannedRoute] = useState<PlannedRoute | null>(null);
  const [activeTrip, setActiveTrip] = useState<ActiveTrip | null>(null);
  const [routeFallbackMessage, setRouteFallbackMessage] = useState<string | null>(null);
  const [simulationMinutes, setSimulationMinutes] = useState('3');
  const [infoMessage, setInfoMessage] = useState(
    'Choose any Phoenix-area start point, then choose a destination and playback time.'
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSearchingOrigin, setIsSearchingOrigin] = useState(false);
  const [isSearchingDestination, setIsSearchingDestination] = useState(false);
  const [isPlanningRoute, setIsPlanningRoute] = useState(false);
  const [isStartingTrip, setIsStartingTrip] = useState(false);

  const fetchSuggestions = useCallback(async (query: string) => {
    const response = await api.autocompletePlaces(query);
    return response.suggestions;
  }, []);

  const planRouteToDestination = useCallback(
    async (nextOrigin: Coordinate, place: PlaceDetails) => {
      try {
        setIsPlanningRoute(true);
        setErrorMessage(null);
        const response = await api.planRoute(nextOrigin, place.coordinate);
        setSelectedDestination(place);
        setPlannedRoute(response.route);
        setRouteFallbackMessage(response.routeFallback || null);
        setInfoMessage(
          response.route.routeKind === 'eco'
            ? `Eco route ready to ${place.name}.`
            : `Best available route ready to ${place.name}.`
        );
      } catch (error) {
        setPlannedRoute(null);
        setRouteFallbackMessage(null);
        setErrorMessage(getErrorMessage(error));
      } finally {
        setIsPlanningRoute(false);
      }
    },
    []
  );

  const completeTrip = useCallback(
    async (trip: ActiveTrip) => {
      if (!plannedRoute) {
        return;
      }

      try {
        const endedAt = new Date().toISOString();
        const actualDurationSeconds = Math.max(
          1,
          Math.round((new Date(endedAt).getTime() - new Date(trip.startedAt).getTime()) / 1000)
        );

        await api.completeTrip(trip.id, {
          endedAt,
          actualDurationSeconds,
        });

        setOrigin(plannedRoute.destination);
        setOriginName(trip.destinationName);
        setOriginSearchText(trip.destinationName);
        setDestinationSearchText('');
        setOriginSuggestions([]);
        setDestinationSuggestions([]);
        setSelectedDestination(null);
        setPlannedRoute(null);
        setActiveTrip(null);
        setRouteFallbackMessage(null);
        setInfoMessage(`${trip.destinationName} reached. The trip is now saved in Postgres.`);
      } catch (error) {
        setErrorMessage(getErrorMessage(error));
        setActiveTrip((currentTrip) =>
          currentTrip ? { ...currentTrip, isCompleting: false, completionFailed: true } : currentTrip
        );
      }
    },
    [plannedRoute]
  );

  const progressSimulation = useCallback(
    (elapsedSeconds: number) => {
      if (!plannedRoute) {
        return;
      }

      setActiveTrip((currentTrip) => {
        if (!currentTrip) {
          return currentTrip;
        }

        const nextProgress = Math.min(
          currentTrip.progressMeters + elapsedSeconds * currentTrip.speedMetersPerSecond,
          currentTrip.pathDistanceMeters
        );

        return {
          ...currentTrip,
          progressMeters: nextProgress,
          currentPosition:
            getCoordinateAtDistance(plannedRoute.routePath, nextProgress) || plannedRoute.destination,
        };
      });
    },
    [plannedRoute]
  );

  useEffect(() => {
    const trimmedSearch = originSearchText.trim();

    if (trimmedSearch.length < 2 || activeTrip || trimmedSearch === originName) {
      setOriginSuggestions([]);
      setIsSearchingOrigin(false);
      return;
    }

    let isCancelled = false;
    const timeoutId = setTimeout(() => {
      void (async () => {
        try {
          setIsSearchingOrigin(true);
          setErrorMessage(null);
          const suggestions = await fetchSuggestions(trimmedSearch);
          if (!isCancelled) {
            setOriginSuggestions(suggestions);
          }
        } catch (error) {
          if (!isCancelled) {
            setOriginSuggestions([]);
            setErrorMessage(getErrorMessage(error));
          }
        } finally {
          if (!isCancelled) {
            setIsSearchingOrigin(false);
          }
        }
      })();
    }, AUTOCOMPLETE_DELAY_MS);

    return () => {
      isCancelled = true;
      clearTimeout(timeoutId);
    };
  }, [activeTrip, fetchSuggestions, originName, originSearchText]);

  useEffect(() => {
    const trimmedSearch = destinationSearchText.trim();

    if (
      trimmedSearch.length < 2 ||
      activeTrip ||
      (selectedDestination !== null && trimmedSearch === selectedDestination.name)
    ) {
      setDestinationSuggestions([]);
      setIsSearchingDestination(false);
      return;
    }

    let isCancelled = false;
    const timeoutId = setTimeout(() => {
      void (async () => {
        try {
          setIsSearchingDestination(true);
          setErrorMessage(null);
          const suggestions = await fetchSuggestions(trimmedSearch);
          if (!isCancelled) {
            setDestinationSuggestions(suggestions);
          }
        } catch (error) {
          if (!isCancelled) {
            setDestinationSuggestions([]);
            setErrorMessage(getErrorMessage(error));
          }
        } finally {
          if (!isCancelled) {
            setIsSearchingDestination(false);
          }
        }
      })();
    }, AUTOCOMPLETE_DELAY_MS);

    return () => {
      isCancelled = true;
      clearTimeout(timeoutId);
    };
  }, [activeTrip, destinationSearchText, fetchSuggestions, selectedDestination]);

  useEffect(() => {
    const activeTripId = activeTrip?.id;

    if (!activeTripId || !plannedRoute) {
      return;
    }

    let lastTickAt = Date.now();
    const intervalId = setInterval(() => {
      const now = Date.now();
      const elapsedSeconds = Math.max(0.5, (now - lastTickAt) / 1000);
      lastTickAt = now;
      progressSimulation(elapsedSeconds);
    }, 1000);

    return () => clearInterval(intervalId);
  }, [activeTrip?.id, plannedRoute, progressSimulation]);

  useEffect(() => {
    if (!activeTrip || !plannedRoute || activeTrip.isCompleting || activeTrip.completionFailed) {
      return;
    }

    if (activeTrip.progressMeters < activeTrip.pathDistanceMeters) {
      return;
    }

    setActiveTrip((currentTrip) =>
      currentTrip ? { ...currentTrip, isCompleting: true } : currentTrip
    );
    void completeTrip(activeTrip);
  }, [activeTrip, completeTrip, plannedRoute]);

  const handleOriginSelect = async (suggestion: PlaceSuggestion) => {
    if (activeTrip) {
      return;
    }

    try {
      setOriginSuggestions([]);
      const place = await api.getPlaceDetails(suggestion.placeId);
      setOrigin(place.coordinate);
      setOriginName(place.name);
      setOriginSearchText(place.name);
      setInfoMessage(`Origin moved to ${place.name}.`);

      if (selectedDestination) {
        await planRouteToDestination(place.coordinate, selectedDestination);
      } else {
        setPlannedRoute(null);
        setRouteFallbackMessage(null);
      }
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  const handleDestinationSelect = async (suggestion: PlaceSuggestion) => {
    if (activeTrip) {
      return;
    }

    try {
      setDestinationSuggestions([]);
      const place = await api.getPlaceDetails(suggestion.placeId);
      setDestinationSearchText(place.name);
      await planRouteToDestination(origin, place);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  };

  const handleStartTrip = async () => {
    if (!plannedRoute || !selectedDestination || activeTrip) {
      return;
    }

    const parsedSimulationMinutes = Number.parseFloat(simulationMinutes);
    if (!Number.isFinite(parsedSimulationMinutes) || parsedSimulationMinutes <= 0) {
      setErrorMessage('Simulation time must be greater than 0 minutes.');
      return;
    }

    try {
      setIsStartingTrip(true);
      setErrorMessage(null);

      const startedAt = new Date().toISOString();
      const response = await api.createTrip({
        originName,
        origin: plannedRoute.origin,
        destinationName: selectedDestination.name,
        destination: plannedRoute.destination,
        routeKind: plannedRoute.routeKind,
        routeLabels: plannedRoute.routeLabels,
        routePath: plannedRoute.routePath,
        distanceMeters: plannedRoute.distanceMeters,
        durationSeconds: plannedRoute.durationSeconds,
        estimatedCarbonKg: plannedRoute.estimatedCarbonKg,
        fuelConsumptionLiters: plannedRoute.fuelConsumptionLiters,
        startedAt,
      });

      const pathDistanceMeters = Math.max(1, computePolylineDistance(plannedRoute.routePath));
      const simulationDurationSeconds = Math.max(5, Math.round(parsedSimulationMinutes * 60));
      const speedMetersPerSecond = pathDistanceMeters / simulationDurationSeconds;

      setActiveTrip({
        id: response.trip.id,
        startedAt,
        destinationName: selectedDestination.name,
        progressMeters: 0,
        pathDistanceMeters,
        currentPosition: plannedRoute.origin,
        speedMetersPerSecond,
        simulationDurationSeconds,
        isCompleting: false,
        completionFailed: false,
      });
      setInfoMessage(
        `Trip started to ${selectedDestination.name}. Playback will finish in about ${simulationMinutes} minute(s).`
      );
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsStartingTrip(false);
    }
  };

  const handleOriginChange = (nextOrigin: Coordinate) => {
    if (activeTrip || !isWithinPhoenix(nextOrigin)) {
      return;
    }

    const nextOriginName = 'Pinned Phoenix start';
    setOrigin(nextOrigin);
    setOriginName(nextOriginName);
    setOriginSearchText(nextOriginName);
    setInfoMessage('Start point moved on the map. Search again or keep the current destination to re-plan.');
    setErrorMessage(null);

    if (selectedDestination) {
      void planRouteToDestination(nextOrigin, selectedDestination);
    } else {
      setPlannedRoute(null);
      setRouteFallbackMessage(null);
    }
  };

  const showPlanningOverlay = !activeTrip;
  const showCompletionRecovery = Boolean(activeTrip?.completionFailed);

  const retryTripCompletion = () => {
    if (!activeTrip) {
      return;
    }

    const nextTrip = {
      ...activeTrip,
      isCompleting: true,
      completionFailed: false,
    };

    setActiveTrip(nextTrip);
    void completeTrip(nextTrip);
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.select({ ios: 'padding', default: undefined })}>
        <View style={styles.mapShell}>
          <RouteMap
            origin={origin}
            destination={plannedRoute?.destination}
            routePath={plannedRoute?.routePath}
            currentPosition={activeTrip?.currentPosition || origin}
            onOriginSelect={handleOriginChange}
            isTripActive={Boolean(activeTrip)}
          />

          {showPlanningOverlay ? (
            <View pointerEvents="box-none" style={styles.overlay}>
              <View style={styles.bottomPanel}>
                <ScrollView
                  bounces={false}
                  contentContainerStyle={styles.bottomSheetContent}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}>
                  <View style={styles.searchCard}>
                    <View style={styles.searchHeader}>
                      <View>
                        <ThemedText style={styles.searchLabel}>Origin</ThemedText>
                        <ThemedText style={styles.searchOrigin}>{originName}</ThemedText>
                      </View>

                      <Pressable
                        onPress={() => handleOriginChange(DOWNTOWN_PHOENIX)}
                        style={styles.resetButton}>
                        <ThemedText style={styles.resetButtonText}>Reset</ThemedText>
                      </Pressable>
                    </View>

                    <TextInput
                      value={originSearchText}
                      editable={!activeTrip}
                      onChangeText={(value) => {
                        setOriginSearchText(value);
                        setErrorMessage(null);
                      }}
                      placeholder="Search a Phoenix start or tap map"
                      placeholderTextColor="#7B8794"
                      style={styles.searchInput}
                    />

                    {isSearchingOrigin ? (
                      <View style={styles.inlineStatus}>
                        <ActivityIndicator color="#2B6E52" />
                        <ThemedText style={styles.inlineStatusText}>Searching Phoenix starts…</ThemedText>
                      </View>
                    ) : null}

                    {originSuggestions.length > 0 ? (
                      <ScrollView style={styles.suggestionsList} keyboardShouldPersistTaps="handled">
                        {originSuggestions.map((suggestion) => (
                          <Pressable
                            key={suggestion.placeId}
                            onPress={() => void handleOriginSelect(suggestion)}
                            style={styles.suggestionRow}>
                            <ThemedText style={styles.suggestionMain}>{suggestion.mainText}</ThemedText>
                            {suggestion.secondaryText ? (
                              <ThemedText style={styles.suggestionSecondary}>
                                {suggestion.secondaryText}
                              </ThemedText>
                            ) : null}
                          </Pressable>
                        ))}
                      </ScrollView>
                    ) : null}

                    <View style={styles.fieldBlock}>
                      <ThemedText style={styles.searchLabel}>Destination</ThemedText>
                      <TextInput
                        value={destinationSearchText}
                        editable={!activeTrip}
                        onChangeText={(value) => {
                          setDestinationSearchText(value);
                          setErrorMessage(null);
                          if (selectedDestination && value.trim() !== selectedDestination.name) {
                            setSelectedDestination(null);
                            setPlannedRoute(null);
                            setRouteFallbackMessage(null);
                          }
                        }}
                        placeholder="Search a Phoenix destination"
                        placeholderTextColor="#7B8794"
                        style={styles.searchInput}
                      />

                      {isSearchingDestination ? (
                        <View style={styles.inlineStatus}>
                          <ActivityIndicator color="#2B6E52" />
                          <ThemedText style={styles.inlineStatusText}>
                            Searching Phoenix destinations…
                          </ThemedText>
                        </View>
                      ) : null}

                      {destinationSuggestions.length > 0 ? (
                        <ScrollView style={styles.suggestionsList} keyboardShouldPersistTaps="handled">
                          {destinationSuggestions.map((suggestion) => (
                            <Pressable
                              key={suggestion.placeId}
                              onPress={() => void handleDestinationSelect(suggestion)}
                              style={styles.suggestionRow}>
                              <ThemedText style={styles.suggestionMain}>{suggestion.mainText}</ThemedText>
                              {suggestion.secondaryText ? (
                                <ThemedText style={styles.suggestionSecondary}>
                                  {suggestion.secondaryText}
                                </ThemedText>
                              ) : null}
                            </Pressable>
                          ))}
                        </ScrollView>
                      ) : null}
                    </View>

                    {errorMessage ? (
                      <View style={styles.errorBanner}>
                        <ThemedText style={styles.errorText}>{errorMessage}</ThemedText>
                      </View>
                    ) : null}
                  </View>

                  <View style={styles.summaryCard}>
                    <View style={styles.summaryHeader}>
                      <View>
                        <ThemedText style={styles.summaryEyebrow}>Trip Preview</ThemedText>
                        <ThemedText style={styles.summaryTitle}>
                          {selectedDestination?.name || 'Choose a destination'}
                        </ThemedText>
                      </View>

                      {plannedRoute ? (
                        <View
                          style={[
                            styles.routeBadge,
                            plannedRoute.routeKind === 'eco'
                              ? styles.routeBadgeEco
                              : styles.routeBadgeFallback,
                          ]}>
                          <ThemedText style={styles.routeBadgeText}>
                            {plannedRoute.routeKind === 'eco' ? 'Eco route' : 'Best available'}
                          </ThemedText>
                        </View>
                      ) : null}
                    </View>

                    {plannedRoute ? (
                      <>
                        <View style={styles.metricRow}>
                          <MetricPill label="Distance" value={formatDistanceMiles(plannedRoute.distanceMeters)} />
                          <MetricPill
                            label="Duration"
                            value={formatDurationMinutes(plannedRoute.durationSeconds)}
                          />
                          <MetricPill label="Carbon" value={formatCarbonKg(plannedRoute.estimatedCarbonKg)} />
                        </View>

                        {routeFallbackMessage ? (
                          <ThemedText style={styles.fallbackText}>
                            Eco routing was unavailable for this request, so the best standard route is shown.
                          </ThemedText>
                        ) : null}
                      </>
                    ) : (
                      <ThemedText style={styles.emptyHint}>
                        Destinations and routes are restricted to the Greater Phoenix area.
                      </ThemedText>
                    )}

                    <View style={styles.fieldBlock}>
                      <ThemedText style={styles.searchLabel}>Simulation Time</ThemedText>
                      <TextInput
                        value={simulationMinutes}
                        editable={!activeTrip}
                        onChangeText={(value) => {
                          setSimulationMinutes(value);
                          setErrorMessage(null);
                        }}
                        placeholder="3"
                        placeholderTextColor="#7B8794"
                        keyboardType="decimal-pad"
                        style={styles.searchInput}
                      />
                      <ThemedText style={styles.infoText}>
                        Minutes. Use decimals like 0.5 for 30 seconds.
                      </ThemedText>
                    </View>

                    <ThemedText style={styles.infoText}>{infoMessage}</ThemedText>

                    <Pressable
                      disabled={!plannedRoute || isPlanningRoute || isStartingTrip || Boolean(activeTrip)}
                      onPress={() => void handleStartTrip()}
                      style={[
                        styles.startButton,
                        !plannedRoute || isPlanningRoute || isStartingTrip || activeTrip
                          ? styles.startButtonDisabled
                          : null,
                      ]}>
                      {isPlanningRoute || isStartingTrip ? (
                        <ActivityIndicator color="#FFF9F1" />
                      ) : (
                        <ThemedText style={styles.startButtonText}>Start simulated trip</ThemedText>
                      )}
                    </Pressable>
                  </View>
                </ScrollView>
              </View>
            </View>
          ) : null}

          {showCompletionRecovery ? (
            <View pointerEvents="box-none" style={styles.recoveryOverlay}>
              <View style={styles.recoveryCard}>
                <ThemedText style={styles.recoveryTitle}>Trip reached destination</ThemedText>
                <ThemedText style={styles.recoveryBody}>
                  The completion update failed, so retry the save.
                </ThemedText>
                <Pressable onPress={retryTripCompletion} style={styles.retryButton}>
                  <ThemedText style={styles.retryButtonText}>Retry trip save</ThemedText>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F2EBDD',
  },
  mapShell: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    paddingBottom: 20,
  },
  bottomPanel: {
    alignSelf: 'stretch',
    paddingBottom: 8,
  },
  bottomSheetContent: {
    gap: 12,
  },
  searchCard: {
    backgroundColor: 'rgba(255, 249, 241, 0.95)',
    borderRadius: 24,
    gap: 12,
    padding: 16,
  },
  searchHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  searchLabel: {
    color: '#7B8794',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  searchOrigin: {
    color: '#102A43',
    fontSize: 16,
    fontWeight: '800',
  },
  resetButton: {
    backgroundColor: '#1F3558',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  resetButtonText: {
    color: '#FFF9F1',
    fontWeight: '700',
  },
  searchInput: {
    backgroundColor: '#FFFFFF',
    borderColor: '#D7C7B4',
    borderRadius: 18,
    borderWidth: 1,
    color: '#102A43',
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  fieldBlock: {
    gap: 8,
  },
  suggestionsList: {
    maxHeight: 190,
  },
  suggestionRow: {
    borderBottomColor: '#E7DCCB',
    borderBottomWidth: 1,
    gap: 2,
    paddingVertical: 12,
  },
  suggestionMain: {
    color: '#102A43',
    fontSize: 15,
    fontWeight: '700',
  },
  suggestionSecondary: {
    color: '#52606D',
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
  summaryCard: {
    backgroundColor: 'rgba(255, 249, 241, 0.95)',
    borderRadius: 28,
    gap: 16,
    padding: 18,
  },
  summaryHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  summaryEyebrow: {
    color: '#C76D4D',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  summaryTitle: {
    color: '#102A43',
    fontSize: 22,
    fontWeight: '800',
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
  emptyHint: {
    color: '#52606D',
    lineHeight: 20,
  },
  fallbackText: {
    color: '#8B2E14',
    fontWeight: '600',
  },
  infoText: {
    color: '#52606D',
    lineHeight: 20,
  },
  inlineStatus: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  inlineStatusText: {
    color: '#102A43',
    fontWeight: '600',
  },
  startButton: {
    alignItems: 'center',
    backgroundColor: '#2B6E52',
    borderRadius: 20,
    justifyContent: 'center',
    minHeight: 52,
  },
  startButtonDisabled: {
    backgroundColor: '#9FB5AB',
  },
  startButtonText: {
    color: '#FFF9F1',
    fontSize: 16,
    fontWeight: '800',
  },
  recoveryOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    padding: 16,
    paddingBottom: 28,
  },
  recoveryCard: {
    backgroundColor: 'rgba(255, 249, 241, 0.95)',
    borderRadius: 24,
    gap: 12,
    padding: 18,
  },
  recoveryTitle: {
    color: '#102A43',
    fontSize: 18,
    fontWeight: '800',
  },
  recoveryBody: {
    color: '#52606D',
    lineHeight: 20,
  },
  retryButton: {
    alignItems: 'center',
    borderColor: '#C76D4D',
    borderRadius: 20,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
  },
  retryButtonText: {
    color: '#8B2E14',
    fontSize: 15,
    fontWeight: '800',
  },
});
