# cf-destination-proxy

Proxy for local development using Cloud Foundry destinations in SAP BTP

[![Build Status](https://dev.azure.com/leo-ls/cf-destination-project/_apis/build/status/leo-ls.cf-destination-proxy?branchName=main)](https://dev.azure.com/leo-ls/cf-destination-project/_build/latest?definitionId=3&branchName=main)
[![npm](https://img.shields.io/npm/v/cf-destination-proxy)](https://www.npmjs.com/package/cf-destination-proxy)

## Motivation

Local IDEs are still superior in functionality in many ways when compared to online ones.

This tool was built to enable local IDEs (especially VS Code) to access backend destinations defined in a SAP BTP subaccount, making use of the BTP connectivity infrastructure and thus exempting the need of other connection methods (i.e., corporate VPNs) to access backend destinations.

## How it works

In principle, this proxy works just like the "On Premise Web Proxy for WebIDE workspace" used by SAP BAS.  

Proxying local requests to CF destinations takes 3 steps:  

1. Your app's application router checks the environment for the ```destinations``` variable, and forwards the request to the local ```proxyHost:proxyPort```;
2. The local proxy server rewrites the request origin and path and then forwards it to the deployed proxy, with appropriate authorization;
3. The remote proxy (which is essentially a [```@sap/approuter```](https://www.npmjs.com/package/@sap/approuter)) extracts the destination name from the rewritten path, fetches the destination from the CF Destination service and finally forwards the original request to the destination.

## Usage

### Prerequisites

This tool should be deployed in a development space in SAP BTP, so you must have appropriate accesses to the deployment target.

Also, your project must have a local [application router](https://www.npmjs.com/package/@sap/approuter).

### Deployment

Download the [latest MTAR release](https://github.com/leo-ls/cf-destination-proxy/releases/latest) and deploy it to the development space of your choosing, and take note of the app route.

### Using the proxy in your project

#### 1. Install the local proxy:

```bash
# globally
npm install --global cf-destination-proxy

# or locally as a dev dependency
npm install --save-dev cf-destination-proxy
```

#### 2. Then, in your approuter folder, run:

```bash
cfdp bind https://your-cf-destination-proxy-deployed-app-route
```

This will create a local ```.env``` file with binding information from the deployed proxy (similar to the SAP BAS "Run configuration" service binding).  

**ATTENTION: DO NOT commit any generated ```*.env``` files to your repositories, as they contain credentials to your SAP BTP account.** 

Always remember this paragraph from the [12 Factor App Config chapter](https://12factor.net/config):
> A litmus test for whether an app has all config correctly factored out of the code is whether the codebase could be made open source at any moment, without compromising any credentials.

#### 3. Load the ```.env``` file when you run your approuter locally.  

For example, in a ```.vscode/launch.json``` file, add this property to your run configuration:

```json
"envFile": "${workspaceFolder}/approuter/.env"
```

#### 4. To start the local proxy, navigate to the ```.env``` file path and run:

```bash
cfdp run
```
To automate this in VS Code, create a script in your approuter's ```package.json``` file like this:

```json
"scripts": {
    "start": "node node_modules/@sap/approuter/approuter.js",
    "proxy": "cfdp run",
```

Then, create a task in ```.vscode/launch.json``` like so:

```json
"version": "2.0.0",
"tasks": [
    {
        "type": "npm",
        "script": "proxy",
        "path": "approuter/",
        "isBackground": true,
        "problemMatcher": [
            {
                "owner": "custom",
                "pattern": {
                    "regexp": ".",
                },
                "background": {
                    "activeOnStart": true,
                    "beginsPattern": "^\\[info\\] cf-destination-proxy running on port",
                    "endsPattern": "^\\[info\\] cf-destination-proxy running on port"
                }
            }
        ],
        "label": "Run cf-destination-proxy"
    },
```

At last, add the created task as a ```preLaunchTask``` in your run configuration:

```json
"preLaunchTask": "Run cf-destination-proxy",
"outputCapture": "std"
```