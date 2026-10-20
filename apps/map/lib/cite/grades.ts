// STUB (red commit): returns nothing, so grades.test.ts fails before the real loader exists.
import type { PublisherReply } from "./types";

export interface GradeFact {
  plan: string;
  fact: string;
  link: string;
  sourceId: string;
  upstreamConfirmed: boolean;
  wrong: boolean;
}
export interface UrlRow {
  url: string;
  sourceId: string;
  facts: GradeFact[];
}
export type Outcome = "agree" | "disagree" | "unreachable";
export interface FactOutcome {
  fact: GradeFact;
  outcome: Outcome;
}

export function inTableFacts(_grades: unknown): GradeFact[] {
  return [];
}
export function byUrl(_facts: GradeFact[]): UrlRow[] {
  return [];
}
export function recordReturned(_reply: PublisherReply): boolean {
  return true;
}
export function compare(_rows: UrlRow[], _replies: Map<string, PublisherReply>): FactOutcome[] {
  return [];
}
