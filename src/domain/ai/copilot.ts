/**
 * Trackit X — the Copilot business contract.
 *
 * ── What this file is ──────────────────────────────────────────────────────────
 * Phase 36 built the transport and the security boundary. This file is the
 * conversation: what a user may ask, what the Copilot may be told about their
 * business, and what shape an answer comes back in.
 *
 * It is deliberately framework-independent. No React, no React Native, no Expo,
 * no Supabase client, and no provider SDK — importing any of those would make
 * this module unloadable by a test runner, a script, or an Edge Function, and the
 * rules below are exactly the rules that must be checkable without booting a
 * renderer. `DashboardSnapshot` arrives as a *type* import, which erases at build
 * time, so this module has no runtime dependency on the dashboard at all.
 *
 * ── The three boundaries this file enforces ────────────────────────────────────
 *
 *  1. CLASSIFICATION IS DETERMINISTIC. `classifyCopilotIntent` is keyword
 *     matching over a normalised question. No model, no confidence score, no
 *     "probably a workload question". A classifier that can be wrong in a
 *     different way on every run is a classifier whose context selection cannot
 *     be tested, and context selection is what decides what the model is allowed
 *     to see. Anything unrecognised falls back to `general_business`, which is
 *     the most conservative shape: aggregates only, no per-person or per-project
 *     rollups.
 *
 *  2. THE MODEL CANNOT INVENT A SOURCE. `normalizeCopilotOutput` only keeps a
 *     reference that matches an entity present in the context the client itself
 *     built. A reference to a project, task or employee the viewer was not sent
 *     is dropped rather than rendered, because a citation the system cannot
 *     resolve is indistinguishable from a fabricated one.
 *
 *  3. THE MODEL CANNOT ASK FOR AN ACTION. `CopilotRecommendation` has exactly
 *     one field, and it is text. There is no id, no command, no tool name, no
 *     parameter bag — so there is no value a model could return that any part of
 *     this codebase would read as an instruction to do something. Phase 37 has no
 *     autonomous execution and this type is where that is made structural rather
 *     than a matter of trusting the prompt.
 *
 * ── On the honesty boundary ───────────────────────────────────────────────────
 * `CopilotResponse.dataGaps` is computed by the client from context it built, and
 * is never taken from the model. It is how "the supplied context did not contain
 * a project by that name" survives into the UI as a fact rather than becoming the
 * model's confident guess. If the model says a task is overdue and no overdue task
 * is in the context, the honest outcome is a drop or an unsourced sentence, not a
 * citation we minted for it.
 */
import type { OrganizationRole } from '@/domain/organization';

import type { AIProviderId } from './types.ts';

// ---------------------------------------------------------------------------
// Intent
// ---------------------------------------------------------------------------

/**
 * What a question is asking about.
 *
 * A closed union, and the classifier is total over it, so a context builder can
 * switch on it exhaustively. Adding a member is a compile error in every switch
 * that decides what a model is allowed to see, which is the correct pressure.
 */
export const COPILOT_INTENTS = [
  'attention',
  'workload',
  'employee_work',
  'project_status',
  'task_status',
  'progress',
  'overview',
  'general_business',
] as const;

export type CopilotIntent = (typeof COPILOT_INTENTS)[number];

/**
 * The intent used when nothing is recognised.
 *
 * Named rather than left as a bare `else`, because the fallback is a product
 * decision with a security shape: `general_business` sends aggregates and no
 * per-entity rollups, so a question this classifier cannot read is answered from
 * the least identifying data in the snapshot.
 */
export const COPILOT_FALLBACK_INTENT: CopilotIntent = 'general_business';

/** One rule that fired, kept so a test can assert *why* an intent was chosen. */
export interface CopilotIntentMatch {
  readonly intent: CopilotIntent;
  /** The keyword that matched, verbatim from the rule table. */
  readonly keyword: string;
}

