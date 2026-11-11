// Jest: a file imported with ?raw (mapped to the file itself in package.json) is its text, as webpack's
// asset/source makes it in the build. Only those reach here: every other .svg import is mapped to fileMock.js.
module.exports = {
  process(source) {
    return { code: `module.exports = ${JSON.stringify(source)};` };
  },
};
