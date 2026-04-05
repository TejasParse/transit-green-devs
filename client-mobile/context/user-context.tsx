import {
  createContext,
  PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { fetchProfiles } from '@/lib/api';
import { DemoProfile } from '@/types/trips';

type UserContextValue = {
  userId: number;
  displayName: string;
  setDisplayName: (value: string) => void;
  profiles: DemoProfile[];
  activeProfile: DemoProfile | null;
  isProfilesLoading: boolean;
  switchUser: (nextUserId: number) => void;
  tripVersion: number;
  notifyTripSaved: () => void;
  refreshProfiles: () => Promise<void>;
};

const DEFAULT_USER_ID = 1;
const DEFAULT_DISPLAY_NAME = 'Campus Rider';
const FALLBACK_PROFILES: DemoProfile[] = [
  {
    id: 1,
    displayName: DEFAULT_DISPLAY_NAME,
    email: 'campus.rider@example.com',
    carId: 1,
    hasCar: true,
    totalPoints: 0,
  },
];

const UserContext = createContext<UserContextValue | null>(null);

export function UserProvider({ children }: PropsWithChildren) {
  const [profiles, setProfiles] = useState<DemoProfile[]>(FALLBACK_PROFILES);
  const [userId, setUserId] = useState(DEFAULT_USER_ID);
  const [displayName, setDisplayNameState] = useState(DEFAULT_DISPLAY_NAME);
  const [isProfilesLoading, setIsProfilesLoading] = useState(true);
  const [tripVersion, setTripVersion] = useState(0);

  useEffect(() => {
    let isMounted = true;

    async function loadProfiles() {
      setIsProfilesLoading(true);

      try {
        const nextProfiles = await fetchProfiles();

        if (!isMounted || nextProfiles.length === 0) {
          return;
        }

        setProfiles(nextProfiles);
        setUserId((currentUserId) =>
          nextProfiles.some((profile) => profile.id === currentUserId) ? currentUserId : nextProfiles[0].id
        );
      } catch {
        if (!isMounted) {
          return;
        }

        setProfiles(FALLBACK_PROFILES);
      } finally {
        if (isMounted) {
          setIsProfilesLoading(false);
        }
      }
    }

    void loadProfiles();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const nextActiveProfile = profiles.find((profile) => profile.id === userId);

    if (nextActiveProfile) {
      setDisplayNameState(nextActiveProfile.displayName || DEFAULT_DISPLAY_NAME);
    }
  }, [profiles, userId]);

  const activeProfile = profiles.find((profile) => profile.id === userId) ?? null;

  const value = useMemo<UserContextValue>(
    () => ({
      userId,
      displayName,
      setDisplayName: (value: string) => {
        const nextValue = value.trim();
        const resolvedValue = nextValue || DEFAULT_DISPLAY_NAME;
        setDisplayNameState(resolvedValue);
        setProfiles((currentProfiles) =>
          currentProfiles.map((profile) =>
            profile.id === userId ? { ...profile, displayName: resolvedValue } : profile
          )
        );
      },
      profiles,
      activeProfile,
      isProfilesLoading,
      switchUser: (nextUserId: number) => {
        setUserId(nextUserId);
      },
      tripVersion,
      notifyTripSaved: () => setTripVersion((current) => current + 1),
      refreshProfiles: async () => {
        try {
          const nextProfiles = await fetchProfiles();

          if (nextProfiles.length > 0) {
            setProfiles(nextProfiles);
          }
        } catch {
          // Keep the current demo profiles when the API is unavailable.
        }
      },
    }),
    [activeProfile, displayName, isProfilesLoading, profiles, tripVersion, userId]
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
