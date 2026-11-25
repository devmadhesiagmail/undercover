import { POLL_MS, type ClaimSummary, type Status, useJson } from "./api";
import { date, decisionLabel, money, words } from "./format";
import { Loading } from "./Loading";
import { StatusBadge } from "./StatusBadge";

const STATUSES: Status[] = [
  "waiting",
  "in_progress",
  "waiting_for_sign_off",
  "decided",
];

export function Queue() {
  const { data: claims, error } = useJson<ClaimSummary[]>(
    "/api/claims",
    POLL_MS,
  );

  return (
    <>
      <div className="page-heading">
        <h1>Claims queue</h1>
      </div>
      <p className="lede">
        Every claim in queue order, with where it stands. Open a claim to see
        the agent's work.
      </p>
      {claims ? (
        <>
          <section className="counts" aria-label="Claims in each state">
            {STATUSES.map((status) => (
              <div className="panel count" key={status}>
                <span className="count-number">
                  {claims.filter((claim) => claim.status === status).length}
                </span>
                <StatusBadge status={status} />
              </div>
            ))}
          </section>
          <section className="panel table-scroll">
            <table className="queue">
              <thead>
                <tr>
                  <th>Claim</th>
                  <th>Customer</th>
                  <th>Type</th>
                  <th>Submitted</th>
                  <th className="amount">Claimed</th>
                  <th>Status</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {claims.map((claim) => (
                  <tr key={claim.claim_id}>
                    <td>
                      <a
                        className="claim-link"
                        href={`#/claims/${claim.claim_id}`}
                      >
                        {claim.claim_id}
                      </a>
                    </td>
                    <td>{claim.customer_name}</td>
                    <td>{words(claim.claim_type)}</td>
                    <td>{date(claim.submitted_on)}</td>
                    <td className="amount mono">
                      {money(claim.amount_claimed)}
                    </td>
                    <td>
                      <StatusBadge status={claim.status} />
                    </td>
                    <td>
                      {claim.decision ? (
                        decisionLabel(claim.decision, claim.payout)
                      ) : (
                        <span className="muted">None yet</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      ) : (
        <Loading error={error} />
      )}
    </>
  );
}
