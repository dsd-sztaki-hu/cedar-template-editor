'use strict';

define([
  'angular'
], function (angular) {
  angular.module('cedar.templateEditor.service.uIMessageService', [])
      .service('UIMessageService', UIMessageService);

  UIMessageService.$inject = ['toasty', '$translate', '$timeout'];

  function UIMessageService(toasty, $translate, $timeout) {

    var service = {
      serviceId: "UIMessageService"
    };

    service.flashSuccess = function (messageKey, messageParameters, title) {
      this.flash('success', messageKey, messageParameters, title);
    };

    service.flashWarning = function (messageKey, messageParameters, title) {
      this.flash('warning', messageKey, messageParameters, title);
    };

    service.flashMessageNotification = function (message) {
      toasty['info']({
        title: message.subject,
        msg  : ""
      });
    };

    service.flash = function (type, messageKey, messageParameters, titleKey) {
      toasty[type]({
        title: $translate.instant(titleKey),
        msg  : $translate.instant(messageKey, messageParameters)
      });
    };

    service.conditionalOrConfirmedExecution = function (condition, callback, titleKey, textKey, confirmTextKey) {
      if (condition) {
        callback();
      } else {
        swal({
              title             : $translate.instant(titleKey),
              text              : $translate.instant(textKey),
              type              : "warning",
              showCancelButton  : true,
              confirmButtonText : $translate.instant(confirmTextKey),
              closeOnConfirm    : true,
              customClass       : 'cedarSWAL',
              confirmButtonColor: null
            },
            function (isConfirm) {
              if (isConfirm) {
                callback();
              }
            }
        );
      }
    };

    service.confirmedExecution = function (callback, titleKey, textKey, confirmTextKey) {
      swal({
            title             : $translate.instant(titleKey),
            text              : $translate.instant(textKey),
            type              : "warning",
            showCancelButton  : true,
            confirmButtonText : $translate.instant(confirmTextKey),
            closeOnConfirm    : true,
            customClass       : 'cedarSWAL',
            confirmButtonColor: null
          },
          function (isConfirm) {
            if (isConfirm) {
              callback();
            }
          });
    };

    service.acknowledgedExecution = function (callback, titleKey, textKey, confirmTextKey) {
      swal({
            title             : $translate.instant(titleKey),
            text              : $translate.instant(textKey),
            type              : "warning",
            showCancelButton  : false,
            confirmButtonText : $translate.instant(confirmTextKey),
            closeOnConfirm    : true,
            closeOnCancel     : false,
            customClass       : 'cedarSWAL',
            confirmButtonColor: null,
            html              : true
          },
          function () {
            callback();
          });
    };

    service.showWarning = function (titleKey, textKey, confirmTextKey, textParameters) {
      swal({
        title             : $translate.instant(titleKey),
        text              : $translate.instant(textKey, textParameters),
        type              : "warning",
        showCancelButton  : false,
        confirmButtonText : $translate.instant(confirmTextKey),
        closeOnConfirm    : true,
        customClass       : 'cedarSWAL',
        confirmButtonColor: null,
        html              : true
      });
    };

    service.showBackendWarning = function (title, text) {
      swal({
        title             : title,
        text              : text,
        type              : "warning",
        showCancelButton  : false,
        confirmButtonText : $translate.instant('GENERIC.Ok'),
        closeOnConfirm    : true,
        customClass       : 'cedarSWAL',
        confirmButtonColor: null,
        html              : true
      });
    };


    service.showBackendError = function (messageKey, response) {
      let errorObject = response.data;
      let interpolatedServerError = null;
      if (response.status === -1) {
        let params = {};
        params.url = response.config.url;
        interpolatedServerError = $translate.instant("SERVER.ERROR.BackendIsNotResponding", params);
        $timeout(function () {
          service.showBackendWarning(
              $translate.instant('GENERIC.Error'),
              interpolatedServerError
          );
        }, 500);
        return;
      }
      // Test if this is an error that we are expecting:
      // If yes, show a warning, and return
      // If not, this is a server error, and we should show it.
      if (errorObject.hasOwnProperty("errorKey")) {
        let i18nKey = 'REST_ERROR.' + errorObject.errorKey;
        interpolatedServerError = $translate.instant(i18nKey, errorObject.parameters);
        if (interpolatedServerError !== i18nKey) {
          if (errorObject.hasOwnProperty("errorReasonKey")) {
            let i18nReasonKey = 'REST_ERROR_REASON.' + errorObject.errorReasonKey;
            let interpolatedServerReason = $translate.instant(i18nReasonKey, errorObject.parameters);
            if (interpolatedServerReason !== i18nReasonKey) {
              interpolatedServerError += "<br /><br />" + interpolatedServerReason;
            }
          }
          $timeout(function () {
            service.showBackendWarning(
                $translate.instant('GENERIC.Warning'),
                interpolatedServerError
            );
          }, 500);
          return;
        }
      }

      toasty.error({
        title  : $translate.instant('SERVER.ERROR.title'),
        msg    : $translate.instant(messageKey),
        //timeout: false,
        onClick: function () {
          let message, exceptionMessage, stackTraceHtml, statusCode, statusText, url, method, errorKey, errorReasonKey, objects;
          statusCode = response.status;
          statusText = response.statusText;
          url = response.config.url;
          method = response.config.method;
          //console.log(response);
          stackTraceHtml = "N/A";
          objects = 'N/A';
          exceptionMessage = 'N/A';
          if (response.status === -1) {
            message = $translate.instant('SERVER.ERROR.InaccessibleMessage');
            exceptionMessage = $translate.instant('SERVER.ERROR.InaccessibleMessageString');
          } else {
            if (errorObject !== null) {
              message = errorObject.errorMessage;
              errorKey = errorObject.errorKey;
              errorReasonKey = errorObject.errorReasonKey;
              if (errorObject.hasOwnProperty('objects')) {
                objects = '<textarea style="height: 100px; white-space: pre">';
                objects += JSON.stringify(errorObject.objects, null, '  ');
                objects += '</textarea>';
              }
              if (errorObject.hasOwnProperty('sourceException')) {
                let ex = errorObject.sourceException;
                if (ex != null) {
                  if (ex.hasOwnProperty('message')) {
                    exceptionMessage = ex.message;
                  }
                  if (ex.hasOwnProperty('stackTrace') && ex.stackTrace != null) {
                    stackTraceHtml = '<textarea style="height: 100px; white-space: pre">';
                    for (let i in ex.stackTrace) {
                      stackTraceHtml += ex.stackTrace[i].className
                          + " -> " + ex.stackTrace[i].methodName
                          + " ( " + ex.stackTrace[i].lineNumber + " )"
                          + "\n";
                    }
                    stackTraceHtml += "</textarea>";
                  }
                }
              }
            }
          }

          let content = $translate.instant('SERVER.ERROR.technicalDetailsTemplate', {
            message       : message,
            errorKey      : errorKey,
            errorReasonKey: errorReasonKey,
            exception     : exceptionMessage,
            statusCode    : statusCode,
            statusText    : statusText,
            url           : url,
            method        : method,
            objects       : objects
          });
          content += '<b>Stack trace</b>:' + stackTraceHtml + '<br />';
          content += '<b>Error details</b>:' + objects + '<br />';
          content += '<br/>';
          swal({
            title      : $translate.instant('SERVER.ERROR.technicalDetailsTitle'),
            type       : "error",
            customClass: "errorTechnicalDetails",
            text       : content,
            html       : true
          });
        }
      });
    }

    service.showArpError = function (messageKey, response) {
      toasty.error({
        title  : $translate.instant('ARP.ERROR.templateExportTitle'),
        msg    : $translate.instant(messageKey),
        onClick: function () {
          let content
          if (response.data == null) {
            content = '<pre>' + $translate.instant('ARP.ERROR.unavailable') + '</pre>'
          } else if (response.data.message) {
            let resp = response.data.message
            let incompPairs = ''
            if (resp.incompatiblePairs) {
              for (const [key, value] of Object.entries(resp.incompatiblePairs)) {
                let values = ''
                for (const [k, v] of Object.entries(JSON.parse(JSON.stringify(value)))) {
                  values += '\n\t\t' + k + ': ' + v
                }
                incompPairs = incompPairs.concat(key, values)
              }
            }
            content = $translate.instant('ARP.ERROR.templateExport', {
              unprocessableElements: resp.unprocessableElements ? '\n\t' + resp.unprocessableElements.join('\n\t') : 'N/A',
              invalidNames: resp.invalidNames ? '\n\t' + resp.invalidNames.join('\n\t') : 'N/A',
              incompatiblePairs: incompPairs ? '\n\t' + incompPairs : 'N/A'
            })
          } else {
            content = '<pre>' + response.data + '</pre>'
          }
          swal({
            title:   $translate.instant('ARP.ERROR.templateExportTitle'),
            customClass: "arpErrorDetails",
            text:   content,
            type:   "error",
            html:   true
          })
        }
      });
    }

    return service;
  }

});
