const express = require("express");
const router = express.Router();
const { getBestSlot } = require("../services/weather");

router.post("/best-slot", async (req, res) => {
  const { lat, lon, activity, duration } = req.body;

  if (!lat || !lon) {
    return res.json({ result: false, error: "Missing coordinates" });
  }

  try {
    const bestSlot = await getBestSlot(lat, lon, activity, duration);
    res.json({ result: true, bestSlot });
  } catch (e) {
    console.error(e);
    res.json({ result: false, error: e.message });
  }
});

module.exports = router;
