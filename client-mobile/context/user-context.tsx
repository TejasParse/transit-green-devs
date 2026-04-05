import { createContext, PropsWithChildren, useContext, useMemo, useState } from 'react';

import { Coordinates, RouteKind } from '@/types/trips';

export type DemoUser = {
  id: number;
  label: string;
  defaultDisplayName: string;
};

export type CommuteIntent = {
  originLabel: string;
  destinationLabel: string;
  origin: Coordinates;
  destination: Coordinates;
  pathPoints: Coordinates[];
  distanceMeters: number;
  durationSeconds: number;
  routeKind: RouteKind;
  updatedAt: string;
};

type UserContextValue = {
  userId: number;
  availableUsers: DemoUser[];
  setActiveUser: (userId: number) => void;
  displayName: string;
  setDisplayName: (value: string) => void;
  commuteIntent: CommuteIntent | null;
  setCommuteIntent: (value: CommuteIntent | null) => void;
  tripVersion: number;
  notifyTripSaved: () => void;
};

const DEMO_USERS: DemoUser[] = [
  {
    id: 1,
    label: 'User 1',
    defaultDisplayName: 'Campus Rider',
  },
  {
    id: 2,
    label: 'User 2',
    defaultDisplayName: 'Bike Commuter',
  },
  {
    id: 3,
    label: 'User 3',
    defaultDisplayName: 'Transit Fan',
  },
  {
    id: 4,
    label: 'User 4',
    defaultDisplayName: 'Community Driver',
  },
];

const DEFAULT_USER_ID = DEMO_USERS[0].id;
const DEFAULT_DISPLAY_NAME = DEMO_USERS[0].defaultDisplayName;

const UserContext = createContext<UserContextValue | null>(null);

export function UserProvider({ children }: PropsWithChildren) {
  const [activeUserId, setActiveUserId] = useState(DEFAULT_USER_ID);
  const [displayNamesByUserId, setDisplayNamesByUserId] = useState<Record<number, string>>(() =>
    Object.fromEntries(DEMO_USERS.map((user) => [user.id, user.defaultDisplayName]))
  );
  const [commuteIntent, setCommuteIntent] = useState<CommuteIntent | null>(null);
  const [tripVersion, setTripVersion] = useState(0);

  const activeUser = DEMO_USERS.find((user) => user.id === activeUserId) ?? DEMO_USERS[0];
  const displayName = displayNamesByUserId[activeUserId] ?? activeUser.defaultDisplayName;

  const value = useMemo<UserContextValue>(
    () => ({
      userId: activeUserId,
      availableUsers: DEMO_USERS,
      setActiveUser: (nextUserId: number) => {
        if (!DEMO_USERS.some((user) => user.id === nextUserId)) {
          return;
        }

        setActiveUserId(nextUserId);
        setCommuteIntent(null);
        setTripVersion((current) => current + 1);
      },
      displayName,
      setDisplayName: (value: string) => {
        const nextValue = value.trim();
        const fallbackName =
          DEMO_USERS.find((user) => user.id === activeUserId)?.defaultDisplayName ?? DEFAULT_DISPLAY_NAME;

        setDisplayNamesByUserId((current) => ({
          ...current,
          [activeUserId]: nextValue || fallbackName,
        }));
      },
      commuteIntent,
      setCommuteIntent,
      tripVersion,
      notifyTripSaved: () => setTripVersion((current) => current + 1),
    }),
    [activeUserId, commuteIntent, displayName, tripVersion]
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUserProfile() {
  const context = useContext(UserContext);

  if (!context) {
    throw new Error('useUserProfile must be used inside UserProvider.');
  }

  return context;
}
