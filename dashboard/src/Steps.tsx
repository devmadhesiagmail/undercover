import { POLL_MS, type Step, useJson } from "./api";
import { clock } from "./format";
import { Loading } from "./Loading";

function split(detail: string, separator: string): [string, string] {
  const at = detail.indexOf(separator);
  return at === -1
    ? [detail, ""]
    : [detail.slice(0, at), detail.slice(at + separator.length)];
}

function pretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function Result({ detail }: Readonly<{ detail: string }>) {
  const [tool, output] = split(detail, ": ");
  const refusal = output.startsWith("Refused: ")
    ? output.slice("Refused: ".length)
    : undefined;
  return (
    <details className={refusal ? "step-result refused" : "step-result"}>
      <summary>
        {refusal ? (
          <>
            <span className="badge badge-refused">Refused</span>{" "}
            <span className="mono">{tool}</span>: {refusal}
          </>
        ) : (
          <>
            Result from <span className="mono">{tool}</span>
          </>
        )}
      </summary>
      <pre>{pretty(output)}</pre>
    </details>
  );
}

function StepBody({ step }: Readonly<{ step: Step }>) {
  switch (step.kind) {
    case "start":
      return <p className="step-text">{step.detail}</p>;
    case "call": {
      const [tool, args] = split(step.detail, " ");
      return (
        <p className="step-text">
          Called <span className="mono">{tool}</span>{" "}
          <code className="step-args">{args}</code>
        </p>
      );
    }
    case "result":
      return <Result detail={step.detail} />;
    case "message":
      return <p className="step-text step-message">{step.detail}</p>;
  }
}

const KIND_LABELS: Record<Step["kind"], string> = {
  start: "Start",
  call: "Tool call",
  result: "Result",
  message: "Agent",
};

export function Steps({ claimId }: Readonly<{ claimId: string }>) {
  const { data: steps, error } = useJson<Step[]>(
    `/api/claims/${claimId}/steps`,
    POLL_MS,
  );
  if (!steps) return <Loading error={error} />;
  if (steps.length === 0) {
    return <p className="muted">The agent hasn't started this claim.</p>;
  }
  return (
    <ol className="steps">
      {steps.map((step) => (
        <li key={step.step_id} className={`step step-${step.kind}`}>
          <div className="step-meta">
            <span>{KIND_LABELS[step.kind]}</span>
            <time className="mono" dateTime={step.created_at}>
              {clock(step.created_at)}
            </time>
          </div>
          <StepBody step={step} />
        </li>
      ))}
    </ol>
  );
}
