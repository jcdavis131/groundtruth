// Pinokio launcher for Embedding Atlas.
// Install: clones nothing (Pinokio already has this folder), runs npm install,
// which also copies Cesium's static assets into public/cesium.
// Start:   next dev on a free port; the URL is picked up from the log.
module.exports = {
  version: "3.0",
  title: "Embedding Atlas",
  description: "Ask eye about a US place and get a cited, dated public record: where it comes from, when it was read, and what it leaves out. No API keys needed.",
  menu: async (kernel, info) => {
    const installed = info.exists("node_modules");
    const running = {
      install: info.running("install.js"),
      start: info.running("start.js"),
      update: info.running("update.js"),
      reset: info.running("reset.js"),
    };
    if (running.install) {
      return [{ default: true, icon: "fa-solid fa-plug", text: "Installing", href: "install.js" }];
    }
    if (!installed) {
      return [{ default: true, icon: "fa-solid fa-plug", text: "Install", href: "install.js" }];
    }
    if (running.start) {
      const local = info.local("start.js");
      if (local && local.url) {
        return [
          { default: true, icon: "fa-solid fa-satellite", text: "Open Embedding Atlas", href: local.url },
          { icon: "fa-solid fa-terminal", text: "Terminal", href: "start.js" },
        ];
      }
      return [{ default: true, icon: "fa-solid fa-terminal", text: "Terminal", href: "start.js" }];
    }
    if (running.update) return [{ default: true, icon: "fa-solid fa-terminal", text: "Updating", href: "update.js" }];
    if (running.reset) return [{ default: true, icon: "fa-solid fa-terminal", text: "Resetting", href: "reset.js" }];
    return [
      { default: true, icon: "fa-solid fa-power-off", text: "Start", href: "start.js" },
      { icon: "fa-solid fa-rotate", text: "Update", href: "update.js" },
      { icon: "fa-solid fa-plug", text: "Reinstall", href: "install.js" },
      { icon: "fa-regular fa-circle-xmark", text: "Reset", href: "reset.js" },
    ];
  },
};
