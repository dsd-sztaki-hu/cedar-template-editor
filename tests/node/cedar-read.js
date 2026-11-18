'use strict';

// Read-only access to CEDAR folders and resources for the ARP upgrade dry-run
// and post-check. Two sources answer the same calls:
//
//   liveSource  the CEDAR REST API, with an API key. Only GET requests are sent.
//   dirSource   a folder tree on disk as saveTree writes it: one directory per
//               folder, one JSON per resource. Used for saved snapshots and to
//               test the tools without CEDAR.
//
// A source has:
//   home()                   {id, name} of the home folder
//   resolve(pathOrId)        folder id of "/Public/Dataverse" (from home) or of a folder @id
//   contents(folderId)       folders and resources directly in the folder, as CEDAR lists them
//   pathFromHome(folderId)   [{id, name}] from below home down to the folder
//   resource(id, type)       the JSON of a template, element or field
//   requests                 the number of requests by method

const fs = require('fs');
const path = require('path');
const {typeOf} = require('./arp-upgrade-store');

const RESOURCE_PATHS = {template: 'templates', element: 'template-elements', field: 'template-fields'};
const ALL_TYPES = 'folder,template,element,field';
const PAGE_SIZE = 500;

function liveSource(options) {
    if (!options.domain || /[<>\s]/.test(options.domain)) {
        throw new Error('Set CEDAR_DOMAIN (or --domain) to the base domain of the CEDAR: the CEDAR web app is ' +
            'https://cedar.<domain> and its API https://resource.<domain>');
    }
    const resourceBase = 'https://resource.' + options.domain;
    const userBase = 'https://user.' + options.domain;
    const requests = {};
    let home = null;

    async function get(url) {
        requests.GET = (requests.GET || 0) + 1;
        let response;
        try {
            response = await fetch(url, {
                method: 'GET',
                headers: {'Authorization': 'apiKey ' + options.apiKey, 'Accept': 'application/json'}
            });
        } catch (error) {
            const reason = error.cause && error.cause.code === 'ENOTFOUND' ?
                'there is no host ' + new URL(url).host + ', check CEDAR_DOMAIN' :
                (error.cause && (error.cause.code || error.cause.message)) || error.message;
            throw new Error('CEDAR is not reachable: GET ' + url + ' (' + reason + ')');
        }
        if (!response.ok) {
            throw new Error('CEDAR returned ' + response.status + ' for GET ' + url);
        }
        return response.json();
    }

    async function page(folderId, offset) {
        return get(resourceBase + '/folders/' + encodeURIComponent(folderId) + '/contents?resource_types=' + ALL_TYPES +
            '&version=all&publication_status=all&limit=' + PAGE_SIZE + '&offset=' + offset);
    }

    async function contents(folderId) {
        const collected = [];
        for (;;) {
            const response = await page(folderId, collected.length);
            const resources = (response.resources || []).filter(Boolean);
            collected.push(...resources);
            const total = response.totalCount;
            if (resources.length === 0 || (typeof total === 'number' ? collected.length >= total : resources.length < PAGE_SIZE)) {
                return collected;
            }
        }
    }

    // The home folder of the user named options.homeUser, as create_builtin_folders.py finds it
    async function findHome() {
        if (!home) {
            const users = (await get(resourceBase + '/users')).users || [];
            const user = users.find(function (candidate) {
                return candidate['schema:name'] === options.homeUser;
            });
            if (!user) {
                throw new Error('No CEDAR user named "' + options.homeUser + '"');
            }
            const uuid = /[a-f0-9-]{36}/.exec(user['@id'])[0];
            // CEDAR shows a profile only to its own user
            const profile = await get(userBase + '/users/' + uuid).catch(function (error) {
                if (/returned 40[13]/.test(error.message)) {
                    throw new Error('The API key is not the key of "' + options.homeUser + '": CEDAR does not show ' +
                        'that user\'s profile to it. Use the API key of "' + options.homeUser + '" from its CEDAR profile.');
                }
                throw error;
            });
            home = {id: profile.homeFolderId, name: options.homeUser};
        }
        return home;
    }

    async function pathFromHome(folderId) {
        const homeId = (await findHome()).id;
        const pathInfo = (await page(folderId, 0)).pathInfo || [];
        const start = pathInfo.findIndex(function (folder) { return folder['@id'] === homeId; });
        if (start < 0) {
            throw new Error('The folder ' + folderId + ' is not below the home folder of ' + options.homeUser);
        }
        const names = pathInfo.slice(start + 1).map(function (folder) {
            return {id: folder['@id'], name: folder['schema:name']};
        });
        if (!names.length || names[names.length - 1].id !== folderId) {
            throw new Error('CEDAR did not give the path of ' + folderId);
        }
        return names;
    }

    async function resolve(pathOrId) {
        if (/^https?:\/\//.test(pathOrId)) {
            return pathOrId;
        }
        let current = (await findHome()).id;
        for (const name of pathOrId.split('/').filter(Boolean)) {
            const child = (await contents(current)).find(function (entry) {
                return entry.resourceType === 'folder' && entry['schema:name'] === name;
            });
            if (!child) {
                return null;
            }
            current = child['@id'];
        }
        return current;
    }

    async function resource(id, type) {
        return get(resourceBase + '/' + RESOURCE_PATHS[type] + '/' + encodeURIComponent(id));
    }

    return {
        describe: resourceBase + ' (home of ' + options.homeUser + ')',
        home: findHome, resolve: resolve, contents: contents, pathFromHome: pathFromHome, resource: resource,
        requests: requests
    };
}

