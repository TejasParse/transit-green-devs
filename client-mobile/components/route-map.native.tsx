import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import type { Region } from 'react-native-maps';

import { GREATER_PHOENIX_REGION, isWithinPhoenix } from '@/constants/phoenix';
import type { Coordinate } from '@/types/app';

const MIN_LATITUDE_DELTA = 0.003;
const MAX_LATITUDE_DELTA = 1.4;
const MIN_LONGITUDE_DELTA = 0.003;
const MAX_LONGITUDE_DELTA = 1.4;
const ZOOM_FACTOR = 0.5;

type RouteMapProps = {
  origin: Coordinate;
  destination?: Coordinate | null;
  routePath?: Coordinate[];
  currentPosition?: Coordinate | null;
  onOriginSelect?: (coordinate: Coordinate) => void;
  isTripActive?: boolean;
};

export function RouteMap({
  origin,
  destination,
  routePath,
  currentPosition,
  onOriginSelect,
  isTripActive = false,
}: RouteMapProps) {
  const mapRef = useRef<MapView>(null);
  const regionRef = useRef<Region>(GREATER_PHOENIX_REGION);

  useEffect(() => {
    const coordinatesToFit =
      routePath && routePath.length > 1
        ? routePath
        : destination
          ? [origin, destination]
          : [origin];

    if (coordinatesToFit.length > 1) {
      mapRef.current?.fitToCoordinates(coordinatesToFit, {
        animated: true,
        edgePadding: {
          top: 72,
          right: 36,
          bottom: 72,
          left: 36,
        },
      });
    }
  }, [destination, origin, routePath]);

  const zoomMap = (direction: 'in' | 'out') => {
    const currentRegion = regionRef.current;
    const multiplier = direction === 'in' ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;

    mapRef.current?.animateToRegion(
      {
        ...currentRegion,
        latitudeDelta: Math.min(
          MAX_LATITUDE_DELTA,
          Math.max(MIN_LATITUDE_DELTA, currentRegion.latitudeDelta * multiplier)
        ),
        longitudeDelta: Math.min(
          MAX_LONGITUDE_DELTA,
          Math.max(MIN_LONGITUDE_DELTA, currentRegion.longitudeDelta * multiplier)
        ),
      },
      180
    );
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <MapView
        ref={mapRef}
        initialRegion={GREATER_PHOENIX_REGION}
        style={StyleSheet.absoluteFill}
        showsCompass
        showsScale
        onRegionChangeComplete={(region) => {
          regionRef.current = region;
        }}
        onPress={(event) => {
          if (isTripActive || !onOriginSelect) {
            return;
          }

          const coordinate = event.nativeEvent.coordinate;
          if (isWithinPhoenix(coordinate)) {
            onOriginSelect(coordinate);
          }
        }}>
        {routePath && routePath.length > 1 ? (
          <Polyline coordinates={routePath} strokeColor="#2B6E52" strokeWidth={5} />
        ) : null}

        <Marker coordinate={origin} pinColor="#C76D4D" title="Trip start" />

        {destination ? <Marker coordinate={destination} pinColor="#2B6E52" title="Destination" /> : null}

        {currentPosition ? (
          <Marker coordinate={currentPosition} pinColor="#1F3558" title="Simulated car" />
        ) : null}
      </MapView>

      <View pointerEvents="box-none" style={styles.zoomControls}>
        <Pressable onPress={() => zoomMap('in')} style={styles.zoomButton}>
          <Text style={styles.zoomButtonText}>+</Text>
        </Pressable>
        <Pressable onPress={() => zoomMap('out')} style={styles.zoomButton}>
          <Text style={styles.zoomButtonText}>-</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  zoomControls: {
    alignItems: 'center',
    bottom: 28,
    gap: 10,
    position: 'absolute',
    right: 16,
  },
  zoomButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 249, 241, 0.96)',
    borderColor: '#D7C7B4',
    borderRadius: 18,
    borderWidth: 1,
    height: 52,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    width: 52,
  },
  zoomButtonText: {
    color: '#102A43',
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 30,
  },
});
