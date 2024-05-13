'use strict';

define([
      'angular',
      'cedar/template-editor/service/cedar-user',
    ], function (angular) {
      angular.module('cedar.templateEditor.modal.cedarArpMergeModalDirective', [
        'cedar.templateEditor.service.cedarUser'
      ]).directive('cedarArpMergeModal', cedarArpMergeModalDirective);

      cedarArpMergeModalDirective.$inject = ['CedarUser', "DataManipulationService", "TemplateService", "TemplateElementService"];

      function cedarArpMergeModalDirective(CedarUser, DataManipulationService, TemplateService, TemplateElementService) {

        cedarArpMergeModalController.$inject = [
          '$scope',
          '$timeout',
          'resourceService',
          'UIMessageService',
          'AuthorizedBackendService',
          "$translate", 
          "schemaService", 
          "ValidationService", 
          "CONST",
          "arpService"
        ];

        function cedarArpMergeModalController($scope,
                                           $timeout,
                                           resourceService,
                                           UIMessageService,
                                           AuthorizedBackendService,
                                           $translate,
                                           schemaService,
                                           ValidationService,
                                           CONST,
                                           arpService) {
            
          const vm = this;

          vm.modalVisible = false;
          vm.mergeResource = null;
          vm.mergeResult = null;
          vm.mergeResourceType = null;
          vm.mergeResources = mergeResources;
          vm.postTemplates = postTemplates;
          vm.resetTemplates = resetTemplates;
          vm.elementMerge = elementMerge;
          vm.templateMerge = templateMerge;
          vm.hideModal = hideModal;

          const dms = DataManipulationService;
          
          function elementMerge() {
              return vm.mergeResourceType === CONST.resourceType.ELEMENT;
          }

            function templateMerge() {
                return vm.mergeResourceType === CONST.resourceType.TEMPLATE;
            }
          function mergeResources() {
              saveMergedResource(vm.mergeResult);
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
          
          function hideModal() {
            vm.modalVisible = false;
          }
          
          function saveMergedResource(mergedResource) {
              const doUpdate = function (response) {
                  ValidationService.logValidation(response.headers("CEDAR-Validation-Status"));

                  UIMessageService.flashSuccess('ARP.merge.success',
                      {"resourceType": vm.mergeResourceType, "title": schemaService.getTitle(vm.mergeResult)}, 'ARP.GENERIC.Merged');
              };
              
              const finalizedResource = arpService.finalizeResourceForMerge(mergedResource);
              const id = mergedResource['@id'];
              let mergePromise;
              if (vm.mergeResourceType === CONST.resourceType.TEMPLATE) {
                mergePromise = TemplateService.updateTemplate(id, finalizedResource);
              } else if (vm.mergeResourceType === CONST.resourceType.ELEMENT) {
                mergePromise = TemplateElementService.updateTemplateElement(id, finalizedResource);
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

          // modal open or closed
          $scope.$on('arpMergeModalVisible', function (event, params) {
            const updatedResource = params[0];
            const resourceType = params[1];
            if (resourceType === CONST.resourceType.TEMPLATE) {
                const originalRes = updatedResource.original;
                const updatedRes = updatedResource.updated;
                dms.stripTmps(updatedRes);
                dms.stripTmps(originalRes);
                postTemplates({
                    'before': originalRes,
                    'after': updatedRes
                });
            } else if (resourceType === CONST.resourceType.ELEMENT) {
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
                        vm.mergeResult = arpService.prepareResourceForMerge(vm.mergeResource.before, updatedResourceCopy);
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
            }
            
          });
        }

        let directive = {
          bindToController: {
            mergeResource: '=',
            modalVisible  : '='
          },
          controller      : cedarArpMergeModalController,
          controllerAs    : 'merge',
          restrict        : 'E',
          templateUrl     : 'scripts/modal/cedar-arp-merge-modal.directive.html'
        };

        return directive;

      }
    }
);
