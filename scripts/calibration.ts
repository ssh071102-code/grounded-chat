/**
 * Labelled sentences for threshold calibration against the bundled
 * public-domain corpus (`npm run ingest -- corpus`).
 *
 * GROUNDED sentences restate something the corpus says, in wording a model
 * would plausibly produce. FABRICATED sentences are on-topic and fluent and
 * say something the corpus does not, which is the only fabrication worth
 * measuring: an off-topic sentence is easy for any threshold to catch.
 */
export interface CalibrationSet {
  GROUNDED: string[];
  FABRICATED: string[];
}

export const GROUNDED: string[] = [
  "Natural selection acts by preserving variations that are useful to the organism.",
  "Species that are closely related tend to share more structural features.",
  "Struggle for existence follows from the high rate at which organisms multiply.",
  "The laws of physics take the same form for observers moving uniformly relative to one another.",
  "The speed of light in empty space is the same for every observer.",
  "Measurements of time and length depend on the motion of the observer making them.",
  "A sentence should contain no unnecessary words.",
  "The active voice usually makes writing more direct than the passive.",
  "Related words in a sentence are best kept together.",
];

export const FABRICATED: string[] = [
  "Natural selection was first demonstrated experimentally in 1873 using fruit flies.",
  "Darwin concluded that species change at a fixed rate of one variation per generation.",
  "Closely related species always share at least eighty percent of their anatomy.",
  "The speed of light was measured at 299,792 kilometres per second by Einstein himself.",
  "Relativity predicts that clocks on mountains run slower than clocks at sea level.",
  "Einstein showed that no object can be accelerated beyond half the speed of light.",
  "Strunk recommends a maximum of seventeen words per sentence.",
  "The passive voice should be removed from every sentence without exception.",
  "Paragraphs work best when each contains exactly three sentences.",
];
