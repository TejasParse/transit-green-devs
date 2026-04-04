import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import type { Coordinate } from '@/types/app';

type RouteMapProps = {
  origin: Coordinate;
  destination?: Coordinate | null;
  routePath?: Coordinate[];
  currentPosition?: Coordinate | null;
  onOriginSelect?: (coordinate: Coordinate) => void;
  isTripActive?: boolean;
};

export function RouteMap({ routePath }: RouteMapProps) {
  return (
    <View style={styles.placeholder}>
      <ThemedText type="subtitle">Map Preview</ThemedText>
      <ThemedText>Open the app on iOS or Android to view the interactive map and route playback.</ThemedText>
      {routePath?.length ? (
        <ThemedText style={styles.caption}>
          {`${routePath.length} route points ready for the native map renderer.`}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    alignItems: 'center',
    backgroundColor: '#F4EFE6',
    borderRadius: 24,
    gap: 8,
    justifyContent: 'center',
    minHeight: 300,
    padding: 24,
  },
  caption: {
    color: '#667085',
  },
});
