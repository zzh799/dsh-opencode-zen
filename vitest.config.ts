import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vitest/config'

// 上游包 @deepseek-ai/dsh-client-ui-primitives 的发布产物在 lib/index.js 末尾声明了
// `//# sourceMappingURL=index.js.map`，却没有随包附带该 map 文件（根依赖与
// tests/hosts 下的各代宿主副本都缺）。Vite 在 load 阶段读取缺失的 map 时会 catch
// 并 warn 出整段堆栈，每次跑测试都会刷一条吓人的报错，容易掩盖真实失败。
// 这里对“引用的外部 map 文件不存在”的依赖文件剥掉声明，等价于该文件没有 sourcemap，
// Vite 便不会再发起读取；引用的 map 存在时保持原样，不影响正常堆栈映射。
function stripMissingSourceMapComments() {
  const mapComment = /\/\/# sourceMappingURL=(\S+)/g
  return {
    name: 'strip-missing-source-map-comments',
    enforce: 'pre' as const,
    load(id: string) {
      const file = id.split(/[?#]/)[0]
      if (!file.includes('/node_modules/')) return null
      let code: string
      try {
        code = fs.readFileSync(file, 'utf-8')
      } catch {
        return null // 读不到就交给 Vite 自己的错误路径去报
      }
      const missing = [...code.matchAll(mapComment)].some(
        (m) => !m[1].startsWith('data:') && !fs.existsSync(path.resolve(path.dirname(file), m[1])),
      )
      if (!missing) return null
      return { code: code.replace(/\n?\/\/# sourceMappingURL=\S+/g, ''), map: null }
    },
  }
}

export default defineConfig({
  plugins: [stripMissingSourceMapComments()],
  test: {
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    testTimeout: 15000,
    server: { deps: { inline: ['@deepseek-ai/dsh-client-ui-primitives'] } },
  },
})
