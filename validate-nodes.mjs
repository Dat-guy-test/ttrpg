#!/usr/bin/env node
// ============================================================
// validate-nodes.mjs
//
// Standalone sanity check for nodes.json — catches the exact class
// of bug that crashes Tree.init()/areReqsMet() in the browser:
// a `requires` or `exclGroup` entry that references an id which
// doesn't actually exist anywhere in the data.
//
// Usage:
//   node validate-nodes.mjs path/to/nodes.json
//
// Exits with code 1 (and a non-empty report) if anything is wrong,
// 0 if the file is clean. Safe to run in CI or as a pre-commit check.
// ============================================================

import fs from 'fs';

const path = process.argv[2];
if (!path) {
    console.error('Usage: node validate-nodes.mjs path/to/nodes.json');
    process.exit(2);
}

let data;
try {
    data = JSON.parse(fs.readFileSync(path, 'utf-8'));
} catch (e) {
    console.error(`Could not read/parse ${path}:`, e.message);
    process.exit(2);
}

const errors = [];
const warnings = [];

const nodes = Array.isArray(data.nodes) ? data.nodes : [];
const groups = Array.isArray(data.mutuallyExclusive) ? data.mutuallyExclusive : [];

// ---- Build id set + check for duplicates ------------------------
const idSet = new Set();
for (const n of nodes) {
    const id = String(n.id);
    if (idSet.has(id)) errors.push(`Duplicate node id "${id}" (appears more than once in "nodes").`);
    idSet.add(id);
}

// ---- Check every node's basic shape ------------------------------
for (const n of nodes) {
    const id = String(n.id ?? '(missing id)');
    if (n.id === undefined || n.id === null || n.id === '') errors.push(`A node is missing "id".`);
    if (typeof n.fi !== 'number')    errors.push(`Node "${id}": "fi" should be a number (degrees), got ${JSON.stringify(n.fi)}.`);
    if (typeof n.theta !== 'number') errors.push(`Node "${id}": "theta" should be a number (degrees), got ${JSON.stringify(n.theta)}.`);
    if (!Array.isArray(n.requires))  warnings.push(`Node "${id}": "requires" is missing/not an array — will be treated as [].`);
}

// ---- Check every requires entry resolves to a real node ----------
for (const n of nodes) {
    const id = String(n.id);
    const requires = Array.isArray(n.requires) ? n.requires : [];
    requires.forEach((req, j) => {
        if (Array.isArray(req)) {
            if (req.length === 0) warnings.push(`Node "${id}": requires[${j}] is an empty OR group.`);
            req.forEach(memberId => {
                if (!idSet.has(String(memberId))) {
                    errors.push(`Node "${id}": requires[${j}] (OR group) references unknown id "${memberId}".`);
                }
            });
        } else {
            if (!idSet.has(String(req))) {
                errors.push(`Node "${id}": requires[${j}] references unknown id "${req}".`);
            }
        }
    });
}

// ---- Check mutuallyExclusive groups -------------------------------
const groupLabels = new Set();
for (const g of groups) {
    if (!g.label) { errors.push(`A mutuallyExclusive entry is missing "label".`); continue; }
    if (groupLabels.has(g.label)) errors.push(`Duplicate mutuallyExclusive label "${g.label}".`);
    groupLabels.add(g.label);

    if (typeof g.max !== 'number') errors.push(`Group "${g.label}": "max" should be a number, got ${JSON.stringify(g.max)}.`);
    if (!Array.isArray(g.members)) {
        errors.push(`Group "${g.label}": "members" is missing/not an array. This is exactly what causes the "can't access property 'join'" crash in the inspector panel.`);
    } else {
        if (g.members.length === 0) warnings.push(`Group "${g.label}": "members" is empty.`);
        g.members.forEach(memberId => {
            if (!idSet.has(String(memberId))) {
                errors.push(`Group "${g.label}": member "${memberId}" is not a real node id.`);
            }
        });
        if (typeof g.max === 'number' && g.max > g.members.length) {
            warnings.push(`Group "${g.label}": max (${g.max}) is larger than its member count (${g.members.length}) — the limit can never actually be reached.`);
        }
    }
}

// ---- Check every node's exclGroup resolves to a real group -------
for (const n of nodes) {
    const id = String(n.id);
    if (n.exclGroup) {
        if (!groupLabels.has(n.exclGroup)) {
            errors.push(`Node "${id}": exclGroup "${n.exclGroup}" does not match any label in "mutuallyExclusive".`);
        } else {
            const g = groups.find(g => g.label === n.exclGroup);
            if (g && Array.isArray(g.members) && !g.members.map(String).includes(id)) {
                warnings.push(`Node "${id}": has exclGroup "${n.exclGroup}", but is not listed in that group's "members" — it won't actually be limited by the group.`);
            }
        }
    }
}

// ---- Report -------------------------------------------------------
console.log(`Checked ${nodes.length} nodes, ${groups.length} mutual-exclusion groups.\n`);

if (errors.length) {
    console.log(`ERRORS (${errors.length}) — these will crash or misbehave in the browser:`);
    for (const e of errors) console.log('  ✗ ' + e);
    console.log('');
}
if (warnings.length) {
    console.log(`WARNINGS (${warnings.length}) — probably fine, worth a look:`);
    for (const w of warnings) console.log('  ! ' + w);
    console.log('');
}
if (!errors.length && !warnings.length) {
    console.log('No issues found.');
}

process.exit(errors.length ? 1 : 0);
