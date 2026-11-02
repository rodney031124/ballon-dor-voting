export function Wordmark() {
  return (
    <a className="wordmark" href="/">
      <span className="wordmark-mark">B</span> BALLON D&apos;OR
      <span className="wordmark-year">2026</span>
    </a>
  );
}

export function SiteFooter({ admin = false }) {
  return (
    <footer className="site-footer">
      <span>{admin ? "PRIVATE ADMIN DASHBOARD" : "THE BEAUTIFUL GAME, CELEBRATED"}</span>
      <a href={admin ? "/" : "/admin"}>{admin ? "BALLOT" : "ADMIN"}</a>
      <span>© 2026</span>
    </footer>
  );
}
