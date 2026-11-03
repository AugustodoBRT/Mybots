// Finding the window on Hyprland. The class of the window is the name of the program: the development setup runs as
// "mybots-desktop" (the folder's own manifest), the installed app (AppImage, .deb) as "mybots". Either one is ours.
const WINDOW_CLASSES = ['mybots', 'mybots-desktop'];
const isOurs = (item, pid) => Boolean(item) && item.pid === pid && WINDOW_CLASSES.includes(item.class);
// The rule that keeps a closed window on its own special workspace (matches both names).
const PARK_RULE = (workspace = 'special:mybots') => `match:class ^(${WINDOW_CLASSES.join('|')})$, workspace ${workspace} silent`;
module.exports = { WINDOW_CLASSES, isOurs, PARK_RULE };
