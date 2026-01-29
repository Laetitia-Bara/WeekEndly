//const BACKEND_URL = "http://localhost:3000";
const BACKEND_URL = "https://weekendlybackend.vercel.app";

const statusEl = document.querySelector("#status");
const btn = document.querySelector("#refresh");
const mainEl = document.querySelector("#main");
const metaEl = document.querySelector("#meta");
const errEl = document.querySelector("#error");
const rowsEl = document.querySelector("#rows");
const timelineEl = document.querySelector("#timeline");

const activityEl = document.querySelector("#activity");
const durationEl = document.querySelector("#duration");
const currentChoiceEl = document.querySelector("#currentChoice");

function setStatus(t) {
  statusEl.textContent = t;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function fmtDayFr(d) {
  const days = [
    "dimanche",
    "lundi",
    "mardi",
    "mercredi",
    "jeudi",
    "vendredi",
    "samedi",
  ];
  return days[d.getDay()];
}

function fmtHM(d) {
  return `${pad2(d.getHours())}h${pad2(d.getMinutes())}`;
}

function fmtSlot(start, end) {
  return `${fmtDayFr(start)} ${fmtHM(start)}–${fmtHM(end)}`;
}

function weatherLabelFromCode(code) {
  if (code === 0) return "ensoleillé";
  if ([1, 2].includes(code)) return "peu nuageux";
  if (code === 3) return "nuageux";
  if ([51, 53, 55].includes(code)) return "bruine";
  if ([61, 63, 65, 80, 81, 82].includes(code)) return "pluie";
  if ([95, 96, 99].includes(code)) return "orage";
  return `code ${code}`;
}

// Icône simple selon grandes familles
function iconFromCode(code) {
  if (code === 0) return "☀️";
  if ([1, 2, 3].includes(code)) return "🌥️";
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return "🌧️";
  if ([95, 96, 99].includes(code)) return "⛈️";
  if ([45, 48].includes(code)) return "🌫️";
  if ([71, 73, 75, 77].includes(code)) return "❄️";
  return "🌡️";
}

function nextWeekendDates(now) {
  const day = now.getDay(); // 0..6
  const diffToSat = (6 - day + 7) % 7;
  const sat = new Date(now);
  sat.setHours(0, 0, 0, 0);
  sat.setDate(now.getDate() + diffToSat);
  const sun = new Date(sat);
  sun.setDate(sat.getDate() + 1);
  return { sat, sun };
}

function updateChoiceBadge() {
  const activity = activityEl.value;
  const durationHours = Number(durationEl.value);
  currentChoiceEl.textContent = `${activity === "hike" ? "Rando" : "Balade chien"} · ${durationHours}h`;
}

activityEl.addEventListener("change", () => {
  updateChoiceBadge();
  refresh();
});
durationEl.addEventListener("change", () => {
  updateChoiceBadge();
  refresh();
});
updateChoiceBadge();

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation)
      return reject(new Error("Géolocalisation non supportée."));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      (err) =>
        reject(
          new Error(err.message || "Impossible de récupérer la position."),
        ),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  });
}

