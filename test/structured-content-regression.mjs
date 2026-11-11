#!/usr/bin/env node

/**
 * Regression tests for decipher-mcp-server structuredContent responses.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, '..');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assertContains(filePath, haystack, needle, testName) {
  totalTests++;
  if (haystack.includes(needle)) {
    console.log(`${GREEN}✓${RESET} ${testName}`);
    passedTests++;
  } else {
    console.log(`${RED}✗${RESET} ${testName}`);
    console.log(`  Missing: ${needle}`);
    failedTests++;
  }
}

function assertFileExists(relPath, testName) {
  totalTests++;
  const fullPath = path.join(SERVER_ROOT, relPath);
  if (fs.existsSync(fullPath)) {
    console.log(`${GREEN}✓${RESET} ${testName}`);
    passedTests++;
    return fs.readFileSync(fullPath, 'utf-8');
  } else {
    console.log(`${RED}✗${RESET} ${testName}`);
    failedTests++;
    return '';
  }
}

// Verify core server files exist
const index = assertFileExists('src/index.ts', 'index.ts exists');
const doFile = assertFileExists('src/do.ts', 'do.ts exists');
const catalog = assertFileExists('src/spec/catalog.ts', 'catalog.ts exists');
const adapter = assertFileExists('src/lib/api-adapter.ts', 'api-adapter.ts exists');
const http = assertFileExists('src/lib/http.ts', 'http.ts exists');
const codeMode = assertFileExists('src/tools/code-mode.ts', 'code-mode.ts exists');
const mirrors = assertFileExists('src/lib/mirrors.ts', 'mirrors.ts exists');
const clingen = assertFileExists('src/lib/clingen-regions.ts', 'ClinGen reader exists');
const dbvar = assertFileExists('src/lib/dbvar.ts', 'dbVar reader exists');
const patient = assertFileExists('src/tools/patient.ts', 'patient.ts exists');
const cnvFrequency = assertFileExists('src/tools/cnv-frequency.ts', 'cnv-frequency.ts exists');
const queryData = assertFileExists('src/tools/query-data.ts', 'query-data.ts exists');
const getSchema = assertFileExists('src/tools/get-schema.ts', 'get-schema.ts exists');

// Verify key patterns in source
if (index) {
  assertContains('src/index.ts', index, 'DecipherDataDO', 'index exports DecipherDataDO');
  assertContains('src/index.ts', index, 'MyMCP', 'index exports MyMCP');
  assertContains('src/index.ts', index, '/health', 'index has health endpoint');
  assertContains('src/index.ts', index, '/mcp', 'index has mcp endpoint');
}

if (doFile) {
  assertContains('src/do.ts', doFile, 'RestStagingDO', 'DO extends RestStagingDO');
}

if (catalog) {
  assertContains('src/spec/catalog.ts', catalog, 'ApiCatalog', 'catalog exports ApiCatalog');
}

if (codeMode) {
  assertContains('src/tools/code-mode.ts', codeMode, 'decipher_search', 'code-mode registers decipher_search');
  assertContains('src/tools/code-mode.ts', codeMode, 'decipher_execute', 'code-mode registers decipher_execute');
}

if (mirrors) {
  assertContains('src/lib/mirrors.ts', mirrors, 'ebi.ac.uk/gene2phenotype', 'mirrors routes g2p to EBI Gene2Phenotype');
  assertContains('src/lib/clingen-regions.ts', clingen, 'ClinGen_region_curation_list_GRCh38.tsv', 'mirrors routes CNV regions to ClinGen');
  assertContains('src/lib/dbvar.ts', dbvar, 'nstd183.GRCh38.variant_call.tsv.gz', 'mirrors routes CNV frequency to dbVar nstd183');
}

// The Referer is an opt-in and the patient surface is retired — both are
// policy, so both are asserted here as well as in the unit tests.
if (http) {
  assertContains('src/lib/http.ts', http, 'DECIPHER_SEND_REFERER', 'http reads the DECIPHER_SEND_REFERER opt-in');
  assertContains('src/lib/http.ts', http, 'DECIPHER_CLIENT_KEY', 'http documents the DECIPHER_CLIENT_KEY seam');
}

if (patient) {
  assertContains('src/tools/patient.ts', patient, 'NOT_SUPPORTED', 'patient tool returns NOT_SUPPORTED');
  assertContains('src/tools/patient.ts', patient, 'Data Access Agreement', 'patient tool points at the Data Access Agreement');
}

if (cnvFrequency) {
  assertContains('src/tools/cnv-frequency.ts', cnvFrequency, 'decipher_cnv_frequency', 'registers decipher_cnv_frequency');
}

if (catalog) {
  assertContains('src/spec/catalog.ts', catalog, '/mirror/dbvar/nstd183/calls', 'catalog lists the dbVar mirror route');
  // A path param matches ONE segment, so the member route needs its own entry —
  // without it the catalog's own example /api/genes/BRCA1 died inside the Worker.
  assertContains('src/spec/catalog.ts', catalog, '/api/{resource}/{id}', 'catalog declares the JSON:API member route');
  // Listed so the isolate reaches the 451 refusal instead of a bogus 404.
  assertContains('src/spec/catalog.ts', catalog, '/data/patient/{id}', 'catalog routes patient paths to this server\'s refusal');
  assertContains('src/spec/catalog.ts', catalog, '/data/gene/{symbol}/g2p', 'catalog keeps the gated per-gene G2P route');
  assertContains('src/spec/catalog.ts', catalog, '/data/syndrome/{id}', 'catalog keeps the gated single-syndrome route');
  assertContains('src/spec/catalog.ts', catalog, 'endpointCount: 16', 'catalog declares 13 existing plus 3 documented G2P evidence routes');
}

// The silent-empty guard: a FAILED curated-record fetch must not render as
// "zero curated records". Behaviour is pinned by src/lib/g2p-view.test.ts and
// src/lib/mirrors.test.ts; these assert the fields survive refactoring.
const g2pView = assertFileExists('src/lib/g2p-view.ts', 'g2p-view.ts exists');
if (g2pView) {
  assertContains('src/lib/g2p-view.ts', g2pView, 'g2p_records_unavailable', 'gene view flags unavailable curated records');
  assertContains('src/lib/g2p-view.ts', g2pView, 'recordsUnavailable ? null : gene.records', 'gene view sends null, not [], when the records fetch failed');
}
if (mirrors) {
  assertContains('src/lib/mirrors.ts', mirrors, 'records_available', 'mirrors reports whether the G2P summary call succeeded');
  assertContains('src/lib/mirrors.ts', mirrors, 'records_status', 'mirrors carries the G2P summary HTTP status');
}

if (queryData) {
  assertContains('src/tools/query-data.ts', queryData, 'decipher_query_data', 'registers decipher_query_data');
}

if (getSchema) {
  assertContains('src/tools/get-schema.ts', getSchema, 'decipher_get_schema', 'registers decipher_get_schema');
}

// Summary
console.log(`\n${passedTests}/${totalTests} tests passed`);
if (failedTests > 0) {
  console.log(`${RED}${failedTests} tests FAILED${RESET}`);
  process.exit(1);
}
