import { PropsWithChildren, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  AppStateStatus,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useUserProfile } from '@/context/user-context';
import {
  acceptCarpoolRequest,
  fetchMyCarpools,
  rejectCarpoolRequest,
} from '@/lib/api';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { CarpoolRequestRecord } from '@/types/trips';

const CARPOOL_NOTIFICATION_POLL_MS = 5000;

type DriverRequestNotification = {
  tripId: number;
  tripTitle: string;
  request: CarpoolRequestRecord;
};

export function CarpoolNotificationProvider({ children }: PropsWithChildren) {
  const colorScheme = useColorScheme();
  const { userId, tripVersion, notifyTripSaved } = useUserProfile();
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const [activeNotification, setActiveNotification] = useState<DriverRequestNotification | null>(null);
  const [isResolvingNotification, setIsResolvingNotification] = useState(false);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const seenRequestIdsRef = useRef<Set<number>>(new Set());
  const queuedRequestIdsRef = useRef<Set<number>>(new Set());
  const notificationQueueRef = useRef<DriverRequestNotification[]>([]);

  const palette =
    colorScheme === 'dark'
      ? {
          backdrop: 'rgba(4, 8, 6, 0.6)',
          card: '#13201A',
          cardSecondary: '#1A2A22',
          border: '#294036',
          text: '#EAF5EE',
          muted: '#A1B4A7',
          accent: '#4DA86D',
          accentAlt: '#D6A44B',
          danger: '#D56B61',
        }
      : {
          backdrop: 'rgba(12, 16, 13, 0.32)',
          card: '#FFFFFF',
          cardSecondary: '#F3F8F1',
          border: '#D7E2D5',
          text: '#173126',
          muted: '#5B7266',
          accent: '#20744A',
          accentAlt: '#D17B1B',
          danger: '#C64537',
        };

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);

    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    seenRequestIdsRef.current = new Set();
    queuedRequestIdsRef.current = new Set();
    notificationQueueRef.current = [];
    setActiveNotification(null);
    setNotificationError(null);
    setIsResolvingNotification(false);
  }, [userId]);

  useEffect(() => {
    if (appState !== 'active') {
      return;
    }

    let isCancelled = false;

    async function pollDriverNotifications() {
      try {
        const myCarpools = await fetchMyCarpools(userId);

        if (isCancelled) {
          return;
        }

        const nextNotifications: DriverRequestNotification[] = [];

        myCarpools.forEach((trip) => {
          if (trip.currentUserRole !== 'driver') {
            return;
          }

          trip.requests
            ?.filter((request) => request.status === 'pending')
            .forEach((request) => {
              if (
                seenRequestIdsRef.current.has(request.id) ||
                queuedRequestIdsRef.current.has(request.id) ||
                activeNotification?.request.id === request.id
              ) {
                return;
              }

              queuedRequestIdsRef.current.add(request.id);
              nextNotifications.push({
                tripId: trip.id,
                tripTitle: trip.routeTitle,
                request,
              });
            });
        });

        if (nextNotifications.length > 0) {
          notificationQueueRef.current.push(...nextNotifications);
          presentNextNotification();
        }
      } catch {
        // Keep the current queue and try again on the next poll.
      }
    }

    void pollDriverNotifications();
    const intervalId = setInterval(() => {
      void pollDriverNotifications();
    }, CARPOOL_NOTIFICATION_POLL_MS);

    return () => {
      isCancelled = true;
      clearInterval(intervalId);
    };
  }, [activeNotification, appState, tripVersion, userId]);

  function presentNextNotification() {
    setActiveNotification((currentNotification) => {
      if (currentNotification) {
        return currentNotification;
      }

      const nextNotification = notificationQueueRef.current.shift() ?? null;

      if (nextNotification) {
        setNotificationError(null);
      }

      return nextNotification;
    });
  }

  function dismissNotification(requestId: number) {
    seenRequestIdsRef.current.add(requestId);
    queuedRequestIdsRef.current.delete(requestId);
    setActiveNotification(null);
    setNotificationError(null);
    setIsResolvingNotification(false);
  }

  async function handleDriverDecision(decision: 'accept' | 'reject') {
    if (!activeNotification) {
      return;
    }

    setIsResolvingNotification(true);
    setNotificationError(null);

    try {
      if (decision === 'accept') {
        await acceptCarpoolRequest(activeNotification.tripId, activeNotification.request.id, userId);
      } else {
        await rejectCarpoolRequest(activeNotification.tripId, activeNotification.request.id, userId);
      }

      dismissNotification(activeNotification.request.id);
      notifyTripSaved();
    } catch (error) {
      setNotificationError(
        error instanceof Error ? error.message : 'The carpool request could not be updated.'
      );
      setIsResolvingNotification(false);
    }
  }

  useEffect(() => {
    if (!activeNotification && notificationQueueRef.current.length > 0) {
      presentNextNotification();
    }
  }, [activeNotification]);

  const riderName = activeNotification?.request.riderName ?? 'A rider';

  return (
    <>
      {children}
      <Modal
        transparent
        animationType="fade"
        visible={activeNotification != null}
        onRequestClose={() => {
          if (activeNotification) {
            dismissNotification(activeNotification.request.id);
          }
        }}>
        <View style={[styles.backdrop, { backgroundColor: palette.backdrop }]}>
          <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <View style={[styles.iconWrap, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
              <ThemedText style={[styles.iconText, { color: palette.accent }]}>CP</ThemedText>
            </View>

            <ThemedText type="subtitle" style={{ color: palette.text }}>
              New Carpool Request
            </ThemedText>
            <ThemedText style={{ color: palette.text }}>
              {riderName} requested to join {activeNotification?.tripTitle ?? 'your carpool'}.
            </ThemedText>
            <ThemedText style={{ color: palette.muted }}>
              This adds about {activeNotification?.request.estimatedAddedMinutes ?? 0} minutes. Do you want
              to accept the ride?
            </ThemedText>

            {notificationError ? (
              <View style={[styles.errorCard, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
                <ThemedText style={{ color: palette.danger }}>{notificationError}</ThemedText>
              </View>
            ) : null}

            <View style={styles.actionRow}>
              <Pressable
                disabled={isResolvingNotification}
                onPress={() =>
                  activeNotification ? dismissNotification(activeNotification.request.id) : undefined
                }
                style={[styles.secondaryButton, { backgroundColor: palette.cardSecondary, borderColor: palette.border }]}>
                <ThemedText style={{ color: palette.text, fontWeight: '700' }}>Later</ThemedText>
              </Pressable>

              <Pressable
                disabled={isResolvingNotification}
                onPress={() => void handleDriverDecision('reject')}
                style={[styles.secondaryButton, { backgroundColor: `${palette.danger}14`, borderColor: `${palette.danger}50` }]}>
                <ThemedText style={{ color: palette.danger, fontWeight: '700' }}>Reject</ThemedText>
              </Pressable>

              <Pressable
                disabled={isResolvingNotification}
                onPress={() => void handleDriverDecision('accept')}
                style={[styles.primaryButton, { backgroundColor: palette.accent }]}>
                {isResolvingNotification ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <ThemedText style={styles.primaryButtonText}>Accept</ThemedText>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    borderRadius: 28,
    borderWidth: 1,
    padding: 20,
    gap: 14,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 18,
    fontWeight: '800',
  },
  errorCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  primaryButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
