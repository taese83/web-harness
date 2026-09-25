// import-closure-lib.mjs — 배포본 안의 상대 import가 전부 배포본 안에 있는가(읽기만 한다).
// 런타임 스크립트가 배포되지 않는 경로(dev 전용 validators/ 등)를 부르면 배포본에서 로드 자체가 실패한다 —
// 빌드가 그 사실을 먼저 막는다. 정적 import·export … from·문자열 리터럴 동적 import만 본다(변수로 조립한 경로는 못 본다).
import {existsSync, readdirSync, readFileSync} from 'node:fs'
import {dirname, join, relative, resolve} from 'node:path'

// 모듈 import·export는 줄 맨 앞에서 시작한다 — 주석 속 예시나 페이지에 주입하는 HTML 문자열 속 import는 이 파일의 의존이 아니다.
const RELATIVE_SPECIFIER = /^[ \t]*(?:import|export)\b[^'"`;]*?\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]|\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)|^[ \t]*import\s*['"](\.{1,2}\/[^'"]+)['"]/gm

const scriptFiles = root => readdirSync(root, {withFileTypes: true}).flatMap(entry => {
  const path = join(root, entry.name)
  if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : scriptFiles(path)
  return entry.isFile() && /\.m?js$/.test(entry.name) ? [path] : []
})

/** @returns {{file: string, specifier: string}[]} 배포본 루트 기준 파일과 풀리지 않는 상대 지정자 */
export const unresolvedRelativeImports = root => scriptFiles(root).flatMap(file => {
  const source = readFileSync(file, 'utf8')
  return [...source.matchAll(RELATIVE_SPECIFIER)]
    .map(match => match[1] ?? match[2] ?? match[3])
    .filter(specifier => !existsSync(resolve(dirname(file), specifier)))
    .map(specifier => ({file: relative(root, file), specifier}))
})
