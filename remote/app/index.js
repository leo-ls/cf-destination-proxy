"use strict";

process.env.SERVICE_2_APPROUTER = "true";

const approuter = require("@sap/approuter");
const cors = require("cors");

const router = approuter();

router.beforeRequestHandler.use(cors());

router.start();
