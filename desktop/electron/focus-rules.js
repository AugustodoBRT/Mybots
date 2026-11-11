// When a page of the bots' browser takes the keyboard, it goes back to the interface if the person was writing there a moment ago
// and did not click on that page or choose its tab: the page is being driven by a bot.
const WRITING_MS = 3000, CHOSEN_MS = 1000;
const returnsFocus = ({ typedAt = 0, pressedAt = 0, chosenAt = 0, now }) => now - typedAt < WRITING_MS && now - pressedAt >= CHOSEN_MS && now - chosenAt >= CHOSEN_MS;
module.exports = { returnsFocus };
