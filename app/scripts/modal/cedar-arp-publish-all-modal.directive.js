'use strict';

define([
      'angular'
    ], function (angular) {
      angular.module('cedar.templateEditor.modal.cedarArpPublishAllModalDirective', [])
          .directive('cedarArpPublishAllModal', cedarArpPublishAllModalDirective);

      function cedarArpPublishAllModalDirective() {

        cedarArpPublishAllModalController.$inject = [
          '$scope',
          'arpService',
          'UIMessageService'
        ];

        function cedarArpPublishAllModalController($scope, arpService, UIMessageService) {
          var vm = this;
          vm.parts = [0, 0, 1];
          vm.min = 1;
          vm.publishing = false;
          vm.folderName = '';
          vm.mode = 'publish';
          vm.publishedResources = [];

          vm.cancel = function () {
            vm.modalVisible = false;
          };

          vm.confirm = function () {
            if (vm.publishing || !vm.resources) {
              return;
            }
            vm.publishing = true;
            const version = vm.getVersionString();
            const folder = vm.folder;
            arpService.publishAll(vm.resources, version).then(function () {
              vm.publishing = false;
              vm.modalVisible = false;
              UIMessageService.flashSuccess('ARP.publishAll.success', {
                folderName: folder['schema:name'],
                version: version
              }, 'GENERIC.Published');
              $scope.$broadcast('refreshWorkspace', [folder]);
              $scope.$applyAsync();
            }, function () {
              vm.publishing = false;
              vm.modalVisible = false;
              $scope.$applyAsync();
            });
          };

          var getTotal = function (parts) {
            if (parts.length == 3) {
              return parts[0] * 1000000 + parts[1] * 1000 + parts[2];
            }
          };

          vm.canIncrement = function (index) {
            return vm.parts && (vm.parts.length > index) && parseInt(vm.parts[index], 10) < 1000;
          };

          vm.canDecrement = function (index) {
            if (vm.parts && vm.parts.length > index && parseInt(vm.parts[index], 10) > 0) {
              var value = vm.parts.slice();
              value[index] = parseInt(value[index], 10) - 1;
              return (getTotal(value) >= vm.min);
            }
          };

          vm.increment = function (index) {
            if (vm.parts && vm.parts.length > index) {
              var current = parseInt(vm.parts[index], 10) || 0;
              vm.parts[index] = current < 1000 ? current + 1 : current;
              for (var i = index + 1; i < vm.parts.length; i++) {
                vm.parts[i] = 0;
              }
            }
          };

          vm.decrement = function (index) {
            if (vm.parts && vm.parts.length > index) {
              var current = parseInt(vm.parts[index], 10) || 0;
              vm.parts[index] = current > 0 ? current - 1 : 0;
              if (getTotal(vm.parts) < vm.min) {
                vm.parts[index]++;
              }
            }
          };

          vm.change = function (index, newValue, oldValue) {
            var value;
            if (isNaN(parseInt(newValue))) {
              value = parseInt(oldValue);
            } else {
              value = parseInt(newValue);
            }

            vm.parts[index] = value;
            if (getTotal(vm.parts) < vm.min) {
              vm.parts[index] = oldValue;
            }
          };

          vm.getVersionString = function () {
            if (vm.parts && vm.parts.length == 3) {
              return vm.parts[0] + '.' + vm.parts[1] + '.' + vm.parts[2];
            }
            return '0.0.1';
          };

          $scope.$on('arpPublishAllModalVisible', function (event, params) {
            var folder = params[0];
            var resources = params[1];
            var minimumVersion = params[2];
            if (folder && resources && resources.length) {
              vm.mode = 'publish';
              vm.folder = folder;
              vm.resources = resources;
              vm.publishedResources = [];
              vm.folderName = folder['schema:name'];
              vm.parts = (minimumVersion && minimumVersion.length === 3) ? minimumVersion.slice() : [0, 0, 1];
              vm.min = getTotal(vm.parts);
              vm.publishing = false;
              vm.modalVisible = true;
            }
          });

          $scope.$on('arpPublishAllBlockedModalVisible', function (event, params) {
            var folder = params[0];
            var publishedResources = params[1];
            if (folder) {
              vm.mode = 'blocked';
              vm.folder = folder;
              vm.folderName = folder['schema:name'];
              vm.publishedResources = publishedResources || [];
              vm.publishing = false;
              vm.modalVisible = true;
            }
          });
        }

        let directive = {
          bindToController: {
            modalVisible: '='
          },
          controller      : cedarArpPublishAllModalController,
          controllerAs    : 'publishAll',
          restrict        : 'E',
          templateUrl     : 'scripts/modal/cedar-arp-publish-all-modal.directive.html'
        };

        return directive;
      }
    }
);
