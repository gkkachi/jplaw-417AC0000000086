#!/usr/bin/env zx

import jsonata from 'jsonata';
import { readFileSync, writeFileSync, appendFileSync } from 'fs';

const LAW_ID = '417AC0000000086';
const API_BASE = 'https://laws.e-gov.go.jp/api/2';

// 1. Git initialization
try {
  await $`git rev-parse --is-inside-work-tree`;
} catch (p) {
  await $`git init`;
}

// Ensure Git author is set for CI environments
try {
  await $`git config user.name`;
} catch (e) {
  await $`git config user.name "github-actions[bot]"`;
  await $`git config user.email "github-actions[bot]@users.noreply.github.com"`;
}

// 2. Fetch revision list
console.log('Fetching revisions list...');
const listRes = await fetch(`${API_BASE}/law_revisions/${LAW_ID}`);
const listData = await listRes.json();
let revisions = listData.revisions;

if (!revisions || revisions.length === 0) {
  console.log('No revisions found.');
  process.exit(0);
}

// 3. Get existing tags
let existingTags = [];
try {
  const tagsOutput = (await $`git tag`).stdout.trim();
  if (tagsOutput) {
    existingTags = tagsOutput.split('\n');
  }
} catch (e) {
  // Ignore error if no tags exist
}

// 4. Filter unprocessed revisions
let unprocessed = revisions.filter(rev => !existingTags.includes(rev.law_revision_id));

// Sort from oldest to newest
unprocessed.sort((a, b) => {
  const dateA = a.amendment_enforcement_date || '';
  const dateB = b.amendment_enforcement_date || '';
  if (dateA === dateB) {
    return a.law_revision_id.localeCompare(b.law_revision_id);
  }
  return dateA.localeCompare(dateB);
});

if (unprocessed.length === 0) {
  console.log('All revisions are up to date.');
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, "updated=false\n");
  }
  process.exit(0);
}

// 5. Load JSONata expression
const expr = jsonata(readFileSync('convert.jsonata', 'utf8'));

// 6. Process each revision
for (const rev of unprocessed) {
  const revId = rev.law_revision_id;
  console.log(`Processing revision: ${revId} (${rev.amendment_enforcement_date})`);

  const dataRes = await fetch(`${API_BASE}/law_data/${revId}`);
  const data = await dataRes.json();

  // Save JSON
  writeFileSync('law.json', JSON.stringify(data, null, 2));

  // Convert and save Markdown
  const mdResult = await expr.evaluate(data);
  writeFileSync('law.md', mdResult || '');

  // Git commit and tag
  await $`git add law.json law.md`;
  
  const commitMsg = `Update: ${rev.amendment_law_title || 'Unknown Revision'} (Enforcement: ${rev.amendment_enforcement_date || 'Unknown'})`;
  await $`git commit -m ${commitMsg}`;
  await $`git tag ${revId}`;
}

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, "updated=true\n");
}
console.log('Sync complete.');
