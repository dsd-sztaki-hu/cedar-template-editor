'use strict';

define([
      'angular',
      'cedar/template-editor/service/cedar-user',
    ], function (angular) {
      angular.module('cedar.templateEditor.modal.cedarArpZipDownloadModalDirective', [
        'cedar.templateEditor.service.cedarUser'
      ]).directive('cedarArpZipDownloadModal', cedarArpZipDownloadModalDirective);

      cedarArpZipDownloadModalDirective.$inject = ['CedarUser'];

      function cedarArpZipDownloadModalDirective(CedarUser) {

        cedarArpZipDownloadModalController.$inject = [
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

        function cedarArpZipDownloadModalController($scope, $uibModal, CedarUser, $timeout, $translate,
                                             resourceService,
                                             UIMessageService,UISettingsService,
                                             CONST, TemplateService, TemplateElementService, AuthorizedBackendService,
                                             ValidationService, arpService, FrontendUrlService, $location) {
          const vm = this;

          vm.openSpecialFolders = openSpecialFolders;
          vm.getNextOffset = getNextOffset;
          vm.currentTitle = currentTitle;
          vm.parentTitle = parentTitle;
          vm.selectResource = selectResource;
          vm.openDestination = openDestination;
          vm.getResourceIconClass = getResourceIconClass;
          vm.loadMore = loadMore;
          vm.isFolder = isFolder;
          vm.hideModal = hideModal;
          vm.downloadZip = downloadZip;
          vm.selectedDestination = null;
          vm.currentDestination = null;

          vm.currentDestinationID = null;
          vm.destinationPathInfo = null;
          vm.destinationPath = null;
          vm.resourceTypes = null;
          vm.sortOptionField = null;
          vm.isAdmin = null;
          vm.offset = 0;
          vm.totalCount = -1;
          vm.isCommunity = false;
          $scope.destinationResources = [];
          vm.zipDownloadCache = new Map();
          vm.zipFolderPath = null;
          
          function downloadZip() {
            UIMessageService.flashSuccess('ARP.zipDownload.status.message', {}, 'ARP.zipDownload.status.title');
            arpService.downloadZip(vm.zipDownloadCache, vm.arpZipDownloadResource['schema:name']);
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

          function currentTitle() {
            return vm.currentDestination ? vm.currentDestination['schema:name'] : '';
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
          
          async function selectResource(resource) {
            const alreadyCached = vm.zipDownloadCache.has(resource['@id'])
            let parentFolderId;
            if (alreadyCached) {
              const cachedResource = vm.zipDownloadCache.get(resource['@id']);
              parentFolderId = cachedResource['parentFolderId'];
              if (cachedResource['resourceType'] !== CONST.resourceType.FOLDER) {
                vm.zipDownloadCache.delete(resource['@id']);
              }
            } else {
              cacheResource(resource['@id'], resource['resourceType'], 'checked', vm.zipFolderPath);
              parentFolderId = vm.currentDestinationID;
            }
            if (resource['resourceType'] === CONST.resourceType.FOLDER) {
              if (alreadyCached) {
                if (vm.zipDownloadCache.get(resource['@id'])['status'] === 'indeterminate') {
                  cacheResource(resource['@id'], resource['resourceType'], 'checked', vm.zipFolderPath);
                  await cacheFolder(resource['@id'], resource['schema:name'], 'checked');
                } else {
                  vm.zipDownloadCache.delete(resource['@id']);
                  await cacheFolder(resource['@id'], resource['schema:name'], 'unchecked');
                }
              } else {
                await cacheFolder(resource['@id'], resource['schema:name'], 'checked');
              }
            }

            await updateParentFoldersCheckedStatus(parentFolderId);
          }
          
          async function updateParentFoldersCheckedStatus(folderId) {
            // loop through all parent folders and update their checked status
            for (let i = vm.destinationPathInfo.length - 1; i > 0; i--) {
              const parentFolder = vm.destinationPathInfo[i];
              const parentFolderContents = await getFolderContentsByFolderId(parentFolder['@id']);
              if (parentFolderContents.every(resource => 
                  vm.zipDownloadCache.has(resource['@id']) && vm.zipDownloadCache.get(resource['@id'])['status'] === 'checked')) {
                cacheResource(parentFolder['@id'], CONST.resourceType.FOLDER, 'checked', vm.zipFolderPath);
              } else if (parentFolderContents.some(resource => 
                  vm.zipDownloadCache.has(resource['@id']) && 
                  (vm.zipDownloadCache.get(resource['@id'])['status'] === 'checked' ||
                  vm.zipDownloadCache.get(resource['@id'])['status'] === 'indeterminate'))) {
                cacheResource(parentFolder['@id'], CONST.resourceType.FOLDER, 'indeterminate', vm.zipFolderPath);
              } else {
                vm.zipDownloadCache.delete(parentFolder['@id']);
              }
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

          async function getDestinationById(folderId, resourceToCheck) {
            if (folderId) {
              const limit = UISettingsService.getRequestLimit();
              const offset = vm.offset;
              const resourceTypes = activeResourceTypes();

              if (resourceTypes.length > 0) {
                return new Promise((resolve, reject) => {
                  resourceService.getResources(
                      {
                        // folderId: resourceToCheck ? resourceToCheck['resourceType'] === CONST.resourceType.FOLDER ? resourceToCheck['@id'] : folderId : folderId,
                        folderId: folderId,
                        resourceTypes: resourceTypes,
                        sort: sortField(),
                        limit: limit,
                        offset: offset
                      },
                      async function (response) {
                        try {
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

                          if (resourceToCheck) {
                            cacheResource(resourceToCheck['@id'], resourceToCheck['resourceType'], 'checked', '');
                            if (resourceToCheck['resourceType'] === CONST.resourceType.FOLDER) {
                              await cacheFolder(resourceToCheck['@id'], resourceToCheck['schema:name'], 'checked');
                            }
                            vm.destinationPathInfo = response.pathInfo.slice(response.pathInfo.indexOf(response.pathInfo.find(p => p['@id'] === vm.currentFolderId)));
                          } else {
                            if (vm.destinationPathInfo[vm.destinationPathInfo.length - 1]['@id'] !== folderId) {
                              vm.destinationPathInfo = response.pathInfo.slice(response.pathInfo.indexOf(response.pathInfo.find(p => p['@id'] === vm.currentFolderId)));
                            }
                          }

                          vm.zipFolderPath = vm.destinationPathInfo.slice(1).map(folder => folder['schema:name']).join('/');
                          
                          $scope.destinationResources.forEach(resource => {
                            if (vm.zipDownloadCache.has(resource['@id'])) {
                              const cachedResource = vm.zipDownloadCache.get(resource['@id']);
                              if (resource['resourceType'] === CONST.resourceType.FOLDER) {
                                $timeout(function () {
                                  if (cachedResource['status'] === 'checked') {
                                    resource['checked'] = true;
                                  } else if (cachedResource['status'] === 'indeterminate') {
                                    const checkbox = document.getElementById("checkbox-" + $scope.destinationResources.indexOf(resource));
                                    if (checkbox) {
                                      checkbox.indeterminate = true;
                                    }
                                  } 
                                }, 0);
                              } else {
                                $timeout(function () {
                                  resource['checked'] = true;
                                }, 0);
                              }
                            }
                          });

                          resolve();
                        } catch (error) {
                          reject(error); 
                        }
                      },
                      function (error) {
                        UIMessageService.showBackendError('SERVER.FOLDER.load.error', error);
                        reject(error);
                      }
                  );
                });
              } else {
                $scope.destinationResources = [];
              }
            }
          }


          async function cacheFolder(folderId, zipFolderPath, status) {
            return new Promise((resolve, reject) => {
              resourceService.getResources(
                  {
                    folderId: folderId,
                    resourceTypes: activeResourceTypes(),
                    sort: sortField(),
                    limit: UISettingsService.getRequestLimit(),
                    offset: vm.offset
                  },
                  async function (response) {
                    try {
                      const promises = response.resources.map((resource) => {
                        // Handle folder resources
                        if (resource['resourceType'] === CONST.resourceType.FOLDER) {
                          if (status === 'checked') {
                            cacheResource(resource['@id'], resource['resourceType'], 'checked', zipFolderPath);
                          } else {
                            vm.zipDownloadCache.delete(resource['@id']);
                          }
                          return cacheFolder(resource['@id'], zipFolderPath + '/' + resource['schema:name'], status);
                        } else {
                          if (status === 'checked') {
                            return cacheResource(resource['@id'], resource['resourceType'], 'checked', zipFolderPath);
                          } else {
                            vm.zipDownloadCache.delete(resource['@id']);
                            return Promise.resolve();
                          }
                        }
                      });

                      await Promise.all(promises);
                      resolve();
                    } catch (error) {
                      reject(error);
                    }
                  },function (error) {
                    UIMessageService.showBackendError('SERVER.FOLDER.load.error', error);
                    reject(error);
                  }
              );
            });
          }
          
          function cacheResource(resourceId, resourceType, status, zipFolderPath) {
            vm.zipDownloadCache.set(resourceId, {resourceType: resourceType, status: status, zipFolderPath: zipFolderPath});
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
            document.getElementById('arpZipDownloadModalContent').scrollTop = 0;
            vm.modalVisible = false;
          }

          // modal open or closed
          $scope.$on('arpZipDownloadModalVisible', async function (event, params) {
            vm.zipDownloadCache.clear();
            const resource = params[0];
            const currentPath = params[1];
            const currentFolderId = params[2];
            const homeFolderId = params[3];
            const resourceTypes = params[4];
            const sortOptionField = params[5];

            if (resource) {
              vm.modalVisible = true;
              vm.arpZipDownloadResource = resource;
              vm.currentFolderId = currentFolderId;
              vm.homeFolderId = homeFolderId;
              vm.currentDestination = currentPath;
              vm.resourceTypes = resourceTypes;
              vm.sortOptionField = sortOptionField;
              vm.selectedDestination = null;
              vm.offset = 0;
              await getDestinationById(vm.currentFolderId, resource);
            }
          });
        }

        return {
          bindToController: {
            arpZipDownloadResource: '=',
            modalVisible: '='
          },
          controller      : cedarArpZipDownloadModalController,
          controllerAs    : 'arpzipdownload',
          restrict        : 'E',
          templateUrl     : 'scripts/modal/cedar-arp-zip-download-modal.directive.html'
        };

      }
    }
);
