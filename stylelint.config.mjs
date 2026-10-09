// Lints styles.css with the same two checks Obsidian's community-plugin review applies (#152):
//   - declaration-no-important
//   - stylelint-no-unsupported-browser-features, "only partially supported" findings
//
// The browser target is a calibrated guess at the engine of the Obsidian build the review runs against, not a
// published fact: `chrome 138` was found by trial, because it reproduces the review's 11 findings on 0.7.8
// (8 `text-decoration` longhands, 3 `!important`) at the same lines and none on 0.7.9. Re-check it whenever the
// review's target moves (see docs/release-process.md, "CSS lint").
//
// Both rules are `error` here although the review shows the browser-feature ones as warnings: a warning in the
// review is still a finding on the plugin's page, so CI treats it as a failure.
export default {
  plugins: ["stylelint-no-unsupported-browser-features"],
  rules: {
    "declaration-no-important": true,
    "plugin/no-unsupported-browser-features": [true, { browsers: ["chrome 138"], severity: "error" }],
  },
};
