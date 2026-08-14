import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // React Compiler 的新规则，本仓库既有页面里还有十几处「挂载时读
      // localStorage / 拉首屏数据 / 同步模块级 store」的 effect 命中它。
      // 这些写法目前行为正确，改造需要逐个换成 useSyncExternalStore、
      // key 重挂载或渲染期派生，并配合 UI 回归验证，不适合混在其他改动里做。
      // 暂降为 warn：保持可见、不阻塞 CI，待专门一轮重构清掉。
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
