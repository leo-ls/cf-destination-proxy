const { load, dump } = require("js-yaml");

module.exports = {
  releaseCommitMessageFormat: "chore(release): {{currentTag}} [skip ci]",
  bumpFiles: [
    {
      filename: "./package.json",
      type: "json"
    },
    {
      filename: "./remote/mta.yaml",
      updater: {
        readVersion: (contents) => {
          const mta = load(contents);
          return mta.version;
        },
        writeVersion: (contents, version) => {
          const mta = load(contents);
          mta.version = version;
          return dump(mta);
        },
      },
    },
  ],
};
