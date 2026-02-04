const express = require("express");
const router = express.Router();
const { getBestSlot } = require("../services/weather");

router.post("/best-slot", async (req, res) => {
  const { lat, lon, activity, duration, windows } = req.body;

  if (lat == null || lon == null) {
    return res.json({ result: false, error: "Missing coordinates" });
  }

  try {
    const bestSlot = await getBestSlot(lat, lon, activity, duration, windows);
    res.json({ result: true, bestSlot });
  } catch (e) {
    console.error(e);
    res.json({ result: false, error: e.message });
  }
});

module.exports = router;
