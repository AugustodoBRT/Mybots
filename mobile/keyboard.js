import { useEffect, useRef, useState } from 'react';
import { Keyboard } from 'react-native';

/**
 * How far the on-screen keyboard reaches into a screen (0 when closed): the screen pads its own bottom with it. Android draws the app
 * edge to edge, so the window does not shrink for the keyboard, and the height it reports leaves out the navigation bar; so the padding
 * is measured from where the keyboard really starts. Put `ref` on the screen's outer View and `pad` on its paddingBottom.
 */
export function useKeyboardPad() {
  const ref = useRef(null); const [pad, setPad] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', event => {
      const top = event.endCoordinates.screenY, height = event.endCoordinates.height;
      const view = ref.current; if (!view?.measureInWindow) { setPad(height); return; }
      view.measureInWindow((x, y, w, h) => setPad(Number.isFinite(y + h) && top > 0 ? Math.max(0, Math.round(y + h - top)) : height));
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setPad(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return [pad, ref];
}
