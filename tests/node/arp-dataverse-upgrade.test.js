'use strict';

// Runs the real ARP Dataverse upgrade on all seven ARP metadata blocks and
// checks the published 6.12.1 templates.
//
// Start the local ARP Dataverse, then from cedar-template-editor:
//
//   npm run test:arp-upgrade
//
// The TSVs are checked in under tests/node/fixtures/arp-upgrade. official/ holds
// the IQSS/dataverse metadata blocks at tags v6.9, v6.10, v6.11 and v6.12.1.
// arp/6.9 holds the live ARP blocks exported from CEDAR, which the upgrade
// starts from as the 6.9.0 templates. Each distinct TSV is converted once
// by the local ARP Dataverse (ARP_CONVERT_URL, default
// http://localhost:8080/api/arp/convertTsvToCedarTemplate). The test stops
// immediately if that converter is not running. GitHub is not contacted: the
// upgrade service's listing and file requests are answered from these files.
//
// The ARP templates are put into the in-memory CEDAR as drafts that were never
// published, as on live. The upgrade first publishes them as 6.9.0, with only
// the values ARP offers, and archives 6.9.0 like the later versions.
//
// What a passing run checked, for every block:
//
// - Every live ARP field is still present. A field the official block later
//   removed is kept. A field name that exists only in ARP (the Hungarian
//   citation fields, and any other name absent from official v6.9) is
//   unchanged apart from its CEDAR identity.
// - Where an ARP value still matched official v6.9, the result has the
//   official v6.12.1 value. Where ARP had already changed that value, the ARP
//   value stays. Compared values are the label, description, required flag,
//   multiple-choice flag, input type and the _arp.dataverse properties.
//   Value lists keep every ARP label and gain labels the official block added.
//   The official blocks are compared without the values ARP does not offer.
// - In every version, 6.9.0 included, the citation language field has exactly
//   the ISO 639-2 languages of that version's official block (422 values), and
//   the archived 6.9.0 is the drafts with only that change.
// - A run that stopped after archiving 6.9.0 continues on a second run: the
//   drafts are not published as 6.9.0 again.
// - Each field that official v6.12.1 added is present and uses the block's
//   term URI. A new field stays embedded, as ARP keeps its fields. A new
//   element has one standalone resource under elements/. The template embeds
//   the id from the step that created the element. A later archive copies that
//   standalone to a new id, and pav:derivedFrom links the current copy back to
//   the embedded one. The upgrade makes no standalone field resources.
// - Field order follows official v6.12.1 when ARP had not reordered the shared
//   names. Otherwise the ARP order of those names stays.
// - Preview reports no edits for 6.10, the new geospatial fields for 6.11, and
//   the citation value Translator for 6.12.1. review and the rubric block are
//   listed as missing, and no template is created for them.
// - The folder is published as 6.12.1. Versions/Public/Dataverse holds 6.9.0, 6.10.0 and
//   6.11.0. schema:identifier is still the block name.
//
// How to read the output. One line per block, then a summary:
//
//   Run: 6.9.0 (citation language 7516 removed, 422 kept), 6.10.0, 6.11.0, 6.12.1
//   citation: 84 ARP fields, 0 new official fields
//   geospatial: 11 ARP fields, 27 new official fields
//   Restricted values: citation language 6.9.0: 422, ... 6.12.1: 422
//   All checks passed
//
// "ARP fields" is the number of fields on the ARP 6.9 template. "new official
// fields" is how many names official v6.12.1 has that ARP 6.9 did not. With
// the checked-in TSVs only geospatial gains fields, and it gains 27. A change
// in either number means the fixtures or the merge changed which names exist.
// These lines are counts, not the pass/fail result. The checks behind them
// print nothing when they pass.
//
// A failed check prints FAIL and the block, field and rule that broke, for
// example "FAIL citation title_hu skos:prefLabel keeps the ARP value". The run
// continues through the other checks, then exits with the failure count. An
// error before any block line means the converter or the fixtures were missing.
//
// The generated CEDAR resources are written to
// tests/node/fixtures/arp-upgrade/results. One folder per version: 6.9.0,
// 6.10.0 and 6.11.0 are the archived versions, and 6.12.1 is the published
// folder. Inside each version the layout matches an ARP export: one folder
// per template, the template JSON in that folder, and its standalone elements
// under elements/ (fields are embedded). Open a template JSON to see the
// fields, labels and values that version ended with. The folder is replaced
// on every run.

