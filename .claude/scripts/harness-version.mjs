// 실행 중인 web-harness 플러그인의 신원과 버전. 플러그인 payload 루트(`.claude/scripts/../..`)의
// `.claude-plugin/plugin.json`이 name=web-harness일 때만 인정한다 — deploy 사본 위치에서 `../..`는
// 소비자 repo 루트라 남의 매니페스트일 수 있다. 모르면 null이고 지어내지 않는다.
// 릴리스 라벨이지 코드 digest가 아니다 — 같은 버전이 같은 규칙을 보장하지 않는다.
import {readFileSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

export const DEFAULT_PAYLOAD_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

export const harnessVersion = (pluginRoot = DEFAULT_PAYLOAD_ROOT) => {
  try {
    const manifest = JSON.parse(readFileSync(join(pluginRoot, '.claude-plugin/plugin.json'), 'utf8'))
    const version = manifest?.name === 'web-harness' ? manifest.version : null
    return typeof version === 'string' && version.trim() ? version : null
  } catch {
    return null
  }
}
