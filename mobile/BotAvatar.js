import FaceArt from './FaceArt';
import { HUES } from './theme';
import { FACE_COLORS } from '../lib/mimo.mjs';

// A bot's avatar is its character face (see FaceArt); the old four forms are gone, the old four color names still work.
export const BOT_COLORS = HUES;
export const FACE_SWATCHES = FACE_COLORS;
export default function BotAvatar({ bot, size = 54, state = 'idle', animated = true, mood }) {
  return <FaceArt bot={bot || {}} state={state} size={size} animated={animated} mood={mood} />;
}
