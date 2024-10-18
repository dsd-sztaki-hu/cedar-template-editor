'use strict';

define([
  'angular'
], function (angular) {
  angular.module('cedar.templateEditor.modal.cedarArpImportModalDirective', []).directive('cedarArpImportModal',
    cedarArpImportModalDirective);


  function cedarArpImportModalDirective() {


    cedarArpImportModalController.$inject = [
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

    function cedarArpImportModalController($scope, $rootScope, $timeout, QueryParamUtilsService, UISettingsService,
      UIMessageService, resourceService, TemplateInstanceService,
      AuthorizedBackendService,
      UrlService, ImportService, arpService) {

      let vm = this;

      $scope.importStatus = {
        'active': 0,
        'validFiles': [],
        'conflictingFiles': [],
        'invalidFiles': []
      };

      vm.alreadyPresentCedarResources = {};
      vm.uploadedResources = [];
      vm.jsTreesInitialized = false;

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


      // Statuses used in the Impex Server. Update if the Api changes
      const importFileStatusRestApi = {
        PENDING: "PENDING",
        IN_PROGRESS: "IN_PROGRESS",
        COMPLETE: "COMPLETE",
        ERROR: "ERROR"
      };

      /**
       * Public functions
       */
      vm.getImportUrl = getImportUrl;
      vm.startUpload = startUpload;
      vm.getImportStatus = getImportStatus;
      vm.isImportComplete = isImportComplete;
      vm.isImportSuccessful = isImportSuccessful;
      vm.importFileErrored = importFileErrored;
      vm.getImportFileReport = getImportFileReport;
      vm.resetModal = resetModal;

      /**
       * Function definitions
       */

      function getImportUrl(folderId) {
        return UrlService.importCadsrForms(folderId);
      };

      let importRefreshInterval; // Used to stop refreshing the status once the import is complete

      const inputElement = document.querySelector('input[type="file"]');

      //todo: remove if check is done

      // original function, before adding the pre chech
      /*function startUpload(flow) {
        const zip = new JSZip();
        const fileReader = new FileReader();
        const destinationFolderId = QueryParamUtilsService.getFolderId();
        const folderIds = new Map();

        flow.upload();
        vm.importStatus.submitted = true;

        importRefreshInterval = setInterval(() => {
          refreshAllImportStatuses(flow.files);
        }, 1000);

        for (const flowFile of flow.files) {
          vm.importStatus[flowFile.name] = vm.importFileStatus.UPLOADING;
          if (flowFile.file.type === 'application/zip') {
            zip.loadAsync(flowFile.file)
                .then(async function (unzipped) {
                  // Iterate through each file in the ZIP
                  console.log("FILES", unzipped.files);
                  for (let filename in unzipped.files) {
                    const unzippedFile = unzipped.files[filename];
                    const folderPath = filename.split('/');
                    if (folderPath[folderPath.length - 1] === '') {
                      folderPath.pop();
                    }
                    const newFolderName = folderPath.pop();
                    const parentFolderId = folderPath.length > 1 ? folderIds.get(folderPath.join('/') + '/') : destinationFolderId;
                    console.log('filename', filename);
                    console.log('parentFolderId', parentFolderId);
                    console.log('newFolderName', newFolderName);
                    console.log('folderPath', folderPath)
                    if (unzippedFile.dir) {
                      try {
                        const newFolderId = await arpService.createFolderAsync(parentFolderId, newFolderName, 'ARP.resourceImport.folderDescription');
                        folderIds.set(filename, newFolderId);
                        console.log('folderIds', folderIds);
                      } catch (error) {
                        console.error('ARP.resourceImport.error.folderCreation', error);
                      }
                    } else {
                      const fileContent = await unzippedFile.async('string');
                      await createResource(fileContent, parentFolderId);
                    }
                  }
                })
                .catch(function (error) {
                  UIMessageService.showBackendWarning('ARP.resourceImport.error.unzip', error);
                });
          } else if (flowFile.file.type === 'application/json') {
            readFlowFileContentAsString(flowFile, async function (fileContent) {
              await createResource(fileContent, destinationFolderId)
            });

          } else {
            UIMessageService.showBackendWarning('ARP.resourceImport.error.unsupportedFileFormat', 'ARP.resourceImport.error.unsupportedFileFormatText');
          }
          isImportSuccessful();
        }
      }*/

      function startUpload(flow) {
        const zip = new JSZip();
        const fileReader = new FileReader();
        const destinationFolderId = QueryParamUtilsService.getFolderId();
        const folderIds = new Map();

        flow.upload();
        vm.importStatus.submitted = true;
        console.log('importStatus', vm.importStatus);

        importRefreshInterval = setInterval(() => {
          refreshAllImportStatuses(flow.files);
        }, 1000);

        for (const flowFile of flow.files) {
          vm.importStatus[flowFile.name] = vm.importFileStatus.UPLOADING;
          if (flowFile.file.type === 'application/zip') {
            zip.loadAsync(flowFile.file)
              .then(async function (unzipped) {
                console.log("FILES", unzipped.files);
                const destinationFolderContents = await arpService.getFolderContents(destinationFolderId);
                console.log(destinationFolderContents);
                const alreadyPresentCedarResources = { "topLevelFolders": [], "topLevelFiles": [] }
                for (let resource of destinationFolderContents) {
                  if (resource.resourceType === 'folder') {
                    alreadyPresentCedarResources.topLevelFolders.push(resource['schema:name']);
                  } else {
                    alreadyPresentCedarResources.topLevelFiles.push(resource['schema:name'] + '.json');
                  }
                }
                console.log('alreadyPresentCedarResources', alreadyPresentCedarResources);
                for (let filename in unzipped.files) {
                  const unzippedFile = unzipped.files[filename];
                  if (unzippedFile.dir) {
                    const folderPath = filename.split('/');
                    //drop the empty string
                    folderPath.pop();
                    if (folderPath.length === 1) {
                      if (alreadyPresentCedarResources.topLevelFolders.some(folderName => folderName === folderPath[0])) {
                        console.log('folder already present', folderPath[0]);
                      }
                    }
                  } else {
                    const zipFilePath = filename.split('/');
                    const zipFileName = zipFilePath.pop();
                    if (zipFilePath.length === 0 && alreadyPresentCedarResources.topLevelFiles.some(fileName => fileName === zipFileName)) {
                      console.log('file already present', zipFileName);
                    }
                  }
                }
                // for (let filename in unzipped.files) {
                //   const unzippedFile = unzipped.files[filename];
                //   const folderPath = filename.split('/');
                //   if (folderPath[folderPath.length - 1] === '') {
                //     folderPath.pop();
                //   }
                //   const newFolderName = folderPath.pop();
                //   const parentFolderId = folderPath.length > 1 ? folderIds.get(folderPath.join('/') + '/') : destinationFolderId;
                //   console.log('filename', filename);
                //   console.log('parentFolderId', parentFolderId);
                //   console.log('newFolderName', newFolderName);
                //   console.log('folderPath', folderPath)
                //   if (unzippedFile.dir) {
                //     try {
                //       const newFolderId = await arpService.createFolderAsync(parentFolderId, newFolderName, 'ARP.resourceImport.folderDescription');
                //       folderIds.set(filename, newFolderId);
                //       console.log('folderIds', folderIds);
                //     } catch (error) {
                //       console.error('ARP.resourceImport.error.folderCreation', error);
                //     }
                //   } else {
                //     const fileContent = await unzippedFile.async('string');
                //     await createResource(fileContent, parentFolderId);
                //   }
                // }
              })
              .catch(function (error) {
                UIMessageService.showBackendWarning('ARP.resourceImport.error.unzip', error);
              });
          }
          // else if (flowFile.file.type === 'application/json') {
          //   readFlowFileContentAsString(flowFile, async function (fileContent) {
          //     await createResource(fileContent, destinationFolderId)
          //   });
          //
          // } 
          else {
            UIMessageService.showBackendWarning('ARP.resourceImport.error.unsupportedFileFormat', 'ARP.resourceImport.error.unsupportedFileFormatText');
          }
          isImportSuccessful();
        }
      }

      async function createResource(resourceContent, parentFolderId) {
        const resourceJson = JSON.parse(resourceContent);
        delete resourceJson['@id'];
        delete resourceJson['_arpOriginalFolderId_'];
        delete resourceJson['pav:derivedFrom'];
        arpService.createResource(parentFolderId, resourceJson);
      }

      function readFlowFileContentAsString(flowFile, callback) {
        const fileReader = new FileReader();

        fileReader.onload = function (event) {
          const fileContent = event.target.result;  // This is the file content as a string
          callback(fileContent);  // Call the callback function with the file content
        };

        fileReader.onerror = function (error) {
          console.error("Error reading file:", error);
        };

        // Read the flowFile's content as text
        fileReader.readAsText(flowFile.file);
      }

      // Function to check if all files are processed
      function checkIfAllFilesProcessed() {
        let allProcessed = true;
        for (const flowFile of flow.files) {
          if (vm.importStatus[flowFile] !== vm.importFileStatus.IMPORT_COMPLETE) {
            allProcessed = false;
            break;
          }
        }

        if (allProcessed) {
          clearInterval(importRefreshInterval);
          vm.refreshWorkspace();
        }
      }

      function supportsFileAndDirectoryUpload() {
        // Check if the browser is Safari
        var ua = navigator.userAgent;
        var isSafari = /^((?!chrome|android).)*safari/i.test(ua);
        console.log("isSafari", isSafari);
        return isSafari;
      }

      console.log(supportsFileAndDirectoryUpload())

      function refreshAllImportStatuses(resources) {
        for (const flowFile of resources) {
          refreshImportStatus(flowFile.name);
        }
      }

      function refreshImportStatus(fileName) {
        console.log('refreshImportStatus', fileName);
        console.log('importStatus', vm.importStatus);
        if (vm.importStatus.complete) {
          vm.importStatus[fileName] = vm.importFileStatus.IMPORT_COMPLETE;
        }
      }

      function getImportStatus(fileName) {
        if (vm.importStatus[fileName]) {
          return vm.importStatus[fileName];
        }
      }

      // Checks if the import process is complete or errored
      function isImportSuccessful() {
        if (!vm.importStatus.complete) { // Upload is not complete yet, so import is not complete either
          return false;
        }
        for (const key of Object.keys(vm.importStatus)) {
          if (vm.importStatus[key] !== vm.importFileStatus.IMPORT_COMPLETE) {
            return false;
          }
        }
        clearInterval(importRefreshInterval);
        vm.refreshWorkspace();
        return true;
      }

      function isImportComplete() {
        // if (!vm.importStatus.complete) { // Upload is not complete yet, so import is not complete either
        //   return false;
        // }
        // for (const key of Object.keys(vm.importStatus)) {
        //   if (vm.importStatus[key] != vm.importFileStatus.IMPORT_COMPLETE && vm.importStatus[key] != vm.importFileStatus.ERROR) {
        //     return false;
        //   }
        // }
        return true;
      }

      function importFileErrored(file) {
        if (file.error || getImportStatus(file.name) == vm.importFileStatus.ERROR) {
          return true;
        } else {
          return false;
        }
      }

      function getImportFileReport(fileName) {
        if (vm.importFileReport[fileName]) {
          return vm.importFileReport[fileName];
        }
      }

      function resetModal() {
        $scope.importStatus = {
          'active': 0,
          'validFiles': [],
          'conflictingFiles': [],
          'invalidFiles': []
        };
        vm.uploadedResources = []
        refreshJsTrees();
      };

      function truncateString(str, maxLength) {
        if (str.length <= maxLength) {
          return str
        }
        return str.slice(0, maxLength) + '...'
      }

      // Function to initialize jsTree
      function initJsTrees() {
        $timeout(function () {
          $.noConflict();
          vm.jsTreesInitialized = true;
          console.log("initJsTree");
          $('#jstree-valid').jstree({
            'core': {
              'check_callback': true,
              'data': function (obj, callback) {
                callback($scope.importStatus.validFiles);
                console.log("DATA UPDATED")
              }
            },
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
                await checkUploads(items);
                console.log("DONEZO", vm.uploadedResources)
              } else {
                //TODO: Throw error
              }
            });
          $('#jstree-conflicting').jstree({
            'core': {
              'check_callback': true,
              'data': function (obj, callback) {
                callback($scope.importStatus.conflictingFiles);
                console.log("CONF UPDATED")
              }
            },
          });
          $('#jstree-invalid').jstree({
            'core': {
              'check_callback': true,
              'data': function (obj, callback) {
                callback($scope.importStatus.invalidFiles);
                console.log("INVALID UPDATED")
              }
            },
          });

        }, 0);
      };

      $scope.$on('arpImportModalVisible', function (event, params) {
        const parentFolderResources = params[0];
        const alreadyPresentFolders = [];
        const alreadyPresentFiles = [];
        parentFolderResources.forEach(res => {
          if (res.resourceType === 'folder') {
            alreadyPresentFolders.push(res['schema:name'])
          } else if (res.resourceType === 'file') {
            alreadyPresentFolders.push(res['schema:name'])
          }
        });
        vm.alreadyPresentCedarResources.folders = alreadyPresentFolders;
        vm.alreadyPresentCedarResources.files = alreadyPresentFiles;
        if (!vm.jsTreesInitialized) {
          initJsTrees();
        }
      });

      async function checkUploads(uploadedResources) {

        UIMessageService.showArpImportError("Title", "Message", ["a","b","c","b","c","b","c","b","c","b","c","b","c","b","c","b","c","b","c","b","c","b","c","b","c","b","c","b","c","b","c"])


        function replaceAfterLastSlash(str, newString) {
          const lastSlashIndex = str.lastIndexOf('/');

          if (lastSlashIndex === -1) {
            return newString;
          }

          return str.substring(0, lastSlashIndex + 1) + newString;
        }

        const uploadPromises = [];

        for (let i = 0; i < uploadedResources.length; i++) {
          let entry = uploadedResources[i].webkitGetAsEntry();
          if (entry) {
            const [name, alreadyPresent] = generateNewResourceProps(entry);
            let status = alreadyPresent ? 'conflicting' : 'valid';
            if (entry.isDirectory) {
              uploadPromises.push(processDirectory(entry, replaceAfterLastSlash(entry.fullPath, name), name, '#', status));
            } else if (entry.isFile) {
              const file = uploadedResources[i].getAsFile();
              // if (file.type !== 'application/json') {
              //   status = 'invalid';
              // }
              uploadPromises.push(processFile(entry, "#", status));
            } else {
              //TODO: throw error unkown resource
            }
          }
        }

        function generateNewResourceProps(resource) {
          // check if the resource is already present in CEDAR
          // if present mark it conflicting
          //
          // if the resource is already present in CEDAR 
          // or it is a duplicate among the uploaded files,
          // generate new name for the resource with a suffix
          function preProcessResource(name, existingNames, extension = null) {
            console.log('existingNames', existingNames, 'name', name)
            let newName = name;
            let suffix = 1;

            while (existingNames.includes(newName)) {
              newName = `${name}_${suffix}`;
              suffix++;
            }

            const alreadyPresent = suffix > 1;
            if (alreadyPresent && extension) {
              newName = newName + extension;
            }

            console.log("generatedName", newName, "alreadyPresent", alreadyPresent)

            return [newName, alreadyPresent];
          }

          if (resource.isFile) {
            const existingFileNames = []
            vm.alreadyPresentCedarResources.files.forEach(fileName => existingFileNames.push(fileName.split('.json')[0]))
            vm.uploadedResources.forEach(res => {
              if (res.type === 'file') {
                existingFileNames.push(res.text.split('.json')[0]);
              }
            });
            return preProcessResource(resource.name.split('.json')[0], existingFileNames, '.json');
          } else {
            const existingFolderNames = []
            vm.alreadyPresentCedarResources.folders.forEach(folderName => existingFolderNames.push(folderName))
            vm.uploadedResources.forEach(res => {
              if (res.type === 'folder') {
                existingFolderNames.push(res.text);
              }
            });
            return preProcessResource(resource.name, existingFolderNames);
          }
        }

        // keep this in case we want to flag duplicated uplads as conflicting files too
        // function generateNewResourceProps(resource) {
        //   function generateUniqueName(name, existingNames, extension = null) {
        //     console.log('existingNames', existingNames, 'name', name)
        //     let newName = name;
        //     let suffix = 1;

        //     while (existingNames.includes(newName)) {
        //       newName = `${name}_${suffix}`;
        //       suffix++;
        //     }

        //     const alreadyPresent = suffix > 1;
        //     if (alreadyPresent && extension) {
        //       newName = newName + extension;
        //     }

        //     console.log("generatedName", newName, "alreadyPresent", alreadyPresent)

        //     return [newName, alreadyPresent];
        //   }

        //   if (resource.isFile) {
        //     const existingFileNames = []
        //     vm.alreadyPresentCedarResources.files.forEach(fileName => existingFileNames.push(fileName.split('.json')[0]))
        //     vm.uploadedResources.forEach(res => {
        //       if (res.type === 'file') {
        //         existingFileNames.push(res.text.split('.json')[0]);
        //       }
        //     });
        //     return generateUniqueName(resource.name.split('.json')[0], existingFileNames, '.json');
        //   } else {
        //     const existingFolderNames = []
        //     vm.alreadyPresentCedarResources.folders.forEach(folderName => existingFolderNames.push(folderName))
        //     vm.uploadedResources.forEach(res => {
        //       if (res.type === 'folder') {
        //         existingFolderNames.push(res.text);
        //       }
        //     });
        //     return generateUniqueName(resource.name, existingFolderNames);
        //   }
        // }

        await Promise.all(uploadPromises);
        refreshJsTrees();
        console.log("DONEZO 22222", vm.uploadedResources);
      }

      async function processFile(fileEntry, parentDirectory, status) {
        return new Promise((resolve, reject) => {
          const fileName = fileEntry.name;
          const fileStatus = fileName.split('.').pop().toLowerCase() !== 'json' ? 'invalid' : status;

            fileEntry.file(function (file) {
              const reader = new FileReader();

              reader.onload = function (event) {
                const fileContent = event.target.result;
                console.log("File Content:", fileContent);

                const newFile = {
                  "id": parentDirectory + '/' + fileName,  // Unique ID for file
                  "parent": parentDirectory,  // Parent directory ID
                  "text": fileName,      // Display name
                  "icon": "jstree-file",  // Use jsTree's file icon
                  "type": "file",          // Custom type to identify as file
                  "status": fileStatus,
                  "content": fileContent
                };
                console.log(newFile)
                resolve(vm.uploadedResources.push(newFile));
              };

              reader.readAsText(file);
            })

        });
      }

      async function processDirectory(directoryEntry, fullPath, name, parentDirectory, status) {
        const newDirectory = {
          "id": fullPath,
          "parent": parentDirectory,
          "text": name,
          "icon": "jstree-folder",
          "type": "folder",
          "children": [],
          "status": status
        };

        console.log("newDir", newDirectory)

        return new Promise((resolve, reject) => {
          $timeout(async function () {

            vm.uploadedResources.push(newDirectory);

            let reader = directoryEntry.createReader();
            reader.readEntries(async function (entries) {
              const entryPromises = entries.map(entry => {
                if (entry.isDirectory) {
                  return processDirectory(entry, entry.fullPath, entry.name, fullPath, status);
                } else {
                  return new Promise(async (resolve, reject) => {
                    await processFile(entry, fullPath, status);
                    resolve();
                    // entry.file(async function (file) {
                    //   const fileStatus = file.name.split('.').pop().toLowerCase() !== 'json' ? 'invalid' : status;
                    //   await processFile(file.name, fullPath, fileStatus);
                    //   resolve();
                    // });
                  });
                }
              });

              await Promise.all(entryPromises);
              resolve();
            });
          }
          )
        }, 100);
      };

      // before promises
      // async function checkUploads(uploadedFiles) {
      //   // Loop through dropped items
      //   for (let i = 0; i < uploadedFiles.length; i++) {
      //     let item = uploadedFiles[i].webkitGetAsEntry();
      //     if (item) {
      //       if (item.isDirectory) {
      //         console.log("Folder dropped:", item);
      //         await processDirectory(item, '#'); // Handle folder
      //       } else if (item.isFile) {
      //         let file = uploadedFiles[i].getAsFile();
      //         console.log("File dropped:", file);
      //         await processFile(file, "#"); // Handle file
      //       }
      //     }
      //   }
      //   refreshJsTree();
      // }

      // async function processFile(file, parentDirectory) {

      //   let reader = new FileReader();
      //   reader.onload = function (e) {
      //     // Optionally handle file contents here
      //   };
      //   reader.readAsText(file); // Adjust based on file type

      //   const jsTreeInstance = $('#jstree').jstree(true);
      //   const parentDirId = parentDirectory;

      //   // Introduce a small delay to ensure jsTree updates the newly created directory
      //   $timeout(function () {
      //     const parentNode = jsTreeInstance.get_node(parentDirId);

      //     if (parentNode) {
      //       const newFile = {
      //         "id": file.name,        // Unique ID for file
      //         "parent": parentDirId,  // Parent directory ID
      //         "text": file.name,      // Display name
      //         "icon": "jstree-file",  // Use jsTree's file icon
      //         "type": "file"          // Custom type to identify as file
      //       };

      //       vm.uploadedResources.push(newFile);

      //       // jsTreeInstance.create_node(parentNode, newFile, "last");
      //     } else {
      //       //TODO: add error
      //       console.log("Parent directory still not found for file:", file.name);
      //     }

      //     // For debugging: Check the current jsTree structure
      //     const treeStructure = jsTreeInstance.get_json('#', { flat: false });
      //     console.log("Current jsTree structure FILE:", JSON.stringify(treeStructure, null, 2));
      //   }, 100); // Adding a slight delay to allow jsTree to update
      // }

      // async function processDirectory(directoryEntry, parentDirectory) {
      //   const jsTreeInstance = $('#jstree').jstree(true);
      //   const newDirectory = {
      //     "id": directoryEntry.fullPath, // Unique ID for the directory
      //     "parent": parentDirectory,                 // Parent directory ID
      //     "text": directoryEntry.name,               // Display name
      //     "icon": "jstree-folder",                   // Use jsTree's folder icon
      //     "type": "folder",
      //     "children": []
      //   };

      //   const parentDirId = parentDirectory || '#'; // Handle root directories
      //   $timeout(function () {
      //     const parentNode = jsTreeInstance.get_node(parentDirId);

      //     if (parentNode) {
      //       vm.uploadedResources.push(newDirectory);

      //       let reader = directoryEntry.createReader();
      //       reader.readEntries(function (entries) {
      //         for (let i = 0; i < entries.length; i++) {
      //           if (entries[i].isDirectory) {
      //             processDirectory(entries[i], directoryEntry.fullPath); // Recursive call for nested directories
      //           } else {
      //             entries[i].file(function (file) {
      //               // Process files only after confirming the parent directory exists
      //               processFile(file, directoryEntry.fullPath); // Handle file within folder
      //             });
      //           }
      //         }
      //       });

      //       //todo: this is working, should refact after checking is implemented

      //       // Add the directory and process its contents after it's added
      //       // $('#jstree').jstree(true).create_node(parentDirId, newDirectory, "last", function () {

      //       //   // After directory is created, read its contents
      //       //   let reader = directoryEntry.createReader();
      //       //   reader.readEntries(function (entries) {
      //       //     for (let i = 0; i < entries.length; i++) {
      //       //       if (entries[i].isDirectory) {
      //       //         processDirectory(entries[i], directoryEntry.fullPath); // Recursive call for nested directories
      //       //       } else {
      //       //         entries[i].file(function (file) {
      //       //           // Process files only after confirming the parent directory exists
      //       //           processFile(file, directoryEntry.fullPath); // Handle file within folder
      //       //         });
      //       //       }
      //       //     }
      //       //   });
      //       // });
      //     } else {
      //       //TODO: add error
      //     }
      //   }, 100);
      // }


      function refreshJsTrees() {
        $timeout(function () {

          //TODO: might refact to conflicting resources only
          //TODO: check after suffixes done
          const folderIds = new Set();
          const validFiles = vm.uploadedResources.filter(function (item) {
            if (item.type === 'file' && item.status === 'valid') {
              return true;
            } else if (item.type === 'folder') {
              const containsValidFile = vm.uploadedResources.some(file => file.parent === item.id && file.status === 'valid');
              if (containsValidFile && !folderIds.has(item.id)) {
                console.log("valid folder", item.text)
                folderIds.add(item.id);
                return true;
              }
            }

            return false;
          });

          const conflictingFiles = vm.uploadedResources.filter(function (item) {
            if (item.status === 'conflicting') {
              return true;
            } else if (item.type === 'folder') {
              const containsConflictingFile = vm.uploadedResources.some(file => file.parent === item.id && file.status === 'conflicting');
              if (containsConflictingFile) {
                return true;
              }
            }
            return false;
          });

          const invalidFiles = vm.uploadedResources.filter(function (item) {
            if (item.type === 'file' && item.status === 'invalid') {
              return true;
            } else if (item.type === 'folder') {
              const containsInvalidFile = vm.uploadedResources.some(file => file.parent === item.id && file.status === 'invalid');
              if (containsInvalidFile) {
                return true;
              }
            }
            return false;
          });

          $scope.importStatus.validFiles = validFiles;
          $scope.importStatus.conflictingFiles = conflictingFiles;
          $scope.importStatus.invalidFiles = invalidFiles;

          console.log('CFFILES', $scope.importStatus.conflictingFiles);
          console.log('VALIDFILES', $scope.importStatus.validFiles);
          console.log('INVALIDFILES', $scope.importStatus.invalidFiles);

          $('#jstree-valid').jstree(true).refresh();
          $('#jstree-conflicting').jstree(true).refresh();
          $('#jstree-invalid').jstree(true).refresh();
        }, 100);
      }

      $scope.isFileAndDirectoryUploadSupported = supportsFileAndDirectoryUpload();

      $scope.$watch('importStatus.active', function (newVal) {
        console.log("Active tab changed to index:", newVal);
      });

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
});

