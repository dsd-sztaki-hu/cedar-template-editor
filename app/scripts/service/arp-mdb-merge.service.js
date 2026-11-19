'use strict';

define([
    'angular'
], function (angular) {
    angular.module('cedar.templateEditor.service.arpMdbMergeService', [])
        .service('arpMdbMergeService', arpMdbMergeService);

    arpMdbMergeService.$inject = [];

    // Merges the changes of an official Dataverse metadata block into ARP resources.
    // These are pure JSON functions. They make no backend calls.
    //
    // The official block is given as two CEDAR templates: the block at the previous Dataverse
    // release and the block at the next one. Both come from the ARP TSV to CEDAR converter.
    function arpMdbMergeService() {

        const TEMPLATE = 'https://schema.metadatacenter.org/core/Template';
        const ELEMENT = 'https://schema.metadatacenter.org/core/TemplateElement';
        const FIELD = 'https://schema.metadatacenter.org/core/TemplateField';

        // Values that follow from the Dataverse field type
        const TYPE_PATHS = ['_ui.inputType', '_ui.temporalGranularity', '_valueConstraints.numberType',
            '_valueConstraints.temporalType'];
        const VALUE_PATHS = ['skos:prefLabel', 'schema:description', '_valueConstraints.requiredValue',
            '_valueConstraints.multipleChoice'].concat(TYPE_PATHS);
        // A change to or from these input types also changes the JSON schema of the field
        const RESHAPING_INPUT_TYPES = ['numeric', 'link'];
        // The parent keeps a copy of these field values
        const PARENT_COPIES = {'skos:prefLabel': 'propertyLabels', 'schema:description': 'propertyDescriptions'};

        return {
            diffOfficial: diffOfficial,
            applyDiff: applyDiff,
            restrictLiterals: restrictLiterals,
            isEmptyDiff: isEmptyDiff,
            blockUriOf: blockUriOf,
            resolveTermUris: resolveTermUris,
            childNames: childNames,
            isContainer: isContainer,
            unwrap: unwrap,
            withNode: withNode
        };

        // ---------- reading the JSON ----------

        function copy(value) {
            return JSON.parse(JSON.stringify(value));
        }

        // A multi-valued element is wrapped in a JSON schema array. The artifact is in "items".
        function unwrap(value) {
            return value && value.items ? value.items : value;
        }

        // Puts another artifact into the same place, keeping the array wrapper if there is one
        function withNode(value, node) {
            if (value.items) {
                value.items = node;
                return value;
            }
            return node;
        }

        function isArtifact(value) {
            const node = unwrap(value);
            return !!node && (node['@type'] === ELEMENT || node['@type'] === FIELD);
        }

        function isContainer(node) {
            return node['@type'] === TEMPLATE || node['@type'] === ELEMENT;
        }

        // Names of the fields and elements directly inside a template or element, in display order
        function childNames(container) {
            const properties = container.properties || {};
            const children = Object.keys(properties).filter(function (key) {
                return isArtifact(properties[key]);
            });
            const ordered = ((container._ui || {}).order || []).filter(function (name) {
                return children.includes(name);
            });
            return ordered.concat(children.filter(function (name) {
                return !ordered.includes(name);
            }));
        }

        function getPath(node, path) {
            return path.split('.').reduce(function (value, key) {
                return value === undefined || value === null ? undefined : value[key];
            }, node);
        }

        function setPath(node, path, value) {
            const keys = path.split('.');
            const last = keys.pop();
            const target = keys.reduce(function (object, key) {
                return ensure(object, key, {});
            }, node);
            if (value === undefined) {
                delete target[last];
            } else {
                target[last] = value;
            }
        }

        function ensure(object, key, fallback) {
            if (object[key] === undefined || object[key] === null) {
                object[key] = fallback;
            }
            return object[key];
        }

        function sameList(first, second) {
            return JSON.stringify(first) === JSON.stringify(second);
        }

        // Puts the item behind its predecessor.
        // With no predecessor (null) it goes to the front, with an unknown one to the end.
        function insertAfter(list, item, predecessor) {
            const index = list.indexOf(predecessor);
            if (predecessor === null) {
                list.unshift(item);
            } else if (index < 0) {
                list.push(item);
            } else {
                list.splice(index + 1, 0, item);
            }
        }

        function labelsOf(node) {
            return (getPath(node, '_valueConstraints.literals') || []).map(function (literal) {
                return literal.label;
            });
        }

        // The block URI the template declares for its instances, e.g. "https://dataverse.org/schema/geospatial/"
        function blockUriOf(template) {
            const oneOf = getPath(template, 'properties.@type.oneOf') || [];
            return ((oneOf[0] || {}).enum || [])[0] || '';
        }

        // Every field and element of a template by name. Dataverse field names are unique within a block.
        function flatten(template) {
            const entries = {};

            function collect(container, parent) {
                childNames(container).forEach(function (name) {
                    const value = container.properties[name];
                    const node = unwrap(value);
                    entries[name] = {
                        name: name,
                        parent: parent,
                        container: container,
                        value: value,
                        node: node,
                        multiple: value !== node || node.minItems !== undefined
                    };
                    if (isContainer(node)) {
                        collect(node, name);
                    }
                });
            }

            collect(template, null);
            return entries;
        }

        // ---------- what did the official block change ----------

        // Returns the changes between two official versions of one block:
        //   addedFields, editedValues, addedLiterals, orderChanges: these can be applied to an ARP resource
        //   reportOnly: removals and structural changes, these are never applied
        function diffOfficial(prevTemplate, nextTemplate) {
            const before = flatten(prevTemplate || {});
            const after = flatten(nextTemplate);
            const diff = {addedFields: [], editedValues: [], addedLiterals: [], orderChanges: [], reportOnly: []};

            Object.keys(after).forEach(function (name) {
                const prev = before[name];
                const next = after[name];
                if (!prev) {
                    // The fields of a new element travel inside that element
                    if (next.parent === null || before[next.parent]) {
                        diff.addedFields.push(addedField(next));
                    }
                    return;
                }
                if (prev.parent !== next.parent) {
                    diff.reportOnly.push({kind: 'parentChanged', name: name, from: prev.parent, to: next.parent});
                }
                if (prev.node['@type'] !== next.node['@type']) {
                    diff.reportOnly.push({kind: 'kindChanged', name: name});
                    return;
                }
                compareMultiplicity(prev, next, diff);
                compareValues(prev.node, next.node, name, diff);
                compareLiterals(prev.node, next.node, name, diff);
            });

            Object.keys(before).forEach(function (name) {
                if (!after[name]) {
                    diff.reportOnly.push({kind: 'removedField', name: name});
                }
            });

            if (prevTemplate) {
                compareOrder(null, prevTemplate, nextTemplate, diff);
            }
            Object.keys(after).forEach(function (name) {
                if (before[name] && isContainer(before[name].node) && isContainer(after[name].node)) {
                    compareOrder(name, before[name].node, after[name].node, diff);
                }
            });
            return diff;
        }

        function isEmptyDiff(diff) {
            return Object.keys(diff).every(function (key) {
                return diff[key].length === 0;
            });
        }

        // Everything the parent needs to know to take in the new field
        function addedField(entry) {
            const container = entry.container;
            const context = container.properties['@context'];
            const order = childNames(container);
            return {
                name: entry.name,
                parent: entry.parent,
                value: entry.value,
                after: order[order.indexOf(entry.name) - 1] || null,
                label: container._ui.propertyLabels[entry.name],
                description: container._ui.propertyDescriptions[entry.name],
                termUri: context.properties[entry.name].enum[0],
                inContextRequired: (context.required || []).includes(entry.name)
            };
        }

        // A list field stores "allow multiple" in multipleChoice, which is handled as a value edit.
        // Everything else would need the array wrapper to be added or removed, so it is only reported.
        function compareMultiplicity(prev, next, diff) {
            const choiceChanged = getPath(prev.node, '_valueConstraints.multipleChoice') !==
                getPath(next.node, '_valueConstraints.multipleChoice');
            if (prev.multiple !== next.multiple && !choiceChanged) {
                diff.reportOnly.push({kind: 'multiplicityChanged', name: prev.name, from: prev.multiple, to: next.multiple});
            }
        }

        function compareValues(prevNode, nextNode, name, diff) {
            const fromType = getPath(prevNode, '_ui.inputType');
            const toType = getPath(nextNode, '_ui.inputType');
            const reshaped = fromType !== toType &&
                (RESHAPING_INPUT_TYPES.includes(fromType) || RESHAPING_INPUT_TYPES.includes(toType));
            if (reshaped) {
                diff.reportOnly.push({kind: 'inputTypeChanged', name: name, from: fromType, to: toType});
            }

            VALUE_PATHS.concat(arpPaths(prevNode, nextNode)).forEach(function (path) {
                const from = getPath(prevNode, path);
                const to = getPath(nextNode, path);
                if (from !== to && !(reshaped && TYPE_PATHS.includes(path))) {
                    diff.editedValues.push({name: name, path: path, from: from, to: to});
                }
            });
        }

        // The Dataverse-only settings of a field: watermark, displayFormat, facetable and so on
        function arpPaths(prevNode, nextNode) {
            const keys = Object.keys(getPath(prevNode, '_arp.dataverse') || {});
            Object.keys(getPath(nextNode, '_arp.dataverse') || {}).forEach(function (key) {
                if (!keys.includes(key)) {
                    keys.push(key);
                }
            });
            return keys.map(function (key) {
                return '_arp.dataverse.' + key;
            });
        }

        function compareLiterals(prevNode, nextNode, name, diff) {
            const from = labelsOf(prevNode);
            const to = labelsOf(nextNode);
            to.forEach(function (label, index) {
                if (!from.includes(label)) {
                    diff.addedLiterals.push({
                        name: name,
                        label: label,
                        after: index === 0 ? null : to[index - 1],
                        firstValues: from.length === 0
                    });
                }
            });
            from.forEach(function (label) {
                if (!to.includes(label)) {
                    diff.reportOnly.push({kind: 'removedLiteral', name: name, label: label});
                }
            });
        }

        // Only the fields present in both versions say whether the order changed
        function compareOrder(parent, prevContainer, nextContainer, diff) {
            const from = childNames(prevContainer);
            const to = childNames(nextContainer);
            const shared = function (list) {
                return list.filter(function (name) {
                    return from.includes(name) && to.includes(name);
                });
            };
            if (!sameList(shared(from), shared(to))) {
                diff.orderChanges.push({parent: parent, from: from, to: to});
            }
        }

        // ---------- applying the changes to an ARP resource ----------

        // Applies the official changes to one template, element or field. The resource is changed in place.
        // Fields and elements are matched by name at any depth, so the same call works for a template,
        // for a standalone element and for a standalone field.
        //
        // Returns:
        //   applied: the changes made to this resource
        //   keptArp: official changes that were not made, because ARP has its own value there
        function applyDiff(resource, diff, blockUri) {
            const result = {applied: [], keptArp: []};
            const containers = [];
            const rootName = resource['@type'] === TEMPLATE ? null : resource['schema:name'];

            walk(resource, rootName, null, function (node, name, parent) {
                applyValues(node, name, parent, diff, result);
                applyLiterals(node, name, diff, result);
                if (isContainer(node)) {
                    containers.push(name);
                    addFields(node, name, diff, blockUri, result);
                    applyOrder(node, name, diff, result);
                }
            });

            if (resource['@type'] === TEMPLATE) {
                diff.addedFields.forEach(function (added) {
                    if (!containers.includes(added.parent)) {
                        result.keptArp.push({kind: 'parentMissing', name: added.name, parent: added.parent});
                    }
                });
            }
            return result;
        }

        function walk(node, name, parent, visit) {
            // Read the children first: fields added by the visit are already up to date
            const children = childNames(node);
            visit(node, name, parent);
            children.forEach(function (child) {
                walk(unwrap(node.properties[child]), child, node, visit);
            });
        }

        // An official edit is applied only where the resource still has the old official value
        function applyValues(node, name, parent, diff, result) {
            diff.editedValues.forEach(function (edit) {
                const current = getPath(node, edit.path);
                if (edit.name !== name || current === edit.to) {
                    return;
                }
                if (current !== edit.from) {
                    result.keptArp.push({kind: 'editedValue', name: name, path: edit.path, to: edit.to, current: current});
                    return;
                }
                setPath(node, edit.path, edit.to);
                const parentCopy = parent && parent._ui && parent._ui[PARENT_COPIES[edit.path]];
                if (parentCopy && parentCopy[name] === edit.from) {
                    parentCopy[name] = edit.to;
                }
                result.applied.push({kind: 'editedValue', name: name, path: edit.path, from: edit.from, to: edit.to});
            });
        }

        function applyLiterals(node, name, diff, result) {
            diff.addedLiterals.forEach(function (added) {
                if (added.name !== name) {
                    return;
                }
                const constraints = ensure(node, '_valueConstraints', {});
                if (added.firstValues && !Array.isArray(constraints.literals)) {
                    constraints.literals = [];
                }
                const literals = constraints.literals;
                // A field with no value list at all uses something else in ARP, e.g. an ontology
                if (!Array.isArray(literals) || (literals.length === 0 && !added.firstValues)) {
                    result.keptArp.push({kind: 'addedLiteral', name: name, label: added.label});
                    return;
                }
                const labels = literals.map(function (literal) {
                    return literal.label;
                });
                if (labels.includes(added.label)) {
                    return;
                }
                const predecessor = added.after === null ? null : literals[labels.indexOf(added.after)];
                insertAfter(literals, {label: added.label}, predecessor);
                result.applied.push({kind: 'addedLiteral', name: name, label: added.label});
            });
        }

        // Keeps only the allowed values of the field with the given name, in the order the resource has them.
        // Returns the labels that were removed and the number of values left.
        function restrictLiterals(resource, fieldName, allowedLabels) {
            const result = {removed: [], kept: 0};
            const allowed = new Set(allowedLabels);
            const rootName = resource['@type'] === TEMPLATE ? null : resource['schema:name'];
            walk(resource, rootName, null, function (node, name) {
                const literals = getPath(node, '_valueConstraints.literals');
                if (name !== fieldName || !Array.isArray(literals)) {
                    return;
                }
                node._valueConstraints.literals = literals.filter(function (literal) {
                    if (allowed.has(literal.label)) {
                        return true;
                    }
                    result.removed.push(literal.label);
                    return false;
                });
                result.kept += node._valueConstraints.literals.length;
            });
            return result;
        }

        function addFields(container, name, diff, blockUri, result) {
            diff.addedFields.forEach(function (added) {
                if (added.parent !== name || container.properties[added.name]) {
                    return;
                }
                const value = copy(added.value);
                resolveTermUris(unwrap(value), blockUri);
                const ui = ensure(container, '_ui', {});
                const context = ensure(container.properties, '@context', {});

                container.properties[added.name] = value;
                ensure(context, 'properties', {})[added.name] = {
                    enum: [resolveTermUri(added.termUri, added.name, blockUri)]
                };
                pushOnce(ensure(container, 'required', []), added.name);
                if (added.inContextRequired) {
                    pushOnce(ensure(context, 'required', []), added.name);
                }
                insertAfter(ensure(ui, 'order', []), added.name, added.after);
                ensure(ui, 'propertyLabels', {})[added.name] = added.label;
                ensure(ui, 'propertyDescriptions', {})[added.name] = added.description;
                result.applied.push({kind: 'addedField', name: added.name, parent: name});
            });
        }

        function pushOnce(list, item) {
            if (!list.includes(item)) {
                list.push(item);
            }
        }

        // An official block without a blockURI makes the converter emit term URIs like "/country".
        // Those are rebuilt from the block URI of the ARP template.
        function resolveTermUri(uri, name, blockUri) {
            if (/^https?:/.test(uri) || !blockUri) {
                return uri;
            }
            return blockUri.replace(/\/?$/, '/') + name.replace(/:/g, '.');
        }

        // Does the same for the fields inside a new element. Returns the node.
        function resolveTermUris(node, blockUri) {
            childNames(node).forEach(function (name) {
                const term = node.properties['@context'].properties[name];
                term.enum[0] = resolveTermUri(term.enum[0], name, blockUri);
                resolveTermUris(unwrap(node.properties[name]), blockUri);
            });
            return node;
        }

        // The official order is taken over only where ARP did not reorder the official fields.
        // Fields that only ARP has stay behind the field they followed before.
        function applyOrder(container, name, diff, result) {
            diff.orderChanges.forEach(function (change) {
                if (change.parent !== name) {
                    return;
                }
                const order = (container._ui || {}).order || [];
                const present = function (official) {
                    return official.filter(function (item) {
                        return order.includes(item);
                    });
                };
                const current = function (official) {
                    return order.filter(function (item) {
                        return official.includes(item);
                    });
                };
                const target = present(change.to);
                if (sameList(current(change.to), target)) {
                    return;
                }
                if (!sameList(current(change.from), present(change.from))) {
                    result.keptArp.push({kind: 'orderChanged', parent: name});
                    return;
                }
                order.forEach(function (item, index) {
                    if (!target.includes(item)) {
                        insertAfter(target, item, index === 0 ? null : order[index - 1]);
                    }
                });
                container._ui.order = target;
                result.applied.push({kind: 'orderChanged', parent: name});
            });
        }
    }
});
