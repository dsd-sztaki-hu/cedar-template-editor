'use strict';

define([
      'angular',
      'cedar/template-editor/service/cedar-user',
    ], function (angular) {
      angular.module('cedar.templateEditor.modal.cedarArpMergePreviewModalDirective', [
        'cedar.templateEditor.service.cedarUser'
      ]).directive('cedarArpMergePreviewModal', cedarArpMergePreviewModalDirective);

  cedarArpMergePreviewModalDirective.$inject = ['CedarUser', "DataManipulationService", "TemplateService", "TemplateElementService"];

      function cedarArpMergePreviewModalDirective(CedarUser, DataManipulationService, TemplateService, TemplateElementService) {

        cedarArpMergePreviewModalController.$inject = [
          '$scope',
          '$rootScope',
          '$uibModal',
          'CedarUser',
          '$timeout',
          '$translate',
          'resourceService',
          'UIMessageService',
          'UISettingsService',
          'CONST',
          'AuthorizedBackendService',
          'schemaService',
          'arpService'
        ];

        function cedarArpMergePreviewModalController($scope, $rootScope, $uibModal, CedarUser, $timeout, $translate,
                                          resourceService,
                                          UIMessageService,UISettingsService,
                                          CONST, AuthorizedBackendService, schemaService, arpService) {
          var vm = this;
          
          vm.openHome = openHome;
          vm.openSpecialFolders = openSpecialFolders;
          vm.getNextOffset = getNextOffset;
          vm.openParent = openParent;
          vm.openPreview = openPreview;
          vm.currentTitle = currentTitle;
          vm.parentTitle = parentTitle;
          vm.selectCurrent = selectCurrent;
          vm.selectDestination = selectDestination;
          vm.isDestinationSelected = isDestinationSelected;
          vm.copyDisabled = copyDisabled;
          vm.recursiveMergeResource = recursiveMergeResource;
          vm.openDestination = openDestination;
          vm.getResourceIconClass = getResourceIconClass;
          vm.loadMore = loadMore;
          vm.isFolder = isFolder;
          vm.isNewResource = isNewResource;
          vm.canWrite = canWrite;
          vm.hideModal = hideModal;
          vm.breadcrumbName = breadcrumbName;
          vm.getTemplateParentDir = getTemplateParentDir;
          vm.updatedResourcesTooltip = updatedResourcesTooltip;
          vm.showUpdatedResourcesInfo = showUpdatedResourcesInfo;
          vm.selectedDestination = null;
          vm.currentDestination = null;
          vm.previewCache = new Map();
          vm.currentDestinationID = null;
          vm.destinationPathInfo = null;
          vm.destinationPath = null;
          vm.resourceTypes = null;
          vm.sortOptionField = null;
          vm.offset = 0;
          vm.totalCount = -1;
          vm.isCommunity = false;
          vm.parentFolderPath = null;
          vm.updatedResources = [];
          $scope.destinationResources = [];
          $scope.checkAllCheckboxes = function() {
            // Check if all checkboxes are checked
            let allChecked = $scope.destinationResources.every(function(resource) {
              return resource.checked;
            });

            if (allChecked) {
              console.log('All checkboxes are checked');
              // Do something when all checkboxes are checked
            } else {
              console.log('Not all checkboxes are checked');
            }
          };

          vm.linkFolder = function (node) {
            return node['activeUserCanRead']
          };

          function breadcrumbName(folderName) {
            if (folderName === '/') {
              return 'All';
            }
            return folderName;
          }

          vm.getTitle = function (node) {
            return schemaService.getTitle(node);
          };

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
          
          function getTemplateParentDir() {
            return vm.destinationPathInfo ? vm.destinationPathInfo[vm.destinationPathInfo.length - 1] : null;
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

          function recursiveMergeResource() {
            if (vm.arpMergePreviewResource) {
              const resource = vm.arpMergePreviewResource;
              const originalFolderId = resource['_arpOriginalFolderId_'];
              const resourcesToMerge = [];

              resourceService.getResources({
                    folderId         : vm.currentFolderId,
                    resourceTypes    : activeResourceTypes(),
                    sort             : sortField(),
                    limit            : UISettingsService.getRequestLimit(),
                    offset           : vm.offset,
                  },
                  function (response) {
                    const arrayResponse = Array.isArray(response.resources) ? response.resources : [response.resources];
                    arrayResponse.forEach(res => {
                      const cachedResource = vm.previewCache.get(res['@id']);
                      if (cachedResource && cachedResource['changed'] === true) {
                        resourcesToMerge.push(cachedResource);
                      }
                    });
                    mergeRecursively(resourcesToMerge, originalFolderId);
                    refresh();
                  },
                  function (error) {
                    UIMessageService.showBackendError('SERVER.FOLDER.load.error', error);
                  });
            }
          }


          function mergeRecursively(resources, arpOriginalFolderId) {
            resources.forEach(resource => {
              // mergeResource is the JSON content of the resource to merge, which is either a template or an element
              if (resource.hasOwnProperty('mergeResource')) {
                const derivedFromId = resource.mergeResource.hasOwnProperty('pav:derivedFrom') ? resource.mergeResource['pav:derivedFrom'] : null;
                const mergeResource = arpService.doMergeResource(resource.mergeResource, resource.original);
                if (derivedFromId) {
                  let mergePromise;
                  if (getContentType(mergeResource) === CONST.resourceType.TEMPLATE) {
                    mergePromise = TemplateService.updateTemplate(derivedFromId, mergeResource);
                  } else if (getContentType(mergeResource) === CONST.resourceType.ELEMENT) {
                    mergePromise = TemplateElementService.updateTemplateElement(derivedFromId, mergeResource);
                  }
                  AuthorizedBackendService.doCall(
                      mergePromise,
                      function (response) {},
                      function (error) {
                        UIMessageService.showBackendError('ARP.recursiveMerge.error', error);
                      }
                  );
                } else {
                  resourceService.copyResource(
                      mergeResource,
                      arpOriginalFolderId,
                      mergeResource['schema:name'],
                      function (response) {},
                      function (error) {
                        UIMessageService.showBackendError('ARP.recursiveMerge.copyError', error);
                      }
                  );
                }
              } else {
                // if the resource is a folder, there is no mergeResource, we need the folders name and id only
                const folderResource = resource.resource;
                const folderName = folderResource['schema:name'];
                getFolderContentsByFolderId(arpOriginalFolderId).then(response => {
                  const alreadyPresentFolder = response.find(res => res['schema:name'] === folderName);
                  let newParentFolderId;
                  if (!alreadyPresentFolder) {
                    resourceService.createFolder(
                        arpOriginalFolderId,
                        folderResource['schema:name'],
                        folderResource['schema:description'],
                        function (response) {
                          newParentFolderId = response['@id'];
                          },
                        function (error) {
                          UIMessageService.showBackendError('ARP.recursiveMerge.createFolderError', error);
                        }
                    );
                  } else {
                    newParentFolderId = alreadyPresentFolder['@id'];
                  }
                  getFolderContentsByFolderId(folderResource['@id']).then(response => {
                    const resourcesToMerge = [];
                    response.forEach(res => {
                      const cachedResource = vm.previewCache.get(res['@id']);
                      if (cachedResource['changed'] === true) {
                        resourcesToMerge.push(cachedResource);
                      }
                    });
                    mergeRecursively(resourcesToMerge, newParentFolderId);
                  });
                });
              }
            });
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
                    offset           : offset
                  },
                  function (response) {
                    resolve(Array.isArray(response.resources) ? response.resources : [response.resources]); 
                  },
                  function (error) {
                    reject(error);
                    UIMessageService.showBackendError('SERVER.FOLDER.load.error', error);
                  });
            });
          }

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
            if (vm.modalVisible) {
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
              return resourceService.getResources(
                  {folderId: folderId, resourceTypes: resourceTypes, sort: sortField(), limit: limit, offset: offset},
                  function (response) {
                    const modifiedResources = [];
                    for (const res of response.resources) {
                      const resourceId = res['@id'];
                      if (vm.previewCache.has(resourceId)) {
                        const cachedResource = vm.previewCache.get(resourceId);
                        if (cachedResource['changed'] === true) {
                          if (cachedResource.original) {
                            cachedResource.resource['_arpTmpIsNewResPropForBgColor_'] =  Object.keys(cachedResource.original).length === 0;
                          }
                          modifiedResources.push(cachedResource.resource);
                        }
                      }
                    }
                    vm.totalCount = modifiedResources.length;
                    vm.currentDestinationID = folderId;
                    if (vm.offset > 0) {
                      $scope.destinationResources = $scope.destinationResources.concat(modifiedResources);
                    } else {
                      $scope.destinationResources = modifiedResources;
                    }
                    
                    const resource = response.pathInfo[response.pathInfo.length - 1];
                    vm.selectedDestination = resource;
                    vm.currentDestination = resource;
                    calculateDestinationPathInfo(response.pathInfo);
                    $scope.loading = false;
                  },
                  function (error) {
                    UIMessageService.showBackendError('SERVER.FOLDER.load.error', error);
                  }
              );
            }
          }

          function setPreviewCache(folderId, arpOriginalFolderId) {
            return new Promise((resolve, reject) => {
              getFolderContentsByFolderId(arpOriginalFolderId).then(originalFolderResources => {
                const arpOriginalFolderResources = Array.isArray(originalFolderResources) ? originalFolderResources : [originalFolderResources];
                resourceService.getResources(
                    {folderId: folderId, resourceTypes: activeResourceTypes(), sort: sortField(), limit: UISettingsService.getRequestLimit(), offset: vm.offset},
                    function (response) {
                      collectModifiedResources(response.resources, null, arpOriginalFolderResources)
                          .then(() => resolve())
                          .catch(error => reject(error));
                    },
                    function (error) {
                      UIMessageService.showBackendError('SERVER.FOLDER.load.error', error);
                      reject(error);
                    }
                );
              });
            });
          }
          
          async function collectModifiedResources(resources, parentFolder, arpOriginalFolderResources) {
            const promises = [];
            const keysToExclude = ['pav:derivedFrom', 'pav:createdOn', 'pav:lastUpdatedOn', '@id', 'pav:createdBy', 'schema:identifier', '_arpTmpIsNewResPropForBgColor_', '_arpOriginalFolderId_'];

            for (const resource of resources) {
              const updatedResourceId = resource['@id'];
              const updatedResourceType = resource['resourceType'];

              if ([CONST.resourceType.ELEMENT, CONST.resourceType.TEMPLATE].includes(resource['resourceType'])
                  && !vm.previewCache.has(resource['@id'])) {

                const promise = getResourceById(updatedResourceId, updatedResourceType)
                    .then(updatedContent => {
                      if (!updatedContent.hasOwnProperty('pav:derivedFrom')) {
                        const updatedExcludedKeys = omitDeep(_.cloneDeep(updatedContent), keysToExclude);
                        const original = arpOriginalFolderResources ? arpOriginalFolderResources.find(res => res['schema:name'] === updatedContent['schema:name']) : null;
                        if (original) {
                          getResourceById(original['@id'], original['resourceType']).then(originalContent => {
                            const originalExcludedKeys = omitDeep(_.cloneDeep(originalContent), keysToExclude);
                            compareAndCacheResource(originalExcludedKeys, updatedExcludedKeys, parentFolder, resource, updatedContent, originalContent);
                          });
                        } else {
                          vm.previewCache.set(resource['@id'], { changed: true, updated: updatedExcludedKeys, original:{}, resource: resource, mergeResource: updatedContent });
                          if (parentFolder) {
                            const parentFolderId = parentFolder['@id'];
                            if (!vm.previewCache.has(parentFolderId)) {
                              vm.previewCache.set(parentFolderId, { changed: true, resource: parentFolder });
                            }
                          }
                        }
                      } else {
                        const originalContentType = getContentType(updatedContent);
                        const originalId = updatedContent['pav:derivedFrom'];
                        return getResourceById(originalId, originalContentType)
                            .then(originalContent => {
                              const originalExcludedKeys = omitDeep(_.cloneDeep(originalContent), keysToExclude);
                              const updatedExcludedKeys = omitDeep(_.cloneDeep(updatedContent), keysToExclude);
                              compareAndCacheResource(originalExcludedKeys, updatedExcludedKeys, parentFolder, resource, updatedContent, originalContent);
                            });
                      }
                    })
                    .catch(error => {
                      UIMessageService.showBackendError('SERVER.TEMPLATE.load.error', error);
                    });
                promises.push(promise);

              } else if (CONST.resourceType.FOLDER === updatedResourceType) {
                const folderContents = await getFolderContentsByFolderId(resource['@id']);
                if (arpOriginalFolderResources) {
                  const originalFolderId = arpOriginalFolderResources.find(folder => folder['schema:name'] === resource['schema:name']);
                  if (originalFolderId) {
                    const originalFolderContents = await getFolderContentsByFolderId(originalFolderId['@id']);
                    promises.push(collectModifiedResources(folderContents, resource, originalFolderContents));
                  }
                } else {
                  promises.push(collectModifiedResources(folderContents, resource, null));
                }
              }
            }

            await Promise.all(promises);
          }
          
          function compareAndCacheResource(originalResource, updatedResource, parentFolder, resource, mergeResource, originalContent) {
            const isEqual = _.isEqual(originalResource, updatedResource);
            if (isEqual) {
              vm.previewCache.set(resource['@id'], { changed: false });
            } else {
              vm.previewCache.set(resource['@id'], { changed: true, original: originalResource, updated: updatedResource, resource: resource, mergeResource: mergeResource });
              checkLastUpdatedDates(originalContent, mergeResource);
              if (parentFolder) {
                const parentFolderId = parentFolder['@id'];
                if (!vm.previewCache.has(parentFolderId)) {
                  vm.previewCache.set(parentFolderId, { changed: true, resource: parentFolder});
                }
              }
            }
          }
          
          function checkLastUpdatedDates(originalResource, updatedResource) {
            const originalLastUpdatedDate = originalResource['pav:lastUpdatedOn'];
            const updatedLastUpdatedDate = updatedResource['pav:lastUpdatedOn'];
            if (originalLastUpdatedDate && updatedLastUpdatedDate) {
              const originalDate = new Date(originalLastUpdatedDate);
              const updatedDate = new Date(updatedLastUpdatedDate);
              if (originalDate.getTime() > updatedDate.getTime()) {
                vm.updatedResources.push(originalResource['schema:name']);
              }
            }
          }
          
          function showUpdatedResourcesInfo() {
            return vm.updatedResources.length > 0 && $scope.destinationResources &&  $scope.destinationResources.length > 0;
          }
          
          function updatedResourcesTooltip() {
            const translatedText = $translate.instant('ARP.recursiveMerge.originalUpdated');
            return  translatedText + '\n' + JSON.stringify(vm.updatedResources);
          }
          

          function omitDeep(obj, keysToExclude) {
            if (_.isArray(obj)) {
              obj.forEach((element, index) => {
                if (_.isObject(element)) {
                  omitDeep(element, keysToExclude);
                }
              });
            } else if (_.isObject(obj)) {
              _.forIn(obj, function(value, key) {
                if (_.isObject(value)) {
                  omitDeep(value, keysToExclude);
                } else if (keysToExclude.includes(key)) {
                  delete obj[key];
                }
              });
            }
            return obj;
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
          
          function getResourceById(updatedResourceId, updatedResourceType) {
            return new Promise((resolve, reject) => {
              const originalResourceId = updatedResourceId
              let promise;

              if (updatedResourceType === CONST.resourceType.TEMPLATE) {
                promise = TemplateService.getTemplate(originalResourceId);
              } else if (updatedResourceType === CONST.resourceType.ELEMENT) {
                promise = TemplateElementService.getTemplateElement(originalResourceId);
              }

              AuthorizedBackendService.doCall(
                  promise,
                  function (response) {
                    resolve(response.data);
                  },
                  function (err) {
                    console.log('err', err);
                    const message = (err.data.errorKey === 'noReadAccessToArtifact') ? 'Whoa!' : $translate.instant('SERVER.TEMPLATE.load.error');
                    reject(err);
                    UIMessageService.acknowledgedExecution(
                        function () {},
                        'GENERIC.Warning',
                        message,
                        'GENERIC.Ok');
                  });
            });
          }
          
          function calculateDestinationPathInfo(pathInfo) {
            if (!vm.parentFolderPath) {
              vm.parentFolderPath = pathInfo[pathInfo.length - 1];
            }
            const indexOfParentPath = pathInfo.findIndex(function(element) {
              return JSON.stringify(element) === JSON.stringify(vm.parentFolderPath);
            });
            vm.destinationPathInfo = pathInfo.slice(indexOfParentPath);
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
            return [CONST.resourceType.FOLDER, CONST.resourceType.TEMPLATE, CONST.resourceType.ELEMENT];
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
          
          function isNewResource(resource) {
            let result = false;
            if (resource) {
              result = resource['_arpTmpIsNewResPropForBgColor_'];
            }
            return result;
          }

          function openPreview(resource) {
            const previewResource = vm.previewCache.get(resource['@id'])
            $rootScope.arpMergeModalVisible = true;
            $rootScope.$broadcast('arpMergeModalVisible', [{'original': previewResource.original, 'updated': previewResource.updated}, 'template']);
          }
          
          function hideModal() {
            document.getElementById('arpMergePreviewModalContent').scrollTop = 0;
            vm.modalVisible = false;
            $rootScope.arpMergeModalVisible = false;
          }

          $scope.$on('arpMergePreviewModalVisible', async function (event, params) {
            vm.previewCache.clear();
            refresh();
            const resource = params[0];
            const currentFolderId = params[1];
            const sortOptionField = params[2];
            $scope.loading = true;

            if (resource) {
              vm.modalVisible = true;
              vm.arpMergePreviewResource = resource;
              vm.currentFolderId = currentFolderId;
              vm.sortOptionField = sortOptionField;
              vm.selectedDestination = null;
              vm.offset = 0;
              
              $timeout(async function() {
                try {
                  await setPreviewCache(vm.currentFolderId, vm.arpMergePreviewResource['_arpOriginalFolderId_']);
                  getDestinationById(vm.currentFolderId);
                } catch (error) {
                  UIMessageService.showBackendError('ARP.merge.preview.error', error);
                }
              });
            }
          });
          
        }
        
        return {
          bindToController: {
            arpMergePreviewResource: '=',
            modalVisible: '='
          },
          controller      : cedarArpMergePreviewModalController,
          controllerAs    : 'arpmergepreview',
          restrict        : 'E',
          templateUrl     : 'scripts/modal/cedar-arp-merge-preview-modal.directive.html'
        };

      }
    }
);
