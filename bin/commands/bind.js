"use strict";

const { default: axios } = require("axios");
const { prompt } = require("inquirer");
const {
  promises: { writeFile },
  existsSync,
} = require("fs");
const { URLSearchParams } = require("url");

const {
  DESTINATION_INSTANCE_NAME,
  UAA_INSTANCE_NAME,
} = require("../constants");

const getCloudFoundryURL = (route, service) => {
  const region = route.match(/\w+\.hana\.ondemand\.com/g);
  if (!region) {
    throw new Error(`Invalid route format: ${route}`);
  }
  return `https://${service}.cf.${region[0]}`;
};

const authenticate = (route, answers) => {
  console.log("[info]", "Authenticating...");

  const uaaURL = getCloudFoundryURL(route, "uaa");
  const apiURL = getCloudFoundryURL(route, "api");
  const { username, password } = answers;

  const uaaAPI = axios.create({
    baseURL: uaaURL,
    auth: {
      username: "cf",
    },
  });
  uaaAPI.interceptors.response.use(({ data: { access_token = "" } }) => {
    if (access_token) {
      console.log("[info]", `Logged in as ${username}`);
    } else {
      throw new Error("Authentication failed");
    }

    return {
      baseURL: apiURL,
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    };
  });
  const oauthBody = new URLSearchParams({
    grant_type: "password",
    username,
    password,
    client_id: "cf",
  });

  return uaaAPI.post("/oauth/token", oauthBody);
};

const getAppGuid = (url, authContext) => {
  console.log("[info]", `Fetching app details for ${url}...`);

  const host = (url.match(/^(https?:\/\/)?([^.]+)/) || [])[2];

  if (!host) {
    throw new Error("Invalid host");
  }

  const options = Object.assign(
    {
      params: {
        hosts: host,
      },
    },
    authContext
  );
  const cloudFoundryAPI = axios.create(options);
  cloudFoundryAPI.interceptors.response.use(({ data: { resources = [] } }) => {
    if (!resources[0] || !resources[0].destinations[0]) {
      throw new Error(
        `App not found on ${url}. Check the deployed proxy for errors`
      );
    }

    return resources[0].destinations[0].app.guid;
  });

  return cloudFoundryAPI.get("/v3/routes", options);
};

const getServiceCredentials = (service, appGuid, authContext) => {
  console.log("[info]", `Fetching service credentials for ${service}...`);

  const cloudFoundryAPI = axios.create(authContext);

  const handleBindingsResponse = ({ data: { resources = [] } }) => {
    if (!resources[0]) {
      throw new Error(
        `Bindings for ${service} not found. Check the deployed proxy for errors`
      );
    }

    return resources[0].links.details.href;
  };

  const bindingsInterceptor = cloudFoundryAPI.interceptors.response.use(
    handleBindingsResponse
  );

  const handleCredentialsResponse = ({ data: { credentials } }) => {
    if (!credentials) {
      throw new Error(`API error - could not fetch credentials for ${service}`);
    }

    return credentials;
  };

  return cloudFoundryAPI
    .get("/v3/service_credential_bindings", {
      params: {
        app_guids: appGuid,
        service_instance_names: service,
        type: "app",
      },
    })
    .then((detailsURL) => {
      cloudFoundryAPI.interceptors.response.eject(bindingsInterceptor);
      cloudFoundryAPI.interceptors.response.use(handleCredentialsResponse);
      return cloudFoundryAPI.get(detailsURL);
    });
};

const getDestinationNames = (credentials) => {
  const { uri, url, clientid, clientsecret } = credentials;

  const destinationsAPI = axios.create({
    baseURL: uri,
    params: {
      $select: "Name",
    },
  });
  destinationsAPI.interceptors.response.use(({ data = [] }) =>
    data.map(({ Name }) => Name)
  );

  const oauthBody = new URLSearchParams({
    grant_type: "client_credentials",
  });
  const uaaAPI = axios.create({
    baseURL: url,
    auth: {
      username: clientid,
      password: clientsecret,
    },
  });
  uaaAPI.interceptors.response.use(({ data: { access_token = "" } }) => ({
    headers: {
      Authorization: `Bearer ${access_token}`,
    },
  }));

  return uaaAPI
    .post("/oauth/token", oauthBody)
    .then((authContext) =>
      destinationsAPI.get(
        "/destination-configuration/v1/subaccountDestinations",
        authContext
      )
    );
};

const buildEnv = async (route, proxyPort, authContext) => {
  const appGuid = await getAppGuid(route, authContext);

  const credentials = await getServiceCredentials(
    UAA_INSTANCE_NAME,
    appGuid,
    authContext
  );
  console.log("[info]", `Credentials for ${UAA_INSTANCE_NAME} obtained`);

  const destinationCredentials = await getServiceCredentials(
    DESTINATION_INSTANCE_NAME,
    appGuid,
    authContext
  );

  console.log("[info]", "Reading subaccount destinations...");
  const destinationNames = await getDestinationNames(destinationCredentials);
  console.log(
    "[info]",
    `Destinations available: ${destinationNames.join(", ")}`
  );

  const VCAP_SERVICES = {
    xsuaa: [
      {
        label: "xsuaa",
        plan: "broker",
        name: UAA_INSTANCE_NAME,
        tags: ["xsuaa"],
        credentials,
      },
    ]
  };

  const destinations = destinationNames.map((name) => ({
    name,
    url: `http://${name}.dest`,
    proxyHost: "http://127.0.0.1",
    proxyPort,
  }));
  const target = route.replace(/^(https?:\/\/)?([^/]+)\/?$/g, "https://$2");

  return (
    `VCAP_SERVICES=${JSON.stringify(VCAP_SERVICES)}\n` +
    `destinations=${JSON.stringify(destinations)}\n` +
    `CFDP_TARGET=${target}`
  );
};

const writeEnv = async (env) => {
  const baseFileName = ".env";
  let fileName = baseFileName;
  let doesFileExist = false;
  let index = 0;

  while (!doesFileExist) {
    doesFileExist = existsSync(`./${fileName}`);
    if (!doesFileExist) {
      await writeFile(`./${fileName}`, env);
      doesFileExist = true;
      console.log("[info]", `File ${fileName} created with binding parameters`);
    } else {
      fileName = `.${++index}${baseFileName}`;
      doesFileExist = false;
    }
  }
};

module.exports = async (route, options) => {
  console.log(`Login to CF API endpoint: ${getCloudFoundryURL(route, "api")}`);

  const questions = [
    {
      type: "input",
      name: "username",
      message: "Email",
    },
    {
      type: "password",
      name: "password",
      message: "Password",
    },
  ];

  const answers = await prompt(questions);
  const authContext = await authenticate(route, answers);
  const env = await buildEnv(route, options.port, authContext);
  await writeEnv(env);
};
