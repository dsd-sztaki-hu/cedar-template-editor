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
      '$translate'
    ];

    function cedarArpImportModalController($scope, $timeout,
      UrlService, arpService, CONST, $window, $translate) {

      let vm = this;

      $scope.importStatus = {
        'active': 0,
        'validFiles': [],
        'conflictingFiles': [],
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

      vm.importFileStatus = {
        UPLOADING: { "value": "uploading", "message": "Uploading" },
        UPLOAD_COMPLETE: { "value": "uploaded", "message": "Queued" },
        IMPORTING: { "value": "importing", "message": "Importing" },
        IMPORT_COMPLETE: { "value": "complete", "message": "Complete" },
        ERROR: { "value": "error", "message": "Error" },
      };

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

      // Getter for conflict resolution method
      vm.getConflictResolutionMethod = function () {
        return vm.conflictResolutionMethod;
      };

      // Setter for conflict resolution method
      vm.setConflictResolutionMethod = function (method) {
        vm.conflictResolutionMethod = method;
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
          if (vm.validResourcesMap.has(folderResource.id) || vm.conflictingResourcesMap.has(folderResource.id)) {
            const cedarFolderId = await arpService.createFolderAsync(
              vm.folderIds.get(folderResource.parent),
              folderResource.text,
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
          'conflictingFiles': [],
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

        // Helper function to update child actions
        function updateChildActions(node, action, tree) {
          console.log('updateChildActions');
          if (node.children && node.children.length > 0) {
            node.children.forEach(childId => {
              // Update the data-resolved attribute for this child node
              const childNode = tree.get_node(childId);
              if (childNode) {
                // Update the action in memory
                vm.uploadableResourcesMap.get(childId).resolveMethod = action;

                // Update the dropdown value if it exists
                const dropdown = $(`.node-action[data-node-id="${childId}"]`);
                if (dropdown.length) {
                  console.log('dropdown', dropdown);
                  dropdown.val(action);
                  dropdown.closest('.jstree-node').attr('data-resolved', action ? 'true' : 'false');
                }

                // Recursively update children
                updateChildActions(childNode, action, tree);
              }
            });
          }
        }

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
                      `${resource.text}<select class="node-action" data-node-id="${resource.id}">
                        <option value="">Action...</option>
                        <option value="replace">Replace</option>
                        <option value="copy">Copy</option>
                        <option value="skip">Skip</option>
                       </select>` : resource.text
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
              $(this).find('.node-action').each(function() {
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

                  // Store the action for this node and update its resolved state
                  vm.uploadableResourcesMap.get(nodeId).resolveMethod = action;
                  $dropdown.closest('.jstree-node').attr('data-resolved', action ? 'true' : 'false');

                  // Handle child nodes if needed
                  const tree = $('#jstree-valid').jstree(true);
                  const node = tree.get_node(nodeId);
                  if (node.children && node.children.length > 0) {
                    updateChildActions(node, action, tree);
                  }
                  
                  // Check if all conflicts are now resolved
                  checkConflictResolution();

                  // Since we're outside Angular's digest cycle, we need to trigger it
                  $scope.$apply();
                });
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
          $('#jstree-conflicting').jstree({
            'core': {
              'check_callback': true,
              'data': function (obj, callback) {
                callback($scope.importStatus.conflictingFiles);
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

      function getZipParentDirectory(filePath, zipRenameMap) {
        const sanitizedPath = filePath.endsWith('/') ? filePath.slice(0, -1) : filePath;
        const pathParts = sanitizedPath.split('/').filter(Boolean);
        let status = resourceImportStatus.VALID;

        if (pathParts.length < 2) {
          return { parentPath: jsTreeRootFolder, status: status };
        }

        // remove the last part of the path which is the file/folder name
        pathParts.pop();
        let parentName = pathParts[0];

        if (zipRenameMap.has(parentName)) {
          const renameInfo = zipRenameMap.get(parentName);
          pathParts[0] = renameInfo.name;
          status = renameInfo.status;
        }

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
        const folderRenameMap = new Map();
        const jsZipLike = createJSZipLikeStructure(uploadedResources);
        for (const relativePath in jsZipLike) {
          const resource = jsZipLike[relativePath];
          const { parentPath, status } = getZipParentDirectory(relativePath, folderRenameMap);
          const isTopLevel = parentPath === '#';

          if (resource.dir) {
            uploadPromises.push(processDirectory(resource, parentPath, status, jsZipLike, folderRenameMap));
          } else {
            // we do not want to process nested zip files
            if (resource['_data'].type === 'application/zip' && isTopLevel) {
              const unzipped = await JSZip.loadAsync(resource['_data']);
              const zipRenameMap = new Map();

              for (const relativePath in unzipped.files) {
                const zipEntry = unzipped.files[relativePath];
                const { parentPath, status } = getZipParentDirectory(relativePath, zipRenameMap);

                if (zipEntry.dir) {
                  uploadPromises.push(processDirectory(zipEntry, parentPath, status, unzipped.files, zipRenameMap));
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
            const zipRenameMap = new Map();

            for (const relativePath in unzipped.files) {
              const zipEntry = unzipped.files[relativePath];
              const { parentPath, status } = getZipParentDirectory(relativePath, zipRenameMap);

              if (zipEntry.dir) {
                uploadPromises.push(processDirectory(zipEntry, parentPath, status, unzipped.files, zipRenameMap));
              } else {
                uploadPromises.push(processFile(zipEntry, parentPath, status));
              }
            }
          } else {
            const entry = resource.webkitGetAsEntry();
            if (entry) {
              if (entry.isDirectory) {
                uploadPromises.push(processDirectory(entry, jsTreeRootFolder, resourceImportStatus.VALID, null, null));
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

      async function processDirectory(directoryEntry, parentDirectory, status, otherEntries, folderRenameMap = null) {
        function replaceAfterLastSlash(str, newString) {
          const lastSlashIndex = str.lastIndexOf('/');

          if (lastSlashIndex === -1) {
            return newString;
          }

          return str.substring(0, lastSlashIndex + 1) + newString + '/';
        }

        return new Promise(async (resolve, reject) => {
          const isZipEntry = isJSZipEntry(directoryEntry);
          const isFse = directoryEntry instanceof FileSystemDirectoryEntry;
          const directoryName = isFse ? directoryEntry.name : directoryEntry.name.slice(0, -1).split('/').pop();
          let resolvedFullPath = parentDirectory.endsWith('/') ? parentDirectory + directoryName : parentDirectory + '/' + directoryName;
          // let resolvedFullPath = parentDirectory.endsWith('/') ? parentDirectory : parentDirectory + '/';
          let resolvedDirName = directoryName;
          let resolvedDirStatus = status;
          let cedarDescription = ''

          const { resolvedName, resolvedStatus } = await prepareResource(directoryEntry, CONST.resourceType.FOLDER, parentDirectory, vm.uploadedResources, folderRenameMap);
          resolvedDirName = resolvedName;
          if (resolvedStatus !== resourceImportStatus.VALID) {
            resolvedFullPath = replaceAfterLastSlash(resolvedFullPath, resolvedDirName);
            resolvedDirStatus = resolvedStatus;
          }

          if (!resolvedFullPath.endsWith('/')) {
            resolvedFullPath += '/';
          }

          // Find the hidden metadata file for the folder and set the description from it
          if (isZipEntry) {
            const dirNameWithFolder = directoryEntry.name.slice(0, -1);
            const folderMetadataName = replaceAfterLastSlash(dirNameWithFolder, '.' + resolvedDirName + '_metadata.json');
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
              const folderMetadataName = replaceAfterLastSlash(dirNameWithFolder, '.' + resolvedDirName + '_metadata.json')
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
            text: resolvedDirName, // Display name
            icon: "fa " + arpService.getResourceIcon(CONST.resourceType.FOLDER), // use the same CEDAR like icon
            // li_attr: { "title": "This is a folder" },
            // "icon": "jstree-folder", // Use jsTree's folder icon
            type: "folder", // Custom type to indicate folders
            resourceType: "folder", // resourceType of the directory
            children: [], // No child resource needs to be cached in this case
            status: resolvedDirStatus, // Status of the directory
            cedarDescription: cedarDescription // CEDAR description of the directory
          };

          vm.uploadedResources.push(newDirectory);

          // if the folderRenameMap is not null that means the input was either a JSZip or a File list uploaded via the folder uploader and not via drag and drop
          // in both cases the file and folder paths are processed separately
          if (folderRenameMap === null) {
            let reader = directoryEntry.createReader();

            await new Promise((resolve, reject) => {
              reader.readEntries(async function (entries) {
                const entryPromises = entries.map(entry => {
                  if (entry.isDirectory) {
                    return processDirectory(entry, resolvedFullPath, resolvedDirStatus, entries, folderRenameMap);
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

              if (resolvedFileStatus !== resourceImportStatus.UNSUPPORTED && resolvedFileStatus !== resourceImportStatus.DUPLICATE) {
                const fileNameWithoutExtension = fileName.split('.json').shift();

                const { resolvedName, resolvedStatus } = await prepareResource(
                  fileContent,
                  resourceType,
                  parentDirectory,
                  vm.uploadedResources
                );

                resolvedFileName = resolvedName;
                resolvedFileStatus = resolvedStatus;
              }

              const fileId = parentDirectory.endsWith("/")
                ? `${parentDirectory}${resolvedFileName}`
                : `${parentDirectory}/${resolvedFileName}`;

              const newFile = {
                id: fileId,
                parent: parentDirectory,
                text: resolvedFileName,
                icon: "fa " + arpService.getResourceIcon(resourceType),
                type: "file",
                status: resolvedFileStatus,
                content: fileContent,
                resourceType: resourceType,
                //li_attr: { title: "This is a file" },
                //a_attr: { "data-tooltip": "Template" },
                cedarId: fileContent['@id']
              };

              vm.uploadedResources.push(newFile);
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
      async function prepareResource(entry, entryType, entryParent, uploadedResources, folderRenameMap = null, fileExtension = '.json') {
        // The name of the resource in CEDAR
        let cedarName = ''

        const resourceName = (() => {
          let name;
          if (entryType === CONST.resourceType.FOLDER) {
            if (entry instanceof FileSystemDirectoryEntry) {
              name = entry.name;
            } else {
              name = entry.name.slice(0, -1).split('/').pop();
            }
          } else {
            name = entry['schema:name'];
          }
          return name.endsWith('/') ? name.slice(0, -1) : name;
        })();

        let status = resourceImportStatus.VALID;
        let newName = resourceName;
        if (entryType !== CONST.resourceType.FOLDER) {
          replaceRepoDomain(entry, vm.repoDomain)

          // Check against the already existing CEDAR resources first
          try {
            const resReport = await arpService.getResourceReportById(entry['@id'], entryType);
            status = resourceImportStatus.CONFLICTING
            setParentFolderStatus(entryParent, status)
            if (resReport['schema:name'] !== entry['schema:name']) {
              cedarName = resReport['schema:name']
            }
          } catch (e) {
            console.log(e)
          }

          const alreadyPresentResourceNames = [];

          // Further check against the uploaded resources, if the resource is already present,
          // that means the user tried to upload the same resource multiple times and the system will reject it
          // Collect names of resources that match the @id
          uploadedResources
            .filter(res => res.cedarId === entry['@id'])
            .forEach(res => {
              // Remove the extension from the uploaded resource
              alreadyPresentResourceNames.push(res.text.split('.json')[0]);
            });

          // check if the resource is already uploaded with the same name
          if (alreadyPresentResourceNames.includes(resourceName)) {
            newName = generateNewName(resourceName, alreadyPresentResourceNames);
            status = resourceImportStatus.DUPLICATE;
          }

          // For better readability, add the file extension to the resource name
          newName += fileExtension;
          if (cedarName !== '' && status === resourceImportStatus.CONFLICTING) {
            newName += ' (' + cedarName + ')'
          }
        } else {
          console.log('entryParent', entryParent)
          // Check if any folder among the vm.alreadyPresentCedarResources (the CEDAR resources in the destination folder) has the same name as the current entry
          if (entryParent === jsTreeRootFolder) {
            const folderNames = vm.alreadyPresentCedarResources.filter(res => res.resourceType === CONST.resourceType.FOLDER).map(res => res['schema:name']);
            if (folderNames.includes(newName)) {
              status = resourceImportStatus.CONFLICTING;
              const generatedName = generateNewName(newName, folderNames);
              // if (folderRenameMap !== null) {
              //   folderRenameMap.set(newName, { name: generatedName, status: status });
              // }
              newName = generatedName;
            }
          }

          // Check if any folder among the vm.uploadedResources has the same id as the fullPath of the current entry
          const mappedName = folderRenameMap && folderRenameMap.has(resourceName) ? folderRenameMap.get(resourceName).name : newName;
          const fullPath = entryParent.endsWith('/') ? entryParent + mappedName : entryParent + '/' + mappedName + '/';
          const uploadedFolder = vm.uploadedResources.find(resource => resource.id === fullPath && resource.resourceType === CONST.resourceType.FOLDER);
          if (uploadedFolder) {
            status = resourceImportStatus.DUPLICATE;
            const alreadyPresentFolderNames = vm.uploadedResources
              .filter(res => res.resourceType === CONST.resourceType.FOLDER)
              .map(res => {
                if (folderRenameMap && folderRenameMap.has(res.text)) {
                  return folderRenameMap.get(res.text).name;
                }
                return res.text;
              });
            const generatedName = generateNewName(mappedName, alreadyPresentFolderNames);
            newName = generatedName;
          }
          if (folderRenameMap !== null) {
            folderRenameMap.set(resourceName, { name: newName, status: status });
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
          function updateInvalidResourceParent(resource, parentId, invalidResources) {
            const defaultParentId = jsTreeRootFolder + '/';
            const newParentId = parentId.endsWith('/') ? defaultParentId + parentId : defaultParentId + parentId + '/';
            const parentFolders = resource.parent.split('/').filter(Boolean).slice(1);
            let currentPath = jsTreeRootFolder;
            parentFolders.forEach(folder => {
              currentPath += `/${folder}`;
              const parentFolder = vm.uploadedResources.find(res => res.id === currentPath + '/');
              if (parentFolder) {
                const parentFolderClone = structuredClone(parentFolder);
                parentFolderClone.parent = parentFolderClone.parent === jsTreeRootFolder ? parentFolderClone.parent.replace(jsTreeRootFolder, newParentId) : parentFolderClone.parent.replace(defaultParentId, newParentId);
                parentFolderClone.id = parentFolderClone.id.replace(defaultParentId, newParentId);
                addResourceToMap(vm.invalidResourcesMap, parentFolderClone.id, parentFolderClone);
              }
            });
            const invalidRes = structuredClone(resource);
            invalidRes.parent = invalidRes.parent === jsTreeRootFolder ? invalidRes.parent.replace(jsTreeRootFolder, newParentId) : invalidRes.parent.replace(defaultParentId, newParentId);
            invalidRes.id = invalidRes.id.replace(defaultParentId, newParentId);
            return invalidRes;
          }

          function addResourceToMap(map, id, resource) {
            if (resource.status === resourceImportStatus.CONFLICTING) {
              resource.resolveMethod = null;
            }
            if (!map.has(id)) {
              map.set(id, resource);
            } else if (map.has(id)) {
              const existingResource = map.get(id);
              if (existingResource.status === resourceImportStatus.VALID && resource.status === resourceImportStatus.CONFLICTING) {
                existingResource.status = resourceImportStatus.CONFLICTING;
                existingResource.resolveMethod = null;
              }
            }
          }

          function getFilesFromMap(map) {
            return Array.from(map.values());
          }

          let addDuplicatedResFolder = true;
          let addUnsupportedResFolder = true;
          const duplicatedResFolderId = "duplicatedResFolderId"
          const unsupportedResFolderId = "unsupportedResFolderId"

          const duplicatedResFolder = {
            id: jsTreeRootFolder + '/' + duplicatedResFolderId + '/', // Unique ID for the resource
            parent: jsTreeRootFolder, // Parent directory ID
            text: "Duplicated Resources", // Display name
            icon: "fa fa-clone",
            li_attr: { "title": "These resources are already included in the upload." }, // Tooltip
            type: "folder", // jsTree type
            resourceType: "folder", // CEDAR resource type
            children: [], // Added by their parent property
            status: null, // Import status, doesn't matter for this folder
            cedarDescription: null // CEDAR description, doesn't matter for this folder
          };

          const unsupportedResFolder = {
            id: jsTreeRootFolder + '/' + unsupportedResFolderId + '/',
            parent: jsTreeRootFolder,
            text: "Unsupported Resources",
            icon: "fa fa-ban",
            li_attr: { "title": "Resources that cannot be uploaded to CEDAR" },
            type: "folder",
            resourceType: "folder",
            children: [],
            status: null,
            cedarDescription: null
          }

          function updateParentFoldersRecursively(parentFolderId, status) {
            if (parentFolderId === jsTreeRootFolder + '/') {
              return;
            }

            const parentFolder = vm.uploadedResources.find(item => item.id === parentFolderId && item.type === 'folder');
            if (parentFolder) {
              if (status === resourceImportStatus.VALID) {
                parentFolder.status = status;
                addResourceToMap(vm.uploadableResourcesMap, parentFolderId, parentFolder);
              } else if (status === resourceImportStatus.CONFLICTING) {
                parentFolder.status = status;
                addResourceToMap(vm.uploadableResourcesMap, parentFolderId, parentFolder);
              } else if (status === resourceImportStatus.DUPLICATE) {
                parentFolder.status = status;
                addResourceToMap(vm.invalidResourcesMap, parentFolderId, parentFolder);
              } else if (status === resourceImportStatus.UNSUPPORTED) {
                parentFolder.status = status;
                addResourceToMap(vm.invalidResourcesMap, parentFolderId, parentFolder);
              }
              const directParent = parentFolderId.endsWith('/')
                ? parentFolderId.substring(0, parentFolderId.lastIndexOf('/', parentFolderId.length - 2) + 1)
                : parentFolderId.substring(0, parentFolderId.lastIndexOf('/') + 1);
              updateParentFoldersRecursively(directParent, status);
            }
          }

          vm.uploadedResources.forEach(item => {
            if (item.type === 'file') {
              // Process file based on status
              if (item.status === resourceImportStatus.VALID || item.status === resourceImportStatus.CONFLICTING) {
                addResourceToMap(vm.uploadableResourcesMap, item.id, item);
                updateParentFoldersRecursively(item.parent, item.status);
              } else if (item.status === resourceImportStatus.DUPLICATE) {
                item = updateInvalidResourceParent(item, duplicatedResFolderId, vm.invalidResourcesMap)
                addResourceToMap(vm.invalidResourcesMap, item.id, item);
                if (addDuplicatedResFolder) {
                  addResourceToMap(vm.invalidResourcesMap, duplicatedResFolderId, duplicatedResFolder);
                }
                addDuplicatedResFolder = false;
              } else if (item.status === resourceImportStatus.UNSUPPORTED) {
                item = updateInvalidResourceParent(item, unsupportedResFolderId, vm.invalidResourcesMap)
                addResourceToMap(vm.invalidResourcesMap, item.id, item)
                if (addUnsupportedResFolder) {
                  addResourceToMap(vm.invalidResourcesMap, unsupportedResFolderId, unsupportedResFolder);
                }
                addUnsupportedResFolder = false;
              }
            }
          });

          // Update the import status
          $scope.importStatus.validFiles = getFilesFromMap(vm.uploadableResourcesMap);
          $scope.importStatus.conflictingFiles = getFilesFromMap(vm.conflictingResourcesMap);
          $scope.importStatus.invalidFiles = getFilesFromMap(vm.invalidResourcesMap);

          console.log('uploadableResourcesMap', vm.uploadableResourcesMap)

          // Refresh jsTrees
          $('#jstree-valid').jstree(true).refresh();
          $('#jstree-conflicting').jstree(true).refresh();
          $('#jstree-invalid').jstree(true).refresh();
        }, 100);
      }

      $scope.isFileAndDirectoryUploadSupported = supportsFileAndDirectoryUpload();

      // $scope.$watch('importStatus.active', function (newVal) {
      //   console.log("Active tab changed to index:", newVal);
      // });
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

