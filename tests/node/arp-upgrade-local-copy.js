'use strict';

// Puts a saved copy of the live Dataverse folder into a LOCAL CEDAR, so the
// whole upgrade workflow can be rehearsed locally before it is done on live.
//
//   npm run arp-upgrade:local-copy -- --source tests/node/work/<timestamp>/source --yes
//
// The source is the source/ folder of a dry-run against live CEDAR: the live
// /Public/Dataverse as it was read. On the local CEDAR this:
//
//   1. deletes /Public/Dataverse and everything in it,
//   2. deletes /Versions/Public/Dataverse (the archives of an earlier upgrade),
//   3. creates /Public/Dataverse again and uploads every folder, template,
//      element and field of the source into it, as drafts.
//
// CEDAR gives the uploaded resources new ids. Where a template or element
// embeds the id of a standalone resource of the source, the id is replaced
// with the id of the uploaded copy. Afterwards the folder is read back and
// compared with the source.
//
// It only runs against a local CEDAR (a domain ending in .orgx). Without --yes
// it only prints what it would delete and upload.
//
// Options:
//   --source <dir>              required, the source/ folder of a dry-run
//   --domain arp.orgx           the local CEDAR
//   --folder /Public/Dataverse  where the copy goes, below the home folder
//   --home-user "CEDAR Admin"
//   --api-key <key>             default LOCAL_CEDAR_API_KEY, then the local development key.
//                               It never uses CEDAR_API_KEY or tests/node/.env, which are for live.
//   --yes                       really delete and upload
//
// A local CEDAR usually has a self-signed certificate: run with
// NODE_TLS_REJECT_UNAUTHORIZED=0.

const fs = require('fs');
const path = require('path');
const {requireNode18, typeOf, createStore} = require('./arp-upgrade-store');
const {liveSource, dirSource, loadFolder} = require('./cedar-read');

const LOCAL_DEVELOPMENT_KEY = '0000111122223333444455556666777788889999aaaabbbbccccddddeeeeffff';
const RESOURCE_PATHS = {template: 'templates', element: 'template-elements', field: 'template-fields', folder: 'folders'};
// Standalone resources first, so the resources that embed them can point to the new ids
const UPLOAD_ORDER = ['field', 'element', 'template'];
const SET_BY_CEDAR = ['@id', 'pav:derivedFrom', 'pav:createdOn', 'pav:createdBy', 'pav:lastUpdatedOn', 'oslc:modifiedBy'];

function parseArgs(argv) {
    const options = {};
    for (let index = 0; index < argv.length; index++) {
        const match = /^--([a-z-]+)$/.exec(argv[index]);
        if (!match) {
            throw new Error('Unknown argument ' + argv[index]);
        }
        if (match[1] === 'yes') {
            options.yes = true;
        } else if (index + 1 < argv.length) {
            options[match[1]] = argv[++index];
        } else {
            throw new Error('Missing value for ' + argv[index]);
        }
    }
    return options;
}

