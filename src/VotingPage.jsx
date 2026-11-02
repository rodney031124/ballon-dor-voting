import { useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInAnonymously,
  signOut,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, authReady, db, functions } from "./firebase";
import { nominees } from "./nominees";
import { SiteFooter, Wordmark } from "./SiteChrome";

export function VotingPage() {
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

  return <Ballot user={user} authError={authError} />;
}

function Ballot({ user, authError }) {
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
      if (
        import.meta.env.DEV
        || import.meta.env.VITE_USE_FIREBASE_VOTE_FUNCTION === "true"
      ) {
        await httpsCallable(functions, "castVote")({ nomineeId: selectedId });
      } else {
        const idToken = await user.getIdToken();
        const response = await fetch("/api/vote", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ nomineeId: selectedId }),
        });
        const responseBody = await response.text();
        let result;
        try {
          result = JSON.parse(responseBody);
        } catch {
          throw new Error(
            `Voting service returned an unexpected response (HTTP ${response.status}). Please try again.`,
          );
        }
        if (response.status === 409) {
          setStatus("voted");
          return;
        }
        if (!response.ok) {
          throw new Error(result.error || "The voting service is unavailable. Please try again.");
        }
      }
      setStatus("voted");
    } catch (cause) {
      if (cause.code === "functions/already-exists") {
        setStatus("voted");
      } else if (cause.code === "functions/internal" || cause.code === "functions/unavailable") {
        setError("The voting service is temporarily unavailable. Please try again.");
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
