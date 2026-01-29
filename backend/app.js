const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

const router = require("./routes");
app.use("/", router);

app.listen(3000, () => {
  console.log("backend running on http://localhost:3000");
});
