import plugin from "../plugin.json";
import { ReconnectingWebSocket, formatUrl, unFormatUrl } from "./utils.js";
import {
  fromPoint, fromRange, toRange
} from "./ace-linters/src/type-converters/lsp-converters";

/**
 * @typedef {object} EditorManager
 * @property {Ace.Editor} editor
 */
 
 /** @type {EditorManager} */
let { editor } = editorManager;
const LINTERS = ["pylint", "pyflakes", "mypy"];

export class AcodeLanguageServerPlugin {
  $rootUri;
  $folders;

  init() {
    this.$logs = [];
    this.$sockets = {};
    this.setup();
  }

  async setup() {
    const { ServiceManager } = await import(
      "./ace-linters/src/services/service-manager.ts"
    );
    const { LanguageProvider } = await import(
      "./ace-linters/src/language-provider.ts"
    );

    this.$options = {
      functionality: {
        hover: this.settings.hover,
        format: this.settings.format,
        completion: this.settings.completion,
        completionResolve: this.settings.completionResolve,
      },
    };

    let serviceTarget = new EventTarget();
    let providerTarget = new EventTarget();

    this.$manager = new ServiceManager({
      addEventListener: (...args) => providerTarget.addEventListener(...args),
      postMessage(message) {
        serviceTarget.dispatchEvent(
          new MessageEvent("message", { data: message })
        );
      },
    });

    this.$manager.registerService("html", {
      features: { signatureHelp: false },
      module: () => import("./ace-linters/src/services/html/html-service.ts"),
      className: "HtmlService",
      modes: "html",
      rootUri: () => this.#getRootUri(),
      workspaceFolders: () => this.#getFolders(),
    });

    this.$manager.registerService("css", {
      features: { signatureHelp: false },
      module: () => import("./ace-linters/src/services/css/css-service.ts"),
      className: "CssService",
      modes: "css",
      rootUri: () => this.#getRootUri(),
      workspaceFolders: () => this.#getFolders(),
    });

    this.$manager.registerService("less", {
      features: { signatureHelp: false },
      module: () => import("./ace-linters/src/services/css/css-service.ts"),
      className: "CssService",
      modes: "less",
      rootUri: () => this.#getRootUri(),
      workspaceFolders: () => this.#getFolders(),
    });

    this.$manager.registerService("scss", {
      features: { signatureHelp: false },
      module: () => import("./ace-linters/src/services/css/css-service.ts"),
      className: "CssService",
      modes: "scss",
      rootUri: () => this.#getRootUri(),
      workspaceFolders: () => this.#getFolders(),
    });

    this.$manager.registerService("json", {
      features: { signatureHelp: false, documentHighlight: false },
      module: () => import("./ace-linters/src/services/json/json-service.ts"),
      className: "JsonService",
      modes: "json",
      rootUri: () => this.#getRootUri(),
      workspaceFolders: () => this.#getFolders(),
    });

    this.$manager.registerService("json5", {
      features: { signatureHelp: false, documentHighlight: false },
      module: () => import(
        "./ace-linters/src/services/json/json-service.ts"
      ),
      className: "JsonService",
      modes: "json5",
      rootUri: () => this.#getRootUri(),
      workspaceFolders: () => this.#getFolders(),
    });
    
    this.$manager.registerServer("python", {
      rootUri: () => this.#getRootUri(),
      workspaceFolders: () => this.#getFolders(),
      modes: "python", type: "socket",
      module: () => import("./ace-linters/src/services/language-client.ts"),
      socket: new ReconnectingWebSocket(this.settings.url + "python"),
    });

    this.$manager.registerServer("typescript", {
      modes: "typescript|javascript|tsx|jsx",
      rootUri: () => this.#getRootUri(),
      workspaceFolders: () => this.#getFolders(), type: "socket",
      module: () => import("./ace-linters/src/services/language-client.ts"),
      initializationOptions: { cancellationPipeName: "typescript" },
      socket: new ReconnectingWebSocket(this.settings.url + "typescript"),
    });

    this.$client = LanguageProvider.create({
      addEventListener: (...args) => serviceTarget.addEventListener(...args),
      postMessage(message) {
        providerTarget.dispatchEvent(
          new MessageEvent("message", { data: message })
        );
      },
    });

    if (window.acode && this.settings.format) {
      acode.registerFormatter(
        "Acode Language Servers",
        [
          "html",
          "css",
          "scss",
          "less",
          "js",
          "ts",
          "jsx",
          "tsx",
          "lua",
          "xml",
          "yaml",
          "json",
          "json5",
          "py",
        ],
        () => {
          this.$client.format();
        }
      );
    }

    this.$client.setGlobalOptions("typescript", {
      parserOptions: { sourceType: "module" },
      errorCodesToIgnore: [
        "2304",
        "2732",
        "2554",
        "2339",
        "2580",
        "2307",
        "2540",
      ],
      ...(this.settings.options?.typescript || {}),
    });

    this.$client.setGlobalOptions("python", {
      configuration: { ignore: ["E501", "E401", "F401", "F704"] },
      pylsp: {
        configurationSources: ["pycodestyle"],
        plugins: {
          pycodestyle: {
            enabled: true,
            ignore: ["E501"],
            maxLineLength: 10,
          },
          pyflakes: {
            enabled: this.settings.linter === "pyflakes",
          },
          pylint: {
            enabled: this.settings.linter === "pylint",
          },
          pyls_mypy: {
            enabled: this.settings.linter === "mypy",
          },
        },
      },
      ...(this.settings.options?.python || {}),
    });

    this.$client.setGlobalOptions("", {
      ...(this.settings.options?.global || {}),
    });

    this.#setupCommands();

    this.$client.registerEditor(editor);

    // if (this.settings.replaceCompleters) {
    //   this.$completers = editor.completers.splice(1, 2);
    // }
  }

