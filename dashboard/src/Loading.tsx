export function Loading({ error }: Readonly<{ error: string | undefined }>) {
  return error ? (
    <p className="notice error" role="alert">
      Can't load this page. {error}
    </p>
  ) : (
    <p className="notice">Loading</p>
  );
}
