import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useEffect, useRef } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

type RideGreenLoadingScreenProps = {
  onComplete: () => void;
};

type LeafSpec = {
  id: string;
  positionX: number;
  positionY: number;
  size: number;
  rotate: number;
  color: string;
  opacity: number;
  flyX: number;
  flyY: number;
  delay: number;
  iconName: 'leaf' | 'leaf-maple';
};

const LEAF_COLORS = ['#58A86A', '#7CCF7C', '#7BBD57', '#84B96B', '#4C9366', '#8FCB6D', '#72B86E', '#A7C95A', '#5AA964'];
const LEAF_ICONS: ('leaf' | 'leaf-maple')[] = ['leaf', 'leaf', 'leaf', 'leaf-maple'];
const LEAF_COUNT = 84;
const TITLE_HALO_SIZE = 236;
const TITLE_SAFE_PADDING = 6;

const AnimatedLeafIcon = Animated.createAnimatedComponent(MaterialCommunityIcons);

function createSeededRandom(seed: number) {
  let current = seed;

  return () => {
    current = (current * 1664525 + 1013904223) >>> 0;
    return current / 4294967296;
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getProtectedTitleRadius(size: number, scaleFactor: number) {
  const haloRadius = (TITLE_HALO_SIZE * scaleFactor) / 2;
  const leafRadius = size * scaleFactor * 0.42;

  return haloRadius + leafRadius + TITLE_SAFE_PADDING * scaleFactor;
}

function isInsideTitleSafeZone(
  positionX: number,
  positionY: number,
  size: number,
  width: number,
  height: number,
  scaleFactor: number
) {
  const protectedRadius = getProtectedTitleRadius(size, scaleFactor);

  return Math.hypot(positionX * width, positionY * height) < protectedRadius;
}

function pushOutsideTitleSafeZone(
  positionX: number,
  positionY: number,
  size: number,
  width: number,
  height: number,
  scaleFactor: number
) {
  if (!isInsideTitleSafeZone(positionX, positionY, size, width, height, scaleFactor)) {
    return { positionX, positionY };
  }

  const protectedRadius = getProtectedTitleRadius(size, scaleFactor);
  const angle = Math.atan2(positionY || 0.0001, positionX || 0.0001);

  return {
    positionX: clamp((Math.cos(angle) * protectedRadius * 1.04) / width, -0.56, 0.56),
    positionY: clamp((Math.sin(angle) * protectedRadius * 1.04) / height, -0.5, 0.5),
  };
}

function createLeafSpecs(width: number, height: number, scaleFactor: number): LeafSpec[] {
  const random = createSeededRandom(8421);

  return Array.from({ length: LEAF_COUNT }, (_, index) => {
    const size = 18 + random() * 18;
    let positionX = 0;
    let positionY = 0;
    let attempts = 0;

    do {
      positionX = random() * 1.1 - 0.55;
      positionY = random() * 1.04 - 0.52;
      attempts += 1;
    } while (isInsideTitleSafeZone(positionX, positionY, size, width, height, scaleFactor) && attempts < 24);

    positionX = clamp(positionX, -0.56, 0.56);
    positionY = clamp(positionY, -0.5, 0.5);
    ({ positionX, positionY } = pushOutsideTitleSafeZone(
      positionX,
      positionY,
      size,
      width,
      height,
      scaleFactor
    ));

    const directionX = Math.abs(positionX) < 0.02 ? (random() > 0.5 ? 0.16 : -0.16) : positionX;
    const directionY = Math.abs(positionY) < 0.02 ? (random() > 0.5 ? 0.16 : -0.16) : positionY;
    const directionLength = Math.hypot(directionX, directionY) || 1;
    const flyDistance = 260 + random() * 220;

    return {
      id: `leaf-${index}`,
      positionX,
      positionY,
      size,
      rotate: -80 + random() * 160,
      color: LEAF_COLORS[Math.floor(random() * LEAF_COLORS.length)],
      opacity: 0.58 + random() * 0.34,
      flyX: (directionX / directionLength) * flyDistance,
      flyY: (directionY / directionLength) * flyDistance,
      delay: random() * 260,
      iconName: LEAF_ICONS[Math.floor(random() * LEAF_ICONS.length)],
    };
  });
}

function AnimatedLeaf({
  spec,
  entryProgress,
  exitProgress,
  width,
  height,
  scaleFactor,
}: {
  spec: LeafSpec;
  entryProgress: SharedValue<number>;
  exitProgress: SharedValue<number>;
  width: number;
  height: number;
  scaleFactor: number;
}) {
  const animatedStyle = useAnimatedStyle(() => {
    const entry = interpolate(entryProgress.value, [0, 1], [0, 1], Extrapolation.CLAMP);
    const staggerStart = Math.min(spec.delay / 920, 0.78);
    const exit = interpolate(exitProgress.value, [staggerStart, 1], [0, 1], Extrapolation.CLAMP);
    const exitTranslationProgress = interpolate(
      exit,
      [0, 0.15, 1],
      [0, 0.08, 1],
      Extrapolation.CLAMP
    );
    const baseX = spec.positionX * width;
    const baseY = spec.positionY * height;

    return {
      opacity: spec.opacity * entry * (1 - exit * 0.92),
      transform: [
        {
          translateX:
            baseX +
            interpolate(entryProgress.value, [0, 1], [12, 0], Extrapolation.CLAMP) +
            spec.flyX * scaleFactor * exitTranslationProgress,
        },
        {
          translateY:
            baseY +
            interpolate(entryProgress.value, [0, 1], [18, 0], Extrapolation.CLAMP) +
            spec.flyY * scaleFactor * exitTranslationProgress,
        },
        { rotate: `${spec.rotate + exit * (spec.flyX >= 0 ? 18 : -18)}deg` },
        {
          scale:
            interpolate(entryProgress.value, [0, 1], [0.55, 1], Extrapolation.CLAMP) +
            interpolate(exit, [0, 1], [0, 0.08], Extrapolation.CLAMP),
        },
      ],
    };
  }, [height, scaleFactor, spec, width]);

  return (
    <Animated.View
      style={[
        styles.leaf,
        {
          left: '50%',
          top: '50%',
          width: spec.size * scaleFactor,
          height: spec.size * scaleFactor,
          marginLeft: (-spec.size * scaleFactor) / 2,
          marginTop: (-spec.size * scaleFactor) / 2,
        },
        animatedStyle,
      ]}>
      <AnimatedLeafIcon
        name={spec.iconName}
        size={spec.size * scaleFactor}
        color={spec.color}
        style={styles.leafIcon}
      />
    </Animated.View>
  );
}

export function RideGreenLoadingScreen({ onComplete }: RideGreenLoadingScreenProps) {
  const { width, height } = useWindowDimensions();
  const entryProgress = useSharedValue(0);
  const exitProgress = useSharedValue(0);
  const onCompleteRef = useRef(onComplete);
  const scaleFactor = Math.max(0.8, Math.min(Math.min(width / 390, height / 844), 1.18));
  const leafSpecs = createLeafSpecs(width, height, scaleFactor);
  onCompleteRef.current = onComplete;

  function finishLoading() {
    onCompleteRef.current();
  }

  useEffect(() => {
    entryProgress.value = withTiming(1, {
      duration: 520,
      easing: Easing.out(Easing.cubic),
    });

    exitProgress.value = withDelay(
      1050,
      withTiming(
        1,
        {
          duration: 920,
          easing: Easing.inOut(Easing.cubic),
        },
        (finished) => {
          if (finished) {
            runOnJS(finishLoading)();
          }
        }
      )
    );
  }, [entryProgress, exitProgress]);

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(exitProgress.value, [0, 0.78, 1], [1, 1, 0], Extrapolation.CLAMP),
    transform: [
      {
        scale: interpolate(exitProgress.value, [0, 1], [1, 1.16], Extrapolation.CLAMP),
      },
    ],
  }));

  const titleStyle = useAnimatedStyle(() => ({
    opacity:
      interpolate(entryProgress.value, [0, 1], [0, 1], Extrapolation.CLAMP) *
      interpolate(exitProgress.value, [0, 0.68, 1], [1, 0.18, 0], Extrapolation.CLAMP),
    transform: [
      {
        translateY:
          interpolate(entryProgress.value, [0, 1], [18, 0], Extrapolation.CLAMP) -
          interpolate(exitProgress.value, [0, 1], [0, 34], Extrapolation.CLAMP),
      },
      {
        scale:
          interpolate(entryProgress.value, [0, 1], [0.92, 1], Extrapolation.CLAMP) +
          interpolate(exitProgress.value, [0, 1], [0, 0.12], Extrapolation.CLAMP),
      },
    ],
  }));

  const haloStyle = useAnimatedStyle(() => ({
    opacity:
      interpolate(entryProgress.value, [0, 1], [0, 1], Extrapolation.CLAMP) *
      interpolate(exitProgress.value, [0, 1], [1, 0], Extrapolation.CLAMP),
    transform: [
      {
        scale: interpolate(exitProgress.value, [0, 1], [1, 1.5], Extrapolation.CLAMP),
      },
    ],
  }));

  return (
    <Animated.View pointerEvents="auto" style={[styles.overlay, overlayStyle]}>
      <View style={styles.backgroundOrbTop} />
      <View style={styles.backgroundOrbBottom} />
      <Animated.View
        style={[
          styles.titleHalo,
          haloStyle,
          {
            left: '50%',
            top: '50%',
            width: 236 * scaleFactor,
            height: 236 * scaleFactor,
            borderRadius: 118 * scaleFactor,
            marginLeft: (-236 * scaleFactor) / 2,
            marginTop: (-236 * scaleFactor) / 2,
          },
        ]}
      />
      {leafSpecs.map((spec) => (
        <AnimatedLeaf
          key={spec.id}
          spec={spec}
          entryProgress={entryProgress}
          exitProgress={exitProgress}
          width={width}
          height={height}
          scaleFactor={scaleFactor}
        />
      ))}
      <Animated.Text style={[styles.title, { fontSize: 46 * scaleFactor }, titleStyle]}>
        Ride Green
      </Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    backgroundColor: '#EEF5E9',
    justifyContent: 'center',
    overflow: 'hidden',
    zIndex: 20,
  },
  backgroundOrbTop: {
    position: 'absolute',
    top: -110,
    right: -70,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(88, 168, 106, 0.18)',
  },
  backgroundOrbBottom: {
    position: 'absolute',
    bottom: -140,
    left: -90,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: 'rgba(122, 186, 90, 0.14)',
  },
  titleHalo: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
  },
  title: {
    color: '#163126',
    fontWeight: '800',
    letterSpacing: 0.8,
    textAlign: 'center',
  },
  leaf: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#153021',
    shadowOffset: {
      width: 0,
      height: 8,
    },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 6,
  },
  leafIcon: {
    textAlign: 'center',
  },
});
