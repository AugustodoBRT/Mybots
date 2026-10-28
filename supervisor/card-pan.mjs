// This function is also serialized into the browser page. Keep it self-contained.
export function redactCardNumbers(text) {
  const urls = [...text.matchAll(/(?:[a-z][a-z0-9+.-]*:\/\/|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}(?=[:/?#]|\b))[^\s<>"']+/gi)].map(match => [match.index, match.index + match[0].length]);
  const candidate = /(?:\d[ -]?){12,18}\d/g;
  return text.replace(candidate, (match, offset) => {
    const end = offset + match.length;
    if (urls.some(([start, stop]) => offset < stop && end > start)) return match;
    const adjacent = char => char && /[\p{L}\p{N}]/u.test(char);
    if (adjacent(text[offset - 1]) || adjacent(text[end])) return match;
    const number = match.replace(/[ -]/g, ''), n = length => Number(number.slice(0, length));
    const known = number[0] === '4' || n(2) >= 51 && n(2) <= 55 || n(4) >= 2221 && n(4) <= 2720 ||
      [34, 37].includes(n(2)) || n(3) >= 300 && n(3) <= 305 || [36, 38, 39].includes(n(2)) ||
      n(4) === 6011 || n(2) === 65 || n(3) >= 644 && n(3) <= 649 || n(6) >= 622126 && n(6) <= 622925 ||
      n(4) >= 3528 && n(4) <= 3589 || [606282, 637095, 637568, 637599, 637609, 637612].includes(n(6)) || n(4) === 3841 ||
      [401178, 401179, 431274, 438935, 451416, 457393, 457631, 457632, 504175, 627780, 636297, 636368].includes(n(6)) ||
      n(6) >= 506699 && n(6) <= 506778 || n(6) >= 509000 && n(6) <= 509999 || n(6) >= 650031 && n(6) <= 650033 || n(6) >= 650035 && n(6) <= 650051 || n(6) >= 650405 && n(6) <= 650439 || n(6) >= 650485 && n(6) <= 650538 || n(6) >= 650541 && n(6) <= 650598 || n(6) >= 650700 && n(6) <= 650718 || n(6) >= 650720 && n(6) <= 650727 || n(6) >= 650901 && n(6) <= 650978 || n(6) >= 651652 && n(6) <= 651679 || n(6) >= 655000 && n(6) <= 655019 || n(6) >= 655021 && n(6) <= 655058;
    if (!known) return match;
    let sum = 0;
    for (let i = number.length - 1, doubled = false; i >= 0; i--, doubled = !doubled) {
      let digit = Number(number[i]); if (doubled && (digit *= 2) > 9) digit -= 9; sum += digit;
    }
    return sum % 10 === 0 ? '[cartão protegido]' : match;
  });
}
