async function getBestSlot(lat, lon, activity = "dog", duration = 2) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation,precipitation_probability,cloudcover,windspeed_10m,weather_code&timezone=auto`;

  const response = await fetch(url);
  const data = await response.json();

  const now = new Date();
  const times = data.hourly.time.map((t) => new Date(t));

  const saturdayStart = new Date(now);
  saturdayStart.setDate(now.getDate() + ((6 - now.getDay() + 7) % 7));
  saturdayStart.setHours(9, 0, 0, 0);

  const sundayEnd = new Date(saturdayStart);
  sundayEnd.setDate(saturdayStart.getDate() + 1);
  sundayEnd.setHours(18, 0, 0, 0);

  let best = null;

  for (let i = 0; i < times.length; i++) {
    const start = times[i];
    const end = new Date(start);
    end.setHours(end.getHours() + duration);

    if (start < saturdayStart || end > sundayEnd || end <= now) continue;

    const i2 = times.findIndex((t) => t.getTime() === end.getTime());
    if (i2 === -1) continue;

    const avgTemp =
      data.hourly.temperature_2m.slice(i, i2).reduce((a, b) => a + b) /
      duration;
    const avgRain = data.hourly.precipitation
      .slice(i, i2)
      .reduce((a, b) => a + b);

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
