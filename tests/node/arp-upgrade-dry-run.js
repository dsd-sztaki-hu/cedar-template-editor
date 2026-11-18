'use strict';

// Runs "ARP Upgrade to Dataverse Version" on a copy of the live Dataverse
// folder, without changing CEDAR, and checks what the upgrade would make.
//
//   CEDAR_API_KEY=... npm run arp-upgrade:dry-run -- --folder /Public/Dataverse
//
// The folder and everything below it are read from CEDAR with GET requests
// only, into the in-memory CEDAR of arp-upgrade-store.js. The upgrade code of
// the CEDAR UI (arp-dataverse-upgrade.service.js and arp-mdb-merge.service.js)
// then runs on that copy, unchanged and with the same steps as the upgrade
// dialog: preview, then for each target version archive, merge, validate and
// publish. The official metadata blocks come from GitHub, and the TSV converter
// and the template check are the live ARP ones, as in the UI.
//
// If the folder holds drafts, the run first does what "Publish All" with the
// starting version does in the UI.
//
// Options (all optional):
//   --folder /Public/Dataverse    path below the home folder, or a folder @id
//   --domain <domain>             required: CEDAR is https://resource.<domain>
//   --home-user "CEDAR Admin"     whose home holds the folder and Versions
//   --from 6.9.0                  the version the folder is (or is published as)
//   --targets 6.10,6.11,6.12.1    the versions to upgrade to
//   --work-dir <dir>              default tests/node/work/<timestamp>
//   --source-dir <dir>            read a saved home folder instead of CEDAR
//   --official-dir <dir>          read <dir>/<tag>/*.tsv instead of GitHub
//   --api-key <key>               instead of CEDAR_API_KEY
//
// Settings can also come from the environment or from tests/node/.env (see
// .env.example there): CEDAR_API_KEY, CEDAR_DOMAIN, CEDAR_HOME_USER,
// ARP_UPGRADE_FOLDER, ARP_UPGRADE_FROM, ARP_UPGRADE_TARGETS, and ARP_CONVERT_URL
// and ARP_CHECK_URL for the ARP endpoints. A command-line option wins over the
// environment, and a variable set in the shell wins over .env.
//
// The work folder gets:
//   source/          the folder as read, before anything was simulated
//   official/<tag>/  the official TSVs the run used
//   results/<v>/     the published folder as <newest>, every archived version as <v>
//   expected-home/   the whole home folder after the run: the folder and Versions/...
//   layout.json      every resource of expected-home with its path, version and status
//   preview.json     what the preview reported for each version and block
//   report.txt       everything printed, ending with the result
//
// The exit code is 0 when every check passed.

const fs = require('fs');
const path = require('path');
const {loadService} = require('./load-service');
const {CONST, SERVICE_DIR, copy, loadEnv, setting, requireNode18, typeOf, blockNameOf, loadOfficial, serveOfficial, createConverter,
    createStore, saveTree, saveResults} = require('./arp-upgrade-store');
const {createChecks} = require('./arp-upgrade-checks');
const {liveSource, dirSource, loadFolder} = require('./cedar-read');

const ENV_FILE = loadEnv();

const CONVERT_URL = process.env.ARP_CONVERT_URL || 'https://repo.researchdata.hu/api/arp/convertTsvToCedarTemplate';
const CHECK_URL = process.env.ARP_CHECK_URL || 'https://repo.researchdata.hu/api/arp/checkCedarTemplate';
const DEFAULT_TARGETS = '6.10,6.11,6.12.1';

// ---------- small helpers ----------

function parseArgs(argv) {
    const options = {};
    for (let index = 0; index < argv.length; index++) {
        const match = /^--([a-z-]+)$/.exec(argv[index]);
        if (!match || index + 1 >= argv.length) {
            throw new Error('Unknown argument ' + argv[index]);
        }
        options[match[1]] = argv[++index];
    }
    return options;
}

