// Every relative Markdown link with a #fragment in the files named on stdin, checked against the anchor ids GitHub
// renders for the target file at a pushed commit (contents API, HTML media type). Headings with `·`, `→` or
// backticks make hand-made slugs unreliable; this asks GitHub. Needs gh. Exit 1 if an anchor is missing.
// Usage: git ls-files '*.md' | node scripts/docs/gh-anchors.js <commit>
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ref = process.argv[2] || "main";
const repo = process.env.GH_REPO || "AryaSingh22/thawgate";
const root = path.resolve(__dirname, "../..");
const files = fs.readFileSync(0, "utf8").trim().split("\n").filter(Boolean);
const links = [];
for (const f of files) {
  for (const m of fs.readFileSync(path.join(root, f), "utf8").matchAll(/\]\(([^)\s#]*)#([^)\s]+)\)/g)) {
    if (/^[a-z]+:/i.test(m[1])) continue; // external
    const target = m[1] ? path.normalize(path.join(path.dirname(f), m[1])) : f;
    links.push({ from: f, target, frag: decodeURIComponent(m[2]).toLowerCase() });
  }
}
const cache = {};
const anchors = (target) => {
  if (target in cache) return cache[target];
  if (!target.endsWith(".md")) return (cache[target] = null); // line anchors in code files aren't checked here
  const html = execFileSync("gh", ["api", "-H", "Accept: application/vnd.github.html+json", `repos/${repo}/contents/${target}?ref=${ref}`], {
    encoding: "utf8",
    maxBuffer: 64 << 20,
  });
  return (cache[target] = new Set([...html.matchAll(/id="user-content-([^"]+)"/g)].map((m) => m[1])));
};
let checked = 0;
let missing = 0;
for (const l of links) {
  const set = anchors(l.target);
  if (!set) continue;
  checked++;
  if (!set.has(l.frag)) {
    missing++;
    console.log(`missing: ${l.from} -> ${l.target}#${l.frag}`);
  }
}
console.log(`${checked} anchor links in ${Object.values(cache).filter(Boolean).length} files at ${ref}; ${missing} missing`);
process.exitCode = missing ? 1 : 0;
