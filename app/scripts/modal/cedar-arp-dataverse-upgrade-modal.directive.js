'use strict';

define([
      'angular'
    ], function (angular) {
      angular.module('cedar.templateEditor.modal.cedarArpDataverseUpgradeModalDirective', [])
          .directive('cedarArpDataverseUpgradeModal', cedarArpDataverseUpgradeModalDirective);

      function cedarArpDataverseUpgradeModalDirective() {

        cedarArpDataverseUpgradeModalController.$inject = [
          '$scope',
          '$translate',
          'arpDataverseUpgradeService'
        ];

        function cedarArpDataverseUpgradeModalController($scope, $translate, arpDataverseUpgradeService) {
          var vm = this;
          const TEXTS = 'ARP.dataverseUpgrade.';
          vm.reports = [];

          vm.close = function () {
            if (vm.busy !== 'run') {
              vm.modalVisible = false;
            }
          };

          // A preview is only valid for the versions it was made with
          vm.inputChanged = function () {
            vm.previewed = false;
            vm.reports = [];
            vm.error = null;
          };

          vm.preview = async function () {
            begin('preview');
            try {
              const reports = await arpDataverseUpgradeService.preview(vm.folder['@id'], vm.currentVersion, targets());
              vm.reports = reports.map(toDisplay);
              vm.previewed = true;
            } catch (error) {
              showError(error);
            }
            end();
          };

          vm.run = async function () {
            const versions = [vm.currentVersion].concat(targets());
            begin('run');
            try {
              await arpDataverseUpgradeService.run(vm.folder, vm.currentVersion, targets(), showProgress);
              vm.finished = true;
            } catch (error) {
              showError(error);
              // Every report stands for one finished version, so this is the version the folder is at now
              vm.stopped = $translate.instant(TEXTS + 'stopped', {current: versions[vm.reports.length]});
            }
            vm.closed = true;
            $scope.$broadcast('refreshWorkspace', [vm.folder]);
            end();
          };

          function targets() {
            return (vm.targetVersions || '').split(/[\s,;]+/).filter(Boolean);
          }

          function begin(action) {
            vm.busy = action;
            vm.error = null;
            vm.progress = $translate.instant(TEXTS + 'step.' + action);
            if (action === 'run') {
              vm.reports = [];
              vm.reportTitle = TEXTS + 'runReport';
            } else {
              vm.reportTitle = TEXTS + 'previewReport';
            }
          }

          function end() {
            vm.busy = null;
            vm.progress = null;
            $scope.$applyAsync();
          }

          function showProgress(step, version, report) {
            if (report) {
              vm.reports.push(toDisplay(report));
            } else {
              vm.progress = $translate.instant(TEXTS + 'step.' + step, {version: version});
            }
            $scope.$applyAsync();
          }

          // The service explains its own errors. Backend errors were already shown by the failing call.
          function showError(error) {
            const key = error && error.messageKey ? error.messageKey : TEXTS + 'error.backend';
            vm.error = $translate.instant(key, (error && error.messageParams) || {});
          }

          // Turns the report of one version into the texts the modal shows
          function toDisplay(report) {
            return {
              version: report.version,
              missingTemplates: report.missingTemplates.join(', '),
              blocks: report.blocks.map(function (block) {
                return {
                  title: block.template + ' (' + block.block + ')',
                  updatedResources: block.updatedResources.join(', '),
                  sections: ['applied', 'keptArp', 'reportOnly'].map(function (section) {
                    return {title: TEXTS + 'section.' + section, lines: block[section].map(function (change) {
                      return describe(section, change, block.block);
                    })};
                  }).filter(function (section) {
                    return section.lines.length > 0;
                  })
                };
              })
            };
          }

          // A change at the top level of the template has no parent element: the block name is shown instead
          function describe(section, change, blockName) {
            const params = angular.extend({}, change, {parent: change.parent || blockName});
            return $translate.instant(TEXTS + 'change.' + section + '.' + change.kind, params);
          }

          $scope.$on('arpDataverseUpgradeModalVisible', function (event, params) {
            const folder = params[0];
            const start = params[1];
            vm.folder = folder;
            vm.folderName = folder['schema:name'];
            vm.startState = start.state;
            vm.currentVersion = start.currentVersion || '';
            vm.targetVersions = '';
            vm.reports = [];
            vm.previewed = false;
            vm.finished = false;
            vm.closed = false;
            vm.busy = null;
            vm.progress = null;
            vm.error = null;
            vm.stopped = null;
            vm.modalVisible = true;
          });
        }

        let directive = {
          bindToController: {
            modalVisible: '='
          },
          controller      : cedarArpDataverseUpgradeModalController,
          controllerAs    : 'upgrade',
          restrict        : 'E',
          templateUrl     : 'scripts/modal/cedar-arp-dataverse-upgrade-modal.directive.html'
        };

        return directive;
      }
    }
);
