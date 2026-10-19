module.exports = {
  run: [
    {
      method: "shell.run",
      params: {
        message: "npm install",
      },
    },
    {
      method: "notify",
      params: {
        html: "Embedding Atlas installed. Click Start.",
      },
    },
  ],
};