/** The result of classifying one question. Total, and never an error. */
export interface CopilotClassification {
  readonly intent: CopilotIntent;
  /**
   * Every rule that fired, in table order — not just the winning one.
   *
   * A question like "which projects are behind and who is overloaded" legitimately
   * matches two rules. Recording only the winner would hide that the classifier is
   * choosing rather than understanding, which is the honest description of it.
   */
  readonly matches: readonly CopilotIntentMatch[];
  /** True when nothing matched and the fallback was used. */
  readonly isFallback: boolean;
}

/**
 * The rule table, in precedence order.
 *
 * Order is the whole design. `attention` is first because "what needs my
 * attention today" and "what work is due soon" are the questions that must be
 * answered from deadlines and blocked work, and both of those words would also be
 * caught by the broader `task_status` and `project_status` rules further down.
 * `workload` precedes `employee_work` because a question about how busy people
 * are is a question about the distribution, not about one person's list.
 *
 * Keywords are matched against a lowercased, punctuation-stripped question. A
 * multi-word keyword matches as a phrase; a single word matches as a whole token,
 * so "urgent" cannot be triggered by "furlong" and "overdue" cannot be triggered
 * by "overdueX".
 */
/**
 * Rules in the order they are consulted, and the order is specificity, not alphabet.
 *
 * `progress` precedes `project_status` so that "how is progress on our projects" is
 * answered from progress rather than from the word "projects" — the noun a question
 * happens to mention is not the topic it is asking about. `employee_work` precedes
 * `workload` only where the two do not collide, because "who is overloaded" is about a
 * person and the workload pass, and "what is Priya working on" is about one person's
 * work and should not drag in everybody else's.
 */
const INTENT_RULES: readonly { readonly intent: CopilotIntent; readonly keywords: readonly string[] }[] = [
  {
    intent: 'attention',
    keywords: [
      'attention',
      'needs my',
      'need my',
      'right now',
      'focus',
      'urgent',
      'overdue',
      'late',
      'due soon',
      'due today',
      'due this week',
      'upcoming',
      'deadline',
      'at risk',
      'slipping',
      'falling behind',
      'behind',
      'blocked',
      'stuck',
      'today',
    ],
  },
  {
    intent: 'workload',
    keywords: [
      'workload',
      'busiest',
      'overloaded',
      'over capacity',
      'capacity',
      'bandwidth',
      'too much work',
      'too many tasks',
      'too many',
      'highest workload',
      'most work',
      'carrying',
    ],
  },
  {
    intent: 'employee_work',
    keywords: [
      'employee',
      'employees',
      'staff',
      'person',
      'people',
      'team member',
      'my work',
      'who is working',
      'what is working on',
      'working on',
      'individual',
      'headcount',
    ],
  },
  {
    intent: 'progress',
    keywords: ['progress', 'how far', 'percent complete', 'percentage complete', 'how complete', 'completion'],
  },
  {
    intent: 'task_status',
    keywords: ['task', 'tasks', 'to do', 'todo', 'to-do', 'backlog', 'queue', 'in review', 'in progress'],
  },
  {
    intent: 'project_status',
    keywords: [
      'project',
      'projects',
      'initiative',
      'initiatives',
      'delivery',
      'milestone',
      // The canonical way a person asks about one project by name, with no noun in the
      // question at all: "what is the status of Alpha". Without these, the most common
      // project question in the product falls through to the general overview and gets
      // an answer about the whole business instead.
      'status of',
      'status on',
      'state of',
      'update on',
      'health of',
    ],
  },
  {
    intent: 'overview',
    keywords: [
      'overview',
      'summary',
      'summarise',
      'summarize',
      'how is the business',
      'how are we doing',
      'how is everything',
      'business health',
      'how is my business',
      'general',
      'big picture',
      'recap',
    ],
  },
];

/** Longest keyword first, so "due this week" is preferred over "today". */
function normaliseQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function keywordMatches(normalised: string, keyword: string): boolean {
  // Whole-token containment on both sides. A phrase is matched as a phrase and a single
  // word as a single word, because without the token rule "urgent" fires on "furlong",
  // which would hand an unrelated question the attention context — the widest one — on
  // a technicality.
  return ` ${normalised} `.includes(` ${keyword} `);
}

