import { createContext, PropsWithChildren, useContext, useMemo, useState } from 'react';

export type DemoUserProfile = {
  userId: number;
  displayName: string;
  subtitle: string;
  canDrive: boolean;
};

type UserContextValue = {
  userId: number;
  displayName: string;
  setDisplayName: (value: string) => void;
  activeProfile: DemoUserProfile;
  availableProfiles: DemoUserProfile[];
  loginWithUsername: (userName: string) => { ok: true } | { ok: false; error: string };
  tripVersion: number;
  notifyTripSaved: () => void;
};

const DEFAULT_USER_ID = 1;
const DEMO_USER_PROFILES: DemoUserProfile[] = [
  {
    userId: 1,
    displayName: 'Campus Rider',
    subtitle: 'General rider with a linked car for publishing carpools.',
    canDrive: true,
  },
  {
    userId: 2,
    displayName: 'Bike Commuter',
    subtitle: 'Rider-first profile for joining shared trips.',
    canDrive: false,
  },
  {
    userId: 3,
    displayName: 'Transit Fan',
    subtitle: 'Transit-focused profile for comparing shared trips.',
    canDrive: false,
  },
  {
    userId: 4,
    displayName: 'Community Driver',
    subtitle: 'Driver profile with a car and room for passengers.',
    canDrive: true,
  },
];

function getDefaultDisplayName(userId: number) {
  return (
    DEMO_USER_PROFILES.find((profile) => profile.userId === userId)?.displayName ??
    DEMO_USER_PROFILES[0].displayName
  );
}

const UserContext = createContext<UserContextValue | null>(null);

export function UserProvider({ children }: PropsWithChildren) {
  const [activeUserId, setActiveUserId] = useState(DEFAULT_USER_ID);
  const [displayNamesByUserId, setDisplayNamesByUserId] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      DEMO_USER_PROFILES.map((profile) => [profile.userId, profile.displayName])
    ) as Record<number, string>
  );
  const [tripVersion, setTripVersion] = useState(0);

  const availableProfiles = useMemo<DemoUserProfile[]>(
    () =>
      DEMO_USER_PROFILES.map((profile) => ({
        ...profile,
        displayName: displayNamesByUserId[profile.userId] ?? profile.displayName,
      })),
    [displayNamesByUserId]
  );
  const activeProfile =
    availableProfiles.find((profile) => profile.userId === activeUserId) ?? availableProfiles[0];
  const displayName = activeProfile.displayName;

  const value = useMemo<UserContextValue>(
    () => ({
      userId: activeProfile.userId,
      displayName,
      setDisplayName: (value: string) => {
        const nextValue = value.trim();
        setDisplayNamesByUserId((current) => ({
          ...current,
          [activeProfile.userId]: nextValue || getDefaultDisplayName(activeProfile.userId),
        }));
      },
      activeProfile,
      availableProfiles,
      loginWithUsername: (userName: string) => {
        const normalizedInput = userName.trim().toLowerCase();

        if (!normalizedInput) {
          return { ok: false, error: 'Enter a username to switch profiles.' };
        }

        const matchedProfile = availableProfiles.find(
          (profile) => profile.displayName.trim().toLowerCase() === normalizedInput
        );

        if (!matchedProfile) {
          return {
            ok: false,
            error: `No profile matches "${userName.trim()}". Try one of the seeded usernames below.`,
          };
        }

        if (matchedProfile.userId !== activeProfile.userId) {
          setActiveUserId(matchedProfile.userId);
          setTripVersion((current) => current + 1);
        }

        return { ok: true };
      },
      tripVersion,
      notifyTripSaved: () => setTripVersion((current) => current + 1),
    }),
    [activeProfile, availableProfiles, displayName, tripVersion]
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
