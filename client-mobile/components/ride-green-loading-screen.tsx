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
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  rotate: number;
  color: string;
  flyX: number;
  flyY: number;
  delay: number;
};

const LEAF_SPECS: LeafSpec[] = [
  {
    id: 'top-left',
    offsetX: -134,
    offsetY: -84,
    width: 34,
    height: 18,
    rotate: -28,
    color: '#58A86A',
    flyX: -220,
    flyY: -210,
    delay: 0,
  },
  {
    id: 'upper-left',
    offsetX: -98,
    offsetY: -132,
    width: 30,
    height: 16,
    rotate: -72,
    color: '#7CCF7C',
    flyX: -170,
    flyY: -250,
    delay: 40,
  },
  {
    id: 'mid-left',
    offsetX: -156,
    offsetY: 6,
    width: 28,
    height: 14,
    rotate: -12,
    color: '#7BBD57',
    flyX: -260,
    flyY: -40,
    delay: 120,
  },
  {
    id: 'bottom-left',
    offsetX: -104,
    offsetY: 90,
    width: 36,
    height: 18,
    rotate: 38,
    color: '#84B96B',
    flyX: -220,
    flyY: 220,
    delay: 80,
  },
  {
    id: 'top-right',
    offsetX: 126,
    offsetY: -86,
    width: 34,
    height: 18,
    rotate: 32,
    color: '#4C9366',
    flyX: 220,
    flyY: -220,
    delay: 20,
  },
  {
    id: 'upper-right',
    offsetX: 90,
    offsetY: -138,
    width: 28,
    height: 14,
    rotate: 78,
    color: '#8FCB6D',
    flyX: 150,
    flyY: -260,
    delay: 100,
  },
  {
    id: 'mid-right',
    offsetX: 152,
    offsetY: -2,
    width: 28,
    height: 14,
    rotate: 10,
    color: '#72B86E',
    flyX: 260,
    flyY: -30,
    delay: 60,
  },
  {
    id: 'bottom-right',
    offsetX: 104,
    offsetY: 92,
    width: 36,
    height: 18,
    rotate: -42,
    color: '#A7C95A',
    flyX: 220,
    flyY: 220,
    delay: 140,
  },
  {
    id: 'bottom-center',
    offsetX: 12,
    offsetY: 126,
    width: 24,
    height: 12,
    rotate: -6,
    color: '#5AA964',
    flyX: 16,
    flyY: 270,
    delay: 180,
  },
];

function AnimatedLeaf({
  spec,
  entryProgress,
  exitProgress,
  scaleFactor,
}: {
  spec: LeafSpec;
  entryProgress: SharedValue<number>;
  exitProgress: SharedValue<number>;
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
    const baseX = spec.offsetX * scaleFactor;
    const baseY = spec.offsetY * scaleFactor;

    return {
      opacity: entry * (1 - exit * 0.92),
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
          scale: interpolate(entryProgress.value, [0, 1], [0.55, 1], Extrapolation.CLAMP) - exit * 0.18,
        },
      ],
    };
  }, [scaleFactor, spec]);

  return (
    <Animated.View
      style={[
        styles.leaf,
        {
          backgroundColor: spec.color,
          left: '50%',
          top: '50%',
          width: spec.width * scaleFactor,
          height: spec.height * scaleFactor,
          borderRadius: spec.height * scaleFactor,
          marginLeft: (-spec.width * scaleFactor) / 2,
          marginTop: (-spec.height * scaleFactor) / 2,
        },
        animatedStyle,
      ]}>
      <View
        style={[
          styles.leafVein,
          {
            width: Math.max(1, spec.width * scaleFactor * 0.1),
          },
        ]}
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
      {LEAF_SPECS.map((spec) => (
        <AnimatedLeaf
          key={spec.id}
          spec={spec}
          entryProgress={entryProgress}
          exitProgress={exitProgress}
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
  leafVein: {
    height: '70%',
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.38)',
  },
});
