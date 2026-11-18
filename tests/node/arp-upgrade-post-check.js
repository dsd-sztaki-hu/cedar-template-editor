'use strict';

// After "ARP Upgrade to Dataverse Version" ran in the CEDAR UI, checks that
// live CEDAR holds what the dry-run expected.
//
//   CEDAR_API_KEY=... npm run arp-upgrade:post-check -- --against tests/node/work/<timestamp>
//
// Reads, with GET requests only, the upgraded folder and its archived versions
// under Versions/<path from Public>, and compares them with expected-home/ of
// the dry-run work folder. Resources are matched by their folder path, type and
// schema:name, so the ids CEDAR gave them do not matter. For every resource:
//
// - It exists on both sides, and no resource or folder is extra or missing.
// - Its JSON is the same, apart from ids, timestamps and who made it. Version,
//   status and schema:identifier are compared.
// - pav:derivedFrom points to the resource at the same path as in the dry-run,
//   i.e. to the archived resource of the version before.
// - Every field and element embedded in it is the resource at the same path as
//   in the dry-run, and that resource exists.
//
// Options: --against <work dir> (required), --folder, --domain, --home-user,
// --api-key and --source-dir as for the dry-run. The result is written to
// post-check.txt in the work folder. The exit code is 0 when nothing differs.
// The settings can also come from the environment or tests/node/.env, as for the dry-run.

const fs = require('fs');
const path = require('path');
const {TYPES, loadEnv, setting, requireNode18, createStore} = require('./arp-upgrade-store');
const {liveSource, dirSource, loadFolder} = require('./cedar-read');

const ENV_FILE = loadEnv();

// Set by CEDAR on every save or copy
const IGNORED_KEYS = ['@id', 'pav:derivedFrom', 'pav:createdOn', 'pav:createdBy', 'pav:lastUpdatedOn', 'oslc:modifiedBy'];
const MAX_DIFFS_PER_RESOURCE = 5;

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

// The JSON without what CEDAR changes on every write, with sorted keys
function normalized(value) {
    if (Array.isArray(value)) {
        return value.map(normalized);
    }
    if (value && typeof value === 'object') {
        const result = {};
        Object.keys(value).sort().forEach(function (key) {
            if (!IGNORED_KEYS.includes(key)) {
                result[key] = normalized(value[key]);
            }
        });
        return result;
    }
    return value;
}

// The JSON paths where two values differ
function differences(first, second, at, found) {
    if (found.length >= MAX_DIFFS_PER_RESOURCE) {
        return found;
    }
    if (first && second && typeof first === 'object' && typeof second === 'object' &&
        Array.isArray(first) === Array.isArray(second)) {
        const keys = Array.from(new Set(Object.keys(first).concat(Object.keys(second))));
        keys.forEach(function (key) {
            differences(first[key], second[key], at + (Array.isArray(first) ? '[' + key + ']' : '.' + key), found);
        });
    } else if (JSON.stringify(first) !== JSON.stringify(second)) {
        found.push(at.slice(1) + ': expected ' + JSON.stringify(second === undefined ? null : second).slice(0, 80) +
            ', found ' + JSON.stringify(first === undefined ? null : first).slice(0, 80));
    }
    return found;
}

// The ids of the fields and elements embedded in a resource
function embeddedIds(json) {
    const ids = [];

    function walk(value, top) {
        if (Array.isArray(value)) {
            value.forEach(function (item) { walk(item, false); });
        } else if (value && typeof value === 'object') {
            if (!top && TYPES[value['@type']] && typeof value['@id'] === 'string') {
                ids.push(value['@id']);
            }
            Object.keys(value).forEach(function (key) { walk(value[key], false); });
        }
    }

    walk(json, true);
    return ids;
}

// Every folder and resource of the store by its path below home
function describe(store) {
    const pathOfId = {};
    const folders = [];

    function walk(id, prefix) {
        store.inFolder(id).forEach(function (resourceId) {
            const json = store.resources[resourceId].json;
            pathOfId[resourceId] = prefix.concat(store.typeOf(json) + ':' + json['schema:name']).join('/');
        });
        store.subFolders(id).forEach(function (sub) {
            const folderPath = prefix.concat(store.folders[sub].name);
            folders.push(folderPath.join('/'));
            walk(sub, folderPath);
        });
    }

    walk('home', []);
    const resources = {};
    Object.keys(pathOfId).forEach(function (id) {
        const json = store.resources[id].json;
        const where = function (target) {
            return target ? (pathOfId[target] || 'missing ' + target) : null;
        };
        if (resources[pathOfId[id]]) {
            resources[pathOfId[id]].duplicate = true;
            return;
        }
        resources[pathOfId[id]] = {
            json: normalized(json),
            derivedFrom: where(json['pav:derivedFrom']),
            embedded: embeddedIds(json).map(where)
        };
    });
    return {folders: folders.sort(), resources: resources};
}

