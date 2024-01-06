export class ReconnectingWebSocket extends EventTarget {
  onopen;
  onclose;
  onerror;
  onmessage;

  constructor(
    url,
    protocols,
    autoConnect = false,
    autoReconnect = true,
    delay = 1000
  ) {
    super();

    this.url = url;
    this.protocols = protocols;
    this.autoReconnect = autoReconnect;
    this.delay = delay; // Reconnect delay in milliseconds
    this.connection = null;
    this.eventListeners = {};
    this.sendQueue = new Array();

    autoConnect && this.connect();
  }

  get readyState() {
    if (this.connection) {
      return this.connection.readyState;
    }
    return WebSocket.CLOSED;
  }

  connect(retry = true) {
    if (this.readyState !== WebSocket.CLOSED) return;
    try {
      this.connection = new WebSocket(this.url, this.protocols);

      this.connection.onopen = (event) => {
        this.dispatchEvent(new Event("open"));
        this.onopen?.(event);

        if (this.sendQueue.length) {
          let newQueue = [...this.sendQueue];
          this.sendQueue = [];
          newQueue.map((data) => this.send(data));
        }
      };

      this.connection.onmessage = (event) => {
        this.dispatchEvent(
          new MessageEvent("message", {
            data: event.data,
          })
        );
        this.onmessage?.(event);
      };

      this.connection.onclose = (event) => {
        if (this.autoReconnect) {
          setTimeout(() => this.connect(), this.delay);
        } else {
          this.dispatchEvent(
            new CloseEvent("close", {
              reason: event.reason,
              code: event.code,
              wasClean: event.wasClean,
            })
          );
          this.onclose?.(event);
        }
      };

      this.connection.onerror = (error) => {
        this.dispatchEvent(new ErrorEvent("error"));
        this.onerror?.(error);
      };
    } catch {
      if (retry && this.autoReconnect) {
        setTimeout(() => this.connect(), this.delay);
      }
    }
  }

  reconnect() {
    if (this.connection && this.connection.readyState !== WebSocket.CLOSED) {
      this.connection.close();
    }
    this.connect();
  }

  send(data) {
    // console.log("Sending:", data);
    if (this.connection) {
      if (this.connection.readyState === WebSocket.OPEN) {
        this.connection.send(data);
      } else {
        this.sendQueue.push(data);
        console.warn("WebSocket not open. Unable to send data.");
      }
    } else {
      this.sendQueue.push(data);
      this.connect();
    }
  }

  close() {
    this.autoReconnect = false;
    if (this.connection) {
      this.connection.close();
    }
  }
}

export function formatUrl(path) {
  if (path.startsWith("content://com.termux.documents/tree")) {
    path = path.split("::")[1];
    let termuxPath = path.replace(
      /^\/data\/data\/com\.termux\/files\/home/,
      "$HOME"
    );
    return termuxPath;
  } else if (path.startsWith("file:///storage/emulated/0/")) {
    let sdcardPath =
      "/sdcard" +
      path
        .substr("file:///storage/emulated/0".length)
        .replace(/\.[^/.]+$/, "")
        .split("/")
        .join("/") +
      "/";
    return sdcardPath;
  } else if (
    path.startsWith(
      "content://com.android.externalstorage.documents/tree/primary"
    )
  ) {
    path = path.split("::primary:")[1];
    let androidPath = "/sdcard/" + path;
    return androidPath;
  } else {
    return;
  }
}

/*export function unFormatUrl(fileUrl) {
  if (fileUrl.startsWith("file://")) {
    let filePath = fileUrl.slice(7);
    
    filePath = filePath.replace("/storage/emulated/0", '/sdcard');
    filePath = filePath.replace('/sdcard', '').slice(1);

    const pathSegments = filePath.split("/");

    // Extract the first folder and encode it
    const firstFolder = encodeURIComponent(pathSegments[0]);

    // Combine the content URI
    const contentUri = `content://com.android.externalstorage.documents/tree/primary%3A${firstFolder}::primary:${filePath}`;
    return contentUri;
  } else {
    return fileUrl;
  }
}*/

export function unFormatUrl(fileUrl) {
  if(!fileUrl.startsWith("file:///")) return fileUrl;
  // Remove the "file:///" prefix
  let path = fileUrl.replace(/^file:\/\/\//, "");
  if (path.startsWith("$HOME") || path.startsWith("data/data/com.termux/files/home")) {
    let termuxPrefix =
      "content://com.termux.documents/tree/%2Fdata%2Fdata%2Fcom.termux%2Ffiles%2Fhome::/data/data/com.termux/files/home";

    // Remove $HOME or termux default home path and merge the rest
    let termuxPath = path.startsWith("$HOME") ? path.substr("$HOME".length) : path.substr("data/data/com.termux/files/home".length);
    return termuxPrefix + termuxPath;
  } else if (path.startsWith("sdcard")) {
    let sdcardPrefix =
      "content://com.android.externalstorage.documents/tree/primary%3A";

    // Extract the folder name after sdcard
    let folderName = path
      .substr("sdcard/".length)
      .split("/")[0];
    // Add the folder name and merge the rest
    let sdcardPath =
      sdcardPrefix +
      folderName +
      "::primary:" +
      path.substr(("sdcard/").length);
    return sdcardPath;
  } else {
    return fileUrl
  }
}

export function getFolderName(sessionId) {
  if (window.acode) {
    let file =
      window.editorManager.files.find(
        (file) => file.session["id"] == sessionId
      ) || window.editorManager.activeFile;
    if (file?.uri) {
      let formatted = formatUrl(file.uri);
      if (formatted) return formatted;
    }
  }
  return undefined;
}
