'use strict';

define([
    'angular'
], function (angular) {
    angular.module('cedar.templateEditor.modal.cedarDtrImportModalDirective', []).directive('cedarDtrImportModal',
        cedarDtrImportModalDirective);


    function cedarDtrImportModalDirective() {


        cedarDtrImportModalController.$inject = [
            '$scope',
            '$rootScope',
            '$timeout',
            'QueryParamUtilsService',
            'UISettingsService',
            'UIMessageService',
            'resourceService',
            'TemplateInstanceService',
            'AuthorizedBackendService',
            'UrlService',
            'ImportService',
            'arpService'
        ];

        function cedarDtrImportModalController($scope, $rootScope, $timeout, QueryParamUtilsService, UISettingsService,
                                               UIMessageService, resourceService, TemplateInstanceService,
                                               AuthorizedBackendService,
                                               UrlService, ImportService, arpService) {

            let vm = this;
            
            vm.isImporting = false;
            vm.importResult = null;
            vm.dtrInput = '';
            vm.destinationFolderId = null;
            
            /**
             * Public functions
             */
            vm.getImportUrl = getImportUrl;
            vm.startUpload = startUpload;
            vm.resetModal = resetModal;

            function startUpload() {
                if (!vm.dtrInput || vm.dtrInput.trim() === '') {
                    vm.importResult = {
                        success: false,
                        message: 'Please enter DTR Resource ID'
                    };
                    return;
                }

                vm.isImporting = true;
                vm.importResult = null;

                arpService.importDtrResource(vm.dtrInput, vm.destinationFolderId).then(function (response) {
                    vm.isImporting = false;
                    vm.importResult = {
                        success: true,
                        message: 'DTR data imported successfully'
                    };
                    $scope.$broadcast('refreshWorkspace', [vm.destinationFolderId]);
                }, function (error) {
                    vm.isImporting = false;
                    vm.importResult = {
                        success: false,
                        message: 'DTR data import failed'
                    };
                });
            }

            function resetModal() {
                vm.dtrInput = '';
                vm.isImporting = false;
                vm.importResult = null;
            }

            function getImportUrl(folderId) {
                console.log('getImportUrl', folderId);
            }

            $scope.$on('dtrImportModalVisible', function (event, params) {
                vm.destinationFolderId = params[0];
                console.log('dtrImportModalVisible', vm.destinationFolderId);
            });
        }

        return {
            bindToController: {
                modalVisible: '=',
                importFolderId: '=',
                refreshWorkspace: '='
            },
            controller: cedarDtrImportModalController,
            controllerAs: 'dtrimport',
            restrict: 'E',
            templateUrl: 'scripts/modal/cedar-dtr-import-modal.directive.html'
        };
    }
});

