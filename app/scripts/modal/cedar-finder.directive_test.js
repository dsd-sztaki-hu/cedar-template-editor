'use strict';

define(['app', 'angular'], function (app) {

  describe('cedar-finder.directive_test.js:', function () {

    var $rootScope;
    var $compile;
    var $controller;
    var $httpBackend;
    var UIMessageService;
    var resourceService;
    var UISettingsService;
    var QueryParamUtilsService;

    var appData = {
      CedarUserProfile: {
        uiPreferences: {
          folderView         : {
            currentFolderId: null,
            sortBy         : "createdOnTS",
            sortDirection  : "asc",
            viewMode       : "grid"
          },
          infoPanel          : {
            opened: false
          },
          metadataEditor     : {
            metadataJsonViewer: false,
            templateViewer    : false
          },
          resourceTypeFilters: {
            template: false,
            element : false,
            field   : false,
            instance: false
          },
          templateEditor     : {
            templateViewer: false
          }
        }
      }
    };

    // Load the module that contains the templates that were loaded with html2js
    beforeEach(module('my.templates'));
    // Load other modules
    beforeEach(module(app.name));
    beforeEach(module('cedar.templateEditor.modal.cedarFinderDirective'));
    beforeEach(module('cedar.templateEditor.service.uIMessageService'));
    beforeEach(module('cedar.templateEditor.service.resourceService'));
    beforeEach(module('cedar.templateEditor.service.uISettingsService'));
    beforeEach(module('cedar.templateEditor.service.queryParamUtilsService'));
    // we need to register our alternative version of CedarUser, before we call inject.
    beforeEach(angular.mock.module(function ($provide) {
      $provide.service('CedarUser', function mockCedarUser() {
        var cedarUser = {
          init            : function () {
            return true
          },
          setAuthProfile  : function () {
            return true
          },
          setCedarProfile : function () {
            return true
          },
          getUIPreferences: function () {
            return appData.CedarUserProfile.uiPreferences
          },
          getHomeFolderId : function () {
            return null
          },
          isSortByName    : function () {
            return false
          },
          isSortByCreated : function () {
            return true
          },
          isSortByUpdated : function () {
            return false
          },
          isListView      : function () {
            return true
          },
          isGridView      : function () {
            return false
          }
        };
        return cedarUser;
      });
    }));
    beforeEach(module('cedar.templateEditor.modal.cedarFinderDirective', function ($provide) {
      $provide.factory('cedarInfiniteScrollDirective', function () {
        return {};
      });
    }));

    beforeEach(inject(
        function (_$rootScope_, _$compile_, _$controller_, _$httpBackend_,
                  _UIMessageService_, _resourceService_, _UISettingsService_, _QueryParamUtilsService_) {
          $rootScope = _$rootScope_.$new(); // create new scope
          $compile = _$compile_;
          $controller = _$controller_;
          $httpBackend = _$httpBackend_;
          UIMessageService = _UIMessageService_;
          resourceService = _resourceService_;
          UISettingsService = _UISettingsService_;
          QueryParamUtilsService = _QueryParamUtilsService_;
        }));

    beforeEach(function () {
      $httpBackend.whenGET('resources/i18n/locale-en.json').respond(function (method, url, data) {
        var request = new XMLHttpRequest();
        request.open('GET', 'resources/i18n/locale-en.json', false);
        request.send(null);
        return [request.status, request.response, {}];
      });
      $httpBackend.whenGET('config/url-service.conf.json?v=undefined').respond(function (method, url, data) {
        var request = new XMLHttpRequest();
        request.open('GET', 'config/url-service.conf.json?v=undefined', false);
        request.send(null);
        return [request.status, request.response, {}];
      });
      $httpBackend.whenGET('img/plus.png').respond(function (method, url, data) {
        var request = new XMLHttpRequest();
        request.open('GET', 'img/plus.png', false);
        request.send(null);
        return [request.status, request.response, {}];
      });
      $httpBackend.whenGET('img/close_modal.png').respond(function (method, url, data) {
        var request = new XMLHttpRequest();
        request.open('GET', 'img/close_modal.png', false);
        request.send(null);
        return [request.status, request.response, {}];
      });
    });

    describe('In a template,', function () {
      describe('a finder widget', function () {

        var $finderScope;
        var finderDirective;
        var finderSelector = ".subm";
        var searchInput = '#finder-search-form input';
        var finderSearch = '#finder-search-form input';
        var modalHeader = '#finderModalHeader';
        var gridView = '#finderModalHeader .fa-th';
        var listView = '#finderModalHeader .fa-list-ul';
        var sortButton = '#finderModalHeader .fa-sort';
        var sortByName = '.sort-by-name';
        var sortByCreated = 'sort-by-created';
        var sortByUpdated = '.sort-by-updated';
        var hiddenRemove = '#finder-search-input a.clear-search.ng-hide';
        var inputNotEmpty = '#finder-search-input.ng-not-empty';

        beforeEach(function () {
          // create a new, isolated scope and a new directive
          $finderScope = $rootScope.$new();
          finderDirective = '<cedar-finder  modal-visible="finderModalVisible"   select-resource-callback="" pick-resource-callback="" ></cedar-finder>';
          finderDirective = $compile(finderDirective)($finderScope);
          $finderScope.$digest();
        });

        it("should have buttons defined by default", function () {
          var elm = finderDirective[0];
          expect(elm.querySelector(modalHeader)).toBeDefined();
          expect(elm.querySelector(searchInput)).toBeDefined();
          expect(elm.querySelector(sortButton)).toBeDefined();
        });

        it("should open the sort dropdown when clicked", function () {
          var elm = finderDirective[0];
          elm.querySelectorAll(sortButton)[0].click();
          expect(elm.querySelector('#finderModalHeader .dropdown.open .sort-by-name')).toBeDefined();
          expect(elm.querySelector('#finderModalHeader .dropdown.open .sort-by-name')).toBeDefined();
          expect(elm.querySelector('#finderModalHeader .dropdown.open .sort-by-name')).toBeDefined();
        });

        it("should show grid or list view", function () {
          var elm = finderDirective[0];
          if (elm.querySelector('#finder-modal .tool.list-view')) {
            expect(elm.querySelector('.populate-form-boxes .grid-view')).toBeDefined();
          } else {
            expect(elm.querySelector('.populate-form-boxes .list-view')).toBeDefined();
          }
        });

        it("should handle breadcrumb and search interaction", function () {
          var elm = finderDirective[0];
          expect(elm.querySelector('.breadcrumbs-sb')).toBeDefined();

          // click on the first breadcrumb 'All'
          elm.querySelectorAll('.breadcrumbs-sb .breadcrumbs')[0].click();
          $finderScope.$digest();

          // var enterKey = jQuery.Event("keydown", {
          //   keyCode: 13
          // });
          //
          // elm.trigger(enterKey);

          // enter 'test' into the search field
          //expect(elm.querySelector(hiddenRemove)).toBeDefined();
          console.log('#finder-search-input ');console.log(elm.querySelector('#finder-search-input'));
          elm.querySelector(searchInput).value = 'test';
          $finderScope.$digest();

          //console.log('inputNotEmpty ' + elm.querySelector(inputNotEmpty));
          //console.log('hiddenRemove ' + elm.querySelector(hiddenRemove));


          elm.querySelectorAll('#finder-search-form a.do-search')[0].click();
          $finderScope.$digest();
          console.log('#finder-search-input ');console.log(elm.querySelector('#finder-search-input'));

          // expect the remove x to appear and the breadcrumbs to disappear
          expect(elm.querySelector(hiddenRemove).length === 0).toBeTruthy();
          //console.log(elm.querySelectorAll('.breadcrumbs-sb a.ng-hide .breadcrumbs'));
          expect(elm.querySelector('#finder-search-form a.ng-hide .fa-remove').length == 0).toBeTruthy();

          // console.log(elm.querySelectorAll('.breadcrumbs-sb a.ng-hide .breadcrumbs'));
          // expect(elm.querySelectorAll('.breadcrumbs-sb a.ng-hide .breadcrumbs').length > 0).toBeTruthy();
          //
          // // click remove and make sure the search input is now empty
          // elm.querySelectorAll('#finder-search-form .fa-remove')[0].click();
          //
          // // expect search to be cleared and the breadcrumbs to return
          // expect(elm.querySelector(searchInput).value === '').toBeTruthy();
          // //console.log(elm.querySelectorAll('.breadcrumbs-sb .ng-hide .breadcrumbs'));
          // expect(elm.querySelectorAll('.breadcrumbs-sb a.ng-hide .breadcrumbs').length === 0).toBeFalsy();
          // //console.log(elm.querySelectorAll('.breadcrumbs-sb .breadcrumbs'));
        });

      });
    });


  });
});
