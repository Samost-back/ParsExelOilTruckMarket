module.exports = {
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.js"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      exclude: [
        "node_modules/**",
        "tests/**",
        "src/web/views/**",
        "src/photos/browser-tool/**",
        "**/*.config.js",
      ],
    },
  },
};
