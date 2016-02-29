/*!
* This program is free software; you can redistribute it and/or modify it under the
* terms of the GNU Lesser General Public License, version 2.1 as published by the Free Software
* Foundation.
*
* You should have received a copy of the GNU Lesser General Public License along with this
* program; if not, you can obtain a copy at http://www.gnu.org/licenses/old-licenses/lgpl-2.1.html
* or from the Free Software Foundation, Inc.,
* 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA.
*
* This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;
* without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
* See the GNU Lesser General Public License for more details.
*
* Copyright (c) 2002-2016 Pentaho Corporation..  All rights reserved.
*/

define(['common-ui/util/util', 'pentaho/common/Messages', "dijit/registry", "common-ui/prompting/api/PromptingAPI"],

    function(util, Messages, registry, PromptingAPI) {
  return function() {
    return logged({

      api: new PromptingAPI('promptPanel'),

      // The current prompt mode
      mode: 'INITIAL',

      load: function() {
        Messages.addUrlBundle('reportviewer', CONTEXT_PATH+'i18n?plugin=reporting&name=reportviewer/messages/messages');
      },

      /**
       * Create the prompt panel
       */
      createPromptPanel: function(viewerUpdateCallback) {
        var initFlag = true;
        this.api.operation.render(function(api, callback) {
          var paramDefnCallback = function(xml) {
            var paramDefn = this.parseParameterDefinition(xml);
            // A first request is made,
            // With promptMode='INITIAL' and renderMode='PARAMETER'.
            //
            // The response will not have page count information (pagination was not performed),
            // but simply information about the prompt parameters (newParamDef).
            //
            // When newParamDefn.allowAutoSubmit() is true,
            // And no validation errors/required parameters exist to be specified, TODO: Don't think that this is being checked here!
            // Then a second request is made,
            // With promptMode='MANUAL' and renderMode='XML' is performed.
            //
            // When the response to the second request arrives,
            // Then the prompt panel is rendered, including with page count information,
            // And  the report content is loaded and shown.
            //
            // [PIR-1163] Used 'inSchedulerDialog' variable to make sure that the second request is not sent if it's scheduler dialog.
            // Because the scheduler needs only parameters without full XML.
            if(!inSchedulerDialog && this.mode === 'INITIAL' && paramDefn.allowAutoSubmit()) {
              this.mode = 'MANUAL';
              this.fetchParameterDefinition(paramDefnCallback.bind(this));
              return;
            }

            try {
              var autoSubmit = this.api.operation.state().autoSubmit;
              if(autoSubmit != null) {
                paramDefn.autoSubmitUI = autoSubmit;
              }
            } catch(e) {
              // ignore
            }
            callback(paramDefn);

            this._hideLoadingIndicator();
            if (initFlag) {
              this.initPromptPanel();
              initFlag = false;
            } else {
              viewerUpdateCallback();
            }
            this.hideGlassPane();
          };
          this.fetchParameterDefinition(paramDefnCallback.bind(this));
        }.bind(this));
      },

      _createPromptPanelFetchCallback: function(paramDefn) {
        // Provide our own i18n function
        //panel.getString = Messages.getString;

        this.initPromptPanel();
        this._hideLoadingIndicator();
      },

      _hideLoadingIndicator: function() {
        try{
          if (window.top.hideLoadingIndicator) {
            window.top.hideLoadingIndicator();
          } else if (window.parent.hideLoadingIndicator) {
            window.parent.hideLoadingIndicator();
          }
        } catch (ignored) {} // Ignore "Same-origin policy" violation in embedded IFrame
      },

      initPromptPanel: function() {
        this.api.operation.init();
      },

      showGlassPane: function() {
        // Show glass pane when updating the prompt.
        registry.byId('glassPane').show();
      },

      hideGlassPane: function() {
        registry.byId('glassPane').hide();
      },

      parseParameterDefinition: function(xmlString) {
        xmlString = this.removeControlCharacters(xmlString);
        return this.api.util.parseParameterXml(xmlString);
      },

      /**
       * This method will remove illegal control characters from the text in the range of &#00; through &#31;
       * SEE:  PRD-3882 and ESR-1953
       */
      removeControlCharacters : function(inStr) {
        for (var i = 0; i <= 31; i++) {
          var safe = i;
          if (i < 10) {
            safe = '0' + i;
          }
          eval('inStr = inStr.replace(/\&#' + safe + ';/g, "")');
        }
        return inStr;
      },

      checkSessionTimeout: function(content, args) {
        if (content.status == 401 || this.isSessionTimeoutResponse(content)) {
          this.handleSessionTimeout(args);
          return true;
        }
        return false;
      },

      /**
       * @return true if the content is the login page.
       */
      isSessionTimeoutResponse: function(content) {
        if(String(content).indexOf('j_spring_security_check') != -1) {
          // looks like we have the login page returned to us
          return true;
        }
        return false;
      },

      /**
       * Prompts the user to relog in if they're within PUC, otherwise displays a dialog
       * indicating their session has expired.
       *
       * @return true if the session has timed out
       */
      handleSessionTimeout: function(args) {
        var callback = function() {
          //TODO check
          this.fetchParameterDefinition.apply(this, args);
        }.bind(this);

        this.reauthenticate(callback);
      },

      reauthenticate: function(f) {
        var isRunningIFrameInSameOrigin = null;
        try {
          var ignoredCheckCanReachOutToParent = window.parent.mantle_initialized;
          isRunningIFrameInSameOrigin = true;
        } catch (ignoredSameOriginPolicyViolation) {
          // IFrame is running embedded in a web page in another domain
          isRunningIFrameInSameOrigin = false;
        }

        if(isRunningIFrameInSameOrigin && top.mantle_initialized) {
          var callback = {
            loginCallback : f
          }
          window.parent.authenticate(callback);
        } else {
          this.showMessageBox(
            Messages.getString('SessionExpiredComment'),
            Messages.getString('SessionExpired'),
            Messages.getString('OK'),
            undefined,
            undefined,
            undefined,
            true
          );
        }
      },

      /**
       * @private Sequence number to detect concurrent fetchParameterDefinition calls.
       * Only the response to the last call will be processed.
       */
      _fetchParamDefId: -1,

      /**
       * Loads the parameter xml definition from the server.
       * @param {function} callback function to call when successful.
       * The callback signature is:
       * <pre>void function(newParamDef)</pre>
       *  and is called in the context of the report viewer prompt instance.
       * @param {string} [promptMode='MANUAL'] the prompt mode to request from server:
       *  x INITIAL   - first time
       *  x MANUAL    - user pressed the submit button (or, when autosubmit, after INITIAL fetch)
       *  x USERINPUT - due to a change + auto-submit
       *
       * If not provided, 'MANUAL' will be used.
       */
      fetchParameterDefinition: function(callback) {
        var me = this;

        var fetchParamDefId = ++me._fetchParamDefId;

        me.showGlassPane();

        if (!me.mode) {
          me.mode = 'MANUAL';
        } else if (me.mode == 'USERINPUT') {
          // Hide glass pane to prevent user from being blocked from changing his selection
          me.hideGlassPane();
        }

        // -------------
        var options = util.getUrlParameters();

        // If we aren't defined a parameter definition this is the first request
        try {
          $.extend(options, me.api.operation.getParameterValues());
        } catch(e) {
          // ignore
        }
        options['renderMode'] = me._getParameterDefinitionRenderMode(me.mode);

        // Never send the session back. This is generated by the server.
        delete options['::session'];
        // -------------

        var args = arguments;

        var onSuccess = logged('fetchParameterDefinition_success', function(xmlString) {
          if(me.checkSessionTimeout(xmlString, args)) { return; }

          // Another request was made after this one, so this one is ignored.
          if(fetchParamDefId !== me._fetchParamDefId) { return; }

          try {
            callback(xmlString);
          } catch (e) {
            me.onFatalError(e);
          }
        });

        var onError = function(e) {
          if (!me.checkSessionTimeout(e, args)) {
            me.onFatalError(e);
          }
        };

        $.ajax({
          async:   true,
          traditional: true, // Controls internal use of $.param() to serialize data to the url/body.
          cache:   false,
          type:    'POST',
          url:     me.getParameterUrl(),
          data:    options,
          dataType:'text',
          success: onSuccess,
          error:   onError
        });
      },

      _getParameterDefinitionRenderMode: function(promptMode) {
        switch(promptMode) {
          case 'INITIAL':
              return 'PARAMETER';

          case 'USERINPUT':
            if (!this.api.operation.state().autoSubmit) {
              return 'PARAMETER';
            }
            break;
        }

        return 'XML';
      },

      getParameterUrl: function() {
        return 'parameter';
      },

      showMessageBox: function( message, dialogTitle, button1Text, button1Callback, button2Text, button2Callback, blocker ) {
        var messageBox = registry.byId('messageBox');

        messageBox.setTitle(dialogTitle);
        messageBox.setMessage(message);

        if (blocker) {
          messageBox.setButtons([]);
        } else {
          var closeFunc = function() {
            this.api.ui.hideProgressIndicator();
            messageBox.hide.call(messageBox);
          }

          if(!button1Text) {
            button1Text = Messages.getString('OK');
          }
          if(!button1Callback) {
            button1Callback = closeFunc;
          }

          messageBox.onCancel = closeFunc;

          if(button2Text) {
            messageBox.callbacks = [
              button1Callback,
              button2Callback
            ];
            messageBox.setButtons([button1Text,button2Text]);
          } else {
            messageBox.callbacks = [
              button1Callback
            ];
            messageBox.setButtons([button1Text]);
          }
        }
        this.api.ui.showProgressIndicator();
        messageBox.show();
      },

      /**
       * Called when there is a fatal error during parameter definition fetching/parsing
       *
       * @param e Error/exception encountered
       */
      onFatalError: function(e) {
        var errorMsg = Messages.getString('ErrorParsingParamXmlMessage');
        if (typeof console !== 'undefined' && console.log) {
          console.log(errorMsg + ": " + e);
        }
        this.showMessageBox(
          errorMsg,
          Messages.getString('FatalErrorTitle'));
      }
    }); // return logged
  }; // return function
});
