import { tmpdir } from "node:os";
import { join } from "node:path";

export const E2E_DB = join(tmpdir(), "undercover-e2e.db");
export const BACKEND = "http://127.0.0.1:8001";
