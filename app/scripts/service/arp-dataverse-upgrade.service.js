'use strict';

define([
    'angular'
], function (angular) {
    angular.module('cedar.templateEditor.service.arpDataverseUpgradeService', [])
        .service('arpDataverseUpgradeService', arpDataverseUpgradeService);

    arpDataverseUpgradeService.$inject = ['arpService', 'arpMdbMergeService', 'UrlService', 'HttpBuilderService',
        'AuthorizedBackendService', 'UIMessageService', 'CedarUser', 'CONST'];

    // Walks a CEDAR folder through a list of Dataverse versions.
    // For every version it archives and drafts the folder, merges the changes of the official
    // metadata blocks into the drafts, validates the changed templates and publishes the folder.
    //
    // The functions reject with an error that has a messageKey (and messageParams) when this service
    // found the problem. Errors of backend calls are shown by arpService and passed on as they are.
    function arpDataverseUpgradeService(arpService, merge, UrlService, HttpBuilderService,
                                        AuthorizedBackendService, UIMessageService, CedarUser, CONST) {

        const BATCH_SIZE = 10;
        const officialBlocks = {};  // tag -> promise of {block name: TSV text}
        const convertedBlocks = {}; // tag/block name -> promise of the block as a CEDAR template

        return {
            inspectStart: inspectStart,
            preview: preview,
            run: run
        };

        // ---------- small helpers ----------

        function upgradeError(key, params) {
            const error = new Error(key);
            error.messageKey = 'ARP.dataverseUpgrade.error.' + key;
            error.messageParams = params || {};
            return error;
        }

        function copy(value) {
            return JSON.parse(JSON.stringify(value));
        }

        // Runs the task for every item, a few at a time
        async function forEachBatch(items, task) {
            for (let start = 0; start < items.length; start += BATCH_SIZE) {
                await Promise.all(items.slice(start, start + BATCH_SIZE).map(task));
            }
        }

        // Loads a value once. A failed load is not remembered.
        function cached(cache, key, load) {
            if (!cache[key]) {
                cache[key] = load().catch(function (error) {
                    delete cache[key];
                    throw error;
                });
            }
            return cache[key];
        }

        // ---------- versions ----------

        // "6.10", "v6.10" and "6.10.0" all mean [6, 10, 0]
        function parseVersion(text) {
            const match = /^v?(\d+)\.(\d+)(?:\.(\d+))?$/.exec(String(text || '').trim());
            if (!match) {
                throw upgradeError('invalidVersion', {version: text});
            }
            return [Number(match[1]), Number(match[2]), Number(match[3] || 0)];
        }

        // The current version followed by the target versions. Each one must be newer than the one before.
        function parseVersions(currentVersion, targetVersions) {
            const versions = [currentVersion].concat(targetVersions).map(parseVersion);
            if (versions.length < 2) {
                throw upgradeError('noTargets');
            }
            versions.forEach(function (version, index) {
                if (index > 0 && versionNumber(version) <= versionNumber(versions[index - 1])) {
                    throw upgradeError('notAscending', {version: toPavVersion(version)});
                }
            });
            return versions;
        }

        function versionNumber(parts) {
            return parts[0] * 1000000 + parts[1] * 1000 + parts[2];
        }

        // CEDAR only takes versions with three parts: "6.10.0"
        function toPavVersion(parts) {
            return parts.join('.');
        }

        // The Dataverse release tag: "v6.10", "v6.12.1"
        function toTag(parts) {
            return 'v' + parts[0] + '.' + parts[1] + (parts[2] ? '.' + parts[2] : '');
        }

        // ---------- the official metadata blocks ----------

        // All official metadata block TSVs of a Dataverse release, by block name.
        // Plain fetch is used, so the CEDAR token is not sent to GitHub.
        function loadOfficialBlocks(tag) {
            return cached(officialBlocks, tag, async function () {
                const listing = await fetchOfficial(UrlService.dataverseMdbListUrl(tag), tag);
                const files = (await listing.json()).filter(function (file) {
                    return file.type === 'file' && /\.tsv$/.test(file.name);
                });
                const blocks = {};
                await Promise.all(files.map(async function (file) {
                    const response = await fetchOfficial(UrlService.dataverseMdbBaseUrl(tag) + '/' + file.name, tag);
                    const tsv = await response.text();
                    const name = blockNameOf(tsv);
                    if (name) {
                        blocks[name] = tsv;
                    }
                }));
                return blocks;
            });
        }

        async function fetchOfficial(url, tag) {
            const response = await fetch(url).catch(function () {
                return {ok: false, status: 0};
            });
            if (!response.ok) {
                throw upgradeError('officialLoad', {tag: tag, status: response.status});
            }
            return response;
        }

        // The block name is the second column of the row below the "#metadataBlock" header
        function blockNameOf(tsv) {
            const lines = tsv.split(/\r?\n/);
            const header = lines.findIndex(function (line) {
                return line.indexOf('#metadataBlock') === 0;
            });
            const row = header < 0 ? null : lines[header + 1];
            return row ? row.split('\t')[1] : null;
        }

        // Dataverse turns the TSV into a CEDAR template. This keeps the TSV to CEDAR mapping in one place.
        function convert(tag, block, tsv) {
            return cached(convertedBlocks, tag + '/' + block, function () {
                const request = HttpBuilderService.post(UrlService.arpConvertTsvToCedarTemplate(), tsv);
                request.headers = {'Content-Type': 'text/tab-separated-values'};
                return new Promise(function (resolve, reject) {
                    AuthorizedBackendService.doCall(request, function (response) {
                        resolve(response.data);
                    }, function () {
                        reject(upgradeError('convert', {block: block, tag: tag}));
                    });
                });
            });
        }

        // ---------- the resources of the folder ----------

        // Every template, element and field below the folder.
        // An entry knows its folder and all the folders above it, up to the starting folder.
        async function listTree(folderId, parentFolderIds) {
            const folderIds = (parentFolderIds || []).concat(folderId);
            const contents = await arpService.getAllFolderContents(folderId, arpService.arpResourceTypes());
            let entries = [];
            for (const resource of contents) {
                if (resource.resourceType === CONST.resourceType.FOLDER) {
                    entries = entries.concat(await listTree(resource['@id'], folderIds));
                } else {
                    entries.push({resource: resource, folderId: folderId, folderIds: folderIds, json: null, changed: false});
                }
            }
            return entries;
        }

        function isTemplate(entry) {
            return entry.resource.resourceType === CONST.resourceType.TEMPLATE;
        }

        function isPublished(entry) {
            return entry.resource['bibo:status'] === 'bibo:published';
        }

        async function loadJson(entry) {
            if (!entry.json) {
                entry.json = await arpService.getResourceContentById(entry.resource['@id'], entry.resource.resourceType);
            }
        }

        // CEDAR drops schema:identifier when it copies a resource, and "ARP Archive and Draft" makes its
        // drafts by copying. Dataverse needs the identifier (it is the metadata block name), so it is
        // taken back from the archived resource the draft was copied from.
        async function restoreIdentifier(entry, save) {
            const json = entry.json;
            if (json['schema:identifier'] || !json['pav:derivedFrom']) {
                return;
            }
            const original = await arpService.getResourceContentById(json['pav:derivedFrom'], entry.resource.resourceType);
            if (!original['schema:identifier']) {
                return;
            }
            json['schema:identifier'] = original['schema:identifier'];
            if (save) {
                await saveEntry(entry);
            }
        }

        function saveEntry(entry) {
            return arpService.updateResource(entry.json['@id'], entry.json, 'ARP.dataverseUpgrade.error.save');
        }

        // ---------- applying one version step ----------

        // Applies the official changes between two Dataverse versions to the entries.
        // Only blocks whose TSV changed are looked at. With save = false nothing is written to CEDAR.
        async function applyStep(entries, prevVersion, nextVersion, save) {
            const prevTag = toTag(prevVersion);
            const nextTag = toTag(nextVersion);
            const prev = await loadOfficialBlocks(prevTag);
            const next = await loadOfficialBlocks(nextTag);
            const report = {version: toPavVersion(nextVersion), blocks: [], missingTemplates: []};

            for (const block of Object.keys(next).sort()) {
                if (prev[block] === next[block]) {
                    continue;
                }
                const template = entries.find(function (entry) {
                    return isTemplate(entry) && entry.json && entry.json['schema:identifier'] === block;
                });
                if (!template) {
                    report.missingTemplates.push(block);
                    continue;
                }
                if (!prev[block]) {
                    // A block that is new in Dataverse but already has an ARP template: there is nothing to compare with
                    continue;
                }
                const diff = merge.diffOfficial(await convert(prevTag, block, prev[block]),
                    await convert(nextTag, block, next[block]));
                if (!merge.isEmptyDiff(diff)) {
                    report.blocks.push(await applyBlock(entries, template, block, diff, save));
                }
            }
            return report;
        }

        // Applies the changes of one block to its template and to the standalone elements in the folder
        // of the template (ARP keeps those in "elements"). Fields are embedded, they have no resource of their own.
        async function applyBlock(entries, template, block, diff, save) {
            const scope = entries.filter(function (entry) {
                return entry === template || (!isTemplate(entry) && entry.folderIds.includes(template.folderId));
            });
            await forEachBatch(scope, loadJson);

            const blockUri = merge.blockUriOf(template.json);
            const fullDiff = await withStandaloneNodes(diff, template, scope, blockUri, save);
            const report = {
                block: block,
                template: template.json['schema:name'],
                templateId: template.json['@id'],
                applied: [],
                keptArp: [],
                reportOnly: diff.reportOnly,
                updatedResources: []
            };
            scope.forEach(function (entry) {
                const result = merge.applyDiff(entry.json, fullDiff, blockUri);
                entry.changed = entry.changed || result.applied.length > 0;
                if (entry === template) {
                    report.applied = result.applied;
                    report.keptArp = result.keptArp;
                } else if (result.applied.length > 0) {
                    report.updatedResources.push(entry.json['schema:name']);
                }
            });
            return report;
        }

        // Returns the diff with every new element replaced by its standalone resource.
        // Only the elements the template does not have yet get a standalone resource.
        async function withStandaloneNodes(diff, template, scope, blockUri, save) {
            const missing = merge.applyDiff(copy(template.json), diff, blockUri).applied.filter(function (change) {
                return change.kind === 'addedField';
            }).map(function (change) {
                return change.name;
            });
            const addedFields = [];
            for (const added of diff.addedFields) {
                if (!missing.includes(added.name)) {
                    addedFields.push(added);
                    continue;
                }
                const value = copy(added.value);
                const node = merge.resolveTermUris(merge.unwrap(value), blockUri);
                const standalone = await standaloneOf(node, template, scope, save);
                addedFields.push(Object.assign({}, added, {value: merge.withNode(value, standalone)}));
            }
            return Object.assign({}, diff, {addedFields: addedFields});
        }

        // The standalone resource of a new element: the one that is already in the folder, or a new one.
        // A new field stays embedded as the converter made it, like the fields ARP already has.
        // Elements inside a new element are made first, so the element embeds the saved ones.
        async function standaloneOf(node, template, scope, save) {
            if (!merge.isContainer(node)) {
                return node;
            }
            for (const name of merge.childNames(node)) {
                const value = node.properties[name];
                const child = await standaloneOf(merge.unwrap(value), template, scope, save);
                node.properties[name] = merge.withNode(value, child);
            }
            const existing = scope.find(function (entry) {
                return entry.json['@type'] === node['@type'] && entry.json['schema:name'] === node['schema:name'];
            });
            if (existing) {
                return copy(existing.json);
            }
            // The converter gives a temporary id and leaves out what CEDAR wants on a standalone resource
            delete node['@id'];
            node['pav:version'] = node['pav:version'] || '0.0.1';
            node['bibo:status'] = node['bibo:status'] || 'bibo:draft';
            if (!save) {
                return node;
            }
            const folderId = await arpService.findOrCreateChildFolder(template.folderId, 'elements',
                'elements description');
            return arpService.createResource(folderId, node, 'ARP.dataverseUpgrade.error.create');
        }

        // ---------- the steps around the merge ----------

        // Tells how a run would start:
        //   'published': every resource is published, the run archives first
        //   'draft': every resource is a draft, the run continues a stopped run
        //   'mixed' or 'empty': the run is not possible
        async function inspectStart(folderId) {
            const entries = await listTree(folderId);
            const published = entries.filter(isPublished);
            let state = 'mixed';
            if (entries.length === 0) {
                state = 'empty';
            } else if (published.length === entries.length) {
                state = 'published';
            } else if (published.length === 0) {
                state = 'draft';
            }
            return {state: state, currentVersion: highestVersion(published)};
        }

        function highestVersion(entries) {
            const versions = entries.map(function (entry) {
                return entry.resource['pav:version'];
            }).filter(function (version) {
                return /^\d+\.\d+\.\d+$/.test(version);
            });
            versions.sort(function (first, second) {
                return versionNumber(parseVersion(first)) - versionNumber(parseVersion(second));
            });
            return versions.pop() || null;
        }

        async function archiveAndDraft(folderId) {
            const inspection = await arpService.inspectFolderForBump(folderId);
            if (inspection.blocked) {
                throw upgradeError(inspection.blocked === 'empty' ? 'empty' : 'mixed');
            }
            await arpService.bumpVersions(folderId, CedarUser.getHomeFolderId(), inspection);
        }

        function validate(entry) {
            return new Promise(function (resolve, reject) {
                AuthorizedBackendService.doCall(arpService.validateResource(entry.json), resolve, function (error) {
                    UIMessageService.showArpError('ARP.validate.errorTitle', 'ARP.validate.error', error);
                    reject(upgradeError('validation', {name: entry.json['schema:name']}));
                });
            });
        }

        async function publish(folderId, version) {
            const inspection = await arpService.inspectFolderForPublishAll(folderId);
            if (inspection.blocked) {
                throw upgradeError(inspection.blocked === 'empty' ? 'empty' : 'mixed');
            }
            await arpService.publishAll(inspection.resources, version);
        }

        // ---------- preview and run ----------

        // Shows what a run would change. The folder is read once, all changes are made in memory only.
        // Returns one report per target version:
        //   {version, blocks: [{block, template, applied, keptArp, reportOnly, updatedResources}], missingTemplates}
        async function preview(folderId, currentVersion, targetVersions) {
            const versions = parseVersions(currentVersion, targetVersions);
            const entries = await listTree(folderId);
            const templates = entries.filter(isTemplate);
            await forEachBatch(templates, loadJson);
            await forEachBatch(templates, function (template) {
                return restoreIdentifier(template, false);
            });
            const reports = [];
            for (let index = 1; index < versions.length; index++) {
                reports.push(await applyStep(entries, versions[index - 1], versions[index], false));
            }
            return reports;
        }

        // Upgrades the folder to each target version in turn and stops on the first error.
        // onProgress(step, version, report) is called with the steps 'archive', 'apply', 'validate',
        // 'publish' and 'done'. Only 'done' has a report. Returns the reports of all versions.
        async function run(folder, currentVersion, targetVersions, onProgress) {
            const versions = parseVersions(currentVersion, targetVersions);
            const folderId = folder['@id'];
            const start = await inspectStart(folderId);
            if (start.state === 'mixed' || start.state === 'empty') {
                throw upgradeError(start.state);
            }
            const reports = [];
            for (let index = 1; index < versions.length; index++) {
                // A folder of drafts is a stopped run: its first step was archived already
                const archiveFirst = index > 1 || start.state === 'published';
                reports.push(await runStep(folderId, versions[index - 1], versions[index], archiveFirst,
                    onProgress || function () {}));
            }
            return reports;
        }

        async function runStep(folderId, prevVersion, nextVersion, archiveFirst, onProgress) {
            const version = toPavVersion(nextVersion);
            if (archiveFirst) {
                onProgress('archive', version);
                await archiveAndDraft(folderId);
            }

            onProgress('apply', version);
            const entries = await listTree(folderId);
            await forEachBatch(entries, loadJson);
            await forEachBatch(entries, function (entry) {
                return restoreIdentifier(entry, true);
            });
            const report = await applyStep(entries, prevVersion, nextVersion, true);
            await forEachBatch(entries.filter(function (entry) {
                return entry.changed;
            }), saveEntry);

            // Every template of a changed block is checked, also when a stopped run already saved the changes
            onProgress('validate', version);
            await forEachBatch(entries.filter(function (entry) {
                return report.blocks.some(function (block) {
                    return block.templateId === entry.json['@id'];
                });
            }), validate);

            onProgress('publish', version);
            await publish(folderId, version);

            onProgress('done', version, report);
            return report;
        }
    }
});
