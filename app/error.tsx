"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="standalone">
      <h1>A moment to pause.</h1>
      <p>We couldn’t open this page. Please try again.</p>
      <button onClick={reset} className="button primary">
        Try again
      </button>
    </main>
  );
}
