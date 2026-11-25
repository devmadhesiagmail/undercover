import { useEffect, useState } from "react";

export const POLL_MS = 2000;

export type Status =
  "waiting" | "in_progress" | "waiting_for_sign_off" | "decided";

export type DecisionKind = "approve" | "decline" | "refer";

export interface ClaimSummary {
  claim_id: string;
  customer_name: string;
  claim_type: string;
  submitted_on: string;
  amount_claimed: number;
  status: Status;
  decision: DecisionKind | null;
  payout: number | null;
}

export interface Item {
  description: string;
  category: string;
  amount: number;
}

export interface ClaimDocument {
  name: string;
  type: string;
  content: string;
}

export interface Decision {
  decision: DecisionKind;
  payout: number;
  reason: string;
  policy_section: string;
  decided_at: string;
}

export interface SignOffRecord {
  handler_id: string;
  handler_name: string;
  signed_off_at: string;
}

export interface Payment {
  amount: number;
  paid_at: string;
}

export interface Claim {
  claim_id: string;
  policy_id: string;
  customer_id: string;
  customer_name: string;
  claim_type: string;
  submitted_on: string;
  incident_date: string;
  incident_location: string;
  summary: string;
  story: string;
  items: Item[];
  amount_claimed: number;
  documents: ClaimDocument[];
  status: Status;
  decision: Decision | null;
  sign_off: SignOffRecord | null;
  payment: Payment | null;
}

export interface AddOn {
  add_on: string;
  name: string;
  effect: string;
}

export interface Policy {
  policy_id: string;
  plan: string;
  add_ons: string[];
  purchased_on: string;
  trip: {
    destination: string;
    departs_on: string;
    returns_on: string;
    trip_cost: number;
  };
  travelers: string[];
  plan_limits: { name: string; per_item_limit: number; deductible: number };
  add_on_details: AddOn[];
}

export interface PreviousClaim {
  claim_id: string;
  filed_on: string;
  claim_type: string;
  summary: string;
  outcome: string;
  amount_paid: number;
}

export interface History {
  customer_id: string;
  name: string;
  customer_since: string;
  previous_claims: PreviousClaim[];
}

export interface Handler {
  handler_id: string;
  name: string;
  role: string;
  can_approve_over_limit: boolean;
}

export interface Step {
  step_id: number;
  thread_id: string;
  kind: "start" | "call" | "result" | "message";
  detail: string;
  created_at: string;
}

async function read<T>(response: Response): Promise<T> {
  const body: unknown = await response.json();
  if (!response.ok) {
    const detail =
      typeof body === "object" && body !== null && "detail" in body
        ? body.detail
        : undefined;
    throw new Error(
      typeof detail === "string"
        ? detail
        : `The request failed with status ${String(response.status)}`,
    );
  }
  return body as T;
}

export async function getJson<T>(path: string): Promise<T> {
  return read<T>(await fetch(path));
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  return read<T>(
    await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export interface Loaded<T> {
  data: T | undefined;
  error: string | undefined;
  reload: () => void;
}

export function useJson<T>(path: string, pollMs: number | null): Loaded<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    const load = () => {
      getJson<T>(path).then(
        (value) => {
          if (active) {
            setData(value);
            setError(undefined);
          }
        },
        (reason: unknown) => {
          if (active) setError(String(reason));
        },
      );
    };
    load();
    const timer = pollMs === null ? undefined : setInterval(load, pollMs);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [path, pollMs, version]);

  return {
    data,
    error,
    reload: () => {
      setVersion((n) => n + 1);
    },
  };
}
