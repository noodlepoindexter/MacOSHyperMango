/* ---------------------------------------------------------------------------
   Module-syntax stripping for the HTML export.

   The exported page runs the same runtime modules the app does, concatenated
   into a single classic script. That is only sound because those modules use a
   narrow subset of module syntax: named `export` declarations, and relative
   `import { … } from './x.js'`. This transform removes both.

   Kept separate from bundle.js so it can be tested in Node — bundle.js uses
   Vite's `?raw` imports and will not load outside a Vite build.
   --------------------------------------------------------------------------- */

/**
 * Remove import/export syntax so several modules can share one scope.
 * @param {string} src
 * @returns {string}
 */
export function stripModuleSyntax(src) {
  return (
    src
      // Relative imports: the modules end up in one scope, so bindings resolve
      // lexically and the statement is unnecessary.
      .replace(/^[ \t]*import\s+[^;]*?from\s*['"][^'"]+['"]\s*;?[ \t]*$/gm, '')
      // Bare `import './x.js';`
      .replace(/^[ \t]*import\s*['"][^'"]+['"]\s*;?[ \t]*$/gm, '')
      // `export { a, b };` re-export lists declare nothing.
      .replace(/^[ \t]*export\s*\{[^}]*\}\s*;?[ \t]*$/gm, '')
      // `export const x` -> `const x`, and the same for other declarations.
      .replace(/^([ \t]*)export\s+(const|let|var|function|class|async)\b/gm, '$1$2')
  );
}

/** Module syntax this transform cannot handle. Used by tests to fail loudly. */
export function findUnsupportedSyntax(src) {
  const problems = [];
  if (/^\s*export\s+default\b/m.test(src)) problems.push('export default');
  if (/^\s*export\s+\*/m.test(src)) problems.push('export *');
  // A surviving import/export after stripping means the pattern was missed.
  const stripped = stripModuleSyntax(src);
  if (/^\s*(import|export)\b/m.test(stripped)) {
    problems.push('unhandled import/export statement');
  }
  return problems;
}
