'use strict';

define([
  'angular'
], function (angular) {
  angular.module('cedar.templateEditor.service.templateElementService', [])
      .service('TemplateElementService', TemplateElementService);

  TemplateElementService.$inject = ['HttpBuilderService', 'UrlService', 'CedarUser'];

  function TemplateElementService(HttpBuilderService, UrlService, CedarUser) {

    var service = {
      serviceId: "TemplateElementService"
    };

    service.getTemplateElement = function (id) {
      return HttpBuilderService.get(UrlService.getTemplateElement(id));
    };

    service.deleteTemplateElement = function (id) {
      return HttpBuilderService.delete(UrlService.getTemplateElement(id));
    };

    service.saveTemplateElement = function (folderId, element) {
      return HttpBuilderService.post(UrlService.postTemplateElement(folderId), angular.toJson(element));
    };

    service.updateTemplateElement = function (id, element) {
      return HttpBuilderService.put(UrlService.getTemplateElement(id), angular.toJson(element));
    };

    service.canArpMergeTemplateElement = function () {
      return CedarUser.getRoles().includes("userAdministrator");
    }

    return service;

  }

});
