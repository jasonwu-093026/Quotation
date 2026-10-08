(function () {
  "use strict";

  function refuse(error) {
    const message = "Preview refused: storage isolation could not be installed. " + String(error);
    window.stop();
    const head = document.createElement("head");
    const title = document.createElement("title");
    title.textContent = "Preview unavailable";
    head.appendChild(title);
    const body = document.createElement("body");
    const notice = document.createElement("pre");
    notice.textContent = message;
    body.appendChild(notice);
    document.documentElement.replaceChildren(head, body);
    document.documentElement.dataset.juxtaPreviewStorage = "blocked";
    throw new Error(message);
  }

  try {
    if (typeof JUXTA_PREVIEW !== "object" || !JUXTA_PREVIEW ||
        typeof JUXTA_PREVIEW.namespace !== "string" || !JUXTA_PREVIEW.namespace ||
        !Number.isSafeInteger(JUXTA_PREVIEW.number) || JUXTA_PREVIEW.number < 1 ||
        !/^[a-f0-9]{40,64}$/.test(JUXTA_PREVIEW.sha)) {
      throw new Error("invalid preview identity");
    }
    if ("serviceWorker" in navigator) {
      if (navigator.serviceWorker.controller) throw new Error("an existing service worker controls this preview");
      Object.defineProperty(ServiceWorkerContainer.prototype, "register", {
        configurable: false, writable: false,
        value() { return Promise.reject(new Error("Service workers are disabled in PR previews")); }
      });
      navigator.serviceWorker.addEventListener("controllerchange", function () {
        if (navigator.serviceWorker.controller) refuse("a service worker took control of this preview");
      });
    }
    const prefix = "__juxta_preview__" + encodeURIComponent(JUXTA_PREVIEW.namespace) + ":";
    const prototype = Storage.prototype;
    const methods = {};
    const stores = new WeakMap();
    for (const name of ["getItem", "setItem", "removeItem", "clear", "key"]) {
      methods[name] = prototype[name];
      if (!Object.getOwnPropertyDescriptor(prototype, name).configurable) {
        throw new Error("Storage prototype cannot be isolated");
      }
    }
    const lengthGetter = Object.getOwnPropertyDescriptor(prototype, "length").get;
    if (!Object.getOwnPropertyDescriptor(prototype, "length").configurable) {
      throw new Error("Storage length cannot be isolated");
    }
    const native = {};
    for (const name of ["localStorage", "sessionStorage"]) {
      const descriptor = Object.getOwnPropertyDescriptor(window, name);
      if (!descriptor || !descriptor.configurable) {
        throw new Error(name + " cannot be isolated");
      }
      native[name] = window[name];
      lengthGetter.call(native[name]);
    }

    function wrap(storage) {
      function keys() {
        const result = [];
        for (let index = 0; index < lengthGetter.call(storage); index += 1) {
          const key = methods.key.call(storage, index);
          if (key !== null && key.startsWith(prefix)) result.push(key.slice(prefix.length));
        }
        return result;
      }
      const operations = {
        getItem(key) {
          if (!arguments.length) throw new TypeError("getItem requires a key");
          return methods.getItem.call(storage, prefix + String(key));
        },
        setItem(key, value) {
          if (arguments.length < 2) throw new TypeError("setItem requires a key and value");
          methods.setItem.call(storage, prefix + String(key), String(value));
        },
        removeItem(key) {
          if (!arguments.length) throw new TypeError("removeItem requires a key");
          methods.removeItem.call(storage, prefix + String(key));
        },
        clear() {
          for (const key of keys()) methods.removeItem.call(storage, prefix + key);
        },
        key(index) {
          if (!arguments.length) throw new TypeError("key requires an index");
          return keys()[Number(index) >>> 0] ?? null;
        },
        length() { return keys().length; }
      };
      const facade = new Proxy(Object.create(prototype), {
        get(target, property, receiver) {
          if (property === "length") return operations.length();
          if (Object.prototype.hasOwnProperty.call(operations, property)) return operations[property];
          if (typeof property !== "string") return Reflect.get(target, property, receiver);
          const value = operations.getItem(property);
          return value === null ? Reflect.get(target, property, receiver) : value;
        },
        set(target, property, value) {
          if (typeof property !== "string") throw new TypeError("Storage keys must be strings");
          operations.setItem(property, value);
          return true;
        },
        deleteProperty(target, property) {
          if (typeof property === "string") operations.removeItem(property);
          return true;
        },
        ownKeys() { return keys(); },
        has(target, property) {
          return typeof property === "string" && operations.getItem(property) !== null ||
            Reflect.has(target, property);
        },
        getOwnPropertyDescriptor(target, property) {
          if (typeof property !== "string") return undefined;
          const value = operations.getItem(property);
          return value === null ? undefined : {
            value, writable: true, enumerable: true, configurable: true
          };
        },
        defineProperty(target, property, descriptor) {
          if (typeof property !== "string" || !Object.prototype.hasOwnProperty.call(descriptor, "value") ||
              descriptor.configurable === false || descriptor.get || descriptor.set) {
            throw new TypeError("Storage supports configurable string data properties only");
          }
          operations.setItem(property, descriptor.value);
          return true;
        },
        preventExtensions() { return false; },
        setPrototypeOf() { return false; }
      });
      stores.set(facade, operations);
      return facade;
    }

    const facades = {};
    for (const name of ["localStorage", "sessionStorage"]) {
      facades[name] = wrap(native[name]);
      Object.defineProperty(window, name, {
        configurable: false, enumerable: true, get() { return facades[name]; }
      });
    }
    for (const name of Object.keys(methods)) {
      Object.defineProperty(prototype, name, {
        configurable: true, writable: true,
        value: function (...args) {
          const operations = stores.get(this);
          return operations ? operations[name](...args) : methods[name].apply(this, args);
        }
      });
    }
    Object.defineProperty(prototype, "length", {
      configurable: true,
      get() {
        const operations = stores.get(this);
        return operations ? operations.length() : lengthGetter.call(this);
      }
    });
    const forwarded = new WeakSet();
    window.addEventListener("storage", function (event) {
      if (forwarded.has(event)) return;
      event.stopImmediatePropagation();
      if (event.key === null || !event.key.startsWith(prefix)) return;
      const isolated = new Event("storage");
      for (const [name, value] of Object.entries({
        key: event.key.slice(prefix.length), oldValue: event.oldValue, newValue: event.newValue,
        url: event.url,
        storageArea: event.storageArea === native.localStorage ? facades.localStorage : facades.sessionStorage
      })) Object.defineProperty(isolated, name, { value, enumerable: true });
      forwarded.add(isolated);
      window.dispatchEvent(isolated);
    }, true);
    document.documentElement.dataset.juxtaPreviewStorage = "isolated";
    const banner = document.createElement("div");
    banner.id = "juxta-preview-banner";
    banner.setAttribute("role", "status");
    banner.textContent = "Preview of PR #" + JUXTA_PREVIEW.number + " \u2014 " + JUXTA_PREVIEW.sha.slice(0, 8);
    for (const [name, value] of Object.entries({
      position: "sticky", top: "0", "z-index": "2147483647", display: "block",
      padding: "10px", "background-color": "#fff3bf", color: "#222",
      "font-family": "sans-serif", "font-size": "14px", "line-height": "20px",
      visibility: "visible", opacity: "1", "text-align": "center"
    })) banner.style.setProperty(name, value, "important");
    function showBanner() {
      if (document.body && !banner.isConnected) document.body.prepend(banner);
    }
    showBanner();
    document.addEventListener("DOMContentLoaded", showBanner, { once: true });
    new MutationObserver(showBanner).observe(document.documentElement, { childList: true, subtree: true });
  } catch (error) {
    refuse(error);
  }
})();
