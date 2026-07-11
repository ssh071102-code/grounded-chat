/**
 * Golden retrieval set for the bundled corpus.
 *
 * Each item pairs a natural-language question with one or more `relevant`
 * anchor strings. At eval time (scripts/eval.ts) every anchor is resolved to
 * the chunk id(s) whose text contains it; those chunks are the ground-truth
 * relevant set for the question. Anchors deliberately resolve to the small
 * group of overlapping chunks that carry the answer, so recall@k and MRR
 * measure whether retrieval surfaces the right passage - not a single brittle
 * chunk index that would shift if chunking parameters change.
 */
export interface GoldenItem {
  id: string;
  question: string;
  relevant: string[];
}

export const GOLDEN_SET: GoldenItem[] = [
  {
    id: "darwin-beagle",
    question:
      "What ship was Darwin serving aboard as a naturalist when he was struck by the distribution of South American species?",
    relevant: ["on board H.M.S."],
  },
  {
    id: "darwin-woodpecker",
    question:
      "Why does Darwin think external conditions like climate and food cannot alone explain the structure of a woodpecker?",
    relevant: ["preposterous to attribute"],
  },
  {
    id: "darwin-first-chapter",
    question:
      "What subject does Darwin devote the first chapter of his abstract to?",
    relevant: ["first chapter of this Abstract to Variation under Domestication"],
  },
  {
    id: "darwin-malthus",
    question:
      "Whose doctrine does Darwin apply to the struggle for existence across the animal and vegetable kingdoms?",
    relevant: ["Struggle for Existence amongst all organic beings"],
  },
  {
    id: "darwin-reversion",
    question:
      "Do domestic varieties tend to revert to their lost characters when kept under unchanged conditions?",
    relevant: ["strong tendency to reversion"],
  },
  {
    id: "einstein-geometry-truth",
    question:
      "According to Einstein, is pure geometry concerned with whether its ideas correspond to real objects?",
    relevant: ["not concerned with the relation of the ideas"],
  },
  {
    id: "einstein-reject-relativity",
    question:
      "Why were prominent theoretical physicists initially inclined to reject the principle of relativity?",
    relevant: ["inclined to reject the principle of relativity"],
  },
  {
    id: "einstein-train-length",
    question:
      "How can the measured length of a moving train differ between the embankment frame and the train itself?",
    relevant: ["length of the train as measured from the embankment"],
  },
  {
    id: "einstein-lorentz",
    question:
      "What set of equations relates the space and time coordinates of two systems in uniform relative motion?",
    relevant: ["Lorentz transformation"],
  },
  {
    id: "einstein-simultaneity",
    question:
      "Does it make sense to say two lightning strikes at distant points on an embankment happened at the same time?",
    relevant: ["lightning flashes occurred simultaneously"],
  },
  {
    id: "strunk-omit",
    question: "What is Strunk's advice about vigorous, concise writing and needless words?",
    relevant: ["Omit needless words"],
  },
  {
    id: "strunk-semicolon",
    question:
      "What punctuation mark joins two grammatically complete clauses that are not linked by a conjunction?",
    relevant: ["the proper mark of punctuation is a semicolon"],
  },
  {
    id: "strunk-active-voice",
    question: "Why does Strunk recommend the habitual use of the active voice over the passive?",
    relevant: ["The habitual use of the active voice"],
  },
  {
    id: "strunk-series-comma",
    question:
      "How should the terms in a series of three or more words with a single conjunction be punctuated?",
    relevant: ["series of three or more terms"],
  },
  {
    id: "strunk-paragraph-opening",
    question: "How should the opening sentence of a paragraph relate to its topic?",
    relevant: ["opening sentence simply indicates by its subject"],
  },
];
