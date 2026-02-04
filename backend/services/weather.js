async function getBestSlot(
  lat,
  lon,
  activity = "dog",
  duration = 2,
  windows = null,
) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation,precipitation_probability,cloudcover,windspeed_10m,weather_code&timezone=auto`;

  const response = await fetch(url);
  const data = await response.json();

  const now = new Date();
  const times = data.hourly.time.map((t) => new Date(t));

  // --- Helpers ---
  const mkWindow = (baseDate, startHour, endHour) => {
    const start = new Date(baseDate);
    start.setHours(startHour, 0, 0, 0);

    const end = new Date(baseDate);
    end.setHours(endHour, 0, 0, 0);

    return { start, end };
  };

  const buildAllowedWindows = () => {
    // Prochain samedi (samedi le plus proche ; si on est dimanche => samedi prochain)
    const day = now.getDay(); // 0..6
    const diffToSat = (6 - day + 7) % 7;

    const sat = new Date(now);
    sat.setHours(0, 0, 0, 0);
    sat.setDate(now.getDate() + diffToSat);

    const sun = new Date(sat);
    sun.setDate(sat.getDate() + 1);

    // Par défaut : sam+dim 09-18
    if (!windows) {
      return [mkWindow(sat, 9, 18), mkWindow(sun, 9, 18)];
    }

    const out = [];

    const satCfg = windows?.sat;
    if (satCfg?.enabled) {
      const sH = Number(satCfg.startHour);
      const eH = Number(satCfg.endHour);
      if (Number.isFinite(sH) && Number.isFinite(eH) && eH > sH) {
        out.push(mkWindow(sat, sH, eH));
      }
    }

    const sunCfg = windows?.sun;
    if (sunCfg?.enabled) {
      const sH = Number(sunCfg.startHour);
      const eH = Number(sunCfg.endHour);
      if (Number.isFinite(sH) && Number.isFinite(eH) && eH > sH) {
        out.push(mkWindow(sun, sH, eH));
      }
    }

    return out;
  };

  const allowedWindows = buildAllowedWindows();

  // Si l'utilisateur a tout décoché / fenêtres invalides => aucun résultat
  if (!allowedWindows.length) return null;

  const isInsideAnyWindow = (start, end) => {
    return allowedWindows.some((w) => start >= w.start && end <= w.end);
  };

  // --- Compute best slot ---
  let best = null;

  for (let i = 0; i < times.length; i++) {
    const start = times[i];
    const end = new Date(start);
    end.setHours(end.getHours() + duration);

    // Filtrage : doit être dans une fenêtre autorisée + futur
    if (!isInsideAnyWindow(start, end) || end <= now) continue;

    // Important : on ne garde que les créneaux parfaitement alignés sur l'horaire hourly
    const i2 = times.findIndex((t) => t.getTime() === end.getTime());
    if (i2 === -1) continue;

    const sliceTemp = data.hourly.temperature_2m.slice(i, i2);
    const sliceRain = data.hourly.precipitation.slice(i, i2);

    if (sliceTemp.length !== duration || sliceRain.length !== duration)
      continue;

    const avgTemp = sliceTemp.reduce((a, b) => a + b, 0) / duration;
    const avgRain = sliceRain.reduce((a, b) => a + b, 0);

    const score = avgTemp * 2 - avgRain * (activity === "dog" ? 10 : 6);

    if (!best || score > best.score) {
      best = {
        start,
        end,
        temperature: Math.round(avgTemp),
        rain: avgRain.toFixed(1),
        score,
      };
    }
  }

  return best;
}

module.exports = { getBestSlot };
