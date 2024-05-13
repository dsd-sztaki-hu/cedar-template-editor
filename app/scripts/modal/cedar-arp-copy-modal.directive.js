'use strict';

define([
      'angular',
      'cedar/template-editor/service/cedar-user',
    ], function (angular) {
      angular.module('cedar.templateEditor.modal.cedarArpCopyModalDirective', [
        'cedar.templateEditor.service.cedarUser'
      ]).directive('cedarArpCopyModal', cedarArpCopyModalDirective);

  cedarArpCopyModalDirective.$inject = ['CedarUser'];

      function cedarArpCopyModalDirective(CedarUser) {

        cedarArpCopyModalController.$inject = [
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
          'ValidationService'
        ];

        function cedarArpCopyModalController($scope, $uibModal, CedarUser, $timeout, $translate,
                                          resourceService,
                                          UIMessageService,UISettingsService,
                                          CONST, TemplateService, TemplateElementService, AuthorizedBackendService,
                                             ValidationService) {
          var vm = this;

          // copy to...
          vm.openHome = openHome;
          vm.openSpecialFolders = openSpecialFolders;
          vm.getNextOffset = getNextOffset;
          vm.openParent = openParent;
          vm.currentTitle = currentTitle;
          vm.parentTitle = parentTitle;
          vm.selectCurrent = selectCurrent;
          vm.selectDestination = selectDestination;
          vm.isDestinationSelected = isDestinationSelected;
          vm.copyDisabled = copyDisabled;
          vm.updateResource = updateResource;
          vm.recursiveCopyResource = recursiveCopyResource;
          vm.openDestination = openDestination;
          vm.getResourceIconClass = getResourceIconClass;
          vm.loadMore = loadMore;
          vm.isFolder = isFolder;
          vm.canWrite = canWrite;
          vm.hideModal = hideModal;
          vm.selectedDestination = null;
          vm.currentDestination = null;

          vm.currentDestinationID = null;
          vm.destinationPathInfo = null;
          vm.destinationPath = null;
          vm.resourceTypes = null;
          vm.sortOptionField = null;
          vm.offset = 0;
          vm.totalCount = -1;
          vm.isCommunity = false;
          $scope.destinationResources = [];

          function canWrite() {
            return hasPermission('canWrite');
          }

          function hasPermission(permission, resource) {
            const node = resource;
            if (node != null) {
              const perms = node.currentUserPermissions;
              if (perms != null) {
                return perms[permission];
              }
            }
            return false;
          }

          function openHome() {
            vm.offset = 0;
            vm.isCommunity = false;
            getDestinationById(vm.homeFolderId);
          }

          function openParent() {
            vm.offset = 0;
            const length = vm.destinationPathInfo.length;
            const parent = vm.destinationPathInfo[length - 1];
            openDestination(parent);
          }

          function parentTitle() {
            let result = '';
            if (vm.destinationPathInfo && vm.destinationPathInfo.length > 1) {

              const length = vm.destinationPathInfo.length;
              const parent = vm.destinationPathInfo[length - 1];
              result = parent['schema:name'];

            }
            return result;
          }

          function updateResource() {

            if (vm.selectedDestination) {
              const folderId = vm.selectedDestination['@id'];

              if (vm.arpCopyResource) {
                const resource = vm.arpCopyResource;
                let newTitle = resource['schema:name'];
                const sameFolder = vm.currentFolderId === folderId;
                if (sameFolder) {
                  newTitle = $translate.instant('GENERIC.CopyOfTitle', {"title": resource['schema:name']});
                }

                resourceService.copyResource(
                    resource,
                    folderId,
                    newTitle,
                    function (response) {

                      UIMessageService.flashSuccess('SERVER.RESOURCE.copyToResource.success', {"title": resource['schema:name']},
                          'GENERIC.Copied');

                      if (sameFolder) {
                        refresh();
                      }

                    },
                    function (response) {
                      UIMessageService.showBackendError('SERVER.RESOURCE.copyToResource.error', response);
                    }
                );
              }
            }
          }
          
          function recursiveCopyResource(arpCopyResource) {
            if (vm.selectedDestination) {
              const newParentFolderId = vm.selectedDestination['@id'];
              if (vm.arpCopyResource) {
                const resource = vm.arpCopyResource;
                let newFolderName = resource['schema:name'];
                const sameFolder = vm.currentFolderId === newParentFolderId;
                if (sameFolder) {
                  newFolderName = $translate.instant('ARP.GENERIC.CopyOfTitle', {"title": resource['schema:name']});
                }
                resourceService.createFolder(
                    newParentFolderId,
                    newFolderName,
                    resource['schema:description'],
                    function (response) {
                      const newFolderId = response['@id'];
                      copyRecursively(resource, newFolderId, arpCopyResource['@id']);
                      refresh();
                    },
                    function (error) {
                      UIMessageService.showBackendError('ARP.copy.error', error);
                    }
                );
              }
            }
          }

          function copyRecursively(resourceToCopy, newFolderId, arpOriginalFolderId) {
            getFolderContentsByFolderId(resourceToCopy['@id'])
                .then(response => {
                  const responseArray = Array.isArray(response) ? response : [response];
                  responseArray.forEach(resource => {
                    if (resource['resourceType'] === CONST.resourceType.FOLDER) {
                      resourceService.createFolder(
                          newFolderId,
                          resource['schema:name'],
                          resource['schema:description'],
                          function (response) {
                            const newFolderId = response['@id'];
                            copyRecursively(resource, newFolderId, resource['@id']);
                          },
                          function (error) {
                            UIMessageService.showBackendError('SERVER.FOLDER.create.error', error);
                          }
                      );
                    } else if ([CONST.resourceType.TEMPLATE, CONST.resourceType.ELEMENT].includes(resource['resourceType'])) {
                      resourceService.copyResource(
                          resource,
                          newFolderId,
                          resource['schema:name'],
                          function (response) {
                            saveOriginalFolderId(response, arpOriginalFolderId);
                          },
                          function (error) {
                            UIMessageService.showBackendError('SERVER.RESOURCE.copyToResource.error', error);
                          }
                      );
                    }
                  });
                })
                .catch(error => {
                  UIMessageService.showBackendError('ARP.copy.error', error);
                });
          }
          
          function saveOriginalFolderId(resource, originalFolderId) {

            const doUpdate = function (response) {
              ValidationService.logValidation(response.headers("CEDAR-Validation-Status"));
            };
            
            resource['_arpOriginalFolderId_'] = originalFolderId;
            let mergePromise;
            const resourceType = getContentType(resource);
            if (resourceType === CONST.resourceType.TEMPLATE) {
              mergePromise = TemplateService.updateTemplate(resource['@id'], resource);
            } else if (resourceType === CONST.resourceType.ELEMENT) {
              mergePromise = TemplateElementService.updateTemplateElement(resource['@id'], resource);
            }

            AuthorizedBackendService.doCall(
                mergePromise,
                function (response) {doUpdate(response)},
                function (err) {
                  UIMessageService.showBackendError('ARP.merge.originalFolderIdError', err);
                }
            );
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

          function getFolderContentsByFolderId(folderId) {
            return new Promise((resolve, reject) => {
              let resourceTypes = activeResourceTypes();
              let limit = UISettingsService.getRequestLimit();
              let offset = 0;
              resourceService.getResources({
                    folderId         : folderId,
                    resourceTypes    : resourceTypes,
                    sort             : sortField(),
                    limit            : limit,
                    offset           : offset,
                    version          : getFilterVersion(),
                    publicationStatus: getFilterStatus()
                  },
                  function (response) {
                    resolve(response.resources); // Resolve the promise with the response data
                  },
                  function (error) {
                    reject(error); // Reject the promise with the error
                    UIMessageService.showBackendError('SERVER.FOLDER.load.error', error);
                  });
            });
          }

          function getFilterVersion() {
            return CedarUser.getVersion();
          };

          function getFilterStatus() {
            return CedarUser.getStatus();
          };

          function refresh() {
            $scope.$broadcast('refreshWorkspace', [vm.arpCopyResource]);
          }

          function currentTitle() {
            return vm.currentDestination ? vm.currentDestination['schema:name'] : '';
          }

          function selectDestination(resource) {
            vm.selectedDestination = resource;
          }

          function selectCurrent() {
            vm.selectedDestination = vm.currentDestination;
          }

          function openDestination(resource) {
            vm.isCommunity = false;
            if (resource) {
              const id = resource['@id'];
              vm.offset = 0;
              getDestinationById(id);
              vm.selectedDestination = resource;
              vm.currentDestination = resource;
            }
          }

          function copyDisabled() {
            return vm.selectedDestination == null;
          }

          function isDestinationSelected(resource) {
            if (resource == null || vm.selectedDestination == null) {
              return false;
            } else {
              return (vm.selectedDestination['@id'] === resource['@id']);
            }
          }

          function sortField() {
            if (vm.sortOptionField === 'name') {
              return 'name';
            } else {
              return '-' + vm.sortOptionField;
            }
          }

          // callback to load more resources for the current folder or search
          function loadMore() {
            if ( vm.modalVisible) {
              vm.offset += UISettingsService.getRequestLimit();
              if (vm.offset < vm.totalCount) {
                getDestinationById(vm.currentDestinationID);
              }
            }
          }

          function getDestinationById(folderId) {
            if (folderId) {
              const limit = UISettingsService.getRequestLimit();
              const offset = vm.offset;
              const resourceTypes = activeResourceTypes();
              if (resourceTypes.length > 0) {
                return resourceService.getResources(
                    {folderId: folderId, resourceTypes: resourceTypes, sort: sortField(), limit: limit, offset: offset},
                    function (response) {
                      vm.totalCount = response.totalCount;
                      vm.currentDestinationID = folderId;
                      if (vm.offset > 0) {
                        $scope.destinationResources = $scope.destinationResources.concat(response.resources);
                      } else {
                        $scope.destinationResources = response.resources;
                      }

                      const resource = response.pathInfo[response.pathInfo.length - 1];
                      vm.selectedDestination = resource;
                      vm.currentDestination = resource;
                      vm.destinationPathInfo = response.pathInfo;
                      //vm.destinationPath = vm.destinationPathInfo.pop();

                    },
                    function (error) {
                      UIMessageService.showBackendError('SERVER.FOLDER.load.error', error);
                    }
                );
              } else {
                $scope.destinationResources = [];
              }
            }
          }

          function openSpecialFolders() {

            vm.isCommunity = true;

            vm.totalCount = -1;
            vm.offset = 0;
            vm.nextOffset = null;

            const limit = UISettingsService.getRequestLimit();
            const offset = vm.offset;
            const resourceTypes = activeResourceTypes();

            if (resourceTypes.length > 0) {

              resourceService.specialFolders(
                  {
                    resourceTypes: resourceTypes,
                    sort         : sortField(),
                    limit        : limit,
                    offset       : offset
                  },
                  function (response) {

                    if (vm.offset > 0) {
                      $scope.destinationResources = $scope.destinationResources.concat(response.resources);
                    } else {
                      $scope.destinationResources = response.resources;
                    }


                    vm.isSearching = true;
                    vm.nodeListQueryType = response.nodeListQueryType;
                    vm.breadcrumbTitle = $translate.instant("BreadcrumbTitle.specialFolders");
                    vm.nextOffset = getNextOffset(response.paging.next);
                    vm.totalCount = response.totalCount;
                    vm.loading = false;

                  },
                  function (error) {
                    UIMessageService.showBackendError('SERVER.SEARCH.error', error);
                  }
              );
            } else {
              $scope.destinationResources = [];
            }
          }

          function getNextOffset(next) {
            let result = null;
            if (next) {
              result = [];
              next.split("&").forEach(function (part) {
                let item = part.split("=");
                result[item[0]] = decodeURIComponent(item[1]);
              });
              result = parseInt(result['offset']);
            }
            return result;
          }

          function activeResourceTypes() {
            return ['element', 'field', 'folder', 'template'];
          }

          function getResourceIconClass(resource) {
            let result = "";
            if (resource) {
              result += resource.resourceType + " ";

              switch (resource.resourceType) {
                case CONST.resourceType.FOLDER:
                  result += "fa-folder";
                  break;
                case CONST.resourceType.TEMPLATE:
                  result += "fa-file-text";
                  break;
                case CONST.resourceType.INSTANCE:
                  result += "fa-tag";
                  break;
                case CONST.resourceType.ELEMENT:
                  result += "fa-sitemap";
                  break;
                case CONST.resourceType.FIELD:
                  result += "fa-file-code-o";
                  break;
                  //result += "fa-sitemap";
                  //break;
              }
            }
            return result;
          }

          function isFolder(resource) {
            let result = false;
            if (resource) {
              result = (resource.resourceType === CONST.resourceType.FOLDER);
            }
            return result;
          }

          // on modal close, scroll to the top the cheap way
          function hideModal() {
            document.getElementById('arpCopyModalContent').scrollTop = 0;
            vm.modalVisible = false;
          }

          // modal open or closed
          $scope.$on('arpCopyModalVisible', function (event, params) {

            const visible = params[0];
            const resource = params[1];
            const currentPath = params[2];
            const currentFolderId = params[3];
            const homeFolderId = params[4];
            const resourceTypes = params[5];
            const sortOptionField = params[6];

            if (visible && resource) {
              vm.modalVisible = visible;
              vm.arpCopyResource = resource;
              vm.currentPath = currentPath;
              vm.currentFolderId = currentFolderId;
              vm.homeFolderId = homeFolderId;
              vm.currentDestination = vm.currentPath;
              vm.resourceTypes = resourceTypes;
              vm.sortOptionField = sortOptionField;
              vm.selectedDestination = null;
              vm.offset = 0;
              // TODO scroll to top
              getDestinationById(vm.currentFolderId);
            }
          });
        }

        return {
          bindToController: {
            arpCopyResource: '=',
            modalVisible: '='
          },
          controller      : cedarArpCopyModalController,
          controllerAs    : 'arpcopyto',
          restrict        : 'E',
          templateUrl     : 'scripts/modal/cedar-arp-copy-modal.directive.html'
        };

      }
    }
);
