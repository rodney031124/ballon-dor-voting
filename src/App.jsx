import { useEffect, useMemo, useState } from "react";
import {
  onAuthStateChanged,
  signInAnonymously,
  signOut,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  auth,
  authReady,
  db,
  functions,
  missingFirebaseConfig,
} from "./firebase";
import { nominees } from "./nominees";

function Wordmark() {
  return (
    <a className="wordmark" href="/">
      <span className="wordmark-mark">B</span> BALLON D&apos;OR
      <span className="wordmark-year">2026</span>
    </a>
  );
}

function SiteFooter({ admin = false }) {
  return (
    <footer className="site-footer">
      <span>{admin ? "PRIVATE ADMIN DASHBOARD" : "THE BEAUTIFUL GAME, CELEBRATED"}</span>
      <a href={admin ? "/" : "/admin"}>{admin ? "BALLOT" : "ADMIN"}</a>
      <span>© 2026</span>
    </footer>
  );
}

function App() {
  const isAdminRoute = window.location.pathname.replace(/\/+$/, "") === "/admin";

  if (missingFirebaseConfig.length > 0) {
    return <FirebaseSetupError missingKeys={missingFirebaseConfig} />;
  }

  return isAdminRoute ? <AdminPage /> : <VotingApp />;
}

function FirebaseSetupError({ missingKeys }) {
  return (
    <>
      <header className="site-header">
        <Wordmark />
      </header>
      <main className="setup-error-main">
        <section className="setup-error-card" role="alert">
          <p className="eyebrow">DEPLOYMENT SETUP REQUIRED</p>
          <h1>Almost <span>ready.</span></h1>
          <p>
            This deployment is missing its public Firebase web-app
            configuration. Add the listed variables to your Vercel project,
            then create a new deployment.
          </p>
          <ul>
            {missingKeys.map((key) => <li key={key}><code>{key}</code></li>)}
          </ul>
          <p className="setup-error-note">
            In Vercel, open <strong>Project Settings → Environment Variables</strong>
            {" "}and add the values from your Firebase Web app settings. These are
            public client configuration values; never add your admin password
            or service-account credentials here.
          </p>
          <button
            className="button button-gold"
            type="button"
            onClick={() => window.location.reload()}
          >
            Reload page <span aria-hidden="true">↻</span>
          </button>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

function VotingApp() {
  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let unsubscribe;
    let creatingSession = false;
    let signingOut = false;

    authReady
      .then(() => {
        if (!active) return;
        unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
          if (!active) return;

          if (currentUser && !currentUser.isAnonymous) {
            setUser(null);
            if (!signingOut) {
              signingOut = true;
              signOut(auth)
                .catch((error) => {
                  if (active) {
                    setAuthError(`Could not switch to a voting session: ${error.message}`);
                    setAuthLoading(false);
                  }
                })
                .finally(() => {
                  signingOut = false;
                });
            }
            return;
          }

          setUser(currentUser);
          if (!currentUser) {
            if (!creatingSession) {
              creatingSession = true;
              signInAnonymously(auth)
                .catch((error) => {
                  if (active) {
                    setAuthError(`Could not start a voting session: ${error.message}`);
                    setAuthLoading(false);
                  }
                })
                .finally(() => {
                  creatingSession = false;
                });
            }
          } else {
            setAuthError("");
            setAuthLoading(false);
          }
        });
      })
      .catch((error) => {
        if (active) {
          setAuthError(`Could not initialize Firebase: ${error.message}`);
          setAuthLoading(false);
        }
      });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  if (authLoading) {
    return <div className="loading" role="status">Connecting to the ballot...</div>;
  }

  if (authError && !user) {
    return <p className="form-error" role="alert">{authError}</p>;
  }

  if (!user) {
    return <div className="loading" role="status">Preparing an anonymous voting session...</div>;
  }

  return <VotingPage user={user} authError={authError} />;
}

