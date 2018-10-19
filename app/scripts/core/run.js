/*jslint node: true */
/*global define */
'use strict';

define([
  'angular'
], function (angular) {
  angular.module('cedar.templateEditor.core.run', [])
      .run(cedarTemplateEditorCoreRun);

  cedarTemplateEditorCoreRun.$inject = ['$rootScope', '$window', 'DataTemplateService',
                                        'DataManipulationService', 'FieldTypeService', 'UrlService',
                                        'UserService', 'RichTextConfigService',
                                        'provisionalClassService', 'CedarUser', 'UISettingsService',
                                        'TrackingService', 'MessagingService',
                                        '$httpParamSerializer', '$location'];


  function cedarTemplateEditorCoreRun($rootScope, $window, DataTemplateService,
                                      DataManipulationService, FieldTypeService, UrlService,
                                      UserService, RichTextConfigService,
                                      provisionalClassService, CedarUser, UISettingsService,
                                      TrackingService, MessagingService,
                                      $httpParamSerializer, $location) {

    $rootScope.isArray = angular.isArray;

    $rootScope.pageId = null;

    $rootScope.sortableOptions = {
      handle: ".sortable-handler"
    };

    $rootScope.propertiesOf = DataManipulationService.propertiesOf;
    $rootScope.schemaOf = DataManipulationService.schemaOf;


    // Simple function to check if an object is empty
    $rootScope.isEmpty = function (obj) {
      return !obj || Object.keys(obj).length === 0;
    };


    CedarUser.init();
    // Make it available for everybody through rootScope
    $rootScope.cedarUser = CedarUser;

    // Inject user data:
    // read from Keycloak
    // read in Non-Angular way from user.... REST endpoint
    UserService.injectUserHandler($window.bootstrapUserHandler);

    $rootScope.createUUID = function () {
      var dt = new Date().getTime();
      var uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = (dt + Math.random()*16)%16 | 0;
        dt = Math.floor(dt/16);
        return (c=='x' ? r :(r&0x3|0x8)).toString(16);
      });
      return uuid;
    };

    $window.cedarClientSessionId = $rootScope.createUUID();

    // Init the services that have dependencies on configuration
    DataTemplateService.init();
    FieldTypeService.init();
    UrlService.init();
    provisionalClassService.init();
    DataManipulationService.init();
    UISettingsService.init();
    TrackingService.init();
    MessagingService.init();

    // Make objects available through rootScope
    //$rootScope.cts = ControlledTermService;
    //$rootScope.vrs = ValueRecommenderService;
    $rootScope.editorOptions = RichTextConfigService.getConfig("default");

    $rootScope.util = {
      buildUrl: function (url, params) {
        var serializedParams = $httpParamSerializer(params);
        if (serializedParams.length > 0) {
          url += ((url.indexOf('?') === -1) ? '?' : '&') + serializedParams;
        }
        return url;
      }
    };

    //$rootScope.$on('$locationChangeStart', function (event) {
    //  $rootScope.setHeader();
    //});

    $rootScope.setHeader = function () {

      var a = jQuery("#rootElement");
      var e = jQuery("#top-navigation");

      a.removeClass('metadata').removeClass('template').removeClass('dashboard').removeClass('element').removeClass('field');
      e.removeClass('metadata').removeClass('template').removeClass('dashboard').removeClass('element').removeClass('field');

      if ($location.path().startsWith("/dashboard")) {
        a.addClass('dashboard');
        e.addClass('dashboard');

      } else if ($location.path().startsWith("/elements")) {
        a.addClass('element');
        e.addClass('element');

      } else if ($location.path().startsWith("/templates")) {
        a.addClass('template');
        e.addClass('template');

      } else if ($location.path().startsWith("/fields")) {
        a.addClass('field');
        e.addClass('field');

      } else if ($location.path().startsWith("/instances")) {
        a.addClass('metadata');
        e.addClass('metadata');
      }


    };


  }

});
