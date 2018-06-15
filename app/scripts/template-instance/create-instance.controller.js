'use strict';

define([
  'angular','flow'
], function (angular, flow) {
  angular.module('cedar.templateEditor.templateInstance.createInstanceController', [])
      .controller('CreateInstanceController', CreateInstanceController);

  CreateInstanceController.$inject = ["$translate", "$rootScope", "$scope", "$routeParams", "$location",
                                      "HeaderService", "TemplateService", "resourceService","TemplateInstanceService",
                                      "UIMessageService", "AuthorizedBackendService", "CONST", "$timeout",
                                      "QueryParamUtilsService", "FrontendUrlService", "ValidationService",
                                      "ValueRecommenderService", "UIUtilService", "DataManipulationService",
                                      "CedarUser"];

  function CreateInstanceController($translate, $rootScope, $scope, $routeParams, $location,
                                    HeaderService, TemplateService, resourceService,TemplateInstanceService,
                                    UIMessageService, AuthorizedBackendService, CONST, $timeout,
                                    QueryParamUtilsService, FrontendUrlService, ValidationService,
                                    ValueRecommenderService, UIUtilService, DataManipulationService,CedarUser) {

    // Get/read template with given id from $routeParams
    $scope.getTemplate = function () {
      AuthorizedBackendService.doCall(
          TemplateService.getTemplate($routeParams.templateId),
          function (response) {
            // Assign returned form object from FormService to $scope.form
            $scope.form = response.data;
            $rootScope.jsonToSave = $scope.form;
            $rootScope.rootElement = $scope.form;
            HeaderService.dataContainer.currentObjectScope = $scope.form;
            $rootScope.documentTitle = $scope.form['schema:name'];

            // Initialize value recommender service
            ValueRecommenderService.init($routeParams.templateId, $scope.form);

          },
          function (err) {
            UIMessageService.showBackendError('SERVER.TEMPLATE.load.error', err);
            $rootScope.goToHome();
          }
      );
    };

    $scope.details;
    $scope.cannotWrite;

    // $scope.isShowOutput = function () {
    //   return UIUtilService.isShowOutput();
    // };
    //
    // $scope.toggleShowOutput = function() {
    //   return UIUtilService.toggleShowOutput();
    // };
    //
    // $scope.scrollToAnchor = function(hash) {
    //   UIUtilService.scrollToAnchor(hash);
    // };
    //
    // $scope.getShowOutputTab = function () {
    //   return UIUtilService.getShowOutputTab();
    // };
    //
    // $scope.setShowOutputTab = function (index) {
    //   return UIUtilService.setShowOutputTab(index);
    // };
    //
    // $scope.toggleShowOutputTab = function (index) {
    //   return UIUtilService.toggleShowOutputTab(index);
    // };

    // create a copy of the form with the _tmp fields stripped out
    $scope.cleanForm = function () {
      var copiedForm = jQuery.extend(true, {}, $scope.instance);
      if (copiedForm) {
        DataManipulationService.stripTmps(copiedForm);
      }

        UIUtilService.toRDF();
        $scope.RDF = UIUtilService.getRDF();
        $scope.RDFError = UIUtilService.getRDFError();
        return copiedForm;
    };


    $scope.canWrite = function () {
      var result = !$scope.details || resourceService.canWrite($scope.details);
      $scope.cannotWrite  =!result;
      return result;
    };

    // This function watches for changes in the _ui.title field and autogenerates the schema title and description fields
    $scope.$watch('cannotWrite', function () {
      UIUtilService.setLocked($scope.cannotWrite);
    });

    var getDetails = function (id) {
      resourceService.getResourceDetailFromId(
          id, CONST.resourceType.INSTANCE,
          function (response) {
            $scope.details = response;
            $scope.canWrite();
          },
          function (error) {
            UIMessageService.showBackendError('SERVER.INSTANCE.load.error', error);
          }
      );
    };

    // validate the resource
    var checkValidation = function (node) {

      if (node) {
        return resourceService.validateResource(
            node, CONST.resourceType.INSTANCE,
            function (response) {

              var json = angular.toJson(response);
              var status = response.validates == "true";
              UIUtilService.logValidation(status, json);

              $timeout(function () {
                $rootScope.$broadcast("form:validation", { state: status });
              });

            },
            function (error) {
              UIMessageService.showBackendError('SERVER.INSTANCE.load.error', error);
            }
        );
      }
    };

    // Get/read instance with given id from $routeParams
    // Also read the template for it
    $scope.getInstance = function () {
      AuthorizedBackendService.doCall(
          TemplateInstanceService.getTemplateInstance($routeParams.id),
          function (instanceResponse) {
            $scope.instance = instanceResponse.data;
            checkValidation($scope.instance);
            UIUtilService.instanceToSave = $scope.instance;
            $scope.isEditData = true;
            $rootScope.documentTitle = $scope.instance['schema:name'];
            getDetails($scope.instance['@id']);


            AuthorizedBackendService.doCall(
                TemplateService.getTemplate(instanceResponse.data['schema:isBasedOn']),
                function (templateResponse) {
                  // Assign returned form object from FormService to $scope.form
                  $scope.form = templateResponse.data;
                  $rootScope.jsonToSave = $scope.form;
                  // Initialize value recommender service
                  var templateId = instanceResponse.data['schema:isBasedOn'];
                  ValueRecommenderService.init(templateId, $scope.form);
                },
                function (templateErr) {
                  UIMessageService.showBackendError('SERVER.TEMPLATE.load-for-instance.error', templateErr);
                }
            );
          },
          function (instanceErr) {
            UIMessageService.showBackendError('SERVER.INSTANCE.load.error', instanceErr);
            $rootScope.goToHome();
          }
      );
    };


    // Stores the data (instance) into the databases
    $scope.saveInstance = function () {
 
      this.disableSaveButton();
      var owner = this;

      $scope.runtimeErrorMessages = [];
      $scope.runtimeSuccessMessages = [];


      // Create instance if there are no required field errors
      //if ($rootScope.isEmpty($scope.emptyRequiredFields) && $rootScope.isEmpty($scope.invalidFieldValues) && $scope.instance['@id'] == undefined) {
      if ($scope.instance['@id'] == undefined) {
        // '@id' and 'templateId' haven't been populated yet, create now
        // $scope.instance['@id'] = $rootScope.idBasePath + $rootScope.generateGUID();
        $scope.instance['schema:isBasedOn'] = $routeParams.templateId;
        // Create fields that will store information used by the UI
        $scope.instance['schema:name'] = $scope.form['schema:name'] + $translate.instant("GENERATEDVALUE.instanceTitle")
        $scope.instance['schema:description'] = $scope.form['schema:description'] + $translate.instant(
                "GENERATEDVALUE.instanceDescription");
        // Make create instance call
        AuthorizedBackendService.doCall(
            TemplateInstanceService.saveTemplateInstance((QueryParamUtilsService.getFolderId() || CedarUser.getHomeFolderId()), $scope.instance),
            function (response) {

              UIUtilService.logValidation(response.headers("CEDAR-Validation-Status"));
              UIMessageService.flashSuccess('SERVER.INSTANCE.create.success', null, 'GENERIC.Created');
              // Reload page with element id
              var newId = response.data['@id'];
              $location.path(FrontendUrlService.getInstanceEdit(newId));
              $rootScope.$broadcast("form:clean");
              $rootScope.$broadcast("form:validation", {state: true});

              $timeout(function () {
                // don't show validation errors until after any redraws are done
                // thus, call this within a timeout
                $rootScope.$broadcast('submitForm');
              }, 1000);

            },
            function (err) {

              if (err.data.errorKey == "noWriteAccessToFolder") {
                AuthorizedBackendService.doCall(
                    TemplateInstanceService.saveTemplateInstance(CedarUser.getHomeFolderId(), $scope.instance),
                    function (response) {

                      UIUtilService.logValidation(response.headers("CEDAR-Validation-Status"));
                      UIMessageService.flashSuccess('SERVER.INSTANCE.create.success', null, 'GENERIC.Created');

                      // tell user where you put the instance
                      UIMessageService.flashWarning('SERVER.INSTANCE.create.homeFolder');

                      // Reload page with element id
                      var newId = response.data['@id'];
                      $location.path(FrontendUrlService.getInstanceEdit(newId));
                      $rootScope.$broadcast("form:clean");
                      $rootScope.$broadcast("form:validation", {state: true});

                      $timeout(function () {
                        // don't show validation errors until after any redraws are done
                        // thus, call this within a timeout
                        $rootScope.$broadcast('submitForm');
                      }, 1000);

                    },
                    function (err) {
                      UIMessageService.showBackendError('SERVER.INSTANCE.create.error', err);
                      owner.enableSaveButton();
                    }
                );

              } else {
                UIMessageService.showBackendError('SERVER.INSTANCE.create.error', err);
              }
              owner.enableSaveButton();
            }
        );
      }
      // Update instance
      //else if ($rootScope.isEmpty($scope.emptyRequiredFields) && $rootScope.isEmpty($scope.invalidFieldValues)) {
      else {
        AuthorizedBackendService.doCall(
            TemplateInstanceService.updateTemplateInstance($scope.instance['@id'], $scope.instance),
            function (response) {

              UIUtilService.logValidation(response.headers("CEDAR-Validation-Status"));

              UIMessageService.flashSuccess('SERVER.INSTANCE.update.success', null, 'GENERIC.Updated');
              owner.enableSaveButton();
              $rootScope.$broadcast("form:clean");
              $rootScope.$broadcast('submitForm');
            },
            function (err) {
              UIMessageService.showBackendError('SERVER.INSTANCE.update.error', err);
              owner.enableSaveButton();
            }
        );
      }
    };

    //*********** ENTRY POINT

    $rootScope.showSearch = false;

    // set Page Title variable when this controller is active
    $rootScope.pageTitle = 'Metadata Editor';

    // Giving $scope access to window.location for checking active state
    $scope.$location = $location;

    $scope.saveButtonDisabled = false;

    var pageId = CONST.pageId.RUNTIME;
    HeaderService.configure(pageId);

    // Create empty form object
    // Create empty instance object
    $scope.form = {};
    $scope.instance = {};
    UIUtilService.instanceToSave = $scope.instance;


    // Create new instance
    if (!angular.isUndefined($routeParams.templateId)) {
      $scope.getTemplate();
    }

    // Edit existing instance
    if (!angular.isUndefined($routeParams.id)) {
      $scope.getInstance();
    }

    // Initialize array for required fields left empty that fail required empty check
    $scope.emptyRequiredFields = {};
    // Event listener waiting for emptyRequiredField $emit from field-directive.js
    $scope.$on('emptyRequiredField', function (event, args) {
      if (args[0] == 'add') {
        $scope.emptyRequiredFields[args[2]] = args[1];
      }
      if (args[0] == 'remove') {
        delete $scope.emptyRequiredFields[args[2]];
      }
    });

    // Initialize array for validation errors
    $scope.validationErrors = {};
    // Event listener waiting for validationError $emit from form-directive.js
    $scope.$on('validationError', function (event, args) {
      if (args[0] == 'add') {
        $scope.validationErrors[args[2]] = args[1];
      }
      if (args[0] == 'remove') {
        // remove all of them
        $scope.validationErrors = {};
        //delete $scope.validationErrors[args[2]];
      }
    });

    // Initialize array for fields that are not conform to valueConstraints
    $scope.invalidFieldValues = {};
    // Event listener waiting for emptyRequiredField $emit from field-directive.js
    $scope.$on('invalidFieldValues', function (event, args) {
      if (args[0] == 'add') {
        $scope.invalidFieldValues[args[2]] = args[1];
      }
      if (args[0] == 'remove') {
        delete $scope.invalidFieldValues[args[2]];
      }
    });

    // Initialize array for fields that are not conform to max length constraint
    $scope.invalidFieldsValueTooLong = {};
    $scope.$on('valueTooLongError', function (event, args) {
      if (args[0] == 'add') {
        $scope.invalidFieldsValueTooLong[args[2]] = args[1];
      }
      if (args[0] == 'remove') {
        delete $scope.invalidFieldsValueTooLong[args[2]];
      }
    });

    // Initialize array for fields that are not conform to min length constraint
    $scope.invalidFieldsValueTooShort = {};
    $scope.$on('valueTooShortError', function (event, args) {
      if (args[0] == 'add') {
        $scope.invalidFieldsValueTooShort[args[2]] = args[1];
      }
      if (args[0] == 'remove') {
        delete $scope.invalidFieldsValueTooShort[args[2]];
      }
    });

    // Initialize array for fields that are not conform to max value constraint
    $scope.invalidFieldsValueTooBig = {};
    $scope.$on('valueTooBigError', function (event, args) {
      if (args[0] == 'add') {
        $scope.invalidFieldsValueTooBig[args[2]] = args[1];
      }
      if (args[0] == 'remove') {
        delete $scope.invalidFieldsValueTooBig[args[2]];
      }
    });

    // Initialize array for fields that are not conform to min value constraint
    $scope.invalidFieldsValueTooSmall = {};
    $scope.$on('valueTooSmallError', function (event, args) {
      if (args[0] == 'add') {
        $scope.invalidFieldsValueTooSmall[args[2]] = args[1];
      }
      if (args[0] == 'remove') {
        delete $scope.invalidFieldsValueTooSmall[args[2]];
      }
    });

    // Initialize array for fields that are not conform to decimal place constraint
    $scope.invalidFieldsIncorrectDecimalPlace = {};
    $scope.$on('decimalPlaceError', function (event, args) {
      if (args[0] == 'add') {
        $scope.invalidFieldsIncorrectDecimalPlace[args[2]] = args[1];
      }
      if (args[0] == 'remove') {
        delete $scope.invalidFieldsIncorrectDecimalPlace[args[2]];
      }
    });

    // cancel the form and go back to folder
    $scope.cancelTemplate = function () {
      $location.url(FrontendUrlService.getFolderContents(QueryParamUtilsService.getFolderId()));
    };

    $scope.enableSaveButton = function () {
      $timeout(function () {
        $scope.saveButtonDisabled = false;
      }, 1000);
    };

    $scope.disableSaveButton = function () {
      $scope.saveButtonDisabled = true;
    };

    //
    // custom validation services
    //

    $scope.isValidationTemplate = function (action) {
      var result;
      if ($rootScope.documentTitle) {
        result = ValidationService.isValidationTemplate($rootScope.documentTitle, action);
      }
      return result;
    };

    $scope.doValidation = function () {
      var type = ValidationService.isValidationTemplate($rootScope.documentTitle, 'validation');
      if (type) {
        $scope.$broadcast('external-validation', [type]);
      }
    };



    // // open the airr submission modal
    // $scope.flowModalVisible = false;
    // $scope.showFlowModal = function () {
    //   $scope.flowModalVisible = true;
    //   $scope.$broadcast('flowModalVisible', [$scope.flowModalVisible, $rootScope.instanceToSave]);
    // };

  };

});