/**
 * Classifies a question into one intent. Deterministic, total, and side-effect free.
 *
 * Never throws and never returns null. A caller with an unusable question — an
 * empty string, a wall of punctuation — gets `general_business`, which is the
 * bounded aggregate context.
 */
export function classifyCopilotIntent(question: string): CopilotClassification {
  const normalised = normaliseQuestion(question);
  const matches: CopilotIntentMatch[] = [];

  for (const rule of INTENT_RULES) {
    for (const keyword of rule.keywords) {
      if (keywordMatches(normalised, keyword)) {
        matches.push({ intent: rule.intent, keyword });
        break; // one keyword per rule is enough to record why the rule fired
      }
    }
  }

  if (matches.length === 0) {
    return { intent: COPILOT_FALLBACK_INTENT, matches: [], isFallback: true };
  }

  return { intent: matches[0]?.intent ?? COPILOT_FALLBACK_INTENT, matches, isFallback: false };
}

/** A one-word label for the intent, for the log and for a UI badge. */
export const COPILOT_INTENT_LABELS: Readonly<Record<CopilotIntent, string>> = {
  attention: 'Needs attention',
  workload: 'Workload',
  employee_work: 'Employee work',
  project_status: 'Project status',
  task_status: 'Task status',
  progress: 'Progress',
  overview: 'Business overview',
  general_business: 'General business',
};

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

/**
 * The entity kinds a citation may point at.
 *
 * Application-level entities the viewer can already open. There is no
 * `organization` member here and no database-internal kind: a reference must be
 * something a person can navigate to and check, or it is not a citation.
 */
export const COPILOT_REFERENCE_ENTITIES = ['project', 'task', 'employee'] as const;

export type CopilotReferenceEntity = (typeof COPILOT_REFERENCE_ENTITIES)[number];

/**
 * One thing the answer is grounded in.
 *
 * `entityId` is the real application id — the same `projects.id` the Projects
 * screen routes to — so a reader who doubts a sentence can open the record. It is
 * never a row number, a primary key fragment, or anything else the user cannot
 * use.
 */
export interface CopilotReference {
  readonly entity: CopilotReferenceEntity;
  readonly entityId: string;
  /** A human label. Shown as the citation text. */
  readonly label: string;
}

/** Stable key for matching a model-returned reference against the allowed set. */
export function referenceKey(entity: string, entityId: unknown): string {
  return `${entity}:${typeof entityId === 'string' ? entityId : ''}`;
}

