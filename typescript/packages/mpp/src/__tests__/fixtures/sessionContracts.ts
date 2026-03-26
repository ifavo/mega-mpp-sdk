import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import solc from "solc";
import type { Abi, Hex } from "viem";

type SolcContract = {
  abi?: Abi;
  evm?: {
    bytecode?: {
      object?: string;
    };
  };
};

type SolcOutput = {
  contracts?: Record<string, Record<string, SolcContract>>;
  errors?: Array<{
    formattedMessage: string;
    severity: "error" | "warning";
  }>;
};

type CompiledContract = {
  abi: Abi;
  bytecode: Hex;
};

const compiledContracts = new Map<string, CompiledContract>();

export function loadSessionEscrowContract(): CompiledContract {
  return loadCompiledContract({
    contractName: "MegaMppSessionEscrow",
    entrySource: "src/MegaMppSessionEscrow.sol",
  });
}

export function loadErc1967ProxyContract(): CompiledContract {
  return loadCompiledContract({
    contractName: "ERC1967Proxy",
    entrySource:
      "lib/openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol",
  });
}

function loadCompiledContract(parameters: {
  contractName: string;
  entrySource: string;
}): CompiledContract {
  const cacheKey = `${parameters.entrySource}:${parameters.contractName}`;
  const cachedContract = compiledContracts.get(cacheKey);
  if (cachedContract) {
    return cachedContract;
  }

  const fixtureDirectory = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(fixtureDirectory, "../../../../../..");
  const contractsDirectory = path.join(repoRoot, "contracts");

  const entrySource = normalizeSourceUnitName(parameters.entrySource);
  const sources = collectSources(contractsDirectory, entrySource);

  const output = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Solidity",
        settings: {
          outputSelection: {
            "*": {
              "*": ["abi", "evm.bytecode"],
            },
          },
        },
        sources,
      }),
    ),
  ) as SolcOutput;

  const errors =
    output.errors?.filter((error) => error.severity === "error") ?? [];
  if (errors.length) {
    throw new Error(errors.map((error) => error.formattedMessage).join("\n"));
  }

  const contract = output.contracts?.[entrySource]?.[parameters.contractName];
  if (!contract?.abi || !contract.evm?.bytecode?.object) {
    throw new Error(
      `Compile ${parameters.contractName} from ${entrySource} successfully before running the session integration suite.`,
    );
  }

  const compiledContract = {
    abi: contract.abi,
    bytecode: `0x${contract.evm.bytecode.object}` as Hex,
  };
  compiledContracts.set(cacheKey, compiledContract);

  return compiledContract;
}

function collectSources(
  contractsDirectory: string,
  entrySource: string,
): Record<string, { content: string }> {
  const sources: Record<string, { content: string }> = {};
  const visited = new Set<string>();

  function addSource(sourceUnitName: string): void {
    const normalizedSourceUnit = normalizeSourceUnitName(sourceUnitName);
    const visitedKey = `${normalizedSourceUnit}::${contractsDirectory}`;
    if (visited.has(visitedKey)) {
      return;
    }

    visited.add(visitedKey);
    const absolutePath = resolveImportPath(
      contractsDirectory,
      normalizedSourceUnit,
    );
    const content = readFileSync(absolutePath, "utf8");
    sources[normalizedSourceUnit] = { content };

    const aliasedPath = toOpenZeppelinAlias(normalizedSourceUnit);
    if (aliasedPath) {
      sources[aliasedPath] = { content };
    }

    for (const importPath of parseImports(content)) {
      addSource(resolveImportedSourceUnit(normalizedSourceUnit, importPath));
    }
  }

  addSource(entrySource);

  return sources;
}

function parseImports(source: string): string[] {
  const imports: string[] = [];
  const importPattern = /import\s+(?:[^"']*from\s+)?["']([^"']+)["'];/g;

  for (const match of source.matchAll(importPattern)) {
    const value = match[1];
    if (value) {
      imports.push(value);
    }
  }

  return imports;
}

function resolveImportedSourceUnit(
  importer: string,
  importPath: string,
): string {
  if (
    importPath.startsWith("@openzeppelin/") ||
    importPath.startsWith("lib/") ||
    importPath.startsWith("src/")
  ) {
    return normalizeSourceUnitName(importPath);
  }

  if (importPath.startsWith(".")) {
    return normalizeSourceUnitName(
      path.posix.normalize(
        path.posix.join(path.posix.dirname(importer), importPath),
      ),
    );
  }

  return normalizeSourceUnitName(importPath);
}

function resolveImportPath(
  contractsDirectory: string,
  sourceUnitName: string,
): string {
  if (sourceUnitName.startsWith("@openzeppelin/contracts-upgradeable/")) {
    return path.join(
      contractsDirectory,
      "lib/openzeppelin-contracts-upgradeable/contracts",
      sourceUnitName.slice("@openzeppelin/contracts-upgradeable/".length),
    );
  }

  if (sourceUnitName.startsWith("@openzeppelin/contracts/")) {
    return path.join(
      contractsDirectory,
      "lib/openzeppelin-contracts/contracts",
      sourceUnitName.slice("@openzeppelin/contracts/".length),
    );
  }

  return path.join(contractsDirectory, sourceUnitName);
}

function normalizeSourceUnitName(value: string): string {
  return value.replaceAll(path.sep, "/");
}

function toOpenZeppelinAlias(relativePath: string): string | null {
  const openzeppelinPrefix = "lib/openzeppelin-contracts/contracts/";
  if (relativePath.startsWith(openzeppelinPrefix)) {
    return `@openzeppelin/contracts/${relativePath.slice(openzeppelinPrefix.length)}`;
  }

  const upgradeablePrefix = "lib/openzeppelin-contracts-upgradeable/contracts/";
  if (relativePath.startsWith(upgradeablePrefix)) {
    return `@openzeppelin/contracts-upgradeable/${relativePath.slice(upgradeablePrefix.length)}`;
  }

  const nestedOpenzeppelinPrefix =
    "lib/openzeppelin-contracts-upgradeable/lib/openzeppelin-contracts/contracts/";
  if (relativePath.startsWith(nestedOpenzeppelinPrefix)) {
    return `@openzeppelin/contracts/${relativePath.slice(nestedOpenzeppelinPrefix.length)}`;
  }

  return null;
}
