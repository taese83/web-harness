import {spawnSync} from 'node:child_process'
import {join} from 'node:path'

export const validateHardeningSelfTests = ({scriptDirectory, repositoryRoot, pass, fail}) => {
  for (const [fileName, label] of [
    ['validate-quality-policy.mjs', 'quality script and installed dependency binding self-test passed'],
    ['validate-security-hardening.mjs', 'package, sensitive-path, symlink, and artifact hardening self-test passed'],
  ]) {
    const result = spawnSync(process.execPath, [join(scriptDirectory, 'validators', fileName)], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      timeout: 120_000,
    })
    if (result.status !== 0) fail(`${fileName}: ${result.stderr || result.stdout || 'self-test failed'}`.trim())
    else pass(label)
  }
}
