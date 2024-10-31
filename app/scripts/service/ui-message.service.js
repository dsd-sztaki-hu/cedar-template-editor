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
        msg: ""
      });
    };

    service.flash = function (type, messageKey, messageParameters, titleKey) {
      toasty[type]({
        title: $translate.instant(titleKey),
        msg: $translate.instant(messageKey, messageParameters)
      });
    };

    service.conditionalOrConfirmedExecution = function (condition, callback, titleKey, textKey, confirmTextKey) {
      if (condition) {
        callback();
      } else {
        Swal.fire({
          title: $translate.instant(titleKey),
          text: $translate.instant(textKey),
          icon: "warning",
          showCancelButton: true,
          confirmButtonText: $translate.instant(confirmTextKey),
          customClass: {
            popup: 'cedarSWAL'
          }
        }).then((result) => {
          if (result.isConfirmed) {
            callback();
          }
        });
      }
    };

    service.confirmedExecution = function (callback, titleKey, textKey, confirmTextKey) {
      Swal.fire({
        title: $translate.instant(titleKey),
        text: $translate.instant(textKey),
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: $translate.instant(confirmTextKey),
        customClass: {
          popup: 'cedarSWAL'
        }
      }).then((result) => {
        if (result.isConfirmed) {
          callback();
        }
      });
    };

    service.acknowledgedExecution = function (callback, titleKey, textKey, confirmTextKey) {
      Swal.fire({
        title: $translate.instant(titleKey),
        html: $translate.instant(textKey),
        icon: 'warning',
        showCancelButton: false,
        confirmButtonText: $translate.instant(confirmTextKey),
        customClass: {
          popup: 'cedarSWAL'
        }
      }).then((result) => {
        if (result.isConfirmed) {
          callback();
        }
      });
    };

    service.showWarning = function (titleKey, textKey, confirmTextKey, textParameters) {
      Swal.fire({
        title: $translate.instant(titleKey),
        html: $translate.instant(textKey, textParameters),
        icon: "warning",
        showCancelButton: false,
        confirmButtonText: $translate.instant(confirmTextKey),
        customClass: {
          popup: 'cedarSWAL'
        },
      });
    };

    service.showBackendWarning = function (title, text) {
      Swal.fire({
        title: title,
        html: text,
        icon: 'warning',
        showCancelButton: false,
        confirmButtonText: $translate.instant('GENERIC.Ok'),
        customClass: {
          popup: 'cedarSWAL'
        },
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
        title: $translate.instant('SERVER.ERROR.title'),
        msg: $translate.instant(messageKey),
        //timeout: false,
        onClick: function () {
          let message, exceptionMessage, stackTraceHtml, statusCode, statusText, url, method, errorKey, errorReasonKey, objects;
          statusCode = response.status;
          statusText = response.statusText;
          url = response.config.url;
          method = response.config.method;
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
            message: message,
            errorKey: errorKey,
            errorReasonKey: errorReasonKey,
            exception: exceptionMessage,
            statusCode: statusCode,
            statusText: statusText,
            url: url,
            method: method,
            objects: objects
          });
          content += '<b>Stack trace</b>:' + stackTraceHtml + '<br />';
          content += '<b>Error details</b>:' + objects + '<br />';
          content += '<br/>';
          Swal.fire({
            title: $translate.instant('SERVER.ERROR.technicalDetailsTitle'),
            icon: 'error',
            customClass: {
              popup: 'errorTechnicalDetails'
            },
            html: content
          });
        }
      });
    }

    service.showArpError = function (titleKey, messageKey, response) {
      toasty.error({
        title: $translate.instant(titleKey),
        msg: $translate.instant(messageKey),
        onClick: function () {
          let content = ''
          let resp;
          if (response.data == null) {
            content = '<pre>' + $translate.instant('ARP.validationError.unavailable') + '</pre>'
          } else if (response.data.message) {
            resp = response.data.message
          } else {
            const errorString = response.data.match(/:\s*(\{.*})$/)[1];
            resp = angular.fromJson(errorString);
          }
          if (resp) {
            if (resp.invalidNames) {
              content = content.concat($translate.instant('ARP.validationError.invalidNames', { invalidNames: '\n\t' + resp.invalidNames.join('\n\t') }));
            }

            if (resp.unprocessableElements) {
              content = content.concat($translate.instant('ARP.validationError.unprocessableElements', { unprocessableElements: '\n\t' + resp.unprocessableElements.join('\n\t') }));
            }

            if (resp.errors) {
              content = content.concat($translate.instant('ARP.validationError.otherErrors', { errors: '\n\t' + resp.errors.join('\n\t') }));
            }
            content = '<pre class="arpHtmlAlignedPre">' + content + '</pre>'
          } else {
            content = '<pre>' + response.data + '</pre>'
          }

          function showErrors() {
            Swal.fire({
              title: $translate.instant(titleKey),
              icon: 'error',
              html: content,
              showCancelButton: true,
              confirmButtonText: 'OK',
              cancelButtonText: 'Close',
              footer: '<button id="more-info-button" class="swal2-more-info-button">' + $translate.instant('ARP.validationError.footerText') + '</button>',
              customClass: {
                footer: 'custom-footer-class',
                popup: 'arpErrorPopup',
                htmlContainer: 'arpErrorHtmlContainer',
              },
              didOpen: () => {
                Swal.getFooter().querySelector('#more-info-button').addEventListener('click', () => {
                  Swal.fire({
                    title: $translate.instant('ARP.errorInstructions.title'),
                    icon: 'info',
                    confirmButtonText: 'Got it!',
                    customClass: {
                      htmlContainer: 'arpErrorDetails',
                      popup: 'arpErrorPopup',
                    },
                    html: createInstructionsTemplate(),
                  }).then(() => {
                    showErrors();
                  });
                });
              }
            })
          }

          showErrors();

        }
      });
    }

    function createInstructionsTemplate() {
      return `
      <p style="font-size: 15px">The section below describes how to solve the most common errors that may occur during resource validation</p>
      <pre class="arpErrorInstructions">
        <b>Missing identifier:</b>
        <p>Set an identifier for the resource at the top of the page.</p>
          
        <b>Missing Term URI:</b>
        <ul>
          <li class="arpErrorInstructionsLi">Find the field by its name</li>
          <li class="arpErrorInstructionsLi">Click on the <i style="display:inline;transform:none;color:#999" class="cedar-svg-arp-error-instruction-icon" ></i> "Add property" button at the end of the "Enter Field Name" line</li> 
          <li class="arpErrorInstructionsLi">Set a Term URI for the field from the searchable list or enter a custom URI</li>
        </ul>
        
        <b>Invalid names:</b>
        <p>Set a new name for the resource that follows the naming conventions for ARP resources in the "Enter Field Name" line</p>
        
        <b>Unprocessable elements:</b>
        <p>The element contains too deeply nested child elements. Remove the child elements to make the element valid.</p>
      </pre>
      `;
    }

    return service;
  }

});
