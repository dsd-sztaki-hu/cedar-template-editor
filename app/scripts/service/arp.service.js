'use strict';

define([
    'angular',
    'json!config/arp-service.conf.json'
], function(angular, arpServiceConf) {
    angular.module('cedar.templateEditor.service.arpService', [])
        .service('arpService', arpService);

    arpService.$inject = ["schemaService", "DataManipulationService", "TemplateService", "TemplateElementService", 
        "AuthorizedBackendService", "UIMessageService", "ValidationService", "CONST", "resourceService",
        "HttpBuilderService", "UrlService", "TemplateFieldService", "$q", "$translate", "CedarUser"];

    function arpService( schemaService, DataManipulationService, TemplateService, TemplateElementService, 
                         AuthorizedBackendService, UIMessageService, ValidationService, CONST, resourceService,
                         HttpBuilderService, UrlService, TemplateFieldService, $q, $translate, CedarUser) {

        const arpConfig = arpServiceConf;

        return {
            prepareResourceForMerge: prepareResourceForMerge,
            finalizeResourceForMerge: finalizeResourceForMerge,
            doMergeResource: doMergeResource,
            saveDataFromOriginal: saveDataFromOriginal,
            updateResource: updateResource,
            arpResourceTypes: arpResourceTypes,
            deleteFolder: deleteFolder,
            getFolderContents: getFolderContents,
            getAllFolderContents: getAllFolderContents,
            findOrCreateChildFolder: findOrCreateChildFolder,
            containsPublishedResource: containsPublishedResource,
            inspectFolderForPublishAll: inspectFolderForPublishAll,
            publishAll: publishAll,
            inspectFolderForBump: inspectFolderForBump,
            bumpVersions: bumpVersions,
            findVersionFolder: findVersionFolder,
            validateResource: validateResource,
            omitDeep: omitDeep,
            getResourceContentById: getResourceContentById,
            getResourceReportById: getResourceReportById,
            openOriginalVersionEditor: openOriginalVersionEditor,
            downloadZip: downloadZip,
            createResource: createResource,
            createFolderAsync: createFolderAsync,
            getContentType: getContentType,
            getResourceIconClass: getResourceIconClass,
            getResourceIcon: getResourceIcon,
            importResource: importResource,
            isInTheDataverseFolder: isInTheDataverseFolder,
            isArpCopyButtonEnabled: isArpCopyButtonEnabled,
            isArpMergeButtonEnabled: isArpMergeButtonEnabled,
            isArpUpdatePublishedButtonEnabled: isArpUpdatePublishedButtonEnabled,
            updatePublishedFolder: updatePublishedFolder,
            isArpDownloadZipButtonEnabled: isArpDownloadZipButtonEnabled,
            isArpImportButtonEnabled: isArpImportButtonEnabled,
            extractResources: extractResources,
        };

        function getFeatureFlag(flagName, defaultValue = false) {
            return arpConfig && arpConfig.featureFlags && arpConfig.featureFlags[flagName] !== undefined 
                ? arpConfig.featureFlags[flagName] 
                : defaultValue;
        }

        function isArpCopyButtonEnabled() {
            return getFeatureFlag('enableArpCopyButton');
        }

        function isArpMergeButtonEnabled() {
            return getFeatureFlag('enableArpResourceMergeButton');
        }

        function isArpUpdatePublishedButtonEnabled() {
            return getFeatureFlag('enableArpUpdatePublishedButton');
        }
        
        function isArpDownloadZipButtonEnabled() {
            return getFeatureFlag('enableArpDownloadZipButton');
        }
        
        function isArpImportButtonEnabled() {
            return getFeatureFlag('enableArpImportButton');
        }

        function find(object, key, value) {
            if (!object || typeof object !== 'object') return;
            if (object[key] === value) return object;
            let result;
            Object.values(object).some(o => result = find(o, key, value));
            return result;
        }
        

        // prepare the resource for merge
        // keep the original "pav:createdOn" values and the original "@id" values
        function prepareResourceForMerge(originalResourceJson, resourceJson, elementOnly) {

            if (Array.isArray(resourceJson)) {
                return resourceJson.map(element => prepareResourceForMerge(originalResourceJson, element, elementOnly));
            }

            else if (resourceJson !== null && typeof resourceJson === 'object') {
                // If the object has an "id" and "pav:derivedFrom" property, replace "id" with "pav:derivedFrom"
                if (resourceJson.hasOwnProperty('pav:derivedFrom') && typeof resourceJson['pav:derivedFrom'] === 'string') {
                    console.log('elementOnlyTest', elementOnly);
                    resourceJson['@id'] = resourceJson['pav:derivedFrom'];
                    if (!elementOnly) {
                        delete resourceJson['pav:derivedFrom'];
                    } else {
                        console.log('elementOnly', originalResourceJson);
                        console.log('elementOnly2', resourceJson);
                        if (originalResourceJson.hasOwnProperty('pav:derivedFrom')) {
                            resourceJson['pav:derivedFrom'] = originalResourceJson['pav:derivedFrom'];
                        } else {
                            delete resourceJson['pav:derivedFrom'];
                        }
                    }
                }
                
                // If the object has a "pav:createdOn" property, replace "pav:createdOn" with the original "pav:createdOn"
                // if (resourceJson.hasOwnProperty('pav:createdOn') && typeof resourceJson['pav:createdOn'] === 'string') {
                //     const originalObject = find(originalResourceJson, '@id', resourceJson['@id']);
                //     if (originalObject) {
                //         resourceJson['pav:createdOn'] = originalObject['pav:createdOn'];
                //     }
                // }

                // If the object has a "pav:createdBy" property, replace "pav:createdBy" with the original "pav:createdBy"
                if (resourceJson.hasOwnProperty('pav:createdBy') && typeof resourceJson['pav:createdBy'] === 'string') {
                    const originalObject = find(originalResourceJson, '@id', resourceJson['@id']);
                    if (originalObject) {
                        resourceJson['pav:createdBy'] = originalObject['pav:createdBy'];
                    }
                }
            
                // Always keep the original "schema:identifier"
                const originalObject = find(originalResourceJson, '@id', resourceJson['@id']);
                if (originalObject) {
                    resourceJson['schema:identifier'] = originalObject['schema:identifier'];
                }
                
                // remove temporary properties
                delete resourceJson['_arpTmpIsNewResPropForBgColor_'];
                delete resourceJson['_arpOriginalFolderId_'];

                const values = Object.values(resourceJson);
                values.forEach(value => {
                    if (typeof value === 'object') {
                        return prepareResourceForMerge(originalResourceJson, value, elementOnly);
                    }
                });
            }

            return resourceJson;
        }
        
        function finalizeResourceForMerge(resourceJson) {
            // If maxItems is N, then remove maxItems
            schemaService.removeUnnecessaryMaxItems(resourceJson);
            schemaService.defaultSchemaTitleAndDescription(resourceJson);
            DataManipulationService.updateKeys(resourceJson);
            const extendedResourceJson = jQuery.extend(true, {}, resourceJson);
            DataManipulationService.stripTmps(extendedResourceJson);
            return extendedResourceJson;
        }

        function getContentType(content) {
            // Ensure content is an object and '@type' exists
            if (!content || typeof content !== "object" || !content['@type'] || typeof content['@type'] !== "string") {
                console.warn("Invalid content:", content);
                return null; // Return null for invalid or unexpected content
            }

            const typeStr = content['@type'];
            const lastIndex = typeStr.lastIndexOf('/');

            // Check if '/' exists in the string
            if (lastIndex === -1) {
                console.warn("Invalid '@type' format:", typeStr);
                return null; // Return null if the type string doesn't have a '/'
            }

            const contentType = typeStr.substring(lastIndex + 1);

            // Map the extracted type to the resource type
            switch (contentType) {
                case 'TemplateElement':
                    return CONST.resourceType.ELEMENT;
                case 'Template':
                    return CONST.resourceType.TEMPLATE;
                case 'TemplateField':
                    return CONST.resourceType.FIELD;
                case 'TemplateInstance':
                    return CONST.resourceType.INSTANCE;
                default:
                    console.warn("Unknown content type:", contentType);
                    return null; // Return null for unknown content types
            }
        }
        
        function doMergeResource(resourceJson, originalResourceJson) {
            const mergedResourceJson = prepareResourceForMerge(originalResourceJson, resourceJson, false);
            return finalizeResourceForMerge(mergedResourceJson);
        }

        function saveDataFromOriginal(resource, originalFolderId, originalIdentifier, publishedVersion) {
            resource['_arpOriginalFolderId_'] = originalFolderId;
            resource['schema:identifier'] = originalIdentifier;
            resource['pav:version'] = publishedVersion;
            updateResource(resource['@id'], resource);
        }
        
        function updateResource(id, resourceJson, errorKey) {
            return new Promise((resolve, reject) => {
                const doUpdate = function (response) {
                    ValidationService.logValidation(response.headers("CEDAR-Validation-Status"));
                    return response.data;
                };
                
                let updatePromise;
                const resourceType = getContentType(resourceJson);
                if (resourceType === CONST.resourceType.TEMPLATE) {
                    updatePromise = TemplateService.updateTemplate(id, resourceJson);
                } else if (resourceType === CONST.resourceType.ELEMENT) {
                    updatePromise = TemplateElementService.updateTemplateElement(id, resourceJson);
                } else if (resourceType === CONST.resourceType.FIELD) {
                    updatePromise = TemplateFieldService.updateTemplateField(id, resourceJson);
                }
                AuthorizedBackendService.doCall(
                    updatePromise,
                    function (response) {
                        resolve(doUpdate(response));
                    },
                    function (err) {
                        UIMessageService.showBackendError(errorKey || 'ARP.merge.originalFolderIdError', err);
                        reject(err);
                    }
                );
            });
        }

        function setPublicationStatus(artifactId, publicationStatus) {
            const keys = CedarUser.getApiKeys();
            const apiKey = keys && keys.length ? keys[0].key : null;
            if (!apiKey) {
                const error = {data: {message: 'Missing API key'}};
                UIMessageService.showBackendError('ARP.updatePublished.statusError', error);
                return Promise.reject(error);
            }

            const request = HttpBuilderService.post(UrlService.arpUpdatePublicationStatus(), {
                '@id': artifactId,
                publicationStatus: publicationStatus
            });
            request.headers = {Authorization: 'apiKey ' + apiKey};

            return new Promise((resolve, reject) => {
                AuthorizedBackendService.doCall(
                    request,
                    function (response) {
                        resolve(response.data);
                    },
                    function (error) {
                        UIMessageService.showBackendError('ARP.updatePublished.statusError', error);
                        reject(error);
                    }
                );
            });
        }

        function copyArtifact(resource, folderId) {
            return new Promise((resolve, reject) => {
                resourceService.copyResource(
                    resource,
                    folderId,
                    resource['schema:name'],
                    function (response) {
                        resolve(response);
                    },
                    function (error) {
                        UIMessageService.showBackendError('ARP.updatePublished.copyError', error);
                        reject(error);
                    }
                );
            });
        }

        async function findOrCreateChildFolder(parentFolderId, name, description) {
            const folders = await getFolderContents(parentFolderId, [CONST.resourceType.FOLDER]);
            const existing = (folders || []).find(function (folder) {
                return folder && folder['schema:name'] === name;
            });
            if (existing) {
                return existing['@id'];
            }
            return new Promise((resolve, reject) => {
                resourceService.createFolder(parentFolderId, name, description || '', function (created) {
                    resolve(created['@id']);
                }, function (error) {
                    UIMessageService.showBackendError('ARP.updatePublished.createFolderError', error);
                    reject(error);
                });
            });
        }

        async function updateExistingPublished(draft, resourceType) {
            const originalId = draft['pav:derivedFrom'];
            const original = await getResourceContentById(originalId, resourceType);
            const version = original['pav:version'];
            const snapshot = angular.copy(original);

            await setPublicationStatus(originalId, 'bibo:draft');

            const merged = doMergeResource(angular.copy(draft), original);
            merged['pav:version'] = version;
            merged['bibo:status'] = 'bibo:draft';

            try {
                await updateResource(originalId, merged, 'ARP.updatePublished.writeError');
            } catch (writeError) {
                const rollback = angular.copy(snapshot);
                rollback['bibo:status'] = 'bibo:draft';
                try {
                    await updateResource(originalId, rollback, 'ARP.updatePublished.rollbackError');
                } catch (rollbackError) {
                    // The published body was not replaced. Restoring the status still matters.
                }
                try {
                    await setPublicationStatus(originalId, 'bibo:published');
                } catch (statusError) {
                    // The write error is the one reported to the caller.
                }
                throw writeError;
            }

            await setPublicationStatus(originalId, 'bibo:published');
        }

        async function publishNewArtifact(draft, resourceType, destinationFolderId, publishedVersion) {
            const copied = await copyArtifact(draft, destinationFolderId);
            const targetId = copied['@id'];
            const copiedFull = await getResourceContentById(targetId, resourceType);
            copiedFull['pav:version'] = publishedVersion;
            copiedFull['bibo:status'] = 'bibo:draft';
            copiedFull['schema:identifier'] = draft['schema:identifier'];
            copiedFull['_arpOriginalFolderId_'] = destinationFolderId;
            delete copiedFull['pav:derivedFrom'];
            await updateResource(targetId, copiedFull, 'ARP.updatePublished.writeError');
            await setPublicationStatus(targetId, 'bibo:published');
        }

        async function updatePublishedFolderContents(draftFolderId, destinationFolderId, publishedVersion) {
            const contents = await getFolderContents(draftFolderId, arpResourceTypes());
            for (const res of contents) {
                if (!res) {
                    continue;
                }
                if (res.resourceType === CONST.resourceType.FOLDER) {
                    const childDestinationId = await findOrCreateChildFolder(
                        destinationFolderId,
                        res['schema:name'],
                        res['schema:description']
                    );
                    await updatePublishedFolderContents(res['@id'], childDestinationId, publishedVersion);
                } else if (res.resourceType === CONST.resourceType.TEMPLATE ||
                    res.resourceType === CONST.resourceType.ELEMENT ||
                    res.resourceType === CONST.resourceType.FIELD) {
                    const draft = await getResourceContentById(res['@id'], res.resourceType);
                    if (draft && typeof draft['pav:derivedFrom'] === 'string' && draft['pav:derivedFrom']) {
                        await updateExistingPublished(draft, res.resourceType);
                    } else {
                        await publishNewArtifact(draft, res.resourceType, destinationFolderId, publishedVersion);
                    }
                }
            }
        }

        async function updatePublishedFolder(draftFolderId, originalFolderId, publishedVersion) {
            await updatePublishedFolderContents(draftFolderId, originalFolderId, publishedVersion);
            await deleteFolder(draftFolderId, true);
        }

        function createResource(folderId, resourceJson, errorKey) {
            return new Promise((resolve, reject) => {
                const doCreate = function (response) {
                    ValidationService.logValidation(response.headers("CEDAR-Validation-Status"));
                    return response.data;
                };

                let createPromise;
                const resourceType = getContentType(resourceJson);
                if (resourceType === CONST.resourceType.TEMPLATE) {
                    createPromise = TemplateService.saveTemplate(folderId, resourceJson);
                } else if (resourceType === CONST.resourceType.ELEMENT) {
                    createPromise = TemplateElementService.saveTemplateElement(folderId, resourceJson);
                } else if (resourceType === CONST.resourceType.FIELD) {
                    createPromise = TemplateFieldService.saveTemplateField(folderId, resourceJson);
                }
                AuthorizedBackendService.doCall(
                    createPromise,
                    function (response) {
                        resolve(doCreate(response));
                    },
                    function (err) {
                        UIMessageService.showBackendError(errorKey || 'ARP.merge.originalFolderIdError', err);
                        reject(err);
                    }
                );
            });
        }

        function isPublished(resource) {
            return !!(resource && resource.hasOwnProperty('bibo:status') && resource['bibo:status'] === 'bibo:published');
        }

        async function containsPublishedResource(folderId) {
            const folderContents = await getFolderContents(folderId, arpResourceTypes());
            
            for (const res of folderContents) {
                if (res.resourceType === CONST.resourceType.FOLDER) {
                    const result = await containsPublishedResource(res['@id']);
                    if (result) {
                        return true;
                    }
                } else if (isPublished(res)) {
                    return true;
                }
            }
            return false;
        }

        async function inspectFolderForPublishAll(folderId) {
            const resources = [];
            const publishedResources = [];
            const highestVersion = {parts: [0, 0, 1]};
            await walkFolderForPublishAll(folderId, resources, publishedResources, '', highestVersion);
            if (publishedResources.length > 0) {
                return {blocked: 'published', resources: [], publishedResources: publishedResources, minimumVersion: highestVersion.parts};
            }
            if (resources.length === 0) {
                return {blocked: 'empty', resources: [], publishedResources: [], minimumVersion: highestVersion.parts};
            }
            return {blocked: null, resources: resources, publishedResources: [], minimumVersion: highestVersion.parts};
        }

        async function walkFolderForPublishAll(folderId, resources, publishedResources, folderPath, highestVersion) {
            const folderContents = await getAllFolderContents(folderId, arpResourceTypes());
            for (const res of folderContents) {
                if (!res) {
                    continue;
                }
                if (res.resourceType === CONST.resourceType.FOLDER) {
                    const childPath = folderPath ? folderPath + ' / ' + res['schema:name'] : res['schema:name'];
                    await walkFolderForPublishAll(res['@id'], resources, publishedResources, childPath, highestVersion);
                } else if (isPublished(res)) {
                    rememberHighestVersion(res, highestVersion);
                    publishedResources.push({
                        name: res['schema:name'],
                        resourceType: res.resourceType,
                        version: res['pav:version'],
                        folderPath: folderPath
                    });
                } else {
                    rememberHighestVersion(res, highestVersion);
                    resources.push(res);
                }
            }
        }

        function rememberHighestVersion(resource, highestVersion) {
            const parts = minimumVersionParts(resource);
            if (!parts) {
                return;
            }
            if (versionTotal(parts) > versionTotal(highestVersion.parts)) {
                highestVersion.parts = parts;
            }
        }

        function minimumVersionParts(resource) {
            const currentVersion = resource && resource['pav:version'];
            if (typeof currentVersion !== 'string') {
                return null;
            }
            const pieces = currentVersion.split('.');
            if (pieces.length !== 3) {
                return null;
            }
            const major = parseInt(pieces[0], 10);
            const minor = parseInt(pieces[1], 10);
            let patch = parseInt(pieces[2], 10);
            if (isNaN(major) || isNaN(minor) || isNaN(patch)) {
                return null;
            }
            if (isPublished(resource)) {
                patch = patch + 1;
            }
            return [major, minor, patch];
        }

        function versionTotal(parts) {
            return parts[0] * 1000000 + parts[1] * 1000 + parts[2];
        }

        function getAllFolderContents(folderId, resourceTypes) {
            const pageSize = 500;
            const collected = [];

            function loadPage(offset) {
                return new Promise(function (resolve, reject) {
                    resourceService.getResources({
                            folderId: folderId,
                            resourceTypes: resourceTypes,
                            limit: pageSize,
                            offset: offset
                        },
                        function (response) {
                            const page = Array.isArray(response.resources) ? response.resources : (response.resources ? [response.resources] : []);
                            page.forEach(function (resource) {
                                if (resource) {
                                    collected.push(resource);
                                }
                            });
                            const totalCount = response.totalCount;
                            const hasMore = page.length > 0 && (
                                (typeof totalCount === 'number' && collected.length < totalCount) ||
                                (typeof totalCount !== 'number' && page.length === pageSize)
                            );
                            if (hasMore) {
                                resolve(loadPage(offset + page.length));
                            } else {
                                resolve(collected);
                            }
                        },
                        function (error) {
                            UIMessageService.showBackendError('ARP.merge.getFolderContents.error', error);
                            reject(error);
                        });
                });
            }

            return loadPage(0);
        }

        async function inspectFolderForBump(folderId) {
            const tree = [];
            const state = {unpublished: false, resourceCount: 0, highest: null};
            await collectFolderForBump(folderId, tree, state);
            if (state.unpublished) {
                return {blocked: 'unpublished', tree: [], highestVersion: null, nextVersion: null};
            }
            if (state.resourceCount === 0) {
                return {blocked: 'empty', tree: [], highestVersion: null, nextVersion: null};
            }
            const highest = state.highest || [0, 0, 1];
            return {
                blocked: null,
                tree: tree,
                highestVersion: formatVersion(highest)
            };
        }

        async function collectFolderForBump(folderId, nodes, state) {
            const folderContents = await getAllFolderContents(folderId, arpResourceTypes());
            for (const res of folderContents) {
                if (!res || state.unpublished) {
                    continue;
                }
                if (res.resourceType === CONST.resourceType.FOLDER) {
                    const child = {
                        kind: 'folder',
                        id: res['@id'],
                        name: res['schema:name'],
                        description: res['schema:description'] || '',
                        children: []
                    };
                    nodes.push(child);
                    await collectFolderForBump(res['@id'], child.children, state);
                } else if (!isPublished(res)) {
                    state.unpublished = true;
                } else {
                    state.resourceCount++;
                    rememberRawVersion(res, state);
                    nodes.push({kind: 'resource', resource: res});
                }
            }
        }

        function rememberRawVersion(resource, state) {
            const currentVersion = resource && resource['pav:version'];
            if (typeof currentVersion !== 'string') {
                return;
            }
            const pieces = currentVersion.split('.');
            if (pieces.length !== 3) {
                return;
            }
            const parts = [parseInt(pieces[0], 10), parseInt(pieces[1], 10), parseInt(pieces[2], 10)];
            if (parts.some(function (part) { return isNaN(part); })) {
                return;
            }
            if (!state.highest || versionTotal(parts) > versionTotal(state.highest)) {
                state.highest = parts;
            }
        }

        function formatVersion(parts) {
            return parts[0] + '.' + parts[1] + '.' + parts[2];
        }

        async function bumpVersions(folderId, homeFolderId, inspection) {
            const versionsFolderId = await ensureVersionsFolder(homeFolderId);
            const pathNames = await getPublicPath(folderId);
            pathNames.push(inspection.highestVersion);
            const versionFolderId = await buildVersionFolder(pathNames, versionsFolderId);
            await moveNodes(inspection.tree, versionFolderId);
            await createDraftNodes(inspection.tree, folderId);
        }

        // The folder bumpVersions archives a version of the folder into: <home>/Versions/<path from Public>/<version>.
        // Returns its id, or null when it does not exist. Creates nothing.
        async function findVersionFolder(folderId, homeFolderId, version) {
            let current = await findChildFolder(homeFolderId, 'Versions');
            const pathNames = (await getPublicPath(folderId)).concat(version);
            for (const folderName of pathNames) {
                if (!current) {
                    return null;
                }
                current = await findChildFolder(current['@id'], folderName);
            }
            return current ? current['@id'] : null;
        }

        async function ensureVersionsFolder(homeFolderId) {
            const existing = await findChildFolder(homeFolderId, 'Versions');
            const versionsFolderId = existing ? existing['@id'] : await createChildFolder(homeFolderId, 'Versions', 'Older versions of published resources', 'ARP.merge.createVersionsFolder.error');
            await shareFolderWithEverybody(versionsFolderId);
            return versionsFolderId;
        }

        async function findChildFolder(parentFolderId, name) {
            const folders = await getAllFolderContents(parentFolderId, [CONST.resourceType.FOLDER]);
            return folders.find(function (folder) {
                return folder && folder['schema:name'] === name;
            }) || null;
        }

        function createChildFolder(parentFolderId, name, description, errorKey) {
            const descriptionValue = textValue(description) || textValue(name) || 'description';
            return new Promise(function (resolve, reject) {
                resourceService.createFolder(
                    parentFolderId,
                    name,
                    descriptionValue,
                    function (response) {
                        resolve(response['@id']);
                    },
                    function (error) {
                        UIMessageService.showBackendError(errorKey, error);
                        reject(error);
                    }
                );
            });
        }

        function textValue(value) {
            return typeof value === 'string' ? value.trim() : '';
        }

        async function buildVersionFolder(folderNames, parentFolderId) {
            let currentId = parentFolderId;
            for (const folderName of folderNames) {
                const existing = await findChildFolder(currentId, folderName);
                if (existing) {
                    currentId = existing['@id'];
                } else {
                    currentId = await createChildFolder(currentId, folderName, '', 'ARP.recursiveMerge.buildVersionFolderForResourceError');
                }
            }
            return currentId;
        }

        function getPublicPath(folderId) {
            return new Promise(function (resolve, reject) {
                resourceService.getResources({
                        folderId: folderId,
                        resourceTypes: [CONST.resourceType.FOLDER]
                    },
                    function (response) {
                        const pathInfo = response.pathInfo || [];
                        const originalPath = [];
                        let saveFolderName = false;
                        pathInfo.forEach(function (resource) {
                            const folderName = resource['schema:name'];
                            if (saveFolderName === false) {
                                saveFolderName = folderName === 'Public';
                            }
                            if (saveFolderName === true) {
                                originalPath.push(folderName);
                            }
                        });
                        if (originalPath.length === 0 && pathInfo.length > 0) {
                            originalPath.push(pathInfo[pathInfo.length - 1]['schema:name']);
                        }
                        resolve(originalPath);
                    },
                    function (error) {
                        UIMessageService.showBackendError('ARP.merge.getPublicPathInfo.error', error);
                        reject(error);
                    });
            });
        }

        async function moveNodes(nodes, destinationFolderId) {
            for (const node of nodes) {
                const resource = node.kind === 'folder'
                    ? {'@id': node.id, resourceType: CONST.resourceType.FOLDER}
                    : node.resource;
                await moveOne(resource, destinationFolderId);
            }
        }

        function moveOne(resource, destinationFolderId) {
            return new Promise(function (resolve, reject) {
                resourceService.moveResource(
                    resource,
                    destinationFolderId,
                    function () {
                        resolve();
                    },
                    function (error) {
                        UIMessageService.showBackendError('ARP.merge.moveFolderContents.error', error);
                        reject(error);
                    }
                );
            });
        }

        async function createDraftNodes(nodes, parentFolderId) {
            for (const node of nodes) {
                if (node.kind === 'folder') {
                    const folderId = await createChildFolder(parentFolderId, node.name, node.description, 'ARP.merge.copyFolderContents.error');
                    await createDraftNodes(node.children, folderId);
                } else {
                    await createDraftOne(node.resource, parentFolderId);
                }
            }
        }

        function createDraftOne(resource, folderId) {
            return new Promise(function (resolve, reject) {
                resourceService.copyResource(
                    resource,
                    folderId,
                    resource['schema:name'],
                    function () {
                        resolve();
                    },
                    function (error) {
                        UIMessageService.showBackendError('SERVER.RESOURCE.copyResource.error', error);
                        reject(error);
                    }
                );
            });
        }

        function shareFolderWithEverybody(folderId) {
            return findEverybodyGroupId().then(function (groupId) {
                if (!groupId) {
                    return;
                }
                const url = UrlService.folderPermission(folderId);
                return new Promise(function (resolve, reject) {
                    AuthorizedBackendService.doCall(
                        HttpBuilderService.get(url),
                        function (response) {
                            const permissions = response.data || {};
                            const groupPermissions = permissions.groupPermissions || [];
                            const alreadyShared = groupPermissions.some(function (groupPermission) {
                                return groupPermission.group && groupPermission.group['@id'] === groupId && groupPermission.permission === 'read';
                            });
                            if (alreadyShared) {
                                resolve();
                                return;
                            }
                            AuthorizedBackendService.doCall(
                                HttpBuilderService.put(url, {
                                    owner: permissions.owner,
                                    userPermissions: permissions.userPermissions || [],
                                    groupPermissions: groupPermissions.concat([{
                                        permission: 'read',
                                        group: {'@id': groupId}
                                    }])
                                }),
                                function () {
                                    resolve();
                                },
                                function (error) {
                                    UIMessageService.showBackendError('ARP.merge.setPermissions.error', error);
                                    reject(error);
                                }
                            );
                        },
                        function (error) {
                            UIMessageService.showBackendError('ARP.merge.setPermissions.error', error);
                            reject(error);
                        }
                    );
                });
            });
        }

        function findEverybodyGroupId() {
            return new Promise(function (resolve, reject) {
                AuthorizedBackendService.doCall(
                    HttpBuilderService.get(UrlService.getGroups()),
                    function (response) {
                        const groups = (response.data && response.data.groups) || [];
                        const group = groups.find(function (item) {
                            return item.specialGroup === 'EVERYBODY';
                        });
                        if (group) {
                            resolve(group['@id']);
                        } else {
                            UIMessageService.showBackendWarning($translate.instant('ARP.merge.findEverybodyGroup.error'), 'EVERYBODY group not found');
                            resolve(null);
                        }
                    },
                    function (error) {
                        UIMessageService.showBackendError('ARP.merge.findEverybodyGroup.error', error);
                        reject(error);
                    }
                );
            });
        }

        function publishAll(resources, version) {
            return (resources || []).reduce(function (chain, resource) {
                return chain.then(function () {
                    return new Promise(function (resolve, reject) {
                        resourceService.publishResource(
                            resource,
                            version,
                            function () {
                                resolve();
                            },
                            function (error) {
                                UIMessageService.showBackendError('SERVER.RESOURCE.publishResource.error', error);
                                reject(error);
                            }
                        );
                    });
                });
            }, Promise.resolve());
        }


        function getFolderContents(folderId, resourceTypes) {
            return new Promise((resolve, reject) => {
                resourceService.getResources({
                        folderId         : folderId,
                        resourceTypes    : resourceTypes ?? arpResourceTypes(),
                    },
                    function (response) {
                        resolve(Array.isArray(response.resources) ? response.resources : [response.resources]);
                    },
                    function (error) {
                        UIMessageService.showBackendError('ARP.merge.getFolderContents.error', error);
                        reject(error);
                    });
            });
        }

        async function deleteFolder(folderId, silentDelete) {
            return new Promise(async (resolve, reject) => {
                try {
                    const arrayResponse = await getFolderContents(folderId, arpResourceTypes());
                    
                    for (const res of arrayResponse) {
                        if (res.resourceType === CONST.resourceType.FOLDER) {
                            await deleteFolder(res['@id'], true);
                        } else {
                            await new Promise((resolve, reject) => {
                                resourceService.deleteResource(res, function(response) {
                                    resolve(response);
                                }, function(error) {
                                    UIMessageService.showBackendError('ARP.merge.deleteFolder.error', error);
                                    reject(error);
                                });
                            });
                        }
                    }

                    await new Promise((resolve, reject) => {
                        resourceService.deleteFolder(folderId, function(response) {
                            if (!silentDelete) {
                                UIMessageService.flashSuccess('ARP.delete.success',
                                    {},
                                    'ARP.delete.arpDeleted');
                            }
                            resolve(response);
                        }, function(error) {
                            if (!silentDelete) {
                                UIMessageService.showBackendError('SERVER.' + r.resourceType.toUpperCase() + '.delete.error', error);
                            }
                            reject(error);
                        });
                    });

                    resolve();
                } catch (error) {
                    reject(error);
                }
            });
        }

        function arpResourceTypes() {
            return [CONST.resourceType.FOLDER, CONST.resourceType.TEMPLATE, CONST.resourceType.ELEMENT, CONST.resourceType.FIELD];
        }
        
        function validateResource(resource) {
            return HttpBuilderService.post(UrlService.arpValidateResourceJson(), angular.toJson(resource));
            
        }

        function extractResources(template, params, extractType) {
            const requestBody = {
                cedarResource: template,
                cedarParams: params
            };
            switch (extractType) {
                case "templateElements":
                    return HttpBuilderService.post(UrlService.arpExtractTemplateElements(params.apiKey), angular.toJson(requestBody));
                case "templateFields":
                    return HttpBuilderService.post(UrlService.arpExtractTemplateFields(params.apiKey), angular.toJson(requestBody));
                case "templateElementsAndFields":
                    return HttpBuilderService.post(UrlService.arpExtractResources(params.apiKey), angular.toJson(requestBody));
                default:
                    return Promise.reject("Invalid resource type");
            }
        }

        function importResource(resource, parentFolderId) {
            return new Promise((resolve, reject) => {
                const doUpdate = function (response) {
                    ValidationService.logValidation(response.headers("CEDAR-Validation-Status"));
                    return response.data;
                };
                
                let updatePromise;
                const resourceType = getContentType(resource);

                if (resourceType === CONST.resourceType.TEMPLATE) {
                    updatePromise = TemplateService.updateTemplate(resource['@id'], resource);
                } else if (resourceType === CONST.resourceType.ELEMENT) {
                    updatePromise = TemplateElementService.updateTemplateElement(resource['@id'], resource);
                } else if (resourceType === CONST.resourceType.FIELD) {
                    updatePromise = TemplateFieldService.updateTemplateField(resource['@id'], resource);
                }

                updatePromise.url += '?folder_id=' + UrlService.encodeURIComponent(parentFolderId);

                AuthorizedBackendService.doCall(
                    updatePromise,
                    function (response) {
                        resolve(doUpdate(response));
                    },
                    function (err) {
                        UIMessageService.showBackendError('ARP.resourceImport.error.invalidResource', err);
                        reject(err);
                    }
                );
            });
        }

        // remove the keys that are not needed for the preview
        function omitDeep(obj) {
            const keysToExclude = ['pav:derivedFrom', 'pav:createdOn', 'pav:lastUpdatedOn',
                '@id', 'pav:createdBy', 'schema:identifier', '_arpTmpIsNewResPropForBgColor_', '_arpOriginalFolderId_',
                'oslc:modifiedBy', 'oslc:updatedBy', 'bibo:status'
            ];
            if (_.isArray(obj)) {
                obj.forEach((element, index) => {
                    if (_.isObject(element)) {
                        omitDeep(element, keysToExclude);
                    }
                });
            } else if (_.isObject(obj)) {
                _.forIn(obj, function(value, key) {
                    if (_.isObject(value)) {
                        omitDeep(value, keysToExclude);
                    } else if (keysToExclude.includes(key)) {
                        delete obj[key];
                    }
                });
            }
            return obj;
        }

        function getResourceContentById(updatedResourceId, updatedResourceType) {
            return new Promise((resolve, reject) => {
              const originalResourceId = updatedResourceId
              let promise;

              if (updatedResourceType === CONST.resourceType.TEMPLATE) {
                promise = TemplateService.getTemplate(originalResourceId);
              } else if (updatedResourceType === CONST.resourceType.ELEMENT) {
                promise = TemplateElementService.getTemplateElement(originalResourceId);
              } else if (updatedResourceType === CONST.resourceType.FIELD) {
                promise = TemplateFieldService.getTemplateField(originalResourceId);
              }

              AuthorizedBackendService.doCall(
                  promise,
                  function (response) {
                    resolve(response.data);
                  },
                  function (err) {
                    const message = (err.data.errorKey === 'noReadAccessToArtifact') ? '' : $translate.instant('SERVER.TEMPLATE.load.error');
                    reject(err);
                    UIMessageService.acknowledgedExecution(
                        function () {},
                        'GENERIC.Warning',
                        message,
                        'GENERIC.Ok');
                  });
            });
          }

          function getResourceReportById(resourceId, resourceType, doNotShowErrorMessage = false) {
            return new Promise((resolve, reject) => {
              let url;
              switch (resourceType) {
                case CONST.resourceType.FOLDER:
                  url = UrlService.folders() + '/' + encodeURIComponent(resourceId);
                  break;
                case CONST.resourceType.ELEMENT:
                  url = UrlService.getTemplateElement(resourceId) + '/report';
                  break;
                case CONST.resourceType.FIELD:
                  url = UrlService.getTemplateField(resourceId) + '/report';
                  break;
                case CONST.resourceType.TEMPLATE:
                  url = UrlService.getTemplate(resourceId) + '/report';
                  break;
                case CONST.resourceType.INSTANCE:
                  url = UrlService.getTemplateInstance(resourceId) + '/report';
                  break;
              }
              AuthorizedBackendService.doCall(
                  HttpBuilderService.get(url),
                  function (response) {
                    resolve(response.data);
                  },
                  function (error) {
                      const message = (error.data.errorKey === 'noReadAccessToArtifact') ? $translate.instant('ARP.GENERIC.openOriginalError') : $translate.instant('ARP.GENERIC.missingPermissionToOpenOriginal');
                      reject(error);
                      if (!doNotShowErrorMessage) {
                          UIMessageService.acknowledgedExecution(
                              function () {},
                              'GENERIC.Warning',
                              message,
                              'GENERIC.Ok');
                      }
                  });
            });
          }

          async function openOriginalVersionEditor(resource) {
            const resourceId = resource['pav:derivedFrom'];
            const resourceType = getContentType(resource);
            const report = await getResourceReportById(resourceId, resourceType);
            const parentFolderId = report.pathInfo[report.pathInfo.length - 2]['@id'];
            switch (resourceType) {
              case CONST.resourceType.INSTANCE:
                return '/instances/edit/' + resourceId + '?folderId=' + encodeURIComponent(parentFolderId);
              case CONST.resourceType.ELEMENT:
                return '/elements/edit/' + resourceId + '?folderId=' + encodeURIComponent(parentFolderId);
              case CONST.resourceType.FIELD:
                return '/fields/edit/' + resourceId + '?folderId=' + encodeURIComponent(parentFolderId);
              case CONST.resourceType.TEMPLATE:
                return '/templates/edit/' + resourceId + '?folderId=' + encodeURIComponent(parentFolderId);
            }
          }
        
        async function downloadZip(resources, zipFileName) {
            const deferred = $q.defer();
            const zip = new JSZip();
            for(let [resourceId, resourceDetails] of resources) {
                const resourceType = resourceDetails['resourceType'];
                if (resourceType === CONST.resourceType.FOLDER) {
                    await getResourceReportById(resourceId, resourceType).then(content => {
                        const fileName = resourceDetails['zipFolderPath'] === '' ?
                            '.' + content['schema:name'] + '_metadata.json' :
                            resourceDetails['zipFolderPath'] + '/.' + content['schema:name'] + '_metadata.json';
                        const prettyContent = JSON.stringify(content, null, 2);
                        zip.file(fileName, prettyContent, { binary: false });
                    })
                } else {
                    await getResourceContentById(resourceId, resourceType).then(content => {
                        const fileName = resourceDetails['zipFolderPath'] === '' ?
                            content['schema:name'] + '.json' :
                            resourceDetails['zipFolderPath'] + '/' + content['schema:name'] + '.json';
                        const prettyContent = JSON.stringify(content, null, 2);
                        zip.file(fileName, prettyContent, { binary: false });
                    });
                }
            }
            
            const zipFileNameWithExtension = zipFileName.replace(' ', '_') + '_export.zip';

            zip.generateAsync({ type: 'blob' })
                .then((content) => {
                    saveAs(content, zipFileNameWithExtension);
                    deferred.resolve(content);
                });
        }

        function createFolderAsync(parentFolderId, newFolderName, description) {
            return new Promise((resolve, reject) => {
                resourceService.createFolder(
                    parentFolderId,
                    newFolderName,
                    description,
                    function (response) {
                        const newFolderId = response['@id'];
                        resolve(newFolderId);
                    },
                    function (error) {
                        UIMessageService.showBackendError('ARP.resourceImport.error', error);
                        reject(error);
                    }
                );
            });
        }

        function getResourceIconClass(resource) {
            let result = "";
            if (resource) {
                result += resource.resourceType + " ";
                result += getResourceIcon(resource.resourceType);
            }
            return result;
        }
        
        function getResourceIcon(resourceType) {
            switch (resourceType) {
                case CONST.resourceType.FOLDER:
                    return "fa-folder";
                case CONST.resourceType.TEMPLATE:
                    return "fa-file-text";
                case CONST.resourceType.INSTANCE:
                    return "fa-tag";
                case CONST.resourceType.ELEMENT:
                    return "fa-cubes";
                case CONST.resourceType.FIELD:
                    return "fa-cube";
                default:
                    return "fa-question-circle";
            }            
        }

        function isInTheDataverseFolder(resourceReport) {
            const pathInfo = resourceReport.pathInfo;
            const publicFolder = pathInfo.find(pathInfo => pathInfo['schema:name'] === 'Public');
            if (publicFolder) {
                const dataverseFolder = pathInfo.find(pathInfo => pathInfo['schema:name'] === 'Dataverse');
                if (dataverseFolder) {
                    return pathInfo.indexOf(dataverseFolder) > pathInfo.indexOf(publicFolder);
                } else {
                    return false;
                }
            } else {
                return false;
            }
        }
    }
});