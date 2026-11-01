import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [".next/**", "node_modules/**", "public/sw.js"],
  },
  {
    rules: {
      // Three.js JSX props (position, args, intensity…) are not DOM props.
      "react/no-unknown-property": "off",
    },
  },
];

export default eslintConfig;
