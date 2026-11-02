import { AdminPage } from "./AdminPage";
import { missingFirebaseConfig } from "./firebase";
import { SiteFooter, Wordmark } from "./SiteChrome";
import { VotingPage } from "./VotingPage";

function App() {
  const isAdminRoute = window.location.pathname.replace(/\/+$/, "") === "/admin";

  if (missingFirebaseConfig.length > 0) {
    return <FirebaseSetupError missingKeys={missingFirebaseConfig} />;
  }

  return isAdminRoute ? <AdminPage /> : <VotingPage />;
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

export default App;
