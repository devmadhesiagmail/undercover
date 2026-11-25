import { useState } from "react";
import { type Claim, type Handler, postJson, useJson } from "./api";
import { money } from "./format";

export function SignOff({
  claim,
  onDone,
}: Readonly<{ claim: Claim; onDone: () => void }>) {
  const { data: handlers } = useJson<Handler[]>("/api/handlers", null);
  const [handlerId, setHandlerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const payout = claim.decision?.payout ?? 0;
  const signedOff = claim.sign_off !== null;

  async function signOffAndPay() {
    setBusy(true);
    setError(undefined);
    try {
      if (!signedOff) {
        await postJson(`/api/claims/${claim.claim_id}/sign-off`, {
          handler_id: handlerId,
        });
      }
      await postJson(`/api/claims/${claim.claim_id}/payment`, {
        amount: payout,
      });
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
      onDone();
    }
  }

  return (
    <form
      className="sign-off"
      onSubmit={(event) => {
        event.preventDefault();
        void signOffAndPay();
      }}
    >
      <h3>Handler sign-off</h3>
      {signedOff ? (
        <p className="muted">Signed off, but not paid yet.</p>
      ) : (
        <>
          <p className="muted">
            This payout is over the approval limit, so a handler must sign it
            off before it is paid.
          </p>
          <label>
            Handler
            <select
              value={handlerId}
              onChange={(event) => {
                setHandlerId(event.target.value);
              }}
            >
              <option value="">Choose a handler</option>
              {handlers
                ?.filter((handler) => handler.can_approve_over_limit)
                .map((handler) => (
                  <option key={handler.handler_id} value={handler.handler_id}>
                    {handler.name}, {handler.role}
                  </option>
                ))}
            </select>
          </label>
        </>
      )}
      <button type="submit" disabled={busy || (!signedOff && handlerId === "")}>
        {signedOff ? "Pay" : "Sign off and pay"} {money(payout)}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
