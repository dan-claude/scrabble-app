// Standard English Scrabble tile distribution: [count, points]
export const TILE_DATA = {
  A: [9, 1], B: [2, 3], C: [2, 3], D: [4, 2], E: [12, 1],
  F: [2, 4], G: [3, 2], H: [2, 4], I: [9, 1], J: [1, 8],
  K: [1, 5], L: [4, 1], M: [2, 3], N: [6, 1], O: [8, 1],
  P: [2, 3], Q: [1, 10], R: [6, 1], S: [4, 1], T: [6, 1],
  U: [4, 1], V: [2, 4], W: [2, 4], X: [1, 8], Y: [2, 4],
  Z: [1, 10], '#': [2, 0], // '#' = blank tile
};

export function letterValue(letter) {
  return TILE_DATA[letter]?.[1] ?? 0;
}

export function createTileBag() {
  const bag = [];
  for (const [letter, [count]] of Object.entries(TILE_DATA)) {
    for (let i = 0; i < count; i++) bag.push(letter);
  }
  return shuffle(bag);
}

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
