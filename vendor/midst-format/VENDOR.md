# Vendored: midst-format

- Tag: `v0.2.0`
- Commit: `912fb5e9f2c9eb924db788beebc50f5664ab17d0`
- Repository: `The_Kindled/midst-format` on Gitea, `midst-press/midst-format` on GitHub

SHA-256 of every vendored file except this one, sorted by path. `tools/check-vendored-format.mjs` parses this block.

```sha256
29041fcf8db18d62fe361487279f003db986195b30671b92ff05e1c795a6c78f  convert/index.cjs
8ae6e76b8931aba19a10d8a835d1ef59c3c0e05329fd4e3c665283c7b0b486aa  convert/index.d.ts
68327dea1229e24a72c85005aa6707fd2e4c6ffa6ce49e56b932ad52da1b7680  convert/index.mjs
ee658ac8f5c95de1ff69e2fe5bc733f053f5de5ab831420a39937194054f4bb2  convert/package.json
a4b2c6e3207deb957505c20fd155033345f84d825eb78d1bb33e4cd33878c2ab  extensions/index.cjs
422b5012243c7d85592ffb2c65c83bd45b7ec6d3cf812c1a58aee21e7adb2671  extensions/index.d.ts
433d13d34b0dbbef8d1343ed6e0799936e7f3e00b4e00d1c8d663d539ea490b9  extensions/index.mjs
ee658ac8f5c95de1ff69e2fe5bc733f053f5de5ab831420a39937194054f4bb2  extensions/package.json
2ae1a518d24f12063617442f30ed1c9fb711d29d93c4598bc6b8812063f22236  history/index.cjs
14fd1e9c7334e83157fc1fe0cbb1dacf99b76a8ab8619ce4af78558dca952e33  history/index.d.ts
f8d34584761b047a462220a4b156b3db1866454ef3fc2d880042deba43316ba1  history/index.mjs
ee658ac8f5c95de1ff69e2fe5bc733f053f5de5ab831420a39937194054f4bb2  history/package.json
ca7a2c7c421ff659c8fc1aaf67984f3e27b2f9d785b3cb7e294887f837a8ecc5  package.json
```

Do not edit these files. To take a new version, rebuild the tag and replace this directory in its own PR: `node tools/check-vendored-format.mjs --rebuild <midst-format checkout>` rebuilds the tag named above and compares it with this directory.
