/**
 * Trackit X — marketing copy and demonstration figures.
 *
 * ── The one rule this file exists to enforce ─────────────────────────────────
 * Every number below is invented, and it is invented on a PUBLIC page that no
 * signed-in user's data can reach. The landing surface issues no query: it has no
 * organization id, no session, and no repository import, so there is nothing for
 * it to read even if a component asked. That is the point of keeping the figures
 * here rather than inside the components — a reviewer can audit "is this real?"
 * by reading one file, and the answer is visibly *no* for all of it.
 *
 * Anything shown from these constants is labelled as a sample in the UI. The
 * product's rule that a business owner must never see a fabricated figure
 * presented as their own applies inside the application; on the way in, the
 * illustration has to be unmistakably an illustration.
 */
import type { IconName } from '@/design-system';

export const BRAND = {
  wordmark: 'TRACKIT X',
  subtitle: 'AI BUSINESS OPERATING SYSTEM',
} as const;

export interface NavLink {
  readonly label: string;
  /** Anchor text only — these sections do not exist as routes yet. */
  readonly section: string;
}

export const NAV_LINKS: readonly NavLink[] = [
  { label: 'Products', section: 'products' },
  { label: 'Solutions', section: 'solutions' },
  { label: 'AI', section: 'ai' },
  { label: 'Resources', section: 'resources' },
  { label: 'Company', section: 'company' },
];

export const HERO = {
  headlineTop: 'RUN YOUR BUSINESS',
  headlineBottomPrefix: 'WITH ',
  /** Rendered in the primary accent. */
  headlineAccent: 'INTELLIGENCE.',
  statement: 'Your business has the data. Trackit X turns it into decisions.',
  description:
    'Trackit X connects projects, people, operations, inventory, finance and AI into one ' +
    'intelligent business operating system built for modern MSMEs.',
  primaryCta: 'Enter Trackit X',
  secondaryCta: 'See How It Works',
  trust: 'AI-powered operations • Built for MSMEs',
} as const;

// ---------------------------------------------------------------------------
// 1. Intelligence
// ---------------------------------------------------------------------------

export interface Capability {
  readonly icon: IconName;
  readonly title: string;
  readonly detail: string;
}

export const INTELLIGENCE = {
  eyebrow: 'Operational intelligence',
  title: 'SEE THE BUSINESS BEHIND THE DATA.',
  lead:
    'Every business already generates the signal it needs. It arrives as a photo of a ' +
    'delivery note, a message about a delay, a site attendance sheet — and then it scatters. ' +
    'Trackit X keeps it in one place and reads it as one business.',
  points: [
    {
      icon: 'database',
      title: 'One record of the business',
      detail:
        'Projects, people, stock, cash and documents stop living in separate books and start ' +
        'referring to each other.',
    },
    {
      icon: 'health',
      title: 'Position, not paperwork',
      detail:
        'Where the business actually stands today — margin under pressure, a job drifting, ' +
        'a crew overloaded — instead of a folder of forms.',
    },
    {
      icon: 'aiBrain',
      title: 'Reasoning you can check',
      detail:
        'Every conclusion carries the records it was drawn from, so a claim can be audited ' +
        'rather than believed.',
    },
  ] as readonly Capability[],
} as const;

// ---------------------------------------------------------------------------
// 2. The AI operating system
// ---------------------------------------------------------------------------

export interface OperatingStage {
  readonly step: string;
  readonly icon: IconName;
  readonly title: string;
  readonly detail: string;
}

export const OPERATING_SYSTEM = {
  eyebrow: 'The AI operating system',
  title: 'FIVE THINGS IT DOES, IN ORDER.',
  lead:
    'Not a chatbot bolted onto a database. A loop that runs over your own operations, where ' +
    'each stage only earns the next once it has something real to stand on.',
  stages: [
    {
      step: '01',
      icon: 'live',
      title: 'Observe',
      detail: 'Work, spend, stock movement and attendance are captured as they happen.',
    },
    {
      step: '02',
      icon: 'aiBrain',
      title: 'Understand',
      detail: 'Records are related to each other — this cost belongs to that delay.',
    },
    {
      step: '03',
      icon: 'simulation',
      title: 'Predict',
      detail: 'Where the current trajectory lands: overrun, shortfall, idle capacity.',
    },
    {
      step: '04',
      icon: 'aiInsight',
      title: 'Recommend',
      detail: 'The few moves that change the outcome, ranked by what they are worth.',
    },
    {
      step: '05',
      icon: 'aiAutomation',
      title: 'Automate',
      detail: 'The routine follow-ups run themselves, with a person still holding approval.',
    },
  ] as readonly OperatingStage[],
} as const;

