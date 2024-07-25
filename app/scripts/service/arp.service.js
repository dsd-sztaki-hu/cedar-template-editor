'use strict';

define([
    'angular'
], function(angular) {
    angular.module('cedar.templateEditor.service.arpService', [])
        .service('arpService', arpService);

    arpService.$inject = ["schemaService", "DataManipulationService", "TemplateService", "TemplateElementService", "AuthorizedBackendService", "UIMessageService", "ValidationService", "CONST"];

    function arpService( schemaService, DataManipulationService, TemplateService, TemplateElementService, AuthorizedBackendService, UIMessageService, ValidationService, CONST) {
        return {
            prepareResourceForMerge: prepareResourceForMerge,
            finalizeResourceForMerge: finalizeResourceForMerge,
            doMergeResource: doMergeResource,
            saveDataFromOriginal: saveDataFromOriginal,
            updateResource: updateResource
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
        function prepareResourceForMerge(originalResourceJson, resourceJson) {

            if (Array.isArray(resourceJson)) {
                return resourceJson.map(element => prepareResourceForMerge(originalResourceJson, element));
            }

            else if (resourceJson !== null && typeof resourceJson === 'object') {
                // If the object has an "id" and "pav:derivedFrom" property, replace "id" with "pav:derivedFrom"
                if (resourceJson.hasOwnProperty('pav:derivedFrom') && typeof resourceJson['pav:derivedFrom'] === 'string') {
                    resourceJson['@id'] = resourceJson['pav:derivedFrom'];
                    delete resourceJson['pav:derivedFrom'];
                }
                // If the object has a "pav:createdOn" property, replace "pav:createdOn" with the original "pav:createdOn"
                if (resourceJson.hasOwnProperty('pav:createdOn') && typeof resourceJson['pav:createdOn'] === 'string') {
                    const originalObject = find(originalResourceJson, '@id', resourceJson['@id']);
                    if (originalObject) {
                        resourceJson['pav:createdOn'] = originalObject['pav:createdOn'];
                    }
                }

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
                        return prepareResourceForMerge(originalResourceJson, value);
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
            }
        }
        
        function doMergeResource(resourceJson, originalResourceJson) {
            const mergedResourceJson = prepareResourceForMerge(originalResourceJson, resourceJson);
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
            }

            AuthorizedBackendService.doCall(
                updatePromise,
                function (response) {doUpdate(response)},
                function (err) {
                    UIMessageService.showBackendError('ARP.merge.originalFolderIdError', err);
                }
            );
        }
        
    }
});