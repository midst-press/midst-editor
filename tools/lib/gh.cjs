// The GitHub CLI, for the release tools. GH overrides which program runs (the tests point it at a
// fake). A failure becomes an Error with `api: true`, so a tool can exit 3 for "an API call failed".

const { execFileSync } = require('child_process');

function gh(args) {
  try {
    return execFileSync(process.env.GH || 'gh', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    const err = new Error(
      `gh ${args.slice(0, 3).join(' ')} failed: ${(e.stderr || e.message)
        .toString()
        .trim()}`
    );
    err.api = true;
    throw err;
  }
}

module.exports = { gh };
