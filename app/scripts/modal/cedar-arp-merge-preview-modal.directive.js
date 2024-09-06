'use strict';

define([
      'angular',
      'cedar/template-editor/service/cedar-user',
    ], function (angular) {
      angular.module('cedar.templateEditor.modal.cedarArpMergePreviewModalDirective', [
        'cedar.templateEditor.service.cedarUser'
      ]).directive('cedarArpMergePreviewModal', cedarArpMergePreviewModalDirective);

  cedarArpMergePreviewModalDirective.$inject = ['CedarUser', "DataManipulationService", "TemplateService", "TemplateElementService", "TemplateFieldService"];

      function cedarArpMergePreviewModalDirective(CedarUser, DataManipulationService, TemplateService, TemplateElementService, TemplateFieldService) {

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
          'arpService',
          'UrlService',
          'HttpBuilderService',
          '$location',
          'FrontendUrlService'
        ];

        function cedarArpMergePreviewModalController($scope, $rootScope, $uibModal, CedarUser, $timeout, $translate,
                                          resourceService,
                                          UIMessageService,UISettingsService,
                                          CONST, AuthorizedBackendService, schemaService, arpService, UrlService, 
                                          HttpBuilderService, $location, FrontendUrlService) {
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
          vm.confirmRecursiveMerge = confirmRecursiveMerge;
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
          vm.canIncrement = canIncrement;
          vm.canDecrement = canDecrement;
          vm.increment = increment;
          vm.decrement = decrement;
          vm.change = change;
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
          vm.parts = null;
          vm.min = null;
          vm.homeFolderId = null;
          vm.versionsFolderId = null;
          vm.everybodyGroupId = null;
          vm.dataverseFolderId = null;
          vm.originalFolderId = null;
          $scope.destinationResources = [];

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
          
          async function arpMergeResource() {
            if (vm.arpMergePreviewResource) {
              $rootScope.$broadcast('arpMergeLoading');
              await initVersionsFolder();
              const resource = vm.arpMergePreviewResource;
              vm.originalFolderId = resource['_arpOriginalFolderId_'];
              const folderNames = await getPublicPathInfo(vm.originalFolderId);
              const currentVersion = getVersion(resource);
              const parts = currentVersion.split(".");
              folderNames.push(parts[0] + '.' + parts[1] + '.' + parts[2]);
              const versionFolderId = await buildVersionFolderForResource(folderNames, vm.versionsFolderId);
              await moveFolderContents(vm.originalFolderId, versionFolderId);
              await copyFolderContents(vm.currentFolderId, vm.originalFolderId);
              await finalizedNewVersion(vm.originalFolderId);
              await arpService.deleteFolder(vm.currentFolderId, true);
            }
          }
          
          function moveFolderContents(folderId, destinationFolderId) {
            return new Promise((resolve, reject) => {
              resourceService.getResources({
                    folderId: folderId,
                    resourceTypes: [CONST.resourceType.FOLDER, CONST.resourceType.TEMPLATE, CONST.resourceType.ELEMENT, CONST.resourceType.FIELD],
                  },
                  async function(response) {
                    const arrayResponse = Array.isArray(response.resources) ? response.resources : [response.resources];

                    try {
                      const movePromises = arrayResponse.map(res => {
                        return new Promise((moveResolve, moveReject) => {
                          resourceService.moveResource(res, destinationFolderId,
                              function(response) {
                                moveResolve(response);
                              },
                              function(error) {
                                moveReject(error);
                              });
                        });
                      });

                      await Promise.all(movePromises);
                      resolve();
                    } catch (error) {
                      reject(error);
                    }
                  },
                  function(error) {
                    reject(error);
                    UIMessageService.showBackendError('ARP.merge.moveFolderContents.error', error);
                  }
              );
            });
          }

          async function copyFolderContents(folderId, destinationFolderId) {
            return new Promise((resolve, reject) => {
              resourceService.getResources({
                    folderId: folderId,
                    resourceTypes: [CONST.resourceType.FOLDER, CONST.resourceType.TEMPLATE, CONST.resourceType.ELEMENT, CONST.resourceType.FIELD],
                  },
                  async function(response) {
                    const arrayResponse = Array.isArray(response.resources) ? response.resources : [response.resources];

                    try {
                      for (const res of arrayResponse) {
                        if (res.resourceType === CONST.resourceType.FOLDER) {
                          await new Promise((folderResolve, folderReject) => {
                            resourceService.createFolder(
                                destinationFolderId,
                                res['schema:name'],
                                res['schema:description'],
                                async function(response) {
                                  await copyFolderContents(res['@id'], response['@id']);
                                  folderResolve();
                                },
                                function(error) {
                                  UIMessageService.showBackendError('ARP.merge.copyFolderContents.error', error);
                                  folderReject(error);
                                }
                            );
                          });
                        } else if ([CONST.resourceType.TEMPLATE, CONST.resourceType.ELEMENT, CONST.resourceType.FIELD].includes(res.resourceType)) {
                          await new Promise((resourceResolve, resourceReject) => {
                            resourceService.copyResource(
                                res,
                                destinationFolderId,
                                res['schema:name'],
                                function(response) {
                                  delete response['pav:derivedFrom'];
                                  arpService.saveDataFromOriginal(response, destinationFolderId, res['schema:identifier'], res['pav:version']);
                                  resourceResolve();
                                },
                                function(error) {
                                  UIMessageService.showBackendError('ARP.merge.copyFolderContents.error', error);
                                  resourceReject(error);
                                }
                            );
                          });
                        }
                      }
                      resolve();
                    } catch (error) {
                      UIMessageService.showBackendError('ARP.merge.copyFolderContents.error', error);
                      reject(error);
                    }
                  },
                  function(error) {
                    reject(error);
                    UIMessageService.showBackendError('ARP.merge.copyFolderContents.error', error);
                  });
            });
          }
          
          function finalizedNewVersion(folderId) {
            return new Promise(async (resolve, reject) => {
              const arrayResponse = await arpService.getFolderContents(folderId, arpService.arpResourceTypes());
              try {
                // Process each resource sequentially
                for (const res of arrayResponse) {
                  if (res.resourceType === CONST.resourceType.FOLDER) {
                    await finalizedNewVersion(res['@id']);
                  } else {
                    try {
                      await publishNewVersion(res, vm.parts[0] + '.' + vm.parts[1] + '.' + vm.parts[2]);
                      await enableOpenView(res);
                    } catch (error) {
                      // try again
                      await publishNewVersion(res, vm.parts[0] + '.' + vm.parts[1] + '.' + vm.parts[2]);
                      await enableOpenView(res);
                    }
                  }
                }
                resolve();
              } catch (error) {
                reject(error);
              }
            });
          }
          
          async function enableOpenView(resource) {
            const postData = {
              '@id': resource['@id']
            };
            const url = UrlService.makeArtifactOpen();
            await AuthorizedBackendService.doCall(
                HttpBuilderService.post(url, postData),
                function (response) {},
                function (error) {
                  UIMessageService.showBackendError('ARP.merge.enableOpenView.error', error);
                }
            );
          }

          async function publishNewVersion(resource, version) {
            //TODO: try to fix this, but for now, it's a workaround for the following error:
            // server-resource | org.metadatacenter.exception.CedarProcessingException: Failed to remove _doc _id:Jx4UxpABTEZUc03ilDWc from the cedar-search index
            //await new Promise(resolve => setTimeout(resolve, 1000));

            const postData = {
              '@id': resource['@id'],
              'newVersion': version
            };
            const url = UrlService.publishResource();
            await AuthorizedBackendService.doCall(
                HttpBuilderService.post(url, postData),
                function(response) {},
                function(error) {
                  UIMessageService.showBackendError('ARP.merge.publishNewVersion.error', error);
                }
            );
          }

          function buildVersionFolderForResource(folderNames, parentFolderId) {
            return new Promise( (resolve, reject) => {
              if (folderNames.length > 0) {
                const folderName = folderNames.shift();
                findFolderByName(folderName, parentFolderId).then(exists => {
                  if (exists) {
                    resolve(buildVersionFolderForResource(folderNames, exists['@id']));
                  } else {
                    resourceService.createFolder(
                        parentFolderId,
                        folderName,
                        'description',
                        function (response) {
                          resolve(buildVersionFolderForResource(folderNames, response['@id']));
                        },
                        function (error) {
                          reject(error);
                          UIMessageService.showBackendError('ARP.recursiveMerge.buildVersionFolderForResourceError', error);
                        }
                    );
                  }
                });
              } else {
                resolve(parentFolderId);
              }
            });
            }
          
          function everyResourceChecked() {
            let result = true;
            for (let [key, value] of vm.previewCache) {
              if (value.hasOwnProperty('changed') && value['changed'] === true) {
                result = result && (value.checked === true);
              }
            }
            return result;
          }

          function confirmRecursiveMerge() {
            const resourcesChecked = everyResourceChecked();
            UIMessageService.confirmedExecution(
                async function () {
                  await arpMergeResource();
                  $location.url(FrontendUrlService.getFolderContents(vm.originalFolderId));
                  $rootScope.$apply();
                  $rootScope.$broadcast('arpMergeLoadingDone');
                  UIMessageService.flashSuccess('ARP.merge.success', {},'ARP.GENERIC.Merged');
                },
                $translate.instant('ARP.merge.confirmationTitle', {title: vm.arpMergePreviewResource['schema:name'], version: vm.parts[0] + '.' + vm.parts[1] + '.' + vm.parts[2]}),
                resourcesChecked ? 'ARP.recursiveMerge.alertTextKey' : 'ARP.recursiveMerge.alertTextKeyNotAllChecked',
                'ARP.recursiveMerge.confirmTextKey'
            );
          }

          // @deprecated, use arpMergeResource() instead
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
                    UIMessageService.flashSuccess('ARP.recursiveMerge.success', {"title": resource['schema:name']},
                        'ARP.GENERIC.Merged');
                    refresh();
                  },
                  function (error) {
                    UIMessageService.showBackendError('SERVER.FOLDER.load.error', error);
                  });
            }
          }

          // @deprecated
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
                    UIMessageService.showBackendError('ARP.merge.getFolderContentsByFolderId.error', error);
                  });
            });
          }
          
          function findFolderByName(folderName, parentFolderId) {
            return new Promise((resolve, reject) => {
              resourceService.getResources({
                folderId         : parentFolderId,
                resourceTypes    : [CONST.resourceType.FOLDER],
              },
                  function (response) {
                    const resources = response.resources;
                    resolve(Array.isArray(resources) ?
                        resources.find(res => res['schema:name'] === folderName) :
                        resources['schema:name'] === folderName ? resources : null
                    );
              },
                  function (error) {
                    reject(error);
                    UIMessageService.showBackendError('ARP.merge.findFolderByName.error', error);
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
            return vm.selectedDestination == null || $scope.destinationResources.length === 0;
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
                          if (res['resourceType'] === CONST.resourceType.FOLDER) {
                            const folderChecked = isFolderChecked(cachedResource.resource);
                            cachedResource.checked = folderChecked;
                            cachedResource.resource.checked = folderChecked;
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
                      UIMessageService.showBackendError('ARP.merge.setPreviewCache.error', error);
                      reject(error);
                    }
                );
              });
            });
          }
          
          async function collectModifiedResources(resources, parentFolder, arpOriginalFolderResources) {
            const promises = [];

            for (const resource of resources) {
              const updatedResourceId = resource['@id'];
              const updatedResourceType = resource['resourceType'];

              if ([CONST.resourceType.ELEMENT, CONST.resourceType.TEMPLATE, CONST.resourceType.FIELD].includes(resource['resourceType'])
                  && !vm.previewCache.has(resource['@id'])) {

                const promise = getResourceById(updatedResourceId, updatedResourceType)
                    .then(updatedContent => {
                      if (!updatedContent.hasOwnProperty('pav:derivedFrom')) {
                        const parentFolderId = parentFolder ? parentFolder['@id'] : null;
                        const updatedExcludedKeys = arpService.omitDeep(_.cloneDeep(updatedContent));
                        const original = arpOriginalFolderResources !== null ? arpOriginalFolderResources.find(res => res['schema:name'] === updatedContent['schema:name']) : null;
                        if (original) {
                          getResourceById(original['@id'], original['resourceType']).then(originalContent => {
                            const originalExcludedKeys = arpService.omitDeep(_.cloneDeep(originalContent));
                            compareAndCacheResource(originalExcludedKeys, updatedExcludedKeys, parentFolder, resource, updatedContent, originalContent);
                          });
                        } else {
                          vm.previewCache.set(resource['@id'], { changed: true, updated: updatedExcludedKeys, original:{}, resource: resource, mergeResource: updatedContent, parentFolderId: parentFolderId });
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
                              const originalExcludedKeys = arpService.omitDeep(_.cloneDeep(originalContent));
                              const updatedExcludedKeys = arpService.omitDeep(_.cloneDeep(updatedContent));
                              compareAndCacheResource(originalExcludedKeys, updatedExcludedKeys, parentFolder, resource, updatedContent, originalContent);
                            });
                      }
                    })
                    .catch(error => {
                      UIMessageService.showBackendError('SERVER.TEMPLATE.load.error', error);
                    });
                promises.push(promise);

              }  else if (CONST.resourceType.FOLDER === updatedResourceType) {
                const folderContents = await getFolderContentsByFolderId(resource['@id']);
                if (arpOriginalFolderResources) {
                  const originalFolderId = arpOriginalFolderResources.find(folder => folder['schema:name'] === resource['schema:name']);
                  if (originalFolderId) {
                    const originalFolderContents = await getFolderContentsByFolderId(originalFolderId['@id']);
                    promises.push(collectModifiedResources(folderContents, resource, originalFolderContents));
                  } else {
                    // the original folder does not exist
                    promises.push(collectModifiedResources(folderContents, resource, null));
                  }
                } else {
                  // the original folder is empty
                  promises.push(collectModifiedResources(folderContents, resource, null));
                }
              }
            }

            await Promise.all(promises);
          }
          
          function compareAndCacheResource(originalResource, updatedResource, parentFolder, resource, mergeResource, originalContent) {
            const isEqual = _.isEqual(originalResource, updatedResource);
            const parentFolderId = parentFolder ? parentFolder['@id'] : null;
            if (isEqual) {
              vm.previewCache.set(resource['@id'], { changed: false });
            } else {
              vm.previewCache.set(resource['@id'], { changed: true, original: originalResource, updated: updatedResource, resource: resource, mergeResource: mergeResource, parentFolderId: parentFolderId });
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
          
          function getContentType(content) {
            const typeStr = content['@type'];
            const lastIndex = typeStr.lastIndexOf('/');
            const contentType = typeStr.substring(lastIndex + 1);
            switch (contentType) {
              case 'TemplateElement':
                return CONST.resourceType.ELEMENT;
              case 'Template':
                return CONST.resourceType.TEMPLATE;
              case 'Field':
                return CONST.resourceType.FIELD;
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
              } else if (updatedResourceType === CONST.resourceType.FIELD) {
                promise = TemplateFieldService.getTemplateField(originalResourceId);
              }

              AuthorizedBackendService.doCall(
                  promise,
                  function (response) {
                    resolve(response.data);
                  },
                  function (err) {
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
            return [CONST.resourceType.FOLDER, CONST.resourceType.TEMPLATE, CONST.resourceType.ELEMENT, CONST.resourceType.FIELD];
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
            resource.checked = true;
            previewResource.checked = true;
            vm.previewCache.get(resource['@id']).checked = true;
            isParentFolderChecked(resource);
          }
          
          function isParentFolderChecked(resource) {
            if (resource) {
              let allChildResourcesChecked = true;
              const parentFolderId = vm.previewCache.get(resource['@id']).parentFolderId;
              const childResources = [];
              for (let [key, value] of vm.previewCache) {
                if (value.changed === true && value.hasOwnProperty('parentFolderId') && value.parentFolderId === parentFolderId) {
                  childResources.push(value);
                }
              }
              allChildResourcesChecked = childResources.length > 0 && childResources.every(res => res.checked === true);
              if (parentFolderId && allChildResourcesChecked) {
                vm.previewCache.get(parentFolderId).checked = true;
              }
            }
          }
          
          function isFolderChecked(resource) {
            let result = false;
            if (resource) {
              const childResources = [];
              for (let [key, value] of vm.previewCache) {
                if (value.changed === true && value.parentFolderId === resource['@id']) {
                  childResources.push(value);
                }
              }
              result = childResources.every(res => res.checked === true);
            }
            return result;
          }
          
          function hideModal() {
            document.getElementById('arpMergePreviewModalContent').scrollTop = 0;
            vm.modalVisible = false;
            $rootScope.arpMergeModalVisible = false;
          }
          
          async function initVersionsFolder() {
            const versionsFolder = await findFolderByName('Versions', vm.homeFolderId);
            await findEverybodyGroup();
            if (versionsFolder) {
              vm.versionsFolderId = versionsFolder['@id'];
              await setSharedWithEverybody(vm.versionsFolderId);
            } else {
                await createVersionsFolder();
            }
          }


          async function createVersionsFolder() {
            return new Promise((resolve, reject) => {
              resourceService.createFolder(
                  vm.homeFolderId,
                  'Versions',
                  'description',
                  function (response) {
                    vm.versionsFolderId = response['@id'];
                    resolve(setSharedWithEverybody(vm.versionsFolderId));
                  },
                  function (error) {
                    reject(error);
                    UIMessageService.showBackendError('ARP.merge.createVersionsFolder.error', error);
                  }
              );
            });
          }
          
          async function setSharedWithEverybody(id) {
            const url = UrlService.folderPermission(id);
            AuthorizedBackendService.doCall(
                HttpBuilderService.get(url),
                function (response) {
                  const isSharedWithEverybody = response.data.groupPermissions.find(groupPermission => 
                      groupPermission.group['@id'] === vm.everybodyGroupId && groupPermission.permission === 'read');
                  if (!isSharedWithEverybody) {
                    const owner = response.data.owner;
                    const permissions = {
                      "owner": owner,
                      "groupPermissions": [
                        {
                          "permission": "read",
                          "group": {"@id": vm.everybodyGroupId}
                        }
                      ]
                    };
                    AuthorizedBackendService.doCall(
                        HttpBuilderService.put(url, permissions),
                        function (response) {
                        },
                        function (error) {
                          UIMessageService.showBackendError('ARP.merge.setPermissions.error', error);
                        });
                  }
                },
                function (error) {
                  UIMessageService.showBackendError('ARP.merge.setPermissions.error', error);
                });
          }

          function findEverybodyGroup() {
            return new Promise((resolve, reject) => {
              const url = UrlService.getGroups();
              AuthorizedBackendService.doCall(
                  HttpBuilderService.get(url),
                  function (response) {
                    const group = response.data.groups.find(group => group['specialGroup'] === 'EVERYBODY');
                    if (group) {
                      vm.everybodyGroupId = group['@id'];
                      resolve(group);
                    } else {
                      reject(null);
                      UIMessageService.showBackendWarning($translate.instant('ARP.merge.findEverybodyGroup.error'), 'EVERYBODY group not found');
                    }
                  },
                  function (error) {
                    reject(error);
                    UIMessageService.showBackendError('ARP.merge.findEverybodyGroup.error', error);
                  }
              );
            });
          }
          
          // Collects the path info of the folder and its parent folders inside the Public folder
          function getPublicPathInfo(folderId) {
            return new Promise((resolve, reject) => {
              const originalPath = [];
              let saveFolderName = false;
              resourceService.getResources({
                    folderId         : folderId,
                    resourceTypes    : [CONST.resourceType.FOLDER],
                  },
                  function (response) {
                    const pathInfo = response.pathInfo;
                    for (const resource of pathInfo) {
                      const folderName = resource['schema:name'];
                      if (saveFolderName === false) {
                        saveFolderName = folderName === 'Public';
                      }
                      if (saveFolderName === true) {
                        originalPath.push(folderName);
                        if (folderName === 'Dataverse') {
                          vm.dataverseFolderId = resource['@id'];
                        }
                      }
                    }
                    // If the originalPath is empty, that means that the resource is not in the Public folder
                    // This should not happen, but in this case return the parent folder's name
                    if (originalPath.length === 0) {
                      originalPath.push(pathInfo[pathInfo.length - 1]['schema:name']);
                    }
                    resolve(originalPath);
                  },
                  function (error) {
                    reject(error);
                    UIMessageService.showBackendError('ARP.merge.getPublicPathInfo.error', error);
                  });
            });
          }
          
          //region Copied from cedar-publish-modal.directive.js
          
          function getVersion(resource) {
            if (resource != null) {
              return resource['pav:version'];
            }
          }

          function canIncrement(index) {
            return vm.parts && (vm.parts.length > index) && vm.parts[index] < 1000;
          }

          function getTotal(parts) {
            if (parts.length === 3) {
              return parts[0] * 1000000 + parts[1] * 1000 + parts[2];
            }
          }

          function canDecrement(index) {
            if (vm.parts && vm.parts.length > index && vm.parts[index] > 0) {
              var value = vm.parts.slice();
              value[index] = value[index] > 0 ? value[index] - 1 : 0;
              return (getTotal(value) >= vm.min);
            }
          }

          function increment(index) {
            if (vm.parts && vm.parts.length > index) {
              vm.parts[index] = vm.parts[index] < 1000 ? vm.parts[index] + 1 : vm.parts[index];
              for (var i=index+1; i<vm.parts.length; i++) {
                vm.parts[i] = 0;
              }
            }
          }

          function decrement(index) {
            if (vm.parts && vm.parts.length > index) {
              vm.parts[index] = vm.parts[index] > 0 ? vm.parts[index] - 1 : 0;
              if (getTotal(vm.parts) < vm.min) {
                vm.parts[index]++;
              }
            }
          }

          function change(index, newValue, oldValue) {
            let value;
            if (isNaN(parseInt(newValue))) {
              value = parseInt(oldValue);
            } else {
              value = parseInt(newValue);
            }

            // got a new value
            vm.parts[index] = value;
            if (getTotal(vm.parts) < vm.min) {
              // restore old value
              vm.parts[index] = oldValue;
            }
          }

          function getNextVersion(resource) {
            const currentVersion = getVersion(resource);
            const parts = currentVersion.split(".");
            if (parts.length === 3) {
              parts[0] = parseInt(parts[0]);
              parts[1] = parseInt(parts[1]);
              parts[2] = parseInt(parts[2]) + 1;
              return parts;
            }
            return null;
          }
          
          //endregion

          $scope.$on('arpMergePreviewModalVisible', async function (event, params) {
            vm.previewCache.clear();
            refresh();
            const resource = params[0];
            const currentFolderId = params[1];
            const sortOptionField = params[2];
            vm.homeFolderId = params[3];
            vm.userId = params[4];
            $scope.loading = true;

            if (resource) {
              vm.modalVisible = true;
              vm.arpMergePreviewResource = resource;
              vm.currentFolderId = currentFolderId;
              vm.sortOptionField = sortOptionField;
              vm.selectedDestination = null;
              vm.offset = 0;
              vm.parts = getNextVersion(resource);
              vm.min = getTotal(vm.parts);
              
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