const path = require('path');
const {loadService} = require('./load-service');
const {CONST, SERVICE_DIR, copy, stop, blockNameOf, readTsvDir, loadOfficial, serveOfficial, createConverter,
    createStore, buildFolder, saveResults} = require('./arp-upgrade-store');
const {createChecks} = require('./arp-upgrade-checks');

const FIXTURES = path.join(__dirname, 'fixtures', 'arp-upgrade');
const CONVERT_URL = process.env.ARP_CONVERT_URL || 'http://localhost:8080/api/arp/convertTsvToCedarTemplate';

const OFFICIAL_TAGS = ['v6.9', 'v6.10', 'v6.11', 'v6.12.1'];
const TARGETS = ['6.10', '6.11', '6.12.1'];
const TAG_OF_VERSION = {'6.9.0': 'v6.9', '6.10.0': 'v6.10', '6.11.0': 'v6.11', '6.12.1': 'v6.12.1'};

async function main() {
    if (typeof fetch !== 'function') {
        stop('Node 18 or newer is required. This Node is ' + process.version);
    }
    const official = loadOfficial(path.join(FIXTURES, 'official'), OFFICIAL_TAGS);
    serveOfficial(official);
    const convertTsv = createConverter(CONVERT_URL);

    const merge = loadService(path.join(SERVICE_DIR, 'arp-mdb-merge.service.js'));
    const store = createStore();
    const checks = createChecks(store, merge);
    const check = checks.check;
    const HttpBuilderService = {post: function (url, data) { return {method: 'POST', url: url, data: data}; }};
    const AuthorizedBackendService = {
        doCall: function (request, succeed, fail) {
            if (request.url === CONVERT_URL) {
                convertTsv(request.data).then(function (json) {
                    succeed({data: json});
                }).catch(function () {
                    fail({});
                });
                return;
            }
            succeed({data: {}});
        }
    };
    const UrlService = {
        dataverseMdbListUrl: function (tag) {
            return 'https://api.github.com/repos/IQSS/dataverse/contents/scripts/api/data/metadatablocks?ref=' + tag;
        },
        dataverseMdbBaseUrl: function (tag) {
            return 'https://raw.githubusercontent.com/IQSS/dataverse/' + tag + '/scripts/api/data/metadatablocks';
        },
        arpConvertTsvToCedarTemplate: function () {
            return CONVERT_URL;
        }
    };
    const serviceFor = function (cedar) {
        return loadService(path.join(SERVICE_DIR, 'arp-dataverse-upgrade.service.js'), [
            cedar.arpService, merge, UrlService, HttpBuilderService, AuthorizedBackendService,
            {showArpError: function () {}}, {getHomeFolderId: function () { return 'home'; }}, CONST
        ]);
    };
    const service = serviceFor(store);

    const arpBlocks = {};
    readTsvDir(path.join(FIXTURES, 'arp', '6.9')).forEach(function (entry) {
        arpBlocks[blockNameOf(entry.tsv)] = entry.tsv;
    });
    const blockNames = Object.keys(arpBlocks).sort();
    check(blockNames.length === 7, 'ARP 6.9 has seven blocks, found ' + blockNames.join(', '));

    const arpTemplates = {};
    const official69 = {};
    const official612 = {};
    for (const block of blockNames) {
        arpTemplates[block] = await convertTsv(arpBlocks[block]);
        // As the upgrade sees them: without the values ARP does not offer
        official69[block] = await convertTsv(service.restrictOfficialTsv(block, official['v6.9'][block].tsv));
        official612[block] = await convertTsv(service.restrictOfficialTsv(block, official['v6.12.1'][block].tsv));
    }

    // The same place as on the ARP CEDAR: <home>/Public/Dataverse, as drafts that were never published.
    // The upgrade publishes them as 6.9.0 first, with only the values ARP offers.
    const root = buildFolder(store, merge, blockNames.map(function (block) { return arpTemplates[block]; }),
        store.newFolder('home', 'Public'));
    check((await service.startOf(root, '6.9.0')).state === 'unpublished', 'never published drafts start as unpublished');
    const before = {};
    const templates = checks.templatesIn(root);
    Object.keys(templates).forEach(function (block) {
        before[block] = checks.restrictedCopy(templates[block].json,
            service.restrictedValues(block, official['v6.9'][block].tsv));
    });

    const preview = await service.preview(root, '6.9.0', TARGETS);
    check(store.writes.count === 0, 'preview writes nothing');
    check(preview.map(function (report) { return report.version; }).join(',') === '6.9.0,6.10.0,6.11.0,6.12.1',
        'the preview starts with 6.9.0');
    checks.checkPreview(preview);

    const reports = await service.run({'@id': root, 'schema:name': 'Dataverse'}, '6.9.0', TARGETS);
    console.log('Run: ' + reports.map(function (report) {
        const restricted = [];
        report.blocks.forEach(function (block) {
            block.applied.forEach(function (change) {
                if (change.kind === 'restrictedLiterals') {
                    restricted.push(block.block + ' ' + change.name + ' ' + change.removed + ' removed, ' +
                        change.kept + ' kept');
                }
            });
        });
        return report.version + (restricted.length ? ' (' + restricted.join('; ') + ')' : '');
    }).join(', '));
    check(reports[0].version === '6.9.0' && reports[0].blocks.some(function (block) {
        return block.block === 'citation';
    }), 'the run starts by publishing 6.9.0 with only the allowed citation languages');
    checks.checkRun({
        startedFromDrafts: true,
        home: 'home', root: root, blockNames: blockNames, before: before, preview: preview,
        official69: official69, officialLatest: official612, version: '6.12.1', archived: ['6.9.0', '6.10.0', '6.11.0'],
        restrictedValues: function (block, version) {
            const tsv = official[TAG_OF_VERSION[version]][block];
            return tsv ? service.restrictedValues(block, tsv.tsv) : {};
        }
    });
    const results = path.join(FIXTURES, 'results');
    saveResults(store, 'home', root, results, '6.12.1');
    console.log('Wrote the generated versions to ' + path.relative(process.cwd(), results));

    await checkStoppedRun(serviceFor, merge, check, blockNames.map(function (block) {
        return arpTemplates[block];
    }));

    if (checks.result.failed) {
        stop(checks.result.failed + ' checks failed');
    }
    console.log('All checks passed');
}

