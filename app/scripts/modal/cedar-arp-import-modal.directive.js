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
      'FrontendUrlService',
      'resourceService',
      'UIMessageService'
    ];

    function cedarArpImportModalController($scope, $timeout,
      UrlService, arpService, CONST, $window, $translate, FrontendUrlService, resourceService, UIMessageService) {

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
      vm.isAdmin = false;
      vm.userHomeFolderId = null;
      vm.destinationFolderId = null;
      vm.nodeActions = {};
      vm.areAllConflictsResolved = false;
      vm.hasPermissionIssue = false;
      vm.isImportDone = false;
      vm.isTreeLoading = false;
      vm.invalidWarningShown = false;
      vm.workspaceNeedsRefresh = false;
      vm.notAllCanBeReplaced = false;
      vm.closedNodesValid = [];

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

      // Control the visibility of the panels
      vm.showValidFiles = true;
      vm.showConflictingFiles = true;
      vm.showSkippedFiles = true;
      vm.showCopiedFiles = true;
      vm.showReplacedFiles = true;
      vm.showPermissionIssueFiles = true;

      vm.uploadedResourcesSummary = {
        valid: {
          resources: [],
          count: 0
        },
        copied: {
          resources: [],
          count: 0
        },
        replaced: {
          resources: [],
          count: 0
        },
        skipped: {
          resources: [],
          count: 0
        },
        permissionIssue: {
          resources: [],
          count: 0
        }
      };

      vm.getValidResources = () => vm.uploadedResourcesSummary.valid.resources;
      vm.getValidResourcesCount = () => vm.uploadedResourcesSummary.valid.count;

      vm.getCopiedResources = () => vm.uploadedResourcesSummary.copied.resources;
      vm.getCopiedResourcesCount = () => vm.uploadedResourcesSummary.copied.count;

      vm.getReplacedResources = () => vm.uploadedResourcesSummary.replaced.resources;
      vm.getReplacedResourcesCount = () => vm.uploadedResourcesSummary.replaced.count;

      vm.getSkippedResources = () => vm.uploadedResourcesSummary.skipped.resources;
      vm.getSkippedResourcesCount = () => vm.uploadedResourcesSummary.skipped.count;

      vm.getPermissionIssueResources = () => vm.uploadedResourcesSummary.permissionIssue.resources;
      vm.getPermissionIssueResourcesCount = () => vm.uploadedResourcesSummary.permissionIssue.count;

      /**
       * Public functions
       */
      vm.getImportUrl = getImportUrl;
      vm.startImport = startImport;
      vm.resetModal = resetModal;
      vm.closeModal = closeModal;

      /**
       * Function definitions
       */

      function getImportUrl(folderId) {
        return UrlService.importCadsrForms(folderId);
      };

      /**
       * Sets the conflict resolution method for resources and updates the UI accordingly
       * @param {string} method - The resolution method to apply ('createCopy', 'replace', or 'skip')
       * 
       * This function:
       * 1. Updates all conflicting resources with the selected resolution method
       * 2. Updates the UI to reflect the new status:
       *    - For 'createCopy': Shows new generated names for conflicting resources
       *    - For 'replace': Shows which resources will be replaced (requires write permission)
       *    - For 'skip': Marks resources to be skipped during import
       * 3. Propagates the resolution method to child resources for folders
       * 4. Updates resource counts in each category (valid, copied, replaced, skipped)
       * 5. Enables/disables the Import button based on if all conflicts are resolved
       * 
       * Note: The 'replace' method requires write permissions for the resources.
       * If a resource lacks write permission, it will trigger a permission error dialog.
       */
      vm.setConflictResolutionMethod = function (method) {
        if (vm.uploadableResourcesMap.size === 0) {
          return;
        }

        vm.conflictResolutionMethod = method;

        // Update all resources with the selected method
        vm.uploadableResourcesMap.forEach((resource, id) => {
          resource.resolveMethod = method;
        });

        // Update all nodes and propagate to children
        $('#jstree-valid').find('.jstree-node').each(function () {
          const $node = $(this);
          setAttributes($node, method, true);
        });

        // Update summary counts
        updateUploadedResourcesSummary();

        // Check if all conflicts are resolved
        checkConflictResolution();
        requestAnimationFrame(() => {
          $scope.$apply();
        });
      };

      async function startImport() {
        await runImport();
      }

      $scope.importedFiles = 0;

      // Update the progress tracking function
      function updateProgress(processed) {
        // Use $timeout to ensure digest cycle runs
        $timeout(() => {
          $scope.importedFiles = processed;
          $scope.totalFiles = vm.uploadedResources.length;
        });
      }

      /**
        * Executes the import process for all resources based on their resolution methods
        * 
        * Process Flow:
        * 1. Initialization
        *    - Sets active tab to upload results
        *    - Initializes progress tracking
        *    - Resets import status
        * 
        * 2. Resource Processing
        *    - Iterates through all resources in upload order
        *    - For each resource:
        *      a. Folders: Creates folder structure first (handleFolderImport)
        *         - Creates new folder or uses existing one based on resolution method
        *         - Stores new folder IDs for child resources
        *      b. Resources: Processes individual resources (handleResourceImport)
        *         - Valid resources: Creates new resource
        *         - Conflicting resources: 
        *           * Replace: Updates existing resource if has permission
        *           * Copy: Creates new resource with generated name
        *           * Skip: Skips resource import
        * 
        * 3. Status Updates
        *    - Updates progress bar
        *    - Updates resource status (uploaded, copied, replaced, skipped)
        *    - Handles errors for individual resources
        * 
        * 4. Completion
        *    - Updates workspace if root-level resources were modified
        *    - Shows final import results
        *    - Enables closing the modal
        * 
        * Error Handling:
        * - Individual resource errors don't stop the overall import
        * - Permission issues are handled per resource
        * - Network errors are caught and reported
        * 
        * @throws {Error} If there's a critical error during import
        */
      async function runImport() {
        try {
          $scope.importStatus.active = 2;
          let completedImports = 0;
          const totalImports = vm.uploadedResources.length;

          // Initialize progress
          updateProgress(0);

          // Process each resource sequentially
          for (const resource of vm.uploadedResources) {
            try {
              const uploadableResource = vm.uploadableResourcesMap.get(resource.id);

              if (resource.resourceType === CONST.resourceType.FOLDER) {
                await handleFolderImport(uploadableResource);
              } else {
                const parentId = vm.folderIds.get(resource.parent);
                await handleResourceImport(uploadableResource, parentId);
              }

              // Update progress
              completedImports++;
              updateProgress(completedImports);

            } catch (error) {
              console.error(`Error importing resource ${resource.id}:`, error);
            }
          }

          // All imports completed
          if (vm.uploadableResourcesMap.values().some(resource => resource.parent === jsTreeRootFolder)) {
            vm.workspaceNeedsRefresh = true;
          }

        } catch (error) {
          console.error('Error during import:', error);
          throw error;
        } finally {
          await $timeout(() => {
            vm.isImportDone = true;
            $('#jstree-uploaded').jstree(true).refresh();
          }, 500);
        }
      }

      /**
       * Handles the import of a single resource based on its status and resolution method
       * @param {Object} resource - The resource to import
       * @param {string} parentFolderId - The ID of the parent folder where the resource will be imported
       * @returns {Promise} Resolves with the created/updated resource or null if skipped
       * 
       * Resource Processing Logic:
       * 1. Valid Resources
       *    - Creates new resource in destination folder
       *    - Updates user IDs (created by, modified by)
       *    - Sets status to 'valid uploaded'
       * 
       * 2. Conflicting Resources
       *    a. Replace (requires write permission)
       *       - Updates existing resource content
       *       - Preserves original resource ID
       *       - Sets status to 'replaced'
       * 
       *    b. Create Copy
       *       - Creates new resource with generated name
       *       - Removes original ID and derivedFrom from the resource json
       *       - Sets status to 'copied'
       * 
       *    c. Skip
       *       - No action taken
       *       - Sets status to 'skipped'
       * 
       * 3. Parent Folder Conflicts
       *    - If parent folder is skipped, child resources are also skipped
       *    - Sets status to 'conflicting parent skipped'
       * 
       * Permission Handling:
       * - Checks write permissions for replace operations
       * - Falls back to copy if replace permission denied
       * - Validates user can upload to destination folder
       * 
       * Error Handling:
       * - Network errors during API calls
       * - Permission validation failures
       * - Invalid resource content
       * 
       * @throws {Error} If resource creation/update fails
       */
      async function handleResourceImport(resource, parentFolderId) {
        return new Promise(async (resolve, reject) => {
          try {
            const canBeReplaced = resource.status === resourceImportStatus.CONFLICTING && resource.resolveMethod === 'replace' &&
              vm.uploadableResourcesMap.has(resource.id) &&
              resource.hasWritePermission;

            const canBeCopied = resource.status === resourceImportStatus.CONFLICTING && resource.resolveMethod === 'createCopy' &&
              vm.uploadableResourcesMap.has(resource.id) &&
              vm.userCanUpload;

            const isConflictingParentSkipped = checkConflictingParentSkipped(vm.uploadableResourcesMap.get(resource.parent));

            const resourceContent = resource.content;
            let createdResource;

            // Helper function to update user IDs in content with the current user id
            function updateUserIds(content) {
              // Helper to update a single object
              function updateObject(obj) {
                const newObj = { ...obj };

                // Update direct user IDs, keeping the base path
                if (newObj['pav:createdBy']) {
                  // Handle both string and object/array cases
                  if (typeof newObj['pav:createdBy'] === 'string') {
                    const lastSlashIndex = newObj['pav:createdBy'].lastIndexOf('/');
                    newObj['pav:createdBy'] = newObj['pav:createdBy'].substring(0, lastSlashIndex + 1) + vm.userId;
                  }
                }

                if (newObj['oslc:modifiedBy']) {
                  if (typeof newObj['oslc:modifiedBy'] === 'string') {
                    const lastSlashIndex = newObj['oslc:modifiedBy'].lastIndexOf('/');
                    newObj['oslc:modifiedBy'] = newObj['oslc:modifiedBy'].substring(0, lastSlashIndex + 1) + vm.userId;
                  }
                }

                // Recursively update nested objects
                Object.keys(newObj).forEach(key => {
                  const value = newObj[key];
                  if (value && typeof value === 'object') {
                    if (Array.isArray(value)) {
                      newObj[key] = value.map(item =>
                        typeof item === 'object' ? updateObject(item) : item
                      );
                    } else {
                      newObj[key] = updateObject(value);
                    }
                  }
                });

                return newObj;
              }

              return updateObject(content);
            }

            if (isConflictingParentSkipped) {
              resource.uploadMethod = 'conflicting parent skipped';
            } else if (resource.status === resourceImportStatus.CONFLICTING && resource.resolveMethod === 'skip') {
              resource.uploadMethod = 'skipped';
            } else if (canBeReplaced) {
              // Update existing resource
              const originalContent = await arpService.getResourceContentById(resourceContent['@id'], arpService.getContentType(resourceContent));
              const originalDerivedFrom = originalContent['pav:derivedFrom'];

              const newResourceContent = updateUserIds(resourceContent);
              delete newResourceContent['_arpOriginalFolderId_'];

              if (originalDerivedFrom) {
                newResourceContent['pav:derivedFrom'] = originalDerivedFrom;
              } else {
                delete newResourceContent['pav:derivedFrom'];
              }

              createdResource = await arpService.updateResource(resourceContent['@id'], newResourceContent);
              resource.uploadMethod = 'replaced';
              resource.cedarId = resourceContent['@id'];
            } else if (canBeCopied) {
              // Create new copy - remove identifiers
              const newResourceContent = updateUserIds(resourceContent);
              newResourceContent['pav:derivedFrom'] = resourceContent['@id'];
              if (resource.copyName) {
                newResourceContent['schema:name'] = resource.copyName;
              }

              delete newResourceContent['@id'];
              delete newResourceContent['_arpOriginalFolderId_'];

              // The created resource's name will be the schema:name of the resourceContent and not the name of the uploaded file
              // this is the way resource creation works in CEDAR
              createdResource = await arpService.createResource(parentFolderId, newResourceContent);
              resource.uploadMethod = resource.status === resourceImportStatus.VALID ? 'uploaded to destination folder' : canBeCopied ? 'copied' : 'copied to home folder';
              resource.cedarId = createdResource['@id'];
              resource.cedarParentFolderId = parentFolderId;
            } else {
              const newResourceContent = updateUserIds(resourceContent);
              delete newResourceContent['_arpOriginalFolderId_'];
              // delete newResourceContent['pav:derivedFrom'];
              createdResource = await arpService.importResource(newResourceContent, parentFolderId);
              resource.uploadMethod = 'uploaded to destination folder';
              resource.cedarId = createdResource['@id'];
              resource.cedarParentFolderId = parentFolderId;
            }

            resolve(createdResource);
          } catch (error) {
            reject(error);
          }
        });
      }

      /**
       * Handles the import of a folder and its contents
       * @param {Object} folderResource - The folder resource to import
       * @returns {Promise} Resolves when folder and its contents are imported
       * 
       * Folder Processing Logic:
       * 1. Folder Creation
       *    - Checks if folder should be uploaded (based on status and parent)
       *    - For valid folders:
       *      * Creates new folder in destination
       *      * Uses original name for simple upload
       *      * Uses generated name for copies (avoids conflicts)
       * 
       * 2. Name Handling
       *    - For direct uploads: Uses original folder name
       *    - For copies: Uses generated name (folderResource.copyName)
       *    - Ensures unique names in destination
       * 
       * 3. Folder Structure
       *    - Stores new folder ID in folderIds map
       *    - Links parent-child relationships
       *    - Maintains folder hierarchy
       * 
       * 4. Status Updates
       *    - Valid folders: 'valid uploaded'
       *    - Conflicting folders:
       *      * Replace: 'replaced'
       *      * Copy: 'copied'
       *      * Skip: 'skipped'
       *    - Parent conflicts: 'conflicting parent skipped'
       * 
       * 5. Permission Handling
       *    - Validates user can create folders
       *    - Checks write permissions for replacements
       *    - Respects parent folder permissions
       * 
       * Error Handling:
       * - Creation failures
       * - Permission errors
       * - Name conflicts
       * - Parent folder issues
       * 
       * @throws {Error} If folder creation fails
       */
      async function handleFolderImport(folderResource) {
        async function uploadFolder(folderResource) {
          let folderName = folderResource.resolveMethod === 'createCopy' && folderResource.hasOwnProperty('copyName') ? folderResource.copyName : folderResource.text;
          const cedarFolderId = await arpService.createFolderAsync(
            vm.folderIds.get(folderResource.parent),
            folderName,
            folderResource.cedarDescription || $translate.instant('ARP.resourceImport.folderDescription')
          );
          vm.folderIds.set(folderResource.id, cedarFolderId);
          folderResource.cedarId = cedarFolderId;
          folderResource.text = folderName;
        }

        // During a folder replacement, to prevent data loss, for now we only update the description of the folder
        // the conent of the folder will be replaced with the new content if the content id mathces the original content id
        // otherwise the resource will be uploaded as a new resource
        // no data is removed from the folder
        async function replaceFolder(folderResource) {
          // Update the description of the folder
          await new Promise((innerResolve, innerReject) => {
            resourceService.updateFolder(
              {
                '@id': folderResource.conflictsWith,
                'schema:description': folderResource.cedarDescription || $translate.instant('ARP.resourceImport.folderDescription')
              },
              () => innerResolve(),
              (error) => innerReject(error)
            );
          });

          // Upload the folder
          // await uploadFolder(folderResource);
          folderResource.uploadMethod = 'replaced';

          // Remove the temporary folder
          // await arpService.deleteFolder(folderResource.conflictsWith, true);
        }

        return new Promise(async (resolve, reject) => {
          try {
            const shouldUploadFolder = shouldBeUploaded(folderResource);
            if (shouldUploadFolder) {
              const simpleUpload = !folderResource.hasOwnProperty('conflictsWith');
              // if (vm.userCanUpload) {
              if (folderResource.resolveMethod === 'createCopy') {
                await uploadFolder(folderResource);
                folderResource.uploadMethod = simpleUpload ? 'uploaded to destination folder' : 'copied';
              } else if (folderResource.resolveMethod === 'replace') {
                if (!simpleUpload) {
                  await replaceFolder(folderResource);
                } else {
                  await uploadFolder(folderResource);
                  folderResource.uploadMethod = 'uploaded to destination folder';
                }
              } else {
                // In case the chosen method for the folder is skip, but the folder itself is not conflicting
                // that means the chosen method applies to the children of the folder
                await uploadFolder(folderResource);
                folderResource.uploadMethod = 'uploaded to destination folder';
              }
            } else {
              folderResource.uploadMethod = 'empty folder skipped';
            }
            resolve();
          } catch (error) {
            reject(error);
          }
        });
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
        vm.uploadableResourcesMap = new Map();
        vm.isImportDone = false;
        refreshUI();
        $('#jstree-uploaded').jstree(true).refresh();
      };

      function closeModal() {
        if (vm.workspaceNeedsRefresh) {
          vm.workspaceNeedsRefresh = false;
          $scope.$broadcast('refreshWorkspace', [vm.destinationFolderId]);
        }
      }

      function hasPermission(resource) {
        if (resource.resolveMethod === 'skip') {
          return true;
        }

        if (resource.resolveMethod === 'replace') {
          if (resource.resourceType === CONST.resourceType.FOLDER) {
            return vm.userCanUpload;
          } else {
            return resource.hasWritePermission;
          }
        }

        if (resource.resolveMethod === 'createCopy' || !resource.resolveMethod) {
          return vm.userCanUpload;
        }

        return false;
      }

      /**
       * Prepares additional properties and metadata for a resource before import
       * @param {Object} resource - The resource to prepare
       * 
       * Resource Enhancement Process:
       * 3. Permission Setup
       *    - Validates user can upload/modify
       * 
       * 4. UI Properties
       *    - Adds tooltips for conflict status
       *    - Sets icons to open the resource in CEDAR
       *    - Prepares dropdown options based on permissions
       * 
       * Note: This function is crucial for:
       * - Proper conflict detection and resolution
       * - UI feedback and interaction
       * - Permission-based operations
       */
      function prepareResourceExtras(resource) {
        const isConflicting = resource.status === resourceImportStatus.CONFLICTING;
        if (!isConflicting) {
          return resource.text;
        } else {
          return `<span class="node-name">${resource.resolveMethod === 'createCopy' ? resource.combinedName : resource.text}</span>
                    <select class="node-action" data-node-id="${resource.id}">
                      <option value="">Action...</option>
                      <option value="replace">Replace</option>
                      <option value="createCopy">Copy</option>
                      <option value="skip">Skip</option>
                    </select>
                    ${resource.resourceType !== CONST.resourceType.FOLDER && resource.cedarId ?
              `<i class="fa fa-external-link open-in-cedar" style="margin-left: 5px; cursor: pointer;" title="${!resource.hasReadPermission ? 'You do not have permission to open the resource' : 'Open original resource in CEDAR'}"></i>`
              : ''}`
        }
      }

      function checkConflictingParentSkipped(parent) {
        let isSkipped = false;
        let current = parent;
        while (current && current.id !== jsTreeRootFolder && !isSkipped) {
          isSkipped = current?.resolveMethod === 'skip' && current.hasOwnProperty('conflictsWith');
          current = vm.uploadableResourcesMap.get(current.parent);
        }
        return isSkipped;
      }

      /**
       * Updates the UI attributes and state for a resource node in the jsTree
       * @param {jQuery} $node - The jsTree node element to update
       * @param {string} action - The resolution action to apply (createCopy/replace/skip)
       * @param {boolean} propagateToChildren - Whether to propagate the action to child nodes
       * 
       * UI Update Process:
       * 1. Node State Management
       *    - Updates node's visual state based on resource status
       *    - Handles parent-child relationships for nested resources
       *    - Manages dropdown selection states
       * 
       * 2. Action Handling
       *    - Processes different resolution methods:
       *      * createCopy: Enables copy creation options
       *      * replace: Validates write permissions
       *      * skip: Disables child nodes appropriately
       * 
       * 3. Permission Visualization
       *    - Shows/hides "Open in CEDAR" button
       *    - Updates tooltips based on permissions
       *    - Disables options user doesn't have permission for
       * 
       * 4. Parent-Child Relationships
       *    - Handles cascading effects of parent actions
       *    - Updates child nodes when parent is skipped
       *    - Maintains consistency in folder structure
       * 
       * 5. Visual Feedback
       *    - Updates node colors based on status
       *    - Shows appropriate icons and tooltips
       *    - Indicates permission issues visually
       * 
       * Note: This function is critical for:
       * - Maintaining UI consistency
       * - Providing user feedback
       * - Enforcing permission rules
       * - Managing resource relationships
       */
      function setAttributes($node, action, propagateToChildren) {
        const $dropdown = $node.find('> .jstree-anchor .node-action');
        const nodeId = $dropdown.length ? $dropdown.data('node-id') : $node.attr('id');
        const resource = vm.uploadableResourcesMap.get(nodeId);
        const $anchor = $node.find('> .jstree-anchor');
        const tree = $('#jstree-valid').jstree(true);
        const node = tree.get_node(nodeId);

        // Check if parent is set to skip
        const parentNode = node.parent !== jsTreeRootFolder ? tree.get_node(node.parent) : null;
        const parentResource = parentNode ? vm.uploadableResourcesMap.get(parentNode.id) : null;
        const isParentSkipped = parentResource?.resolveMethod === 'skip';
        let currentParent = parentResource;
        const isConflictingParentSkipped = checkConflictingParentSkipped(currentParent);

        // Get current action or use passed action
        const currentAction = action || resource?.resolveMethod;

        // Update resource's resolve method
        if (resource && currentAction !== undefined) {
          if (resource.resourceType !== CONST.resourceType.FOLDER) {
            if (!(currentAction === 'replace' && !resource.hasWritePermission)) {
              resource.resolveMethod = currentAction;
            } else {
              resource.resolveMethod = null;
            }
          } else {
            resource.resolveMethod = currentAction;
          }
        }

        // Only update children if propagateToChildren is true
        if (propagateToChildren && node?.children?.length) {
          node.children.forEach(childId => {
            const childNode = tree.get_node(childId);
            if (childNode) {
              const $childNode = $(tree.get_node(childId, true));
              if ($childNode.length) {
                setAttributes($childNode, currentAction, true);
              }
            }
          });
        }

        // Handle valid files without dropdowns
        if (!$dropdown.length) {
          if (isConflictingParentSkipped) {
            $node.attr('data-resolved', 'true');
            $anchor.attr('title', 'This resource will be skipped because its parent folder is set to skip');
          } else if (!vm.userCanUpload) {
            $node.attr('data-invalid-permission', 'true');
            $anchor.attr('title', 'You do not have permission to create new resources in this folder');
          } else {
            $node.removeAttr('data-resolved');
            $anchor.removeAttr('title');
          }
        }

        // If we have a dropdown, update its value
        if ($dropdown.length) {
          const isTopLevelResource = node.parent === jsTreeRootFolder;

          if (resource.resourceType !== CONST.resourceType.FOLDER) {
            if (resource.hasWritePermission || currentAction !== 'replace') {
              $dropdown.val(currentAction);
            } else {
              $dropdown.val('');
            }
          } else {
            $dropdown.val(currentAction);
          }

          // After an action is chosen for a resource, remove the empty option
          if (currentAction) {
            const $emptyOption = $dropdown.find('option[value=""]');
            if ($emptyOption.length > 0) {
              $emptyOption.remove();
            }
          }

          if (isConflictingParentSkipped) {
            $dropdown.find('option[value="createCopy"]').prop('disabled', true).attr('title', 'This resource can not be copied because its parent folder is set to skip');
            $dropdown.attr('title', 'This resource will be skipped because its parent folder is set to skip');
          } else {
            $dropdown.find('option[value="createCopy"]').prop('disabled', false);
            $dropdown.removeAttr('title');
          }

          if (resource.resourceType === CONST.resourceType.FOLDER) {
            const folderHasResourceWithPermissionIssue = Array.from(vm.uploadableResourcesMap.values()).some(res => res.resourceType !== CONST.resourceType.FOLDER && res.parent === resource.id && !res.hasWritePermission);
            if (folderHasResourceWithPermissionIssue) {
              const title = resource.hasOwnProperty('conflictsWith') ? 'This folder can not be replaced because it contains at least one resource that you do not have permission to replace' : 'The content of this folder can not be set to be replaced because it has at least one resource that you do not have permission to replace';
              $dropdown.find('option[value="replace"]').prop('disabled', true).attr('title', title);
            } else {
              $dropdown.find('option[value="replace"]').prop('disabled', false);
              $dropdown.removeAttr('title');
            }
          } else {
            if (!resource.hasWritePermission) {
              $dropdown.find('option[value="replace"]').prop('disabled', true).attr('title', 'You do not have permission to replace the resource');
            } else {
              $dropdown.find('option[value="replace"]').prop('disabled', false);
              $dropdown.removeAttr('title');
            }
          }


          // Only disable if parent is skipped
          if (isParentSkipped) {
            if (resource.resolveMethod === '') {
              $dropdown.val('skip'); // Default to skip when parent is skipped
            }
          } else {
            $dropdown.removeAttr('title');
          }
          if (resource.resourceType === CONST.resourceType.FOLDER) {
            updateFolderTreeNode($node, $anchor, resource);
          } else {
            updateResourceTreeNode($node, $anchor, resource, currentAction);
            if (parentNode) {
              const parentIds = [];
              let currentParent = parentNode;
              while (currentParent.id !== jsTreeRootFolder) {
                parentIds.push(currentParent.id);
                currentParent = tree.get_node(currentParent.parent);
              }
              for (const parentId of parentIds) {
                const $parentAnchor = $(tree.get_node(parentId, true)).find('> .jstree-anchor');
                updateFolderTreeNode($parentAnchor.closest('.jstree-node'), $parentAnchor, parentResource);
              }
            }
          }

          $node.attr('data-resolved', currentAction ? 'true' : 'false');

          // Update node name
          const $nameSpan = $anchor.find('.node-name');
          if (currentAction === 'createCopy') {
            $nameSpan.text(resource.combinedName);
          } else {
            $nameSpan.text(resource.text);
          }
        }
      }

      /**
       * Updates the visual state and attributes of a resource node in the jsTree
       * @param {jQuery} $node - The jsTree node element
       * @param {jQuery} $anchor - The node's anchor element
       * @param {Object} resource - The resource object
       * @param {string} action - Current resolution action
       * 
       * Visual Updates:
       * 1. Permission States
       *    - Sets invalid permission indicators
       *    - Updates tooltips for permission issues
       *    - Handles write permission checks
       * 
       * 2. Conflict Resolution
       *    - Shows appropriate state for copy/replace/skip
       *    - Updates UI based on parent folder status
       *    - Handles cascading effects
       * 
       * 3. UI Elements
       *    - Updates node colors and icons
       *    - Shows/hides CEDAR link button
       *    - Manages tooltips and hover states
       */
      function updateResourceTreeNode($node, $anchor, resource, action) {
        const isConflictingParentSkipped = checkConflictingParentSkipped(vm.uploadableResourcesMap.get(resource.parent));

        if (isConflictingParentSkipped) {
          $node.attr('data-invalid-permission', 'false');
          $anchor.attr('title', 'This resource will be skipped because its parent folder is set to skip');
        } else if (action === 'skip') {
          $node.attr('data-invalid-permission', 'false');
          $anchor.removeAttr('title');
        } else if (action === 'replace' && resource.hasWritePermission) {
          $node.attr('data-invalid-permission', 'false');
          $anchor.removeAttr('title');
        }
        else if (action === 'createCopy' && !vm.userCanUpload) {
          $node.attr('data-invalid-permission', 'true');
          $anchor.attr('title', 'You do not have permission to create new resources in this folder');
        } else if (action === 'createCopy' && vm.userCanUpload) {
          $node.attr('data-invalid-permission', 'false');
          $anchor.removeAttr('title');
        }
      }

      /**
       * Updates the visual state and attributes of a folder node in the jsTree
       * @param {jQuery} $node - The jsTree node element
       * @param {jQuery} $anchor - The node's anchor element
       * @param {Object} resource - The folder resource object
       * 
       * Folder-Specific Logic:
       * 1. Upload Status
       *    - Determines if folder should be uploaded
       *    - Handles empty folder cases
       *    - Manages parent folder conflicts
       * 
       * 2. Permission Handling
       *    - Checks user upload permissions
       *    - Sets appropriate visual indicators
       *    - Updates tooltips for permission issues
       * 
       * 3. Child Resources
       *    - Affects visual state of child nodes
       *    - Propagates skip status to children
       *    - Maintains folder hierarchy consistency
       * 
       * Note: Folders have special handling because they:
       * - Affect all child resources
       * - Need different permission checks
       * - Can be empty or skipped
       */
      function updateFolderTreeNode($node, $anchor, resource) {
        if (shouldBeUploaded(resource)) {
          const isConflictingParentSkipped = checkConflictingParentSkipped(vm.uploadableResourcesMap.get(resource.parent));
          if (isConflictingParentSkipped) {
            $node.attr('data-invalid-permission', 'false');
            $anchor.attr('title', 'This resource will be skipped because its parent folder is set to skip');
          } else {
            if (vm.userCanUpload) {
              $node.attr('data-invalid-permission', 'false');
              $anchor.removeAttr('title');
            } else {
              $node.attr('data-invalid-permission', 'true');
              $anchor.attr('title', 'You do not have permission to create new resources in this folder');
            }
          }
        } else {
          if (vm.userCanUpload) {
            $node.attr('data-invalid-permission', 'false');
            $anchor.removeAttr('title');
          } else {
            $node.attr('data-invalid-permission', 'true');
            $anchor.attr('title', 'You do not have permission to create new resources in this folder');
          }
        }

        // Handle exceptions
        if (resource.hasOwnProperty('conflictsWith') && resource.parent === jsTreeRootFolder) {
          $anchor.attr('title', 'The folder is in conflict with another folder with the same name in the destination folder');
        }
      }

      function shouldBeUploaded(folder) {
        // Get all resources that are in this folder hierarchy
        const allDescendants = getAllDescendants(folder.id);

        return allDescendants.some(resource =>
          (resource.status === resourceImportStatus.VALID ||
            (resource.status === resourceImportStatus.CONFLICTING && resource.resolveMethod === 'createCopy')) &&
          !(folder.hasOwnProperty('conflictsWith') && folder.resolveMethod === 'skip')
        );
      }

      function getAllDescendants(folderId) {
        const descendants = [];
        const queue = [folderId];

        while (queue.length) {
          const currentId = queue.shift();

          vm.uploadedResources.forEach(resource => {
            if (resource.parent.startsWith(currentId)) {
              descendants.push(resource);
              if (resource.resourceType === CONST.resourceType.FOLDER) {
                queue.push(resource.id);
              }
            }
          });
        }

        return descendants;
      }

      // Function to initialize jsTrees
      // #jstree-valid and #jstree-uploaded contains the resources that are valid and uploaded respectively
      // #jstree-invalid contains the resources that are invalid and will not be uploaded
      function initJsTrees(retryCount = 0) {
        const maxRetries = 3;
        const retryDelay = 1000;

        $timeout(function () {
          try {
            if (typeof $ === 'undefined') {
              if (retryCount < maxRetries) {
                console.warn(`jQuery not loaded, retrying... (${retryCount + 1}/${maxRetries})`);
                setTimeout(() => initJsTrees(retryCount + 1), retryDelay);
                return;
              }
              throw new Error('jQuery not loaded after maximum retries');
            }

            vm.jsTreesInitialized = true;

            jQuery.noConflict();

            $(function () {
              $('#jstree-valid').jstree({
                'core': {
                  'check_callback': true,
                  'data': function (obj, callback) {
                    const treeData = $scope.importStatus.validFiles.map(resource => {
                      const uploadableResource = vm.uploadableResourcesMap.get(resource.id);
                      const hasResolveMethod = uploadableResource?.resolveMethod;
                      const parentResource = vm.uploadableResourcesMap.get(resource.parent);
                      const hasParentResolveMethod = parentResource?.resolveMethod;

                      // Check permissions - now including the general userCanUpload check
                      const isConflicting = resource.status === resourceImportStatus.CONFLICTING;
                      const invalidPermission = !hasPermission(uploadableResource);

                      return {
                        ...resource,
                        li_attr: {
                          'data-conflicting': isConflicting ? 'true' : 'false',
                          'data-resolved': (hasResolveMethod || hasParentResolveMethod) ? 'true' : 'false',
                          'data-invalid-permission': invalidPermission ? 'true' : 'false'
                        },
                        text: prepareResourceExtras(resource),
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
                .on('ready.jstree refresh.jstree before_open.jstree create_node.jstree', function (e, data) {
                  // First update all nodes' permission state
                  $(this).find('.jstree-node').each(function () {
                    const $node = $(this);
                    setAttributes($node);
                  });
                  // Then handle dropdowns and specific permissions
                  $(this).find('.node-action').each(function () {
                    const $dropdown = $(this);
                    const nodeId = $dropdown.data('node-id');
                    const resource = vm.uploadableResourcesMap.get(nodeId);
                    const tree = $('#jstree-valid').jstree(true);
                    const node = tree.get_node(nodeId);
                    const $node = $dropdown.closest('.jstree-node');
                    const $anchor = $node.find('> .jstree-anchor');

                    // Check parent's resolveMethod
                    const parentId = node.parent;
                    const parentResource = vm.uploadableResourcesMap.get(parentId);
                    const parentResolveMethod = parentResource && parentResource.resolveMethod;

                    // Update dropdown change handler
                    $dropdown.off('change').on('change', function (e) {
                      e.stopPropagation();
                      const action = $(this).val();
                      const resource = vm.uploadableResourcesMap.get(nodeId);

                      // Update the folder's resolve method first
                      if (resource.resourceType !== CONST.resourceType.FOLDER) {
                        if (!(action === 'replace' && !resource.hasWritePermission)) {
                          resource.resolveMethod = action;
                        } else {
                          resource.resolveMethod = null;
                        }
                      } else {
                        resource.resolveMethod = action;
                      }
                      const shouldPropagate = resource.hasOwnProperty('conflictsWith') &&
                        resource.parent === jsTreeRootFolder &&
                        action === 'skip' &&
                        resource.resourceType === CONST.resourceType.FOLDER;
                      setAttributes($node, action, shouldPropagate);

                      // Get all children recursively from uploadableResourcesMap
                      const getAllChildren = (parentId) => {
                        const children = [];
                        vm.uploadableResourcesMap.forEach((res, id) => {
                          if (res.parent === parentId) {
                            children.push(id);
                            children.push(...getAllChildren(id));
                          }
                        });
                        return children;
                      };

                      // Update all children in the map, even if not in DOM
                      const childIds = getAllChildren(nodeId);
                      childIds.forEach(childId => {
                        const childResource = vm.uploadableResourcesMap.get(childId);
                        if (childResource) {
                          if (childResource.resourceType !== CONST.resourceType.FOLDER) {
                            if (action !== 'replace' || childResource.hasWritePermission) {
                              childResource.resolveMethod = action;
                            } else {
                              childResource.resolveMethod = null;
                            }
                          } else {
                            childResource.resolveMethod = action;
                          }

                          // If child node exists in DOM, update its UI
                          const $childNode = $(`#${CSS.escape(childId)}`);
                          if ($childNode.length) {
                            setAttributes($childNode, action, false);
                          }
                        }
                      });

                      checkConflictResolution();
                      $scope.$apply();
                    });
                  });

                  // Add this click handler for open-original icons
                  $(this).find('.open-in-cedar').off('click').on('click', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    const nodeId = $(this).closest('.jstree-node').find('.node-action').data('node-id');
                    vm.openInCedar(nodeId);
                    return false;
                  });

                  checkConflictResolution();

                  requestAnimationFrame(() => {
                    $scope.$apply();
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
                  if (items && !vm.isImportDone) {
                    await handleDnd(items);
                  } else {
                    UIMessageService.flashWarning('Reset the modal to start a new import', '', 'Reset the modal');
                  }
                });
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

            $('#jstree-uploaded').jstree({
              'core': {
                'check_callback': true,
                'data': function (obj, callback) {
                  callback($scope.importStatus.validFiles.map(resource => ({
                    ...resource,
                    text: `${resource.resolveMethod === 'createCopy' && resource.hasOwnProperty('copyName') ? resource.copyName : resource.text} (${resource.uploadMethod})${!resource.uploadMethod?.includes('skipped') ? ` <a href="javascript:void(0)" class="open-in-cedar" data-resource-id="${resource.id}"><i class="fa fa-external-link" title="Open resource in CEDAR"></i></a>` : ''}`,
                    a_attr: {}
                  })));
                }
              },
            })
              .on('ready.jstree refresh.jstree before_open.jstree after_open.jstree create_node.jstree', function (e, data) {
                requestAnimationFrame(() => {
                  // Add click handler for the open-in-cedar icon
                  $('#jstree-uploaded').on('click', '.open-in-cedar', function (e) {
                    e.stopPropagation(); // Prevent jstree node selection
                    e.preventDefault();
                    e.stopImmediatePropagation(); // Add this
                    const resourceId = $(this).data('resource-id');
                    vm.openInCedar(resourceId);
                    return false;
                  });
                });
              })
              .on('dragover', function (event) {
                event.preventDefault();
                event.stopPropagation();
              })
              .on('drop', function (event) {
                event.preventDefault();
                event.stopPropagation();
              });
          } catch (error) {
            console.error('Error initializing jsTrees:', error);
            throw error;
          }
        }, 500);


        // Prevent default dragover and drop events
        // only allow drop on the jstree-valid's dnd area
        angular.element($window).on('dragover', function (event) {
          event.preventDefault();
          event.stopPropagation();
        });

        angular.element($window).on('drop', function (event) {
          event.preventDefault();
          event.stopPropagation();
        });
      }

      // Opens the resource in CEDAR
      vm.openInCedar = function (nodeId) {
        const resource = vm.uploadableResourcesMap.get(nodeId);
        if (!resource.hasReadPermission) {
          UIMessageService.showArpImportOpenError('ARP.resourceImport.importPermissionError', 'ARP.resourceImport.importPermissionErrorMessage');
          return;
        }

        let targetUrl;
        switch (resource.resourceType) {
          case CONST.resourceType.TEMPLATE:
            targetUrl = FrontendUrlService.getTemplateEdit(resource.cedarId)
            break;
          case CONST.resourceType.ELEMENT:
            targetUrl = FrontendUrlService.getElementEdit(resource.cedarId)
            break;
          case CONST.resourceType.FIELD:
            targetUrl = FrontendUrlService.getFieldEdit(resource.cedarId)
            break;
          case CONST.resourceType.INSTANCE:
            targetUrl = FrontendUrlService.getInstanceEdit(resource.cedarId);
            break;
          case CONST.resourceType.FOLDER:
            targetUrl = FrontendUrlService.getFolderContents(resource.cedarId);
            break;
          default:
            console.warn('Unknown resource type:', resource.resourceType);
            return;
        }

        if (resource.hasOwnProperty('cedarParentFolderId')) {
          targetUrl += '?folderId=' + UrlService.encodeURIComponent(resource.cedarParentFolderId);
        }

        if (targetUrl) {
          window.open(targetUrl, '_blank');
        }
      };

      /**
       * Checks and updates the global conflict resolution state
       * 
       * Resolution Check Process:
       * 1. Conflict Validation
       *    - Iterates through all resources in uploadableResourcesMap
       *    - Checks if each conflicting resource has a resolution method set
       *    - Verifies permissions for selected resolution methods
       * 
       * 2. State Updates
       *    - areAllConflictsResolved: Set to true only if all conflicts have valid resolutions
       *    - notAllCanBeReplaced: Set to true if any resource lacks write permission for replace
       * 
       * 3. Resolution Methods:
       *    - createCopy: Requires upload permission to destination
       *    - replace: Requires write permission on existing resource
       *    - skip: Always valid, no permission needed
       * 
       * 4. UI Effects:
       *    - Controls Import button state (enabled/disabled)
       *    - Updates Replace All button availability
       *    - Shows appropriate tooltips for disabled actions
       * 
       * Note: This function is called:
       * - After each resolution method change
       * - When resources are added/removed
       * - After permission checks
       */
      function checkConflictResolution() {
        let writeIssue = false;
        const allResolved = vm.uploadableResourcesMap.size > 0 && Array.from(vm.uploadableResourcesMap.values())
          .every(resource => {
            writeIssue = writeIssue || !resource.hasWritePermission && resource.resolveMethod !== 'replace';
            return resource.status === resourceImportStatus.VALID ||
              (resource.resolveMethod !== null && resource.resolveMethod !== '');
          });

        if (allResolved) {
          vm.areAllConflictsResolved = true;
        } else {
          vm.areAllConflictsResolved = false;
        }

        // Update node names based on the global conflict resolution method
        if (vm.conflictResolutionMethod) {
          updateNodeNames(vm.conflictResolutionMethod);
        }

        updateUploadedResourcesSummary();

      }

      /**
       * Recalculates and updates all tree node attributes when the destination folder changes
       * 
       * Process Flow:
       * 1. Tree Node Updates
       *    - Iterates through all nodes in jstree-valid
       *    - Updates node attributes based on new destination
       *    - Refreshes conflict status with new folder contents
       * 
       * 2. UI Element Management
       *    - Rebuilds dropdown menus for conflict resolution
       *    - Updates node icons and visual states
       *    - Clears existing tooltips and titles
       *    - Resets permission indicators
       * 
       * 3. Conflict Detection
       *    - Checks for naming conflicts in new destination
       *    - Updates resource status (VALID/CONFLICTING)
       *    - Generates new names for conflicting resources
       * 
       * 4. Permission Validation
       *    - Verifies write permissions in new location
       *    - Updates UI based on permission status
       *    - Disables actions user can't perform
       * 
       * Note: Called when:
       * - Destination folder changes
       * - After tree initialization
       * - When resources are added/removed
       * 
       * Important: Maintains tree state consistency
       * across destination folder changes
       */
      function recalculateTreeAttributes() {
        $timeout(async () => {
          try {
            // Clear resource maps
            vm.uploadableResourcesMap.clear();

            // Recalculate each resource using prepareResource
            for (const resource of vm.uploadedResources) {
              // Reset status before recalculating conflicting nodes
              if (resource.status === resourceImportStatus.CONFLICTING) {
                resource.status = resourceImportStatus.VALID;
                resource.resolveMethod = null;
                await handleConflictingNode(resource);
              }
            }

            // Refresh the tree to show updated nodes
            refreshUI();

            // After tree refresh, reapply dropdowns to nodes
            $timeout(() => {
              $('#jstree-valid').find('.jstree-node').each(function () {
                const $node = $(this);
                const nodeId = $node.attr('id');
                const resource = vm.uploadableResourcesMap.get(nodeId);

                if (resource && resource.status === resourceImportStatus.CONFLICTING) {
                  // Create dropdown if it doesn't exist
                  let $dropdown = $node.find('> .jstree-anchor .node-action');
                  if (!$dropdown.length) {
                    const $anchor = $node.find('> .jstree-anchor');
                    $dropdown = $('<select class="node-action"></select>');
                    $dropdown.data('node-id', nodeId);

                    // Add options
                    $dropdown.append('<option value="">Select action</option>');
                    $dropdown.append('<option value="skip">Skip</option>');
                    $dropdown.append('<option value="replace">Replace</option>');
                    $dropdown.append('<option value="createCopy">Create Copy</option>');

                    // Insert dropdown before the text
                    $anchor.prepend($dropdown);

                    $anchor.removeAttr('title');
                  }

                  // Apply the current resolve method if exists
                  if (resource.resolveMethod) {
                    $dropdown.val(resource.resolveMethod);
                  }

                  // Reapply event handlers
                  setAttributes($node, resource.resolveMethod, false);
                }
              });

              checkConflictResolution();
            });

          } finally {
            vm.isTreeLoading = false;
          }
        });
      }

      function setupFileInputListeners() {
        ['filesInput', 'resourcesInput', 'folderInput'].forEach(inputId => {
          const input = document.getElementById(inputId);
          if (input) {
            input.addEventListener('change', (event) => handleUpload(event.target.files));
          }
        });
      }

      $scope.$on('arpImportModalVisible', function (event, params) {
        const newDestinationFolderOpened = params[1] !== vm.destinationFolderId;
        vm.alreadyPresentCedarResources = params[0];
        vm.destinationFolderId = params[1];
        vm.userHomeFolderId = params[2];
        vm.userCanUpload = params[3];
        vm.isAdmin = params[4];
        vm.userId = params[5];
        vm.folderIds.set(jsTreeRootFolder, vm.destinationFolderId);

        const url = new URL(vm.destinationFolderId);
        const domain = url.hostname; // This will give you "repo.arp.orgx"
        vm.repoDomain = domain;
        if (!vm.jsTreesInitialized) {
          try {
            initJsTrees();
            setupFileInputListeners();
          } catch (error) {
            console.error('Error during initialization:', error);
            UIMessageService.showError('Error initializing. Please try again.');
          }
        } else {
          if (newDestinationFolderOpened) {
            recalculateTreeAttributes();
            refreshUI();
          }
        }
      });

      // Replaces the repo domain in the json with the actual CEDAR domain
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

      // Gets the parent directory of the file/folder
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

      /**
       * Creates a standardized object structure that mimics JSZip format from HTML file inputs
       * 
       * Purpose:
       * 1. Standardization
       *    - Converts various input sources (file inputs, folder inputs) into a consistent format
       *    - Allows reusing the same processing logic for all input types
       * 
       * 2. Integration Benefits
       *    - Enables unified processing with actual JSZip objects from ZIP files
       *    - Preserves folder hierarchies from webkitRelativePath property
       *    - Maintains file metadata (name, date, size) in compatible format
       * 
       * 3. Architecture Advantages
       *    - Simplifies downstream code by providing consistent object structure
       *    - Enables seamless switching between file uploads and ZIP extractions
       *    - Reduces code duplication in file/folder processing functions
       * 
       * The resulting structure has file paths as keys and objects with 
       * metadata and file content as values, matching JSZip's format.
       */
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

      /**
       * Processes uploaded files and folders from file input elements
       * 
       * Function Flow:
       * 1. Input Processing
       *    - Creates a JSZip-like structure from uploaded files
       *    - Preserves file/folder hierarchies from input elements
       * 
       * 2. Resource Processing
       *    - Processes each file and directory in the upload structure
       *    - Handles special case for top-level ZIP files (automatically extracts)
       *    - Differentiates between directories and individual files
       * 
       * 3. Directory Handling
       *    - Calls processDirectory() for folder structures
       *    - Maintains parent-child relationships
       *    - Preserves folder metadata when available
       * 
       * 4. File Handling
       *    - Calls processFile() for individual files
       *    - Processes content based on file type
       *    - Validates resources against CEDAR requirements
       * 
       * 5. Finalization
       *    - Updates UI to reflect processed resources
       *    - Prepares resources for conflict resolution
       *    - Shows appropriate status indicators
       * 
       * Note: This function is the main entry point for file upload processing
       * from traditional file input elements (not drag-and-drop).
      */
      async function handleUpload(uploadedResources) {
        const jsZipLike = createJSZipLikeStructure(uploadedResources);

        for (const relativePath in jsZipLike) {
          const resource = jsZipLike[relativePath];
          const { parentPath, status } = getZipParentDirectory(relativePath);
          const isTopLevel = parentPath === '#';

          if (resource.dir) {
            await processDirectory(resource, parentPath, status, jsZipLike, false, isTopLevel);
          } else {
            if (resource['_data'].type === 'application/zip' && isTopLevel) {
              const unzipped = await JSZip.loadAsync(resource['_data']);

              for (const relativePath in unzipped.files) {
                const zipEntry = unzipped.files[relativePath];
                const { parentPath, status } = getZipParentDirectory(relativePath);

                if (zipEntry.dir) {
                  await processDirectory(zipEntry, parentPath, status, unzipped.files, false, isTopLevel);
                } else {
                  await processFile(zipEntry, parentPath, status);
                }
              }
            } else {
              await processFile(resource, parentPath, status);
            }
          }
        }

        refreshUI();
      }

      /**
       * Processes resources from drag-and-drop operations
       * 
       * This function handles files and folders dropped into the import area by:
       * 
       * 1. Processing ZIP Files
       *    - Extracts contents using JSZip
       *    - Maintains folder structure from archive
       *    - Processes each file/directory individually
       * 
       * 2. Processing Standard Files/Folders
       *    - Uses HTML5 FileSystem API (webkitGetAsEntry)
       *    - Handles both individual files and entire folder structures
       *    - Preserves hierarchy and metadata
       * 
       * 3. Resource Processing Pipeline
       *    - Determines appropriate parent directories
       *    - Validates resource types and permissions
       *    - Creates tree representation for display
       *    - Handles conflict detection with existing resources
       * 
       * The function maintains proper async/await patterns to ensure
       * all file operations complete before updating the UI.
       */
      async function handleDnd(dndResources) {
        for (let i = 0; i < dndResources.length; i++) {
          const resource = dndResources[i];
          if (resource.type === 'application/zip') {
            const file = await new Promise(resolve => resource.webkitGetAsEntry().file(resolve));
            const unzipped = await JSZip.loadAsync(file);

            for (const relativePath in unzipped.files) {
              const zipEntry = unzipped.files[relativePath];
              const { parentPath, status } = getZipParentDirectory(relativePath);

              if (zipEntry.dir) {
                await processDirectory(zipEntry, parentPath, status, unzipped.files, false, true);
              } else {
                await processFile(zipEntry, parentPath, status);
              }
            }
          } else {
            const entry = resource.webkitGetAsEntry();
            if (entry) {
              if (entry.isDirectory) {
                await processDirectory(entry, jsTreeRootFolder, resourceImportStatus.VALID, null, true, true);
              } else {
                await processFile(entry, jsTreeRootFolder, resourceImportStatus.VALID);
              }
            } else {
              // Handle unknown resource error
            }
          }
        }

        refreshUI();
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

      // builds the tree node to store the data about the uploaded directory entry for later processing and showing in the JSTree
      async function processDirectory(directoryEntry, parentDirectory, status, otherEntries, isDnd, isParentFolder) {
        return new Promise(async (resolve, reject) => {
          const isZipEntry = isJSZipEntry(directoryEntry);
          const isFse = directoryEntry instanceof FileSystemDirectoryEntry;
          const directoryName = isFse ? directoryEntry.name : directoryEntry.name.slice(0, -1).split('/').pop();
          const resolvedFullPath = `${parentDirectory.replace(/\/$/, '')}/${directoryName}/`;
          let cedarDescription = '';

          const directoryTreeNode = {
            id: resolvedFullPath, // Unique ID for the resource
            parent: parentDirectory, // Parent directory ID
            text: directoryName, // Display name
            icon: "fa " + arpService.getResourceIcon(CONST.resourceType.FOLDER), // use the same CEDAR like icon
            // a_attr: { "title": "This is a folder" },
            // "icon": "jstree-folder", // Use jsTree's folder icon
            type: "folder", // Custom type to indicate folders
            resourceType: "folder", // resourceType of the directory
            children: [], // No child resource needs to be cached in this case
            status: status, // Status of the directory
            cedarDescription: cedarDescription, // CEDAR description of the directory
            hasWritePermission: vm.isAdmin ? true : vm.userCanUpload,
            hasReadPermission: vm.isAdmin ? true : vm.userCanUpload,
            state: { "opened": true }
          };

          await prepareResource(
            directoryTreeNode,
            directoryEntry,
            CONST.resourceType.FOLDER,
            parentDirectory,
            vm.uploadedResources,
            isParentFolder
          );

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

          // if a folder is not conflicting in the destination folder, which means there is no folder with the same name in CEDAR
          // add a tooltip that explains that only the content of the folder is conflicting
          if (directoryTreeNode.status === resourceImportStatus.VALID && status === resourceImportStatus.CONFLICTING) {
            directoryTreeNode.a_attr = { "title": "Only the content of this folder is conflicting." }
          }

          vm.uploadedResources.push(directoryTreeNode);

          // if a JSZip or a File list was uploaded via the folder uploader and not via drag and drop
          // in both cases the file and folder paths are processed separately
          if (isDnd) {
            let reader = directoryEntry.createReader();

            await new Promise((resolve, reject) => {
              reader.readEntries(async function (entries) {
                const entryPromises = entries.map(entry => {
                  if (entry.isDirectory) {
                    return processDirectory(entry, resolvedFullPath, directoryTreeNode.status, entries, isDnd, false);
                  } else {
                    return processFile(entry, resolvedFullPath, directoryTreeNode.status);
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

      // builds the tree node to store the data about the uploaded file entry for later processing and showing in the JSTree
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
                vm.invalidWarningShown = false;
              }

              const fileId = `${parentDirectory.replace(/\/$/, '')}/${fileName}`;

              const fileTreeNode = {
                id: fileId,
                parent: parentDirectory,
                text: fileName,
                originalName: fileName,
                icon: "fa " + arpService.getResourceIcon(resourceType),
                type: "file",
                status: resolvedFileStatus,
                content: fileContent,
                resourceType: resourceType,
                hasWritePermission: true,
                //li_attr: { title: "This is a file" },
                //a_attr: { "data-tooltip": "Template" },
              };

              if (resolvedFileStatus !== resourceImportStatus.UNSUPPORTED) {

                await prepareResource(
                  fileTreeNode,
                  fileContent,
                  resourceType,
                  parentDirectory,
                  vm.uploadedResources,
                  false
                );
              }

              vm.uploadedResources.push(fileTreeNode);
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
          if (parentFolder.parent !== jsTreeRootFolder) {
            setParentFolderStatus(parentFolder.parent, newStatus)
          }
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
      async function prepareResource(resourceTreeNode, resourceContent, resourceType, entryParent, uploadedResources, isParentFolder, fileExtension = '.json') {
        // The name of the resource in CEDAR
        let existingName = ''

        const nodeName = resourceTreeNode.text;
        if (resourceType !== CONST.resourceType.FOLDER) {
          replaceRepoDomain(resourceContent, vm.repoDomain)

          const alreadyPresentResourceNames = new Set();

          // Check against the uploaded resources, if the resource is already present,
          // that means the user tried to upload the same resource multiple times and the system will reject it
          // Collect names of resources that match the @id
          uploadedResources
            .filter(res => res.content && res.content['@id'] === resourceContent['@id'])
            .forEach(res => {
              // save the originalName without the file extension and any suffixes, like the name of the duplicates etc.
              alreadyPresentResourceNames.add(res.originalName);
              resourceTreeNode.status = resourceImportStatus.DUPLICATE;
              vm.invalidWarningShown = false;
            });

          existingName = [...alreadyPresentResourceNames].join(', ');

          // existingName stores the name of the duplicates separated by commas
          if (existingName !== '') {
            resourceTreeNode.text = resourceTreeNode.text + ' (' + existingName + ')'
          }

          // If the resource is not already present in the uploaded resources, check against the already existing CEDAR resources
          if (resourceTreeNode.status !== resourceImportStatus.DUPLICATE) {
            await handleConflictingNode(resourceTreeNode);
          }
        } else if (isParentFolder) {
          // Check if any folder among the vm.alreadyPresentCedarResources (the CEDAR resources in the destination folder) has the same name as the current entry
          if (entryParent === jsTreeRootFolder) {
            await handleConflictingNode(resourceTreeNode);
          }

          // Check if any folder among the vm.uploadedResources has the same id as the fullPath of the current entry
          const fullPath = entryParent.endsWith('/') ? entryParent + nodeName : entryParent + '/' + nodeName + '/';
          const uploadedFolder = vm.uploadedResources.find(res => res.id === fullPath && res.resourceType === CONST.resourceType.FOLDER);
          if (uploadedFolder) {
            resourceTreeNode.status = resourceImportStatus.DUPLICATE;
            const alreadyPresentFolderNames = vm.uploadedResources
              .filter(res => res.resourceType === CONST.resourceType.FOLDER)
              .map(res => res.text);
            const generatedName = generateNewName(nodeName, alreadyPresentFolderNames);
            resourceTreeNode.text = generatedName;
          }

        }
        // return { resolvedName: newName, resolvedStatus: status };
      }

      /**
       * Identifies and processes conflicting resources during import
       * 
       * Process Flow:
       * 1. Folder Handling
       *    - Only checks top-level folders for conflicts with destination
       *    - Compares folder names with existing resources
       *    - Generates unique copy names for conflicting folders
       *    - Updates folder status and conflict metadata
       * 
       * 2. Non-folder Resource Handling
       *    - Checks if resource exists in CEDAR by @id
       *    - Updates status to CONFLICTING if match found
       *    - Propagates conflict status to parent folders
       *    - Preserves permission information (read/write)
       *    - Creates copy naming information
       * 
       * 3. Permission Management
       *    - Checks authorization for existing resources
       *    - Handles unauthorized cases gracefully
       *    - Sets proper permissions on conflicting resources
       * 
       * Note: This function is crucial for:
       * - Determining import resolution options
       * - Setting up UI indicators for conflicts
       * - Preparing resources for final import decision
       */
      async function handleConflictingNode(treeNode) {
        if (treeNode.resourceType === CONST.resourceType.FOLDER) {
          if (treeNode.parent === jsTreeRootFolder) {
            // Find matching folder in one pass
            const conflictingFolder = vm.alreadyPresentCedarResources.find(res =>
              res.resourceType === CONST.resourceType.FOLDER &&
              res['schema:name'] === treeNode.text
            );

            if (conflictingFolder) {
              treeNode.status = resourceImportStatus.CONFLICTING;
              // Generate new name and store conflict info
              treeNode.copyName = 'Copy of ' + treeNode.text;

              // Get existing names for generating unique name
              const existingNames = vm.alreadyPresentCedarResources
                .filter(res => res.resourceType === CONST.resourceType.FOLDER)
                .map(res => res['schema:name']);

              if (existingNames.includes(treeNode.copyName)) {
                const newFolderName = generateNewName(treeNode.copyName, existingNames);
                treeNode.copyName = newFolderName;
              }

              treeNode.combinedName = treeNode.text + ' (' + treeNode.copyName + ')';
              treeNode.conflictsWith = conflictingFolder['@id'];
            } else {
              delete treeNode.conflictsWith;
              delete treeNode.combinedName;
              treeNode.icon = "fa " + arpService.getResourceIcon(CONST.resourceType.FOLDER);
            }
          }
        } else {
          try {
            const resReport = await arpService.getResourceReportById(treeNode.content['@id'], treeNode.resourceType);
            treeNode.status = resourceImportStatus.CONFLICTING
            setParentFolderStatus(treeNode.parent, treeNode.status)
            // Get the parent folder ID from pathInfo
            const cedarParentFolderId = resReport.pathInfo[resReport.pathInfo.length - 2]['@id'];
            const parentFolder = await arpService.getResourceReportById(cedarParentFolderId, CONST.resourceType.FOLDER);
            treeNode.hasWritePermission = vm.isAdmin ? true : resourceService.canWrite(parentFolder);
            treeNode.hasReadPermission = vm.isAdmin ? true : resourceService.canRead(parentFolder);
            treeNode.cedarId = treeNode.content['@id'];
            treeNode.cedarParentFolderId = cedarParentFolderId;
            treeNode.copyName = 'Copy of ' + treeNode.text.split('.json')[0];
            treeNode.combinedName = treeNode.text + ' (' + treeNode.copyName + ')';
          } catch (e) {
            // Theres a resource with the given @id but the user does not have read access to it
            if (e.data.status === 'UNAUTHORIZED') {
              treeNode.status = resourceImportStatus.CONFLICTING;
              treeNode.cedarId = treeNode.content['@id'];
              treeNode.hasWritePermission = false;
              treeNode.hasReadPermission = false;
              treeNode.copyName = 'Copy of ' + treeNode.text.split('.json')[0];
              treeNode.combinedName = treeNode.text + ' (' + treeNode.copyName + ')';
            } else {
              // There is no resource in CEDAR with the given @id
              // check if there is a resource with the same name in the destination folder for some reason
              treeNode.status = resourceImportStatus.VALID;
            }
          }
        }
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

      // Refreshes the jsTrees and updates the vm.notAllCanBeReplaced flag
      function refreshUI() {
        vm.isTreeLoading = true;
        $timeout(function () {
          try {
            // Process each resource
            vm.uploadedResources.forEach(item => {
              if (item.type === 'file') {
                const isValidOrConflicting = [resourceImportStatus.VALID, resourceImportStatus.CONFLICTING].includes(item.status);

                if (isValidOrConflicting) {
                  // Add to uploadable resources
                  addResourceToMap(vm.uploadableResourcesMap, item.id, item);
                  updateParentFoldersRecursively(item.parent, item.status);
                  if (item.status === resourceImportStatus.CONFLICTING && !item.hasWritePermission) {
                    vm.notAllCanBeReplaced = true;
                  }
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
                      resourceType: "folder",
                      state: { opened: true }
                    };
                    addResourceToMap(vm.invalidResourcesMap, parentFolderId, folderConfig);
                  }
                }
              }
            });

            // Update the import status
            $scope.importStatus.validFiles = Array.from(vm.uploadableResourcesMap.values());
            $scope.importStatus.invalidFiles = Array.from(vm.invalidResourcesMap.values());

            // Update resources summary once
            updateUploadedResourcesSummary();

            // Refresh jsTrees
            const validTree = $('#jstree-valid').jstree(true);
            const closedNodesValid = validTree.get_json('#', { flat: true }).filter(node => node.resourceType === CONST.resourceType.FOLDER && !node.state.opened).map(node => node.id);
            closedNodesValid.forEach(node => vm.uploadedResources.find(res => res.id === node).state = { opened: false });
            $('#jstree-valid').jstree(true).refresh();
            $('#jstree-invalid').jstree(true).refresh();
          } finally {
            $timeout(() => {
              if (vm.invalidResourcesMap.size > 0 && !vm.invalidWarningShown) {
                UIMessageService.flashArpWarning('Check Invalid files tab', 'Invalid resource detected', 'Invalid resource detected', {
                  onClick: function () {
                    $timeout(function () {
                      $scope.importStatus.active = 1;
                    });
                  }
                });
                vm.invalidWarningShown = true;
              }
              // todo maybe add this to the refreshUI function but only on refresh
              vm.isTreeLoading = false;
              $scope.$apply(); // Force digest cycle
            });
          }
        });
      }

      $scope.isFileAndDirectoryUploadSupported = supportsFileAndDirectoryUpload();

      $scope.$watch('arpimport.isTreeLoading', function (newVal) {
        if (newVal) {
          $timeout(() => {
            vm.isTreeLoading = false;
            $scope.$apply();
          }); // Ensure loader shows for at least 2 seconds
        }
      });

      // Add these helper functions before refreshJsTrees
      function addResourceToMap(map, id, resource) {
        if (!map.has(id)) {
          if (resource.status === resourceImportStatus.CONFLICTING) {
            resource.resolveMethod = null;
          }
          map.set(id, resource);
        }
      }

      // Updates the status of the parent folders recursively
      // If the parent folder is a conflict with another folder in the destination folder, use a different icon
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


      // Update the updateNodeNames function to handle individual nodes
      function updateNodeNames(action, specificNodeId = null) {
        // If specificNodeId is provided, only update that node
        const selector = specificNodeId ?
          `.jstree-node[id="${specificNodeId}"]` :
          '.jstree-node';

        $('#jstree-valid').find(selector).each(function () {
          const $node = $(this);
          const nodeId = specificNodeId || $node.find('.node-action').data('node-id');
          const resource = vm.uploadableResourcesMap.get(nodeId);

          if (resource) {
            const $nameSpan = $node.find('> .jstree-anchor > .node-name');
            const currentAction = specificNodeId ? action : (resource.resolveMethod || action);

            if (currentAction === 'createCopy') {
              $nameSpan.text(resource.combinedName);
            } else {
              $nameSpan.text(resource.text);
            }
          }
        });
      }

      function updateUploadedResourcesSummary() {
        // Reset all arrays
        Object.keys(vm.uploadedResourcesSummary).forEach(key => {
          vm.uploadedResourcesSummary[key].resources = [];
          vm.uploadedResourcesSummary[key].count = 0;
        });

        // Single iteration through resources
        vm.uploadedResources.forEach(resource => {
          if (vm.uploadableResourcesMap.has(resource.id) && (resource.status === resourceImportStatus.VALID || resource.status === resourceImportStatus.CONFLICTING)) {
            const uploadableResource = vm.uploadableResourcesMap.get(resource.id);
            if (uploadableResource.resourceType === CONST.resourceType.FOLDER && !shouldBeUploaded(uploadableResource)) {
              vm.uploadedResourcesSummary.skipped.resources.push(uploadableResource);
              vm.uploadedResourcesSummary.skipped.count++;
            } else if (uploadableResource.resourceType !== CONST.resourceType.FOLDER && checkConflictingParentSkipped(uploadableResource)) {
              vm.uploadedResourcesSummary.skipped.resources.push(uploadableResource);
              vm.uploadedResourcesSummary.skipped.count++;
            } else if (uploadableResource.status === resourceImportStatus.VALID ||
              (uploadableResource.resourceType === CONST.resourceType.FOLDER && !uploadableResource.conflictsWith)) {
              vm.uploadedResourcesSummary.valid.resources.push(uploadableResource);
              vm.uploadedResourcesSummary.valid.count++;
            } else if (uploadableResource.status === resourceImportStatus.CONFLICTING) {
              if (uploadableResource.resolveMethod === 'createCopy') {
                vm.uploadedResourcesSummary.copied.resources.push(uploadableResource);
                vm.uploadedResourcesSummary.copied.count++;
              } else if (uploadableResource.resolveMethod === 'replace') {
                vm.uploadedResourcesSummary.replaced.resources.push(uploadableResource);
                vm.uploadedResourcesSummary.replaced.count++;
              } else if (uploadableResource.resolveMethod === 'skip') {
                vm.uploadedResourcesSummary.skipped.resources.push(uploadableResource);
                vm.uploadedResourcesSummary.skipped.count++;
              }
            }
          }
        });
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

