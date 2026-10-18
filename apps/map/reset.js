module.exports = {
  run: [
    { method: "fs.rm", params: { path: "node_modules" } },
    { method: "fs.rm", params: { path: ".next" } },
    { method: "fs.rm", params: { path: "public/cesium" } },
  ],
};
