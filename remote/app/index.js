"use strict";

const compression = require("compression");
const cors = require("cors");
const express = require("express");
const helmet = require("helmet");
const passport = require("passport");
const xsenv = require("@sap/xsenv");
const { JWTStrategy } = require("@sap/xssec");
const {
  executeHttpRequest,
  getDestinationFromDestinationService,
} = require("@sap-cloud-sdk/core");

const app = express();

app.use(helmet());

if (process.env.NODE_ENV === "development") {
  xsenv.loadEnv();
}

const { xsuaa } = xsenv.getServices({ xsuaa: { tag: "xsuaa" } });
passport.use(new JWTStrategy(xsuaa));
app.use(passport.initialize());
app.use(passport.authenticate("JWT", { session: false }));

app.use(cors({ optionsSuccessStatus: 200, origin: /^https?:\/\/localhost/ }));

app.use(compression({ threshold: 0 }));

app.use((req, res, next) => {
  const { tokenInfo, method, headers, data } = req;
  
  if (headers["x-destination-authorization"]) {
    headers.authorization = headers["x-destination-authorization"];
  } else {
    delete headers.authorization;
  }
  
  const [, destinationName, url] = req.originalUrl.match(/\/([^/]+)(.*)/);

  getDestinationFromDestinationService(destinationName, {
    userJwt: tokenInfo.getTokenValue(),
  })
    .then((destination) =>
      executeHttpRequest(
        destination,
        { method, headers, url, data },
        { fetchCsrfToken: method !== "GET" }
      )
    )
    .then(({ data: resData, headers: resHeaders, status }) => {
      res.set(resHeaders);
      res.status(status);
      res.end(resData);
    })
    .catch(next);
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Proxy listening on port ${port}`);
});
