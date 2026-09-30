import { BASE_GAME_WORDS } from "./base_game";
import { INDIA_WORDS } from "./india";
import { POKEMON_WORDS } from "./pokemon";
import { POP_CULTURE_WORDS } from "./pop_culture";

export type Expansion = {
  id: string;
  name: string;
  image: string;
  theme: "pokemon" | "pop-culture" | "india" | "nsfw";
  available: boolean;
  words: readonly string[];
};

const expansionPacks: Expansion[] = [
  { id: "pokemon", name: "Pokémon", image: "/expansions/pokemon.png", theme: "pokemon", available: true, words: POKEMON_WORDS },
  { id: "pop-culture", name: "Pop Culture", image: "/expansions/pop-culture.png", theme: "pop-culture", available: true, words: POP_CULTURE_WORDS },
  { id: "india", name: "India", image: "/expansions/india.png", theme: "india", available: true, words: INDIA_WORDS },
];

export const EXPANSIONS: readonly Expansion[] = expansionPacks.sort((a, b) => Number(b.available) - Number(a.available));

const shuffle = <T,>(items: readonly T[]) => {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
};

export function sanitizeExpansionIds(ids: readonly string[] = []) {
  const valid = new Set(EXPANSIONS.filter((pack) => pack.available && pack.words.length > 0).map((pack) => pack.id));
  return [...new Set(ids)].filter((id) => valid.has(id));
}

export function buildDeck(ids: readonly string[] = []) {
  const selectedIds = sanitizeExpansionIds(ids);
  const selected = selectedIds.map((id) => EXPANSIONS.find((pack) => pack.id === id)!).filter(Boolean);
  if (!selected.length) return shuffle(BASE_GAME_WORDS);
  const baseSampleSize = Math.min(200, BASE_GAME_WORDS.length);
  return shuffle([
    ...shuffle(BASE_GAME_WORDS).slice(0, baseSampleSize),
    ...selected.flatMap((pack) => shuffle(pack.words)),
  ]);
}
