"use strict";

const { default: axios } = require("axios");
const { prompt } = require("inquirer");
const { promises: { writeFile }, existsSync } = require("fs");
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
  const { username, password } = answers;

  return axios
    .post(
      `${uaaURL}/oauth/token`,
      new URLSearchParams({
        grant_type: "password",
        username,
        password,
        client_id: "cf",
      }),
      {
        auth: {
          username: "cf",
        },
      }
    )
    .then(({ data: { access_token } }) => {
      console.log("[info]", `Logged in as ${username}`);

      return {
        baseURL: getCloudFoundryURL(route, "api"),
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      };
    });
};

const getServiceCredentials = (service, authContext) => {
  console.log("[info]", `Fetching service credentials for ${service}...`);

  const options = Object.assign(
    {
      params: {
        type: "app",
        service_instance_names: service,
      },
    },
    authContext
  );

  const serviceCredentialBindings = axios.create(options);
  serviceCredentialBindings.interceptors.response.use(({ data }) => {
    const binding = data.resources[0];

    if (!binding) {
      throw new Error(
        `Bindings for ${service} not found. Check the deployed proxy for errors`
      );
    }

    return binding.links.details.href;
  });

  const serviceCredentialDetails = axios.create(authContext);
  serviceCredentialDetails.interceptors.response.use(
    ({ data: { credentials } }) => credentials
  );

  return serviceCredentialBindings
    .get("/v3/service_credential_bindings", options)
    .then((detailsURL) => serviceCredentialDetails.get(detailsURL));
};

const getDestinations = (credentials) => {
  const { uri, url, clientid, clientsecret } = credentials;

  const baseDestinationOptions = {
    baseURL: uri,
    params: {
      $select: "Name",
    },
  };
  const subaccountDestinations = axios.create(baseDestinationOptions);
  subaccountDestinations.interceptors.response.use(({ data }) =>
    data.map(({ Name }) => Name)
  );

  const oauthOptions = new URLSearchParams({
    grant_type: "client_credentials",
  });
  const uaaToken = axios.create({
    baseURL: url,
    auth: {
      username: clientid,
      password: clientsecret,
    },
  });
  uaaToken.interceptors.response.use(({ data: { access_token } }) => ({
    headers: {
      Authorization: `Bearer ${access_token}`,
    },
  }));

  return uaaToken
    .post("/oauth/token", oauthOptions)
    .then((authorizationHeader) =>
      subaccountDestinations.get(
        "/destination-configuration/v1/subaccountDestinations",
        authorizationHeader
      )
    );
};

const buildEnv = async (route, proxyPort, authContext) => {
  const credentials = await getServiceCredentials(
    UAA_INSTANCE_NAME,
    authContext
  );
  console.log("[info]", `Credentials for ${UAA_INSTANCE_NAME} obtained`);

  const destinationCredentials = await getServiceCredentials(
    DESTINATION_INSTANCE_NAME,
    authContext
  );

  console.log("[info]", "Reading subaccount destinations...");
  const destinationNames = await getDestinations(destinationCredentials);
  console.log(
    "[info]",
    `Destinations available: ${destinationNames.join(", ")}`
  );

  const VCAP_SERVICES = {
    xsuaa: [
      {
        label: "xsuaa",
        plan: "application",
        name: UAA_INSTANCE_NAME,
        tags: ["xsuaa"],
        credentials,
      },
    ],
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
    `CFDP_PORT=${proxyPort}\n` +
    `CFDP_TARGET=${target}`
  );
};

const writeEnv = async (env) => {
  const baseFileName = ".env";
  let fileName = baseFileName;
  let exists = false;
  let index = 0;

  while (!exists) {
    exists = existsSync(`./${fileName}`);
    if (!exists) {
      await writeFile(`./${fileName}`, env);
      exists = true;
      console.log("[info]", `File ${fileName} created with binding parameters`);
    } else {
      fileName = `${baseFileName}${++index}`;
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
