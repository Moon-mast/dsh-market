#!/usr/bin/env node
/**
 * Install this build into the official DSH Desktop profile.
 *
 * DSH Desktop owns `$DSH_HOME/profiles/desktop` and must be fully quit while
 * a package operation changes it. This script finds the Desktop-bundled `dsh`
 * CLI, refuses to run while the app is open, and hands the spec to
 * `dsh plugin --profile desktop add`.
 *
 * Usage:
 *   npm run desktop:install
 *   npm run desktop:install -- github:Moon-mast/dsh-market
 *   npm run desktop:install -- ./dshmarket-1.73.11-desktop.1.tgz
 *
 * Options:
 *   --cli <path>    Desktop-bundled dsh CLI (overrides discovery)
 *   --dry-run       Print the command without running it
 *   --force         Continue even when Desktop looks like it is running
 *
 * Environment:
 *   DSH_DESKTOP_CLI  Same as --cli.
 *   DSH_HOME         Harness home (defaults to ~/.dsh).
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const DEFAULT_SPEC = 'github:Moon-mast/dsh-market'
const APP_NAMES = ['DeepSeek Harness', 'DSH Desktop']
const IS_WINDOWS = process.platform === 'win32'

function parseArgs(argv) {
  const options = { spec: DEFAULT_SPEC, cli: process.env.DSH_DESKTOP_CLI, dryRun: false, force: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--force') options.force = true
    else if (arg === '--cli') options.cli = argv[++i]
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: npm run desktop:install -- [spec] [--cli <path>] [--dry-run] [--force]')
      process.exit(0)
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown option: ${arg}`)
    } else if (options.spec === DEFAULT_SPEC) {
      options.spec = arg
    } else {
      throw new Error(`unexpected extra argument: ${arg}`)
    }
  }
  if (!options.spec) throw new Error('empty install spec')
  return options
}

function dshHome() {
  return process.env.DSH_HOME && process.env.DSH_HOME.trim() !== ''
    ? resolve(process.env.DSH_HOME)
    : join(homedir(), '.dsh')
}

function desktopProfileDir() {
  return join(dshHome(), 'profiles', 'desktop')
}

/** Read the Start Menu shortcut the installer creates, without opening the app. */
function windowsShortcutTarget() {
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "$paths = @(",
    "  (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\DeepSeek Harness.lnk'),",
    "  (Join-Path $env:ProgramData 'Microsoft\\Windows\\Start Menu\\Programs\\DeepSeek Harness.lnk')",
    ")",
    'foreach ($p in $paths) {',
    '  if (Test-Path $p) {',
    '    $s = (New-Object -ComObject WScript.Shell).CreateShortcut($p)',
    '    if ($s.TargetPath) { $s.TargetPath; break }',
    '  }',
    '}',
  ].join('\n')
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
  })
  const target = (result.stdout ?? '').split(/\r?\n/).map(line => line.trim()).find(Boolean)
  return target
}

