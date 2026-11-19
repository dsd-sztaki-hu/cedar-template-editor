'use strict';

// The pieces of the ARP Dataverse upgrade checks that do not depend on where
// the resources come from: an in-memory CEDAR that answers the arpService calls
// the upgrade makes, the official metadata blocks served as if from GitHub, the
// TSV converter, and writing a folder tree to disk.

const fs = require('fs');
const path = require('path');

const TYPES = {
    'https://schema.metadatacenter.org/core/Template': 'template',
    'https://schema.metadatacenter.org/core/TemplateElement': 'element',
    'https://schema.metadatacenter.org/core/TemplateField': 'field'
};
const CONST = {resourceType: {FOLDER: 'folder', TEMPLATE: 'template', ELEMENT: 'element', FIELD: 'field'}};
const SERVICE_DIR = path.join(__dirname, '../../app/scripts/service');

function copy(value) {
    return JSON.parse(JSON.stringify(value));
}

function stop(message) {
    console.error(message);
    process.exit(1);
}

// Reads KEY=value lines of tests/node/.env into process.env. A variable that is already set,
// e.g. in the shell, is kept. Returns the file that was read, or null.
function loadEnv(file) {
    const envFile = file || path.join(__dirname, '.env');
    if (!fs.existsSync(envFile)) {
        return null;
    }
    fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach(function (line) {
        const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
        if (!match || line.trim().startsWith('#')) {
            return;
        }
        const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
        if (process.env[match[1]] === undefined && value !== '') {
            process.env[match[1]] = value;
        }
    });
    return envFile;
}

// An option from the command line, else from the environment, else the default
function setting(options, flag, variable, fallback) {
    return options[flag] || process.env[variable] || fallback;
}

// fetch is built into Node 18 and newer
function requireNode18() {
    if (typeof fetch !== 'function') {
        stop('Node 18 or newer is required, this is Node ' + process.version + '. With nvm: nvm use 22');
    }
}

function typeOf(json) {
    return TYPES[json['@type']] || null;
}

function versionNumber(version) {
    const parts = String(version).split('.').map(Number);
    return parts[0] * 1000000 + parts[1] * 1000 + parts[2];
}

// ---------- metadata blocks ----------

function blockNameOf(tsv) {
    const lines = tsv.split(/\r?\n/);
    const header = lines.findIndex(function (line) {
        return line.indexOf('#metadataBlock') === 0;
    });
    const row = header < 0 ? null : lines[header + 1];
    return row ? row.split('\t')[1] : null;
}

function readTsvDir(directory) {
    if (!fs.existsSync(directory)) {
        stop('Missing TSV folder ' + directory);
    }
    return fs.readdirSync(directory).filter(function (name) {
        return name.endsWith('.tsv');
    }).sort().map(function (file) {
        return {file: file, tsv: fs.readFileSync(path.join(directory, file), 'utf8')};
    });
}

// {tag: {block name: {file, tsv}}} from <directory>/<tag>/*.tsv
function loadOfficial(directory, tags) {
    const byTag = {};
    tags.forEach(function (tag) {
        const blocks = {};
        readTsvDir(path.join(directory, tag)).forEach(function (entry) {
            const name = blockNameOf(entry.tsv);
            if (name) {
                blocks[name] = entry;
            }
        });
        byTag[tag] = blocks;
    });
    return byTag;
}

// Answers the upgrade service's GitHub listing and file requests from the loaded blocks
function serveOfficial(official) {
    const realFetch = global.fetch;
    global.fetch = async function (url, options) {
        const list = url.match(/metadatablocks\?ref=(v[^&]+)/);
        if (list) {
            const blocks = official[list[1]];
            if (!blocks) {
                return {ok: false, status: 404};
            }
            const files = Object.keys(blocks).map(function (name) {
                return {name: blocks[name].file, type: 'file'};
            });
            return {ok: true, json: async function () { return files; }};
        }
        const raw = url.match(/\/(v[^/]+)\/scripts\/api\/data\/metadatablocks\/([^/]+)$/);
        if (raw && official[raw[1]]) {
            const found = Object.keys(official[raw[1]]).find(function (name) {
                return official[raw[1]][name].file === raw[2];
            });
            if (found) {
                const tsv = official[raw[1]][found].tsv;
                return {ok: true, text: async function () { return tsv; }};
            }
        }
        return realFetch(url, options);
    };
}

// Converts a TSV once with the ARP converter and hands out copies
function createConverter(url) {
    const converted = new Map();
    return async function convertTsv(tsv) {
        if (converted.has(tsv)) {
            return copy(converted.get(tsv));
        }
        let response;
        try {
            response = await fetch(url, {
                method: 'POST',
                headers: {'Content-Type': 'text/tab-separated-values'},
                body: tsv
            });
        } catch (error) {
            stop('The converter is not reachable at ' + url + '\nStart the ARP Dataverse and run this again.');
        }
        if (!response.ok) {
            stop('The converter returned ' + response.status + ' for a metadata block.\nCheck ' + url);
        }
        const json = await response.json();
        converted.set(tsv, json);
        return copy(json);
    };
}

