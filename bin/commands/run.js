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
const { createSecurityContext, requests } = require("@sap/xssec");

const { UAA_INSTANCE_NAME } = require("../constants");

const loadFiles = async (envPath) => {
  const resolvedPath = resolve(process.cwd(), envPath);
  const files = await readdir(resolvedPath);
  const envFiles = files.filter((file) => /^\.env\d*$/g.test(file));
  const envPaths = envFiles.map((file) => resolve(resolvedPath, file));

  envPaths.forEach((path) => config({ path }));
};

class UAAToken {
  constructor() {
    this.token = null;

    this.isExpired = this.isExpired.bind(this);
    this.fetch = this.fetch.bind(this);
  }

  get value() {
    return this.token;
  }

  set value(newValue) {
    this.token = newValue;
  }

  isExpired() {
    if (!this.token) {
      return Promise.resolve(true);
    }

    const credentials = cfServiceCredentials({
      name: UAA_INSTANCE_NAME,
    });
    const { token } = this;
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
  }

  fetch() {
    console.log("[info]", "Fetching new proxy token...");

    const credentials = cfServiceCredentials({
      name: UAA_INSTANCE_NAME,
    });

    let self = this;

    return new Promise((resolve, reject) => {
      requests.requestClientCredentialsToken(
        null,
        credentials,
        null,
        null,
        (error, token) => {
          if (error) {
            reject(error);
            return;
          }
          self.token = token;
          resolve();
        }
      );
    });
  }
}

const run = (port, log) => {
  const target = process.env.CFDP_TARGET;
  if (!target) {
    throw new Error("Variable CFDP_TARGET not found. Run cfdp bind first");
  }

  const token = new UAAToken();

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

    url.pathname = join("/", destination, url.pathname);
    req.url = url.href;

    const expired = await token.isExpired();
    if (expired) {
      await token.fetch();
    }

    if (req.headers.authorization) {
      const authorization = req.headers.authorization;
      req.headers["X-Destination-Authorization"] = authorization;
    }

    req.headers.authorization = `Bearer ${token.value}`;

    proxy.web(req, res);
  });

  server.listen(port);
  console.log("[info]", `cf-destination-proxy running on port ${port}`);
};

module.exports = async (options) => {
  const { envPath, port, log } = options;

  await loadFiles(envPath);
  run(port, log);
};
