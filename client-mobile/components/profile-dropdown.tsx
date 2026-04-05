import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { useUserProfile } from '@/context/user-context';
import { ThemedText } from '@/components/themed-text';

type ProfileDropdownPalette = {
  card: string;
  cardSecondary?: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
};

type ProfileDropdownProps = {
  palette: ProfileDropdownPalette;
  label?: string;
  compact?: boolean;
};

export function ProfileDropdown({
  palette,
  label = 'Signed In As',
  compact = false,
}: ProfileDropdownProps) {
  const { activeProfile, isProfilesLoading, profiles, switchUser, userId } = useUserProfile();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Pressable
        onPress={() => setIsOpen(true)}
        style={[
          styles.trigger,
          compact ? styles.triggerCompact : null,
          {
            backgroundColor: palette.card,
            borderColor: palette.border,
          },
        ]}>
        <View style={styles.triggerTextBlock}>
          <ThemedText style={[styles.triggerLabel, { color: palette.muted }]}>{label}</ThemedText>
          <ThemedText
            style={[styles.triggerValue, compact ? styles.triggerValueCompact : null, { color: palette.text }]}>
            {isProfilesLoading ? 'Loading profiles...' : activeProfile?.displayName ?? 'Choose a profile'}
          </ThemedText>
        </View>
        {isProfilesLoading ? (
          <ActivityIndicator color={palette.accent} size="small" />
        ) : (
          <MaterialIcons name="arrow-drop-down" size={24} color={palette.text} />
        )}
      </Pressable>

      <Modal transparent animationType="fade" visible={isOpen} onRequestClose={() => setIsOpen(false)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setIsOpen(false)} />
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: palette.card,
                borderColor: palette.border,
              },
            ]}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <ThemedText type="subtitle" style={{ color: palette.text }}>
                  Choose Profile
                </ThemedText>
                <ThemedText style={{ color: palette.muted }}>
                  Pick the current demo profile to use across the app.
                </ThemedText>
              </View>
              <Pressable onPress={() => setIsOpen(false)}>
                <MaterialIcons name="close" size={22} color={palette.text} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.optionsList} showsVerticalScrollIndicator={false}>
              {profiles.map((profile) => {
                const isSelected = profile.id === userId;

                return (
                  <Pressable
                    key={profile.id}
                    onPress={() => {
                      switchUser(profile.id);
                      setIsOpen(false);
                    }}
                    style={[
                      styles.optionRow,
                      {
                        backgroundColor: isSelected
                          ? palette.accent
                          : palette.cardSecondary ?? palette.card,
                        borderColor: isSelected ? palette.accent : palette.border,
                      },
                    ]}>
                    <View style={styles.optionCopy}>
                      <ThemedText style={{ color: isSelected ? '#FFFFFF' : palette.text, fontWeight: '700' }}>
                        {profile.displayName}
                      </ThemedText>
                      <ThemedText style={{ color: isSelected ? '#FFFFFF' : palette.muted }}>
                        {profile.hasCar ? 'Can host carpools' : 'Rider-only profile'}
                      </ThemedText>
                    </View>
                    {isSelected ? (
                      <MaterialIcons name="check-circle" size={20} color="#FFFFFF" />
                    ) : (
                      <MaterialIcons name="radio-button-unchecked" size={20} color={palette.muted} />
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  triggerCompact: {
    paddingVertical: 9,
  },
  triggerTextBlock: {
    flex: 1,
    gap: 1,
  },
  triggerLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  triggerValue: {
    fontSize: 15,
    fontWeight: '700',
  },
  triggerValueCompact: {
    fontSize: 14,
  },
  modalBackdrop: {
    backgroundColor: 'rgba(4, 8, 6, 0.5)',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalCard: {
    borderRadius: 24,
    borderWidth: 1,
    maxHeight: '72%',
    padding: 18,
    gap: 14,
  },
  modalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  optionsList: {
    gap: 10,
  },
  optionRow: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  optionCopy: {
    flex: 1,
    gap: 2,
  },
});
