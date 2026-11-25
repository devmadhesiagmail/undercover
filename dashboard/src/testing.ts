import { vi } from "vitest";
import type { Claim, Handler, History, Policy, Step } from "./api";

export function reply(status: number, body: unknown): () => Response {
  return () => new Response(JSON.stringify(body), { status });
}

export function stubApi(routes: Record<string, unknown>) {
  const fetchMock = vi.fn((path: string, init?: RequestInit) => {
    const route = routes[`${init?.method ?? "GET"} ${path}`] ?? routes[path];
    if (route === undefined) {
      return Promise.resolve(reply(404, { detail: `No route ${path}` })());
    }
    return Promise.resolve(
      typeof route === "function"
        ? (route as () => Response)()
        : new Response(JSON.stringify(route)),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export const claim: Claim = {
  claim_id: "CLM-1002",
  policy_id: "POL-2002",
  customer_id: "CUS-3002",
  customer_name: "Tom Becker",
  claim_type: "baggage",
  submitted_on: "2026-07-20",
  incident_date: "2026-06-21",
  incident_location: "Frankfurt, Germany",
  summary: "Suitcase lost on a connecting flight",
  story: "My suitcase never arrived in Prague.",
  items: [
    { description: "Hard-shell suitcase", category: "luggage", amount: 280 },
    { description: "Wool suit", category: "clothing", amount: 870 },
  ],
  amount_claimed: 1150,
  documents: [
    {
      name: "Northwind lost baggage report",
      type: "carrier_report",
      content: "The bag was declared lost after three weeks.",
    },
  ],
  status: "waiting",
  decision: null,
  sign_off: null,
  payment: null,
};

export const waitingForSignOff: Claim = {
  ...claim,
  status: "waiting_for_sign_off",
  decision: {
    decision: "approve",
    payout: 1150,
    reason: "The carrier lost the bag. Each item is within the limit.",
    policy_section: "Section 5, Baggage and Personal Effects",
    decided_at: "2026-11-25T03:42:59+00:00",
  },
};

export const policy: Policy = {
  policy_id: "POL-2002",
  plan: "premium",
  add_ons: ["electronics_plus"],
  purchased_on: "2026-05-01",
  trip: {
    destination: "Prague, Czech Republic",
    departs_on: "2026-06-20",
    returns_on: "2026-06-30",
    trip_cost: 2400,
  },
  travelers: ["Tom Becker", "Ana Becker"],
  plan_limits: {
    name: "UnderCover Premium",
    per_item_limit: 300,
    deductible: 50,
  },
  add_on_details: [
    { add_on: "electronics_plus", name: "Electronics Plus", effect: "More." },
  ],
};

export const history: History = {
  customer_id: "CUS-3002",
  name: "Tom Becker",
  customer_since: "2022-01-05",
  previous_claims: [
    {
      claim_id: "CLM-0301",
      filed_on: "2024-03-02",
      claim_type: "trip_delay",
      summary: "Delayed flight to Denver",
      outcome: "approved",
      amount_paid: 120,
    },
    {
      claim_id: "CLM-0377",
      filed_on: "2025-02-11",
      claim_type: "baggage",
      summary: "Scratched suitcase",
      outcome: "declined",
      amount_paid: 0,
    },
  ],
};

export const handlers: Handler[] = [
  {
    handler_id: "HND-01",
    name: "Dana Whitfield",
    role: "Senior Claims Handler",
    can_approve_over_limit: true,
  },
  {
    handler_id: "HND-04",
    name: "Sam Trainee",
    role: "Trainee",
    can_approve_over_limit: false,
  },
];

export function claimRoutes(shown: Claim, steps: Step[]) {
  return {
    [`/api/claims/${shown.claim_id}`]: shown,
    [`/api/claims/${shown.claim_id}/steps`]: steps,
    [`/api/policies/${shown.policy_id}`]: policy,
    [`/api/customers/${shown.customer_id}/history`]: history,
    "/api/handlers": handlers,
  };
}