async function callBackendBestSlot(lat, lon, activity, duration) {
  const res = await fetch(`${BACKEND_URL}/best-slot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat, lon, activity, duration }),
  });
  const data = await res.json();
  if (!data.result) throw new Error(data.error || "Erreur backend");
  return data.bestSlot; // { start, end, temperature, rain, score, ... }
}

async function fetchForecast(lat, lon) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", lat);
  url.searchParams.set("longitude", lon);
  url.searchParams.set(
    "hourly",
    "temperature_2m,precipitation_probability,windspeed_10m,weather_code",
  );
  url.searchParams.set("timezone", "auto");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("Impossible de récupérer la météo (timeline)");
  return res.json();
}

function renderTimeline(forecast, now, bestStart, bestEnd) {
  timelineEl.innerHTML = "";

  const { sat, sun } = nextWeekendDates(now);
  const days = [
    { label: "Samedi", date: sat },
    { label: "Dimanche", date: sun },
  ];

  const times = forecast.hourly.time.map((t) => new Date(t));

  // 09h -> 18h
  const startHour = 9;
  const endHour = 18;

  for (const d of days) {
    const row = document.createElement("div");
    row.className = "tl-row";

    const label = document.createElement("div");
    label.className = "tl-label";
    label.textContent = d.label;

    const cells = document.createElement("div");
    cells.className = "tl-cells";

    for (let h = startHour; h <= endHour; h++) {
      const t = new Date(d.date);
      t.setHours(h, 0, 0, 0);

      const idx = times.findIndex((x) => x.getTime() === t.getTime());

      const cell = document.createElement("div");
      cell.className = "cell";

      if (idx === -1) {
        cell.innerHTML = `<div class="t">${pad2(h)}h</div><div class="m">—</div><div class="s">—</div>`;
      } else {
        const code = forecast.hourly.weather_code[idx];
        const temp = Math.round(forecast.hourly.temperature_2m?.[idx] ?? 0);
        const pop = Math.round(forecast.hourly.precipitation_probability[idx]);
        const wind = Math.round(forecast.hourly.windspeed_10m[idx]);

        const icon = iconFromCode(code);

        cell.innerHTML = `
          <div class="t"><span>${pad2(h)}h</span><span>${icon}</span></div>
          <div class="m">${weatherLabelFromCode(code)}</div>
          <div class="s">${temp}°C · ${pop}% · ${wind}km/h</div>
        `;

        // Highlight si l'heure appartient au meilleur créneau
        if (bestStart && bestEnd) {
          const inBest = t >= bestStart && t < bestEnd;
          if (inBest) cell.classList.add("best");
        }
      }

      cells.appendChild(cell);
    }

    row.appendChild(label);
    row.appendChild(cells);
    timelineEl.appendChild(row);
  }
}

function renderTableBestOnly(best) {
  rowsEl.innerHTML = "";
  if (!best) return;

  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>${fmtSlot(new Date(best.start), new Date(best.end))}</td>
    <td>—</td>
    <td>${best.temperature}°C</td>
    <td>${best.rain} mm</td>
    <td>—</td>
    <td>—</td>
    <td><b>${Math.round(best.score)}</b></td>
  `;
  rowsEl.appendChild(tr);
}

async function refresh() {
  btn.disabled = true;
  setStatus("Localisation…");
  errEl.textContent = "";
  mainEl.textContent = "Calcul en cours…";
  metaEl.textContent = "";
  rowsEl.innerHTML = "";
  timelineEl.innerHTML = "";

  try {
    const now = new Date();
    const activity = activityEl.value;
    const duration = Number(durationEl.value);

    const pos = await getPosition();
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;

    setStatus("Recherche...");
    const best = await callBackendBestSlot(lat, lon, activity, duration);

    const bestStart = new Date(best.start);
    const bestEnd = new Date(best.end);

    mainEl.innerHTML = `
  <span class="success">
    Sortie conseillée : ${fmtSlot(bestStart, bestEnd)} (${duration}h) — ${best.temperature}°C
  </span>
`;

    metaEl.textContent = `Maj: ${now.toLocaleTimeString("fr-FR")} · ${lat.toFixed(3)}, ${lon.toFixed(3)}`;

    renderTableBestOnly(best);

    setStatus("Timeline…");
    const forecast = await fetchForecast(lat, lon);
    renderTimeline(forecast, now, bestStart, bestEnd);

    setStatus("OK");
  } catch (e) {
    setStatus("Erreur");
    errEl.textContent = e.message || String(e);
    mainEl.textContent = "Impossible de proposer un créneau pour le moment.";
  } finally {
    btn.disabled = false;
  }
}

btn.addEventListener("click", refresh);

// Auto-refresh: toutes les 30 min quand l'app est visible
const AUTO_REFRESH_MINUTES = 30;
let autoRefreshTimer = null;

function startAutoRefresh() {
  stopAutoRefresh();
  autoRefreshTimer = setInterval(
    () => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    },
    AUTO_REFRESH_MINUTES * 60 * 1000,
  );
}

function stopAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = null;
}

// Quand on revient sur l'app, on refresh une fois
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    refresh();
  }
});

startAutoRefresh();
