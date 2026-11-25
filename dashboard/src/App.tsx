import { useSyncExternalStore } from "react";
import { ClaimPage } from "./ClaimPage";
import { Instructions } from "./Instructions";
import { Queue } from "./Queue";

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
  };
}

function useHash(): string {
  return useSyncExternalStore(subscribe, () => window.location.hash);
}

function Page({ path }: Readonly<{ path: string }>) {
  if (path === "/") return <Queue />;
  if (path === "/instructions") return <Instructions />;
  const claim = /^\/claims\/([\w-]+)$/.exec(path);
  if (claim) return <ClaimPage key={claim[1]} claimId={claim[1]} />;
  return (
    <>
      <h1>Page not found</h1>
      <p>
        <a href="#/">Back to the queue</a>
      </p>
    </>
  );
}

export function App() {
  const path = useHash().replace(/^#/, "") || "/";
  const section = path.startsWith("/instructions") ? "instructions" : "queue";

  return (
    <div className="app">
      <header className="masthead">
        <a className="brand" href="#/">
          <span className="brand-name">UnderCover</span>
          <span className="brand-tagline">Claims desk</span>
        </a>
        <nav aria-label="Main">
          <a href="#/" aria-current={section === "queue" ? "page" : undefined}>
            Queue
          </a>
          <a
            href="#/instructions"
            aria-current={section === "instructions" ? "page" : undefined}
          >
            Instructions
          </a>
        </nav>
      </header>
      <main>
        <Page path={path} />
      </main>
    </div>
  );
}
