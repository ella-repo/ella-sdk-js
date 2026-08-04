import { defineConfig } from 'tsup';

export default defineConfig([
    // ESM + CJS for bundler/npm consumers, with type declarations.
    {
        entry: { index: 'src/index.ts' },
        format: ['esm', 'cjs'],
        dts: true,
        sourcemap: true,
        clean: true,
        outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
    },
    // UMD/IIFE bundle for a hosted <script> tag exposing window.Ella.
    // Also copied next to example/index.html so the demo works from any served dir.
    {
        entry: { 'ella-sdk-js': 'src/index.ts' },
        format: ['iife'],
        globalName: 'Ella',
        sourcemap: true,
        minify: true,
        outExtension: () => ({ js: '.umd.js' }),
        onSuccess: 'cp dist/ella-sdk-js.umd.js example/ella-sdk-js.umd.js',
    },
]);
