'use strict';

define([
  'angular'
], function (angular) {
  angular.module('cedar.templateEditor.searchBrowse.cedarDropdownMenuDirective', [])
      .directive('cedarDropdownMenu', cedarDropdownMenuDirective);


  cedarDropdownMenuDirective.$inject = [];

  function cedarDropdownMenuDirective() {


    var linker = function (scope, element, attrs) {
    };

    return {
      templateUrl: 'scripts/search-browse/cedar-dropdown-menu.directive.html',
      restrict   : 'EA',
      scope      : {
        resource                    : '=',
        goTo                        : '=',
        share                       : '=',
        move                        : '=',
        delete                      : '=',
        copy                        : '=',
        rename                      : '=',
        publishModal                : '=',
        publishCallback             : '=',
        draftCallback               : '=',
        submit                      : '=',
        makeOpen                    : '=',
        makeNotOpen                 : '=',
        openOpen                    : '=',
        openDatacite                : '=',
        openDownload                : '=',
        canNotPopulate              : '=',
        canNotPublish               : '=',
        canNotCreateDraft           : '=',
        canNotWrite                 : '=',
        canNotShare                 : '=',
        canNotDelete                : '=',
        canNotSubmit                : '=',
        canNotMakeOpen              : '=',
        canNotMakeNotOpen           : '=',
        canNotOpenOpen              : '=',
        canNotOpenDatacite          : '=',
        canNotOpenDownload          : '=',
        isFolder                    : '=',
        toggleId                    : "=",
        getSelectedFolderId         : "=",
        getSelectedParentFolderId   : "=",
        copyFolderId2Clipboard      : "=",
        copyParentFolderId2Clipboard: "=",
        isMeta                      : "=",
        isAdmin                     : "=",
        arpCopy                     : "=",
        arpDelete                   : "=",
        canNotArpDelete             : "=",
        canNotArpCopy               : "=",
        arpGoToOriginal             : "=",
        hasDerivedFrom              : "=",
        arpZipDownload              : "=",
        arpExtractResources         : "=",
        isExtractableResource               : "=",
        isArpCopyButtonEnabled      : "=",
        isArpDownloadZipButtonEnabled : "=",
      },
      controller : function ($scope, $element) {
      },
      replace    : true,
      link       : linker
    };

  }

})
;
