import * as SecureStore from 'expo-secure-store';
import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';

import { createProfileSession, updateProfile } from '@/lib/api';
import { AppProfile, AuthenticatedUser } from '@/types/profile';

const AUTH_SESSION_STORAGE_KEY = 'auth0-session-v2';

type StoredSession = {
  authenticatedUser: AuthenticatedUser | null;
  appProfile: AppProfile | null;
};

type UserContextValue = {
  userId: number;
  displayName: string;
  appProfile: AppProfile | null;
  tripVersion: number;
  notifyTripSaved: () => void;
  authenticatedUser: AuthenticatedUser | null;
  isAuthLoading: boolean;
  isAuthenticated: boolean;
  isProfileReady: boolean;
  completeAuthSession: (
    user: AuthenticatedUser,
    details?: {
      displayName?: string;
      age?: number | null;
      gender?: string | null;
      licenceNo?: string | null;
    }
  ) => Promise<
    | {
        ok: true;
        profile: AppProfile;
      }
    | {
        ok: false;
        missingFields: string[];
        suggestedDisplayName: string;
      }
  >;
  saveProfile: (details: {
    displayName?: string;
    age?: number;
    gender?: string;
    licenceNo?: string | null;
  }) => Promise<AppProfile>;
  signOut: () => Promise<void>;
};

async function readStoredSession() {
  try {
    const storedValue = await SecureStore.getItemAsync(AUTH_SESSION_STORAGE_KEY);

    if (!storedValue) {
      return null;
    }

    return JSON.parse(storedValue) as StoredSession;
  } catch {
    return null;
  }
}

async function writeStoredSession(session: StoredSession) {
  await SecureStore.setItemAsync(AUTH_SESSION_STORAGE_KEY, JSON.stringify(session));
}

const UserContext = createContext<UserContextValue | null>(null);

export function UserProvider({ children }: PropsWithChildren) {
  const [tripVersion, setTripVersion] = useState(0);
  const [authenticatedUser, setAuthenticatedUser] = useState<AuthenticatedUser | null>(null);
  const [appProfile, setAppProfile] = useState<AppProfile | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function hydrateAuthSession() {
      const storedSession = await readStoredSession();

      if (!isMounted) {
        return;
      }

      setAuthenticatedUser(storedSession?.authenticatedUser ?? null);
      setAppProfile(storedSession?.appProfile ?? null);
      setIsAuthLoading(false);
    }

    void hydrateAuthSession();

    return () => {
      isMounted = false;
    };
  }, []);

  const displayName = appProfile?.displayName ?? authenticatedUser?.name ?? '';

  const value = useMemo<UserContextValue>(
    () => ({
      userId: appProfile?.userId ?? 0,
      displayName,
      appProfile,
      tripVersion,
      notifyTripSaved: () => setTripVersion((current) => current + 1),
      authenticatedUser,
      isAuthLoading,
      isAuthenticated: Boolean(authenticatedUser),
      isProfileReady: Boolean(appProfile),
      completeAuthSession: async (user, details) => {
        const sessionResult = await createProfileSession({
          authProvider: 'auth0',
          authSubject: user.sub,
          email: user.email,
          displayName: details?.displayName ?? user.name,
          pictureUrl: user.picture ?? null,
          age: details?.age ?? null,
          gender: details?.gender ?? null,
          licenceNo: details?.licenceNo ?? null,
        });

        setAuthenticatedUser(user);

        if (sessionResult.profile) {
          setAppProfile(sessionResult.profile);
        }

        await writeStoredSession({
          authenticatedUser: user,
          appProfile: sessionResult.profile ?? null,
        });

        if (sessionResult.needsProfileCompletion || !sessionResult.profile) {
          return {
            ok: false,
            missingFields: sessionResult.missingFields ?? [],
            suggestedDisplayName:
              sessionResult.suggestedDisplayName ?? user.name ?? user.email.split('@')[0],
          };
        }

        return {
          ok: true,
          profile: sessionResult.profile,
        };
      },
      saveProfile: async (details) => {
        if (!appProfile) {
          throw new Error('No profile is linked to the current session.');
        }

        const nextProfile = await updateProfile({
          userId: appProfile.userId,
          ...details,
        });

        setAppProfile(nextProfile);
        await writeStoredSession({
          authenticatedUser,
          appProfile: nextProfile,
        });

        return nextProfile;
      },
      signOut: async () => {
        await SecureStore.deleteItemAsync(AUTH_SESSION_STORAGE_KEY);
        setAuthenticatedUser(null);
        setAppProfile(null);
      },
    }),
    [appProfile, authenticatedUser, displayName, isAuthLoading, tripVersion]
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