// Loads the folder and its archived versions from a source into a new store
async function load(source, folderPath) {
    const store = createStore();
    const rootId = await source.resolve(folderPath);
    if (!rootId) {
        throw new Error(folderPath + ' does not exist in ' + source.describe);
    }
    const root = await loadFolder(source, store, rootId);
    const versionsId = await source.resolve('/Versions/' + store.publicPath(root).join('/'));
    if (versionsId) {
        await loadFolder(source, store, versionsId);
    }
    return store;
}

async function main() {
    requireNode18();
    const options = parseArgs(process.argv.slice(2));
    if (!options.against) {
        throw new Error('Give the dry-run work folder with --against');
    }
    const work = path.resolve(options.against);
    const folderPath = setting(options, 'folder', 'ARP_UPGRADE_FOLDER', '/Public/Dataverse');
    const lines = [];
    const say = function (line) {
        lines.push(line);
        console.log(line);
    };

    let source;
    if (options['source-dir']) {
        source = dirSource(options['source-dir']);
    } else {
        const apiKey = options['api-key'] || process.env.CEDAR_API_KEY;
        if (!apiKey) {
            throw new Error('Set CEDAR_API_KEY (or pass --api-key, or --source-dir for a saved folder).');
        }
        source = liveSource({domain: setting(options, 'domain', 'CEDAR_DOMAIN'), apiKey: apiKey,
            homeUser: setting(options, 'home-user', 'CEDAR_HOME_USER', 'CEDAR Admin')});
    }

    if (ENV_FILE) {
        say('Settings from ' + ENV_FILE);
    }
    say('Comparing ' + folderPath + ' and its versions in ' + source.describe);
    say('with the dry-run in ' + work);
    const actual = describe(await load(source, folderPath));
    const expected = describe(await load(dirSource(path.join(work, 'expected-home')), folderPath));
    const problems = [];

    expected.folders.filter(function (folder) { return !actual.folders.includes(folder); }).forEach(function (folder) {
        problems.push('missing folder ' + folder);
    });
    actual.folders.filter(function (folder) { return !expected.folders.includes(folder); }).forEach(function (folder) {
        problems.push('extra folder ' + folder);
    });
    Object.keys(expected.resources).sort().forEach(function (where) {
        const want = expected.resources[where];
        const got = actual.resources[where];
        if (!got) {
            problems.push('missing ' + where);
            return;
        }
        if (got.duplicate) {
            problems.push('more than one ' + where);
        }
        differences(got.json, want.json, '', []).forEach(function (difference) {
            problems.push(where + ' ' + difference);
        });
        if (got.derivedFrom !== want.derivedFrom) {
            problems.push(where + ' pav:derivedFrom is ' + got.derivedFrom + ', expected ' + want.derivedFrom);
        }
        if (JSON.stringify(got.embedded) !== JSON.stringify(want.embedded)) {
            const wrong = got.embedded.filter(function (target, index) { return target !== want.embedded[index]; });
            problems.push(where + ' embeds ' + (wrong.slice(0, 3).join(', ') || 'fewer resources') +
                ' instead of what the dry-run embeds');
        }
    });
    Object.keys(actual.resources).filter(function (where) { return !expected.resources[where]; }).sort()
        .forEach(function (where) {
            problems.push('extra ' + where);
        });

    say('Compared ' + Object.keys(expected.resources).length + ' expected resources in ' + expected.folders.length +
        ' folders with ' + Object.keys(actual.resources).length + ' found');
    problems.forEach(function (problem) { say('DIFF ' + problem); });
    say('CEDAR requests: ' + JSON.stringify(source.requests));
    say(problems.length ? problems.length + ' differences' : 'Live CEDAR matches the dry-run');
    fs.writeFileSync(path.join(work, 'post-check.txt'), lines.join('\n') + '\n');
    process.exit(problems.length ? 1 : 0);
}

main().catch(function (error) {
    console.error(error.stack || error);
    process.exit(1);
});
