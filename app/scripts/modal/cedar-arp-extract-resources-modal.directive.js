'use strict';

define([
      'angular',
      'cedar/template-editor/service/cedar-user',
    ], function (angular) {
      angular.module('cedar.templateEditor.modal.cedarArpExtractResourcesModalDirective', [
        'cedar.templateEditor.service.cedarUser'
      ]).directive('cedarArpExtractResourcesModal', cedarArpExtractResourcesModalDirective);

      cedarArpExtractResourcesModalDirective.$inject = ['CedarUser'];

      function cedarArpExtractResourcesModalDirective(CedarUser) {

        cedarArpExtractResourcesModalController.$inject = [
          '$scope',
          '$uibModal',
          'CedarUser',
          '$timeout',
          '$translate',
          'resourceService',
          'UIMessageService',
          'UISettingsService',
          'CONST',
          'TemplateService',
          'TemplateElementService',
          'AuthorizedBackendService',
          'ValidationService',
          'arpService',
          'FrontendUrlService',
          '$location'
        ];

        function cedarArpExtractResourcesModalController($scope, $uibModal, CedarUser, $timeout, $translate,
                                             resourceService,
                                             UIMessageService,UISettingsService,
                                             CONST, TemplateService, TemplateElementService, AuthorizedBackendService,
                                             ValidationService, arpService, FrontendUrlService, $location) {
          const vm = this;

          vm.extractResources = extractResources;
          vm.hideModal = hideModal;
          vm.extractOption = 'templateElementsAndFields';

          function hideModal() {
            vm.modalVisible = false;
          }
          
          async function extractResources() {
            UIMessageService.flashSuccess('ARP.extractResources.started');
            const resourceType = vm.arpExtractResourcesResource['resourceType'];
            const resourceJson = await arpService.getResourceContentById(vm.arpExtractResourcesResource['@id'], resourceType);
            const cedarParams = {
              apiKey: vm.apiKey,
              folderId: resourceType === "template" ? vm.currentFolderId : vm.parentFolderId,
            }

            AuthorizedBackendService.doCall(
                arpService.extractResources(resourceJson, cedarParams, vm.extractOption),
                function (response) {
                  UIMessageService.flashSuccess('ARP.extractResources.success');
                  $scope.$broadcast('refreshWorkspace', [vm.currentFolderId]);
                },
                function (err) {
                  UIMessageService.showBackendError('ARP.extractResources.error', err);
                }
            );
          }

          // modal open or closed
          $scope.$on('arpExtractResourcesModalVisible', async function (event, params) {
            const resource = params[0];
            const currentFolderId = params[1];
            const parentFolderId = params[2];
            const apiKey = params[3];

            if (resource) {
              vm.modalVisible = true;
              vm.arpExtractResourcesResource = resource;
              vm.currentFolderId = currentFolderId;
              vm.parentFolderId = parentFolderId;
              vm.apiKey = apiKey;
            }
          });
        }

        return {
          bindToController: {
            arpExtractResourcesResource: '=',
            modalVisible: '='
          },
          controller      : cedarArpExtractResourcesModalController,
          controllerAs    : 'arpextractresources',
          restrict        : 'E',
          templateUrl     : 'scripts/modal/cedar-arp-extract-resources-modal.directive.html'
        };

      }
    }
);
