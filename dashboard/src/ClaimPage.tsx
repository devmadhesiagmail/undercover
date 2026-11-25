export function ClaimPage({ claimId }: Readonly<{ claimId: string }>) {
  return (
    <>
      <p>
        <a href="#/">Back to the queue</a>
      </p>
      <div className="page-heading">
        <h1 className="mono">{claimId}</h1>
      </div>
    </>
  );
}
