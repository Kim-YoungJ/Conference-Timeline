// one row of the conference's own schedule table, label as announced by the site
export interface ScheduleItem {
  label: string; // "Abstract deadline", "Camera-ready", "Conference start"…
  date: string | null; // ISO UTC, null if TBD
  display?: string; // optional raw text to show instead of the formatted date
}

export interface ConferenceYear {
  id: string; // "icra26"
  year: number;
  link: string;
  deadline: string | null; // ISO UTC, null if TBD (kept for compat; state derives from schedule)
  abstractDeadline?: string;
  schedule?: ScheduleItem[]; // full schedule table; synthesized from the fields above when absent
  dateText: string; // "Jun 1-5, 2026" (display only)
  place: string; // "Vienna, Austria"
  timezone?: string; // deadline timezone as announced by the venue: "AoE", "UTC-8", "KST"…
  lat?: number;
  lng?: number;
}

export interface Conference {
  slug: string;
  title: string;
  fullName: string;
  rank?: string; // "CCF B / CORE A*"
  source: 'ccfddl' | 'custom';
  years: ConferenceYear[];
}

export interface Journal {
  id: string;
  name: string;
  publisher?: string;
  quartile?: 'Q1' | 'Q2' | 'Q3' | 'Q4'; // bundled SJR extract
  impactFactor?: number; // user-entered
  link?: string;
}

export const STAGES = ['idea', 'drafting', 'submitted', 'review', 'revision', 'accepted', 'rejected'] as const;
export type Stage = (typeof STAGES)[number];

export interface Submission {
  id: string;
  title: string;
  journalId?: string;
  stage: Stage;
  submittedAt?: string;
  notes?: string;
  updatedAt: string;
}

export interface UserData {
  tracked: string[]; // conference slugs
  customConferences: Conference[];
  journals: Journal[];
  submissions: Submission[];
}
