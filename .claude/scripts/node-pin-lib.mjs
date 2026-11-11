// node-pin-lib.mjs — 실행 Node 옆 형제 설치(…/versions/node/vX.Y.Z/bin/node)에서 고정 major의 가장 높은 버전을 찾는다.
// 경로는 실행 Node(execPath)에서 도출한다 — 하드코딩한 버전 관리자 경로는 없다. 그런 배치가 아니면 찾지 못한다(호출자가 막는다).
import {existsSync, readdirSync} from 'node:fs'
import {dirname, join} from 'node:path'

export const siblingNodeFor = (major, {execPath = process.execPath, list = readdirSync, exists = existsSync, platform = process.platform} = {}) => {
  const versionsRoot = dirname(dirname(dirname(execPath)))
  let entries = []
  try { entries = list(versionsRoot) } catch { return null }
  const versions = entries.map(entry => ({entry, version: String(entry).match(/^v?(\d+)\.(\d+)\.(\d+)$/)}))
    .filter(({version}) => version && Number(version[1]) === major)
    .sort((a, b) => [2, 3].reduce((order, index) => order || Number(b.version[index]) - Number(a.version[index]), 0))
  for (const {entry} of versions) {
    const candidate = join(versionsRoot, entry, 'bin', platform === 'win32' ? 'node.exe' : 'node')
    if (exists(candidate)) return candidate
  }
  return null
}
