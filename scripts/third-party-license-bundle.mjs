import path from "node:path";
import { opendir, readFile, stat } from "node:fs/promises";

const licenseFilePattern = /^(?:licen[cs]e|copying|copyright|notice)(?:[._-].*)?$/i;
const maximumLicenseFileBytes = 1024 * 1024;
const maximumLicenseFilesPerPackage = 16;
const maximumDirectoryEntriesPerPackage = 4096;
const maximumPackageCoordinates = 2000;
const maximumTotalLicenseSourceBytes = 12 * 1024 * 1024;
const maximumBundleBytes = 16 * 1024 * 1024;
const trustedPackageArchiveHosts = new Set(["registry.npmjs.org", "registry.npmmirror.com"]);
const sharedUpstreamLicenseFallbacks = [
  { prefix: "@esbuild/", upstreamName: "esbuild", packagePath: "node_modules/esbuild", repositoryToken: "github.com/evanw/esbuild" },
  { prefix: "@rollup/rollup-", upstreamName: "rollup", packagePath: "node_modules/rollup", repositoryToken: "github.com/rollup/rollup" }
];

const standardLicenseFallbacks = {
  MIT: (attribution) => `Copyright (c) ${attribution}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.`,
  ISC: (attribution) => `Copyright (c) ${attribution}\n\nPermission to use, copy, modify, and/or distribute this software for any\npurpose with or without fee is hereby granted, provided that the above\ncopyright notice and this permission notice appear in all copies.\n\nTHE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH\nREGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY\nAND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,\nINDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM\nLOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR\nOTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR\nPERFORMANCE OF THIS SOFTWARE.`,
  "BSD-2-Clause": (attribution) => `Copyright (c) ${attribution}\nAll rights reserved.\n\nRedistribution and use in source and binary forms, with or without\nmodification, are permitted provided that the following conditions are met:\n\n1. Redistributions of source code must retain the above copyright notice,\n   this list of conditions and the following disclaimer.\n2. Redistributions in binary form must reproduce the above copyright notice,\n   this list of conditions and the following disclaimer in the documentation\n   and/or other materials provided with the distribution.\n\nTHIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"\nAND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE\nIMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE\nDISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE\nFOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL\nDAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR\nSERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER\nCAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,\nOR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE\nOF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`,
  "BSD-3-Clause": (attribution) => `Copyright (c) ${attribution}\nAll rights reserved.\n\nRedistribution and use in source and binary forms, with or without\nmodification, are permitted provided that the following conditions are met:\n\n1. Redistributions of source code must retain the above copyright notice,\n   this list of conditions and the following disclaimer.\n2. Redistributions in binary form must reproduce the above copyright notice,\n   this list of conditions and the following disclaimer in the documentation\n   and/or other materials provided with the distribution.\n3. Neither the name of the copyright holder nor the names of its contributors\n   may be used to endorse or promote products derived from this software\n   without specific prior written permission.\n\nTHIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"\nAND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE\nIMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE\nDISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE\nFOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL\nDAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR\nSERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER\nCAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,\nOR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE\nOF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`
};

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeText(value) {
  return String(value || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
}

function normalizeAuthor(author) {
  if (typeof author === "string") return author.trim();
  if (!author || typeof author !== "object") return "";
  return [author.name, author.email ? `<${author.email}>` : "", author.url].filter(Boolean).join(" ").trim();
}

function normalizeRepository(repository) {
  if (typeof repository === "string") return repository.trim();
  if (!repository || typeof repository !== "object") return "";
  const value = String(repository.url || "").trim();
  return repository.directory ? `${value}#${repository.directory}` : value;
}

function npmPackageUrl(packageName, version) {
  const safeName = packageName.split("/").map(encodeURIComponent).join("/");
  return `https://www.npmjs.com/package/${safeName}/v/${encodeURIComponent(version)}`;
}

export function sanitizePublicSource(_value, packageName, version) {
  // 中文注解：依赖元数据属于不可信输入，公开产物统一输出由包名和锁定版本构造的 npm 页面，杜绝任意 URL 泄露凭据。
  return npmPackageUrl(packageName, version);
}

export function hasValidSha512Integrity(value) {
  return String(value || "").split(/\s+/).some((token) => /^sha512-[A-Za-z0-9+/]{86}==$/.test(token));
}

export function isTrustedLockedArchive(lockMetadata, packageName, version) {
  const resolvedUrl = String(lockMetadata.resolved || "");
  const packageBaseName = packageName.split("/").at(-1);
  const expectedPath = `/${packageName}/-/${packageBaseName}-${version}.tgz`;
  try {
    const archive = new URL(resolvedUrl);
    return archive.protocol === "https:"
      && trustedPackageArchiveHosts.has(archive.hostname.toLowerCase())
      && archive.port === ""
      && !archive.username
      && !archive.password
      && !archive.search
      && !archive.hash
      && archive.pathname === expectedPath
      && hasValidSha512Integrity(lockMetadata.integrity);
  } catch {
    return false;
  }
}

export function hasValidSharedUpstreamMetadata({ packageMetadata, lockMetadata, upstreamMetadata, rule, license }) {
  const targetRepository = normalizeRepository(packageMetadata.repository);
  const upstreamRepository = normalizeRepository(upstreamMetadata.repository);
  const upstreamLicense = normalizeDeclaredLicense(upstreamMetadata);
  const declaredByUpstream = upstreamMetadata.optionalDependencies?.[packageMetadata.name] === packageMetadata.version;
  // 中文注解：即使目标原生包已安装并声明仓库，也必须同时通过锁定归档与 SRI 校验，避免平台差异绕过供应链门禁。
  return upstreamMetadata.name === rule.upstreamName
    && packageMetadata.version === upstreamMetadata.version
    && license === upstreamLicense
    && upstreamRepository.includes(rule.repositoryToken)
    && (!targetRepository || targetRepository.includes(rule.repositoryToken))
    && declaredByUpstream
    && isTrustedLockedArchive(lockMetadata, packageMetadata.name, packageMetadata.version);
}

function normalizeDeclaredLicense(packageMetadata) {
  if (typeof packageMetadata.license === "string") return packageMetadata.license.trim();
  if (!Array.isArray(packageMetadata.licenses)) return "";
  return packageMetadata.licenses
    .map((item) => typeof item === "string" ? item : item?.type)
    .filter(Boolean)
    .join(" OR ");
}

function packageNameFromLockPath(packagePath) {
  return packagePath.split("node_modules/").filter(Boolean).at(-1) || "";
}

function matchesPlatformConstraint(values, targetValue) {
  if (!Array.isArray(values) || values.length === 0) return true;
  const exclusions = values.filter((value) => value.startsWith("!")).map((value) => value.slice(1));
  if (exclusions.includes(targetValue)) return false;
  const inclusions = values.filter((value) => !value.startsWith("!"));
  return inclusions.length === 0 || inclusions.includes(targetValue);
}

function inferOptionalLibc(packageName, lockMetadata) {
  if (Array.isArray(lockMetadata.libc) && lockMetadata.libc.length) return "";
  if (packageName.startsWith("@rollup/rollup-") && packageName.endsWith("-musl")) return "musl";
  if (packageName.startsWith("@rollup/rollup-") && packageName.endsWith("-gnu")) return "glibc";
  return "";
}

function matchesReleaseTarget(packageName, lockMetadata, releaseTarget) {
  const inferredLibc = inferOptionalLibc(packageName, lockMetadata);
  return matchesPlatformConstraint(lockMetadata.os, releaseTarget.os)
    && matchesPlatformConstraint(lockMetadata.cpu, releaseTarget.cpu)
    && matchesPlatformConstraint(lockMetadata.libc, releaseTarget.libc)
    && (!inferredLibc || inferredLibc === releaseTarget.libc);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readPackageLicenseFiles(packageDirectory) {
  const names = [];
  let directoryEntryCount = 0;
  // 中文注解：流式扫描并限制全部根目录项，避免大量非许可证文件在过滤前占满门禁内存。
  for await (const entry of await opendir(packageDirectory)) {
    directoryEntryCount += 1;
    if (directoryEntryCount > maximumDirectoryEntriesPerPackage) throw new Error(`依赖根目录文件数量异常：${packageDirectory}`);
    if (entry.isFile() && licenseFilePattern.test(entry.name)) names.push(entry.name);
  }
  names.sort((left, right) => compareText(left.toLowerCase(), right.toLowerCase()));
  if (names.length > maximumLicenseFilesPerPackage) throw new Error(`许可证文件数量异常：${packageDirectory}`);
  const sources = [];
  for (const name of names) {
    const filePath = path.join(packageDirectory, name);
    const fileStats = await stat(filePath);
    if (fileStats.size > maximumLicenseFileBytes) throw new Error(`许可证文件异常过大：${filePath}`);
    const content = await readFile(filePath);
    if (content.includes(0)) throw new Error(`许可证文件不是文本：${filePath}`);
    sources.push({ name, content: normalizeText(content.toString("utf8")) });
  }
  return sources.filter((item) => item.content);
}

async function readSharedUpstreamLicenseFallback(rootDir, candidate, license) {
  const { packageMetadata, lockMetadata } = candidate;
  const rule = sharedUpstreamLicenseFallbacks.find((item) => packageMetadata.name.startsWith(item.prefix));
  if (!rule) return [];
  const upstreamDirectory = path.join(rootDir, rule.packagePath);
  const upstreamMetadata = await readJson(path.join(upstreamDirectory, "package.json"));
  // 中文注解：原生平台包不携带 LICENSE 时，只允许复用同版本、同许可证、同上游仓库主包的原文，避免错配其他项目授权。
  if (!hasValidSharedUpstreamMetadata({ packageMetadata, lockMetadata, upstreamMetadata, rule, license })) {
    throw new Error(`${packageMetadata.name}@${packageMetadata.version} 的共享上游许可证校验失败`);
  }
  const sources = await readPackageLicenseFiles(upstreamDirectory);
  return sources.map((item) => ({ ...item, name: `shared-upstream:${rule.packagePath}/${item.name}` }));
}

function buildStandardFallback(license, candidate, source) {
  const { packageMetadata, installed } = candidate;
  const factory = standardLicenseFallbacks[license];
  // 中文注解：当前构建机未安装的目标包没有作者/仓库元数据，除受控共享上游外必须失败，不能把下载地址伪造成版权署名。
  if (!factory || !installed) return [];
  const attribution = normalizeAuthor(packageMetadata.author) || source || `${packageMetadata.name} contributors`;
  return [{ name: `standard:${license}`, content: factory(attribution) }];
}

function renderEntry(entry) {
  const sourceNames = entry.licenseSources.map((item) => item.name).join(", ");
  const header = [
    `Package: ${entry.name}@${entry.version}`,
    `License: ${entry.license}`,
    `Source: ${entry.source}`,
    `Installed paths: ${entry.packagePaths.join(", ")}`,
    `License sources: ${sourceNames}`
  ];
  if (entry.attribution) header.push(`Package attribution: ${entry.attribution}`);
  const bodies = entry.licenseSources.map((item) => `----- ${item.name} -----\n${item.content}`).join("\n\n");
  return `${"=".repeat(79)}\n${header.join("\n")}\n\n${bodies}`;
}

export async function buildThirdPartyLicenseBundle({ rootDir = process.cwd() } = {}) {
  const absoluteRoot = path.resolve(rootDir);
  const lock = await readJson(path.join(absoluteRoot, "package-lock.json"));
  const releaseTarget = await readJson(path.join(absoluteRoot, "ops", "release-target.json"));
  if (![releaseTarget.os, releaseTarget.cpu, releaseTarget.libc].every((value) => typeof value === "string" && /^[a-z0-9_-]+$/.test(value))) {
    throw new Error("ops/release-target.json 必须提供合法的 os、cpu 和 libc");
  }
  const packageGroups = new Map();
  const missing = [];
  const skippedOptional = [];

  for (const [packagePath, lockMetadata] of Object.entries(lock.packages || {}).sort(([left], [right]) => compareText(left, right))) {
    if (!packagePath || lockMetadata.dev === true) continue;
    if (!packagePath.startsWith("node_modules/") || packagePath.includes("..")) {
      missing.push(`${packagePath || "<root>"} 使用了不安全的依赖路径`);
      continue;
    }
    const packageName = packageNameFromLockPath(packagePath);
    // 中文注解：平台可选包必须按明确的 Linux 发布目标筛选；不能沿用构建机当前安装结果，否则 Windows 构建会漏掉生产原生包。
    if ((lockMetadata.optional === true || lockMetadata.devOptional === true) && !matchesReleaseTarget(packageName, lockMetadata, releaseTarget)) {
      skippedOptional.push(`${packagePath}@${lockMetadata.version || "unknown"}`);
      continue;
    }
    const packageDirectory = path.resolve(absoluteRoot, packagePath);
    let packageMetadata;
    let installed = true;
    try {
      packageMetadata = await readJson(path.join(packageDirectory, "package.json"));
    } catch (error) {
      if (lockMetadata.optional === true || lockMetadata.devOptional === true) {
        // 中文注解：目标平台原生包可未安装在当前构建机，但只允许锁文件完整声明且后续能通过共享上游许可证校验的包进入清单。
        installed = false;
        packageMetadata = { name: packageName, version: lockMetadata.version, license: lockMetadata.license };
      } else {
        missing.push(`${packagePath}@${lockMetadata.version || "unknown"} 未安装或缺少 package.json：${error.message}`);
        continue;
      }
    }
    const name = String(packageMetadata.name || "").trim();
    const version = String(packageMetadata.version || lockMetadata.version || "").trim();
    if (!name || !version || (lockMetadata.version && version !== lockMetadata.version)) {
      missing.push(`${packagePath} 的包名或版本与 package-lock.json 不一致`);
      continue;
    }
    const coordinate = `${name}@${version}`;
    const candidates = packageGroups.get(coordinate) || [];
    candidates.push({ packagePath: packagePath.replaceAll("\\", "/"), packageDirectory, packageMetadata, lockMetadata, installed });
    packageGroups.set(coordinate, candidates);
  }

  if (packageGroups.size > maximumPackageCoordinates) throw new Error(`生产依赖坐标异常过多：${packageGroups.size}`);
  const entries = [];
  let totalLicenseSourceBytes = 0;
  // 中文注解：同一 name@version 只发布一次许可证正文；嵌套重复安装路径合并记录，避免巨量重复文本。
  for (const [coordinate, candidates] of [...packageGroups.entries()].sort(([left], [right]) => compareText(left, right))) {
    const first = candidates[0];
    const { packageMetadata } = first;
    const license = String(first.lockMetadata.license || normalizeDeclaredLicense(packageMetadata)).trim();
    const source = sanitizePublicSource(
      normalizeRepository(packageMetadata.repository) || packageMetadata.homepage || first.lockMetadata.resolved,
      packageMetadata.name,
      packageMetadata.version
    );
    const attribution = normalizeAuthor(packageMetadata.author);
    let licenseSources = [];
    for (const candidate of candidates) {
      if (!candidate.installed) continue;
      licenseSources = await readPackageLicenseFiles(candidate.packageDirectory);
      if (licenseSources.length) break;
    }
    let usedFallback = false;
    // 中文注解：缺少包内文件时先校验同源原生包关系，再退到带目标包署名的标准文本；任何未知许可证都失败关闭。
    if (!licenseSources.length) {
      licenseSources = await readSharedUpstreamLicenseFallback(absoluteRoot, first, license);
      usedFallback = licenseSources.length > 0;
    }
    if (!licenseSources.length) {
      licenseSources = buildStandardFallback(license, first, source);
      usedFallback = licenseSources.length > 0;
    }
    if (!license || !licenseSources.length) {
      missing.push(`${coordinate} 无法生成许可证正文（声明：${license || "缺失"}）`);
      continue;
    }
    totalLicenseSourceBytes += licenseSources.reduce((total, item) => total + Buffer.byteLength(item.content), 0);
    if (totalLicenseSourceBytes > maximumTotalLicenseSourceBytes) throw new Error(`许可证正文总量超过安全上限：${totalLicenseSourceBytes}`);
    entries.push({
      name: packageMetadata.name,
      version: packageMetadata.version,
      license,
      source,
      attribution,
      packagePaths: candidates.map((item) => item.packagePath).sort(compareText),
      licenseSources,
      usedFallback
    });
  }

  const preamble = [
    "MOLINWORD THIRD-PARTY LICENSE BUNDLE",
    "",
    `Release target: ${releaseTarget.os}/${releaseTarget.cpu}/${releaseTarget.libc}`,
    "Generated deterministically from package-lock.json and production dependencies for the declared release target.",
    "This file preserves package license, copyright and NOTICE text for distributed software.",
    "It does not grant a license to the private molinword project itself.",
    ""
  ].join("\n");
  const renderedEntries = [];
  let bundleBytes = Buffer.byteLength(preamble) + 1;
  for (const entry of entries) {
    const rendered = renderEntry(entry);
    bundleBytes += Buffer.byteLength(rendered) + 2;
    if (bundleBytes > maximumBundleBytes) throw new Error(`许可证发布包超过安全上限：${bundleBytes}`);
    renderedEntries.push(rendered);
  }
  const content = `${preamble}${renderedEntries.join("\n\n")}\n`;
  return { content, entries, missing, skippedOptional, releaseTarget };
}
