'use strict';

define([
    'angular'
], function(angular) {
    angular.module('cedar.templateEditor.service.arpService', [])
        .service('arpService', arpService);

    arpService.$inject = ["schemaService", "DataManipulationService"];

    function arpService( schemaService, DataManipulationService) {
        return {
            prepareResourceForMerge: prepareResourceForMerge,
            finalizeResourceForMerge: finalizeResourceForMerge,
            doMergeResource: doMergeResource
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
        
        function doMergeResource(resourceJson, originalResourceJson) {
            const mergedResourceJson = prepareResourceForMerge(originalResourceJson, resourceJson);
            return finalizeResourceForMerge(mergedResourceJson);
        }
        
        
        
    }
});