/** Candidate CLI paths, most specific first. */
function cliCandidates() {
  const paths = []
  if (IS_WINDOWS) {
    const roots = [
      process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness'),
      process.env.ProgramFiles && join(process.env.ProgramFiles, 'DeepSeek Harness'),
      process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)'], 'DeepSeek Harness'),
    ].filter(Boolean)
    const shortcut = windowsShortcutTarget()
    if (shortcut) roots.push(dirname(shortcut))
    for (const root of roots) {
      paths.push(join(root, 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'))
      paths.push(join(root, 'resources', 'runtime', 'cli', 'bin', 'dsh.exe'))
    }
  } else if (process.platform === 'darwin') {
    for (const name of APP_NAMES) {
      paths.push(`/Applications/${name}.app/Contents/Resources/runtime/cli/bin/dsh`)
      paths.push(join(homedir(), 'Applications', `${name}.app`, 'Contents', 'Resources', 'runtime', 'cli', 'bin', 'dsh'))
    }
  } else {
    for (const root of ['/opt', '/usr/lib', '/usr/local/lib']) {
      paths.push(join(root, 'deepseek-harness', 'resources', 'runtime', 'cli', 'bin', 'dsh'))
      paths.push(join(root, 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin', 'dsh'))
    }
  }
  return [...new Set(paths)]
}

function findCli(explicit) {
  if (explicit) {
    const absolute = isAbsolute(explicit) ? explicit : resolve(explicit)
    if (!existsSync(absolute)) throw new Error(`Desktop CLI not found: ${absolute}`)
    return absolute
  }
  for (const candidate of cliCandidates()) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

function desktopRunning() {
  if (IS_WINDOWS) {
    const result = spawnSync('tasklist.exe', ['/FI', 'IMAGENAME eq DeepSeek Harness.exe', '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
    })
    return /DeepSeek Harness\.exe/i.test(result.stdout ?? '')
  }
  const result = spawnSync('pgrep', ['-f', 'DeepSeek Harness|deepseek-harness'], { encoding: 'utf8' })
  return result.status === 0
}

function displayPath(spec) {
  if (!/^(?:[a-zA-Z]+:|~|\.{0,2}[\\/])/.test(spec)) return spec
  const absolute = isAbsolute(spec) ? spec : resolve(spec)
  return existsSync(absolute) ? absolute : spec
}

function run(cli, args) {
  if (IS_WINDOWS && /\.(?:cmd|bat)$/i.test(cli)) {
    // A .cmd path with spaces cannot be spawned directly on Windows.
    const command = [cli, ...args].map(part => `"${part.replace(/"/g, '""')}"`).join(' ')
    return spawnSync(command, { stdio: 'inherit', shell: true, windowsHide: false })
  }
  return spawnSync(cli, args, { stdio: 'inherit', windowsHide: false })
}

function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`\n${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(2)
  }

  const profile = desktopProfileDir()
  if (!existsSync(join(profile, 'package.json'))) {
    console.error([
      '',
      '没有找到 DSH Desktop 的 profile：',
      `  ${profile}`,
      '',
      '请先启动一次 DSH Desktop，让它初始化 profile，然后完全退出应用再运行本脚本。',
      'Launch DSH Desktop once to initialize its profile, then fully quit it and run this script again.',
      '',
    ].join('\n'))
    process.exit(1)
  }

  const cli = findCli(options.cli)
  if (cli === null) {
    console.error([
      '',
      '没有找到 DSH Desktop 自带的 dsh 命令行。',
      'Could not find the dsh CLI bundled with DSH Desktop.',
      '',
      '请用 --cli 指定，例如：',
      '  npm run desktop:install -- --cli "D:\\deepseek harness\\resources\\runtime\\cli\\bin\\dsh.cmd"',
      '也可以设置环境变量 DSH_DESKTOP_CLI。',
      '',
    ].join('\n'))
    process.exit(1)
  }

  if (desktopRunning() && !options.force) {
    console.error([
      '',
      'DSH Desktop 正在运行。桌面端独占 profiles/desktop，安装时必须先完全退出应用（包括托盘）。',
      'DSH Desktop is running. It owns profiles/desktop; fully quit the app (tray included) before installing.',
      '',
      '退出后重新运行本脚本。确实要跳过检查时加 --force。',
      '',
    ].join('\n'))
    process.exit(1)
  }

  const spec = displayPath(options.spec)
  const args = ['plugin', '--profile', 'desktop', 'add', spec]
  console.log(`\nDesktop CLI: ${cli}`)
  console.log(`Profile:     ${profile}`)
  console.log(`Command:     dsh ${args.join(' ')}\n`)
  if (options.dryRun) return

  const result = run(cli, args)
  if (result.error) {
    console.error(`\n启动桌面端 CLI 失败：${result.error.message}\n`)
    process.exit(1)
  }
  if (result.status !== 0) {
    console.error(`\n安装没有完成（退出码 ${String(result.status)}）。上面的输出是宿主给出的原因。\n`)
    process.exit(result.status ?? 1)
  }
  console.log([
    '',
    '安装完成。重新打开 DSH Desktop，插件市场会出现在 设置 → 插件 / 插件 页。',
    'Done. Reopen DSH Desktop; the market appears under Settings → Plugins / the Plugins page.',
    '',
  ].join('\n'))
}

try {
  main()
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
}