// ---------- in-memory CEDAR ----------

function createStore() {
    let seq = 0;
    const writes = {count: 0};
    const folders = {home: {name: 'home', description: 'home', parent: null}};
    const resources = {};

    function newFolder(parent, name, description) {
        const id = 'folder-' + (++seq);
        folders[id] = {name: name, description: description || name, parent: parent};
        return id;
    }

    function childFolder(parent, name) {
        return Object.keys(folders).find(function (id) {
            return folders[id].parent === parent && folders[id].name === name;
        }) || null;
    }

    function inFolder(folderId) {
        return Object.keys(resources).filter(function (id) {
            return resources[id].folderId === folderId;
        });
    }

    function subFolders(folderId) {
        return Object.keys(folders).filter(function (id) {
            return folders[id].parent === folderId;
        });
    }

    function tree(folderId) {
        return inFolder(folderId).concat(...subFolders(folderId).map(tree));
    }

    // The folder names from the home folder down to the folder
    function pathOf(folderId) {
        const names = [];
        for (let id = folderId; id && id !== 'home'; id = folders[id].parent) {
            names.unshift(folders[id].name);
        }
        return names;
    }

    // The part of the path that arpService.bumpVersions repeats under Versions:
    // from "Public" down to the folder, or only the folder's name without "Public"
    function publicPath(folderId) {
        const names = pathOf(folderId);
        const start = names.indexOf('Public');
        return start < 0 ? names.slice(-1) : names.slice(start);
    }

    function findOrCreatePath(parent, names) {
        return names.reduce(function (current, name) {
            return childFolder(current, name) || newFolder(current, name);
        }, parent);
    }

    // A new id that no resource has, also none of the seeded ones
    function put(folderId, json) {
        let id;
        do {
            id = 'https://repo.test/' + typeOf(json) + 's/' + (++seq);
        } while (resources[id]);
        json['@id'] = id;
        resources[id] = {json: json, folderId: folderId};
        return id;
    }

    // A resource read from elsewhere keeps its id, so the ids embedded in templates still match
    function seed(folderId, json) {
        if (!json['@id'] || resources[json['@id']]) {
            throw new Error('A seeded resource needs a new @id: ' + json['schema:name']);
        }
        resources[json['@id']] = {json: copy(json), folderId: folderId};
        return json['@id'];
    }

    function seedFolder(id, parent, name, description) {
        folders[id] = {name: name, description: description || name, parent: parent};
        return id;
    }

    function summary(id) {
        const json = resources[id].json;
        return {
            '@id': id,
            resourceType: typeOf(json),
            'schema:name': json['schema:name'],
            'pav:version': json['pav:version'],
            'bibo:status': json['bibo:status']
        };
    }

    // A copy drops schema:identifier and points pav:derivedFrom at the archived resource.
    function draftOf(id, folderId) {
        const draft = copy(resources[id].json);
        delete draft['schema:identifier'];
        draft['pav:version'] = '0.0.1';
        draft['bibo:status'] = 'bibo:draft';
        draft['pav:derivedFrom'] = id;
        put(folderId, draft);
    }

    // Moves the folder's resources and subfolders to "to" and puts draft copies back in place
    function archive(from, to, draftTo) {
        inFolder(from).forEach(function (id) {
            resources[id].folderId = to;
            draftOf(id, draftTo);
        });
        subFolders(from).slice().forEach(function (sub) {
            folders[sub].parent = to;
            archive(sub, sub, newFolder(draftTo, folders[sub].name, folders[sub].description));
        });
    }

    // The version folders bumpVersions made for this folder: {version: folder id}
    function versionFolders(home, folderId) {
        const versions = childFolder(home, 'Versions');
        let parent = versions;
        for (const name of publicPath(folderId)) {
            parent = parent && childFolder(parent, name);
        }
        const found = {};
        (parent ? subFolders(parent) : []).forEach(function (id) {
            found[folders[id].name] = id;
        });
        return found;
    }

    const arpService = {
        arpResourceTypes: function () {
            return ['folder', 'template', 'element', 'field'];
        },
        getContentType: typeOf,
        getAllFolderContents: async function (folderId) {
            return subFolders(folderId).map(function (id) {
                return {'@id': id, resourceType: 'folder', 'schema:name': folders[id].name};
            }).concat(inFolder(folderId).map(summary));
        },
        getResourceContentById: async function (id, type) {
            if (!resources[id] || typeOf(resources[id].json) !== type) {
                throw new Error('Resource not found: ' + id);
            }
            return copy(resources[id].json);
        },
        updateResource: async function (id, json) {
            if (resources[id].json['bibo:status'] !== 'bibo:draft') {
                throw new Error('Cannot update a published resource: ' + id);
            }
            writes.count++;
            resources[id].json = copy(json);
        },
        createResource: async function (folderId, json) {
            if (json['@id']) {
                throw new Error('A new resource must not already have an @id');
            }
            writes.count++;
            const stored = copy(json);
            put(folderId, stored);
            return copy(stored);
        },
        findOrCreateChildFolder: async function (parent, name, description) {
            if (!description) {
                throw new Error('A folder needs a description');
            }
            return childFolder(parent, name) || newFolder(parent, name, description);
        },
        inspectFolderForBump: async function (folderId) {
            const ids = tree(folderId);
            if (!ids.length) {
                return {blocked: 'empty'};
            }
            if (ids.some(function (id) { return resources[id].json['bibo:status'] !== 'bibo:published'; })) {
                return {blocked: 'unpublished'};
            }
            const highest = ids.map(function (id) {
                return resources[id].json['pav:version'];
            }).sort(function (first, second) {
                return versionNumber(first) - versionNumber(second);
            }).pop();
            return {blocked: null, highestVersion: highest};
        },
        // Same place as arpService.bumpVersions: <home>/Versions/<path from Public>/<highest version>
        findVersionFolder: async function (folderId, home, version) {
            return versionFolders(home, folderId)[version] || null;
        },
        bumpVersions: async function (folderId, home, inspection) {
            writes.count++;
            const versions = childFolder(home, 'Versions') || newFolder(home, 'Versions');
            const target = findOrCreatePath(versions, publicPath(folderId).concat(inspection.highestVersion));
            archive(folderId, target, folderId);
        },
        inspectFolderForPublishAll: async function (folderId) {
            const ids = tree(folderId);
            if (!ids.length) {
                return {blocked: 'empty', resources: []};
            }
            if (ids.some(function (id) { return resources[id].json['bibo:status'] === 'bibo:published'; })) {
                return {blocked: 'published', resources: []};
            }
            return {blocked: null, resources: ids.map(summary)};
        },
        publishAll: async function (list, version) {
            list.forEach(function (resource) {
                const json = resources[resource['@id']].json;
                writes.count++;
                json['pav:version'] = version;
                json['bibo:status'] = 'bibo:published';
            });
        },
        validateResource: function (json) {
            return {method: 'POST', url: 'validate', data: json};
        }
    };

    return {
        writes: writes, folders: folders, resources: resources, arpService: arpService,
        newFolder: newFolder, childFolder: childFolder, inFolder: inFolder, subFolders: subFolders,
        tree: tree, typeOf: typeOf, put: put, seed: seed, seedFolder: seedFolder,
        pathOf: pathOf, publicPath: publicPath, versionFolders: versionFolders
    };
}

