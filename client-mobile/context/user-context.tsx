import { createContext, PropsWithChildren, useContext, useMemo, useState } from 'react';

type UserContextValue = {
  userId: number;
  displayName: string;
  setDisplayName: (value: string) => void;
  tripVersion: number;
  notifyTripSaved: () => void;
};

const DEFAULT_USER_ID = 1;
const DEFAULT_DISPLAY_NAME = 'Campus Rider';

const UserContext = createContext<UserContextValue | null>(null);

export function UserProvider({ children }: PropsWithChildren) {
  const [displayName, setDisplayNameState] = useState(DEFAULT_DISPLAY_NAME);
  const [tripVersion, setTripVersion] = useState(0);

  const value = useMemo<UserContextValue>(
    () => ({
      userId: DEFAULT_USER_ID,
      displayName,
      setDisplayName: (value: string) => {
        const nextValue = value.trim();
        setDisplayNameState(nextValue || DEFAULT_DISPLAY_NAME);
      },
      tripVersion,
      notifyTripSaved: () => setTripVersion((current) => current + 1),
    }),
    [displayName, tripVersion]
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