function VotingPage({ user, authError }) {
  const [selectedId, setSelectedId] = useState("");
  const [status, setStatus] = useState("checking");
  const [error, setError] = useState(authError);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    setStatus("checking");
    setError("");

    if (!user.isAnonymous) {
      signOut(auth).catch((cause) => {
        if (active) setError(`Could not switch to a voting session: ${cause.message}`);
      });
      return () => {
        active = false;
      };
    }

    getDoc(doc(db, "devices", user.uid))
      .then((snapshot) => {
        if (active) setStatus(snapshot.exists() ? "voted" : "ready");
      })
      .catch((cause) => {
        if (active) {
          setError(`We couldn't check this browser's vote status: ${cause.message}`);
          setStatus("error");
        }
      });

    return () => {
      active = false;
    };
  }, [user.uid, user.isAnonymous]);

  async function submitVote(event) {
    event.preventDefault();
    if (!user.isAnonymous || !selectedId || submitting) return;

    setSubmitting(true);
    setError("");
    try {
      await httpsCallable(functions, "castVote")({ nomineeId: selectedId });
      setStatus("voted");
    } catch (cause) {
      if (cause.code === "functions/already-exists") {
        setStatus("voted");
      } else {
        setError(`Your vote couldn't be submitted: ${cause.message}`);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <header className="site-header">
        <Wordmark />
        <a className="text-button admin-link" href="/admin">Admin <span aria-hidden="true">↗</span></a>
      </header>
      <main className="ballot-main">
        <div className="ballot-heading">
          <div>
            <p className="eyebrow"><span className="live-dot" /> THE PEOPLE&apos;S BALLOT <span className="separator">/</span> SCHOOL SHORTLIST</p>
            <h1>Who gets <span>your vote?</span></h1>
            <p className="heading-copy">Choose your winner. One vote per browser profile.</p>
          </div>
          <div className="vote-counter"><span>YOUR BALLOT</span><strong>00<small> / 01</small></strong></div>
        </div>

        {error && <p className="form-error" role="alert">{error}</p>}
        {status === "checking" && (
          <div className="loading" role="status">
            {user.isAnonymous ? "Checking this browser..." : "Preparing an anonymous voting session..."}
          </div>
        )}
        {status === "error" && (
          <button className="retry-button" type="button" onClick={() => window.location.reload()}>
            Try again
          </button>
        )}
        {status === "voted" && (
          <section className="success-card" role="status">
            <div className="success-icon" aria-hidden="true">✓</div>
            <div><p className="eyebrow">BALLOT RECEIVED</p><h2>Your vote is in.</h2><p>Thank you for taking part. This browser profile has already submitted its vote.</p></div>
            <span className="success-seal">ONE<br />VOTE<br />CAST</span>
          </section>
        )}
        {status === "ready" && (
          <form onSubmit={submitVote}>
            <div className="nominee-grid">
              {nominees.map((nominee, index) => (
                <label
                  className={`nominee-card${selectedId === nominee.id ? " is-selected" : ""}`}
                  htmlFor={`nominee-${nominee.id}`}
                  key={nominee.id}
                >
                  <input
                    id={`nominee-${nominee.id}`}
                    type="radio"
                    name="nominee"
                    value={nominee.id}
                    checked={selectedId === nominee.id}
                    onChange={() => setSelectedId(nominee.id)}
                    required
                  />
                  <span className="card-number">{String(index + 1).padStart(2, "0")}</span>
                  <span className={`player-avatar nominee-photo avatar-${nominee.color}`}>
                    {nominee.image ? (
                      <img src={nominee.image} alt="" loading="lazy" decoding="async" />
                    ) : <span>{nominee.initials}</span>}
                  </span>
                  <span className="player-info"><strong>{nominee.name}</strong><span>Ballot nominee</span></span>
                  <span className="select-indicator" aria-hidden="true">✓</span>
                </label>
              ))}
            </div>
            <div className="submit-bar">
              <p><span className="lock-icon" aria-hidden="true">◇</span> Your selection is not stored with your browser ID.</p>
              <button className="button button-gold submit-button" type="submit" disabled={!selectedId || submitting}>
                {submitting ? "Submitting..." : "Submit final vote"} <span aria-hidden="true">→</span>
              </button>
            </div>
          </form>
        )}
        <p className="shortlist-disclaimer">One vote per Firebase anonymous account. Clearing browser data or switching browsers may allow another vote.</p>
      </main>
      <SiteFooter />
    </>
  );
}

function AdminPage() {
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
        const { data } = await httpsCallable(functions, "getAdminResults")({ sessionToken });
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
        if (cause.code === "functions/unauthenticated") {
          setSessionToken("");
          setError("Your admin session expired. Please sign in again.");
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
      const { data } = await httpsCallable(functions, "authenticateAdmin")({ password });
      if (typeof data.sessionToken !== "string" || data.sessionToken.length === 0) {
        throw new Error("The server returned an invalid sign-in response.");
      }
      setSessionToken(data.sessionToken);
      setPassword("");
    } catch (cause) {
      setError(`Admin sign-in failed: ${cause.message}`);
    } finally {
      setSigningIn(false);
    }
  }

  async function signOutAdmin() {
    setError("");
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

export default App;
