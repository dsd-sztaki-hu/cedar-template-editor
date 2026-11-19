'use strict';

// The checks of an ARP Dataverse upgrade run. Each failed check prints a FAIL
// line and is counted, the run goes on with the other checks.
//
// For every block:
//
// - Every ARP field is still present. A field the official block later removed
//   is kept. A field name that exists only in ARP (the Hungarian citation
//   fields, and any other name absent from official v6.9) is unchanged apart
//   from its CEDAR identity.
// - Where an ARP value still matched official v6.9, the result has the newest
//   official value. Where ARP had already changed that value, the ARP value
//   stays. Compared values are the label, description, required flag,
//   multiple-choice flag, input type and the _arp.dataverse properties. Value
//   lists keep every ARP label and gain labels the official block added.
// - Each field the newest official block added is present and uses the block's
//   term URI. A new field stays embedded, with no resource of its own. A new
//   element has one standalone resource under elements/. The template embeds
//   the id from the step that created the element. A later archive copies that
//   standalone to a new id, and pav:derivedFrom links the current copy back to
//   the embedded one.
// - The upgrade makes no standalone field resources.
// - Field order follows the newest official block when ARP had not reordered
//   the shared names. Otherwise the ARP order of those names stays.

const {copy, typeOf} = require('./arp-upgrade-store');

// Same paths as arp-mdb-merge.service.js. Literals are checked on their own,
// because a new official value is added and an ARP value is never removed.
const TYPE_PATHS = ['_ui.inputType', '_ui.temporalGranularity', '_valueConstraints.numberType',
    '_valueConstraints.temporalType'];
const VALUE_PATHS = ['skos:prefLabel', 'schema:description', '_valueConstraints.requiredValue',
    '_valueConstraints.multipleChoice'].concat(TYPE_PATHS);
const RESHAPING_INPUT_TYPES = ['numeric', 'link'];
const HUNGARIAN_FIELDS = ['title_hu', 'dsDescription_hu', 'dsDescriptionValue_hu', 'dsDescriptionDate_hu'];
const IDENTITY_KEYS = ['@id', 'pav:version', 'bibo:status', 'pav:derivedFrom', 'schema:identifier'];

function same(first, second) {
    return JSON.stringify(first) === JSON.stringify(second);
}

function getPath(node, path) {
    return path.split('.').reduce(function (value, key) {
        return value === undefined || value === null ? undefined : value[key];
    }, node);
}

function labelsOf(node) {
    const literals = getPath(node, '_valueConstraints.literals');
    return Array.isArray(literals) ? literals.map(function (literal) {
        return literal.label;
    }) : null;
}

function dataversePaths(nodes) {
    const keys = [];
    nodes.forEach(function (node) {
        const dataverse = node && node._arp && node._arp.dataverse;
        Object.keys(dataverse || {}).forEach(function (key) {
            const path = '_arp.dataverse.' + key;
            if (!keys.includes(path)) {
                keys.push(path);
            }
        });
    });
    return keys;
}

function withoutIdentity(value) {
    return JSON.parse(JSON.stringify(value, function (key, item) {
        return IDENTITY_KEYS.includes(key) ? undefined : item;
    }));
}

function expectedTerm(officialUri, name, blockUri) {
    if (/^https?:/.test(officialUri) || !blockUri) {
        return officialUri;
    }
    return blockUri.replace(/\/?$/, '/') + name.replace(/:/g, '.');
}

function blockOf(template) {
    return template['schema:identifier'] || template['schema:name'];
}

