const ballotForm = document.querySelector("#ballot-form");
const deviceIdInput = document.querySelector("#device-id");
const statusLoading = document.querySelector("#status-loading");
const ballotContent = document.querySelector("#ballot-content");
const successCard = document.querySelector("#success-card");
const deviceError = document.querySelector("#device-error");
const deviceErrorMessage = document.querySelector("#device-error-message");
const retryButton = document.querySelector("#retry-status");
const ballotCounter = document.querySelector(".vote-counter strong");
const deviceIdKey = "ballon_dor_device_id";
const hasVotedKey = "has_voted_2026";

function createDeviceId() {
  if (window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function getDeviceId() {
  let deviceId = window.localStorage.getItem(deviceIdKey);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceId || "")) {
    deviceId = createDeviceId();
    window.localStorage.setItem(deviceIdKey, deviceId);
  }
  return deviceId;
}

function showSuccess() {
  statusLoading.hidden = true;
  deviceError.hidden = true;
  ballotContent.hidden = true;
  successCard.hidden = false;
  ballotCounter.innerHTML = `01<small> / 01</small>`;
  try {
    window.localStorage.setItem(hasVotedKey, "true");
  } catch (error) {
    console.error("Could not cache this device's ballot status:", error);
  }
}

function showBallot() {
  statusLoading.hidden = true;
  deviceError.hidden = true;
  successCard.hidden = true;
  ballotContent.hidden = false;
  ballotCounter.innerHTML = `00<small> / 01</small>`;
}

function showStatusError(message) {
  statusLoading.hidden = true;
  ballotContent.hidden = true;
  deviceErrorMessage.textContent = message;
  deviceError.hidden = false;
}

async function checkDeviceStatus(deviceId, cachedVote = false) {
  statusLoading.hidden = cachedVote;
  deviceError.hidden = true;
  try {
    const response = await fetch("/api/voter-status", {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ deviceId }),
    });
    if (!response.ok) {
      throw new Error(`The server could not check this device (${response.status}).`);
    }
    const result = await response.json();
    if (result.hasVoted) {
      showSuccess();
      return;
    }
    window.localStorage.removeItem(hasVotedKey);
    showBallot();
  } catch (error) {
    console.error("Could not check device voting status:", error);
    if (cachedVote) {
      return;
    }
    showStatusError("We couldn't check whether this device has voted. Check your connection and try again.");
  }
}

try {
  const deviceId = getDeviceId();
  deviceIdInput.value = deviceId;
  const cachedVote = window.localStorage.getItem(hasVotedKey) === "true";
  if (cachedVote) {
    showSuccess();
  }
  checkDeviceStatus(deviceId, cachedVote);
} catch (error) {
  console.error("Could not create or read the device ID:", error);
  showStatusError("Browser storage is unavailable. Enable local storage and reload this page.");
}

retryButton.addEventListener("click", () => {
  try {
    const deviceId = getDeviceId();
    checkDeviceStatus(deviceId, window.localStorage.getItem(hasVotedKey) === "true");
  } catch (error) {
    console.error("Could not read the device ID for retry:", error);
    showStatusError("Browser storage is unavailable. Enable local storage and reload this page.");
  }
});

document.querySelectorAll(".nominee-card input").forEach((input) => {
  input.addEventListener("change", () => {
    document.querySelectorAll(".nominee-card").forEach((card) => card.classList.remove("is-selected"));
    input.closest(".nominee-card").classList.add("is-selected");
  });
});

ballotForm.addEventListener("submit", () => {
  const submitButton = ballotForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = "Submitting...";
});
