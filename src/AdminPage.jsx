import { useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";
import { nominees } from "./nominees";
import { SiteFooter, Wordmark } from "./SiteChrome";

const useFirebaseFunctions = import.meta.env.DEV;

async function requestAdminApi(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "The admin service could not complete the request.");
    error.status = response.status;
    throw error;
  }
  return data;
}

export function AdminPage() {
  const [adminState, setAdminState] = useState("checking");
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [rows, setRows] = useState([]);
  const [live, setLive] = useState(false);
  const [sessionToken, setSessionToken] = useState("");

  useEffect(() => {
    if (sessionToken) {
      setAdminState("authorized");
      return undefined;
    }

    setAdminState("signed-out");
    return () => {
      setRows([]);
      setLive(false);
    };
  }, [sessionToken]);

  useEffect(() => {
    if (!sessionToken) return undefined;

    let active = true;
    let requestInFlight = false;

    async function refreshResults() {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const data = useFirebaseFunctions
          ? (await httpsCallable(functions, "getAdminResults")({ sessionToken })).data
          : await requestAdminApi("/api/admin/results");
        if (!active) return;
        const counts = new Map(data.results.map((result) => [result.id, result.votes]));
        setRows(nominees.map((nominee, index) => ({
          ...nominee,
          votes: counts.get(nominee.id) ?? 0,
          index,
        })));
        setLive(true);
        setError("");
      } catch (cause) {
        if (!active) return;
        setLive(false);
        if (cause.status === 401 || cause.code === "functions/unauthenticated") {
          setSessionToken("");
          setError("Your admin session expired. Sign in again.");
        } else {
          setError(`Live results are unavailable: ${cause.message}`);
        }
      } finally {
        requestInFlight = false;
      }
    }

    refreshResults();
    const timer = window.setInterval(refreshResults, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [sessionToken]);

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => b.votes - a.votes || a.index - b.index),
    [rows],
  );
  const totalVotes = rows.reduce((total, row) => total + row.votes, 0);

  async function signInAdmin(event) {
    event.preventDefault();
    setError("");
    setSigningIn(true);
    try {
      if (useFirebaseFunctions) {
        const { data } = await httpsCallable(functions, "authenticateAdmin")({ password });
        if (typeof data.sessionToken !== "string" || data.sessionToken.length === 0) {
          throw new Error("The server returned an invalid sign-in response.");
        }
        setSessionToken(data.sessionToken);
      } else {
        await requestAdminApi("/api/admin/login", {
          method: "POST",
          body: JSON.stringify({ password }),
        });
        setSessionToken("authenticated");
      }
      setPassword("");
    } catch (cause) {
      setError(`Admin sign-in failed: ${cause.message}`);
    } finally {
      setSigningIn(false);
    }
  }

  async function signOutAdmin() {
    setError("");
    if (!useFirebaseFunctions) {
      try {
        await requestAdminApi("/api/admin/logout", { method: "POST" });
      } catch (cause) {
        setError(`Could not complete server sign-out: ${cause.message}`);
      }
    }
    setSessionToken("");
    setRows([]);
  }

  return (
    <>
      <header className="site-header">
        <Wordmark />
        <div className="header-right">
          {adminState === "authorized" && <span className="admin-badge">ADMINISTRATOR</span>}
          {adminState === "authorized" && <button className="text-button" type="button" onClick={signOutAdmin}>Sign out <span aria-hidden="true">↗</span></button>}
        </div>
      </header>
      <main className="admin-main">
        {adminState === "signed-out" && (
          <section className="admin-login-card">
            <p className="eyebrow">RESTRICTED ACCESS</p>
            <h1>Admin <span>sign in.</span></h1>
            <p className="heading-copy">Enter the administrator password to view live results.</p>
            <form className="login-form" onSubmit={signInAdmin}>
              <label htmlFor="admin-password">Administrator password</label>
              <input
                id="admin-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <button className="button button-gold" type="submit" disabled={signingIn}>
                {signingIn ? "Verifying..." : "Sign in"} <span aria-hidden="true">→</span>
              </button>
            </form>
          </section>
        )}
        {adminState === "checking" && <div className="loading" role="status">Verifying administrator access...</div>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {adminState === "authorized" && (
          <>
            <div className="admin-heading">
              <div><p className="eyebrow"><span className="live-dot" /> LIVE FROM THE BALLOT BOX</p><h1>The people&apos;s <span>choice.</span></h1><p className="heading-copy">Every voice, counted. No names attached.</p></div>
              <div className="total-card"><span>TOTAL VOTES</span><strong>{totalVotes.toLocaleString()}</strong><small>{live ? "LIVE UPDATES ACTIVE" : "CONNECTING..."}</small></div>
            </div>
            <section className="results-card">
              <div className="results-title"><div><p className="eyebrow">THE LEADERBOARD</p><h2>Vote count</h2></div><span className="live-status"><i /> {live ? "LIVE" : "CONNECTING"}</span></div>
              <div className="results-table-wrap"><table className="results-table">
                <thead><tr><th>POSITION</th><th>NOMINEE</th><th>VOTES</th><th>SHARE</th></tr></thead>
                <tbody>
                  {sortedRows.map((nominee, index) => {
                    const share = totalVotes ? Math.round((nominee.votes / totalVotes) * 100) : 0;
                    return (
                      <tr key={nominee.id}>
                        <td><span className={`rank-number${index === 0 && nominee.votes > 0 ? " rank-first" : ""}`}>{String(index + 1).padStart(2, "0")}</span></td>
                        <td><span className="result-player"><span className={`player-avatar result-avatar avatar-${nominee.color}`}>
                          {nominee.image ? <img src={nominee.image} alt="" loading="lazy" decoding="async" /> : <span>{nominee.initials}</span>}
                        </span><strong>{nominee.name}</strong></span></td>
                        <td className="count-cell">{nominee.votes.toLocaleString()}</td>
                        <td><progress className="share-track" max="100" value={share} /><span className="share-value">{share}%</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
              <div className="results-foot"><span>Updates live from Firestore</span><span>Vote totals only; device IDs are not shown</span></div>
            </section>
            <p className="shortlist-disclaimer">Anonymous account identifiers are kept separately from aggregate vote totals. Individual selections are never stored.</p>
          </>
        )}
      </main>
      <SiteFooter admin />
    </>
  );
}
