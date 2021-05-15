"use strict";

const { config } = require("dotenv");
const { readdir } = require("fs/promises");
const { createServer } = require("http");
const { createProxyServer } = require("http-proxy");
const {
  resolve,
  posix: { join },
} = require("path");
const { cfServiceCredentials } = require("@sap/xsenv");
const {
  createSecurityContext,
  requests: { requestClientCredentialsToken },
} = require("@sap/xssec");

const { UAA_INSTANCE_NAME } = require("../constants");

const loadFiles = async (envPath) => {
  const resolvedPath = resolve(process.cwd(), envPath);
  const files = await readdir(resolvedPath);
  const envFiles = files.filter((file) => /^(\.\d+)?\.env$/g.test(file));
  const envPaths = envFiles.map((file) => resolve(resolvedPath, file));

  envPaths.forEach((path) => config({ path }));
};

const isTokenExpired = (token) => {
  if (!token) {
    return Promise.resolve(true);
  }

  const credentials = cfServiceCredentials({
    name: UAA_INSTANCE_NAME,
  });

  return new Promise((resolve, reject) => {
    createSecurityContext(token, credentials, "XSUAA", (error) => {
      if (!error) {
        resolve(false);
      } else if (error.name === "TokenExpiredError") {
        resolve(true);
      } else {
        reject(error);
      }
    });
  });
};

const fetchToken = () => {
  console.log("[info]", "Fetching new proxy token...");

  const credentials = cfServiceCredentials({
    name: UAA_INSTANCE_NAME,
  });

  return new Promise((resolve, reject) => {
    requestClientCredentialsToken(
      null,
      credentials,
      null,
      null,
      (error, token) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(token);
      }
    );
  });
};

const run = (port, log) => {
  const target = process.env.CFDP_TARGET;
  if (!target) {
    throw new Error("Variable CFDP_TARGET not found. Run cfdp bind first");
  }

  let token = null;

  const proxy = createProxyServer({ target, changeOrigin: true });

  const server = createServer(async (req, res) => {
    const destination = req.headers.host.split(".")[0];
    const url = new URL(req.url);

    if (log) {
      console.log(
        "[info]",
        `Proxying ${url.pathname} to destination ${destination}`
      );
    }

    url.pathname = join("/proxy", destination, url.pathname);
    req.url = url.href;

    const expired = await isTokenExpired(token);
    if (expired) {
      token = await fetchToken();
    }

    if (req.headers.authorization) {
      req.headers["x-approuter-authorization"] = req.headers.authorization;
    }

    req.headers.authorization = `Bearer ${token}`;

    proxy.web(req, res);
  });

  process.on("SIGINT", () => {
    server.close(() => {
      console.log("[info]", "cf-destination-proxy shutting down");
      process.exit(0);
    });
  });

  server.listen(port);
  console.log("[info]", `cf-destination-proxy running on port ${port}`);
};

module.exports = async (options) => {
  const { envPath, port, log } = options;

  await loadFiles(envPath);
  run(port, log);
};
