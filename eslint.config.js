// eslint.config.js
import tseslint from "typescript-eslint";
import sonarjs from "eslint-plugin-sonarjs";

const noTypeofRule = [
  "error",
  {
    selector: "UnaryExpression[operator='typeof']",
    message:
      "typeof is forbidden. Use a type guard function instead. " +
      "If unavoidable, add: // eslint-disable-next-line no-restricted-syntax -- <reason>"
  }
];

export default tseslint.config(
  // Block 1: SonarJS rules (TS + MJS)
  {
    files: ["src/**/*.ts", "tests/**/*.ts", "scripts/**/*.mjs"],
    extends: [sonarjs.configs.recommended],
    rules: {
      "sonarjs/cognitive-complexity": ["error", 10],
      "sonarjs/no-duplicate-string": ["error", { threshold: 3 }],
      "sonarjs/prefer-single-boolean-return": "error",
      "sonarjs/prefer-immediate-return": "error",
      "sonarjs/no-redundant-boolean": "error",
      "sonarjs/no-redundant-jump": "error",
      "sonarjs/no-collapsible-if": "error",
      "sonarjs/no-identical-functions": "error",
      "sonarjs/no-inverted-boolean-check": "error",
      "sonarjs/no-duplicated-branches": "error",
      "sonarjs/no-gratuitous-expressions": "error",
      "sonarjs/prefer-object-literal": "error"
    }
  },

  // Block 2: Type-aware TS rules (src + tests only)
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    extends: [tseslint.configs.base],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      "no-restricted-syntax": noTypeofRule,
      "no-inline-comments": "error",
      "no-useless-return": "error",
      "object-shorthand": "error",
      "prefer-template": "error",
      "prefer-destructuring": ["warn", { object: true, array: false }],
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/prefer-nullish-coalescing": "error",
      "@typescript-eslint/prefer-optional-chain": "error",
      "@typescript-eslint/no-redundant-type-constituents": "error"
    }
  },

  // Block 3: Scripts (MJS, non-type-aware)
  {
    files: ["scripts/**/*.mjs"],
    rules: {
      "no-restricted-syntax": noTypeofRule,
      "no-inline-comments": "error",
      "no-useless-return": "error",
      "object-shorthand": "error",
      "prefer-template": "error",
      "prefer-destructuring": ["warn", { object: true, array: false }]
    }
  },

  // Block 4: Test relaxations
  {
    files: ["tests/**/*.ts"],
    rules: {
      "sonarjs/no-duplicate-string": "off",
      "sonarjs/no-identical-functions": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "prefer-destructuring": "off"
    }
  }
);