/** The set of references the client is willing to see echoed back. */
export function referenceIndex(
  references: readonly CopilotReference[],
): ReadonlyMap<string, CopilotReference> {
  const index = new Map<string, CopilotReference>();
  for (const reference of references) {
    // First writer wins. The context can legitimately contain the same project
    // twice under two intents, and the label the client supplied is the trusted
    // one — a model-supplied label must never overwrite it.
    const key = referenceKey(reference.entity, reference.entityId);
    if (!index.has(key)) index.set(key, reference);
  }
  return index;
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

/**
 * A suggestion, and nothing else.
 *
 * One string field, on purpose. A richer type would want an `action` or a
 * `target` so a future screen could offer "Apply" — and that field is the exact
 * place a model-generated value becomes a thing the application executes. Phase 37
 * has no autonomous actions, so the type does not have the room for one. Adding
 * execution is a deliberate change to this interface, reviewed as a security
 * change, rather than a field that appears because a prompt asked nicely.
 */
export interface CopilotRecommendation {
  readonly text: string;
}

/**
 * A complete, renderable answer.
 *
 * `organizationId` is on the response for the same reason it is on the context: a
 * conversation is per-tenant, and the UI compares this tag against the active
 * organization before rendering. An answer from another tenant is not an answer,
 * it is a leak, and the check is one string comparison.
 */
export interface CopilotResponse {
  readonly organizationId: string;
  readonly question: string;
  readonly intent: CopilotIntent;
  readonly summary: string;
  readonly keyPoints: readonly string[];
  readonly recommendations: readonly CopilotRecommendation[];
  /** Only references that resolved against the context. Never invented. */
  readonly references: readonly CopilotReference[];
  /**
   * What the supplied context could not answer, computed by the client.
   *
   * Not model-supplied. A model asked to explain its own gaps will produce a
   * sentence; the gaps are known here, before the request is sent, and are the
   * only honest source for them.
   */
  readonly dataGaps: readonly string[];
  readonly provider: AIProviderId;
  readonly model: string;
  /**
   * The organization configuration the answer was produced through.
   *
   * A row identifier, never a secret — the credential lives in Vault and is resolved
   * server-side. Recorded so an answer is traceable to the configuration that made it,
   * which is what makes "this looks wrong" diagnosable rather than merely annoying, and
   * so a user whose organization has since re-pointed its default can see that the
   * answer they are looking at came from the old one.
   */
  readonly configId: string;
  /** ISO timestamp of the request, matching the context. */
  readonly requestedAt: string;
  /**
   * False when the provider did not return usable structured output and the
   * summary is the raw text.
   *
   * Surfaced so the UI can say so rather than presenting a wall of prose as if it
   * had been a structured analysis.
   */
  readonly structured: boolean;
}

/** What the Copilot service accepts. Deliberately tiny. */
export interface CopilotAskRequest {
  readonly organizationId: string;
  readonly question: string;
  readonly viewerRole: OrganizationRole | null;
}

// ---------------------------------------------------------------------------
// Output normalisation
// ---------------------------------------------------------------------------

/**
 * Ceilings on what one answer may contain.
 *
 * A model is not a trusted length. These bound the rendered text and the number of
 * items, and they are applied after parsing rather than before, because the size
 * that matters is the size of what is rendered.
 */
export const COPILOT_OUTPUT_LIMITS = {
  maxScannedChars: 8_000,
  maxSummaryChars: 2_000,
  maxItemChars: 400,
  maxKeyPoints: 8,
  maxRecommendations: 5,
  maxReferences: 12,
} as const;

const FENCED_JSON = /```(?:json)?\s*([\s\S]*?)```/i;

/**
 * Extracts the first balanced JSON object from model output.
 *
 * Deliberately not `JSON.parse(rawOutput)`. A model asked for JSON will sometimes
 * answer with a sentence and a code fence, sometimes with two fences, and sometimes
 * with a fenced object followed by commentary. Scanning for a balanced object —
 * counting braces while tracking string literals and escapes — is what makes the
 * parse succeed in the common cases and fail cleanly in the rest, instead of
 * either throwing on every slightly-off answer or, worse, accepting a prefix that
 * happens to be valid JSON.
 *
 * Returns `null` rather than throwing. The caller falls back to raw text, which is
 * a degraded answer rather than a failed one.
 */
export function extractJsonObject(raw: string): string | null {
  if (raw.trim().length === 0) return null;

  const bounded = raw.slice(0, COPILOT_OUTPUT_LIMITS.maxScannedChars);

  const fenced = FENCED_JSON.exec(bounded);
  const haystack = fenced !== null && fenced[1] !== undefined ? fenced[1] : bounded;

  const start = haystack.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < haystack.length; index += 1) {
    const char = haystack[index];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return haystack.slice(start, index + 1);
    }
  }

  return null;
}

/** Reads a bounded, non-empty string. Anything else is rejected rather than coerced. */
function readText(source: unknown, max: number): string | null {
  if (typeof source !== 'string') return null;
  const trimmed = source.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * Reads a list of short strings, tolerating both `["a"]` and `[{ "text": "a" }]`.
 *
 * Both shapes appear in practice depending on the model, and rejecting one of them
 * would mean discarding a usable answer over a formatting difference. Anything
 * that is not a string or an object with a string `text` is dropped, not rendered
 * as `"[object Object]"`.
 */
function readList(source: unknown, max: number, maxChars: number): string[] {
  if (!Array.isArray(source)) return [];
  const items: string[] = [];
  for (const entry of source) {
    if (items.length >= max) break;
    const text = typeof entry === 'string' ? readText(entry, maxChars) : readText(
      typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>)['text'] : null,
      maxChars,
    );
    if (text !== null) items.push(text);
  }
  return items;
}