  log(message, type = "debug") {
    if (!this.$logger) {
      this.$logger = acode.require("acode.sdk")?.getLogger(plugin.id);
      if (this.$logger) {
        this.$logs.map((i) => this.$logger.info(i));
      }
    }
    if (this.$logger) {
      this.$logger.log(type, message);
    } else {
      this.$logs.push(message);
    }
  }

  destroy() { }

  #openFile(uri, range) {
    let url = acode.require("url");
    let helpers = acode.require("helpers");
    let file = acode.require("editorfile");
    let filename = url.basename(uri);
    let cursorPos;

    if (range) {
      cursorPos = toRange(range)
    }

    return new file(filename, {
      uri: unFormatUrl(uri),
      cursorPos: cursorPos.start,
    });
  }
  
  #applyEdits(edits, session) {
    for (let edit of edits.reverse()) {
      session.replace(toRange(edit.range), edit.newText);
    }
  }

  #getRootUri() {
    if (this.$rootUri) return this.$rootUri;

    let folders = this.#getFolders();

    if (folders.length) {
      this.$rootUri = formatUrl(folders[0].url);
    } /* else {
      // For testing in browser on pc
      this.$rootUri =
        "C:/Users/HP/Desktop_Files/files/programming/javascript/acode plugins/acode-language-servers";
    } */
    return this.$rootUri;
  }

  #getFolders() {
    if (this.$folders) return this.$folders;

    const folders = JSON.parse(localStorage.folders || '[]');
    this.$folders = folders.map(
      item => ({
        name: item.opts.name,
        url: formatUrl(item.url)
      })
    );
    return this.$folders
  }

  #getServices() {
    return this.$manager.findServicesByMode(
      editor.session.$modeId.substring(9)
    );
  }

  #filterService(validate) {
    let services = this.#getServices();
    return services.filter((service) => {
      let instance = service.serviceInstance;
      let capabilities = instance.serviceCapabilities;
      if (validate(capabilities)) {
        return true;
      }
      return false;
    });
  }

  #setupCommands() {
    editor.commands.addCommands([
      {
        name: "Go To Declaration",
        exec: () => this.#goToDeclaration(),
      },
      {
        name: "Go To Definition",
        exec: () => this.#goToDefinition(),
      },
      {
        name: "Go To Type Definition",
        exec: () => this.#goToDefinition(true),
      },
      {
        name: "Go To Implementations",
        exec: () => this.#findImplementations(),
      },
      {
        name: "Go To References",
        exec: () => this.#findReferences(),
      },
      {
        name: "Show Code Actions",
        exec: () => this.#codeActions(),
      },
      {
        name: "Rename Symbol",
        exec: () => this.#renameSymbol(),
      },
      {
        name: "Format Code",
        exec: () => this.$client.format(),
      }
    ]);
  }

  #goToDefinition(type = false) {
    let services = this.#filterService((capabilities) => {
      if (type) return capabilities.typeDefinitionProvider;
      return capabilities.definitionProvider;
    }).map((service) => service.serviceInstance);
    let cursor = editor.getCursorPosition();
    let position = fromPoint(cursor);

    services.map((service) => {
      if (service.connection) {
        service.connection
          .sendRequest(
            "textDocument/" + (type ? "typeDefinition" : "definition"),
            {
              textDocument: {
                uri: this.$client.$getFileName(editor.session),
              },
              position,
            }
          )
          .then((response) => {
            console.log('Definition:', response);
            if (response) {
              if (!Array.isArray(response)) {
                response = [response];
              }

              response.map((item) => {
                this.#openFile(item.uri, item.range);
              });
            }
          });
      }
    });
  }

  #goToDeclaration() {
    let services = this.#filterService(
      (capabilities) => capabilities.declarationProvider
    ).map((service) => service.serviceInstance);
    let cursor = editor.getCursorPosition();
    let position = fromPoint(cursor);

    services.map((service) => {
      if (service.connection) {
        service.connection
          .sendRequest("textDocument/declaration", {
            textDocument: {
              uri: this.$client.$getFileName(editor.session),
            },
            position,
          })
          .then((response) => {
            console.log('Declaration:', response);
            if (!Array.isArray(response)) {
                response = [response];
              }

              response.map((item) => {
                this.#openFile(item.uri, item.range);
              });
          });
      }
    });
  }

  #findReferences() {
    let services = this.#filterService(
      (capabilities) => capabilities.referencesProvider
    ).map((service) => service.serviceInstance);
    let cursor = editor.getCursorPosition();
    let position = fromPoint(cursor);

    services.map((service) => {
      if (service.connection) {
        service.connection
          .sendRequest("textDocument/references", {
            textDocument: {
              uri: this.$client.$getFileName(editor.session),
            },
            position,
            context: { includeDeclaration: true },
          })
          .then((response) => {
            console.log('References:', response);
            if (!Array.isArray(response)) {
                response = [response];
              }

              response.map((item) => {
                this.#openFile(item.uri, item.range);
              });
          });
      }
    });
  }

  #findImplementations() {
    let services = this.#filterService(
      (capabilities) => capabilities.implementationProvider
    ).map((service) => service.serviceInstance);
    let cursor = editor.getCursorPosition();
    let position = fromPoint(cursor);

    services.map((service) => {
      if (service.connection) {
        service.connection
          .sendRequest("textDocument/implementation", {
            textDocument: {
              uri: this.$client.$getFileName(editor.session),
            },
            position,
          })
          .then((response) => {
            console.log('Implementation:', response);
            if (!Array.isArray(response)) {
                response = [response];
              }

              response.map((item) => {
                this.#openFile(item.uri, item.range);
              });
          });
      }
    });
  }

  #codeActions() {
    let services = this.#filterService(
      (capabilities) => capabilities.codeActionProvider
    ).map((service) => service.serviceInstance);
    let cursor = editor.getCursorPosition();
    let position = fromPoint(cursor);
    let range = fromRange(editor.selection.getRange())

    services.map((service) => {
      if (service.connection) {
        service.connection
          .sendRequest("textDocument/codeAction", {
            textDocument: {
              uri: this.$client.$getFileName(editor.session),
            },
            position,
            diagnostics: [],
            triggerKind: 2,
          })
          .then(async (actions) => {
            console.log('Actions:', response);
            if (!window.acode) return;

            if (actions) {
              let action = await acode.select(
                "Code Action",
                actions.map((action, index) => [index, action.title])
              );
              if (action) {
                service.connection.sendRequest(
                  "codeAction/resolve",
                  actions[action]
                ).then(resolved => {
                  console.log('Resolved:', resolved);
                });
              }
            }
          });
      }
    });
  }

  async #renameSymbol() {
    let services = this.#filterService(
      (capabilities) => capabilities.renameProvider
    ).map((service) => service.serviceInstance);

    let cursor = editor.getCursorPosition();
    let position = fromPoint(cursor);

    let currentName = editor.getSelectedText();
    let newName = await acode.prompt("New name", currentName);

    services.map((service) => {
      if (service.connection) {
        service.connection
          .sendRequest("textDocument/rename", {
            textDocument: {
              uri: this.$client.$getFileName(editor.session),
            },
            newName,
            position,
          })
          .then((response) => {
            console.log('Rename:', response);
            let changes = response.changes;
            for (let file in changes) {
              console.log(file, changes[file])
              let efile = this.#openFile(file);
              this.#applyEdits(changes[file], efile.session);
            }
          });
      }
    });
  }

  get settings() {
    if (!window.acode) {
      return this.defaultSettings;
    }

    const AppSettings = acode.require("settings");
    let value = AppSettings.value[plugin.id];
    if (!value) {
      value = AppSettings.value[plugin.id] = this.defaultSettings;
      AppSettings.update();
    }
    return value;
  }

  get defaultSettings() {
    return {
      hover: true,
      format: true,
      completion: true,
      linter: LINTERS[0],
      completionResolve: true,
      replaceCompleters: true,
      url: "ws://localhost:3030/",
    };
  }

  get settingsObj() {
    const AppSettings = acode.require("settings");
    return {
      list: [
        {
          key: "url",
          text: "Server Url",
          value: this.settings.url,
          prompt: "Server URL ",
          promptType: "text",
        },
        {
          key: "linter",
          text: "Linter (Python)",
          value: this.settings.linter,
          info: "Linter to use with python type checking.",
          select: LINTERS,
        },
        {
          key: "hover",
          text: "Show Tooltip",
          checkbox: this.settings.hover,
          info: "Show Tooltip on hover or selection",
        },
        {
          key: "completion",
          text: "Code Completion",
          checkbox: this.settings.completion,
          info: "Enable code completion.",
        },
        {
          key: "completionResolve",
          text: "Doc Tooltip",
          checkbox: this.settings.completionResolve,
          info: "Enable code completion resolve.",
        },
        {
          key: "replaceCompleters",
          text: "Replace Completers",
          checkbox: this.settings.replaceCompleters,
          info: "Disable the default code completers.",
        },
      ],
      cb: (key, value) => {
        switch (key) {
          case "linter":
            this.$client.setGlobalOptions("python", {
              pylsp: {
                configurationSources: ["pycodestyle"],
                plugins: {
                  pycodestyle: {
                    enabled: true,
                    ignore: ["E501"],
                    maxLineLength: 10,
                  },
                  pyflakes: {
                    enabled: value === "pyflakes",
                  },
                  pylint: {
                    enabled: value === "pylint",
                  },
                  pyls_mypy: {
                    enabled: value === "mypy",
                  },
                },
              },
            });
          case "replaceCompleters":
            if (value) {
              this.$completers = editor.completers.splice(1, 2);
            } else {
              if (this.$completers) {
                editor.completers = [...this.$completers, ...editor.completers];
              }
            }
          default:
            acode.alert(
              "Acode Language Server",
              "Settings updated. Restart acode app."
            );
        }
        AppSettings.value[plugin.id][key] = value;
        AppSettings.update();
      },
    };
  }
}

if (window.acode) {
  const lsp = new AcodeLanguageServerPlugin();
  window.lsp = lsp;

  acode.setPluginInit(
    plugin.id,
    (baseUrl, $page, { cacheFileUrl, cacheFile }) => {
      if (!baseUrl.endsWith("/")) {
        baseUrl += "/";
      }
      lsp.baseUrl = baseUrl;
      try {
        lsp.init($page, cacheFile, cacheFileUrl);
      } catch (e) {
        window.err = e;
        console.log(e)
      }
    },
    lsp.settingsObj
  );

  acode.setPluginUnmount(plugin.id, () => {
    lsp.destroy();
  });
} else {
  window.AcodeLanguageServerPlugin = AcodeLanguageServerPlugin;
}
