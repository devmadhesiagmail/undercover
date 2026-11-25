import type { ReactNode } from "react";
import { type Claim, type History, POLL_MS, type Policy, useJson } from "./api";
import { clock, date, decisionLabel, money, words } from "./format";
import { Loading } from "./Loading";
import { SignOff } from "./SignOff";
import { StatusBadge } from "./StatusBadge";
import { Steps } from "./Steps";

function Fact({
  label,
  children,
}: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Header({ claim }: Readonly<{ claim: Claim }>) {
  return (
    <>
      <p className="back">
        <a href="#/">Back to the queue</a>
      </p>
      <div className="page-heading">
        <h1 className="mono">{claim.claim_id}</h1>
        <StatusBadge status={claim.status} />
      </div>
      <p className="lede">{claim.summary}</p>
      <dl className="panel facts">
        <Fact label="Customer">{claim.customer_name}</Fact>
        <Fact label="Type">{words(claim.claim_type)}</Fact>
        <Fact label="Submitted">{date(claim.submitted_on)}</Fact>
        <Fact label="Incident">
          {date(claim.incident_date)}, {claim.incident_location}
        </Fact>
        <Fact label="Claimed">
          <span className="mono">{money(claim.amount_claimed)}</span>
        </Fact>
      </dl>
    </>
  );
}

function Outcome({ claim }: Readonly<{ claim: Claim }>) {
  const { decision, sign_off: signOff, payment } = claim;
  if (!decision) return null;
  return (
    <ul className="outcome">
      {signOff && (
        <li>
          Signed off by {signOff.handler_name}
          <span className="muted">
            {" "}
            on {date(signOff.signed_off_at)} at {clock(signOff.signed_off_at)}
          </span>
        </li>
      )}
      {claim.status === "waiting_for_sign_off" && (
        <li>Waiting for a handler's sign-off</li>
      )}
      {payment && (
        <li>
          Paid {money(payment.amount)}
          <span className="muted">
            {" "}
            on {date(payment.paid_at)} at {clock(payment.paid_at)}
          </span>
        </li>
      )}
      {!payment && decision.decision === "approve" && <li>Not paid yet</li>}
      {decision.decision !== "approve" && <li>Nothing to pay</li>}
    </ul>
  );
}

function DecisionPanel({
  claim,
  onChange,
}: Readonly<{ claim: Claim; onChange: () => void }>) {
  const { decision } = claim;
  const needsPayment =
    decision?.decision === "approve" &&
    claim.payment === null &&
    (claim.status === "waiting_for_sign_off" || claim.sign_off !== null);
  return (
    <section className="panel" aria-labelledby="decision-heading">
      <h2 id="decision-heading">The agent's decision</h2>
      {decision ? (
        <>
          <p className="decision">
            {decisionLabel(decision.decision, decision.payout)}
          </p>
          <p>{decision.reason}</p>
          <p className="muted">
            {decision.policy_section}. Decided {date(decision.decided_at)} at{" "}
            {clock(decision.decided_at)}.
          </p>
          <Outcome claim={claim} />
        </>
      ) : (
        <p className="muted">No decision yet</p>
      )}
      {needsPayment && <SignOff claim={claim} onDone={onChange} />}
    </section>
  );
}

function ClaimDetails({ claim }: Readonly<{ claim: Claim }>) {
  return (
    <section className="panel" aria-labelledby="claim-heading">
      <h2 id="claim-heading">The claim</h2>
      <p className="story">{claim.story}</p>
      <h3>Items</h3>
      <table className="items">
        <thead>
          <tr>
            <th>Item</th>
            <th>Category</th>
            <th className="amount">Amount</th>
          </tr>
        </thead>
        <tbody>
          {claim.items.map((item) => (
            <tr key={item.description}>
              <td>{item.description}</td>
              <td>{words(item.category)}</td>
              <td className="amount mono">{money(item.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>Total claimed</td>
            <td className="amount mono">{money(claim.amount_claimed)}</td>
          </tr>
        </tfoot>
      </table>
      <h3>Documents</h3>
      <div className="stack">
        {claim.documents.map((document) => (
          <article className="document-card" key={document.name}>
            <h4>
              {document.name}{" "}
              <span className="badge badge-quiet">{words(document.type)}</span>
            </h4>
            <p>{document.content}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function PolicyPanel({ policyId }: Readonly<{ policyId: string }>) {
  const { data: policy, error } = useJson<Policy>(
    `/api/policies/${policyId}`,
    null,
  );
  return (
    <section className="panel" aria-labelledby="policy-heading">
      <h2 id="policy-heading">
        The policy <span className="mono muted">{policyId}</span>
      </h2>
      {policy ? (
        <dl className="facts facts-list">
          <Fact label="Plan">{policy.plan_limits.name}</Fact>
          <Fact label="Add-ons">
            {policy.add_on_details.map((addOn) => addOn.name).join(", ") ||
              "None"}
          </Fact>
          <Fact label="Limits">
            Per item{" "}
            <span className="mono">
              {money(policy.plan_limits.per_item_limit)}
            </span>
            , deductible{" "}
            <span className="mono">{money(policy.plan_limits.deductible)}</span>
          </Fact>
          <Fact label="Bought">{date(policy.purchased_on)}</Fact>
          <Fact label="Trip">
            {policy.trip.destination}, {date(policy.trip.departs_on)} to{" "}
            {date(policy.trip.returns_on)}
          </Fact>
          <Fact label="Trip cost">
            <span className="mono">{money(policy.trip.trip_cost)}</span>
          </Fact>
          <Fact label="Travelers">{policy.travelers.join(", ")}</Fact>
        </dl>
      ) : (
        <Loading error={error} />
      )}
    </section>
  );
}

function CustomerPanel({ customerId }: Readonly<{ customerId: string }>) {
  const { data: history, error } = useJson<History>(
    `/api/customers/${customerId}/history`,
    null,
  );
  return (
    <section className="panel" aria-labelledby="customer-heading">
      <h2 id="customer-heading">The customer</h2>
      {history ? (
        <>
          <dl className="facts facts-list">
            <Fact label="Name">{history.name}</Fact>
            <Fact label="Customer since">{date(history.customer_since)}</Fact>
          </dl>
          <h3>Earlier claims</h3>
          {history.previous_claims.length === 0 ? (
            <p className="muted">No earlier claims</p>
          ) : (
            <ul className="history">
              {history.previous_claims.map((previous) => (
                <li key={previous.claim_id}>
                  <span className="mono">{previous.claim_id}</span>{" "}
                  {words(previous.claim_type)}, filed {date(previous.filed_on)}:{" "}
                  {previous.summary}.{" "}
                  <strong>
                    {words(previous.outcome)}
                    {previous.amount_paid > 0 &&
                      `, paid ${money(previous.amount_paid)}`}
                  </strong>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <Loading error={error} />
      )}
    </section>
  );
}

export function ClaimPage({ claimId }: Readonly<{ claimId: string }>) {
  const {
    data: claim,
    error,
    reload,
  } = useJson<Claim>(`/api/claims/${claimId}`, POLL_MS);
  if (!claim) return <Loading error={error} />;
  return (
    <>
      <Header claim={claim} />
      <div className="claim-layout">
        <div className="stack">
          <DecisionPanel claim={claim} onChange={reload} />
          <ClaimDetails claim={claim} />
        </div>
        <div className="stack">
          <section className="panel" aria-labelledby="steps-heading">
            <h2 id="steps-heading">The agent's steps</h2>
            <Steps claimId={claimId} />
          </section>
          <PolicyPanel policyId={claim.policy_id} />
          <CustomerPanel customerId={claim.customer_id} />
        </div>
      </div>
    </>
  );
}