/** What the normaliser produces, before the response envelope is added. */
export interface NormalizedCopilotAnswer {
  readonly summary: string;
  readonly keyPoints: readonly string[];
  readonly recommendations: readonly CopilotRecommendation[];
  readonly references: readonly CopilotReference[];
  readonly structured: boolean;
}

/**
 * Turns untrusted model text into an answer the UI may render.
 *
 * Three rules, in order of how much they matter:
 *
 *  1. NOTHING IS PARSED BLIND. The JSON is located by a balanced-brace scan, parsed
 *     inside a `try`, and then every field is read through a guard that accepts
 *     only the expected primitive type. A field of the wrong type is absent, not
 *     coerced.
 *  2. A REFERENCE MUST RESOLVE. `allowed` is built by the client from the context
 *     it sent. A returned reference whose `(entity, entityId)` is not in that set
 *     is dropped, and the model cannot supply the label — labels always come from
 *     the client's copy, so a citation cannot be relabelled into something the
 *     viewer was never shown.
 *  3. THE SHAPE CANNOT CARRY AN ACTION. Extra keys in the parsed object are simply
 *     not read. `actions`, `commands`, `tools`, `execute` — a model that returns
 *     them has them discarded, because this function builds a new object from named
 *     fields and copies nothing else.
 *
 * If nothing parseable is found, the raw text becomes the summary, truncated, and
 * `structured` is false so the UI can be honest about what it is showing.
 */
export function normalizeCopilotOutput(
  raw: string,
  allowed: readonly CopilotReference[],
): NormalizedCopilotAnswer {
  const index = referenceIndex(allowed);
  const limits = COPILOT_OUTPUT_LIMITS;

  const candidate = extractJsonObject(raw);
  let parsed: unknown = null;
  if (candidate !== null) {
    try {
      parsed = JSON.parse(candidate);
    } catch {
      parsed = null;
    }
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      summary: readText(raw, limits.maxSummaryChars) ?? '',
      keyPoints: [],
      recommendations: [],
      references: [],
      structured: false,
    };
  }

  const source = parsed as Record<string, unknown>;

  /*
   * No fallback to the raw text once the envelope has parsed.
   *
   * At this point `raw` is a JSON string, so a `summary` of the wrong type would render
   * `{"summary":42,...}` to the user as though it were the answer — the model would have
   * produced one unusable field and the product would display the envelope around it.
   * The raw-text path belongs to the unparseable case above, where the text genuinely
   * is the answer and `structured` is false so the UI can say so.
   */
  const summary = readText(source['summary'], limits.maxSummaryChars) ?? '';
  const keyPoints = readList(source['keyPoints'] ?? source['key_points'], limits.maxKeyPoints, limits.maxItemChars);
  const recommendationTexts = readList(
    source['recommendations'],
    limits.maxRecommendations,
    limits.maxItemChars,
  );

  const references: CopilotReference[] = [];
  const seen = new Set<string>();
  const returned = source['references'] ?? source['data_references'];
  if (Array.isArray(returned)) {
    for (const entry of returned) {
      if (references.length >= limits.maxReferences) break;
      if (typeof entry !== 'object' || entry === null) continue;
      const record = entry as Record<string, unknown>;
      const entity = record['entity'] ?? record['type'];
      const entityId = record['entityId'] ?? record['referenceId'] ?? record['id'];
      if (typeof entity !== 'string') continue;
      const key = referenceKey(entity, entityId);
      if (seen.has(key)) continue;
      const match = index.get(key);
      // Unresolvable references are dropped, not invented. A citation the system
      // cannot open is not a citation.
      if (match === undefined) continue;
      seen.add(key);
      references.push(match);
    }
  }

  return {
    summary,
    keyPoints,
    recommendations: recommendationTexts.map((text) => ({ text })),
    references,
    structured: true,
  };
}
