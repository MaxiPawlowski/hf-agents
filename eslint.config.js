// eslint.config.js
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    extends: [tseslint.configs.base],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "UnaryExpression[operator='typeof']",
          message:
            "typeof is forbidden. Use a type guard function instead. " +
            "If unavoidable, add: // eslint-disable-next-line no-restricted-syntax -- <reason>"
        }
      ],
      "no-inline-comments": "error"
    }
  },
  {
    files: ["scripts/**/*.mjs"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "UnaryExpression[operator='typeof']",
          message:
            "typeof is forbidden. Use a type guard function instead. " +
            "If unavoidable, add: // eslint-disable-next-line no-restricted-syntax -- <reason>"
        }
      ],
      "no-inline-comments": "error"
    }
  }
);
