// Avoid tsx's os.userInfo() call in restricted Windows environments.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  module._compile(outputText, filename);
};

process.argv.splice(1, 1);
if (!process.argv[1]) throw new Error('Indica el archivo TypeScript que se debe ejecutar.');
require(path.resolve(process.argv[1]));