// The only place that writes to CEDAR
function localWriter(domain, apiKey) {
    if (!/\.orgx$/.test(domain)) {
        throw new Error('Refusing to write to ' + domain + ': this script only changes a local CEDAR (*.orgx)');
    }
    const base = 'https://resource.' + domain;
    const counts = {};

    async function send(method, url, body) {
        counts[method] = (counts[method] || 0) + 1;
        const response = await fetch(url, {
            method: method,
            headers: {'Authorization': 'apiKey ' + apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json'},
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        if (!response.ok) {
            throw new Error(method + ' ' + url + ' returned ' + response.status + ': ' + (await response.text()).slice(0, 300));
        }
        const text = await response.text();
        return text ? JSON.parse(text) : null;
    }

    return {
        counts: counts,
        remove: function (type, id) {
            return send('DELETE', base + '/' + RESOURCE_PATHS[type] + '/' + encodeURIComponent(id));
        },
        createFolder: async function (parentId, name) {
            return (await send('POST', base + '/folders', {folderId: parentId, name: name, description: name}))['@id'];
        },
        create: async function (folderId, json) {
            return (await send('POST', base + '/' + RESOURCE_PATHS[typeOf(json)] + '?folder_id=' + encodeURIComponent(folderId),
                json))['@id'];
        }
    };
}

// Deletes a folder and everything below it, deepest first
async function deleteTree(source, writer, folderId, say) {
    for (const entry of await source.contents(folderId)) {
        if (entry.resourceType === 'folder') {
            await deleteTree(source, writer, entry['@id'], say);
        } else {
            await writer.remove(entry.resourceType, entry['@id']);
        }
    }
    await writer.remove('folder', folderId);
}

// Every folder and resource of the store below the folder, by path
function collect(store, folderId) {
    const folders = [];
    const resources = [];

    function walk(id, prefix) {
        store.inFolder(id).forEach(function (resourceId) {
            resources.push({path: prefix, json: store.resources[resourceId].json});
        });
        store.subFolders(id).sort(function (first, second) {
            return store.folders[first].name.localeCompare(store.folders[second].name);
        }).forEach(function (sub) {
            const folderPath = prefix.concat(store.folders[sub].name);
            folders.push(folderPath);
            walk(sub, folderPath);
        });
    }

    walk(folderId, []);
    return {folders: folders, resources: resources};
}

// The JSON for a new resource: no CEDAR identity, a draft, embedded ids moved to the uploaded copies
function forUpload(json, newIds) {
    const text = JSON.stringify(json, function (key, value) {
        if (SET_BY_CEDAR.includes(key) && this === json) {
            return undefined;
        }
        return typeof value === 'string' && newIds[value] ? newIds[value] : value;
    });
    const result = JSON.parse(text);
    result['bibo:status'] = 'bibo:draft';
    result['pav:version'] = '0.0.1';
    return result;
}

function comparable(json) {
    return JSON.stringify(json, function (key, value) {
        if (SET_BY_CEDAR.includes(key) || key === 'bibo:status' || key === 'pav:version') {
            return undefined;
        }
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            return Object.keys(value).sort().reduce(function (sorted, name) {
                sorted[name] = value[name];
                return sorted;
            }, {});
        }
        return value;
    });
}

async function main() {
    requireNode18();
    const options = parseArgs(process.argv.slice(2));
    if (!options.source) {
        throw new Error('Give the source/ folder of a dry-run with --source');
    }
    const domain = options.domain || 'arp.orgx';
    // Not CEDAR_API_KEY: that may be the live key, which a local CEDAR must not get
    const apiKey = options['api-key'] || process.env.LOCAL_CEDAR_API_KEY || LOCAL_DEVELOPMENT_KEY;
    const folderPath = options.folder || '/Public/Dataverse';
    const homeUser = options['home-user'] || 'CEDAR Admin';
    const writer = localWriter(domain, apiKey);
    const local = liveSource({domain: domain, apiKey: apiKey, homeUser: homeUser});

    // The source, read like a home folder that holds only the copied folder
    const sourceStore = createStore();
    const sourceDir = path.resolve(options.source);
    if (!fs.existsSync(sourceDir)) {
        throw new Error('No such folder: ' + sourceDir);
    }
    const sourceRoot = await loadFolder(dirSource(sourceDir), sourceStore, 'dir:');
    const wanted = collect(sourceStore, sourceRoot);
    const counts = {};
    wanted.resources.forEach(function (resource) {
        const type = typeOf(resource.json);
        counts[type] = (counts[type] || 0) + 1;
    });

    const names = folderPath.split('/').filter(Boolean);
    const parentPath = '/' + names.slice(0, -1).join('/');
    const existing = await local.resolve(folderPath);
    const parentId = await local.resolve(parentPath);
    if (!parentId) {
        throw new Error(parentPath + ' does not exist in the local CEDAR');
    }
    const versionsPath = '/Versions/' + names.slice(names.indexOf('Public') < 0 ? -1 : names.indexOf('Public')).join('/');
    const existingVersions = await local.resolve(versionsPath);

    console.log('Local CEDAR: ' + local.describe);
    console.log('Will delete: ' + (existing ? folderPath : '(no ' + folderPath + ')') + ', ' +
        (existingVersions ? versionsPath : '(no ' + versionsPath + ')'));
    console.log('Will upload to ' + folderPath + ' from ' + sourceDir + ': ' + wanted.folders.length + ' folders, ' +
        JSON.stringify(counts) + ', as drafts');
    if (!options.yes) {
        console.log('Nothing changed. Run again with --yes to do it.');
        return;
    }

    if (existing) {
        await deleteTree(local, writer, existing);
    }
    if (existingVersions) {
        await deleteTree(local, writer, existingVersions);
    }
    console.log('Deleted the old folders');

    const rootId = await writer.createFolder(parentId, names[names.length - 1]);
    const folderIds = {'': rootId};
    for (const folder of wanted.folders) {
        folderIds[folder.join('/')] = await writer.createFolder(folderIds[folder.slice(0, -1).join('/')], folder[folder.length - 1]);
    }
    const newIds = {};
    for (const type of UPLOAD_ORDER) {
        for (const resource of wanted.resources.filter(function (item) { return typeOf(item.json) === type; })) {
            newIds[resource.json['@id']] = await writer.create(folderIds[resource.path.join('/')], forUpload(resource.json, newIds));
        }
    }
    console.log('Uploaded ' + Object.keys(newIds).length + ' resources');

    // Read the copy back and compare it with the source
    const copyStore = createStore();
    await loadFolder(liveSource({domain: domain, apiKey: apiKey, homeUser: homeUser}), copyStore, rootId);
    const got = collect(copyStore, rootId);
    const key = function (resource) {
        return resource.path.concat(typeOf(resource.json) + ':' + resource.json['schema:name']).join('/');
    };
    const gotByKey = {};
    got.resources.forEach(function (resource) { gotByKey[key(resource)] = resource; });
    const problems = [];
    wanted.resources.forEach(function (resource) {
        const copy = gotByKey[key(resource)];
        if (!copy) {
            problems.push('missing ' + key(resource));
        } else if (comparable(forUpload(resource.json, newIds)) !== comparable(copy.json)) {
            problems.push('different ' + key(resource));
        } else if (copy.json['bibo:status'] !== 'bibo:draft') {
            problems.push('not a draft ' + key(resource));
        }
    });
    if (got.resources.length !== wanted.resources.length) {
        problems.push('the copy has ' + got.resources.length + ' resources, the source ' + wanted.resources.length);
    }
    problems.slice(0, 20).forEach(function (problem) { console.log('DIFF ' + problem); });
    console.log('Local CEDAR requests: ' + JSON.stringify(writer.counts));
    console.log(problems.length ? problems.length + ' differences between the copy and the source' :
        'The local ' + folderPath + ' is now a draft copy of the source');
    process.exit(problems.length ? 1 : 0);
}

main().catch(function (error) {
    console.error(error.stack || error);
    process.exit(1);
});
