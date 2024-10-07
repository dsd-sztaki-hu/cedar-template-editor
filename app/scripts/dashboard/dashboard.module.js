'use strict';

define([
  'angular',
  'cedar/template-editor/dashboard/dashboard.routes',
  'cedar/template-editor/dashboard/dashboard.controller',
  'cedar/template-editor/search-browse/cedar-search-browse-picker.directive',
  'cedar/template-editor/search-browse/cedar-infinite-scroll.directive',
  'cedar/template-editor/search-browse/cedar-dropdown-menu.directive',
  'cedar/template-editor/search-browse/cedar-modal-show.directive',
  'cedar/template-editor/modal/cedar-share-modal.directive',
  'cedar/template-editor/modal/cedar-test-modal.directive',
  'cedar/template-editor/modal/cedar-move-modal.directive',
  'cedar/template-editor/modal/cedar-publish-modal.directive',
  'cedar/template-editor/modal/cedar-copy-modal.directive',
  'cedar/template-editor/modal/cedar-arp-copy-modal.directive',
  'cedar/template-editor/modal/cedar-rename-modal.directive',
  'cedar/template-editor/modal/cedar-arp-merge-modal.directive',
  'cedar/template-editor/modal/cedar-arp-merge-preview-modal.directive',
  'cedar/template-editor/modal/cedar-arp-zip-download-modal.directive',
  'cedar/template-editor/modal/cedar-new-folder-modal.directive',
  'cedar/template-editor/modal/cedar-import-modal.directive',
  'cedar/template-editor/search-browse/cedar-live-search.directive',
  'cedar/template-editor/form/auto-focus.directive',
  'cedar/template-editor/search-browse/flow-modal.directive',
  'cedar/template-editor/widget/cedar-resource-icon.directive',
  'cedar/template-editor/category-tree/category-tree.controller',
  'cedar/template-editor/category-tree/category-tree.directive',
  'cedar/template-editor/category-tree/category-tree-node.directive',
  'cedar/template-editor/category-tree/category-tree-helper'
], function (angular) {
  angular.module('cedar.templateEditor.dashboard', [
    'cedar.templateEditor.dashboard.routes',
    'cedar.templateEditor.dashboard.dashboardController',
    'cedar.templateEditor.searchBrowse.cedarSearchBrowsePickerDirective',
    'cedar.templateEditor.searchBrowse.cedarInfiniteScrollDirective',
    'cedar.templateEditor.searchBrowse.cedarDropdownMenuDirective',
    'cedar.templateEditor.searchBrowse.cedarModalShowDirective',
    'cedar.templateEditor.modal.cedarShareModalDirective',
    'cedar.templateEditor.modal.cedarTestModalDirective',
    'cedar.templateEditor.modal.cedarMoveModalDirective',
    'cedar.templateEditor.modal.cedarPublishModalDirective',
    'cedar.templateEditor.modal.cedarCopyModalDirective',
    'cedar.templateEditor.modal.cedarArpCopyModalDirective',
    'cedar.templateEditor.modal.cedarRenameModalDirective',
    'cedar.templateEditor.modal.cedarArpMergeModalDirective',
    'cedar.templateEditor.modal.cedarArpMergePreviewModalDirective',
    'cedar.templateEditor.modal.cedarArpZipDownloadModalDirective',
    'cedar.templateEditor.modal.cedarNewFolderModalDirective',
    'cedar.templateEditor.modal.cedarImportModalDirective',
    'cedar.templateEditor.searchBrowse.cedarLiveSearchDirective',
    'cedar.templateEditor.form.autoFocusDirective',
    'cedar.templateEditor.searchBrowse.flowModal',
    'cedar.templateEditor.widget.cedarResourceIconDirective',
    'cedar.templateEditor.categoryTree.categoryTreeController',
    'cedar.templateEditor.categoryTree.categoryTreeDirective',
    'cedar.templateEditor.categoryTree.categoryTreeNodeDirective',
    'cedar.templateEditor.categoryTree.categoryTreeHelper',
  ]);
});
