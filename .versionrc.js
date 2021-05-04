const { load, dump } = require("js-yaml");

module.exports = {
  bumpFiles: [
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