function createChecks(store, merge) {
    const result = {failed: 0, failures: []};

    function check(condition, message) {
        if (!condition) {
            result.failed++;
            result.failures.push(message);
            console.error('FAIL ' + message);
        }
    }

    // Every field and element by name. Dataverse field names are unique in a block.
    function flatten(template) {
        const entries = {};

        function walk(container) {
            merge.childNames(container).forEach(function (name) {
                const value = container.properties[name];
                const node = merge.unwrap(value);
                entries[name] = {name: name, value: value, node: node, container: container};
                if (merge.isContainer(node)) {
                    walk(node);
                }
            });
        }

        walk(template || {});
        return entries;
    }

    // True when the embedded id is this standalone, or the standalone was copied from it.
    function embedsStandalone(standalone, embeddedId) {
        let current = standalone;
        const seen = new Set();
        while (current && !seen.has(current['@id'])) {
            if (current['@id'] === embeddedId) {
                return true;
            }
            seen.add(current['@id']);
            const next = current['pav:derivedFrom'];
            current = next && store.resources[next] && store.resources[next].json;
        }
        return false;
    }

    // The standalone resources with this name anywhere in the template's folder
    function standaloneNamed(folderId, name) {
        return store.tree(folderId).map(function (id) {
            return store.resources[id].json;
        }).filter(function (json) {
            return typeOf(json) !== 'template' && json['schema:name'] === name;
        });
    }

    function fieldCount(folderId) {
        return store.tree(folderId).filter(function (id) {
            return typeOf(store.resources[id].json) === 'field';
        }).length;
    }

    function checkValues(block, name, arpNode, off69Node, offNode, resultNode) {
        const fromType = getPath(off69Node, '_ui.inputType');
        const toType = getPath(offNode, '_ui.inputType');
        const reshaped = fromType !== toType &&
            (RESHAPING_INPUT_TYPES.includes(fromType) || RESHAPING_INPUT_TYPES.includes(toType));
        const where = block + ' ' + name;

        VALUE_PATHS.concat(dataversePaths([arpNode, off69Node, offNode])).forEach(function (valuePath) {
            const arpValue = getPath(arpNode, valuePath);
            const officialValue = getPath(off69Node, valuePath);
            const nextValue = getPath(offNode, valuePath);
            const got = getPath(resultNode, valuePath);
            // A change to or from numeric or link is only reported, so the ARP value stays
            if (reshaped && TYPE_PATHS.includes(valuePath)) {
                check(same(got, arpValue), where + ' ' + valuePath + ' stays the ARP value');
                return;
            }
            if (same(arpValue, officialValue)) {
                check(same(got, nextValue), where + ' ' + valuePath + ' takes the newest official value');
            } else {
                check(same(got, arpValue), where + ' ' + valuePath + ' keeps the ARP value');
            }
        });

        checkLiterals(where, arpNode, off69Node, offNode, resultNode);
    }

    // Official additions are inserted. ARP values, and values the official block removed, stay.
    function checkLiterals(where, arpNode, off69Node, offNode, resultNode) {
        const arpLabels = labelsOf(arpNode);
        const fromLabels = labelsOf(off69Node) || [];
        const toLabels = labelsOf(offNode) || [];
        const got = labelsOf(resultNode);
        const arpHadList = Array.isArray(getPath(arpNode, '_valueConstraints.literals'));

        if (!arpHadList && fromLabels.length > 0) {
            check(got === null, where + ' keeps its own value list instead of the official one');
            return;
        }
        (toLabels.filter(function (label) { return !fromLabels.includes(label); })).forEach(function (label) {
            check(got && got.includes(label), where + ' gains the official value "' + label + '"');
        });
        if (arpHadList) {
            arpLabels.forEach(function (label) {
                check(got.includes(label), where + ' keeps the ARP value "' + label + '"');
            });
            if (same(arpLabels, fromLabels)) {
                check(same(got, toLabels), where + ' value list matches the newest official block');
            }
        }
    }

    function containerOf(template, name) {
        if (name === null) {
            return template;
        }
        const entry = flatten(template)[name];
        return entry ? entry.node : null;
    }

    function checkOrder(before, off69, off, after) {
        const arpNodes = flatten(before);
        const containers = [null].concat(Object.keys(arpNodes).filter(function (name) {
            return merge.isContainer(arpNodes[name].node);
        }));
        containers.forEach(function (name) {
            const arpContainer = containerOf(before, name);
            const off69Container = containerOf(off69, name);
            const offContainer = containerOf(off, name);
            const resultContainer = containerOf(after, name);
            if (!arpContainer || !off69Container || !offContainer || !resultContainer) {
                return;
            }
            const sharedBefore = merge.childNames(off69Container).filter(function (child) {
                return merge.childNames(arpContainer).includes(child);
            });
            const arpOrder = merge.childNames(arpContainer).filter(function (child) {
                return sharedBefore.includes(child);
            });
            const sharedNow = merge.childNames(offContainer).filter(function (child) {
                return merge.childNames(resultContainer).includes(child);
            });
            const resultOrder = merge.childNames(resultContainer).filter(function (child) {
                return sharedNow.includes(child);
            });
            const where = (name === null ? 'template' : name);
            // ARP did not reorder the official fields, so the official order is taken over
            if (same(arpOrder, sharedBefore)) {
                check(same(resultOrder, sharedNow), blockOf(before) + ' ' + where + ' keeps the official field order');
            } else {
                const stillThere = arpOrder.filter(function (child) {
                    return merge.childNames(resultContainer).includes(child);
                });
                const resultOfThose = merge.childNames(resultContainer).filter(function (child) {
                    return arpOrder.includes(child);
                });
                check(same(resultOfThose, stillThere), blockOf(before) + ' ' + where + ' keeps the ARP field order');
            }
        });
    }

    // before: the template before the upgrade. after: {json, folderId} of the upgraded template.
    // off69 and off: the converted official blocks of v6.9 and of the newest target.
    function checkBlock(block, before, after, off69, off) {
        const arpNodes = flatten(before);
        const off69Nodes = flatten(off69);
        const offNodes = flatten(off);
        const resultNodes = flatten(after.json);
        const arpNames = Object.keys(arpNodes);
        const addedNames = Object.keys(offNodes).filter(function (name) {
            return !arpNodes[name];
        });
        const resultNames = Object.keys(resultNodes);
        const expected = arpNames.concat(addedNames);

        arpNames.forEach(function (name) {
            check(!!resultNodes[name], block + ' still has ARP field ' + name);
        });
        addedNames.forEach(function (name) {
            check(!!resultNodes[name], block + ' has the new official field ' + name);
        });
        resultNames.forEach(function (name) {
            check(expected.includes(name), block + ' has no unexpected field ' + name);
        });
        console.log('  ' + block + ': ' + arpNames.length + ' ARP fields, ' + addedNames.length + ' new official fields');

        arpNames.forEach(function (name) {
            if (!resultNodes[name]) {
                return;
            }
            if (!off69Nodes[name]) {
                check(same(resultNodes[name].value, arpNodes[name].value), block + ' ' + name + ' is unchanged');
                return;
            }
            if (!offNodes[name]) {
                check(same(resultNodes[name].value, arpNodes[name].value),
                    block + ' ' + name + ' stays even though the official block removed it');
                return;
            }
            checkValues(block, name, arpNodes[name].node, off69Nodes[name].node, offNodes[name].node,
                resultNodes[name].node);
        });

        const blockUri = merge.blockUriOf(after.json);
        addedNames.forEach(function (name) {
            const resultNode = resultNodes[name];
            const officialNode = offNodes[name];
            if (!resultNode) {
                return;
            }
            const officialUri = officialNode.container.properties['@context'].properties[name].enum[0];
            const term = resultNode.container.properties['@context'].properties[name].enum[0];
            check(term === expectedTerm(officialUri, name, blockUri), block + ' ' + name + ' term URI is ' + term);
            check(resultNode.node['skos:prefLabel'] === officialNode.node['skos:prefLabel'], block + ' ' + name + ' label');
            check(resultNode.node['schema:description'] === officialNode.node['schema:description'],
                block + ' ' + name + ' description');
            check(same(labelsOf(resultNode.node), labelsOf(officialNode.node)), block + ' ' + name + ' values');
            if (merge.isContainer(resultNode.node)) {
                check(same(merge.childNames(resultNode.node), merge.childNames(officialNode.node)),
                    block + ' ' + name + ' keeps the official field order');
            }

            const standalones = standaloneNamed(after.folderId, name);
            // Fields stay embedded, as ARP keeps them
            if (!merge.isContainer(resultNode.node)) {
                check(standalones.length === 0, block + ' ' + name + ' is embedded, it has no standalone resource');
                return;
            }
            check(standalones.length === 1, block + ' ' + name + ' has one standalone resource in elements');
            // A later archive copies the standalone and gives the copy a new id.
            // The template keeps the id from the step that created the element.
            if (standalones.length === 1) {
                check(embedsStandalone(standalones[0], resultNode.node['@id']),
                    block + ' ' + name + ' embeds its standalone resource');
                check(same(withoutIdentity(standalones[0]), withoutIdentity(resultNode.node)),
                    block + ' ' + name + ' standalone matches the embedded field');
            }
        });

        checkOrder(before, off69, off, after.json);

        if (block === 'citation') {
            HUNGARIAN_FIELDS.forEach(function (name) {
                check(!!resultNodes[name], 'citation keeps ' + name);
            });
            if (arpNodes.contributorType && resultNodes.contributorType) {
                const arpLabels = labelsOf(arpNodes.contributorType.node);
                const resultLabels = labelsOf(resultNodes.contributorType.node);
                check(resultLabels.includes('Translator'), 'citation contributorType has Translator');
                arpLabels.forEach(function (label) {
                    check(resultLabels.includes(label), 'citation contributorType keeps "' + label + '"');
                });
            }
        }
    }

    // What the official blocks change between 6.9 and 6.12.1, as the preview reports it
    function checkPreview(preview) {
        const at = function (version) {
            return preview.find(function (report) { return report.version === version; });
        };
        const v69 = at('6.9.0');
        if (v69) {
            const citation = v69.blocks.find(function (block) { return block.block === 'citation'; });
            check(citation && citation.applied.some(function (change) {
                return change.kind === 'restrictedLiterals' && change.name === 'language';
            }), '6.9.0 keeps only the allowed citation languages');
        }
        const v610 = at('6.10.0');
        const v611 = at('6.11.0');
        const v612 = at('6.12.1');
        check(v610 && v610.blocks.length === 0, '6.10 changes no existing block');
        check(v610 && v610.missingTemplates.includes('review'), '6.10 lists review as a block without a template');
        const geospatial = v611 && v611.blocks.find(function (block) { return block.block === 'geospatial'; });
        check(geospatial && geospatial.applied.some(function (change) { return change.kind === 'addedField'; }),
            '6.11 adds the new geospatial fields');
        check(v611 && v611.missingTemplates.includes('rubric_trusteddatadimensionsintensities'),
            '6.11 lists the rubric block as a block without a template');
        const citation = v612 && v612.blocks.find(function (block) { return block.block === 'citation'; });
        check(citation && citation.applied.some(function (change) {
            return change.kind === 'addedLiteral' && change.label === 'Translator';
        }), '6.12.1 adds Translator to citation');
    }

    // The folder is published as the newest version, each older version is archived under Versions
    function checkFolder(home, root, options) {
        const live = store.tree(root).map(function (id) { return store.resources[id].json; });
        check(live.length > 0 && live.every(function (json) {
            return json['bibo:status'] === 'bibo:published' && json['pav:version'] === options.version;
        }), 'everything in the folder is published as ' + options.version);

        const archived = store.versionFolders(home, root);
        const names = Object.keys(archived).sort();
        const original = archived[options.archived[0]];
        if (original) {
            check(fieldCount(root) === fieldCount(original), 'the upgrade makes no standalone fields: ' +
                fieldCount(original) + ' before, ' + fieldCount(root) + ' after');
        }
        check(same(names, options.archived.slice().sort()),
            'Versions/' + store.publicPath(root).join('/') + ' holds ' + options.archived.join(', ') +
            ', found ' + names.join(', '));
        names.forEach(function (version) {
            store.tree(archived[version]).forEach(function (resourceId) {
                const json = store.resources[resourceId].json;
                check(json['pav:version'] === version && json['bibo:status'] === 'bibo:published',
                    'archived ' + json['schema:name'] + ' stays ' + version);
            });
        });

        live.forEach(function (json) {
            const originalId = json['pav:derivedFrom'];
            const original = originalId && store.resources[originalId] && store.resources[originalId].json;
            if (original && original['schema:identifier']) {
                check(json['schema:identifier'] === original['schema:identifier'],
                    json['schema:name'] + ' keeps schema:identifier ' + original['schema:identifier']);
            }
        });
        check(live.filter(function (json) { return typeOf(json) === 'template'; }).length === options.templates,
            'the folder still has the ' + options.templates + ' ARP templates');

        if (options.restrictedValues) {
            const counts = options.archived.filter(function (version) {
                return names.includes(version);
            }).reduce(function (found, version) {
                return found.concat(checkRestricted(version, archived[version], options.restrictedValues));
            }, []).concat(checkRestricted(options.version, root, options.restrictedValues));
            console.log('Restricted values: ' + counts.join(', '));
        }
    }

    // Every version offers exactly the vocabulary values ARP keeps of the official block of that version,
    // e.g. the ISO 639-2 languages in citation. restrictedValues(block, version) gives {field: [labels]}.
    function checkRestricted(version, folderId, restrictedValues) {
        const counts = [];
        store.tree(folderId).map(function (id) {
            return store.resources[id].json;
        }).filter(function (json) {
            return typeOf(json) === 'template';
        }).forEach(function (template) {
            const block = template['schema:identifier'];
            const values = restrictedValues(block, version);
            Object.keys(values).forEach(function (field) {
                const node = flatten(template)[field];
                const labels = node ? labelsOf(node.node) : [];
                const allowed = values[field];
                const extra = labels.filter(function (label) { return !allowed.includes(label); });
                const missing = allowed.filter(function (label) { return !labels.includes(label); });
                check(extra.length === 0 && missing.length === 0 && new Set(labels).size === labels.length,
                    version + ' ' + block + ' ' + field + ' has the ' + allowed.length + ' allowed values, found ' +
                    labels.length + (extra.length ? ', not allowed: ' + extra.slice(0, 5).join(' | ') : '') +
                    (missing.length ? ', missing: ' + missing.slice(0, 5).join(' | ') : ''));
                counts.push(block + ' ' + field + ' ' + version + ': ' + labels.length);
            });
        });
        return counts;
    }

    // Every template the folder had before the run, by block name
    function templatesIn(root) {
        const found = {};
        store.tree(root).forEach(function (id) {
            const json = store.resources[id].json;
            if (typeOf(json) === 'template') {
                found[json['schema:identifier']] = {id: id, json: json, folderId: store.resources[id].folderId};
            }
        });
        return found;
    }

    // The template as the upgrade publishes its starting version from drafts: without the values ARP does not
    // offer. values is {field: [labels]}, as restrictedValues of the upgrade service gives it.
    function restrictedCopy(template, values) {
        const result = copy(template);
        Object.keys(values).forEach(function (field) {
            merge.restrictLiterals(result, field, values[field]);
        });
        return result;
    }

    // When the run started from drafts, the archived starting version is those drafts, only restricted
    function checkStartVersion(home, root, before, version) {
        const archived = store.versionFolders(home, root)[version];
        const found = archived ? templatesIn(archived) : {};
        Object.keys(before).forEach(function (block) {
            check(found[block] && same(withoutIdentity(found[block].json), withoutIdentity(before[block])),
                'archived ' + version + ' ' + block + ' is the draft as it was, with only the allowed values');
        });
    }

    // The checks after service.run: every block, the blocks the preview listed as missing, and the folder
    function checkRun(options) {
        if (options.startedFromDrafts) {
            checkStartVersion(options.home, options.root, options.before, options.archived[0]);
        }
        const result = templatesIn(options.root);
        options.blockNames.forEach(function (block) {
            check(!!result[block], block + ' template is still in the folder');
            if (result[block]) {
                check(result[block].json['schema:identifier'] === block, block + ' keeps its schema:identifier');
                checkBlock(block, options.before[block], result[block], options.official69[block],
                    options.officialLatest[block]);
            }
        });
        options.preview.reduce(function (names, report) {
            return names.concat(report.missingTemplates);
        }, []).forEach(function (block) {
            check(!result[block], block + ' is not created');
        });
        checkFolder(options.home, options.root, {
            version: options.version,
            archived: options.archived,
            templates: options.blockNames.length,
            restrictedValues: options.restrictedValues
        });
    }

    return {
        result: result, check: check, flatten: flatten, templatesIn: templatesIn, restrictedCopy: restrictedCopy,
        checkBlock: checkBlock, checkPreview: checkPreview, checkFolder: checkFolder, checkRun: checkRun
    };
}

module.exports = {createChecks, same, labelsOf, withoutIdentity, copy};