// The directory is the home folder. Folder ids are "dir:" and the path below it.
function dirSource(directory) {
    const root = path.resolve(directory);
    const requests = {};
    const jsonById = {};

    function folderPath(folderId) {
        return folderId === 'dir:' ? root : path.join(root, folderId.slice(4));
    }

    function contents(folderId) {
        const dir = folderPath(folderId);
        const relative = folderId.slice(4);
        return fs.readdirSync(dir, {withFileTypes: true}).sort(function (first, second) {
            return first.name.localeCompare(second.name);
        }).flatMap(function (entry) {
            if (entry.isDirectory()) {
                return [{'@id': 'dir:' + path.join(relative, entry.name), resourceType: 'folder', 'schema:name': entry.name}];
            }
            if (!entry.name.endsWith('.json')) {
                return [];
            }
            const json = JSON.parse(fs.readFileSync(path.join(dir, entry.name), 'utf8'));
            if (!typeOf(json)) {
                return [];
            }
            jsonById[json['@id']] = json;
            return [{
                '@id': json['@id'],
                resourceType: typeOf(json),
                'schema:name': json['schema:name'],
                'bibo:status': json['bibo:status'],
                'pav:version': json['pav:version']
            }];
        });
    }

    return {
        describe: root,
        home: async function () { return {id: 'dir:', name: path.basename(root)}; },
        resolve: async function (pathOrId) {
            const relative = pathOrId.split('/').filter(Boolean).join(path.sep);
            return fs.existsSync(path.join(root, relative)) ? 'dir:' + relative : null;
        },
        contents: async function (folderId) {
            return contents(folderId);
        },
        pathFromHome: async function (folderId) {
            const names = folderId.slice(4).split(path.sep).filter(Boolean);
            return names.map(function (name, index) {
                return {id: 'dir:' + names.slice(0, index + 1).join(path.sep), name: name};
            });
        },
        resource: async function (id) {
            if (!jsonById[id]) {
                throw new Error('Not in the directory: ' + id);
            }
            return JSON.parse(JSON.stringify(jsonById[id]));
        },
        requests: requests
    };
}

// Copies a source folder and everything below it into the in-memory store, keeping the ids.
// The folders from home down to it are added too, so the store knows the path, e.g. Public/Dataverse.
async function loadFolder(source, store, folderId) {
    let parent = 'home';
    for (const folder of await source.pathFromHome(folderId)) {
        parent = store.folders[folder.id] ? folder.id : store.seedFolder(folder.id, parent, folder.name);
    }
    await loadBelow(source, store, folderId);
    return folderId;
}

async function loadBelow(source, store, folderId) {
    const entries = await source.contents(folderId);
    for (const entry of entries) {
        if (entry.resourceType === 'folder') {
            store.seedFolder(entry['@id'], folderId, entry['schema:name'], entry['schema:description']);
            await loadBelow(source, store, entry['@id']);
        } else {
            store.seed(folderId, await source.resource(entry['@id'], entry.resourceType));
        }
    }
}

module.exports = {liveSource, dirSource, loadFolder};
