import { describe, expect, it } from 'vitest';

import { formatChargeCost } from './cost.js';

describe('formatChargeCost', () => {
  it('formats testnet USDC charges into token units', () => {
    expect(
      formatChargeCost({
        amount: '100000',
        decimals: 6,
        symbol: 'USDC',
      }),
    ).toEqual({
      formatted: '0.1 USDC',
      raw: '100000 base units',
    });
  });

  it('trims trailing zeros from formatted token values', () => {
    expect(
      formatChargeCost({
        amount: '250000000000000000',
        decimals: 18,
        symbol: 'USDm',
      }),
    ).toEqual({
      formatted: '0.25 USDm',
      raw: '250000000000000000 base units',
    });
  });
});
