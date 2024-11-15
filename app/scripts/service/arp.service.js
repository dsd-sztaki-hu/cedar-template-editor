'use strict';

define([
    'angular'
], function(angular) {
    angular.module('cedar.templateEditor.service.arpService', [])
        .service('arpService', arpService);

    arpService.$inject = ["schemaService", "DataManipulationService", "TemplateService", "TemplateElementService", 
        "AuthorizedBackendService", "UIMessageService", "ValidationService", "CONST", "resourceService",
        "HttpBuilderService", "UrlService", "TemplateFieldService", "$q"];

    function arpService( schemaService, DataManipulationService, TemplateService, TemplateElementService, 
                         AuthorizedBackendService, UIMessageService, ValidationService, CONST, resourceService,
                         HttpBuilderService, UrlService, TemplateFieldService, $q) {
        return {
            prepareResourceForMerge: prepareResourceForMerge,
            finalizeResourceForMerge: finalizeResourceForMerge,
            doMergeResource: doMergeResource,
            saveDataFromOriginal: saveDataFromOriginal,
            updateResource: updateResource,
            arpResourceTypes: arpResourceTypes,
            deleteFolder: deleteFolder,
            getFolderContents: getFolderContents,
            containsPublishedResource: containsPublishedResource,
            validateResource: validateResource,
            omitDeep: omitDeep,
            getResourceContentById: getResourceContentById,
            getResourceReportById: getResourceReportById,
            openOriginalVersionEditor: openOriginalVersionEditor,
            downloadZip: downloadZip,
            createResource: createResource,
            createFolderAsync: createFolderAsync,
        };


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
            const typeStr = content['@type'];
            const lastIndex = typeStr.lastIndexOf('/');
            const contentType = typeStr.substring(lastIndex + 1);
            switch (contentType) {
                case 'TemplateElement':
                    return CONST.resourceType.ELEMENT;
                case 'Template':
                    return CONST.resourceType.TEMPLATE;
                case 'TemplateField':
                    return CONST.resourceType.FIELD;
                case 'TemplateInstance':
                    return CONST.resourceType.INSTANCE;
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
        
        function updateResource(id, resourceJson) {
            const doUpdate = function (response) {
                ValidationService.logValidation(response.headers("CEDAR-Validation-Status"));
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
                function (response) {doUpdate(response)},
                function (err) {
                    UIMessageService.showBackendError('ARP.merge.originalFolderIdError', err);
                }
            );
        }

        function createResource(folderId, resourceJson) {
            const doCreate = function (response) {
                ValidationService.logValidation(response.headers("CEDAR-Validation-Status"));
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
                function (response) {doCreate(response)},
                function (err) {
                    UIMessageService.showBackendError('ARP.merge.originalFolderIdError', err);
                }
            );
        }

        async function containsPublishedResource(folderId) {
            const folderContents = await getFolderContents(folderId, arpResourceTypes());
            
            for (const res of folderContents) {
                if (res.resourceType === CONST.resourceType.FOLDER) {
                    const result = await containsPublishedResource(res['@id']);
                    if (result) {
                        return true;
                    }
                } else {
                    if (res.hasOwnProperty('bibo:status') && res['bibo:status'] === 'bibo:published') {
                        return true;
                    }
                }
            }
            return false;
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
                    const message = (err.data.errorKey === 'noReadAccessToArtifact') ? 'Whoa!' : $translate.instant('SERVER.TEMPLATE.load.error');
                    reject(err);
                    UIMessageService.acknowledgedExecution(
                        function () {},
                        'GENERIC.Warning',
                        message,
                        'GENERIC.Ok');
                  });
            });
          }

          function getResourceReportById(resourceId, resourceType) {
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
                    reject(error);
                  }
              );
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
        };
    }
});