// "6.10" -> "6.10.0" for CEDAR, "v6.10" for the Dataverse tag
function pavVersion(text) {
    const parts = String(text).replace(/^v/, '').split('.');
    while (parts.length < 3) {
        parts.push('0');
    }
    return parts.join('.');
}

function tagOf(version) {
    const parts = pavVersion(version).split('.');
    return 'v' + parts[0] + '.' + parts[1] + (parts[2] !== '0' ? '.' + parts[2] : '');
}

function timestamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

// Everything printed also goes to report.txt
function recordOutput() {
    const lines = [];
    ['log', 'error'].forEach(function (method) {
        const original = console[method];
        console[method] = function () {
            const line = Array.from(arguments).join(' ');
            lines.push(line);
            original.call(console, line);
        };
    });
    return lines;
}

// ---------- the official metadata blocks ----------

async function download(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error('GitHub returned ' + response.status + ' for ' + url);
    }
    return response;
}

// Saves the official TSVs of each tag to <directory>/<tag>/, as the UI loads them
async function downloadOfficial(directory, tags) {
    for (const tag of tags) {
        const listing = await (await download('https://api.github.com/repos/IQSS/dataverse/contents/scripts/api/data/metadatablocks?ref=' + tag)).json();
        const files = listing.filter(function (file) {
            return file.type === 'file' && /\.tsv$/.test(file.name);
        });
        fs.mkdirSync(path.join(directory, tag), {recursive: true});
        for (const file of files) {
            const tsv = await (await download('https://raw.githubusercontent.com/IQSS/dataverse/' + tag +
                '/scripts/api/data/metadatablocks/' + file.name)).text();
            fs.writeFileSync(path.join(directory, tag, file.name), tsv);
        }
        console.log('Official ' + tag + ': ' + files.length + ' metadata blocks');
    }
}

// ---------- reports ----------

// Every resource below the folder: path, type, name, version, status, and the path it was copied from
function layoutOf(store, folderId) {
    const pathOfId = {};
    const rows = [];

    function walk(id, prefix) {
        store.inFolder(id).forEach(function (resourceId) {
            pathOfId[resourceId] = prefix.concat(store.resources[resourceId].json['schema:name']).join('/');
        });
        store.subFolders(id).forEach(function (sub) {
            walk(sub, prefix.concat(store.folders[sub].name));
        });
    }

    walk(folderId, []);
    Object.keys(pathOfId).sort(function (first, second) {
        return pathOfId[first].localeCompare(pathOfId[second]);
    }).forEach(function (id) {
        const json = store.resources[id].json;
        rows.push({
            path: pathOfId[id],
            type: typeOf(json),
            version: json['pav:version'],
            status: json['bibo:status'],
            identifier: json['schema:identifier'],
            derivedFrom: json['pav:derivedFrom'] ? (pathOfId[json['pav:derivedFrom']] || json['pav:derivedFrom']) : undefined
        });
    });
    return rows;
}

