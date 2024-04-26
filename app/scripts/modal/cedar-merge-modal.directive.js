'use strict';

define([
      'angular',
      'cedar/template-editor/service/cedar-user',
    ], function (angular) {
      angular.module('cedar.templateEditor.modal.cedarMergeModalDirective', [
        'cedar.templateEditor.service.cedarUser'
      ]).directive('cedarMergeModal', cedarMergeModalDirective);

      cedarMergeModalDirective.$inject = ['CedarUser', "DataManipulationService", "TemplateService", "TemplateElementService"];

      function cedarMergeModalDirective(CedarUser, DataManipulationService, TemplateService, TemplateElementService) {

        cedarMergeModalController.$inject = [
          '$scope',
          '$timeout',
          'resourceService',
          'UIMessageService',
          'AuthorizedBackendService',
          "$translate", 
          "schemaService", 
          "ValidationService"
        ];

        function cedarMergeModalController($scope,
                                           $timeout,
                                           resourceService,
                                           UIMessageService,
                                           AuthorizedBackendService,
                                           $translate,
                                           schemaService,
                                           ValidationService) {
            
          const vm = this;

          vm.modalVisible = false;
          vm.mergeResource = null;
          vm.mergeResult = null;
          vm.mergeResourceType = null;
          vm.mergeResources = mergeResources;
          vm.postTemplates = postTemplates;
          vm.resetTemplates = resetTemplates;

          const dms = DataManipulationService;
          
          function mergeResources() {
              saveMergedResource(vm.mergeResult);
          }

          const find = (object, key, value) => {
                if (!object || typeof object !== 'object') return;
                if (object[key] === value) return object;
                let result;
                Object.values(object).some(o => result = find(o, key, value));
                return result;
          };

          // prepare the resource for merge
          // keep the original "pav:createdOn" values and the original "@id" values
          function prepareResourceForMerge(resourceJson) {

            if (Array.isArray(resourceJson)) {
                return resourceJson.map(element => prepareResourceForMerge(element));
            }

            else if (resourceJson !== null && typeof resourceJson === 'object') {
                // If the object has an "id" and "pav:derivedFrom" property, replace "id" with "pav:derivedFrom"
                if (resourceJson.hasOwnProperty('pav:derivedFrom') && typeof resourceJson['pav:derivedFrom'] === 'string') {
                    resourceJson['@id'] = resourceJson['pav:derivedFrom'];
                    delete resourceJson['pav:derivedFrom'];
                }
                // If the object has a "pav:createdOn" property, replace "pav:createdOn" with the original "pav:createdOn"
                if (resourceJson.hasOwnProperty('pav:createdOn') && typeof resourceJson['pav:createdOn'] === 'string') {
                    const originalObject = find(vm.mergeResource.before, '@id', resourceJson['@id']);
                    if (originalObject) {
                        resourceJson['pav:createdOn'] = originalObject['pav:createdOn'];
                    }
                }
                
                const values = Object.values(resourceJson);
                values.forEach(value => {
                    if (typeof value === 'object') {
                        return prepareResourceForMerge(value);
                    }
                });
            }

            return resourceJson;
          }
          
          function postTemplates(templates) {
            const iframe = document.getElementById('iframeId');
            iframe.contentWindow.postMessage(templates, 'http://localhost:5173');
          }
          
          function resetTemplates() {
              const iframe = document.getElementById('iframeId');
              iframe.contentWindow.postMessage({'before': {}, 'after': {}}, 'http://localhost:5173');
          }

          function refresh() {
            $scope.$broadcast('refreshWorkspace', [vm.mergeResource]);
          }
          
          function saveMergedResource(mergedTemplate) {
              const doUpdate = function (response) {
                  ValidationService.logValidation(response.headers("CEDAR-Validation-Status"));

                  UIMessageService.flashSuccess('ARP.merge.success',
                      {"resourceType": vm.mergeResourceType, "title": schemaService.getTitle(vm.mergeResult)}, 'ARP.GENERIC.Merged');
              };
              
              // If maxItems is N, then remove maxItems
              schemaService.removeUnnecessaryMaxItems(mergedTemplate);
              schemaService.defaultSchemaTitleAndDescription(mergedTemplate);

              const id = mergedTemplate['@id'];
              dms.updateKeys(mergedTemplate);
              const copiedForm = jQuery.extend(true, {}, mergedTemplate);
              if (copiedForm) {
                  // strip the temps from the copied form only, and save the copy
                  dms.stripTmps(copiedForm);
                  
                  let mergePromise;
                  if (vm.mergeResourceType === 'template') {
                    mergePromise = TemplateService.updateTemplate(id, copiedForm);
                  } else if (vm.mergeResourceType === 'element') {
                    mergePromise = TemplateElementService.updateTemplateElement(id, copiedForm);
                  }
                  
                  AuthorizedBackendService.doCall(
                      mergePromise,
                      function (response) {
                          doUpdate(response);
                      },
                      function (err) {
                          UIMessageService.showBackendError('ARP.merge.error', err);
                      }
                  );
              }
          }

          // modal open or closed
          $scope.$on('mergeModalVisible', function (event, params) {

            const updatedResource = params[0];
            const resourceType = params[1];
            const originalResourceId = updatedResource['pav:derivedFrom']
            let promise;
    
            if (resourceType === 'template') {
              promise = TemplateService.getTemplate(originalResourceId);
              vm.mergeResourceType = 'template';
            } else if (resourceType === 'element') {
              promise = TemplateElementService.getTemplateElement(originalResourceId);
              vm.mergeResourceType = 'element';
            } else {
              // Invalid resource type
            }
            
            AuthorizedBackendService.doCall(
                promise,
                function (response) {
                  const originalResource = response.data;
                  dms.stripTmps(originalResource);
                  dms.stripTmps(updatedResource);
                  vm.mergeResource = {
                    'before': originalResource,
                    'after': updatedResource
                  };
                  vm.modalVisible = true;
                  // replace the ids in the updated resource with the ids in the original resource
                  // and then post the templates to the iframe
                  // create a copy of the updated resource
                  const updatedResourceCopy = JSON.parse(JSON.stringify(updatedResource));
                  vm.mergeResult = prepareResourceForMerge(updatedResourceCopy); 
                  postTemplates({
                      'before': originalResource,
                      'after': vm.mergeResult
                  });
                },
                function (err) {
                  console.log('err', err);
                  const message = (err.data.errorKey === 'noReadAccessToArtifact') ? 'Whoa!' : $translate.instant('SERVER.TEMPLATE.load.error');
                  vm.modalVisible = false;
                  UIMessageService.acknowledgedExecution(
                      function () {
                        $timeout(function () {
                          $rootScope.goToHome();
                        });
                      },
                      'GENERIC.Warning',
                      message,
                      'GENERIC.Ok');
                });
          });
        }

        let directive = {
          bindToController: {
            mergeResource: '=',
            modalVisible  : '='
          },
          controller      : cedarMergeModalController,
          controllerAs    : 'merge',
          restrict        : 'E',
          templateUrl     : 'scripts/modal/cedar-merge-modal.directive.html'
        };

        return directive;

      }
    }
);
