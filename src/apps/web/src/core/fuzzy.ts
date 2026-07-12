import {
  fuzzySearch,
  prepareQuery,
  type PreparedQuery,
  type SearchResult,
} from "../search/SearchHelpers";

// Pure string fuzzy-scoring, lifted out of ui/suggest so the headless kernel
// (metadata link/tag suggestions) can score without importing the UI modal.
export interface FuzzyMatch extends SearchResult {}

export interface PreparedFuzzyQuery extends PreparedQuery {}

export function prepareFuzzyQuery(query: string): PreparedFuzzyQuery {
  return prepareQuery(query);
}

export function fuzzyMatch(query: PreparedFuzzyQuery, text: string): FuzzyMatch | null {
  return fuzzySearch(query, text);
}