// The folder layout of the ARP Dataverse templates: one folder per template, its elements as
// standalone resources in elements/. Fields stay embedded with the id the converter gave them.
// Everything is a draft that was never published, as on live before the upgrade.
function buildFolder(store, merge, templates, parent) {
    const root = store.newFolder(parent || 'home', 'Dataverse');
    templates.forEach(function (template) {
        const folder = store.newFolder(root, template['schema:name']);
        let elements = null;

        function standalones(container) {
            merge.childNames(container).forEach(function (name) {
                const node = merge.unwrap(container.properties[name]);
                if (!merge.isContainer(node)) {
                    return;
                }
                standalones(node);
                node['pav:version'] = '0.0.1';
                node['bibo:status'] = 'bibo:draft';
                elements = elements || store.newFolder(folder, 'elements');
                node['@id'] = store.put(elements, copy(node));
            });
        }

        standalones(template);
        template['pav:version'] = '0.0.1';
        template['bibo:status'] = 'bibo:draft';
        store.put(folder, template);
    });
    return root;
}

// ---------- writing a folder tree ----------

function safeName(name) {
    return String(name || 'resource').replace(/[\\/:]/g, '_');
}

function byName(nameOf) {
    return function (first, second) {
        return nameOf(first).localeCompare(nameOf(second));
    };
}

// Writes the folder as directories: one JSON per resource, one directory per folder
function saveTree(store, folderId, directory) {
    fs.mkdirSync(directory, {recursive: true});
    const used = {};
    store.inFolder(folderId).slice().sort(byName(function (id) {
        return store.resources[id].json['schema:name'];
    })).forEach(function (id) {
        const json = store.resources[id].json;
        let base = safeName(json['schema:name']);
        if (used[base]) {
            base = base + '-' + safeName(store.typeOf(json));
        }
        used[base] = true;
        fs.writeFileSync(path.join(directory, base + '.json'), JSON.stringify(json, null, 2) + '\n');
    });
    store.subFolders(folderId).slice().sort(byName(function (id) {
        return store.folders[id].name;
    })).forEach(function (id) {
        saveTree(store, id, path.join(directory, safeName(store.folders[id].name)));
    });
}

// One directory per version: the published folder as <current>, the archived ones under their version
function saveResults(store, home, root, results, current) {
    fs.rmSync(results, {recursive: true, force: true});
    saveTree(store, root, path.join(results, current));
    const archived = store.versionFolders(home, root);
    Object.keys(archived).sort().forEach(function (version) {
        saveTree(store, archived[version], path.join(results, version));
    });
}

module.exports = {
    TYPES, CONST, SERVICE_DIR, copy, stop, loadEnv, setting, requireNode18, typeOf, versionNumber,
    blockNameOf, readTsvDir, loadOfficial, serveOfficial, createConverter,
    createStore, buildFolder, safeName, saveTree, saveResults
};
