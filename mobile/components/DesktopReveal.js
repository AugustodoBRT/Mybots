import { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';

// Animate layout itself, so the conversation moves with the panel. Closed panels
// unmount their controls immediately and cannot retain keyboard focus.
export function DesktopReveal({ open, width = 320, children }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const motion = Animated.timing(progress, { toValue: open ? width : 0, duration: reduced ? 0 : 240, useNativeDriver: false });
    motion.start(); return () => motion.stop();
  }, [open, width, progress]);
  return <Animated.View style={{ width: progress, overflow: 'hidden', flexShrink: 0 }}>
    {open ? <View style={{ width, flex: 1 }}>{children}</View> : null}
  </Animated.View>;
}
