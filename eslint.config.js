// GJS globals; @girs types cover the rest via `npm run check`.
export default [
    {ignores: ['node_modules/']},
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {global: 'readonly', log: 'readonly', logError: 'readonly', console: 'readonly', print: 'readonly', imports: 'readonly'},
        },
        rules: {'no-unused-vars': 'warn', 'no-undef': 'error'},
    },
];
