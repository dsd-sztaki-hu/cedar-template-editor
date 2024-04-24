'use strict';

define([
      'angular',
      'cedar/template-editor/service/cedar-user',
    ], function (angular) {
      angular.module('cedar.templateEditor.modal.cedarMergeModalDirective', [
        'cedar.templateEditor.service.cedarUser'
      ]).directive('cedarMergeModal', cedarMergeModalDirective);

      cedarMergeModalDirective.$inject = ['CedarUser', "DataManipulationService", "TemplateService"];

      function cedarMergeModalDirective(CedarUser, DataManipulationService, TemplateService) {

        cedarMergeModalController.$inject = [
          '$scope',
          '$timeout',
          'resourceService',
          'UIMessageService',
          'AuthorizedBackendService'
        ];

        function cedarMergeModalController($scope,
                                           $timeout,
                                           resourceService,
                                           UIMessageService,
                                           AuthorizedBackendService) {
          
          var vm = this;

          vm.modalVisible = false;
          vm.mergeResource = null;
          vm.updateResource = updateResource;
          vm.postTemplates = postTemplates;
          vm.resetTemplates = resetTemplates;

          var dms = DataManipulationService;
          
          function updateResource() {
            var resource = vm.mergeResource;
            console.log('updateResourceeeeeeee');
            /*if (resource != null) {
              var id = resource['@id'];
              var type = resource.resourceType.toUpperCase();
              var name = resource['schema:name'];

              AuthorizedBackendService.doCall(
                  resourceService.mergeNode(id, name, null),
                  function (response) {
                    var title = dms.getTitle(response.data);
                    UIMessageService.flashSuccess('SERVER.' + type + '.update.success', {"title": title},
                        'GENERIC.Updated');
                    refresh();
                  },
                  function (err) {
                    UIMessageService.showBackendError('SERVER.' + type + '.update.error', err);
                  }
              );
            }*/
          }
          
          function postTemplates() {
            const iframe = document.getElementById('iframeId');
            iframe.contentWindow.postMessage(vm.mergeResource, 'http://localhost:5173');
          }
          
          function resetTemplates() {
              const iframe = document.getElementById('iframeId');
              iframe.contentWindow.postMessage({'before': {}, 'after': {}}, 'http://localhost:5173');
          }

          function refresh() {
            $scope.$broadcast('refreshWorkspace', [vm.mergeResource]);
          }

          // modal open or closed
          $scope.$on('mergeModalVisible', function (event, params) {

            const visible = params[0];
            const before = params[1];
            let after = params[2];
            vm.modalVisible = visible;

            AuthorizedBackendService.doCall(
                TemplateService.getTemplate(after["@id"]),
                function (response) {
                  // Assign returned form object from FormService to $scope.form
                  after = response.data;
                  dms.stripTmps(before);
                  dms.stripTmps(after);
                  vm.mergeResource = {
                    'before': before,
                    'after': after
                  };
                  console.log('mergeModalVisible!!!!!!!!!!!!!!');
                  postTemplates();
                },
                function (err) {
                  console.log('err', err);
                  const message = (err.data.errorKey === 'noReadAccessToArtifact') ? 'Whoa!' : $translate.instant('SERVER.TEMPLATE.load.error');

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
