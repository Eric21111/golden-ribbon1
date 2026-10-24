// Test helper: loads a TypeScript module (and the local modules it imports) without the app shell, so pure logic that
// imports sibling files or "@/..." paths can be tested from a plain .mjs file. Not a test itself.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

export function loadTs(entry, stubs = {}) {
  const cache = new Map();
  const nodeRequire = createRequire(path.resolve('package.json'));
  function load(file) {
    const abs = path.resolve(file);
    if (cache.has(abs)) return cache.get(abs).exports;
    const { outputText } = ts.transpileModule(readFileSync(abs, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: abs,
    });
    const module = { exports: {} };
    cache.set(abs, module);
    const localRequire = (id) => {
      if (id in stubs) return stubs[id];
      const resolveLocal = (base) => {
        for (const candidate of [`${base}.ts`, `${base}.tsx`, base]) {
          try {
            readFileSync(candidate);
            return load(candidate);
          } catch (e) {
            if (e.code !== 'ENOENT') throw e;
          }
        }
        throw new Error(`Unable to resolve ${id} from ${abs}`);
      };
      if (id.startsWith('@/')) return resolveLocal(path.resolve('src', id.slice(2)));
      if (id.startsWith('.')) return resolveLocal(path.resolve(path.dirname(abs), id));
      return nodeRequire(id);
    };
    vm.runInThisContext(`(function (module, exports, require) {${outputText}\n})`, { filename: abs })(module, module.exports, localRequire);
    return module.exports;
  }
  return load(entry);
}
