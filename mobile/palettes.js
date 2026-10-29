// The two themes' colors, kept free of React so tests can check their contrast.
export const PALETTES = {
  dark: {
    bg: '#000000', bg2: '#0A0A0C', surface: '#111114', surface2: '#19191D', elevated: '#222227',
    line: '#27272D', line2: '#37373F', text: '#F6F4EF', text2: '#D2CEC5', muted: '#ABA79E', faint: '#928E86',
    accent: '#FF9F1C', accentInk: '#241500', good: '#7BD88F', amber: '#FFC86E', amberInk: '#2E2210', amberSoft: '#17140F', red: '#FF7A6E', sky: '#8AB6FF', lilac: '#C2A5FF', peach: '#FFB38A'
  },
  light: {
    bg: '#FAF8F4', bg2: '#F3F0EA', surface: '#FFFFFF', surface2: '#F1EEE8', elevated: '#FFFFFF',
    line: '#E4E0D7', line2: '#CFCABF', text: '#1B1A17', text2: '#3F3C36', muted: '#5F5B53', faint: '#69655D',
    accent: '#A85600', accentInk: '#FFFFFF', good: '#2A7A43', amber: '#8A5A00', amberInk: '#FFF1D6', amberSoft: '#FFF4DE', red: '#B3261E', sky: '#2F5FBF', lilac: '#6B4BC0', peach: '#B8561F'
  }
};
// 'dark' | 'light' | 'system' + what the system says → 'dark' | 'light'.
export const resolveTheme = (preference, system) => preference === 'light' ? 'light' : preference === 'system' ? (system === 'light' ? 'light' : 'dark') : 'dark';

export { FACE_COLORS, HUES, botColor } from '../lib/mimo.mjs';