// ---------------------------------------------------------------------------
// 3. Business health — SAMPLE FIGURES ONLY
// ---------------------------------------------------------------------------

export interface SampleMetric {
  readonly label: string;
  readonly value: string;
  readonly note: string;
  /** Where this sits on the health ramp, 0–1. Drives the bar only. */
  readonly level: number;
  readonly tone: 'success' | 'warning' | 'danger' | 'accent';
}

export const BUSINESS_HEALTH = {
  eyebrow: 'Business health',
  title: 'ONE SCORE. FOUR REASONS.',
  lead:
    'A single read on the business, and immediately underneath it the parts that produced ' +
    'the number — because a score you cannot take apart is a score you cannot act on.',
  /** Labelled in the UI as a sample. Not anyone's real business. */
  sampleLabel: 'Sample data — illustration only',
  score: '78',
  scoreCaption: 'Steady, with delivery under pressure',
  metrics: [
    {
      label: 'Cash position',
      value: 'Comfortable',
      note: '6.2 weeks of cover',
      level: 0.82,
      tone: 'success',
    },
    {
      label: 'Delivery',
      value: 'At risk',
      note: '2 of 9 jobs drifting',
      level: 0.46,
      tone: 'warning',
    },
    {
      label: 'Workforce',
      value: 'Stretched',
      note: '3 people over capacity',
      level: 0.58,
      tone: 'warning',
    },
    {
      label: 'Stock',
      value: 'Healthy',
      note: 'No line below reorder',
      level: 0.9,
      tone: 'success',
    },
  ] as readonly SampleMetric[],
} as const;

// ---------------------------------------------------------------------------
// 4. Copilot
// ---------------------------------------------------------------------------

export const COPILOT = {
  eyebrow: 'AI copilot',
  title: 'ASK THE BUSINESS A QUESTION.',
  lead:
    'Plain language in, your own records out. The copilot reads what your business has ' +
    'recorded and answers from it — and when the records do not support an answer, it says so ' +
    'instead of inventing one.',
  questions: [
    'Why is my project delayed?',
    'Who is overloaded?',
    'Where am I losing money?',
    'What should I prioritize today?',
  ],
  /** The sample exchange, labelled as an example in the UI. */
  exampleQuestion: 'Why is my project delayed?',
  exampleAnswer:
    'Two of the four site crews were reassigned mid-week, and the steel delivery logged on ' +
    'Tuesday covered 60% of the order.',
  exampleBasis: 'Derived from 3 task records, 1 delivery note, 2 crew assignments',
} as const;

// ---------------------------------------------------------------------------
// 5. Connected operations
// ---------------------------------------------------------------------------

export interface OperationDomain {
  readonly icon: IconName;
  readonly title: string;
  readonly detail: string;
}

export const CONNECTED_OPERATIONS = {
  eyebrow: 'Connected operations',
  title: 'ONE SYSTEM, NOT SEVEN TOOLS.',
  lead:
    'The cost of running a business on disconnected tools is not the subscriptions. It is that ' +
    'no tool can answer a question that spans two of them.',
  domains: [
    {
      icon: 'projects',
      title: 'Projects',
      detail: 'Scope, schedule and spend against budget, per job.',
    },
    {
      icon: 'tasks',
      title: 'Tasks',
      detail: 'Who owns what, what is late, what is blocking the rest.',
    },
    {
      icon: 'employees',
      title: 'People',
      detail: 'Attendance, capacity and wage cost, connected to the work.',
    },
    {
      icon: 'inventory',
      title: 'Inventory',
      detail: 'Stock on hand, committed and below reorder level.',
    },
    {
      icon: 'finance',
      title: 'Finance',
      detail: 'Cash in, cash out, and margin per job rather than per month.',
    },
    {
      icon: 'aiAgent',
      title: 'AI agents',
      detail: 'Routine operational follow-up, with approval kept human.',
    },
  ] as readonly OperationDomain[],
} as const;

// ---------------------------------------------------------------------------
// 6. Final call to action
// ---------------------------------------------------------------------------

export const FINAL_CTA = {
  titleTop: 'YOUR BUSINESS.',
  titleBottom: 'ONE INTELLIGENT OPERATING SYSTEM.',
  lead:
    'Set up your workspace, bring in your first project, and let Trackit X start reading the ' +
    'business you already run.',
  primaryCta: 'Enter Trackit X',
  secondaryCta: 'Start Operating',
  footnote: 'Your data stays yours. Every workspace is isolated at the database level.',
} as const;
