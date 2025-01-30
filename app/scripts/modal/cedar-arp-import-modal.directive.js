'use strict';

define([
  'angular'
], function (angular) {
  angular.module('cedar.templateEditor.modal.cedarArpImportModalDirective', [])
    .directive('cedarArpImportModal', cedarArpImportModalDirective);


  function cedarArpImportModalDirective() {

    cedarArpImportModalController.$inject = [
      '$scope',
      '$timeout',
      'UrlService',
      'arpService',
      'CONST',
      '$window',
      '$translate',
      'FrontendUrlService'
    ];

    function cedarArpImportModalController($scope, $timeout,
      UrlService, arpService, CONST, $window, $translate, FrontendUrlService) {

      let vm = this;

      $scope.importStatus = {
        'active': 0,
        'validFiles': [],
        'invalidFiles': []
      };

      vm.alreadyPresentCedarResources = null;
      vm.uploadedResources = [];
      vm.jsTreesInitialized = false;
      vm.conflictResolutionMethod = null;
      vm.repoDomain = null;
      vm.validResourcesMap = new Map();
      vm.conflictingResourcesMap = new Map();
      vm.invalidResourcesMap = new Map();
      vm.uploadableResourcesMap = new Map();
      vm.folderIds = new Map();
      vm.userCanUpload = false;
      vm.userHomeFolderId = null;
      vm.destinationFolderId = null;
      vm.nodeActions = {};
      vm.areAllConflictsResolved = false;

      vm.importFileReport = {};
      $scope.isDragOver = false;
      $scope.activeTabIndex = 0;

      const resourceImportStatus = {
        VALID: "VALID",
        CONFLICTING: "CONFLICTING",
        REJECTED: "REJECTED",
        DUPLICATE: "DUPLICATE",
        UNSUPPORTED: "UNSUPPORTED"
      }

      const jsTreeRootFolder = "#";

      /**
       * Public functions
       */
      vm.getImportUrl = getImportUrl;
      vm.startImport = startImport;
      vm.resetModal = resetModal;

      /**
       * Function definitions
       */

      function getImportUrl(folderId) {
        return UrlService.importCadsrForms(folderId);
      };

      // Helper function to update child actions
      function updateChildActions(node, action, tree) {
        // Find and update the node's display name
        const resource = vm.uploadableResourcesMap.get(node.id);
        if (resource) {
          const $nodeElement = $(tree.get_node(node.id, true));
          const $nameSpan = $nodeElement.find('> a > .node-name');

          if (action === 'createCopy' && resource.resourceType === CONST.resourceType.FOLDER && resource.parent === jsTreeRootFolder) {
            $nameSpan.text(resource.combinedName);
          } else {
            $nameSpan.text(resource.text);
          }
        }

        if (node.children?.length) {
          node.children.forEach(childId => {
            // Update the data-resolved attribute for this child node
            const childNode = tree.get_node(childId);
            if (childNode) {
              // Update the action in memory
              vm.uploadableResourcesMap.get(childId).resolveMethod = action;

              // Update the dropdown value if it exists
              const dropdown = $(`.node-action[data-node-id="${childId}"]`);
              if (dropdown.length) {
                dropdown.val(action);
                dropdown.closest('.jstree-node').attr('data-resolved', action ? 'true' : 'false');
              }

              // Recursively update children
              updateChildActions(childNode, action, tree);
            }
          });
        }
      }

      vm.setConflictResolutionMethod = function (method) {
        const tree = $('#jstree-valid').jstree(true);
        const rootNode = tree.get_node(jsTreeRootFolder);
        updateChildActions(rootNode, method, tree);

        vm.areAllConflictsResolved = true;
      };

      async function startImport() {
        for (const resource of vm.uploadedResources) {
          if (resource.resourceType === CONST.resourceType.FOLDER) {
            await handleFolderImport(resource);
          } else {
            handleResourceImport(resource, vm.folderIds.get(resource.parent));
          }
        }
      }

      function handleResourceImport(resourceJson, parentFolderId) {
        const shouldImport = (
          (vm.conflictResolutionMethod === 'replace' && vm.conflictingResourcesMap.has(resourceJson.id)) ||
          (vm.conflictResolutionMethod === 'createCopy' && (vm.validResourcesMap.has(resourceJson.id) || vm.conflictingResourcesMap.has(resourceJson.id))) ||
          (vm.conflictResolutionMethod === 'skip' && vm.validResourcesMap.has(resourceJson.id))
        );

        if (!shouldImport) return;

        const resourceContent = resourceJson.content;

        if (vm.conflictResolutionMethod === 'replace' && vm.conflictingResourcesMap.has(resourceJson.id)) {
          arpService.updateResource(resourceContent['@id'], resourceContent);
        } else {
          delete resourceContent['@id'];
          delete resourceContent['_arpOriginalFolderId_'];
          delete resourceContent['pav:derivedFrom'];
          arpService.createResource(parentFolderId, resourceContent);
        }
      }

      async function handleFolderImport(folderResource) {
        // For createCopy method
        if (vm.conflictResolutionMethod === 'createCopy') {
          if (vm.uploadableResourcesMap.has(folderResource.id)) {
            const folderName = folderResource.status === resourceImportStatus.CONFLICTING ? folderResource.copyName : folderResource.text;
            const cedarFolderId = await arpService.createFolderAsync(
              vm.folderIds.get(folderResource.parent),
              folderName,
              folderResource.cedarDescription || $translate.instant('ARP.resourceImport.folderDescription')
            );
            vm.folderIds.set(folderResource.id, cedarFolderId);
          }
          return;
        }

        // For replace method
        if (vm.conflictResolutionMethod === 'replace') {
          // Check if folder contains template that will be replaced
          // in this case the imported folder content will be uploaded to the CEDAR folder of the template
          const templateToReplace = vm.uploadedResources.find(resource =>
            resource.resourceType === CONST.resourceType.TEMPLATE &&
            vm.conflictingResourcesMap.has(resource.id) &&
            resource.parent.startsWith(folderResource.id)
          );


          if (templateToReplace) {
            // Use templateToReplace parent id as the CEDAR folder id for the folder contents
            const templateToReplaceReport = await arpService.getResourceReportById(templateToReplace.content['@id'], templateToReplace.resourceType);
            vm.folderIds.set(folderResource.id, templateToReplaceReport.pathInfo[templateToReplaceReport.pathInfo.length - 2]['@id']);
            // TODO: add the description from the .json file
          } else {
            // Create folder if it is not already present in CEDAR
            const alreadyPresentFolders = await arpService.getFolderContents(vm.folderIds.get(folderResource.parent), [CONST.resourceType.FOLDER]);
            const alreadyPresentFolder = alreadyPresentFolders.find(folder => folder['schema:name'] === folderResource.text);
            if (alreadyPresentFolder) {
              vm.folderIds.set(folderResource.id, alreadyPresentFolder['@id']);
            } else {
              const cedarFolderId = await arpService.createFolderAsync(
                vm.folderIds.get(folderResource.parent),
                folderResource.text,
                folderResource.cedarDescription || $translate.instant('ARP.resourceImport.folderDescription')
              );
              vm.folderIds.set(folderResource.id, cedarFolderId);
            }
          }
          return;
        }

        // For skip method
        if (vm.conflictResolutionMethod === 'skip') {
          if (vm.validResourcesMap.has(folderResource.id)) {
            const cedarFolderId = await arpService.createFolderAsync(
              vm.folderIds.get(folderResource.parent),
              folderResource.text,
              folderResource.cedarDescription || $translate.instant('ARP.resourceImport.folderDescription')
            );
            vm.folderIds.set(folderResource.id, cedarFolderId);
          }
          return;
        }
      }

      function supportsFileAndDirectoryUpload() {
        // Check if the browser is Safari
        var ua = navigator.userAgent;
        var isSafari = /^((?!chrome|android).)*safari/i.test(ua);
        return isSafari;
      }

      function resetModal() {
        $scope.importStatus = {
          'active': 0,
          'validFiles': [],
          'invalidFiles': []
        };
        vm.uploadedResources = []
        vm.conflictResolutionMethod = null
        vm.validResourcesMap = new Map();
        vm.conflictingResourcesMap = new Map();
        vm.invalidResourcesMap = new Map();
        initializeFolderIds();
        refreshJsTrees();
      };

      function initializeFolderIds() {
        vm.folderIds = new Map();
        const rootFolderId = vm.userCanUpload ? vm.destinationFolderId : vm.userHomeFolderId;
        vm.folderIds.set(jsTreeRootFolder, rootFolderId);
      }

      // Function to initialize jsTree
      function initJsTrees() {
        $timeout(function () {
          $.noConflict();
          vm.jsTreesInitialized = true;

          $('#jstree-valid').jstree({
            'core': {
              'check_callback': true,
              'data': function (obj, callback) {
                const treeData = $scope.importStatus.validFiles.map(resource => {
                  // Get the stored resolveMethod from uploadableResourcesMap
                  const uploadableResource = vm.uploadableResourcesMap.get(resource.id);
                  const hasResolveMethod = uploadableResource && uploadableResource.resolveMethod;

                  // Check if parent has a resolveMethod
                  const parentId = resource.parent;
                  const parentResource = vm.uploadableResourcesMap.get(parentId);
                  const hasParentResolveMethod = parentResource && parentResource.resolveMethod;

                  return {
                    ...resource,
                    li_attr: {
                      'data-conflicting': resource.status === resourceImportStatus.CONFLICTING ? 'true' : 'false',
                      'data-resolved': (hasResolveMethod || hasParentResolveMethod) ? 'true' : 'false'
                    },
                    text: resource.status === resourceImportStatus.CONFLICTING ?
                      `<span class="node-name">${resource.resolveMethod === 'createCopy' && resource.resourceType === CONST.resourceType.FOLDER ? resource.combinedName : resource.text}</span>
                    <select class="node-action" data-node-id="${resource.id}">
                      <option value="">Action...</option>
                      <option value="replace">Replace</option>
                      <option value="createCopy">Copy</option>
                      <option value="skip">Skip</option>
                    </select>
                    ${resource.resourceType !== CONST.resourceType.FOLDER ?
                        `<i class="fa fa-arrow-up open-original" style="margin-left: 5px; cursor: pointer;"></i>`
                        : ''}`
                      : resource.text,
                  };
                });
                callback(treeData);
              },
              'themes': {
                'icons': true
              }
            },
            'plugins': ['html_data']
          })
            .on('ready.jstree refresh.jstree before_open.jstree', function (e, data) {
              // Update all visible nodes based on their stored resolveMethod
              $(this).find('.node-action').each(function () {
                const $dropdown = $(this);
                const nodeId = $dropdown.data('node-id');
                const resource = vm.uploadableResourcesMap.get(nodeId);
                const tree = $('#jstree-valid').jstree(true);
                const node = tree.get_node(nodeId);

                // Check parent's resolveMethod
                const parentId = node.parent;
                const parentResource = vm.uploadableResourcesMap.get(parentId);
                const parentResolveMethod = parentResource && parentResource.resolveMethod;

                // Only update from parent if the node has never had a resolveMethod set
                if (parentResolveMethod && resource && resource.resolveMethod === undefined) {
                  $dropdown.val(parentResolveMethod);
                  $dropdown.closest('.jstree-node').attr('data-resolved', 'true');
                  // Update the resource's resolveMethod to match parent
                  resource.resolveMethod = parentResolveMethod;
                } else if (resource) {
                  // Respect the node's own resolveMethod, even if it's empty
                  $dropdown.val(resource.resolveMethod || '');
                  $dropdown.closest('.jstree-node').attr('data-resolved', resource.resolveMethod ? 'true' : 'false');
                }

                // Remove existing handler to prevent duplicates
                $dropdown.off('change').on('change', function (e) {
                  e.stopPropagation();
                  const action = $(this).val();
                  const resource = vm.uploadableResourcesMap.get(nodeId);
                  resource.resolveMethod = action;

                  const $nameSpan = $(this).closest('.jstree-node').find('> a > .node-name');
                  if (action === 'createCopy') {
                    $nameSpan.text(resource.combinedName);
                  } else {
                    $nameSpan.text(resource.text);
                  }

                  // Store the action for this node and update its resolved state
                  vm.uploadableResourcesMap.get(nodeId).resolveMethod = action;
                  $dropdown.closest('.jstree-node').attr('data-resolved', action ? 'true' : 'false');

                  const tree = $('#jstree-valid').jstree(true);
                  const node = tree.get_node(nodeId);

                  // Handle child nodes if needed
                  if (node.children?.length) {
                    updateChildActions(node, action, tree);
                  }

                  // Check if all conflicts are now resolved
                  checkConflictResolution();

                  // Since we're outside Angular's digest cycle, we need to trigger it
                  $scope.$apply();
                });
              });

              $(this).find('.open-original').off('click').on('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                // Get the node ID by finding the closest jstree-node and its select element
                const $node = $(this).closest('.jstree-node');
                const nodeId = $node.find('> a > select.node-action').data('node-id');
                return vm.openOriginal(nodeId) || false;
              });
            })
            .on('dragover', function (event) {
              event.preventDefault();
              event.stopPropagation();
            })
            .on('drop', async function (event) {
              event.preventDefault();
              event.stopPropagation();
              const items = event.originalEvent.dataTransfer.items;
              if (items) {
                await handleDnd(items);
              }
            });
          $('#jstree-invalid').jstree({
            'core': {
              'check_callback': true,
              'data': function (obj, callback) {
                callback($scope.importStatus.invalidFiles);
              }
            },
          })
            .on('dragover', function (event) {
              event.preventDefault();
              event.stopPropagation();
            })
            .on('drop', function (event) {
              event.preventDefault();
              event.stopPropagation();
            });

        }, 0);

        angular.element($window).on('dragover', function (event) {
          event.preventDefault();
          event.stopPropagation();
        });

        angular.element($window).on('drop', function (event) {
          event.preventDefault();
          event.stopPropagation();
        });
      }

      vm.openOriginal = function (nodeId) {
        console.log('Node ID:', nodeId);
        const resource = vm.uploadableResourcesMap.get(nodeId);

        let targetUrl;
        switch (resource.resourceType) {
          case CONST.resourceType.TEMPLATE:
            targetUrl = FrontendUrlService.getTemplateEdit(resource.cedarId);
            break;
          case CONST.resourceType.ELEMENT:
            targetUrl = FrontendUrlService.getElementEdit(resource.cedarId);
            break;
          case CONST.resourceType.FIELD:
            targetUrl = FrontendUrlService.getFieldEdit(resource.cedarId);
            break;
          case CONST.resourceType.INSTANCE:
            targetUrl = FrontendUrlService.getInstanceEdit(resource.cedarId);
            break;
          default:
            console.warn('Unknown resource type:', resource.resourceType);
            return;
        }

        window.open(targetUrl, '_blank');
      };

      function checkConflictResolution() {
        let allResolved = true;

        for (const [id, resource] of vm.uploadableResourcesMap) {
          if (resource.status === resourceImportStatus.CONFLICTING) {
            if (!resource.resolveMethod) {
              allResolved = false;
              break;
            }
          }
        }

        console.log('allResolved', allResolved, vm.uploadableResourcesMap);
        vm.areAllConflictsResolved = allResolved;
      }

      $scope.$on('arpImportModalVisible', function (event, params) {
        vm.alreadyPresentCedarResources = params[0];
        vm.destinationFolderId = params[1];
        vm.userHomeFolderId = params[2];
        vm.userCanUpload = params[3];
        const url = new URL(vm.destinationFolderId);
        const domain = url.hostname; // This will give you "repo.arp.orgx"
        vm.repoDomain = domain;
        if (!vm.jsTreesInitialized) {
          initJsTrees();
          const filesInput = document.getElementById('filesInput');
          if (filesInput) {
            filesInput.addEventListener('change', (event) => handleUpload(event.target.files));
          }

          const resourcesInput = document.getElementById('resourcesInput');
          if (resourcesInput) {
            resourcesInput.addEventListener('change', (event) => handleUpload(event.target.files));
          }

          const folderInput = document.getElementById('folderInput');
          if (folderInput) {
            folderInput.addEventListener('change', (event) => handleUpload(event.target.files));
          }
        }
        initializeFolderIds();
      });

      function replaceRepoDomain(json, newDomain) {
        if (typeof json === "object" && json !== null) {
          for (const key in json) {
            if (key === "@id" && typeof json[key] === "string") {
              // Replace the entire domain in the URL
              json[key] = json[key].replace(/https?:\/\/[^/]+/, `https://${newDomain}`);
            } else {
              // Recursively process nested objects or arrays
              replaceRepoDomain(json[key], newDomain);
            }
          }
        } else if (Array.isArray(json)) {
          json.forEach(item => replaceRepoDomain(item, newDomain));
        }
      }


      function getZipParentDirectory(filePath) {
        const sanitizedPath = filePath.endsWith('/') ? filePath.slice(0, -1) : filePath;
        const pathParts = sanitizedPath.split('/').filter(Boolean);
        let status = resourceImportStatus.VALID;

        if (pathParts.length < 2) {
          return { parentPath: jsTreeRootFolder, status: status };
        }

        // remove the last part of the path which is the file/folder name
        pathParts.pop();

        // add the jsTree root folder to the path
        pathParts.unshift(jsTreeRootFolder)
        return { parentPath: pathParts.join('/') + '/', status: status };
      }

      function createJSZipLikeStructure(files) {
        const zipStructure = {};
        const fileArray = Array.from(files);

        fileArray.forEach((file) => {
          const { webkitRelativePath, name, size, type } = file;
          const pathParts = webkitRelativePath.split('/');

          pathParts.reduce((currentPath, part, index) => {
            const isFile = index === pathParts.length - 1;
            const fullPath = currentPath + part + (isFile ? '' : '/');

            if (!zipStructure[fullPath]) {
              zipStructure[fullPath] = {
                name: fullPath,
                dir: !isFile,
                date: new Date(file.lastModified),
                comment: '',
                _data: isFile ? file : null,
              };
            }

            return fullPath;
          }, '');
        });

        return zipStructure;
      }

      async function handleUpload(uploadedResources) {
        const uploadPromises = [];
        const jsZipLike = createJSZipLikeStructure(uploadedResources);

        for (const relativePath in jsZipLike) {
          const resource = jsZipLike[relativePath];
          const { parentPath, status } = getZipParentDirectory(relativePath);
          const isTopLevel = parentPath === '#';

          if (resource.dir) {
            uploadPromises.push(processDirectory(resource, parentPath, status, jsZipLike, false, isTopLevel));
          } else {
            // we do not want to process nested zip files
            if (resource['_data'].type === 'application/zip' && isTopLevel) {
              const unzipped = await JSZip.loadAsync(resource['_data']);

              for (const relativePath in unzipped.files) {
                const zipEntry = unzipped.files[relativePath];
                const { parentPath, status } = getZipParentDirectory(relativePath);

                if (zipEntry.dir) {
                  uploadPromises.push(processDirectory(zipEntry, parentPath, status, unzipped.files, false, isTopLevel));
                } else {
                  uploadPromises.push(processFile(zipEntry, parentPath, status));
                }
              }
            } else {
              uploadPromises.push(processFile(resource, parentPath, status));
            }
          }
        }

        await Promise.all(uploadPromises);
        refreshJsTrees();
      }

      async function handleDnd(dndResources) {

        // UIMessageService.showArpImportError("Title", "Message", ["a","b","c","b","c","b","c","b","c","b","c","b","c","b","c","b","c","b","c","b","c","b","c","b","c","b","c","b","c","b","c"])

        const uploadPromises = [];

        for (let i = 0; i < dndResources.length; i++) {
          const resource = dndResources[i];
          if (resource.type === 'application/zip') {
            const file = await new Promise(resolve => resource.webkitGetAsEntry().file(resolve));
            const unzipped = await JSZip.loadAsync(file);

            for (const relativePath in unzipped.files) {
              const zipEntry = unzipped.files[relativePath];
              const { parentPath, status } = getZipParentDirectory(relativePath);

              if (zipEntry.dir) {
                uploadPromises.push(processDirectory(zipEntry, parentPath, status, unzipped.files, true, true));
              } else {
                uploadPromises.push(processFile(zipEntry, parentPath, status));
              }
            }
          } else {
            const entry = resource.webkitGetAsEntry();
            if (entry) {
              if (entry.isDirectory) {
                uploadPromises.push(processDirectory(entry, jsTreeRootFolder, resourceImportStatus.VALID, null, true, true));
              } else {
                uploadPromises.push(processFile(entry, jsTreeRootFolder, resourceImportStatus.VALID));
              }
            } else {
              // Handle unknown resource error
            }
          }
        }

        await Promise.all(uploadPromises);
        refreshJsTrees();
      }

      function isJSZipEntry(entry) {
        return entry && typeof entry.dir === "boolean" && entry.options !== undefined;
      }

      function readFileAsText(file) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (event) => resolve(event.target.result);
          reader.onerror = () => reject(`Error reading file: ${file.name}`);
          reader.readAsText(file);
        });
      }

      function getFile(metadataEntry) {
        return new Promise((resolve, reject) => {
          metadataEntry.file(resolve, reject);
        });
      }

      async function readMetadata(metadataEntry) {
        try {
          const file = await getFile(metadataEntry);
          const metadata = await readFileAsText(file);
          return metadata;
        } catch (err) {
          console.error("Error processing metadata entry:", err);
        }
      }

      async function processDirectory(directoryEntry, parentDirectory, status, otherEntries, isDnd, isParentFolder) {
        return new Promise(async (resolve, reject) => {
          const isZipEntry = isJSZipEntry(directoryEntry);
          const isFse = directoryEntry instanceof FileSystemDirectoryEntry;
          const directoryName = isFse ? directoryEntry.name : directoryEntry.name.slice(0, -1).split('/').pop();
          let resolvedFullPath = parentDirectory.endsWith('/') ? parentDirectory + directoryName : parentDirectory + '/' + directoryName;
          let resolvedDirName = directoryName;
          let resolvedDirStatus = status;
          let cedarDescription = '';

          console.log('++++++ isParentFolder processDirectory', isParentFolder);

          const { resolvedName, resolvedStatus } = await prepareResource(
            resolvedDirName,
            directoryEntry,
            CONST.resourceType.FOLDER,
            parentDirectory,
            vm.uploadedResources,
            isParentFolder
          );


          resolvedDirName = resolvedName;
          if (resolvedStatus !== resourceImportStatus.VALID) {
            // resolvedFullPath = replaceAfterLastSlash(resolvedFullPath, resolvedDirName);
            resolvedDirStatus = resolvedStatus;
          }

          if (!resolvedFullPath.endsWith('/')) {
            resolvedFullPath += '/';
          }

          // Find the hidden metadata file for the folder and set the description from it
          if (isZipEntry) {
            const dirNameWithFolder = directoryEntry.name.slice(0, -1);
            const folderMetadataName = replaceAfterLastSlash(dirNameWithFolder, '.' + directoryName + '_metadata.json');
            for (const zipEntryName in otherEntries) {
              if (zipEntryName === folderMetadataName) {
                try {
                  const metadataJson = await otherEntries[zipEntryName].async("string");
                  const metadata = parseJSON(metadataJson);
                  if (metadata['schema:description']) {
                    cedarDescription = metadata['schema:description'];
                  }
                } catch (error) {
                  console.error(`Error reading metadata for ${zipEntryName}:`, error);
                }
                break; // No need to check further as only one match is possible
              }
            }
          } else if (otherEntries !== null) {
            if (!isFse) {
              const dirNameWithFolder = directoryEntry.name.slice(0, -1);
              const folderMetadataName = replaceAfterLastSlash(dirNameWithFolder, '.' + directoryName + '_metadata.json')
              for (const entryName in otherEntries) {
                if (entryName === folderMetadataName) {
                  const metadata = await readFileAsText(otherEntries[entryName]['_data']);
                  const parsedMeta = parseJSON(metadata)
                  if (parsedMeta["schema:description"]) {
                    cedarDescription = parsedMeta["schema:description"];
                  }
                  break;
                }
              }
            } else {
              const folderMetadataName = '.' + directoryName + '_metadata.json';
              for (const metadataEntry of otherEntries) {
                if (metadataEntry.name === folderMetadataName) {
                  cedarDescription = metadataEntry['schema:description'];
                  const metadata = await readMetadata(metadataEntry);
                  const parsedMeta = parseJSON(metadata)
                  if (parsedMeta["schema:description"]) {
                    cedarDescription = parsedMeta["schema:description"];
                  }
                  break;
                }
              }
            }
          }

          const newDirectory = {
            id: resolvedFullPath, // Unique ID for the resource
            parent: parentDirectory, // Parent directory ID
            text: directoryName, // Display name
            icon: "fa " + arpService.getResourceIcon(CONST.resourceType.FOLDER), // use the same CEDAR like icon
            // a_attr: { "title": "This is a folder" },
            // "icon": "jstree-folder", // Use jsTree's folder icon
            type: "folder", // Custom type to indicate folders
            resourceType: "folder", // resourceType of the directory
            children: [], // No child resource needs to be cached in this case
            status: resolvedDirStatus, // Status of the directory
            cedarDescription: cedarDescription // CEDAR description of the directory
          };

          // if a folder is actually conflicting, which means there is already a folder with the same name in CEDAR, we need to add the copyName property
          // which will be the name of the folder if the create copy option is selected
          if (resolvedDirStatus === resourceImportStatus.CONFLICTING) {
            newDirectory.copyName = resolvedDirName; // Name of the directory in CEDAR, if the create copy option is selected
            newDirectory.combinedName = directoryName + ' (' + resolvedDirName + ')';
            newDirectory.text = directoryName;
          } else {
            newDirectory.a_attr = { "title": "Only the content of this folder is conflicting." }
          }

          vm.uploadedResources.push(newDirectory);

          // if a JSZip or a File list was uploaded via the folder uploader and not via drag and drop
          // in both cases the file and folder paths are processed separately
          if (isDnd) {
            let reader = directoryEntry.createReader();

            await new Promise((resolve, reject) => {
              reader.readEntries(async function (entries) {
                const entryPromises = entries.map(entry => {
                  if (entry.isDirectory) {
                    return processDirectory(entry, resolvedFullPath, resolvedDirStatus, entries, isDnd, false);
                  } else {
                    return processFile(entry, resolvedFullPath, resolvedDirStatus);
                  }
                });
                await Promise.all(entryPromises);
                resolve();
              }, reject);
            });
          }


          resolve();
        });
      }

      async function processFile(fileEntry, parentDirectory, status) {
        console.log('fileEntry', fileEntry);
        console.log('parentDirectory', parentDirectory);
        console.log('status', status);
        return new Promise(async (resolve, reject) => {
          try {
            // Determine the type of fileEntry (FileSystemEntry or JSZip entry)
            const notFse = isJSZipEntry(fileEntry);
            const fileAlreadyPresent = fileEntry['_data'] instanceof File;
            const fileName = notFse ? fileEntry.name.split('/').pop() : fileAlreadyPresent ? fileEntry['_data'].name : fileEntry.name;

            if (fileName.startsWith(".") || fileName.startsWith("__MACOSX")) {
              return resolve(); // Skip hidden files
            }

            let resolvedFileStatus =
              status === resourceImportStatus.DUPLICATE
                ? resourceImportStatus.DUPLICATE
                : (fileName.split('.').pop().toLowerCase() !== 'json' ? resourceImportStatus.UNSUPPORTED : status);

            let resolvedFileName = fileName;

            const addFileToResources = async (fileContent = null) => {
              const resourceType =
                resolvedFileStatus !== resourceImportStatus.UNSUPPORTED && fileContent !== null
                  ? arpService.getContentType(fileContent)
                  : null;

              // If the type is still null, the file is unsupported, but if its already a duplicate is does not matter
              if (resourceType === null && resolvedFileStatus !== resourceImportStatus.DUPLICATE) {
                resolvedFileStatus = resourceImportStatus.UNSUPPORTED;
              }

              if (resolvedFileStatus !== resourceImportStatus.UNSUPPORTED) {

                const { resolvedName, resolvedStatus } = await prepareResource(
                  resolvedFileName.split('.json')[0],
                  fileContent,
                  resourceType,
                  parentDirectory,
                  vm.uploadedResources,
                  false
                );

                resolvedFileName = resolvedName;
                resolvedFileStatus = resolvedStatus;
              }

              const fileId = parentDirectory.endsWith("/")
                ? `${parentDirectory}${fileName}`
                : `${parentDirectory}/${fileName}`;

              const newFile = {
                id: fileId,
                parent: parentDirectory,
                text: fileName,
                originalName: fileName,
                icon: "fa " + arpService.getResourceIcon(resourceType),
                type: "file",
                status: resolvedFileStatus,
                content: fileContent,
                resourceType: resourceType,
                //li_attr: { title: "This is a file" },
                //a_attr: { "data-tooltip": "Template" },
                cedarId: fileContent['@id']
              };

              if (resolvedFileStatus !== resourceImportStatus.VALID && resolvedFileName !== '') {
                newFile.text = fileName + ' (' + resolvedFileName + ')';
              }

              vm.uploadedResources.push(newFile);
              console.log('newFile', newFile);
              console.log('vm.uploadedResources', vm.uploadedResources);
            };

            if (resolvedFileStatus === resourceImportStatus.UNSUPPORTED) {
              // Skip reading content but add file with 'UNSUPPORTED' status
              await addFileToResources();
            } else if (notFse) {
              // Handle JSZip entry
              try {
                const fileContent = await fileEntry.async("string");
                await addFileToResources(parseJSON(fileContent));
              } catch (error) {
                console.error(`Error reading JSZip entry: ${error}`);
                throw new Error(`Error reading JSZip entry: ${error}`);
              }
            } else {
              let file;
              if (fileAlreadyPresent) {
                // handle resource that was uploaded via the file uploader
                // in this case we create a JSZip like object from the uploaded data in the createJSZipLikeStructure function
                file = fileEntry['_data']
              } else {
                // Handle FileSystemEntry
                file = await new Promise((resolve, reject) => {
                  fileEntry.file(
                    (file) => resolve(file),
                    (error) => reject(`Error getting file: ${error}`)
                  );
                });
              }

              try {
                const fileContent = await readFileAsText(file);
                await addFileToResources(parseJSON(fileContent));
              } catch (error) {
                console.error(error);
                throw new Error(error);
              }
            }
            resolve();
          } catch (error) {
            console.error("Error processing file:", error);
            reject(error);
          }
        });
      }

      function setParentFolderStatus(parentFolderId, newStatus) {
        const parentFolder = vm.uploadedResources.find(resource => resource.id === parentFolderId);
        if (parentFolder) {
          parentFolder.status = newStatus;
        }
        if (parentFolder.parent !== jsTreeRootFolder) {
          setParentFolderStatus(parentFolder.parent, newStatus)
        }
      }

      // resolve name duplicates
      // if a resource is being reuploaded with the same name it gets a new suffixed name like: template -> template_1
      const generateNewName = (name, alreadyPresentNames) => {
        let newName = name;
        let i = 1;
        while (alreadyPresentNames.includes(newName)) {
          newName = name.endsWith('/') ? `${name.slice(0, -1)}_${i}` : `${name}_${i}`;
          i++;
        }

        return newName;
      }

      // Replaces repo domains, resolves name duplicates, sets import status and saves the CEDAR id for already present resources
      async function prepareResource(resourceName, resourceContent, resourceType, entryParent, uploadedResources, isParentFolder, fileExtension = '.json') {
        // The name of the resource in CEDAR
        let existingName = ''

        // const resourceName = (() => {
        //   let name;
        //   if (resourceType === CONST.resourceType.FOLDER) {
        //     if (resourceContent instanceof FileSystemDirectoryEntry) {
        //       name = resourceContent.name;
        //     } else {
        //       name = resourceContent.name.slice(0, -1).split('/').pop();
        //     }
        //   } else {
        //     name = resourceContent['schema:name'];
        //   }
        //   return name.endsWith('/') ? name.slice(0, -1) : name;
        // })();

        let status = resourceImportStatus.VALID;
        let newName = resourceName;
        if (resourceType !== CONST.resourceType.FOLDER) {
          replaceRepoDomain(resourceContent, vm.repoDomain)

          const alreadyPresentResourceNames = new Set();

          // Check against the uploaded resources, if the resource is already present,
          // that means the user tried to upload the same resource multiple times and the system will reject it
          // Collect names of resources that match the @id
          uploadedResources
            .filter(res => res.cedarId === resourceContent['@id'])
            .forEach(res => {
              // save the originalName without the file extension and any suffixes, like the name of the duplicates etc.
              alreadyPresentResourceNames.add(res.originalName);
              status = resourceImportStatus.DUPLICATE;
            });

          existingName = [...alreadyPresentResourceNames].join(', ');

          // If the resource is not already present in the uploaded resources, check against the already existing CEDAR resources
          if (status === resourceImportStatus.VALID) {
            try {
              const resReport = await arpService.getResourceReportById(resourceContent['@id'], resourceType);
              status = resourceImportStatus.CONFLICTING
              setParentFolderStatus(entryParent, status)
              if (resReport['schema:name'] !== resourceContent['schema:name']) {
                existingName = resReport['schema:name']
              }
            } catch (e) {
              console.log(e)
            }
          }

          // newName stores the name of the duplicates separated by commas
          newName = existingName
        } else if (isParentFolder) {
          // Check if any folder among the vm.alreadyPresentCedarResources (the CEDAR resources in the destination folder) has the same name as the current entry
          if (entryParent === jsTreeRootFolder) {
            const folderNames = vm.alreadyPresentCedarResources.filter(res => res.resourceType === CONST.resourceType.FOLDER).map(res => res['schema:name']);
            if (folderNames.includes(newName)) {
              status = resourceImportStatus.CONFLICTING;
              const generatedName = generateNewName(newName, folderNames);
              newName = generatedName;
            }
          }

          // Check if any folder among the vm.uploadedResources has the same id as the fullPath of the current entry
          const fullPath = entryParent.endsWith('/') ? entryParent + newName : entryParent + '/' + newName + '/';
          const uploadedFolder = vm.uploadedResources.find(res => res.id === fullPath && res.resourceType === CONST.resourceType.FOLDER);
          if (uploadedFolder) {
            status = resourceImportStatus.DUPLICATE;
            const alreadyPresentFolderNames = vm.uploadedResources
              .filter(res => res.resourceType === CONST.resourceType.FOLDER)
              .map(res => res.text);
            const generatedName = generateNewName(newName, alreadyPresentFolderNames);
            newName = generatedName;
          }
        }
        return { resolvedName: newName, resolvedStatus: status };
      }

      function parseJSON(input) {
        let parsedJSON = null;
        try {
          if (typeof input === "string") {
            parsedJSON = JSON.parse(input);
          } else if (input instanceof ArrayBuffer) {
            // Decode the ArrayBuffer into a string
            const decoder = new TextDecoder("utf-8");
            const jsonString = decoder.decode(input);
            parsedJSON = JSON.parse(jsonString);
          }

          return parsedJSON;
        } catch (error) {
          console.error("Failed to parse JSON:", error);
          return parsedJSON;
        }
      }

      function refreshJsTrees() {
        $timeout(function () {

          // Process each resource
          vm.uploadedResources.forEach(item => {
            if (item.type === 'file') {
              const isValidOrConflicting = [resourceImportStatus.VALID, resourceImportStatus.CONFLICTING].includes(item.status);

              if (isValidOrConflicting) {
                // Add to uploadable resources
                addResourceToMap(vm.uploadableResourcesMap, item.id, item);
                updateParentFoldersRecursively(item.parent, item.status);
              } else {
                // Handle invalid resources (duplicates and unsupported)
                const parentFolderId = item.status === resourceImportStatus.DUPLICATE ?
                  'duplicatedResFolderId' : 'unsupportedResFolderId';

                const updatedItem = updateInvalidResourceParent(item, parentFolderId, vm.invalidResourcesMap);
                addResourceToMap(vm.invalidResourcesMap, updatedItem.id, updatedItem);

                // Add special folders if not already added
                if (!vm.invalidResourcesMap.has(parentFolderId)) {
                  const folderConfig = {
                    id: `${jsTreeRootFolder}/${parentFolderId}/`,
                    parent: jsTreeRootFolder,
                    text: item.status === resourceImportStatus.DUPLICATE ? "Duplicated Resources" : "Unsupported Resources",
                    icon: item.status === resourceImportStatus.DUPLICATE ? "fa fa-clone" : "fa fa-ban",
                    a_attr: item.status === resourceImportStatus.DUPLICATE ? { "title": "The content of this folder is already a part of the upload." } : { "title": "The content of this folder is unsupported." },
                    type: "folder",
                    resourceType: "folder"
                  };
                  addResourceToMap(vm.invalidResourcesMap, parentFolderId, folderConfig);
                }
              }
            }
          });

          // Update the import status
          $scope.importStatus.validFiles = Array.from(vm.uploadableResourcesMap.values());
          $scope.importStatus.invalidFiles = Array.from(vm.invalidResourcesMap.values());

          // Refresh jsTrees
          $('#jstree-valid').jstree(true).refresh();
          $('#jstree-invalid').jstree(true).refresh();
        }, 100);
      }

      $scope.isFileAndDirectoryUploadSupported = supportsFileAndDirectoryUpload();

      // TODO: remove unused code

      // $scope.$watch('importStatus.active', function (newVal) {
      //   console.log("Active tab changed to index:", newVal);
      // });

      // Add these helper functions before refreshJsTrees
      function addResourceToMap(map, id, resource) {
        if (!map.has(id)) {
          if (resource.status === resourceImportStatus.CONFLICTING) {
            resource.resolveMethod = null;
          }
          map.set(id, resource);
        }
      }

      function updateParentFoldersRecursively(parentFolderId, status) {
        if (parentFolderId === jsTreeRootFolder + '/') {
          return;
        }

        const parentFolder = vm.uploadedResources.find(item =>
          item.id === parentFolderId && item.type === 'folder');

        if (parentFolder) {
          if (status === resourceImportStatus.VALID || status === resourceImportStatus.CONFLICTING) {
            const isParentConflict = parentFolder.status === resourceImportStatus.CONFLICTING && parentFolder.combinedName;
            parentFolder.status = isParentConflict ? resourceImportStatus.CONFLICTING : status;
            if (isParentConflict && parentFolder.parent === jsTreeRootFolder) {
              parentFolder.a_attr = { "title": "In case of creating a copy, this folder will be uploaded with the name in the parentheses." }
              parentFolder.icon = "fa fa-folder-o";
            }
            addResourceToMap(vm.uploadableResourcesMap, parentFolderId, parentFolder);
          } else {
            parentFolder.status = status;
            addResourceToMap(vm.invalidResourcesMap, parentFolderId, parentFolder);
          }

          const directParent = parentFolderId.endsWith('/') ?
            parentFolderId.substring(0, parentFolderId.lastIndexOf('/', parentFolderId.length - 2) + 1) :
            parentFolderId.substring(0, parentFolderId.lastIndexOf('/') + 1);

          updateParentFoldersRecursively(directParent, status);
        }
      }

      function updateInvalidResourceParent(resource, parentId, invalidResourcesMap) {
        const defaultParentId = jsTreeRootFolder + '/';
        const newParentId = parentId.endsWith('/') ?
          defaultParentId + parentId :
          defaultParentId + parentId + '/';

        // Handle parent folders
        const parentFolders = resource.parent.split('/').filter(Boolean).slice(1);
        let currentPath = jsTreeRootFolder;

        parentFolders.forEach(folder => {
          currentPath += `/${folder}`;
          const parentFolder = vm.uploadedResources.find(res => res.id === currentPath + '/');
          if (parentFolder) {
            const parentFolderClone = structuredClone(parentFolder);
            parentFolderClone.parent = parentFolderClone.parent === jsTreeRootFolder ?
              parentFolderClone.parent.replace(jsTreeRootFolder, newParentId) :
              parentFolderClone.parent.replace(defaultParentId, newParentId);
            parentFolderClone.id = parentFolderClone.id.replace(defaultParentId, newParentId);
            addResourceToMap(invalidResourcesMap, parentFolderClone.id, parentFolderClone);
          }
        });

        // Update resource paths
        const invalidRes = structuredClone(resource);
        invalidRes.parent = invalidRes.parent === jsTreeRootFolder ?
          invalidRes.parent.replace(jsTreeRootFolder, newParentId) :
          invalidRes.parent.replace(defaultParentId, newParentId);
        invalidRes.id = invalidRes.id.replace(defaultParentId, newParentId);

        return invalidRes;
      }

      // Helper function to replace last part of path
      function replaceAfterLastSlash(str, newString) {
        const lastSlashIndex = str.lastIndexOf('/');
        if (lastSlashIndex === -1) {
          return newString;
        }
        return str.substring(0, lastSlashIndex + 1) + newString + '/';
      }
    }

    return {
      bindToController: {
        modalVisible: '=',
        importFolderId: '=',
        refreshWorkspace: '='
      },
      controller: cedarArpImportModalController,
      controllerAs: 'arpimport',
      restrict: 'E',
      templateUrl: 'scripts/modal/cedar-arp-import-modal.directive.html'
    };

  }
}
);

