'use strict';
var WorkspacePage = require('../pages/workspace-page.js');
var ToastyModal = require('../modals/toasty-modal.js');
var testConfig = require('../config/test-env.js');
var MoveModal = require('../modals/move-modal.js');

var _ = require('../libs/lodash.min.js');

/**
 *
 * clean up the workspace by resetting the default user permisisons and deleting any leftover resources
 *
 */
describe('clean-up', function () {
  var EC = protractor.ExpectedConditions;
  var workspacePage = WorkspacePage;
  var toastyModal = ToastyModal;
  var moveModal = MoveModal;
  var resourceTypes = [ 'metadata', 'template', 'element', 'folder'];
  var max = 0;

  // before each test maximize the window area for clicking
  beforeEach(function () {
  });

  afterEach(function () {
  });

  // reset user selections to defaults
  it('should be on the workspace', function () {
    workspacePage.onWorkspace();
  });

  // reset user selections to defaults
  it('should default user selections for user 2', function () {
    workspacePage.logout();
    workspacePage.login(testConfig.testUser2, testConfig.testPassword2);
    workspacePage.initPreferences();
  });

  // reset user selections to defaults
  it('should default user selections for user 1', function () {
    workspacePage.logout();
    workspacePage.login(testConfig.testUser1, testConfig.testPassword1);
    workspacePage.initPreferences();
  });


  // delete some number of files of each type
  // turn this on to delete left over stuff from staging
  for (var i = 0; i < max; i++) {
    (function () {

      // for each resource type
      //for (var k = 0; k < resourceTypes.length; k++) {
      for (var k = 0; k < 1; k++) {
        (function (type) {

          // try to delete some number of files
          for (var j = 0; j < max; j++) {
            (function () {

              xit('should delete any template from the user workspace', function () {
                workspacePage.deleteResourceViaRightClick(workspacePage.defaultTitle(), type);
                toastyModal.isSuccess();
                workspacePage.clearSearch();
              });

            })
            ();
          }

        })
        (resourceTypes[k]);
      }

    })
    ();
  }

  // TODO this does not work if folders contain files which are not deleted first. Those
  // files can belong to other users and are not visible to the logged in user
  // turn this on if you need to clean up the workspace
  // this deletes by searching for resources by type
  // this fails if we have resource inside folders that we cannot write
  xit('should delete any Protractor resource from the user workspace by searching', function () {
    workspacePage.resourceTypes().forEach(function (type) {
      workspacePage.deleteAllBySearching(workspacePage.defaultTitle(), type);
    });
  });


});

