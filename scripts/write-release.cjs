const { execFileSync } = require('node:child_process');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const runGit = (...args) => {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return ''; }
};

const commit = process.env.VERCEL_GIT_COMMIT_SHA || runGit('rev-parse', 'HEAD');
const buildId = process.env.VERCEL_DEPLOYMENT_ID || `${commit || 'local'}-${Date.now()}`;
const commitSummary = process.env.VERCEL_GIT_COMMIT_MESSAGE || runGit('log', '-1', '--pretty=%s');
const summary = (commitSummary.split(/\r?\n/, 1)[0] || `Milo update ${buildId.slice(0, 8)}`).slice(0, 180);
const release = { buildId, summary, deployedAt: new Date().toISOString() };

mkdirSync(join(root, 'public'), { recursive: true });
writeFileSync(join(root, 'src', 'release.ts'), `// Generated for this web deployment.\nexport const BUILD_ID = ${JSON.stringify(buildId)};\nexport const BUILD_SUMMARY = ${JSON.stringify(summary)};\n`);
writeFileSync(join(root, 'public', 'release.json'), `${JSON.stringify(release, null, 2)}\n`);
console.log(`Prepared release marker ${buildId}: ${summary}`);
