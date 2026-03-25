import { formatUnits } from 'viem';

export function formatChargeCost(parameters: {
  amount: string;
  decimals: number;
  symbol: string;
}): {
  formatted: string;
  raw: string;
} {
  const normalizedAmount = formatUnits(BigInt(parameters.amount), parameters.decimals);
  return {
    formatted: `${trimTrailingZeros(normalizedAmount)} ${parameters.symbol}`,
    raw: `${parameters.amount} base units`,
  };
}

function trimTrailingZeros(value: string): string {
  if (!value.includes('.')) {
    return value;
  }

  return value.replace(/(?:\.0+|(\.\d*?[1-9])0+)$/, '$1');
}
