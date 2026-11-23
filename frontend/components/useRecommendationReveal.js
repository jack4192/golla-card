import { useEffect, useRef } from 'react';
import { Animated, Platform } from 'react-native';

export default function useRecommendationReveal({ ready, reduced, replay, withBurst = false }) {
  const pop = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const burst = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!ready || reduced == null) {
      pop.setValue(0);
      fade.setValue(0);
      burst.setValue(1);
      return;
    }
    if (reduced) {
      pop.setValue(1);
      fade.setValue(1);
      burst.setValue(1);
      return;
    }

    pop.setValue(0);
    fade.setValue(0);
    const useNativeDriver = Platform.OS !== 'web';
    const animations = [
      Animated.spring(pop, { toValue: 1, friction: 5, tension: 100, useNativeDriver }),
      Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver }),
    ];
    if (withBurst) {
      burst.setValue(0);
      animations.push(Animated.timing(burst, { toValue: 1, duration: 850, useNativeDriver }));
    }
    const reveal = Animated.parallel(animations);
    reveal.start();
    return () => reveal.stop();
  }, [pop, fade, burst, ready, reduced, replay, withBurst]);

  return {
    burst,
    motionStyle: {
      opacity: fade,
      transform: [
        { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] }) },
        { translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [32, 0] }) },
        { rotate: pop.interpolate({ inputRange: [0, 1], outputRange: ['-8deg', '0deg'] }) },
      ],
    },
  };
}
