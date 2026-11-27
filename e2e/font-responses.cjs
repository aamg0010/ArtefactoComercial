// Next's supported font test hook: no Google requests during offline E2E builds.
module.exports = new Proxy({}, { get: () => '/* Offline E2E: use the configured fallback fonts. */' });