function stateOf(store, root) {
    const counts = {};
    store.tree(root).forEach(function (id) {
        const json = store.resources[id].json;
        const key = json['bibo:status'] + ' ' + json['pav:version'];
        counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
}

// ---------- the run ----------

async function main() {
    requireNode18();
    const lines = recordOutput();
    const options = parseArgs(process.argv.slice(2));
    const folderPath = setting(options, 'folder', 'ARP_UPGRADE_FOLDER', '/Public/Dataverse');
    const from = pavVersion(setting(options, 'from', 'ARP_UPGRADE_FROM', '6.9.0'));
    const targets = setting(options, 'targets', 'ARP_UPGRADE_TARGETS', DEFAULT_TARGETS).split(',').map(function (text) { return text.trim(); });
    const versions = [from].concat(targets.map(pavVersion));
    const tags = versions.map(tagOf);
    const newest = versions[versions.length - 1];
    const work = path.resolve(options['work-dir'] || path.join(__dirname, 'work', timestamp()));
    fs.mkdirSync(work, {recursive: true});

    function finish(failed) {
        fs.writeFileSync(path.join(work, 'report.txt'), lines.join('\n') + '\n');
        console.log('Work folder: ' + work);
        process.exit(failed ? 1 : 0);
    }

    // The folder as it is now
    let source;
    if (options['source-dir']) {
        source = dirSource(options['source-dir']);
    } else {
        const apiKey = options['api-key'] || process.env.CEDAR_API_KEY;
        if (!apiKey) {
            console.error('Set CEDAR_API_KEY (or pass --api-key, or --source-dir for a saved folder).');
            process.exit(1);
        }
        source = liveSource({domain: setting(options, 'domain', 'CEDAR_DOMAIN'), apiKey: apiKey,
            homeUser: setting(options, 'home-user', 'CEDAR_HOME_USER', 'CEDAR Admin')});
    }
    if (ENV_FILE) {
        console.log('Settings from ' + ENV_FILE);
    }
    console.log('Reading ' + folderPath + ' from ' + source.describe);
    const store = createStore();
    const rootId = await source.resolve(folderPath);
    if (!rootId) {
        console.error('FAIL ' + folderPath + ' does not exist');
        finish(true);
    }
    const root = await loadFolder(source, store, rootId);
    saveTree(store, root, path.join(work, 'source'));
    console.log('Read ' + store.tree(root).length + ' resources: ' + JSON.stringify(stateOf(store, root)));

    const merge = loadService(path.join(SERVICE_DIR, 'arp-mdb-merge.service.js'));
    const checks = createChecks(store, merge);
    const check = checks.check;

    // Versions/<path from Public>/<version> must not exist yet, or the archive would mix with it
    const archived = versions.slice(0, -1);
    const versionsPath = '/Versions/' + store.publicPath(root).join('/');
    const existingVersions = await source.resolve(versionsPath);
    if (existingVersions) {
        const names = (await source.contents(existingVersions)).map(function (entry) { return entry['schema:name']; });
        console.log(versionsPath + ' already holds: ' + (names.join(', ') || 'nothing'));
        archived.forEach(function (version) {
            check(!names.includes(version), versionsPath + '/' + version + ' does not exist yet');
        });
    }

    // The starting state: all drafts (Publish All comes first) or all published as the starting version
    const ids = store.tree(root);
    const statuses = ids.map(function (id) { return store.resources[id].json['bibo:status']; });
    if (statuses.every(function (status) { return status === 'bibo:draft'; })) {
        const inspection = await store.arpService.inspectFolderForPublishAll(root);
        await store.arpService.publishAll(inspection.resources, from);
        console.log('The folder holds drafts: simulated Publish All as ' + from + ' (' + inspection.resources.length + ' resources)');
    } else {
        check(ids.every(function (id) {
            const json = store.resources[id].json;
            return json['bibo:status'] === 'bibo:published' && json['pav:version'] === from;
        }), 'every resource is a draft, or published as ' + from + '; found ' + JSON.stringify(stateOf(store, root)));
    }
    store.writes.count = 0;

    // The official blocks and the templates they belong to
    const officialDir = options['official-dir'] ? path.resolve(options['official-dir']) : path.join(work, 'official');
    if (!options['official-dir']) {
        await downloadOfficial(officialDir, tags);
    }
    const official = loadOfficial(officialDir, tags);
    serveOfficial(official);
    const convertTsv = createConverter(CONVERT_URL);

    const before = {};
    const templates = checks.templatesIn(root);
    store.tree(root).forEach(function (id) {
        const json = store.resources[id].json;
        if (typeOf(json) === 'template') {
            check(!!json['schema:identifier'], 'template ' + json['schema:name'] + ' has a schema:identifier');
        }
    });
    Object.keys(templates).filter(Boolean).forEach(function (block) {
        if (official[tags[0]][block]) {
            before[block] = copy(templates[block].json);
        } else {
            console.log('Template ' + templates[block].json['schema:name'] + ' (' + block + ') is not an official ' +
                tags[0] + ' block, the upgrade leaves it alone');
        }
    });
    const blockNames = Object.keys(before).sort();
    console.log('Templates of official blocks: ' + blockNames.join(', '));

    const officialFrom = {};
    const officialNewest = {};
    for (const block of blockNames) {
        officialFrom[block] = await convertTsv(official[tags[0]][block].tsv);
        officialNewest[block] = official[tags[tags.length - 1]][block] ?
            await convertTsv(official[tags[tags.length - 1]][block].tsv) : officialFrom[block];
    }

    // The UI's upgrade service, on the copy. Changed templates are checked by the live ARP check.
    const validations = {passed: 0, failed: []};
    store.arpService.validateResource = function (json) {
        return {method: 'POST', url: CHECK_URL, data: json};
    };
    const HttpBuilderService = {post: function (url, data) { return {method: 'POST', url: url, data: data}; }};
    const AuthorizedBackendService = {
        doCall: function (request, succeed, fail) {
            if (request.url === CONVERT_URL) {
                convertTsv(request.data).then(function (json) {
                    succeed({data: json});
                }).catch(function () {
                    fail({});
                });
            } else if (request.url === CHECK_URL) {
                fetch(CHECK_URL, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(request.data)
                }).then(async function (response) {
                    const body = await response.text();
                    if (response.ok) {
                        validations.passed++;
                        succeed({data: body});
                    } else {
                        validations.failed.push(request.data['schema:name'] + ': ' + body);
                        fail({status: response.status, data: body});
                    }
                }).catch(function (error) {
                    validations.failed.push(request.data['schema:name'] + ': ' + error.message);
                    fail({});
                });
            } else {
                fail({status: 0, data: 'unexpected request ' + request.url});
            }
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
    const service = loadService(path.join(SERVICE_DIR, 'arp-dataverse-upgrade.service.js'), [
        store.arpService, merge, UrlService, HttpBuilderService, AuthorizedBackendService,
        {showArpError: function () {}}, {getHomeFolderId: function () { return 'home'; }}, CONST
    ]);

    const preview = await service.preview(root, from, targets);
    check(store.writes.count === 0, 'preview writes nothing');
    fs.writeFileSync(path.join(work, 'preview.json'), JSON.stringify(preview, null, 2) + '\n');
    preview.forEach(function (report) {
        console.log('Preview ' + report.version + ': ' + (report.blocks.map(function (block) {
            return block.block + ' ' + block.applied.length + ' changes, ' + block.keptArp.length + ' ARP values kept';
        }).join('; ') || 'no changes') + (report.missingTemplates.length ?
            ' (no template for ' + report.missingTemplates.join(', ') + ')' : ''));
    });
    if (from === '6.9.0' && targets.join(',') === DEFAULT_TARGETS) {
        checks.checkPreview(preview);
    }

    try {
        await service.run({'@id': root, 'schema:name': store.folders[root].name}, from, targets, function (step, version) {
            if (step !== 'done') {
                console.log('  ' + version + ': ' + step);
            }
        });
    } catch (error) {
        check(false, 'the upgrade stopped: ' + (error.messageKey || error.message) + ' ' +
            JSON.stringify(error.messageParams || {}));
    }
    console.log('Template check: ' + validations.passed + ' passed' +
        (validations.failed.length ? ', failed: ' + validations.failed.join(' | ') : ''));

    checks.checkRun({
        home: 'home', root: root, blockNames: blockNames, before: before, preview: preview,
        official69: officialFrom, officialLatest: officialNewest, version: newest, archived: archived
    });

    saveResults(store, 'home', root, path.join(work, 'results'), newest);
    fs.rmSync(path.join(work, 'expected-home'), {recursive: true, force: true});
    saveTree(store, 'home', path.join(work, 'expected-home'));
    fs.writeFileSync(path.join(work, 'layout.json'), JSON.stringify(layoutOf(store, 'home'), null, 2) + '\n');

    console.log('CEDAR requests: ' + JSON.stringify(source.requests));
    console.log(checks.result.failed ? 'FAILED: ' + checks.result.failed + ' checks' : 'All checks passed');
    finish(checks.result.failed > 0);
}

main().catch(function (error) {
    console.error(error.stack || error);
    process.exit(1);
});
