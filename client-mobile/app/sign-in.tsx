import { Redirect } from 'expo-router';
import * as AuthSession from 'expo-auth-session';
import Constants from 'expo-constants';
import React, { useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { useUserProfile } from '@/context/user-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthenticatedUser } from '@/types/profile';

WebBrowser.maybeCompleteAuthSession();

type ExpoConstantsShape = {
  expoConfig?: {
    extra?: {
      auth0Domain?: string;
      auth0ClientId?: string;
      auth0Audience?: string;
      auth0Connection?: string;
    };
    scheme?: string;
  } | null;
};

const constants = Constants as unknown as ExpoConstantsShape;
const auth0Domain = constants.expoConfig?.extra?.auth0Domain?.trim() ?? '';
const auth0ClientId = constants.expoConfig?.extra?.auth0ClientId?.trim() ?? '';
const auth0Audience = constants.expoConfig?.extra?.auth0Audience?.trim() ?? '';
const auth0Connection = constants.expoConfig?.extra?.auth0Connection?.trim() ?? '';
const appScheme = constants.expoConfig?.scheme?.trim() ?? 'clientmobile';

function getMissingConfigMessage() {
  const missingKeys = [
    !auth0Domain ? 'EXPO_PUBLIC_AUTH0_DOMAIN' : null,
    !auth0ClientId ? 'EXPO_PUBLIC_AUTH0_CLIENT_ID' : null,
  ].filter(Boolean);

  if (missingKeys.length === 0) {
    return null;
  }

  return `Missing Auth0 config: ${missingKeys.join(', ')}`;
}

export default function SignInScreen() {
  const colorScheme = useColorScheme();
  const { completeAuthSession, isAuthenticated, isAuthLoading, isProfileReady } = useUserProfile();
  const [pendingUser, setPendingUser] = useState<AuthenticatedUser | null>(null);
  const [profileDraftName, setProfileDraftName] = useState('');
  const [profileDraftAge, setProfileDraftAge] = useState('');
  const [profileDraftGender, setProfileDraftGender] = useState('');
  const [profileDraftLicenceNo, setProfileDraftLicenceNo] = useState('');
  const [profileCompletionError, setProfileCompletionError] = useState<string | null>(null);
  const palette =
    colorScheme === 'dark'
      ? {
          background: '#0D1511',
          card: '#14211A',
          border: '#2D4136',
          text: '#EAF5EE',
          muted: '#A2B6A8',
          accent: '#20744A',
          accentAlt: '#D29A43',
        }
      : {
          background: '#EFF4EE',
          card: '#FFFFFF',
          border: '#D5E0D4',
          text: '#173126',
          muted: '#5C7265',
          accent: '#20744A',
          accentAlt: '#BE7B1C',
        };

  const redirectUri = AuthSession.makeRedirectUri({
    scheme: appScheme,
    path: 'sign-in',
  });
  const discovery = AuthSession.useAutoDiscovery(`https://${auth0Domain}`);
  const [request, , promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: auth0ClientId || 'missing-auth0-client-id',
      redirectUri,
      responseType: AuthSession.ResponseType.Code,
      scopes: ['openid', 'profile', 'email'],
      usePKCE: true,
      extraParams: {
        ...(auth0Audience ? { audience: auth0Audience } : {}),
        ...(auth0Connection ? { connection: auth0Connection } : {}),
      },
    },
    discovery
  );

  const missingConfigMessage = getMissingConfigMessage();

  if (isAuthLoading) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
        <View style={styles.centered}>
          <ActivityIndicator color={palette.accent} size="large" />
          <ThemedText style={{ color: palette.text }}>Loading authentication…</ThemedText>
        </View>
      </SafeAreaView>
    );
  }

  if (isAuthenticated && isProfileReady) {
    return <Redirect href="/(tabs)" />;
  }

  async function handleSignIn() {
    if (!request || !discovery) {
      return;
    }

    const authResponse = await promptAsync();

    if (authResponse.type !== 'success' || !authResponse.params.code) {
      return;
    }

    const tokenResponse = await AuthSession.exchangeCodeAsync(
      {
        clientId: auth0ClientId,
        code: authResponse.params.code,
        redirectUri,
        extraParams: {
          code_verifier: request.codeVerifier ?? '',
        },
      },
      discovery
    );

    const userInfoResponse = await fetch(`${discovery.userInfoEndpoint}`, {
      headers: {
        Authorization: `Bearer ${tokenResponse.accessToken}`,
      },
    });

    if (!userInfoResponse.ok) {
      throw new Error('Unable to load the authenticated Auth0 profile.');
    }

    const userInfo = (await userInfoResponse.json()) as {
      email?: string;
      name?: string;
      picture?: string;
      sub: string;
    };

    const nextUser = {
      email: userInfo.email ?? '',
      name: userInfo.name ?? userInfo.email ?? 'Signed-in user',
      picture: userInfo.picture ?? null,
      sub: userInfo.sub,
    };

    const sessionResult = await completeAuthSession(nextUser);

    if (!sessionResult.ok) {
      setPendingUser(nextUser);
      setProfileDraftName(sessionResult.suggestedDisplayName);
      setProfileCompletionError(
        `Finish your profile to continue. Missing: ${sessionResult.missingFields.join(', ')}.`
      );
    }
  }

  async function handleCompleteProfile() {
    if (!pendingUser) {
      return;
    }

    setProfileCompletionError(null);

    const parsedAge = Number(profileDraftAge);
    const sessionResult = await completeAuthSession(pendingUser, {
      displayName: profileDraftName,
      age: Number.isInteger(parsedAge) ? parsedAge : null,
      gender: profileDraftGender,
      licenceNo: profileDraftLicenceNo || null,
    });

    if (!sessionResult.ok) {
      setProfileCompletionError(
        `Profile is still incomplete. Missing: ${sessionResult.missingFields.join(', ')}.`
      );
      return;
    }

    setPendingUser(null);
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
        <ThemedText type="title" style={{ color: palette.text }}>
          Sign in
        </ThemedText>
        <ThemedText style={{ color: palette.muted }}>
          Continue with Auth0 before entering the app. If this is your first time, complete the
          account profile once and the app will use it everywhere.
        </ThemedText>

        {missingConfigMessage ? (
          <View style={[styles.messageCard, { borderColor: palette.border }]}>
            <ThemedText style={{ color: palette.text }}>{missingConfigMessage}</ThemedText>
            <ThemedText style={{ color: palette.muted }}>
              Add the Auth0 values to `client-mobile/.env` first.
            </ThemedText>
          </View>
        ) : (
          <View style={[styles.messageCard, { borderColor: palette.border }]}>
            <ThemedText style={{ color: palette.text }}>
              Auth0 domain: {auth0Domain}
            </ThemedText>
            <ThemedText style={{ color: palette.muted }}>
              {auth0Connection
                ? `Preferred SSO connection: ${auth0Connection}`
                : 'Universal Login will show the connections enabled in your Auth0 tenant.'}
            </ThemedText>
          </View>
        )}

        <Pressable
          disabled={Boolean(missingConfigMessage) || !request || !discovery}
          onPress={() => {
            void handleSignIn();
          }}
          style={[
            styles.signInButton,
            {
              backgroundColor:
                missingConfigMessage || !request || !discovery ? '#8FA99A' : palette.accent,
            },
          ]}>
          <ThemedText style={styles.signInButtonText}>Continue with Auth0</ThemedText>
        </Pressable>

        {pendingUser ? (
          <View style={[styles.messageCard, { borderColor: palette.border, gap: 12 }]}>
            <ThemedText style={{ color: palette.text }}>
              Finish your profile details
            </ThemedText>
            <TextInput
              value={profileDraftName}
              onChangeText={setProfileDraftName}
              placeholder="Display name"
              placeholderTextColor={palette.muted}
              style={[
                styles.input,
                { color: palette.text, borderColor: palette.border, backgroundColor: palette.background },
              ]}
            />
            <TextInput
              value={profileDraftAge}
              onChangeText={setProfileDraftAge}
              placeholder="Age"
              placeholderTextColor={palette.muted}
              keyboardType="number-pad"
              style={[
                styles.input,
                { color: palette.text, borderColor: palette.border, backgroundColor: palette.background },
              ]}
            />
            <TextInput
              value={profileDraftGender}
              onChangeText={setProfileDraftGender}
              placeholder="Gender"
              placeholderTextColor={palette.muted}
              style={[
                styles.input,
                { color: palette.text, borderColor: palette.border, backgroundColor: palette.background },
              ]}
            />
            <TextInput
              value={profileDraftLicenceNo}
              onChangeText={setProfileDraftLicenceNo}
              placeholder="Licence number (optional)"
              placeholderTextColor={palette.muted}
              style={[
                styles.input,
                { color: palette.text, borderColor: palette.border, backgroundColor: palette.background },
              ]}
            />
            {profileCompletionError ? (
              <ThemedText style={{ color: palette.accentAlt }}>{profileCompletionError}</ThemedText>
            ) : null}
            <Pressable
              onPress={() => {
                void handleCompleteProfile();
              }}
              style={[styles.signInButton, { backgroundColor: palette.accentAlt }]}>
              <ThemedText style={styles.signInButtonText}>Save profile</ThemedText>
            </Pressable>
          </View>
        ) : null}

        <ThemedText style={{ color: palette.muted }}>
          Redirect URI: {redirectUri}
        </ThemedText>
        <ThemedText style={{ color: palette.muted }}>
          Add this exact URI to Auth0 Allowed Callback URLs. In Expo Go it will usually be an
          `exp://.../--/sign-in` URL, while in a native build it should use the app scheme.
        </ThemedText>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  card: {
    borderWidth: 1,
    borderRadius: 24,
    gap: 16,
    margin: 18,
    marginTop: 'auto',
    marginBottom: 'auto',
    padding: 20,
  },
  messageCard: {
    borderWidth: 1,
    borderRadius: 16,
    gap: 6,
    padding: 14,
  },
  signInButton: {
    alignItems: 'center',
    borderRadius: 16,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  signInButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
});