// A run that stopped after archiving 6.9.0 leaves drafts too. Running again with 6.9.0 must continue
// that run: the drafts are not published as 6.9.0 again, and Versions keeps the one 6.9.0.
async function checkStoppedRun(serviceFor, merge, check, arpTemplates) {
    const cedar = createStore();
    const service = serviceFor(cedar);
    const root = buildFolder(cedar, merge, copy(arpTemplates), cedar.newFolder('home', 'Public'));
    await cedar.arpService.publishAll((await cedar.arpService.inspectFolderForPublishAll(root)).resources, '6.9.0');
    await cedar.arpService.bumpVersions(root, 'home', await cedar.arpService.inspectFolderForBump(root));
    const archived = cedar.versionFolders('home', root)['6.9.0'];
    const archivedCount = cedar.tree(archived).length;

    check((await service.startOf(root, '6.9.0')).state === 'draft', 'stopped run: drafts with 6.9.0 in Versions continue');
    const reports = await service.run({'@id': root, 'schema:name': 'Dataverse'}, '6.9.0', ['6.10']);
    check(reports.map(function (report) { return report.version; }).join(',') === '6.10.0',
        'stopped run: only 6.10.0 is made');
    check(Object.keys(cedar.versionFolders('home', root)).join(',') === '6.9.0' &&
        cedar.tree(archived).length === archivedCount, 'stopped run: Versions still holds the one 6.9.0');
    check(cedar.tree(root).every(function (id) {
        const json = cedar.resources[id].json;
        return json['bibo:status'] === 'bibo:published' && json['pav:version'] === '6.10.0';
    }), 'stopped run: the folder is published as 6.10.0');
}

main().catch(function (error) {
    console.error(error);
    process.exit(1);
});
