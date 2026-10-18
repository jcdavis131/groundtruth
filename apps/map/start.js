module.exports = {
  daemon: true,
  run: [
    {
      method: "shell.run",
      params: {
        env: { PORT: "{{port}}" },
        message: "npm run dev -- --port {{port}}",
        on: [{ event: "/(http:\\/\\/localhost:[0-9]+)/", done: true }],
      },
    },
    {
      method: "local.set",
      params: {
        url: "{{input.event[0]}}",
      },
    },
  ],
};
