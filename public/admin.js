const resultsBody = document.querySelector("#results-body");
const totalVotes = document.querySelector("#total-votes");
const deviceCount = document.querySelector("#device-count");
const liveStatus = document.querySelector("#live-status");

function updateResults(data) {
  totalVotes.textContent = data.totalVotes.toLocaleString();
  deviceCount.textContent = `${data.deviceCount.toLocaleString()} UNIQUE DEVICES`;
  const rows = [...resultsBody.querySelectorAll("tr")];
  const byId = new Map(data.results.map((result) => [result.id, result.votes]));
  rows.sort((a, b) => (byId.get(b.dataset.id) || 0) - (byId.get(a.dataset.id) || 0)
    || a.querySelector(".result-player strong").textContent.localeCompare(b.querySelector(".result-player strong").textContent));

  rows.forEach((row, index) => {
    const votes = byId.get(row.dataset.id) || 0;
    const share = data.totalVotes ? Math.round(votes / data.totalVotes * 100) : 0;
    row.dataset.votes = votes;
    row.querySelector(".rank-number").textContent = String(index + 1).padStart(2, "0");
    row.querySelector(".rank-number").classList.toggle("rank-first", index === 0 && votes > 0);
    row.querySelector(".count-cell").textContent = votes.toLocaleString();
    row.querySelector(".share-track").value = share;
    row.querySelector(".share-value").textContent = `${share}%`;
    resultsBody.appendChild(row);
  });
}

async function checkAdminSession() {
  try {
    const response = await fetch("/admin/results", { headers: { Accept: "application/json" } });
    if (response.redirected) {
      window.location.assign("/admin");
    }
  } catch (error) {
    console.error("Could not verify the admin session:", error);
  }
}

const resultsStream = new EventSource("/admin/live");
resultsStream.addEventListener("results", (event) => {
  try {
    updateResults(JSON.parse(event.data));
    liveStatus.innerHTML = "<i></i> LIVE";
  } catch (error) {
    console.error("Could not display live vote results:", error);
  }
});
resultsStream.addEventListener("service-error", (event) => {
  liveStatus.textContent = "RECONNECTING";
  console.error("Live results service reported an error:", event.data);
});
resultsStream.onerror = () => {
  liveStatus.textContent = "RECONNECTING";
  checkAdminSession();
};
